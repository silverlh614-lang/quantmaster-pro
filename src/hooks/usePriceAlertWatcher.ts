// @responsibility 워치리스트 가격 알림 watcher — Web Notification + dedupe + opt-in (ADR-0020 PR-C)

import { useEffect, useRef } from 'react';
import { useSettingsStore } from '../stores';
import type { StockRecommendation } from '../services/stockService';
import type { PriceAlertLevel } from '../types/ui';
import { computePriceAlertLevel, isActionableAlert } from '../utils/priceAlertLevel';

/** 같은 종목 + 같은 alertLevel 알림이 5분 내 반복되지 않도록 dedupe 한다. */
export const ALERT_COOLDOWN_MS = 5 * 60_000;

const STORAGE_PREFIX = 'qm:price-alert:';

export const ALERT_TITLE: Record<Exclude<PriceAlertLevel, 'NORMAL'>, string> = {
  CAUTION: '🟡 손절선 근접',
  DANGER: '🔴 손절가 도달',
  TAKE_PROFIT: '🎯 1차 목표가 도달',
};

/**
 * 발송 결정 순수 함수 — 테스트 가능. hook 의 useEffect 가 매 종목마다 호출.
 *
 * - level=NORMAL → false (알림 대상 아님)
 * - previousLevel===level → false (transition 만 알림)
 * - lastFiredAt + ALERT_COOLDOWN_MS > now → false (cooldown 내)
 * - 그 외 → true
 */
export function shouldDispatchAlert(
  level: PriceAlertLevel,
  previousLevel: PriceAlertLevel | undefined,
  lastFiredAt: number | null,
  now: number,
): boolean {
  if (!isActionableAlert(level)) return false;
  if (previousLevel === level) return false;
  if (lastFiredAt != null && Number.isFinite(lastFiredAt)) {
    if (now - lastFiredAt <= ALERT_COOLDOWN_MS) return false;
  }
  return true;
}

function dedupeKey(stockCode: string, level: PriceAlertLevel): string {
  return `${STORAGE_PREFIX}${stockCode}:${level}`;
}

function markFired(stockCode: string, level: PriceAlertLevel, now: number): void {
  if (typeof window === 'undefined' || !window.localStorage) return;
  try {
    window.localStorage.setItem(dedupeKey(stockCode, level), String(now));
  } catch {
    /* SDS-ignore: localStorage quota 초과 시 무시 */
  }
}

function buildBody(stock: StockRecommendation, level: PriceAlertLevel): string {
  const price = stock.currentPrice.toLocaleString('ko-KR');
  if (level === 'TAKE_PROFIT') {
    return `${stock.name} ${price} — 목표가 ${stock.targetPrice.toLocaleString('ko-KR')} 도달`;
  }
  if (level === 'DANGER') {
    return `${stock.name} ${price} — 손절가 ${stock.stopLoss.toLocaleString('ko-KR')} 도달`;
  }
  if (level === 'CAUTION') {
    const distancePct = stock.stopLoss > 0
      ? ((stock.currentPrice - stock.stopLoss) / stock.currentPrice * 100).toFixed(1)
      : '-';
    return `${stock.name} ${price} — 손절선까지 ${distancePct}%`;
  }
  return `${stock.name} ${price}`;
}

/**
 * Notification API 미지원 / 권한 미부여 시 false.
 * 'granted' 일 때만 발송 가능. 'default' / 'denied' 는 미발송 (in-app 배지만).
 */
function canSendNotification(): boolean {
  if (typeof window === 'undefined') return false;
  if (typeof Notification === 'undefined') return false;
  return Notification.permission === 'granted';
}

function sendNotification(stock: StockRecommendation, level: PriceAlertLevel): void {
  if (!canSendNotification()) return;
  if (level === 'NORMAL') return;
  try {
    const title = ALERT_TITLE[level];
    const body = buildBody(stock, level);
    new Notification(title, {
      body,
      tag: `qm-price-alert-${stock.code}-${level}`,
    });
  } catch {
    /* SDS-ignore: Notification 생성 실패 (브라우저 정책) — in-app 배지로 fallback */
  }
}

/**
 * 워치리스트 종목들의 가격을 watch 하여 4단계 alertLevel 변화 시 OS 알림 발송.
 *
 * - `priceAlertsEnabled=false` → no-op (사용자 opt-in 전)
 * - `priceAlertsEnabled=true + permission=granted` → 알림 발송
 * - `priceAlertsEnabled=true + permission≠granted` → in-app 배지만 (PriceAlertBadge 분리 노출)
 *
 * dedupe: 같은 종목 + 같은 alertLevel 5분 내 반복 차단 (localStorage).
 *
 * 호출 시점: 페이지 레벨에서 1회 (`DiscoverWatchlistPage` 등). 카드별 호출 금지.
 */
export function usePriceAlertWatcher(stocks: ReadonlyArray<StockRecommendation>): void {
  const enabled = useSettingsStore(s => s.priceAlertsEnabled);
  const lastLevelByCodeRef = useRef<Map<string, PriceAlertLevel>>(new Map());

  useEffect(() => {
    if (!enabled) return;

    const now = Date.now();
    const lastLevels = lastLevelByCodeRef.current;

    for (const stock of stocks) {
      if (!stock?.code) continue;
      const level = computePriceAlertLevel({
        currentPrice: stock.currentPrice,
        stopLoss: stock.stopLoss,
        targetPrice: stock.targetPrice,
      });

      const previousLevel = lastLevels.get(stock.code);
      lastLevels.set(stock.code, level);

      // localStorage 의 마지막 발송 시각 조회
      const lastFiredRaw = typeof window !== 'undefined' && window.localStorage
        ? window.localStorage.getItem(dedupeKey(stock.code, level))
        : null;
      const lastFiredAt = lastFiredRaw != null ? Number(lastFiredRaw) : null;

      if (!shouldDispatchAlert(level, previousLevel, lastFiredAt, now)) continue;

      sendNotification(stock, level);
      markFired(stock.code, level, now);
    }
  }, [stocks, enabled]);
}

/**
 * 가격 알림 활성화 요청 — 권한 요청 + opt-in 토글.
 * 컴포넌트에서 직접 호출.
 *
 * 반환:
 * - 'granted': 활성화 + Notification 권한 OK
 * - 'denied': 권한 거부됨 (브라우저 설정에서만 풀 수 있음)
 * - 'default': 사용자가 prompt 닫음 (재요청 가능)
 * - 'unsupported': 브라우저가 Notification API 미지원
 */
export async function requestPriceAlertPermission(): Promise<'granted' | 'denied' | 'default' | 'unsupported'> {
  if (typeof window === 'undefined' || typeof Notification === 'undefined') {
    return 'unsupported';
  }
  if (Notification.permission === 'granted') return 'granted';
  if (Notification.permission === 'denied') return 'denied';
  try {
    const result = await Notification.requestPermission();
    return result === 'granted' || result === 'denied' || result === 'default'
      ? result
      : 'default';
  } catch {
    return 'default';
  }
}
