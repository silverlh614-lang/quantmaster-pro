// @responsibility positionMorningCard 알림 모듈 (ADR-0504 source-validated SSOT 사용).
/**
 * positionMorningCard.ts — 보유 포지션 Morning Card (IDEA 4 + ADR-0504).
 *
 * ADR-0504: positionAggregator 의 학습/실보유 entry 분리 0 결함 차단.
 * shadowPositionLedger.getOpenPositions (5중 가드) + buildShadowPositionCardPayload
 * (source 검증 + dedupe) + validatePositionCardPayload (forbidden source 차단) wiring.
 *
 * ADR-0191 정합: AUTO_TRADE_MODE=SHADOW 시 헤더 SHADOW MODE 라벨 (페르소나 10번
 * "조건부 판단 함께 제시" UI 구현체) 보존.
 *
 * 카드 1건 포맷:
 *   🟢 종목명 D+N | +X.X%
 *      목표까지 ±Y% | 손절까지 ±Z%
 *      상태: (분할/정상/손절 접근)
 */
import { getOpenPositions, type OpenPositionEntry } from '../persistence/shadowPositionLedger.js';
import { fetchCurrentPrice } from '../clients/kisClient.js';
import { sendPrivateAlert } from './telegramClient.js';
import { channelHeader, CHANNEL_SEPARATOR } from './channelFormatter.js';
import { safePctChange } from '../utils/safePctChange.js';
import {
  buildShadowPositionCardPayload,
  validatePositionCardPayload,
} from './positionCardValidator.js';
import {
  isMorningPositionCardEnabled,
  isPositionCardEnabled,
  isSendEmptyPositionCardEnabled,
  isShadowPositionCardEnabled,
} from './positionCardEnvHelpers.js';
import type { PositionCardPosition } from './positionCardTypes.js';

// ── 카드 1건 ─────────────────────────────────────────────────────────────────

interface PositionCard {
  name: string;
  code: string;
  holdingDays: number;
  currentReturnPct: number | null;
  toTargetPct: number | null;
  toStopPct: number | null;
  status: string;
}

/**
 * 보유 포지션 enrich — currentPrice / pnlPct / target/stop 거리 계산.
 * ADR-0504: shadowPositionLedger SSOT entry → buildShadowPositionCardPayload enrich callback.
 */
async function enrichPosition(entry: OpenPositionEntry): Promise<Partial<PositionCardPosition>> {
  const trade = entry.trade;
  const code = trade.stockCode;
  const currentPriceRaw = await fetchCurrentPrice(code).catch(() => null);
  const currentPrice =
    typeof currentPriceRaw === 'number' && currentPriceRaw > 0 ? currentPriceRaw : null;

  let pnlPct: number | null = null;
  if (currentPrice && trade.shadowEntryPrice > 0) {
    pnlPct = safePctChange(currentPrice, trade.shadowEntryPrice, {
      label: `positionMorningCard:${code}`,
    });
  } else if (typeof trade.returnPct === 'number') {
    pnlPct = trade.returnPct;
  }

  return {
    currentPrice,
    avgEntryPrice: trade.shadowEntryPrice,
    pnlPct,
    entryDate: trade.signalTime,
  };
}

function computeHoldingDays(entryDate: string | null | undefined): number {
  if (!entryDate) return 0;
  const start = new Date(entryDate).getTime();
  if (!Number.isFinite(start)) return 0;
  return Math.floor((Date.now() - start) / 86_400_000);
}

function describeStatus(toStopPct: number | null): string {
  if (toStopPct !== null && toStopPct > -3 && toStopPct <= 0) {
    return '⚠️ 손절선 접근';
  }
  return '정상 추세 유지 중';
}

function renderCard(card: PositionCard): string {
  const pnl = card.currentReturnPct;
  const dot = pnl === null ? '⚪' : pnl >= 3 ? '🟢' : pnl >= -1 ? '🟡' : pnl >= -5 ? '🟠' : '🔴';
  const pnlStr = pnl === null ? 'N/A' : `${pnl >= 0 ? '+' : ''}${pnl.toFixed(1)}%`;

  const lines = [
    `${dot} <b>${card.name}</b>(${card.code}) D+${card.holdingDays} | ${pnlStr}`,
  ];

  if (card.toTargetPct !== null || card.toStopPct !== null) {
    const tgt = card.toTargetPct !== null
      ? `목표까지 ${card.toTargetPct >= 0 ? '+' : ''}${card.toTargetPct.toFixed(1)}%`
      : '목표 N/A';
    const stp = card.toStopPct !== null
      ? `손절까지 ${card.toStopPct >= 0 ? '+' : ''}${card.toStopPct.toFixed(1)}%`
      : '손절 N/A';
    lines.push(`   ${tgt} | ${stp}`);
  }

  lines.push(`   상태: ${card.status}`);
  return lines.join('\n');
}

// ── 메인 엔트리 ──────────────────────────────────────────────────────────────

/**
 * 09:05 KST — 보유 포지션 Morning Card 발송 (ADR-0504 source-validated).
 *
 * ENV 우회 4종 (default ON, ADR-0157 정확 비교):
 *   TELEGRAM_POSITION_CARD_ENABLED=false           — 모든 카드 차단
 *   TELEGRAM_SHADOW_POSITION_CARD_ENABLED=false    — Shadow 카드 차단
 *   TELEGRAM_MORNING_POSITION_CARD_ENABLED=false   — Morning Card cron 차단
 *   TELEGRAM_SEND_EMPTY_POSITION_CARD=true         — default OFF (빈 보유 시 발송 활성)
 */
export async function sendPositionMorningCard(): Promise<void> {
  try {
    // ADR-0504: ENV 3중 gate (모든 default ON)
    if (!isPositionCardEnabled()) {
      console.log('[TelegramPositionCard] skipped — TELEGRAM_POSITION_CARD_ENABLED=false');
      return;
    }
    if (!isShadowPositionCardEnabled()) {
      console.log('[TelegramPositionCard] skipped — TELEGRAM_SHADOW_POSITION_CARD_ENABLED=false');
      return;
    }
    if (!isMorningPositionCardEnabled()) {
      console.log('[TelegramPositionCard] skipped — TELEGRAM_MORNING_POSITION_CARD_ENABLED=false');
      return;
    }

    // ADR-0504: shadowPositionLedger SSOT (5중 가드 — SHADOW_NEAR_BREAKOUT 학습 entry 차단)
    const openEntries = getOpenPositions();

    // ADR-0504: 빈 보유 default 발송 생략 — 사용자 결정 (잡음 차단)
    if (openEntries.length === 0) {
      if (!isSendEmptyPositionCardEnabled()) {
        console.log('[TelegramPositionCard] skipped empty shadow positions', {
          mode: 'SHADOW',
          count: 0,
          executionImpact: 'NONE',
        });
        return;
      }

      // ENV ON 시 빈 카드 발송 (별도 dedupeKey 로 정상 카드와 분리)
      const today = new Date().toISOString().slice(0, 10);
      const isShadowMode = (process.env.AUTO_TRADE_MODE ?? 'SHADOW') === 'SHADOW';
      const showShadowHeader = isShadowMode && process.env.MORNING_CARD_SHADOW_HEADER_DISABLED !== 'true';
      const header = channelHeader({
        icon: showShadowHeader ? '🟡' : '📊',
        title: showShadowHeader ? '[SHADOW MODE] 보유 포지션 Morning Card' : '보유 포지션 Morning Card',
        suffix: '09:05 KST',
      });
      const emptyMessage =
        `${header}\n` +
        `📊 [보유 포지션 Morning Card]\n` +
        `현재 Shadow 보유 포지션 없음\n` +
        `executionImpact=NONE`;
      await sendPrivateAlert(emptyMessage, {
        priority: 'NORMAL',
        tier: 'T2_REPORT',
        category: 'position_morning_card',
        dedupeKey: `morning_card_empty:${today}`,
      });
      console.log('[TelegramPositionCard] empty card sent (TELEGRAM_SEND_EMPTY_POSITION_CARD=true)');
      return;
    }

    // ADR-0504: builder + validator (source 검증 + dedupe)
    const payload = await buildShadowPositionCardPayload({
      cardType: 'POSITION_MORNING_CARD',
      positions: openEntries,
      enrich: enrichPosition,
    });

    const validation = validatePositionCardPayload(payload);
    if (!validation.ok) {
      console.error('[TelegramPositionCard] invalid payload blocked', {
        error: validation.error,
        details: validation.details,
        mode: payload.mode,
        executionImpact: payload.executionImpact,
      });
      return;
    }

    // 카드 렌더 — payload.positions 기준 (lot-aggregate 결과)
    const cards: PositionCard[] = payload.positions.map((p) => {
      const matchingEntry = openEntries.find((e) => e.trade.stockCode === p.stockCode);
      const trade = matchingEntry?.trade;
      const targetPrice = trade?.targetPrice;
      const stopLoss = trade?.stopLoss;

      let toTargetPct: number | null = null;
      let toStopPct: number | null = null;
      if (p.currentPrice && p.currentPrice > 0) {
        if (typeof targetPrice === 'number' && targetPrice > 0) {
          toTargetPct = ((targetPrice - p.currentPrice) / p.currentPrice) * 100;
        }
        if (typeof stopLoss === 'number' && stopLoss > 0) {
          toStopPct = ((stopLoss - p.currentPrice) / p.currentPrice) * 100;
        }
      }

      return {
        name: p.stockName,
        code: p.stockCode,
        holdingDays: computeHoldingDays(p.entryDate),
        currentReturnPct: p.pnlPct ?? null,
        toTargetPct,
        toStopPct,
        status: describeStatus(toStopPct),
      };
    });

    // ADR-0191: AUTO_TRADE_MODE 가시화 — SHADOW 모드에서는 헤더에 명시.
    const isShadowMode = (process.env.AUTO_TRADE_MODE ?? 'SHADOW') === 'SHADOW';
    const showShadowHeader = isShadowMode && process.env.MORNING_CARD_SHADOW_HEADER_DISABLED !== 'true';
    const header = channelHeader({
      icon: showShadowHeader ? '🟡' : '📊',
      title: showShadowHeader ? '[SHADOW MODE] 보유 포지션 Morning Card' : '보유 포지션 Morning Card',
      suffix: '09:05 KST',
    });

    const body = cards.map(renderCard).join('\n\n');

    const message =
      `${header}\n` +
      `현재 ${payload.positions.length}개 포지션 보유 중\n\n` +
      `${body}\n${CHANNEL_SEPARATOR}\n` +
      `<i>🟢≥+3% 🟡±1% 🟠-5% 🔴-5%↓ · 손절선 3% 내 접근 시 ⚠️</i>`;

    const today = new Date().toISOString().slice(0, 10);
    // ADR-0039: 보유 종목 카드는 자산 구성 정보 — 개인 DM 만 (채널 누출 방지).
    await sendPrivateAlert(message, {
      priority: 'NORMAL',
      tier: 'T2_REPORT',
      category: 'position_morning_card',
      dedupeKey: `morning_card:${today}`,
    });

    console.log(
      `[TelegramPositionCard] ${payload.positions.length}개 포지션 카드 발송 완료 (mode=SHADOW source=SHADOW_POSITION_LEDGER executionImpact=NONE)`,
    );
  } catch (e) {
    console.error('[TelegramPositionCard] 발송 실패:', e instanceof Error ? e.message : e);
  }
}
