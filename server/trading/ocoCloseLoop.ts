// @responsibility ocoCloseLoop 매매 엔진 모듈
/**
 * ocoCloseLoop.ts — OCO 익절-손절 자동 등록 완결 루프
 *
 * 매수 체결 확인(fillMonitor) 직후:
 *   1. CCLD_TR_ID로 체결 확인
 *   2. KIS에 조건부 매도 주문 2건 동시 등록 (손절: 지정가, 익절: 지정가)
 *   3. 두 주문번호를 DB(oco-orders.json)에 저장
 *   4. 15분마다 미체결 주문 생존 확인
 *   5. 한 쪽 체결 시 다른 쪽 자동 취소
 *
 * 이 루프가 없으면 포지션이 열려도 손절 주문이 없는 "네이키드 포지션" 발생.
 */

import fs from 'fs';
import { OCO_ORDERS_FILE, ensureDataDir } from '../persistence/paths.js';
import {
  placeKisStopLossLimitOrder,
  placeKisTakeProfitLimitOrder,
  cancelKisOrder,
  kisGet,
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
import { safePctChange } from '../utils/safePctChange.js';
import { emitFullCloseAttributionForExit } from './exitEngine/helpers/attribution.js';

// ─── 데이터 모델 ──────────────────────────────────────────────────────────────

/**
 * OCO 복구 진행 상태 — ocoRecoveryAgent 가 채운다.
 * 등록 직후엔 undefined. FAILED 사이드 발견 시 처음으로 채워진다.
 */
interface OcoRecoveryState {
  /** 시도 횟수 (0..3). 3 도달 후에도 실패하면 fallback 발동. */
  attempts: number;
  /** 마지막 시도 시각 (ISO) — 다음 backoff 계산 기준. */
  lastAttemptAt?: string;
  /** 'AWAITING' | 'IN_PROGRESS' | 'RECOVERED' | 'EXHAUSTED' | 'FALLBACK_DONE' */
  status: 'AWAITING' | 'IN_PROGRESS' | 'RECOVERED' | 'EXHAUSTED' | 'FALLBACK_DONE';
  /** 마지막 시도의 실패 사유 (감사용) */
  lastError?: string;
}

export interface OcoOrderPair {
  id: string;                    // 관련 shadow trade ID
  stockCode: string;
  stockName: string;
  quantity: number;
  entryPrice: number;            // 매수 체결가
  // 손절 주문
  stopOrdNo: string | null;
  stopPrice: number;
  stopStatus: 'PENDING' | 'FILLED' | 'CANCELLED' | 'FAILED';
  // 익절 주문
  profitOrdNo: string | null;
  profitPrice: number;
  profitStatus: 'PENDING' | 'FILLED' | 'CANCELLED' | 'FAILED';
  // 메타
  createdAt: string;             // ISO
  resolvedAt?: string;           // 해소 시각 (한쪽 체결 + 다른쪽 취소 완료)
  pollCount: number;
  status: 'ACTIVE' | 'STOP_FILLED' | 'PROFIT_FILLED' | 'BOTH_CANCELLED' | 'ERROR';
  /** OCO 복구 에이전트 진행 상태 — registerOcoPair 시점엔 없음. */
  recovery?: OcoRecoveryState;
}

// ─── 영속화 헬퍼 (외부 노출) ─────────────────────────────────────────────────

/** ocoRecoveryAgent 가 import 해 사용. 동일 파일 내 loadOcoOrders 와 같은 데이터 소스. */
export function readAllOcoOrders(): OcoOrderPair[] {
  return loadOcoOrders();
}

/** ocoRecoveryAgent 가 retry 결과를 반영해 저장. */
export function writeAllOcoOrders(orders: OcoOrderPair[]): void {
  saveOcoOrders(orders);
}

// ─── 영속화 ──────────────────────────────────────────────────────────────────

function loadOcoOrders(): OcoOrderPair[] {
  ensureDataDir();
  if (!fs.existsSync(OCO_ORDERS_FILE)) return [];
  try { return JSON.parse(fs.readFileSync(OCO_ORDERS_FILE, 'utf-8')); } catch { return []; }
}

function saveOcoOrders(orders: OcoOrderPair[]): void {
  ensureDataDir();
  // ACTIVE만 선두, 해결된 것은 최근 200건 보관
  const active  = orders.filter(o => o.status === 'ACTIVE');
  const history = orders.filter(o => o.status !== 'ACTIVE').slice(-200);
  fs.writeFileSync(OCO_ORDERS_FILE, JSON.stringify([...active, ...history], null, 2));
}

// ─── OCO 주문 쌍 등록 ─────────────────────────────────────────────────────────

/**
 * 매수 체결 확인 직후 호출.
 * 손절 지정가 + 익절 지정가 2건을 동시에 KIS에 등록하고 DB에 저장한다.
 *
 * @param tradeId   관련 shadow trade ID
 * @param stockCode 종목코드
 * @param stockName 종목명
 * @param quantity  체결 수량
 * @param entryPrice 체결가
 * @param stopPrice  손절가
 * @param targetPrice 익절가
 */
export async function registerOcoPair(
  tradeId: string,
  stockCode: string,
  stockName: string,
  quantity: number,
  entryPrice: number,
  stopPrice: number,
  targetPrice: number,
): Promise<OcoOrderPair | null> {
  const orders = loadOcoOrders();

  // 중복 방지: 이미 같은 trade에 ACTIVE OCO가 있으면 스킵
  if (orders.some(o => o.id === tradeId && o.status === 'ACTIVE')) {
    console.log(`[OCO] 이미 등록됨: ${stockName} tradeId=${tradeId}`);
    return null;
  }

  console.log(`[OCO] 🔗 ${stockName}(${stockCode}) OCO 주문 쌍 등록 시작`);
  console.log(`[OCO]   손절: ${Math.floor(stopPrice).toLocaleString()}원 / 익절: ${Math.floor(targetPrice).toLocaleString()}원 × ${quantity}주`);

  // 두 주문을 동시 발행 (Promise.allSettled — 한 쪽 실패해도 다른 쪽은 등록)
  const [stopResult, profitResult] = await Promise.allSettled([
    placeKisStopLossLimitOrder(stockCode, stockName, quantity, Math.floor(stopPrice)),
    placeKisTakeProfitLimitOrder(stockCode, stockName, quantity, Math.floor(targetPrice)),
  ]);

  const stopOrdNo = stopResult.status === 'fulfilled' ? stopResult.value : null;
  const profitOrdNo = profitResult.status === 'fulfilled' ? profitResult.value : null;

  const pair: OcoOrderPair = {
    id: tradeId,
    stockCode,
    stockName,
    quantity,
    entryPrice,
    stopOrdNo,
    stopPrice: Math.floor(stopPrice),
    stopStatus: stopOrdNo ? 'PENDING' : 'FAILED',
    profitOrdNo,
    profitPrice: Math.floor(targetPrice),
    profitStatus: profitOrdNo ? 'PENDING' : 'FAILED',
    createdAt: new Date().toISOString(),
    pollCount: 0,
    status: (stopOrdNo || profitOrdNo) ? 'ACTIVE' : 'ERROR',
  };

  orders.push(pair);
  saveOcoOrders(orders);

  // 등록 결과 알림
  const stopEmoji = stopOrdNo ? '✅' : '❌';
  const profitEmoji = profitOrdNo ? '✅' : '❌';
  const msg =
    `🔗 <b>[OCO 등록 완료] ${stockName} (${stockCode})</b>\n` +
    `체결가: ${entryPrice.toLocaleString()}원 × ${quantity}주\n` +
    `─────────────────────\n` +
    `${stopEmoji} 손절: ${Math.floor(stopPrice).toLocaleString()}원 (ODNO: ${stopOrdNo ?? 'FAIL'})\n` +
    `${profitEmoji} 익절: ${Math.floor(targetPrice).toLocaleString()}원 (ODNO: ${profitOrdNo ?? 'FAIL'})`;

  await sendTelegramAlert(msg, { priority: 'HIGH' }).catch(console.error);

  if (!stopOrdNo && !profitOrdNo) {
    await sendTelegramAlert(
      `🚨 <b>[긴급] ${stockName} OCO 주문 양쪽 모두 실패!</b>\n` +
      `네이키드 포지션 — 수동 주문 즉시 등록하세요!`,
      { priority: 'CRITICAL' },
    ).catch(console.error);
  } else if (!stopOrdNo) {
    await sendTelegramAlert(
      `🚨 <b>[경고] ${stockName} 손절 주문 등록 실패!</b>\n` +
      `익절만 등록됨 — 수동 손절 주문 등록 필요`,
      { priority: 'CRITICAL' },
    ).catch(console.error);
  }

  console.log(`[OCO] 🔗 ${stockName} OCO 등록 완료: 손절=${stopOrdNo ?? 'FAIL'} 익절=${profitOrdNo ?? 'FAIL'}`);
  return pair;
}

type OcoFilledLeg = 'stop' | 'profit';
type OcoShadowTrade = ReturnType<typeof loadShadowTrades>[number];

interface OcoSurvivalState {
  stopAlive: boolean;
  profitAlive: boolean;
  stopFilled: boolean | string | null;
  profitFilled: boolean | string | null;
}

function getOcoSurvivalState(pair: OcoOrderPair, unfilledSet: Set<string>): OcoSurvivalState {
  const stopAlive = pair.stopOrdNo ? unfilledSet.has(pair.stopOrdNo) : false;
  const profitAlive = pair.profitOrdNo ? unfilledSet.has(pair.profitOrdNo) : false;
  return {
    stopAlive,
    profitAlive,
    stopFilled: pair.stopStatus === 'PENDING' && pair.stopOrdNo && !stopAlive,
    profitFilled: pair.profitStatus === 'PENDING' && pair.profitOrdNo && !profitAlive,
  };
}

async function handleBothOcoLegsMissing(pair: OcoOrderPair): Promise<void> {
  pair.stopStatus = 'FILLED';
  pair.profitStatus = 'FILLED';
  pair.status = 'STOP_FILLED';
  pair.resolvedAt = new Date().toISOString();
  console.warn(`[OCO] 🚨 ${pair.stockName} 양쪽 주문 모두 미체결 목록 소실`);
  await sendTelegramAlert(
    `🚨 <b>[OCO] ${pair.stockName} 양쪽 주문 모두 소실</b>\n` +
    `손절 ODNO=${pair.stopOrdNo} / 익절 ODNO=${pair.profitOrdNo}\n` +
    `수동 확인 필요`,
    { priority: 'CRITICAL' },
  ).catch(console.error);
}

function markOcoLegFilled(pair: OcoOrderPair, leg: OcoFilledLeg): void {
  if (leg === 'stop') {
    pair.stopStatus = 'FILLED';
    pair.status = 'STOP_FILLED';
  } else {
    pair.profitStatus = 'FILLED';
    pair.status = 'PROFIT_FILLED';
  }
  pair.resolvedAt = new Date().toISOString();
}

async function cancelOppositeOcoLeg(pair: OcoOrderPair, leg: OcoFilledLeg): Promise<void> {
  if (leg === 'stop') {
    if (pair.profitOrdNo && pair.profitStatus === 'PENDING') {
      const cancelled = await cancelKisOrder(pair.stockCode, pair.profitOrdNo, pair.quantity);
      pair.profitStatus = cancelled ? 'CANCELLED' : 'FAILED';
    }
    return;
  }

  if (pair.stopOrdNo && pair.stopStatus === 'PENDING') {
    const cancelled = await cancelKisOrder(pair.stockCode, pair.stopOrdNo, pair.quantity);
    pair.stopStatus = cancelled ? 'CANCELLED' : 'FAILED';
  }
}

function recordOcoStopFill(
  pair: OcoOrderPair,
  shadows: OcoShadowTrade[],
  shadow: OcoShadowTrade,
  fillPrice: number,
  fillQty: number,
  pnl: number,
  pnlPct: number,
): void {
  appendFill(shadow, {
    type: 'SELL', subType: 'STOP_LOSS', qty: fillQty, price: fillPrice,
    pnl, pnlPct: parseFloat(pnlPct.toFixed(4)),
    reason: 'OCO 손절 체결', exitRuleTag: 'HARD_STOP' as any,
    timestamp: pair.resolvedAt!,
    ordNo: pair.stopOrdNo ?? undefined,
  });
  const remaining = getRemainingQty(shadow);
  updateShadow(shadow, {
    status: remaining === 0 ? 'HIT_STOP' : shadow.status,
    exitPrice: fillPrice,
    exitTime: pair.resolvedAt,
    quantity: remaining,
  });
  saveShadowTrades(shadows);
  // PR-4 (ADR-0006) — LIVE OCO STOP_FILLED 전량 청산 시 FULL_CLOSE attribution.
  // baseline (shadow.entryConditionScores) 부재 시 null 반환 (학습 오염 차단).
  // try/catch 격리 — attribution 실패가 OCO 정리 흐름 차단 안 함.
  if (remaining === 0) {
    try {
      emitFullCloseAttributionForExit({
        shadow,
        exitPrice: fillPrice,
        returnPct: pnlPct,
        closedAt: pair.resolvedAt!,
        exitRuleTag: 'HARD_STOP',
      });
    } catch (e) {
      console.warn(`[ocoCloseLoop:STOP] attribution 영속 실패 ${shadow.stockCode}:`, e instanceof Error ? e.message : e);
    }
  }
  const cumPnL = (shadow.fills ?? [])
    .filter(f => f.type === 'SELL')
    .reduce((s, f) => s + (f.pnl ?? 0), 0);
  appendTradeEvent({
    positionId: shadow.id,
    ts: pair.resolvedAt!,
    type: remaining === 0 ? 'FULL_SELL' : 'PARTIAL_SELL',
    subType: 'HARD_STOP',
    quantity: fillQty,
    price: fillPrice,
    realizedPnL: pnl,
    cumRealizedPnL: cumPnL,
    remainingQty: remaining,
  });
  console.log(`[OCO] TradeEvent 발행 완료: ${shadow.stockName} HARD_STOP ${fillQty}주 @${fillPrice}`);
}

function recordOcoProfitFill(
  pair: OcoOrderPair,
  shadows: OcoShadowTrade[],
  shadow: OcoShadowTrade,
  fillPrice: number,
  fillQty: number,
  pnl: number,
  pnlPct: number,
): void {
  appendFill(shadow, {
    type: 'SELL', subType: 'FULL_CLOSE', qty: fillQty, price: fillPrice,
    pnl, pnlPct: parseFloat(pnlPct.toFixed(4)),
    reason: 'OCO 익절 체결', exitRuleTag: 'TARGET_EXIT' as any,
    timestamp: pair.resolvedAt!,
    ordNo: pair.profitOrdNo ?? undefined,
  });
  const remaining = getRemainingQty(shadow);
  updateShadow(shadow, {
    status: remaining === 0 ? 'HIT_TARGET' : shadow.status,
    exitPrice: fillPrice,
    exitTime: pair.resolvedAt,
    quantity: remaining,
  });
  saveShadowTrades(shadows);
  // PR-4 (ADR-0006) — LIVE OCO PROFIT_FILLED 전량 익절 시 FULL_CLOSE attribution.
  if (remaining === 0) {
    try {
      emitFullCloseAttributionForExit({
        shadow,
        exitPrice: fillPrice,
        returnPct: pnlPct,
        closedAt: pair.resolvedAt!,
        exitRuleTag: 'TARGET_EXIT',
      });
    } catch (e) {
      console.warn(`[ocoCloseLoop:PROFIT] attribution 영속 실패 ${shadow.stockCode}:`, e instanceof Error ? e.message : e);
    }
  }
  const cumPnL = (shadow.fills ?? [])
    .filter(f => f.type === 'SELL')
    .reduce((s, f) => s + (f.pnl ?? 0), 0);
  appendTradeEvent({
    positionId: shadow.id,
    ts: pair.resolvedAt!,
    type: remaining === 0 ? 'FULL_SELL' : 'PARTIAL_SELL',
    subType: 'FULL_CLOSE',
    quantity: fillQty,
    price: fillPrice,
    realizedPnL: pnl,
    cumRealizedPnL: cumPnL,
    remainingQty: remaining,
  });
  console.log(`[OCO] TradeEvent 발행 완료: ${shadow.stockName} FULL_CLOSE ${fillQty}주 @${fillPrice}`);
}

function recordOcoLegFill(pair: OcoOrderPair, leg: OcoFilledLeg): void {
  try {
    const shadows = loadShadowTrades();
    const shadow  = shadows.find(s => s.id === pair.id);
    if (!shadow) return;

    const isStop = leg === 'stop';
    const fillPrice = isStop ? pair.stopPrice : pair.profitPrice;
    const fillQty   = pair.quantity;
    const pnl       = (fillPrice - (shadow.shadowEntryPrice ?? pair.entryPrice)) * fillQty;
    // ADR-0059: stale shadowEntryPrice 시 0 fallback — fill.pnlPct 영속 보호.
    const pnlPct    = shadow.shadowEntryPrice
      ? (safePctChange(fillPrice, shadow.shadowEntryPrice, { label: `ocoClose:${shadow.stockCode}` }) ?? 0)
      : 0;

    if (isStop) {
      recordOcoStopFill(pair, shadows, shadow, fillPrice, fillQty, pnl, pnlPct);
    } else {
      recordOcoProfitFill(pair, shadows, shadow, fillPrice, fillQty, pnl, pnlPct);
    }
  } catch (e) {
    console.error(`[OCO] TradeEvent 발행 실패 (${leg === 'stop' ? '손절' : '익절'}):`, e);
  }
}

async function notifyOcoLegFilled(pair: OcoOrderPair, leg: OcoFilledLeg): Promise<void> {
  if (leg === 'stop') {
    await sendTelegramAlert(
      `🔴 <b>[OCO 손절 체결] ${pair.stockName} (${pair.stockCode})</b>\n` +
      `손절가: ${pair.stopPrice.toLocaleString()}원\n` +
      `익절 주문(ODNO=${pair.profitOrdNo}) 자동 취소: ${pair.profitStatus}`,
      { priority: 'HIGH' },
    ).catch(console.error);
    return;
  }

  await sendTelegramAlert(
    `🟢 <b>[OCO 익절 체결] ${pair.stockName} (${pair.stockCode})</b>\n` +
    `익절가: ${pair.profitPrice.toLocaleString()}원\n` +
    `손절 주문(ODNO=${pair.stopOrdNo}) 자동 취소: ${pair.stopStatus}`,
    { priority: 'HIGH' },
  ).catch(console.error);
}

async function handleOcoLegFilled(pair: OcoOrderPair, leg: OcoFilledLeg): Promise<void> {
  markOcoLegFilled(pair, leg);
  console.log(
    leg === 'stop'
      ? `[OCO] 🔴 ${pair.stockName} 손절 체결 확인 → 익절 주문 취소 중...`
      : `[OCO] 🟢 ${pair.stockName} 익절 체결 확인 → 손절 주문 취소 중...`,
  );
  await cancelOppositeOcoLeg(pair, leg);
  recordOcoLegFill(pair, leg);
  await notifyOcoLegFilled(pair, leg);
}

// ─── 15분 간격 생존 확인 폴링 ─────────────────────────────────────────────────

/**
 * 활성 OCO 주문 쌍의 생존 여부를 확인한다.
 * - KIS 미체결 조회(TTTC0688R)로 두 주문의 존재 확인
 * - 미체결 목록에 없으면 → 체결된 것으로 판단
 * - 한 쪽 체결 시 → 다른 쪽 자동 취소 (one-cancels-other)
 *
 * scheduler.ts에서 15분 간격 호출.
 */
export async function pollOcoSurvival(): Promise<void> {
  if (!process.env.KIS_APP_KEY || !KIS_IS_REAL) return;
  const orders = loadOcoOrders();
  const active = orders.filter(o => o.status === 'ACTIVE');
  if (active.length === 0) return;

  console.log(`[OCO] 생존 확인 폴링 — ${active.length}건`);

  // KIS 미체결 목록 조회 (HIGH 우선순위)
  const trId = KIS_IS_REAL ? 'TTTC0688R' : 'VTTC0688R';
  let unfilledData: { output?: { odno: string; tot_ccld_qty: string; ord_qty: string }[] } | null = null;
  try {
    unfilledData = await kisGet(trId, '/uapi/domestic-stock/v1/trading/inquire-psbl-rvsecncl', {
      CANO: process.env.KIS_ACCOUNT_NO ?? '',
      ACNT_PRDT_CD: process.env.KIS_ACCOUNT_PROD ?? '01',
      CTX_AREA_FK100: '', CTX_AREA_NK100: '',
      INQR_DVSN_1: '0', INQR_DVSN_2: '0',
    }, 'HIGH');
  } catch (e) {
    console.error('[OCO] 미체결 조회 실패:', e instanceof Error ? e.message : e);
    return;
  }

  const unfilledSet = new Set((unfilledData?.output ?? []).map(o => o.odno));
  let changed = false;

  for (const pair of active) {
    pair.pollCount++;

    const { stopFilled, profitFilled } = getOcoSurvivalState(pair, unfilledSet);

    if (stopFilled && profitFilled) {
      await handleBothOcoLegsMissing(pair);
      changed = true;
      continue;
    }

    if (stopFilled) {
      await handleOcoLegFilled(pair, 'stop');
      changed = true;
      continue;
    }

    if (profitFilled) {
      await handleOcoLegFilled(pair, 'profit');
      changed = true;
      continue;
    }

    // 양쪽 모두 미체결 유지
    console.log(
      `[OCO] ${pair.stockName} 양쪽 미체결 유지 (poll ${pair.pollCount}) ` +
      `손절=${pair.stopOrdNo} 익절=${pair.profitOrdNo}`,
    );
  }

  if (changed) saveOcoOrders(orders);
}

// ─── 장 마감 시 미해결 OCO 정리 ──────────────────────────────────────────────

/**
 * 장 마감(15:20 KST) 시 아직 ACTIVE인 OCO 쌍의 양쪽 주문을 모두 취소한다.
 * 다음 날 장 시작 시 exitEngine이 다시 가격을 모니터링하므로 안전.
 */
export async function cancelAllActiveOco(): Promise<void> {
  if (!KIS_IS_REAL) return;
  const orders = loadOcoOrders();
  const active = orders.filter(o => o.status === 'ACTIVE');
  if (active.length === 0) return;

  console.log(`[OCO] 장 마감 전 ACTIVE OCO ${active.length}건 전량 취소`);

  // 한쪽 취소라도 실패 시 상태를 FAILED 로 남겨 다음 사이클에서 재시도 가능케 한다.
  const tryCancel = async (stockCode: string, ordNo: string, qty: number): Promise<boolean> => {
    try {
      await cancelKisOrder(stockCode, ordNo, qty);
      return true;
    } catch (e) {
      console.error(`[OCO] 취소 실패 ${stockCode} ord=${ordNo}:`, e instanceof Error ? e.message : e);
      return false;
    }
  };

  let allResolved = true;
  for (const pair of active) {
    let stopOk = true;
    let profitOk = true;
    if (pair.stopOrdNo && pair.stopStatus === 'PENDING') {
      stopOk = await tryCancel(pair.stockCode, pair.stopOrdNo, pair.quantity);
      pair.stopStatus = stopOk ? 'CANCELLED' : 'FAILED';
    }
    if (pair.profitOrdNo && pair.profitStatus === 'PENDING') {
      profitOk = await tryCancel(pair.stockCode, pair.profitOrdNo, pair.quantity);
      pair.profitStatus = profitOk ? 'CANCELLED' : 'FAILED';
    }
    if (stopOk && profitOk) {
      pair.status = 'BOTH_CANCELLED';
      pair.resolvedAt = new Date().toISOString();
    } else {
      pair.status = 'ERROR';
      allResolved = false;
    }
  }

  saveOcoOrders(orders);
  const summary = allResolved
    ? `🔔 <b>[OCO 장마감 정리]</b> ${active.length}건 OCO 주문 전량 취소`
    : `⚠️ <b>[OCO 장마감 정리]</b> ${active.length}건 중 일부 취소 실패 — 재시도 필요`;
  await sendTelegramAlert(summary).catch(console.error);
}

// ─── 진단용 조회 ──────────────────────────────────────────────────────────────

export function getActiveOcoOrders(): OcoOrderPair[] {
  return loadOcoOrders().filter(o => o.status === 'ACTIVE');
}

export function getAllOcoOrders(): OcoOrderPair[] {
  return loadOcoOrders();
}
