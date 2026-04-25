/**
 * exitEngine.ts — 포지션 모니터링 및 청산 엔진
 *
 * signalScanner.ts 에서 분리된 진행 중 Shadow 거래 결과 업데이트 로직.
 * 청산 규칙 우선순위는 entryEngine.ts 의 EXIT_RULE_PRIORITY_TABLE 과 일치해야 한다.
 */

import {
  fetchCurrentPrice, placeKisSellOrder,
  type SellOrderResult, type SellOrderOutcome,
} from '../clients/kisClient.js';
import { addSellOrder } from './fillMonitor.js';
import { matchExitInvalidation, promoteInvalidationPatternIfRepeated } from './preMortemStructured.js';
import { promoteKellyDriftPattern } from '../learning/kellyDriftFailurePromotion.js';
import { captureSnapshotsForOpenTrades } from '../learning/coldstartBootstrap.js';
import { getRealtimePrice } from '../clients/kisStreamClient.js';
import { sendTelegramAlert } from '../alerts/telegramClient.js';
import { channelSellSignal } from '../alerts/channelPipeline.js';
import { sendStopLossTransparencyReport } from '../alerts/stopLossTransparencyReport.js';
import {
  type ServerShadowTrade,
  appendShadowLog,
  appendFill,
  syncPositionCache,
  updateShadow,
  getRemainingQty,
  getTotalRealizedPnl,
  backfillShadowBuyFills,
} from '../persistence/shadowTradeRepo.js';
import { appendTradeEvent, type TradeEvent } from './tradeEventLog.js';
import { emitPartialAttribution } from '../persistence/attributionRepo.js';
import { addToBlacklist } from '../persistence/blacklistRepo.js';
import { checkEuphoria } from './riskManager.js';
import { regimeToStopRegime } from './entryEngine.js';
import { evaluateDynamicStop } from '../../src/services/quant/dynamicStopEngine.js';
import { fetchCloses } from './marketDataRefresh.js';
import type { RegimeLevel } from '../../src/types/core.js';
import type { PositionFill } from '../persistence/shadowTradeRepo.js';
import { learningOrchestrator } from '../orchestrator/learningOrchestrator.js';
import { requestImmediateRescan } from '../orchestrator/adaptiveScanScheduler.js';

// ─── PR-42 M1 — emitPartialAttributionForSell 분리 (테스트 가능 helper) ──────
//
// 부분매도 SELL fill 1건이 reserveSell 에서 CONFIRMED 로 기록될 때 PR-19
// attribution(qtyRatio 가중) 을 자동 emit 한다. 학습 baseline 이 없으면
// emitPartialAttribution 자체가 null 반환 → 학습 오염 차단.
//
// 호출 조건(reserveSell 가 enforce):
//   - isShadow=true (SHADOW 즉시 CONFIRMED 만, LIVE PROVISIONAL 은 후속 PR)
//   - remainingQty > 0 (전량 청산은 FULL_CLOSE 경로에서 별도 처리)
//   - fill.qty > 0
export interface EmitPartialAttributionInputForSell {
  shadow: ServerShadowTrade;
  fill: SellFillInput;
  remainingQty: number;
  newFillId: string | undefined;
  now: string;
}

export function emitPartialAttributionForSell(
  input: EmitPartialAttributionInputForSell,
): ReturnType<typeof emitPartialAttribution> {
  const { shadow, fill, remainingQty, newFillId, now } = input;
  if (remainingQty <= 0 || fill.qty <= 0 || !newFillId) return null;

  const baseQty = shadow.originalQuantity && shadow.originalQuantity > 0
    ? shadow.originalQuantity
    : fill.qty + remainingQty;
  if (baseQty <= 0) return null;

  const closedAt = fill.timestamp ?? now;
  const signalMs = new Date(shadow.signalTime).getTime();
  const closedMs = new Date(closedAt).getTime();
  const holdingDays = Number.isFinite(signalMs) && Number.isFinite(closedMs)
    ? Math.max(0, Math.floor((closedMs - signalMs) / 86_400_000))
    : 0;

  return emitPartialAttribution({
    tradeId:     shadow.id ?? shadow.stockCode,
    fillId:      newFillId,
    stockCode:   shadow.stockCode,
    stockName:   shadow.stockName,
    closedAt,
    returnPct:   fill.pnlPct ?? 0,
    qtyRatio:    fill.qty / baseQty,
    holdingDays,
    entryRegime: shadow.entryRegime,
    sellReason:  fill.reason ?? undefined,
  });
}

// ─── reserveSell 헬퍼 — "주문 접수 ≠ 체결" 원칙을 강제한다 ─────────────────────
//
// 과거 recordSell 은 KIS 주문 접수 직후(체결 확인 前) 의도 수량 그대로 Fill 을
// 선반영했다. 이 방식은 세 가지 실패 경로를 구분하지 못했다:
//   1) SHADOW 모드 — 실주문 없음인데 "체결"로 기록되어 KIS 잔고와 Shadow DB 괴리.
//   2) LIVE 주문 접수 실패 — ODNO 미발급인데 Fill 이 남아 수량·손익 왜곡.
//   3) LIVE 접수 성공 후 미체결/재발행 실패 — PROVISIONAL 상태 표기 없이 확정.
//
// reserveSell 은 SellOrderResult.outcome 으로 세 경로를 명시적으로 분기한다:
//   · SHADOW_ONLY  → Fill 즉시 CONFIRMED (가상 체결)
//   · LIVE_ORDERED → Fill PROVISIONAL + ordNo 보존 (pollSellFills 가 CONFIRM 또는 REVERT)
//   · LIVE_FAILED  → Fill 기록 스킵 + 호출측이 중복 방지 플래그를 롤백
//
// Telegram 메시지는 3-상태 접두어를 붙여 운영자가 실주문 여부를 즉시 구분하도록 한다.

export type ReserveSellResult =
  | { kind: 'SHADOW';  recorded: true;  remainingQty: number; statusPrefix: string; statusSuffix: string }
  | { kind: 'PENDING'; recorded: true;  remainingQty: number; statusPrefix: string; statusSuffix: string; ordNo: string }
  | { kind: 'FAILED';  recorded: false; remainingQty: number; statusPrefix: string; statusSuffix: string; reason: string };

/** PositionFill 중에서 reserveSell 이 내부적으로 채우는 필드는 입력에서 제외한다. */
type SellFillInput = Omit<PositionFill, 'id' | 'ordNo' | 'status' | 'confirmedAt' | 'revertedAt' | 'revertReason' | 'flagToClearOnRevert'>;

// ─── BUG #7 — 전량 청산 실패 시 상태 롤백 헬퍼 ─────────────────────────────────
//
// 기존 HARD_STOP / CASCADE_FINAL / TRAILING_PROTECTIVE / TARGET_EXIT / MA60_DEATH
// 경로는 `updateShadow({status:'HIT_STOP'|'HIT_TARGET', quantity:0, …})` 를 주문
// 접수 전에 실행해, 주문 접수 실패 시 "shadow DB = CLOSED, KIS 잔고 = OPEN" 의
// 괴리가 발생했다 (naked position). 아래 두 함수로:
//   1) updateShadow 전에 직전 상태 스냅샷을 캡처
//   2) reserveSell.kind==='FAILED' 이면 상태를 되돌려 다음 스캔 사이클에서 규칙을 재평가
//
// 롤백 대상: status, quantity, exitPrice, exitTime, exitRuleTag, stopLossExitType,
// ma60DeathForced. 이 필드들은 각 청산 분기에서 일관되게 변경되므로 스냅샷 1개로 충분.

interface FullCloseSnapshot {
  status: ServerShadowTrade['status'];
  quantity: number;
  exitPrice?: number;
  exitTime?: string;
  exitRuleTag?: ServerShadowTrade['exitRuleTag'];
  stopLossExitType?: ServerShadowTrade['stopLossExitType'];
  ma60DeathForced?: boolean;
}

function captureFullCloseSnapshot(shadow: ServerShadowTrade): FullCloseSnapshot {
  return {
    status: shadow.status,
    quantity: shadow.quantity,
    exitPrice: shadow.exitPrice,
    exitTime: shadow.exitTime,
    exitRuleTag: shadow.exitRuleTag,
    stopLossExitType: shadow.stopLossExitType,
    ma60DeathForced: shadow.ma60DeathForced,
  };
}

/**
 * 전량 청산 주문 실패 시 shadow 상태를 스냅샷 시점으로 되돌린다. 상태가 ACTIVE 등으로
 * 복원되면 다음 scan tick 에서 동일 exit 규칙이 재평가되어 자동 재시도가 된다.
 *
 * 본 함수는 "주문 실패 = 상태 변경 없음" 원칙을 exit 레이어에 강제한다.
 * CRITICAL 텔레그램 경보는 각 호출부가 기존 메시지 체계를 유지하고 본 함수는
 * 결과 로그 + ShadowLog audit 만 담당한다.
 */
function rollbackFullCloseOnFailure(
  shadow: ServerShadowTrade,
  snap: FullCloseSnapshot,
  ruleName: string,
  failureReason: string,
): void {
  updateShadow(shadow, {
    status: snap.status,
    quantity: snap.quantity,
    exitPrice: snap.exitPrice,
    exitTime: snap.exitTime,
    exitRuleTag: snap.exitRuleTag,
    stopLossExitType: snap.stopLossExitType,
    ma60DeathForced: snap.ma60DeathForced,
  });
  appendShadowLog({
    event: 'FULL_CLOSE_ROLLBACK',
    code: shadow.stockCode,
    rule: ruleName,
    reason: failureReason,
    restoredStatus: snap.status,
    restoredQty: snap.quantity,
  });
  console.error(
    `[AutoTrade] 🚨 ${shadow.stockName} ${ruleName} 주문 실패 → shadow 상태 롤백 ` +
    `(status=${snap.status}, qty=${snap.quantity}) · 다음 스캔에서 자동 재시도`,
  );
}

/**
 * 매도 Fill 을 세 가지 상태 중 하나로 안전하게 기록한다.
 * Fill SSOT (fills 배열) 에 PROVISIONAL/CONFIRMED/REVERTED 라벨을 부여하여
 * "주문 접수 ≠ 체결" 원칙을 회계 레벨에서 강제한다.
 *
 * @param flagToClearOnRevert  fill 이 REVERTED 로 전환될 때 초기화할 중복 방지 플래그.
 *                              DIVERGENCE/RRR/R6 같은 1회성 경로에서 설정.
 */
function reserveSell(
  shadow: ServerShadowTrade,
  orderRes: SellOrderResult,
  fill: SellFillInput,
  evtSubType: TradeEvent['subType'],
  flagToClearOnRevert?: PositionFill['flagToClearOnRevert'],
): ReserveSellResult {
  if (orderRes.outcome === 'LIVE_FAILED') {
    // 실주문 접수 실패 — Fill 기록 스킵. 호출측이 중복 방지 플래그/상태를 롤백한다.
    return {
      kind: 'FAILED',
      recorded: false,
      remainingQty: getRemainingQty(shadow),
      statusPrefix: '❌ [주문 실패]',
      statusSuffix: `\n🚨 실주문 접수 실패 — ${orderRes.failureReason ?? 'unknown'}. 수동 매도/재시도 필요.`,
      reason: orderRes.failureReason ?? 'unknown',
    };
  }

  const isShadow = orderRes.outcome === 'SHADOW_ONLY';
  const nowIso = new Date().toISOString();

  const fullFill: Omit<PositionFill, 'id'> = {
    ...fill,
    ordNo: isShadow ? undefined : orderRes.ordNo ?? undefined,
    status: isShadow ? 'CONFIRMED' : 'PROVISIONAL',
    confirmedAt: isShadow ? nowIso : undefined,
    flagToClearOnRevert,
  };
  appendFill(shadow, fullFill);
  // ⚡ Fill 추가 직후 캐시 동기화 — SSOT(fills) 와 파생 필드(quantity) 불일치 방지.
  // 호출측에서 syncPositionCache 를 잊는 경로가 있었고(RRR/Tranche 등 일부),
  // 그 결과 fills 엔 SELL 이 들어갔는데 trade.quantity 는 그대로 유지되어
  // /pos · /pnl · 후속 exitEngine 루프가 잔량을 과대 평가하는 버그를 유발했다.
  // 이 위치에서 보장하면 모든 매도 경로(SHADOW·LIVE_ORDERED·향후 신규)가
  // fills 추가와 동시에 quantity·originalQuantity 캐시도 정합 상태가 된다.
  syncPositionCache(shadow);
  const remainingQty    = getRemainingQty(shadow);
  const cumRealizedPnL  = getTotalRealizedPnl(shadow);
  appendTradeEvent({
    positionId:    shadow.id ?? shadow.stockCode,
    ts:            fill.timestamp,
    type:          remainingQty === 0 ? 'FULL_SELL' : 'PARTIAL_SELL',
    subType:       evtSubType,
    quantity:      fill.qty,
    price:         fill.price,
    realizedPnL:   fill.pnl ?? 0,
    cumRealizedPnL,
    remainingQty,
  });
  // PR-42 M1 — 부분매도 시 PR-19(ADR-0006) attribution 자동 기록.
  // 조건: SHADOW(CONFIRMED 즉시) + 잔량 > 0 + originalQuantity 확정.
  // baseline conditionScores 가 없으면 emitPartialAttribution 가 null 을 반환해
  // 학습 오염을 차단한다. LIVE PROVISIONAL fill 은 reserveSell 에서 emit 하지
  // 않고 fillMonitor 의 confirm 시점 wiring 을 후속 PR 로 분리한다.
  if (isShadow) {
    const lastFill = shadow.fills?.[shadow.fills.length - 1];
    emitPartialAttributionForSell({
      shadow,
      fill,
      remainingQty,
      newFillId: lastFill?.id,
      now: nowIso,
    });
  }

  if (isShadow) {
    return {
      kind: 'SHADOW',
      recorded: true,
      remainingQty,
      statusPrefix: '🎭 [SHADOW 가상 체결]',
      statusSuffix: '\n⚠️ 실주문 없음 · KIS 잔고 불변 (Shadow 모드)',
    };
  }
  return {
    kind: 'PENDING',
    recorded: true,
    remainingQty,
    statusPrefix: '⏳ [체결 대기]',
    statusSuffix: `\n⏳ 주문 접수됨 (ODNO ${orderRes.ordNo}) — CCLD 확인 후 최종 확정`,
    ordNo: orderRes.ordNo as string,
  };
}


/**
 * 하락 다이버전스 감지 — 주가 신고가 갱신 + RSI 고점 낮아짐.
 * 최근 5일/이전 5일 두 구간을 비교해 가짜 돌파·상투를 조기 포착.
 *
 * @param prices 최근 N(≥10)일 종가 배열
 * @param rsi    prices와 정렬된 N일 RSI 배열
 */
export function detectBearishDivergence(prices: number[], rsi: number[]): boolean {
  if (prices.length < 10 || rsi.length < 10) return false;
  const recentHigh = Math.max(...prices.slice(-5));
  const prevHigh   = Math.max(...prices.slice(-10, -5));
  const recentRSI  = Math.max(...rsi.slice(-5));
  const prevRSI    = Math.max(...rsi.slice(-10, -5));
  // 주가 신고가 갱신 + RSI 고점 낮아짐 → 하락 다이버전스
  return recentHigh > prevHigh && recentRSI < prevRSI;
}

/**
 * 60일선 "죽음" 판정 — 현재가 < MA20 < MA60 (역배열 완성).
 * "주도주 사이클 종료" 신호로, 좀비 포지션을 장기 보유하지 않기 위한 강제 청산 트리거.
 *
 * @returns 역배열 완성 시 true
 */
export function isMA60Death(ma20: number, ma60: number, currentPrice: number): boolean {
  return currentPrice < ma20 && ma20 < ma60;
}

/** 단순이동평균. closes.length < period 이면 null. */
function simpleMA(closes: number[], period: number): number | null {
  if (closes.length < period) return null;
  const slice = closes.slice(-period);
  return slice.reduce((s, v) => s + v, 0) / period;
}

/** KST 기준 N영업일(토·일 제외) 이후의 날짜 YYYY-MM-DD 반환. */
export function kstBusinessDateStr(offsetBusinessDays: number): string {
  const KST_OFFSET_MS = 9 * 60 * 60 * 1000;
  let daysLeft = offsetBusinessDays;
  let cursor = new Date(Date.now() + KST_OFFSET_MS);
  while (daysLeft > 0) {
    cursor = new Date(cursor.getTime() + 86_400_000);
    const dow = cursor.getUTCDay(); // KST offset 이미 반영됨
    if (dow !== 0 && dow !== 6) daysLeft -= 1;
  }
  return cursor.toISOString().slice(0, 10);
}

/** stockCode → MA20·MA60 계산에 충분한 120일 종가 조회 후 (ma20, ma60) 반환. */
async function fetchMaFromCloses(stockCode: string): Promise<{ ma20: number; ma60: number } | null> {
  for (const sym of yahooSymbolCandidates(stockCode)) {
    const closes = await fetchCloses(sym, '120d').catch(() => null);
    if (!closes || closes.length < 60) continue;
    const ma20 = simpleMA(closes, 20);
    const ma60 = simpleMA(closes, 60);
    if (ma20 !== null && ma60 !== null) return { ma20, ma60 };
  }
  return null;
}

/** Wilder 평활화 RSI 시계열 반환. period+1 미만이면 빈 배열. */
function rsiSeries(closes: number[], period: number = 14): number[] {
  if (closes.length < period + 1) return [];
  const deltas: number[] = [];
  for (let i = 1; i < closes.length; i++) deltas.push(closes[i] - closes[i - 1]);
  let avgGain = deltas.slice(0, period).filter(d => d > 0).reduce((s, d) => s + d, 0) / period;
  let avgLoss = deltas.slice(0, period).filter(d => d < 0).reduce((s, d) => s - d, 0) / period;
  const out: number[] = [];
  const rsiAt = (g: number, l: number) => l === 0 ? 100 : 100 - 100 / (1 + g / l);
  out.push(rsiAt(avgGain, avgLoss));
  for (let i = period; i < deltas.length; i++) {
    const gain = deltas[i] > 0 ? deltas[i] : 0;
    const loss = deltas[i] < 0 ? -deltas[i] : 0;
    avgGain = (avgGain * (period - 1) + gain) / period;
    avgLoss = (avgLoss * (period - 1) + loss) / period;
    out.push(rsiAt(avgGain, avgLoss));
  }
  return out;
}

/** stockCode → Yahoo Finance 심볼 후보 배열. */
function yahooSymbolCandidates(stockCode: string): string[] {
  const c = stockCode.padStart(6, '0');
  return [`${c}.KS`, `${c}.KQ`];
}

/** 최근 N일 종가와 그에 정렬된 RSI 시계열을 반환. 실패 시 null. */
async function fetchPriceAndRsiHistory(
  stockCode: string,
  bars: number = 10,
): Promise<{ prices: number[]; rsi: number[] } | null> {
  // RSI 14 Wilder 평활화를 안정화하려면 최소 14 + bars 관측이 필요.
  const minNeeded = 14 + bars;
  for (const sym of yahooSymbolCandidates(stockCode)) {
    const closes = await fetchCloses(sym, '60d').catch(() => null);
    if (!closes || closes.length < minNeeded) continue;
    const fullRsi = rsiSeries(closes, 14);
    if (fullRsi.length < bars) continue;
    const prices = closes.slice(-bars);
    const rsi    = fullRsi.slice(-bars);
    return { prices, rsi };
  }
  return null;
}

// PR-6 #12: 동시 실행 방지 뮤텍스.
// orchestratorJobs(*/1분) 의 signalScanner → updateShadowResults 와
// shadowResolverJob(*/5분) 이 5분마다 동시 진입해, 동일 shadow 상태를 각각
// 로드·처리·브로드캐스트하면서 같은 L3 분할 익절·원금보호 알림이 텔레그램에
// 두 번 나가는 사례(2026-04-24 Shadow 익절 중복) 가 확인됐다.
// 최종 fills/quantity 는 last-write-wins 로 정확하지만 메시지만 중복.
// 간단한 in-memory 플래그로 직렬화 — 한 쪽이 끝날 때까지 다른 쪽은 skip.
let _exitRunning = false;

/** Shadow 진행 중 거래 결과 업데이트 — Macro/포지션 제한 시에도 재사용 */
export async function updateShadowResults(shadows: ServerShadowTrade[], currentRegime: RegimeLevel): Promise<void> {
  if (_exitRunning) {
    console.warn('[ExitEngine] 이미 updateShadowResults 실행 중 — 중복 진입 skip (concurrent tick 가드)');
    return;
  }
  _exitRunning = true;
  try {
    return await _updateShadowResultsImpl(shadows, currentRegime);
  } finally {
    _exitRunning = false;
  }
}

async function _updateShadowResultsImpl(shadows: ServerShadowTrade[], currentRegime: RegimeLevel): Promise<void> {
  // 청산 실행 우선순위는 EXIT_RULE_PRIORITY_TABLE(entryEngine.ts)과 동일한 순서로 평가된다.
  // ExitRuleTag 타입이 규칙명을 강제하므로, 규칙 추가 시 shadowTradeRepo.ts의 ExitRuleTag와
  // entryEngine.ts의 EXIT_RULE_PRIORITY_TABLE을 함께 갱신하면 된다.
  //
  // L1 학습 훅 (아이디어 1) — 이번 루프에서 HIT_TARGET/HIT_STOP으로 전환된 stockCode를 수집하여
  // 루프 종료 후 setImmediate로 learningOrchestrator.onShadowResolved() 일괄 트리거.
  const resolvedNow = new Set<string>();

  // PR-7 #13: 레거시 SHADOW BUY fill 백필 (멱등). 기존에 BUY fill 없이 저장된
  // trade 들에 `originalQuantity × shadowEntryPrice` 로 BUY fill 을 복원한다.
  // 이후의 모든 fill 기반 파생(getRemainingQty/syncPositionCache/computeShadowAccount)
  // 이 정상 작동하기 위한 전제 조건.
  const backfilled = backfillShadowBuyFills(shadows);
  if (backfilled > 0) {
    console.log(`[ExitEngine] SHADOW BUY fill 백필: ${backfilled}건 (레거시 마이그레이션)`);
  }

  // Phase 3-⑨: 열려 있는 trade 에 대해 30/60/120분 mini-bar 스냅샷 포착 (약한 라벨).
  // 실패해도 main exit 로직에 영향 없도록 격리.
  try {
    const captured = await captureSnapshotsForOpenTrades(shadows);
    if (captured > 0) console.log(`[Coldstart] mini-bar snapshot ${captured}건 저장`);
  } catch (e) {
    console.warn('[Coldstart] snapshot capture 실패:', e instanceof Error ? e.message : e);
  }
  for (const shadow of shadows) {
    // PENDING: Shadow 모드에서만 4분 경과 후 ACTIVE 전환.
    // LIVE 모드에서는 fillMonitor가 ORDER_SUBMITTED → ACTIVE 전환을 책임지므로
    // 여기서 자동 승격하지 않는다 (체결 확인 없이 ACTIVE처럼 보이는 것을 방지).
    if (shadow.status === 'PENDING') {
      if (shadow.mode === 'LIVE') continue;
      const ageMs = Date.now() - new Date(shadow.signalTime).getTime();
      if (ageMs < 4 * 60 * 1000) continue;
      shadow.status = 'ACTIVE';
      // PR-7 #13: PENDING→ACTIVE 전환 시 BUY fill 기록 — fills SSOT 작동의 전제.
      // LIVE 경로는 fillMonitor.updateStatus('ACTIVE') 가 이 역할을 하지만 SHADOW 경로는
      // 이 지점이 유일한 진입 체결 확정점이다. 이미 BUY fill 이 있으면 스킵(멱등).
      const hasBuyFill = (shadow.fills ?? []).some(f => f.type === 'BUY');
      if (!hasBuyFill && shadow.quantity > 0 && shadow.shadowEntryPrice > 0) {
        const entryTs = new Date().toISOString();
        appendFill(shadow, {
          type:        'BUY',
          subType:     'INITIAL_BUY',
          qty:         shadow.quantity,
          price:       shadow.shadowEntryPrice,
          reason:      'SHADOW 가상 진입',
          timestamp:   entryTs,
          status:      'CONFIRMED',
          confirmedAt: entryTs,
        });
        shadow.originalQuantity = Math.max(shadow.originalQuantity ?? 0, shadow.quantity);
      }
      // Shadow 체결 알림 — LIVE의 fillMonitor "✅ 체결 확인"과 동일한 경험 제공
      // 체결 알림 — getRemainingQty SSOT 를 사용해 캐시 드리프트를 방지한다.
      const filledQty = getRemainingQty(shadow) > 0 ? getRemainingQty(shadow) : shadow.quantity;
      await sendTelegramAlert(
        `🎭 <b>[SHADOW 체결]</b> ${shadow.stockName} (${shadow.stockCode})\n` +
        `진입가: ${shadow.shadowEntryPrice.toLocaleString()}원 × ${filledQty}주\n` +
        `손절: ${shadow.stopLoss.toLocaleString()}원 | 목표: ${shadow.targetPrice.toLocaleString()}원\n` +
        `⚠️ SHADOW 모드 — 실계좌 잔고 아님`
      ).catch(console.error);
      appendShadowLog({ event: 'SHADOW_ACTIVATED', ...shadow });
      continue;
    }

    // REJECTED·ORDER_SUBMITTED 모두 이 조건으로 스킵됨.
    // REJECTED는 buyApproval 거부/KIS 주문 실패 시 shadows에 남는 종료 상태이므로 안전.
    // ORDER_SUBMITTED는 fillMonitor가 체결 확인 후 ACTIVE로 전환할 때까지 exitEngine이 관여하지 않음.
    if (shadow.status !== 'ACTIVE' && shadow.status !== 'PARTIALLY_FILLED' && shadow.status !== 'EUPHORIA_PARTIAL') continue;

    // ─── Fill 기반 잔량 동기화 (단일 진실 원천) ──────────────────────────────
    // fills 배열이 진실 원천. 재시작·중복 실행 등으로 quantity 캐시가 어긋났으면 교정.
    {
      const before = shadow.quantity;
      if (syncPositionCache(shadow) && shadow.quantity !== before) {
        console.log(`[ExitEngine] ⚠️ 잔량 불일치 ${shadow.stockCode}: stored=${before} fill-based=${shadow.quantity} → 교정`);
      }
      // 잔량이 0이면 HIT_STOP으로 전환하고 루프 스킵
      if (shadow.quantity <= 0) {
        shadow.status = 'HIT_STOP';
        shadow.exitTime ??= new Date().toISOString();
        console.log(`[ExitEngine] ⚠️ ${shadow.stockCode} fill 기반 잔량=0 → 강제 HIT_STOP 전환`);
        continue;
      }
    }

    const currentPrice = getRealtimePrice(shadow.stockCode)
      ?? await fetchCurrentPrice(shadow.stockCode).catch(() => null);
    if (!currentPrice) continue;

    const returnPct = ((currentPrice - shadow.shadowEntryPrice) / shadow.shadowEntryPrice) * 100;
    const initialStopLoss = shadow.initialStopLoss ?? shadow.stopLoss;
    const regimeStopLoss = shadow.regimeStopLoss ?? shadow.stopLoss;
    let hardStopLoss = shadow.hardStopLoss ?? shadow.stopLoss;

    // ─── ATR 동적 손절 갱신 (BEP 보호 / 수익 Lock-in) ──────────────────────
    if (shadow.entryATR14 && shadow.entryATR14 > 0) {
      const stopRegime = regimeToStopRegime(currentRegime);
      const dynResult = evaluateDynamicStop({
        entryPrice: shadow.shadowEntryPrice,
        atr14: shadow.entryATR14,
        regime: stopRegime,
        currentPrice,
      });

      // 트레일링 활성 시 trailingStopPrice, 아니면 기본 stopPrice
      const effectiveDynamicStop = dynResult.trailingActive
        ? dynResult.trailingStopPrice
        : dynResult.stopPrice;

      // hardStopLoss는 오직 상향만 허용 (래칫 — 한번 올라간 손절은 내려가지 않음)
      if (effectiveDynamicStop > hardStopLoss) {
        const prevHardStop = hardStopLoss;
        hardStopLoss = effectiveDynamicStop;
        shadow.hardStopLoss = effectiveDynamicStop;
        shadow.dynamicStopPrice = effectiveDynamicStop;

        if (dynResult.profitLockIn) {
          appendShadowLog({ event: 'ATR_PROFIT_LOCKIN', ...shadow, prevHardStop, newHardStop: effectiveDynamicStop });
          console.log(`[AutoTrade] 🔒 ${shadow.stockName} ATR 수익 Lock-in: 손절 ${prevHardStop.toLocaleString()} → ${effectiveDynamicStop.toLocaleString()} (+3%)`);
          await sendTelegramAlert(
            `🔒 <b>[수익 Lock-in]</b> ${shadow.stockName} (${shadow.stockCode})\n` +
            `ATR 동적 손절 상향: ${prevHardStop.toLocaleString()}원 → ${effectiveDynamicStop.toLocaleString()}원 (+3%)\n` +
            `현재가: ${currentPrice.toLocaleString()}원 | 수익: +${returnPct.toFixed(1)}%`
          ).catch(console.error);
        } else if (dynResult.bepProtection) {
          appendShadowLog({ event: 'ATR_BEP_PROTECTION', ...shadow, prevHardStop, newHardStop: effectiveDynamicStop });
          console.log(`[AutoTrade] 🛡️ ${shadow.stockName} ATR BEP 보호: 손절 ${prevHardStop.toLocaleString()} → ${effectiveDynamicStop.toLocaleString()} (원금)`);
          await sendTelegramAlert(
            `🛡️ <b>[원금 보호]</b> ${shadow.stockName} (${shadow.stockCode})\n` +
            `ATR 동적 손절 상향: ${prevHardStop.toLocaleString()}원 → ${effectiveDynamicStop.toLocaleString()}원 (BEP)\n` +
            `현재가: ${currentPrice.toLocaleString()}원 | 수익: +${returnPct.toFixed(1)}%`
          ).catch(console.error);
        }
      }
    }

    // ─── R6 긴급 청산 30% (블랙스완 — 1회만) ────────────────────────────────
    if (currentRegime === 'R6_DEFENSE' && !shadow.r6EmergencySold && shadow.quantity > 0) {
      const emergencyQty = Math.max(1, Math.floor(shadow.quantity * 0.30));
      shadow.exitRuleTag = 'R6_EMERGENCY_EXIT';
      shadow.r6EmergencySold = true;
      appendShadowLog({ event: 'R6_EMERGENCY_EXIT', ...shadow, soldQty: emergencyQty, returnPct });
      console.log(`[AutoTrade] 🔴 ${shadow.stockName} R6 긴급 청산 30% (${emergencyQty}주) @${currentPrice.toLocaleString()}`);
      const r6Res = await placeKisSellOrder(shadow.stockCode, shadow.stockName, emergencyQty, 'STOP_LOSS');
      const r6Ts = new Date().toISOString();
      const r6Reserve = reserveSell(shadow, r6Res, {
        type: 'SELL', subType: 'EMERGENCY',
        qty: emergencyQty, price: currentPrice,
        pnl: (currentPrice - shadow.shadowEntryPrice) * emergencyQty,
        pnlPct: returnPct, reason: 'R6 긴급청산 30%',
        exitRuleTag: 'R6_EMERGENCY_EXIT', timestamp: r6Ts,
      }, 'R6_EMERGENCY', 'r6EmergencySold');

      if (r6Reserve.kind === 'FAILED') {
        // LIVE 주문 접수 실패 — 중복 방지 플래그 즉시 롤백 (다음 기회 재시도 허용)
        shadow.r6EmergencySold = false;
      } else {
        syncPositionCache(shadow);
        if (r6Reserve.kind === 'PENDING') {
          addSellOrder({
            ordNo: r6Reserve.ordNo, stockCode: shadow.stockCode, stockName: shadow.stockName,
            quantity: emergencyQty, originalReason: 'STOP_LOSS',
            placedAt: new Date().toISOString(), relatedTradeId: shadow.id,
          });
        }
      }
      await sendTelegramAlert(
        `🔴 <b>${r6Reserve.statusPrefix} [R6 긴급 청산]</b> ${shadow.stockName} (${shadow.stockCode})\n` +
        `블랙스완 감지 — 30% 즉시 청산 ${emergencyQty}주 @${currentPrice.toLocaleString()}원\n` +
        `수익률: ${returnPct > 0 ? '+' : ''}${returnPct.toFixed(2)}% | 잔여: ${r6Reserve.remainingQty}주` +
        r6Reserve.statusSuffix,
        { priority: r6Reserve.kind === 'FAILED' ? 'CRITICAL' : 'HIGH' },
      ).catch(console.error);
      if (shadow.quantity <= 0) continue; // 잔여 없으면 종료 처리 생략
    }

    // ─── MA60_DEATH_FORCE_EXIT: 유예 만료 + 여전히 역배열 → 전량 강제 청산 ───
    // 60일선 역배열이 감지된 후 5영업일 유예. 유예 만료일 이후에도 여전히 역배열이면
    // "주도주 사이클 종료"로 판정하고 좀비 포지션을 강제로 청산한다.
    if (!shadow.ma60DeathForced && shadow.ma60ForceExitDate) {
      const todayKst = kstBusinessDateStr(0);
      if (todayKst >= shadow.ma60ForceExitDate) {
        const mas = await fetchMaFromCloses(shadow.stockCode).catch(() => null);
        const stillDead = mas ? isMA60Death(mas.ma20, mas.ma60, currentPrice) : true;
        if (stillDead) {
          const soldQty = shadow.quantity;
          // BUG #7 fix — 전량 청산 전 상태 스냅샷. 주문 실패 시 되돌린다.
          const ma60Snapshot = captureFullCloseSnapshot(shadow);
          updateShadow(shadow, {
            status: 'HIT_STOP',
            exitPrice: currentPrice,
            exitTime: new Date().toISOString(),
            exitRuleTag: 'MA60_DEATH_FORCE_EXIT',
            ma60DeathForced: true,
            quantity: 0,
          });
          console.log(`[Shadow Close] MA60_DEATH_FORCE_EXIT — ${shadow.stockCode} soldQty=${soldQty} quantity→0`);
          appendShadowLog({ event: 'MA60_DEATH_FORCE_EXIT', ...shadow, soldQty });
          console.log(`[AutoTrade] ⚰️ ${shadow.stockName} MA60 죽음 강제 청산 ${returnPct.toFixed(2)}% @${currentPrice.toLocaleString()}`);
          const ma60Res = await placeKisSellOrder(shadow.stockCode, shadow.stockName, soldQty, 'STOP_LOSS');
          const ma60Ts = new Date().toISOString();
          const ma60Reserve = reserveSell(shadow, ma60Res, {
            type: 'SELL', subType: 'EMERGENCY',
            qty: soldQty, price: currentPrice,
            pnl: (currentPrice - shadow.shadowEntryPrice) * soldQty,
            pnlPct: returnPct, reason: 'MA60 역배열 강제청산',
            exitRuleTag: 'MA60_DEATH_FORCE_EXIT', timestamp: ma60Ts,
          }, 'MA60_FORCE');
          if (ma60Reserve.kind === 'PENDING') {
            addSellOrder({
              ordNo: ma60Reserve.ordNo, stockCode: shadow.stockCode, stockName: shadow.stockName,
              quantity: soldQty, originalReason: 'STOP_LOSS',
              placedAt: new Date().toISOString(), relatedTradeId: shadow.id,
            });
          } else if (ma60Reserve.kind === 'FAILED') {
            // BUG #7 fix — 상태 롤백으로 DB/KIS 괴리 제거. 다음 스캔에서 자동 재시도.
            rollbackFullCloseOnFailure(shadow, ma60Snapshot, 'MA60_DEATH_FORCE_EXIT', ma60Reserve.reason);
          }
          await sendTelegramAlert(
            `⚰️ <b>${ma60Reserve.statusPrefix} [MA60 강제 청산]</b> ${shadow.stockName} (${shadow.stockCode})\n` +
            `60일선 역배열 5영업일 유예 만료 — 전량 강제 청산\n` +
            `${soldQty}주 @${currentPrice.toLocaleString()}원 | 수익률: ${returnPct > 0 ? '+' : ''}${returnPct.toFixed(2)}%` +
            ma60Reserve.statusSuffix,
            { priority: 'CRITICAL', dedupeKey: `ma60_force:${shadow.stockCode}` },
          ).catch(console.error);
          await channelSellSignal({
            stockName:   shadow.stockName,
            stockCode:   shadow.stockCode,
            exitPrice:   currentPrice,
            entryPrice:  shadow.shadowEntryPrice,
            pnlPct:      returnPct,
            reason:      'STOP',
            holdingDays: Math.floor((Date.now() - new Date(shadow.signalTime).getTime()) / 86_400_000),
          }).catch(console.error);
          // IDEA 11 — 손절 투명성 리포트
          await sendStopLossTransparencyReport(shadow, {
            exitPrice: currentPrice,
            returnPct,
            soldQty,
          }).catch(console.error);
          continue;
        } else {
          // 역배열 해소 → 스케줄 초기화
          shadow.ma60DeathDetectedAt = undefined;
          shadow.ma60ForceExitDate = undefined;
          appendShadowLog({ event: 'MA60_DEATH_RECOVERED', ...shadow });
        }
      }
    }

    // ─── 하드 스톱 (고정 손절/레짐 손절) ───────────────────────────────────────
    if (currentPrice <= hardStopLoss) {
      // ATR 트레일링이 손절을 초기/레짐 이상으로 끌어올린 경우 → PROFIT_PROTECTION
      let stopLossExitType: 'INITIAL' | 'REGIME' | 'INITIAL_AND_REGIME' | 'PROFIT_PROTECTION';
      if (hardStopLoss > initialStopLoss && hardStopLoss > regimeStopLoss) {
        stopLossExitType = 'PROFIT_PROTECTION';
      } else {
        const stopGap = Math.abs(initialStopLoss - regimeStopLoss);
        stopLossExitType = stopGap < 0.5
          ? 'INITIAL_AND_REGIME'
          : (initialStopLoss > regimeStopLoss ? 'INITIAL' : 'REGIME');
      }
      const soldQty = shadow.quantity;
      // BUG #7 fix — 전량 청산 전 스냅샷. 주문 실패 시 HIT_STOP → 이전 상태로 복귀.
      const hardStopSnapshot = captureFullCloseSnapshot(shadow);
      updateShadow(shadow, {
        status: 'HIT_STOP',
        exitPrice: currentPrice,
        exitTime: new Date().toISOString(),
        stopLossExitType,
        exitRuleTag: 'HARD_STOP',
        quantity: 0,
      });
      console.log(`[Shadow Close] HARD_STOP — ${shadow.stockCode} soldQty=${soldQty} quantity→0`);
      appendShadowLog({ event: 'HIT_STOP', ...shadow, stopLossExitType, soldQty });
      // Phase 3-⑫: 구조화 Pre-Mortem 매칭 + 반복 패턴 자동 승급
      {
        const match = matchExitInvalidation(shadow, {
          currentPrice,
          currentRegime,
          mtas: undefined,
          ma60: undefined,
          volume: undefined,
          vkospiDayChange: undefined,
        });
        if (match) {
          shadow.exitInvalidationMatch = {
            id: match.id, matchedAt: new Date().toISOString(), observedValue: match.observedValue,
          };
          promoteInvalidationPatternIfRepeated(shadow);
          // Idea 10 — Kelly decay × invalidation 의 2차원 패턴도 병렬 승급 평가.
          // I/O 실패가 exit 경로를 막지 않도록 try/catch.
          try {
            promoteKellyDriftPattern(shadow);
          } catch (e) {
            console.warn('[KellyDrift] 승급 평가 실패:', e instanceof Error ? e.message : e);
          }
        }
      }
      console.log(`[AutoTrade] ❌ ${shadow.stockName} 하드 스톱(${stopLossExitType}) ${returnPct.toFixed(2)}% @${currentPrice.toLocaleString()}`);
      const hardStopRes = await placeKisSellOrder(shadow.stockCode, shadow.stockName, soldQty, 'STOP_LOSS');
      const hardStopTs = new Date().toISOString();
      const hardStopReserve = reserveSell(shadow, hardStopRes, {
        type: 'SELL', subType: 'STOP_LOSS',
        qty: soldQty, price: currentPrice,
        pnl: (currentPrice - shadow.shadowEntryPrice) * soldQty,
        pnlPct: returnPct, reason: `하드스톱 손절 (${stopLossExitType})`,
        exitRuleTag: 'HARD_STOP', timestamp: hardStopTs,
      }, 'HARD_STOP');
      if (hardStopReserve.kind === 'PENDING') {
        addSellOrder({
          ordNo: hardStopReserve.ordNo, stockCode: shadow.stockCode, stockName: shadow.stockName,
          quantity: soldQty, originalReason: 'STOP_LOSS',
          placedAt: new Date().toISOString(), relatedTradeId: shadow.id,
        });
      } else if (hardStopReserve.kind === 'FAILED') {
        // BUG #7 fix — 상태 롤백 + CRITICAL 알림. 다음 스캔에서 규칙 재평가.
        rollbackFullCloseOnFailure(shadow, hardStopSnapshot, 'HARD_STOP', hardStopReserve.reason);
        await sendTelegramAlert(
          `🚨 <b>${hardStopReserve.statusPrefix} [하드 스톱] (상태 롤백)</b> ${shadow.stockName} (${shadow.stockCode})\n` +
          `${stopLossExitType} 손절 ${soldQty}주 @${currentPrice.toLocaleString()}원` +
          hardStopReserve.statusSuffix +
          `\n⚙ shadow 는 ACTIVE 로 복귀 — 다음 스캔 사이클에서 자동 재시도.`,
          { priority: 'CRITICAL', dedupeKey: `hard_stop_fail:${shadow.stockCode}` },
        ).catch(console.error);
      }
      await channelSellSignal({
        stockName:   shadow.stockName,
        stockCode:   shadow.stockCode,
        exitPrice:   currentPrice,
        entryPrice:  shadow.shadowEntryPrice,
        pnlPct:      returnPct,
        reason:      'STOP',
        holdingDays: Math.floor((Date.now() - new Date(shadow.signalTime).getTime()) / 86_400_000),
      }).catch(console.error);
      // IDEA 11 — 손절 투명성 리포트
      await sendStopLossTransparencyReport(shadow, {
        exitPrice: currentPrice,
        returnPct,
        soldQty,
      }).catch(console.error);
      continue;
    }

    // ② -30% 블랙리스트 편입 / -25% 전량 청산 (Final Exit)
    if (returnPct <= -25) {
      const isBlacklistStep = returnPct <= -30;
      const soldQty = shadow.quantity;
      // BUG #7 fix — 전량 청산 전 스냅샷.
      const cascadeSnapshot = captureFullCloseSnapshot(shadow);
      updateShadow(shadow, {
        status: 'HIT_STOP',
        exitPrice: currentPrice,
        exitTime: new Date().toISOString(),
        exitRuleTag: 'CASCADE_FINAL',
        quantity: 0,
      });
      console.log(`[Shadow Close] CASCADE_FINAL — ${shadow.stockCode} soldQty=${soldQty} quantity→0`);
      appendShadowLog({ event: isBlacklistStep ? 'CASCADE_STOP_BLACKLIST' : 'CASCADE_STOP_FINAL', ...shadow, soldQty });
      console.log(`[AutoTrade] ❌ ${shadow.stockName} Cascade ${returnPct.toFixed(2)}% — 전량 청산${isBlacklistStep ? ' + 블랙리스트 180일' : ''}`);
      const cascadeFinalRes = await placeKisSellOrder(shadow.stockCode, shadow.stockName, soldQty, 'STOP_LOSS');
      const cascadeFinalTs = new Date().toISOString();
      const cascadeFinalReserve = reserveSell(shadow, cascadeFinalRes, {
        type: 'SELL', subType: 'STOP_LOSS',
        qty: soldQty, price: currentPrice,
        pnl: (currentPrice - shadow.shadowEntryPrice) * soldQty,
        pnlPct: returnPct, reason: '캐스케이드 전량청산',
        exitRuleTag: 'CASCADE_FINAL', timestamp: cascadeFinalTs,
      }, 'HARD_STOP');
      if (cascadeFinalReserve.kind === 'FAILED') {
        // BUG #7 fix — 상태 롤백 + CRITICAL 알림.
        rollbackFullCloseOnFailure(shadow, cascadeSnapshot, 'CASCADE_FINAL', cascadeFinalReserve.reason);
        await sendTelegramAlert(
          `🚨 <b>${cascadeFinalReserve.statusPrefix} [캐스케이드 전량청산] (상태 롤백)</b> ${shadow.stockName}` +
          cascadeFinalReserve.statusSuffix +
          `\n⚙ 다음 스캔에서 자동 재시도 — 블랙리스트 적용도 재평가.`,
          { priority: 'CRITICAL', dedupeKey: `cascade_final_fail:${shadow.stockCode}` },
        ).catch(console.error);
      }
      if (cascadeFinalRes.placed && cascadeFinalRes.ordNo) {
        addSellOrder({
          ordNo: cascadeFinalRes.ordNo, stockCode: shadow.stockCode, stockName: shadow.stockName,
          quantity: soldQty, originalReason: 'STOP_LOSS',
          placedAt: new Date().toISOString(), relatedTradeId: shadow.id,
        });
      }
      await channelSellSignal({
        stockName:   shadow.stockName,
        stockCode:   shadow.stockCode,
        exitPrice:   currentPrice,
        entryPrice:  shadow.shadowEntryPrice,
        pnlPct:      returnPct,
        reason:      'CASCADE',
        holdingDays: Math.floor((Date.now() - new Date(shadow.signalTime).getTime()) / 86_400_000),
      }).catch(console.error);
      // IDEA 11 — 손절 투명성 리포트
      await sendStopLossTransparencyReport(shadow, {
        exitPrice: currentPrice,
        returnPct,
        soldQty,
      }).catch(console.error);
      // BUG #7 fix — 주문이 실제로 접수된 경우만 블랙리스트 등록. 실패 + 롤백 시에는
      // 다음 스캔에서 재시도가 일어나므로 블랙리스트도 그 시점에 재평가된다.
      if (isBlacklistStep && cascadeFinalReserve.kind !== 'FAILED') {
        addToBlacklist(shadow.stockCode, shadow.stockName, `Cascade ${returnPct.toFixed(1)}%`);
        await sendTelegramAlert(
          `🚫 <b>[블랙리스트] ${shadow.stockName} (${shadow.stockCode})</b>\n` +
          `손실 ${returnPct.toFixed(1)}% → 180일 재진입 금지`
        ).catch(console.error);
      }
      continue;
    }

    // ─── L3-a: 트레일링 고점 갱신 ────────────────────────────────────────────
    if (shadow.trailingEnabled && currentPrice > (shadow.trailingHighWaterMark ?? 0)) {
      shadow.trailingHighWaterMark = currentPrice;
    }

    // ─── L3-b: LIMIT 트랜치 분할 익절 ────────────────────────────────────────
    if (shadow.profitTranches && shadow.profitTranches.length > 0 && !shadow.trailingEnabled) {
      let trancheFired = false;
      for (const t of shadow.profitTranches) {
        if (!t.taken && currentPrice >= t.price) {
          const baseQty  = shadow.originalQuantity ?? shadow.quantity;
          const sellQty  = Math.min(Math.max(1, Math.round(baseQty * t.ratio)), shadow.quantity);
          t.taken = true;
          trancheFired = true;
          shadow.exitRuleTag = 'LIMIT_TRANCHE_TAKE_PROFIT';
          appendShadowLog({ event: 'PROFIT_TRANCHE', ...shadow, soldQty: sellQty, tranchePrice: t.price, returnPct });
          console.log(`[AutoTrade] 📈 ${shadow.stockName} L3 분할 익절 ${(t.ratio * 100).toFixed(0)}% (${sellQty}주) @${currentPrice.toLocaleString()}`);
          const trancheRes = await placeKisSellOrder(shadow.stockCode, shadow.stockName, sellQty, 'TAKE_PROFIT');
          const trancheTs  = new Date().toISOString();
          const trancheIdx = shadow.profitTranches?.filter(x => x.taken && x !== t).length ?? 0;
          const trancheReserve = reserveSell(shadow, trancheRes, {
            type: 'SELL', subType: 'PARTIAL_TP',
            qty: sellQty, price: currentPrice,
            pnl: (currentPrice - shadow.shadowEntryPrice) * sellQty,
            pnlPct: returnPct, reason: `분할익절 트랜치 ${(t.ratio * 100).toFixed(0)}%`,
            exitRuleTag: 'LIMIT_TRANCHE_TAKE_PROFIT', timestamp: trancheTs,
          }, trancheIdx === 0 ? 'LIMIT_TP1' : 'LIMIT_TP2');

          if (trancheReserve.kind === 'FAILED') {
            // 트랜치 주문 실패 — taken 플래그 롤백 (다음 기회에 재시도 허용)
            t.taken = false;
            // trancheFired 는 유지: 다른 트랜치가 이미 fired 됐을 수 있음.
          } else {
            syncPositionCache(shadow);
            if (trancheReserve.kind === 'PENDING') {
              addSellOrder({
                ordNo: trancheReserve.ordNo, stockCode: shadow.stockCode, stockName: shadow.stockName,
                quantity: sellQty, originalReason: 'TAKE_PROFIT',
                placedAt: new Date().toISOString(), relatedTradeId: shadow.id,
              });
            }
          }
          await sendTelegramAlert(
            `📈 <b>${trancheReserve.statusPrefix} [L3 분할 익절]</b> ${shadow.stockName} (${shadow.stockCode})\n` +
            `트랜치: ${(t.ratio * 100).toFixed(0)}% × ${sellQty}주 @${currentPrice.toLocaleString()}원\n` +
            `수익률: +${returnPct.toFixed(2)}% | 잔여: ${trancheReserve.remainingQty}주` +
            trancheReserve.statusSuffix,
            trancheReserve.kind === 'FAILED' ? { priority: 'HIGH' } : undefined,
          ).catch(console.error);
          await channelSellSignal({
            stockName:   shadow.stockName,
            stockCode:   shadow.stockCode,
            exitPrice:   currentPrice,
            entryPrice:  shadow.shadowEntryPrice,
            pnlPct:      returnPct,
            reason:      'TRANCHE',
            holdingDays: Math.floor((Date.now() - new Date(shadow.signalTime).getTime()) / 86_400_000),
            soldQty:     sellQty,
            originalQty: baseQty,
          }).catch(console.error);
        }
      }
      // 모든 LIMIT 트랜치 소화 → 트레일링 활성화
      if (trancheFired && shadow.profitTranches.every((t) => t.taken)) {
        shadow.trailingEnabled = true;
        shadow.trailingHighWaterMark = currentPrice;
        appendShadowLog({ event: 'TRAILING_ACTIVATED', ...shadow });
        console.log(`[AutoTrade] 🔁 ${shadow.stockName} 트레일링 스톱 활성화 @${currentPrice.toLocaleString()}`);
      }
      // 전량 소진 시 종료
      if (shadow.quantity <= 0) {
        updateShadow(shadow, { status: 'HIT_TARGET', exitPrice: currentPrice, exitTime: new Date().toISOString() });
        appendShadowLog({ event: 'FULLY_CLOSED_TRANCHES', ...shadow });
        continue;
      }
    }

    // ─── L3-c: 트레일링 스톱 (이익보호 손절) ──────────────────────────────────
    if (shadow.trailingEnabled && shadow.trailingHighWaterMark !== undefined && shadow.quantity > 0) {
      const trailFloor = shadow.trailingHighWaterMark * (1 - (shadow.trailPct ?? 0.10));
      if (currentPrice <= trailFloor) {
        const soldQty = shadow.quantity;
        // BUG #7 fix — 전량 청산 전 스냅샷.
        const trailSnapshot = captureFullCloseSnapshot(shadow);
        updateShadow(shadow, {
          status: 'HIT_TARGET',
          exitPrice: currentPrice,
          exitTime: new Date().toISOString(),
          stopLossExitType: 'PROFIT_PROTECTION',
          exitRuleTag: 'TRAILING_PROTECTIVE_STOP',
          quantity: 0,
        });
        console.log(`[Shadow Close] TRAILING_PROTECTIVE_STOP — ${shadow.stockCode} soldQty=${soldQty} quantity→0`);
        appendShadowLog({ event: 'TRAILING_STOP', ...shadow, soldQty });
        console.log(`[AutoTrade] 📉 ${shadow.stockName} L3 트레일링 스톱 (HWM×${(1 - (shadow.trailPct ?? 0.10)).toFixed(2)}) @${currentPrice.toLocaleString()}`);
        const trailRes = await placeKisSellOrder(shadow.stockCode, shadow.stockName, soldQty, 'TAKE_PROFIT');
        const trailTs = new Date().toISOString();
        const trailReserve = reserveSell(shadow, trailRes, {
          type: 'SELL', subType: 'TRAILING_TP',
          qty: soldQty, price: currentPrice,
          pnl: (currentPrice - shadow.shadowEntryPrice) * soldQty,
          pnlPct: returnPct, reason: '트레일링 스톱 청산',
          exitRuleTag: 'TRAILING_PROTECTIVE_STOP', timestamp: trailTs,
        }, 'TRAILING_STOP');
        if (trailReserve.kind === 'PENDING') {
          addSellOrder({
            ordNo: trailReserve.ordNo, stockCode: shadow.stockCode, stockName: shadow.stockName,
            quantity: soldQty, originalReason: 'TAKE_PROFIT',
            placedAt: new Date().toISOString(), relatedTradeId: shadow.id,
          });
        } else if (trailReserve.kind === 'FAILED') {
          // BUG #7 fix — 상태 롤백. 다음 tick 에 트레일링 재평가.
          rollbackFullCloseOnFailure(shadow, trailSnapshot, 'TRAILING_PROTECTIVE_STOP', trailReserve.reason);
        }
        await sendTelegramAlert(
          `📉 <b>${trailReserve.statusPrefix} [L3 트레일링 스톱]</b> ${shadow.stockName} (${shadow.stockCode})\n` +
          `고점: ${shadow.trailingHighWaterMark.toLocaleString()}원 → 청산: ${currentPrice.toLocaleString()}원\n` +
          `최종 수익률: ${returnPct > 0 ? '+' : ''}${returnPct.toFixed(2)}%` +
          trailReserve.statusSuffix,
          trailReserve.kind === 'FAILED' ? { priority: 'CRITICAL' } : undefined,
        ).catch(console.error);
        await channelSellSignal({
          stockName:   shadow.stockName,
          stockCode:   shadow.stockCode,
          exitPrice:   currentPrice,
          entryPrice:  shadow.shadowEntryPrice,
          pnlPct:      returnPct,
          reason:      'TRAILING',
          holdingDays: Math.floor((Date.now() - new Date(shadow.signalTime).getTime()) / 86_400_000),
        }).catch(console.error);
        continue;
      }
    }

    // ① 목표가 달성 → 익절 전량 매도 (트랜치 미설정 구형 포지션 fallback)
    if (currentPrice >= shadow.targetPrice) {
      const soldQty = shadow.quantity;
      // BUG #7 fix — 전량 청산 전 스냅샷.
      const targetSnapshot = captureFullCloseSnapshot(shadow);
      updateShadow(shadow, {
        status: 'HIT_TARGET',
        exitPrice: currentPrice,
        exitTime: new Date().toISOString(),
        exitRuleTag: 'TARGET_EXIT',
        quantity: 0,
      });
      console.log(`[Shadow Close] TARGET_EXIT — ${shadow.stockCode} soldQty=${soldQty} quantity→0`);
      appendShadowLog({ event: 'HIT_TARGET', ...shadow, soldQty });
      console.log(`[AutoTrade] ✅ ${shadow.stockName} 목표가 달성 +${returnPct.toFixed(2)}% @${currentPrice.toLocaleString()}`);
      const targetRes = await placeKisSellOrder(shadow.stockCode, shadow.stockName, soldQty, 'TAKE_PROFIT');
      const targetTs = new Date().toISOString();
      const targetReserve = reserveSell(shadow, targetRes, {
        type: 'SELL', subType: 'FULL_CLOSE',
        qty: soldQty, price: currentPrice,
        pnl: (currentPrice - shadow.shadowEntryPrice) * soldQty,
        pnlPct: returnPct, reason: '목표가 달성 전량청산',
        exitRuleTag: 'TARGET_EXIT', timestamp: targetTs,
      }, 'FULL_CLOSE');
      if (targetReserve.kind === 'PENDING') {
        addSellOrder({
          ordNo: targetReserve.ordNo, stockCode: shadow.stockCode, stockName: shadow.stockName,
          quantity: soldQty, originalReason: 'TAKE_PROFIT',
          placedAt: new Date().toISOString(), relatedTradeId: shadow.id,
        });
      } else if (targetReserve.kind === 'FAILED') {
        // BUG #7 fix — 상태 롤백. 다음 tick 에 목표가 조건 재평가.
        rollbackFullCloseOnFailure(shadow, targetSnapshot, 'TARGET_EXIT', targetReserve.reason);
      }
      await sendTelegramAlert(
        `✅ <b>${targetReserve.statusPrefix} [목표가 달성]</b> ${shadow.stockName} (${shadow.stockCode})\n` +
        `청산가: ${currentPrice.toLocaleString()}원\n` +
        `수익률: +${returnPct.toFixed(2)}%` +
        targetReserve.statusSuffix,
        targetReserve.kind === 'FAILED' ? { priority: 'CRITICAL' } : undefined,
      ).catch(console.error);
      await channelSellSignal({
        stockName:   shadow.stockName,
        stockCode:   shadow.stockCode,
        exitPrice:   currentPrice,
        entryPrice:  shadow.shadowEntryPrice,
        pnlPct:      returnPct,
        reason:      'TARGET',
        holdingDays: Math.floor((Date.now() - new Date(shadow.signalTime).getTime()) / 86_400_000),
      }).catch(console.error);
      continue;
    }

    // ③ -15% 반매도 (cascadeStep 2, 1회만)
    if (returnPct <= -15 && (shadow.cascadeStep ?? 0) < 2) {
      const halfQty = Math.max(1, Math.floor(shadow.quantity / 2));
      const prevCascadeStep = shadow.cascadeStep ?? 0;
      const prevHalfSoldAt = shadow.halfSoldAt;
      shadow.cascadeStep = 2;
      shadow.halfSoldAt  = new Date().toISOString();
      shadow.exitRuleTag = 'CASCADE_HALF_SELL';
      appendShadowLog({ event: 'CASCADE_HALF_SELL', ...shadow, soldQty: halfQty, returnPct });
      console.log(`[AutoTrade] 🔶 ${shadow.stockName} Cascade -15% — 반매도 ${halfQty}주 (잔여 ${shadow.quantity - halfQty}주)`);
      const cascadeHalfRes = await placeKisSellOrder(shadow.stockCode, shadow.stockName, halfQty, 'STOP_LOSS');
      const cascadeHalfTs = new Date().toISOString();
      const cascadeHalfReserve = reserveSell(shadow, cascadeHalfRes, {
        type: 'SELL', subType: 'STOP_LOSS',
        qty: halfQty, price: currentPrice,
        pnl: (currentPrice - shadow.shadowEntryPrice) * halfQty,
        pnlPct: returnPct, reason: '캐스케이드 -15% 반매도',
        exitRuleTag: 'CASCADE_HALF_SELL', timestamp: cascadeHalfTs,
      }, 'CASCADE_HALF');

      if (cascadeHalfReserve.kind === 'FAILED') {
        // 실주문 접수 실패 — cascadeStep 을 이전 값으로 롤백 (다음 기회 재시도)
        shadow.cascadeStep = prevCascadeStep as 0 | 1 | 2;
        shadow.halfSoldAt = prevHalfSoldAt;
      } else {
        syncPositionCache(shadow);
        if (cascadeHalfReserve.kind === 'PENDING') {
          addSellOrder({
            ordNo: cascadeHalfReserve.ordNo, stockCode: shadow.stockCode, stockName: shadow.stockName,
            quantity: halfQty, originalReason: 'STOP_LOSS',
            placedAt: new Date().toISOString(), relatedTradeId: shadow.id,
          });
        }
      }
      await sendTelegramAlert(
        `🔶 <b>${cascadeHalfReserve.statusPrefix} [Cascade -15%] ${shadow.stockName} (${shadow.stockCode})</b>\n` +
        `손실 ${returnPct.toFixed(1)}% — 반매도 ${halfQty}주 (잔여 ${cascadeHalfReserve.remainingQty}주)` +
        cascadeHalfReserve.statusSuffix,
        cascadeHalfReserve.kind === 'FAILED' ? { priority: 'HIGH' } : undefined,
      ).catch(console.error);
      continue;
    }

    // ④ -7% 추가 매수 차단 + 경고 (cascadeStep 1, 1회만)
    if (returnPct <= -7 && (shadow.cascadeStep ?? 0) < 1) {
      shadow.cascadeStep    = 1;
      shadow.addBuyBlocked  = true;
      shadow.exitRuleTag = 'CASCADE_WARN_BLOCK';
      appendShadowLog({ event: 'CASCADE_WARN', ...shadow, returnPct });
      console.warn(`[AutoTrade] ⚠️  ${shadow.stockName} Cascade -7% — 추가 매수 차단`);
      await sendTelegramAlert(
        `⚠️ <b>[Cascade -7%] ${shadow.stockName} (${shadow.stockCode})</b>\n` +
        `손실 ${returnPct.toFixed(1)}% — 추가 매수 차단 (모니터링 강화)`
      ).catch(console.error);
      continue;
    }

    // ─── RRR 붕괴 감지 — 잔여 기대값 < 1.0이면 50% 자동 익절 (1회만) ────────
    // 진입 시 한 번만 계산된 RRR은 주가 상승 시 잔여 upside가 줄면서 실질 RRR이
    // 1.0 이하로 붕괴할 수 있다. 수익 중인 포지션이라도 잔여 기대값이 마이너스이면
    // 보유 정당성이 없으므로 50%를 자동 익절하여 "좀비 포지션"을 제거한다.
    if (!shadow.rrrCollapsePartialSold && shadow.quantity > 0 && currentPrice > shadow.shadowEntryPrice) {
      const remainingReward = shadow.targetPrice - currentPrice;
      const remainingRisk   = currentPrice - hardStopLoss;
      if (remainingRisk > 0) {
        const liveRRR = remainingReward / remainingRisk;
        if (liveRRR < 1.0) {
          const sellQty = Math.max(1, Math.floor(shadow.quantity * 0.5));
          shadow.rrrCollapsePartialSold = true;
          shadow.exitRuleTag = 'RRR_COLLAPSE_PARTIAL';
          appendShadowLog({ event: 'RRR_COLLAPSE_PARTIAL', ...shadow, soldQty: sellQty, liveRRR, returnPct, exitPrice: currentPrice });
          console.log(`[AutoTrade] 📊 ${shadow.stockName} RRR 붕괴 (${liveRRR.toFixed(2)}) — 50% 익절 ${sellQty}주 @${currentPrice.toLocaleString()}`);
          const rrrRes = await placeKisSellOrder(shadow.stockCode, shadow.stockName, sellQty, 'TAKE_PROFIT');
          const rrrTs = new Date().toISOString();
          const rrrReserve = reserveSell(shadow, rrrRes, {
            type: 'SELL', subType: 'PARTIAL_TP',
            qty: sellQty, price: currentPrice,
            pnl: (currentPrice - shadow.shadowEntryPrice) * sellQty,
            pnlPct: returnPct, reason: 'RRR 붕괴 50% 익절',
            exitRuleTag: 'RRR_COLLAPSE_PARTIAL', timestamp: rrrTs,
          }, 'LIMIT_TP1', 'rrrCollapsePartialSold');

          if (rrrReserve.kind === 'FAILED') {
            // 실주문 접수 실패 — 중복 방지 플래그 즉시 롤백
            shadow.rrrCollapsePartialSold = false;
          } else {
            syncPositionCache(shadow);
            if (rrrReserve.kind === 'PENDING') {
              addSellOrder({
                ordNo: rrrReserve.ordNo, stockCode: shadow.stockCode, stockName: shadow.stockName,
                quantity: sellQty, originalReason: 'TAKE_PROFIT',
                placedAt: new Date().toISOString(), relatedTradeId: shadow.id,
              });
            }
          }
          await sendTelegramAlert(
            `📊 <b>${rrrReserve.statusPrefix} [RRR 붕괴 경보]</b> ${shadow.stockName} (${shadow.stockCode})\n` +
            `잔여 RRR: ${liveRRR.toFixed(2)} (< 1.0) — 좀비 포지션 50% 익절\n` +
            `${sellQty}주 @${currentPrice.toLocaleString()}원 | 수익: +${returnPct.toFixed(2)}%\n` +
            `목표: ${shadow.targetPrice.toLocaleString()}원 | 손절: ${hardStopLoss.toLocaleString()}원 | 잔여: ${rrrReserve.remainingQty}주` +
            rrrReserve.statusSuffix,
            { priority: rrrReserve.kind === 'FAILED' ? 'CRITICAL' : 'HIGH', dedupeKey: `rrr_collapse:${shadow.stockCode}` },
          ).catch(console.error);
          if (rrrReserve.recorded) {
            await channelSellSignal({
              stockName:   shadow.stockName,
              stockCode:   shadow.stockCode,
              exitPrice:   currentPrice,
              entryPrice:  shadow.shadowEntryPrice,
              pnlPct:      returnPct,
              reason:      'RRR_COLLAPSE',
              holdingDays: Math.floor((Date.now() - new Date(shadow.signalTime).getTime()) / 86_400_000),
              soldQty:     sellQty,
              originalQty: shadow.originalQuantity,
            }).catch(console.error);
          }
          if (shadow.quantity <= 0) continue;
        }
      }
    }

    // ─── 하락 다이버전스 — 주가 신고가 + RSI 고점 낮아짐 → 30% 부분 익절 (1회만) ─
    // 수익 구간에서 "가짜 돌파·상투" 조기 경보. 매매 중 포지션만 대상.
    if (
      !shadow.divergencePartialSold &&
      shadow.quantity > 0 &&
      currentPrice > shadow.shadowEntryPrice
    ) {
      const hist = await fetchPriceAndRsiHistory(shadow.stockCode, 10).catch(() => null);
      if (hist && detectBearishDivergence(hist.prices, hist.rsi)) {
        const sellQty = Math.max(1, Math.floor(shadow.quantity * 0.30));
        shadow.divergencePartialSold = true;
        shadow.exitRuleTag = 'DIVERGENCE_PARTIAL';
        appendShadowLog({ event: 'DIVERGENCE_PARTIAL', ...shadow, soldQty: sellQty, returnPct, exitPrice: currentPrice });
        console.log(`[AutoTrade] 📉 ${shadow.stockName} 하락 다이버전스 — 30% 익절 ${sellQty}주 @${currentPrice.toLocaleString()}`);
        const divRes = await placeKisSellOrder(shadow.stockCode, shadow.stockName, sellQty, 'TAKE_PROFIT');
        const divTs = new Date().toISOString();
        const divReserve = reserveSell(shadow, divRes, {
          type: 'SELL', subType: 'PARTIAL_TP',
          qty: sellQty, price: currentPrice,
          pnl: (currentPrice - shadow.shadowEntryPrice) * sellQty,
          pnlPct: returnPct, reason: '하락 다이버전스 30% 익절',
          exitRuleTag: 'DIVERGENCE_PARTIAL', timestamp: divTs,
        }, 'LIMIT_TP1', 'divergencePartialSold');

        if (divReserve.kind === 'FAILED') {
          // LIVE 주문 접수 실패 — 중복 방지 플래그 즉시 롤백
          shadow.divergencePartialSold = false;
        } else {
          syncPositionCache(shadow);
          if (divReserve.kind === 'PENDING') {
            addSellOrder({
              ordNo: divReserve.ordNo, stockCode: shadow.stockCode, stockName: shadow.stockName,
              quantity: sellQty, originalReason: 'TAKE_PROFIT',
              placedAt: new Date().toISOString(), relatedTradeId: shadow.id,
            });
          }
        }
        await sendTelegramAlert(
          `📉 <b>${divReserve.statusPrefix} [하락 다이버전스]</b> ${shadow.stockName} (${shadow.stockCode})\n` +
          `주가 신고가·RSI 고점 낮아짐 — 30% 부분 익절\n` +
          `${sellQty}주 @${currentPrice.toLocaleString()}원 | 수익: +${returnPct.toFixed(2)}% | 잔여: ${divReserve.remainingQty}주` +
          divReserve.statusSuffix,
          { priority: divReserve.kind === 'FAILED' ? 'CRITICAL' : 'HIGH', dedupeKey: `divergence:${shadow.stockCode}` },
        ).catch(console.error);
        if (divReserve.recorded) {
          await channelSellSignal({
            stockName:   shadow.stockName,
            stockCode:   shadow.stockCode,
            exitPrice:   currentPrice,
            entryPrice:  shadow.shadowEntryPrice,
            pnlPct:      returnPct,
            reason:      'DIVERGENCE',
            holdingDays: Math.floor((Date.now() - new Date(shadow.signalTime).getTime()) / 86_400_000),
            soldQty:     sellQty,
            originalQty: shadow.originalQuantity,
          }).catch(console.error);
        }
        if (shadow.quantity <= 0) continue;
      }
    }

    // ─── MA60_DEATH_WATCH: 60일선 역배열 최초 감지 → 5영업일 강제 청산 스케줄 ─
    // 이미 스케줄된 포지션은 스킵. 역배열이 아니면 스킵. 신규 감지 시 ma60ForceExitDate 설정.
    if (!shadow.ma60DeathDetectedAt && !shadow.ma60DeathForced) {
      const mas = await fetchMaFromCloses(shadow.stockCode).catch(() => null);
      if (mas && isMA60Death(mas.ma20, mas.ma60, currentPrice)) {
        const nowIso = new Date().toISOString();
        const forceDate = kstBusinessDateStr(5);
        shadow.ma60DeathDetectedAt = nowIso;
        shadow.ma60ForceExitDate = forceDate;
        shadow.exitRuleTag = 'MA60_DEATH_WATCH';
        appendShadowLog({ event: 'MA60_DEATH_WATCH', ...shadow, ma20: mas.ma20, ma60: mas.ma60 });
        console.log(`[AutoTrade] ⚠️ ${shadow.stockName} MA60 역배열 감지 — 강제 청산일 ${forceDate}`);
        await sendTelegramAlert(
          `⚠️ <b>[MA60 역배열 감지]</b> ${shadow.stockName} (${shadow.stockCode})\n` +
          `60일선 역배열 진입 — 주도주 사이클 종료 신호\n` +
          `MA20: ${Math.round(mas.ma20).toLocaleString()} · MA60: ${Math.round(mas.ma60).toLocaleString()} · 현재가: ${currentPrice.toLocaleString()}원\n` +
          `📅 ${forceDate}까지 회복하지 못하면 강제 청산됩니다.`,
          { priority: 'HIGH', dedupeKey: `ma60_watch:${shadow.stockCode}` },
        ).catch(console.error);
      }
    }

    // ⑥ 손절가 접근 3단계 경보 (아이디어 5: 단계별 dedupeKey로 중복 방지)
    //   Stage 1: 손절까지 -5% 이내 → 🟡 접근 경고
    //   Stage 2: 손절까지 -3% 이내 → 🟠 임박 경고
    //   Stage 3: 손절까지 -1% 이내 → 🔴 집행 임박 (exitEngine 하드스톱이 곧 발동)
    {
      const distToStop = ((currentPrice - hardStopLoss) / hardStopLoss) * 100;
      const stage = shadow.stopApproachStage ?? 0;

      if (distToStop > 0 && distToStop < 5 && stage < 1) {
        shadow.stopApproachStage = 1;
        shadow.exitRuleTag = 'STOP_APPROACH_ALERT';
        await sendTelegramAlert(
          `🟡 <b>[손절 접근] ${shadow.stockName} (${shadow.stockCode})</b>\n` +
          `현재가: ${currentPrice.toLocaleString()}원\n` +
          `손절까지: -${distToStop.toFixed(1)}%\n` +
          `손절가: ${hardStopLoss.toLocaleString()}원`,
          {
            priority: 'HIGH',
            dedupeKey: `stop_approach_1:${shadow.stockCode}`,
          },
        ).catch(console.error);
      }

      if (distToStop > 0 && distToStop < 3 && stage < 2) {
        shadow.stopApproachStage = 2;
        shadow.exitRuleTag = 'STOP_APPROACH_ALERT';
        await sendTelegramAlert(
          `🟠 <b>[손절 임박] ${shadow.stockName} (${shadow.stockCode})</b>\n` +
          `현재가: ${currentPrice.toLocaleString()}원\n` +
          `손절까지: -${distToStop.toFixed(1)}% — 확인 필요\n` +
          `손절가: ${hardStopLoss.toLocaleString()}원`,
          {
            priority: 'CRITICAL',
            dedupeKey: `stop_approach_2:${shadow.stockCode}`,
          },
        ).catch(console.error);
      }

      if (distToStop > 0 && distToStop < 1 && stage < 3) {
        shadow.stopApproachStage = 3;
        shadow.exitRuleTag = 'STOP_APPROACH_ALERT';
        await sendTelegramAlert(
          `🔴 <b>[손절 집행 임박] ${shadow.stockName} (${shadow.stockCode})</b>\n` +
          `현재가: ${currentPrice.toLocaleString()}원\n` +
          `손절까지: -${distToStop.toFixed(1)}% — 곧 청산 실행\n` +
          `손절가: ${hardStopLoss.toLocaleString()}원`,
          {
            priority: 'CRITICAL',
            dedupeKey: `stop_approach_3:${shadow.stockCode}`,
          },
        ).catch(console.error);
      }
    }

    // ⑦ 과열 탐지 — ACTIVE 상태에서만 첫 번째 부분 매도 발동
    if (shadow.status === 'ACTIVE' || shadow.status === 'PARTIALLY_FILLED') {
      const euphoria = checkEuphoria(shadow, currentPrice);
      if (euphoria.triggered) {
        const halfQty = Math.max(1, Math.floor(shadow.quantity / 2));
        console.log(
          `[AutoTrade] 🌡️ ${shadow.stockName} 과열 감지 (${euphoria.count}개 신호) — 절반 매도 ${halfQty}주\n  신호: ${euphoria.signals.join(', ')}`
        );
        const prevStatus = shadow.status;
        shadow.status = 'EUPHORIA_PARTIAL';
        shadow.exitRuleTag = 'EUPHORIA_PARTIAL';
        appendShadowLog({
          event: 'EUPHORIA_PARTIAL',
          ...shadow,
          exitPrice: currentPrice,
          euphoriaSoldQty: halfQty,
          originalQuantity: shadow.originalQuantity,
        });
        const euphoriaRes = await placeKisSellOrder(shadow.stockCode, shadow.stockName, halfQty, 'EUPHORIA');
        const euphoriaTs = new Date().toISOString();
        const euphoriaReserve = reserveSell(shadow, euphoriaRes, {
          type: 'SELL', subType: 'PARTIAL_TP',
          qty: halfQty, price: currentPrice,
          pnl: (currentPrice - shadow.shadowEntryPrice) * halfQty,
          pnlPct: returnPct, reason: '과열 감지 50% 익절',
          exitRuleTag: 'EUPHORIA_PARTIAL', timestamp: euphoriaTs,
        }, 'LIMIT_TP1');

        if (euphoriaReserve.kind === 'FAILED') {
          // 실주문 접수 실패 — status 롤백 (다음 기회에 EUPHORIA 재평가 허용)
          shadow.status = prevStatus;
          await sendTelegramAlert(
            `🚨 <b>${euphoriaReserve.statusPrefix} [과열 부분매도 실패]</b> ${shadow.stockName} (${shadow.stockCode})\n` +
            `${halfQty}주 @${currentPrice.toLocaleString()}원` +
            euphoriaReserve.statusSuffix,
            { priority: 'CRITICAL' },
          ).catch(console.error);
        } else {
          syncPositionCache(shadow);
          if (euphoriaReserve.kind === 'PENDING') {
            addSellOrder({
              ordNo: euphoriaReserve.ordNo, stockCode: shadow.stockCode, stockName: shadow.stockName,
              quantity: halfQty, originalReason: 'EUPHORIA',
              placedAt: new Date().toISOString(), relatedTradeId: shadow.id,
            });
          }
          await sendTelegramAlert(
            `🌡️ <b>${euphoriaReserve.statusPrefix} [과열 부분매도]</b> ${shadow.stockName} (${shadow.stockCode})\n` +
            `신호 ${euphoria.count}개 — 50% 매도 ${halfQty}주 @${currentPrice.toLocaleString()}원\n` +
            `수익: ${returnPct > 0 ? '+' : ''}${returnPct.toFixed(2)}% | 잔여: ${euphoriaReserve.remainingQty}주` +
            euphoriaReserve.statusSuffix,
            { priority: 'HIGH', dedupeKey: `euphoria:${shadow.stockCode}` },
          ).catch(console.error);
          await channelSellSignal({
            stockName:   shadow.stockName,
            stockCode:   shadow.stockCode,
            exitPrice:   currentPrice,
            entryPrice:  shadow.shadowEntryPrice,
            pnlPct:      returnPct,
            reason:      'EUPHORIA',
            holdingDays: Math.floor((Date.now() - new Date(shadow.signalTime).getTime()) / 86_400_000),
            soldQty:     halfQty,
            originalQty: shadow.originalQuantity,
          }).catch(console.error);
        }
      }
    }

    // L1 학습 훅 — 이 루프 진입 조건(line ~188)이 ACTIVE/PARTIALLY_FILLED/EUPHORIA_PARTIAL 이므로
    // 종료 시 HIT_TARGET/HIT_STOP 이라면 이번 루프에서 갓 청산된 것이다.
    // TS의 좁혀진 상태가 루프 내 재할당 이후에도 유지되므로 string 비교로 우회.
    const finalStatus = shadow.status as string;
    if (finalStatus === 'HIT_TARGET' || finalStatus === 'HIT_STOP') {
      resolvedNow.add(shadow.stockCode);
    }
  }

  // 청산된 종목이 있으면 다음 tick으로 밀어 learningOrchestrator.onShadowResolved를 트리거.
  // KIS API 부담 최소화를 위해 종목당 1건씩 순차 처리 (Promise.all 미사용).
  if (resolvedNow.size > 0) {
    // 슬롯이 회복되었으므로 다음 INTRADAY tick 에서 interval/backoff 를 우회해 즉시 재스캔한다.
    // (기존에는 최대 10분 뒤 다음 decideScan() 까지 빈 슬롯이 방치됨)
    requestImmediateRescan(`exitEngine 청산 ${resolvedNow.size}건 (${Array.from(resolvedNow).join(',')})`);

    setImmediate(async () => {
      for (const code of resolvedNow) {
        await learningOrchestrator.onShadowResolved(code).catch(console.error);
      }
    });
  }
}
