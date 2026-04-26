// @responsibility ocoConfirmLoop 매매 엔진 모듈
/**
 * ocoConfirmLoop.ts — OCO 체결 "확정" 폐쇄 루프 (30초 주기 / CCLD 기반).
 *
 * **기존 `ocoCloseLoop.pollOcoSurvival()` 와의 역할 분담:**
 *   - pollOcoSurvival: 15분 주기, TTTC0688R(미체결 목록)로 "부재"를 통해 체결 감지.
 *     체결과 실제 UI 반영 사이 최대 15분 공백 — 다음 매수 예산 잠식 치명 리스크.
 *   - pollOcoConfirm (이 파일): 30초 주기, CCLD_TR_ID(체결 조회)로 체결을 "직접" 확인.
 *     체결 감지 즉시 반대 주문 취소 → 네이키드 포지션 창을 30초로 축소.
 *
 * 두 루프는 같은 `oco-orders.json` DB 를 공유한다. 15분 루프는 안전망, 30초
 * 루프는 주 동기화 채널. 중복 체결 처리 방지를 위해 status 전이는 원자적.
 *
 * 페르소나 원칙 8 — "손절은 운영 비용" — 을 확장한 설계. 반대 주문 취소 실패는
 * Telegram CRITICAL 알림으로 에스컬레이션하여 운영자가 즉시 개입 가능하게 한다.
 */

import fs from 'fs';
import { OCO_ORDERS_FILE, ensureDataDir } from '../persistence/paths.js';
import {
  cancelKisOrder,
  kisGet,
  CCLD_TR_ID,
  KIS_IS_REAL,
} from '../clients/kisClient.js';
import { sendTelegramAlert } from '../alerts/telegramClient.js';
import {
  loadShadowTrades,
  saveShadowTrades,
  appendFill,
  getRemainingQty,
  updateShadow,
} from '../persistence/shadowTradeRepo.js';
import { appendTradeEvent } from './tradeEventLog.js';
import type { OcoOrderPair } from './ocoCloseLoop.js';
import { touchHeartbeat } from '../state.js';
import { incrementOcoCancelFail, resetOcoCancelFail } from './killSwitch.js';
import { safePctChange } from '../utils/safePctChange.js';

// ─── 영속화 (ocoCloseLoop 와 동일 스키마 공유) ────────────────────────────────

function loadOcoOrders(): OcoOrderPair[] {
  ensureDataDir();
  if (!fs.existsSync(OCO_ORDERS_FILE)) return [];
  try { return JSON.parse(fs.readFileSync(OCO_ORDERS_FILE, 'utf-8')); } catch { return []; }
}

function saveOcoOrders(orders: OcoOrderPair[]): void {
  ensureDataDir();
  const active  = orders.filter(o => o.status === 'ACTIVE');
  const history = orders.filter(o => o.status !== 'ACTIVE').slice(-200);
  fs.writeFileSync(OCO_ORDERS_FILE, JSON.stringify([...active, ...history], null, 2));
}

// ─── CCLD 체결 조회 ─────────────────────────────────────────────────────────
// KIS 국내주식 체결 조회 API (/uapi/domestic-stock/v1/trading/inquire-daily-ccld)
// 응답 output[]: { odno, ord_qty, tot_ccld_qty, avg_prvs, ord_dvsn, ... }
// "금일" 체결만 조회되는 경량 호출 — 부하 작음.

interface KisFillRow {
  odno: string;              // 주문번호
  ord_qty: string;           // 주문 수량
  tot_ccld_qty: string;      // 총 체결 수량
  avg_prvs?: string;         // 평균 체결가
  ord_dvsn?: string;
  [k: string]: unknown;
}

async function fetchTodayFills(): Promise<KisFillRow[]> {
  const today = new Date();
  const yyyymmdd = `${today.getFullYear()}${String(today.getMonth() + 1).padStart(2, '0')}${String(today.getDate()).padStart(2, '0')}`;
  const raw = await kisGet(
    CCLD_TR_ID,
    '/uapi/domestic-stock/v1/trading/inquire-daily-ccld',
    {
      CANO: process.env.KIS_ACCOUNT_NO ?? '',
      ACNT_PRDT_CD: process.env.KIS_ACCOUNT_PROD ?? '01',
      INQR_STRT_DT: yyyymmdd,
      INQR_END_DT: yyyymmdd,
      SLL_BUY_DVSN_CD: '00', // 00=전체
      INQR_DVSN: '00',
      PDNO: '',
      CCLD_DVSN: '01',       // 01=체결
      ORD_GNO_BRNO: '',
      ODNO: '',
      INQR_DVSN_3: '00',
      INQR_DVSN_1: '',
      CTX_AREA_FK100: '',
      CTX_AREA_NK100: '',
    },
    'HIGH',
  );
  const data = raw as { output1?: KisFillRow[]; output?: KisFillRow[] } | null | undefined;
  return data?.output1 ?? data?.output ?? [];
}

// ─── OCO 체결 즉시 반영 + 반대 주문 취소 ──────────────────────────────────────

type LegKind = 'stop' | 'profit';

/** 체결이 확인된 한쪽 레그의 상태 전이 + 반대쪽 취소 처리. */
async function resolveFilledLeg(
  pair: OcoOrderPair,
  legKind: LegKind,
  filledQty: number,
): Promise<void> {
  const nowIso = new Date().toISOString();
  const isStop = legKind === 'stop';

  if (isStop) {
    pair.stopStatus = 'FILLED';
    pair.status = 'STOP_FILLED';
  } else {
    pair.profitStatus = 'FILLED';
    pair.status = 'PROFIT_FILLED';
  }
  pair.resolvedAt = nowIso;

  // 반대 주문 취소 — 실패해도 상태는 남기되 운영자 알림으로 에스컬레이션.
  const oppositeOrdNo = isStop ? pair.profitOrdNo : pair.stopOrdNo;
  const oppositePendingField: 'profitStatus' | 'stopStatus' = isStop
    ? 'profitStatus'
    : 'stopStatus';

  if (oppositeOrdNo && pair[oppositePendingField] === 'PENDING') {
    const cancelled = await cancelKisOrder(pair.stockCode, oppositeOrdNo, pair.quantity)
      .catch(() => false);
    pair[oppositePendingField] = cancelled ? 'CANCELLED' : 'FAILED';

    if (cancelled) {
      resetOcoCancelFail();
    } else {
      incrementOcoCancelFail();
      await sendTelegramAlert(
        `🚨 <b>[OCO] ${pair.stockName} 반대 주문 취소 실패</b>\n` +
        `${isStop ? '익절' : '손절'} 주문번호=${oppositeOrdNo}\n` +
        `네이키드 혹은 중복 체결 리스크 — 수동 확인 필요`,
        { priority: 'CRITICAL', dedupeKey: `oco-cancel-fail:${pair.id}` },
      ).catch(console.error);
    }
  }

  // TradeEvent + shadowTrade 업데이트 ─────────────────────────────────────
  try {
    const shadows = loadShadowTrades();
    const shadow  = shadows.find(s => s.id === pair.id);
    if (shadow) {
      const fillPrice = isStop ? pair.stopPrice : pair.profitPrice;
      const fillQty   = Math.max(1, filledQty || pair.quantity);
      const basis     = shadow.shadowEntryPrice ?? pair.entryPrice;
      const pnl       = (fillPrice - basis) * fillQty;
      // ADR-0049: stale basis 시 0 fallback — fill.pnlPct 영속화 입력 보호.
      const pnlPct    = basis ? (safePctChange(fillPrice, basis, { label: `ocoConfirm:${shadow.stockCode}` }) ?? 0) : 0;

      appendFill(shadow, {
        type: 'SELL',
        subType: isStop ? 'STOP_LOSS' : 'FULL_CLOSE',
        qty: fillQty,
        price: fillPrice,
        pnl,
        pnlPct: parseFloat(pnlPct.toFixed(4)),
        reason: isStop ? 'OCO 손절 확정 (CCLD 30s)' : 'OCO 익절 확정 (CCLD 30s)',
        exitRuleTag: isStop ? ('HARD_STOP' as any) : ('TARGET_EXIT' as any),
        timestamp: nowIso,
        ordNo: (isStop ? pair.stopOrdNo : pair.profitOrdNo) ?? undefined,
      });
      const remaining = getRemainingQty(shadow);
      updateShadow(shadow, {
        status: remaining === 0 ? (isStop ? 'HIT_STOP' : 'HIT_TARGET') : shadow.status,
        exitPrice: fillPrice,
        exitTime: nowIso,
        quantity: remaining,
      });
      saveShadowTrades(shadows);
      const cumPnL = (shadow.fills ?? [])
        .filter(f => f.type === 'SELL')
        .reduce((s, f) => s + (f.pnl ?? 0), 0);
      appendTradeEvent({
        positionId: shadow.id,
        ts: nowIso,
        type: remaining === 0 ? 'FULL_SELL' : 'PARTIAL_SELL',
        subType: isStop ? 'HARD_STOP' : 'FULL_CLOSE',
        quantity: fillQty,
        price: fillPrice,
        realizedPnL: pnl,
        cumRealizedPnL: cumPnL,
        remainingQty: remaining,
      });
    }
  } catch (e) {
    console.error('[OCO-CCLD] TradeEvent 발행 실패:', e);
  }

  await sendTelegramAlert(
    `${isStop ? '🔴' : '🟢'} <b>[OCO ${isStop ? '손절' : '익절'} 체결 확정]</b> ${pair.stockName}\n` +
    `${isStop ? '손절가' : '익절가'}: ${(isStop ? pair.stopPrice : pair.profitPrice).toLocaleString()}원\n` +
    `반대 주문 상태: ${isStop ? pair.profitStatus : pair.stopStatus}\n` +
    `<i>(CCLD 30s 루프)</i>`,
    { priority: 'HIGH', dedupeKey: `oco-confirm:${pair.id}:${legKind}` },
  ).catch(console.error);
}

// ─── 메인 폴링 함수 (scheduler 에서 30초 주기로 호출) ─────────────────────────

/**
 * 활성 OCO 주문 쌍을 CCLD 체결 조회로 확인한다.
 * 한쪽 체결 감지 시 반대쪽을 즉시 취소하고 DB 반영.
 *
 * 이 함수는 KIS 레이트 리미터 제약 하에 한 tick 당 1회 CCLD 호출만 수행한다
 * (모든 활성 OCO 를 한 번의 today-fills 조회로 매칭).
 */
export async function pollOcoConfirm(): Promise<void> {
  if (!process.env.KIS_APP_KEY || !KIS_IS_REAL) return;

  const orders = loadOcoOrders();
  const active = orders.filter(o => o.status === 'ACTIVE');
  if (active.length === 0) {
    touchHeartbeat('oco-confirm');
    return;
  }

  let fills: KisFillRow[];
  try {
    fills = await fetchTodayFills();
  } catch (e) {
    console.error('[OCO-CCLD] 체결 조회 실패:', e instanceof Error ? e.message : e);
    return; // 다음 tick 에서 재시도 — heartbeat 은 갱신 안 함 (장애 반영)
  }

  touchHeartbeat('oco-confirm');

  // odno → 총체결수량 인덱스 (빠른 매칭용)
  const fillByOdno = new Map<string, number>();
  for (const row of fills) {
    const qty = Number(row.tot_ccld_qty ?? 0);
    if (qty > 0) fillByOdno.set(String(row.odno ?? ''), qty);
  }

  let changed = false;
  for (const pair of active) {
    pair.pollCount = (pair.pollCount ?? 0) + 1;

    const stopFilledQty = pair.stopOrdNo ? (fillByOdno.get(pair.stopOrdNo) ?? 0) : 0;
    const profitFilledQty = pair.profitOrdNo ? (fillByOdno.get(pair.profitOrdNo) ?? 0) : 0;

    const stopDidFill = pair.stopStatus === 'PENDING' && stopFilledQty > 0;
    const profitDidFill = pair.profitStatus === 'PENDING' && profitFilledQty > 0;

    // 이상 케이스: 양쪽 모두 체결 (KIS 경쟁 조건). 먼저 도착한 쪽을 우선으로.
    if (stopDidFill && profitDidFill) {
      console.warn(`[OCO-CCLD] ⚠️ ${pair.stockName} 양쪽 체결 감지 — 손절 우선 처리`);
      await resolveFilledLeg(pair, 'stop', stopFilledQty);
      pair.profitStatus = 'FILLED'; // 정보 손실 방지 — 두 쪽 모두 FILLED 기록
      changed = true;
      continue;
    }

    if (stopDidFill) {
      await resolveFilledLeg(pair, 'stop', stopFilledQty);
      changed = true;
      continue;
    }

    if (profitDidFill) {
      await resolveFilledLeg(pair, 'profit', profitFilledQty);
      changed = true;
      continue;
    }
  }

  if (changed) saveOcoOrders(orders);
}
