/**
 * @responsibility Shadow approval → paper-fill 영속 SSOT (PENDING→ACTIVE 전이 + 멱등 가드)
 *
 * Patch-SHADOW-LIFECYCLE-AND-EXECUTION-001
 *
 * ────────────────────────────────────────────────────────────────────────────
 * 결함 (사용자 5/13 운영 보고):
 *   같은 종목 (한선엔지니어링 452280, 신세계 004170, 엑스게이트 356680,
 *   오픈엣지테크놀로지 394280) 의 Shadow BUY Telegram 카드가 13:13/13:15/13:18
 *   반복 발송. PR #923 ADR-0507 dedupe 가 *runtime within single process* 의
 *   중복은 차단했지만, `onApproved` 콜백 (buyListLoop.ts L2436 등 4 site) 이
 *   `ctx.shadows.push(t)` 만 하고 `saveShadowTrades(ctx.shadows)` 미호출 →
 *   trade 가 메모리에만 존재 → process restart / 다음 cron 사이클 메모리 초기화
 *   시 dedup 정보 + trade 모두 휘발 → 동일 종목 재승인 카드 반복 발송.
 *
 * 영속 갭의 진짜 원인:
 *   1. `buildBuyTrade` 가 status='PENDING' 으로 trade 생성 (정상)
 *   2. SHADOW approve 경로 (`buyPipeline.ts:610-622`) 는 logs+markAutoTradeReady+
 *      appendShadowLog 만 호출, status 전이 없음
 *   3. `onApproved` 콜백 (`buyListLoop.ts:2436-2473`) 이 ctx.shadows.push(t) 만
 *      수행, `saveShadowTrades` 호출 0건
 *   4. exitEngine cron 이 다음 호출에서 영속 read 시 해당 trade 부재 → 학습/사후
 *      복기 표본 손실 + 동일 종목 재승인 카드 발송 위험
 *
 * 본 SSOT 가 차단하는 invariant:
 *   - SHADOW approve 직후 status PENDING → ACTIVE 전이 + INITIAL_BUY fill 영속
 *   - saveShadowTrades(allTrades) atomic 호출 (영속 즉시)
 *   - 멱등 — 동일 trade.id 에 대해 두 번 호출 시 skip (이미 ACTIVE OR fills.BUY 존재)
 *   - LIVE 매매 본체 0줄 변경 — LIVE path (placeKisMarketBuyOrder + fillMonitor)
 *     무관, SHADOW 만 본 SSOT 통과
 *
 * ────────────────────────────────────────────────────────────────────────────
 * 절대 불변식 (ADR-0146 PR 자가 review 정합):
 *   - LIVE 매매 본체 0줄 변경 (`placeKisMarketBuyOrder` 등 KIS 주문 함수 5종 import 0건)
 *   - autoTradeEngine / orderExecutor / trancheExecutor import 0건
 *   - 외부 API (fetch / axios / node-fetch) 호출 0건 (영속 + read-only)
 *   - Gate threshold + condition weight + STRONG_BUY 조건 + requiredScore 변경 0
 *   - virtual account holdings/cash 무수정
 *   - executionImpact: 'NONE' literal 강제
 *   - liveOrderPlaced: false literal 강제
 *   - shadowTradeRepo.appendFill + saveShadowTrades SSOT 위임 (drift 차단)
 *   - ENV `SHADOW_EXECUTION_PIPELINE_DISABLED=true` (default OFF, ADR-0157 정확 비교)
 *   - 호출자 측 inline ENV 검사 0건 — `isShadowExecutionPipelineDisabled()` SSOT 위임
 *
 * 잘못된 해결 방법 영구 차단:
 *   - LIVE path 에 본 SSOT 호출 (LIVE 는 fillMonitor + placeKisMarketBuyOrder SSOT)
 *   - status 자동 전이 LIVE 에 적용 (ORDER_SUBMITTED → ACTIVE 는 fillMonitor 책임)
 *   - 외부 KIS 호출 (paper-fill 은 메모리 + 디스크만)
 *   - approvalPrice 가 아닌 currentPrice 강제 사용 (호출자 명시 의무)
 *   - 멱등 가드 우회 (trade 가 이미 ACTIVE 또는 fills.BUY 보유 시 강제 재실행)
 *   - ENV default ON (운영 환경 강제 활성화 부담)
 *   - 호출자 측 inline `process.env.X` 검사 (drift 위험)
 *
 * Patch type — ADR 발급 0건, sole CLAUDE.md row.
 */

import {
  appendFill,
  saveShadowTrades,
  appendShadowLog,
  type ServerShadowTrade,
} from '../persistence/shadowTradeRepo.js';
// Patch-SHADOW-POSITION-MANAGEMENT-AND-SELL-LIFECYCLE-002 — paper-fill 직후
// SHADOW_POSITION_OPENED 이벤트 영속 (사용자 §J #3 invariant: SHADOW_PAPER_FILLED 만
// 발생하고 OPEN 포지션 생성되지 않는 상태 영구 차단).
import {
  emitShadowPositionOpened,
  recordShadowLifecycleOutcome,
} from './shadowPositionLifecycle.js';
import {
  appendShadowExecutionLearningCase,
  appendShadowExecutionRejected,
  emitShadowExecutionOperatorDiagnosticOnce,
  isShadowExecutionSafeModeEnabled,
  markShadowTradeQuarantined,
  resolveAuthoritativeQuoteForShadowFill,
  validateShadowFillExecution,
  validateSlotBeforeShadowFill,
  type AuthoritativeQuoteSnapshot,
  type ShadowAuthoritativeQuoteResolver,
  type ShadowExecutionLearningTag,
  type ShadowFillRejectReason,
} from './shadowExecutionSafety.js';
import {
  computeTradePlan,
  formatPriceMismatchBlockedFillLog,
  formatPriceNotUsableForExecutionLog,
  formatPriceSnapshotResolvedLog,
  formatShadowFillPriceConfirmedLog,
  formatTradePlanComputedFromPriceSnapshotLog,
  formatTradePlanPriceValidationFailedLog,
  formatTradePlanResolvedLog,
  formatPositionTradePlanAttachedLog,
  priceSnapshotFromAuthoritativeQuote,
  validateTradePlanAgainstLatestPrice,
  type PriceSnapshot,
  type TradePlan,
} from './priceSnapshotSsot.js';

// ─── Schema ───────────────────────────────────────────────────────────────────

/**
 * Shadow execution lifecycle outcome — 9-state union.
 *
 * - `EXECUTED`: 정상 paper-fill 완료 (status=ACTIVE + INITIAL_BUY fill 영속)
 * - `ALREADY_FILLED`: 멱등 skip (이미 ACTIVE 또는 fills.BUY 존재) — 정상
 * - `NOT_SHADOW`: LIVE 모드 호출 — 본 SSOT 적용 대상 아님
 * - `INVALID_INPUT`: shadowEntryPrice ≤ 0 또는 quantity ≤ 0 등 입력 불충분
 * - `STATE_TERMINAL`: 이미 REJECTED/HIT_STOP/HIT_TARGET 등 종결 상태 → skip
 * - `ENV_DISABLED`: ENV `SHADOW_EXECUTION_PIPELINE_DISABLED=true` 활성
 * - `PERSIST_FAILED`: saveShadowTrades 실패 (디스크 I/O 등)
 */
export type ShadowExecutionOutcome =
  | 'EXECUTED'
  | 'ALREADY_FILLED'
  | 'NOT_SHADOW'
  | 'INVALID_INPUT'
  | 'STATE_TERMINAL'
  | 'ENV_DISABLED'
  | 'PERSIST_FAILED'
  | 'QUOTE_NOT_VERIFIED_FOR_EXECUTION'
  | 'QUOTE_SOURCE_NOT_EXECUTABLE'
  | 'TRADING_HALTED'
  | 'STALE_QUOTE_FOR_EXECUTION'
  | 'BAD_FILL_PRICE_DEVIATION'
  | 'NO_EXECUTABLE_FILL_PRICE'
  | 'SHADOW_SLOT_FULL_AT_FILL_TIME'
  | 'SECTOR_LIMIT_EXCEEDED_AT_FILL_TIME'
  | 'ENTRY_ALREADY_BELOW_STOP'
  | 'STOP_BLOCKED_UNVERIFIED_ENTRY_PRICE'
  | 'POSITION_QTY_MISMATCH';

/**
 * 필수 invariants — TypeScript 컴파일 타임 강제로 호출자 측 위반 즉시 fail.
 */
export interface ShadowExecutionResult {
  /** 결과 분류 */
  outcome: ShadowExecutionOutcome;
  /** 사유 (진단 텍스트 — Telegram 응답 / Railway 로그 입력) */
  reason: string;
  /** trade.id (호출자 디버깅용) */
  tradeId: string;
  /** ISO timestamp of execute 시점 (UTC) */
  executedAtIso: string;
  /** 영속 fill id (EXECUTED 시) — 멱등 검증용 */
  fillId?: string;
  /** Shadow 측 paper-fill 가격 (executed 시) */
  fillPrice?: number;
  currentPrice?: number;
  proposedFillPrice?: number;
  deviationPct?: number;
  quoteAsOf?: string;
  quoteSource?: string;
  quoteSnapshotId?: string;
  quoteConfidence?: string;
  priceSnapshotId?: string;
  priceConfidence?: string;
  priceAgeSec?: number;
  tradePlanValid?: boolean;
  orderIntentStatus?: 'READY' | 'WAIT_PRICE_VALID' | 'WAIT_PRICE_REBUILD';
  learningTag?: ShadowExecutionLearningTag;
  /** 영속 후 status — 호출자 진단용 */
  statusAfter?: ServerShadowTrade['status'];
  /** invariant: 본 SSOT 는 LIVE 주문을 호출하지 않음 */
  liveOrderPlaced: false;
  /** invariant: 본 SSOT 는 KIS quota 영향 0건 */
  executionImpact: 'NONE';
}

export interface ExecuteShadowBuyInput {
  /** 영속 대상 trade (호출자가 ctx.shadows.push 한 reference) */
  trade: ServerShadowTrade;
  /** 디스크에 영속할 전체 trades 배열 — 호출자가 ctx.shadows 그대로 전달 */
  allTrades: ServerShadowTrade[];
  /** Paper-fill 가격 — 명시 시 그대로, 미명시 시 trade.shadowEntryPrice */
  fillPrice?: number;
  /** Candidate/snapshot price. In safe mode this is diagnostic only, not the fill SSOT. */
  proposedFillPrice?: number;
  authoritativeQuote?: AuthoritativeQuoteSnapshot;
  quoteResolver?: ShadowAuthoritativeQuoteResolver;
  snapshotId?: string;
  marketSession?: string;
  regime?: string;
  maxPositions?: number;
  /** Approval 시점 ISO (logging) */
  approvedAtIso?: string;
  /** Telegram 발송 콜백 — 옵셔널, 호출자가 dedupe 체크 후 주입 */
  notifyFilled?: (input: ShadowFillNotificationInput) => Promise<void> | void;
  /** Test injection — 시간 제어 */
  now?: Date;
}

/**
 * `[Shadow 체결]` Telegram 알림 입력. 호출자가 channelPipeline 등을 통해 발송.
 */
export interface ShadowFillNotificationInput {
  stockCode: string;
  stockName: string;
  fillPrice: number;
  quantity: number;
  fillId: string;
  tradeId: string;
  filledAtIso: string;
  currentPrice?: number;
  fillReferencePrice?: number;
  proposedFillPrice?: number;
  deviationPct?: number;
  quoteAsOf?: string;
  quoteSource?: string;
  quoteSnapshotId?: string;
  priceSnapshotId?: string;
  priceConfidence?: string;
  priceAgeSec?: number;
  validation?: 'VERIFIED';
  signalType: string;
  watchlistSource?: string;
  /** invariant: SHADOW 모드 paper-fill */
  mode: 'SHADOW';
  /** invariant: 실제 KIS 주문 0건 */
  liveOrderPlaced: false;
}

// ─── ENV gate SSOT ────────────────────────────────────────────────────────────

/**
 * ADR-0157 정확 비교 — `=== 'true'` 만 활성, `'1'`/`'TRUE'`/`'yes'`/빈값 모두 거부.
 *
 * default OFF — Shadow execution pipeline 항상 활성. `true` 명시 시에만 비활성
 * (회귀 안전 fallback — `onApproved` 가 ctx.shadows.push 만 하던 PR #933 이전 동작).
 */
export function isShadowExecutionPipelineDisabled(): boolean {
  return process.env.SHADOW_EXECUTION_PIPELINE_DISABLED === 'true';
}

// ─── 멱등 가드 헬퍼 ────────────────────────────────────────────────────────────

/**
 * trade 가 이미 paper-fill 완료 상태인지 판정.
 * - status 가 ACTIVE 이상이면 이미 fill 처리됨
 * - fills 배열에 BUY type 이 존재하면 이미 fill 처리됨 (status 무관)
 *
 * 둘 중 하나라도 충족하면 ALREADY_FILLED — 영속 skip + 텔레그램 발송 0건.
 */
function isAlreadyFilled(trade: ServerShadowTrade): boolean {
  // status 검사 — PENDING 이외 상태는 모두 fill 또는 종결
  if (trade.status === 'ACTIVE') return true;
  if (trade.status === 'PARTIALLY_FILLED') return true;
  if (trade.status === 'EUPHORIA_PARTIAL') return true;
  if (trade.status === 'HIT_TARGET') return true;
  if (trade.status === 'HIT_STOP') return true;

  // fills 배열 검사 — BUY fill 이 이미 존재하면 fill 처리됨
  const fills = trade.fills ?? [];
  if (fills.some((f) => f.type === 'BUY' && f.status !== 'REVERTED')) {
    return true;
  }
  return false;
}

/**
 * trade 가 종결 상태인지 (REJECTED).
 */
function isTerminalState(trade: ServerShadowTrade): boolean {
  return trade.status === 'REJECTED'
    || trade.status === 'QUARANTINED_BAD_ENTRY'
    || trade.status === 'INCONSISTENT';
}

// ─── 메인 진입점 ──────────────────────────────────────────────────────────────

const NOT_SHADOW_RESULT_BASE = {
  liveOrderPlaced: false as const,
  executionImpact: 'NONE' as const,
};

function valueOr<T>(value: T | null | undefined, defaultValue: T): T {
  return value ?? defaultValue;
}

function describeError(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

function executionNow(input: ExecuteShadowBuyInput): Date {
  return input.now ?? new Date();
}

function resolveShadowFillPrice(input: ExecuteShadowBuyInput): number {
  return input.fillPrice ?? input.proposedFillPrice ?? input.trade.shadowEntryPrice;
}

function isInvalidPaperFillInput(fillPrice: number, quantity: number): boolean {
  if (!Number.isFinite(fillPrice)) return true;
  if (fillPrice <= 0) return true;
  if (!Number.isFinite(quantity)) return true;
  return quantity <= 0;
}

function countBuyFills(trade: ServerShadowTrade): number {
  return (trade.fills ?? []).filter((f) => f.type === 'BUY').length;
}

function countFills(trade: ServerShadowTrade): number {
  return (trade.fills ?? []).length;
}

function latestFillId(trade: ServerShadowTrade): string {
  const fillsAfter = trade.fills ?? [];
  const newFill = fillsAfter[fillsAfter.length - 1];
  return newFill?.id ?? '';
}

function shouldRefreshOriginalQuantity(trade: ServerShadowTrade, quantity: number): boolean {
  if (!trade.originalQuantity) return true;
  return trade.originalQuantity < quantity;
}

function proposedFillPriceForSafety(input: ExecuteShadowBuyInput): number | undefined {
  const proposed = input.proposedFillPrice ?? input.fillPrice ?? input.trade.shadowEntryPrice;
  return Number.isFinite(proposed) && proposed > 0 ? proposed : undefined;
}

function rejectionLogEvent(reason: ShadowFillRejectReason): string {
  if (reason === 'BAD_FILL_PRICE_DEVIATION') return 'SHADOW_FILL_REJECTED_BAD_PRICE';
  if (reason === 'STALE_QUOTE_FOR_EXECUTION') return 'SHADOW_FILL_REJECTED_STALE_QUOTE';
  if (reason === 'SHADOW_SLOT_FULL_AT_FILL_TIME') return 'SHADOW_SLOT_REJECTED_FULL';
  if (reason === 'ENTRY_ALREADY_BELOW_STOP') return 'SHADOW_ENTRY_QUARANTINED_BAD_ENTRY';
  if (reason === 'STOP_BLOCKED_UNVERIFIED_ENTRY_PRICE') return 'STOP_BLOCKED_UNVERIFIED_ENTRY';
  return 'SHADOW_FILL_REJECTED_SAFE_MODE';
}

function rejectSafeModeFill(input: {
  trade: ServerShadowTrade;
  tradeId: string;
  executedAtIso: string;
  reason: ShadowFillRejectReason;
  learningTag: ShadowExecutionLearningTag;
  fillPrice?: number;
  currentPrice?: number;
  proposedFillPrice?: number;
  deviationPct?: number;
  quote?: AuthoritativeQuoteSnapshot;
  priceSnapshot?: PriceSnapshot;
  statusAfter?: ServerShadowTrade['status'];
  extra?: Record<string, unknown>;
}): ShadowExecutionResult {
  const event = rejectionLogEvent(input.reason);
  const orderIntentStatus = input.extra?.orderIntentStatus === 'WAIT_PRICE_REBUILD'
    ? 'WAIT_PRICE_REBUILD'
    : 'WAIT_PRICE_VALID';
  const base = {
    reason: input.reason,
    learningTag: input.learningTag,
    symbol: input.trade.stockCode,
    positionId: input.trade.id,
    tradeId: input.tradeId,
    decisionSnapshotId: input.quote?.snapshotId,
    quoteSnapshotId: input.quote?.snapshotId,
    currentPrice: input.currentPrice ?? input.quote?.currentPrice,
    proposedFillPrice: input.proposedFillPrice,
    fillPrice: input.fillPrice,
    deviationPct: input.deviationPct,
    quoteAsOf: input.quote?.quoteAsOf,
    confidence: input.quote?.confidence,
    quoteSource: input.quote?.quoteSource,
    priceSnapshotId: input.priceSnapshot?.priceSnapshotId,
    priceConfidence: input.priceSnapshot?.confidence,
    priceAgeSec: input.priceSnapshot?.ageSec,
    orderIntentStatus,
    marketSession: input.quote?.marketSession,
    regime: input.trade.entryRegime,
    executionImpact: 'NONE',
    shadowLearning: true,
    ...input.extra,
  };
  appendShadowExecutionRejected({ event, timestamp: input.executedAtIso, ...base });
  appendShadowExecutionLearningCase({ timestamp: input.executedAtIso, ...base });
  emitShadowExecutionOperatorDiagnosticOnce({
    symbol: input.trade.stockCode,
    reason: input.reason,
    now: new Date(input.executedAtIso),
    payload: base,
  });
  console.warn(
    `[${event}] symbol=${input.trade.stockCode} reason=${input.reason} ` +
      `currentPrice=${base.currentPrice ?? 'NA'} proposedFillPrice=${input.proposedFillPrice ?? 'NA'} ` +
      `deviationPct=${input.deviationPct ?? 'NA'} executionImpact=NONE learningTag=${input.learningTag}`,
  );
  return {
    outcome: input.reason,
    reason: input.reason,
    tradeId: input.tradeId,
    executedAtIso: input.executedAtIso,
    fillPrice: input.fillPrice,
    currentPrice: input.currentPrice ?? input.quote?.currentPrice,
    proposedFillPrice: input.proposedFillPrice,
    deviationPct: input.deviationPct,
    quoteAsOf: input.quote?.quoteAsOf,
    quoteSource: input.quote?.quoteSource ? String(input.quote.quoteSource) : undefined,
    quoteSnapshotId: input.quote?.snapshotId,
    quoteConfidence: input.quote?.confidence,
    priceSnapshotId: input.priceSnapshot?.priceSnapshotId,
    priceConfidence: input.priceSnapshot?.confidence,
    priceAgeSec: input.priceSnapshot?.ageSec,
    tradePlanValid: input.extra?.tradePlanValid === true,
    orderIntentStatus,
    learningTag: input.learningTag,
    statusAfter: input.statusAfter,
    ...NOT_SHADOW_RESULT_BASE,
  };
}

function applyVerifiedEntryPrice(
  trade: ServerShadowTrade,
  validation: Extract<ReturnType<typeof validateShadowFillExecution>, { ok: true }>,
  marketSession?: string,
  priceSnapshot?: PriceSnapshot,
  tradePlan?: TradePlan,
): void {
  const oldEntry = trade.shadowEntryPrice;
  const oldStop = trade.stopLoss;
  const stopLossPct = Number.isFinite(oldEntry) && oldEntry > 0 && Number.isFinite(oldStop) && oldStop > 0 && oldStop < oldEntry
    ? (oldEntry - oldStop) / oldEntry
    : 0.05;
  const stopPrice = tradePlan?.initialStopLoss ?? Math.round(validation.fillPrice * (1 - stopLossPct));

  trade.shadowEntryPrice = validation.fillPrice;
  trade.signalPrice = validation.fillPrice;
  trade.entryPriceRaw = validation.fillPrice;
  trade.stopLoss = stopPrice;
  trade.initialStopLoss = stopPrice;
  if (tradePlan) {
    trade.targetPrice = tradePlan.targetPrice1;
  }
  trade.entryPriceValidationStatus = 'VERIFIED';
  trade.entryQuoteSnapshotId = validation.quote.snapshotId;
  trade.entryQuoteAsOf = validation.quote.quoteAsOf;
  trade.entryQuoteSource = String(validation.quote.quoteSource);
  trade.entryPriceBasis = validation.quote.priceBasis;
  trade.entryCurrentPrice = validation.currentPrice;
  trade.entryProposedFillPrice = validation.proposedFillPrice;
  trade.entryPriceDeviationPct = validation.deviationPct;
  trade.entryMarketSession = marketSession ?? validation.quote.marketSession;
  const extendedTrade = trade as ServerShadowTrade & {
    priceSnapshotId?: string;
    entryPriceSource?: string;
    entryPriceConfidence?: string;
    tradePlanId?: string;
    currentStopLoss?: number;
    targetPrice1?: number;
    riskReward1?: number;
    tp1SellPct?: number;
    moveStopToBreakevenAfterTp1?: boolean;
    tradePlanRiskReward?: number;
  };
  extendedTrade.priceSnapshotId = priceSnapshot?.priceSnapshotId;
  extendedTrade.entryPriceSource = priceSnapshot?.source;
  extendedTrade.entryPriceConfidence = priceSnapshot?.confidence;
  extendedTrade.tradePlanId = tradePlan?.tradePlanId;
  extendedTrade.currentStopLoss = tradePlan?.currentStopLoss;
  extendedTrade.targetPrice1 = tradePlan?.targetPrice1;
  extendedTrade.riskReward1 = tradePlan?.riskReward1;
  extendedTrade.tp1SellPct = tradePlan?.tp1SellPct;
  extendedTrade.moveStopToBreakevenAfterTp1 = tradePlan?.moveStopToBreakevenAfterTp1;
  extendedTrade.tradePlanRiskReward = tradePlan?.riskReward1;
}

/**
 * Shadow approval → paper-fill SSOT.
 *
 * 결정 트리 (우선순위 SSOT — 절대 변경 금지):
 *   1. ENV `SHADOW_EXECUTION_PIPELINE_DISABLED=true` → ENV_DISABLED
 *   2. trade.mode !== 'SHADOW' (LIVE 또는 미설정) → NOT_SHADOW
 *   3. isTerminalState(trade) (REJECTED) → STATE_TERMINAL
 *   4. shadowEntryPrice ≤ 0 OR quantity ≤ 0 → INVALID_INPUT
 *   5. isAlreadyFilled(trade) → ALREADY_FILLED (멱등 skip)
 *   6. 정상 — appendFill('BUY', INITIAL_BUY) + status='ACTIVE' + saveShadowTrades
 *      → EXECUTED
 *   7. saveShadowTrades throw → PERSIST_FAILED + status 롤백
 */
export async function executeShadowBuy(
  input: ExecuteShadowBuyInput,
): Promise<ShadowExecutionResult> {
  const now = executionNow(input);
  const executedAtIso = now.toISOString();
  const tradeId = input.trade.id;

  // ENV gate
  if (isShadowExecutionPipelineDisabled()) {
    return {
      outcome: 'ENV_DISABLED',
      reason: 'SHADOW_EXECUTION_PIPELINE_DISABLED=true (legacy onApproved-only path)',
      tradeId,
      executedAtIso,
      ...NOT_SHADOW_RESULT_BASE,
    };
  }

  // LIVE 모드 차단 — 본 SSOT 는 SHADOW 전용
  if (input.trade.mode !== 'SHADOW') {
    return {
      outcome: 'NOT_SHADOW',
      reason: `trade.mode=${input.trade.mode ?? 'undefined'} (SHADOW 만 허용)`,
      tradeId,
      executedAtIso,
      ...NOT_SHADOW_RESULT_BASE,
    };
  }

  // 종결 상태 차단
  if (isTerminalState(input.trade)) {
    return {
      outcome: 'STATE_TERMINAL',
      reason: `trade.status=${input.trade.status} (이미 종결, skip)`,
      tradeId,
      executedAtIso,
      statusAfter: input.trade.status,
      ...NOT_SHADOW_RESULT_BASE,
    };
  }

  // 입력 검증
  let fillPrice = resolveShadowFillPrice(input);
  const quantity = input.trade.quantity;
  const safeMode = isShadowExecutionSafeModeEnabled();
  let verifiedQuote: AuthoritativeQuoteSnapshot | undefined;
  let verifiedCurrentPrice: number | undefined;
  let verifiedProposedFillPrice: number | undefined;
  let verifiedDeviationPct: number | undefined;
  let verifiedPriceSnapshot: PriceSnapshot | undefined;
  let verifiedTradePlan: TradePlan | undefined;
  if (quantity <= 0 || !Number.isFinite(quantity) || (!safeMode && isInvalidPaperFillInput(fillPrice, quantity))) {
    return {
      outcome: 'INVALID_INPUT',
      reason: `fillPrice=${fillPrice} quantity=${quantity} (양수 의무)`,
      tradeId,
      executedAtIso,
      ...NOT_SHADOW_RESULT_BASE,
    };
  }

  if (safeMode && !Number.isFinite(fillPrice)) {
    fillPrice = input.trade.shadowEntryPrice;
  }

  // 멱등 가드 — 이미 fill 처리됨
  if (isAlreadyFilled(input.trade)) {
    return {
      outcome: 'ALREADY_FILLED',
      reason: `trade ${tradeId} 이미 paper-fill 완료 (status=${input.trade.status}, fills=${
        countBuyFills(input.trade)
      })`,
      tradeId,
      executedAtIso,
      statusAfter: input.trade.status,
      ...NOT_SHADOW_RESULT_BASE,
    };
  }

  if (safeMode) {
    const slot = validateSlotBeforeShadowFill({
      symbol: input.trade.stockCode,
      sector: input.trade.sector,
      regime: input.regime ?? input.trade.entryRegime,
      maxPositions: input.maxPositions,
      allTrades: input.allTrades,
      excludingTradeId: input.trade.id,
    });
    console.log(
      `[SHADOW_SLOT_RECHECK_BEFORE_FILL] symbol=${input.trade.stockCode} ` +
        `open=${slot.currentOpenPositions}/${slot.maxPositions} sector=${slot.sameSectorCount}/${slot.sectorLimit ?? 'NA'} ` +
        `result=${slot.ok ? 'PASS' : slot.reason} executionImpact=NONE`,
    );
    if (!slot.ok) {
      return rejectSafeModeFill({
        trade: input.trade,
        tradeId,
        executedAtIso,
        reason: slot.reason ?? 'SHADOW_SLOT_FULL_AT_FILL_TIME',
        learningTag: slot.learningTag ?? 'CASE_SLOT_FULL_FILL_BLOCKED',
        proposedFillPrice: proposedFillPriceForSafety(input),
        statusAfter: input.trade.status,
        extra: {
          currentOpenPositions: slot.currentOpenPositions,
          maxPositions: slot.maxPositions,
          sameSectorCount: slot.sameSectorCount,
          sectorLimit: slot.sectorLimit,
        },
      });
    }

    const quote = input.authoritativeQuote ?? await (input.quoteResolver ?? resolveAuthoritativeQuoteForShadowFill)({
      symbol: input.trade.stockCode,
      snapshotId: input.snapshotId,
      marketSession: input.marketSession,
      now,
    });
    const priceSnapshot = priceSnapshotFromAuthoritativeQuote({
      quote,
      purpose: 'SHADOW_FILL',
      now,
      marketSession: input.marketSession,
    });
    console.log(formatPriceSnapshotResolvedLog({ purpose: 'SHADOW_FILL', snapshot: priceSnapshot }));
    if (!priceSnapshot.priceUsableForShadowFill) {
      console.warn(formatPriceNotUsableForExecutionLog({
        symbol: input.trade.stockCode,
        purpose: 'SHADOW_FILL',
        snapshot: priceSnapshot,
      }));
      return rejectSafeModeFill({
        trade: input.trade,
        tradeId,
        executedAtIso,
        reason: quote.isStale ? 'STALE_QUOTE_FOR_EXECUTION' : 'QUOTE_NOT_VERIFIED_FOR_EXECUTION',
        learningTag: 'CASE_STALE_QUOTE_EXECUTION_BLOCKED',
        currentPrice: quote.currentPrice,
        proposedFillPrice: proposedFillPriceForSafety(input),
        quote,
        priceSnapshot,
        statusAfter: input.trade.status,
        extra: {
          orderIntentStatus: 'WAIT_PRICE_VALID',
          priceSnapshotId: priceSnapshot.priceSnapshotId,
        },
      });
    }
    const validation = validateShadowFillExecution({
      quote,
      proposedFillPrice: proposedFillPriceForSafety(input),
      side: 'BUY',
      now,
    });
    if (!validation.ok) {
      if (validation.reason === 'BAD_FILL_PRICE_DEVIATION' && validation.fillPrice && validation.currentPrice) {
        console.warn(formatPriceMismatchBlockedFillLog({
          symbol: input.trade.stockCode,
          mismatch: {
            referencePrice: validation.fillPrice,
            latestPrice: validation.currentPrice,
            diffPct: validation.deviationPct ?? 0,
            maxAllowedDiffPct: validation.maxFillDeviationPct ?? 1.0,
            status: 'MISMATCH',
          },
        }));
      } else {
        console.warn(formatPriceNotUsableForExecutionLog({
          symbol: input.trade.stockCode,
          purpose: 'SHADOW_FILL',
          snapshot: priceSnapshot,
          reason: validation.reason,
        }));
      }
      return rejectSafeModeFill({
        trade: input.trade,
        tradeId,
        executedAtIso,
        reason: validation.reason,
        learningTag: validation.learningTag,
        fillPrice: validation.fillPrice,
        currentPrice: validation.currentPrice,
        proposedFillPrice: validation.proposedFillPrice,
        deviationPct: validation.deviationPct,
        quote: validation.quote,
        priceSnapshot,
        statusAfter: input.trade.status,
        extra: {
          maxFillDeviationPct: validation.maxFillDeviationPct,
          orderIntentStatus: validation.reason === 'BAD_FILL_PRICE_DEVIATION' ? 'WAIT_PRICE_VALID' : 'WAIT_PRICE_VALID',
          priceSnapshotId: priceSnapshot.priceSnapshotId,
        },
      });
    }

    const tradePlan = computeTradePlan(priceSnapshot, {
      computedAt: executedAtIso,
    });
    console.log(formatTradePlanComputedFromPriceSnapshotLog(tradePlan));
    console.log(formatTradePlanResolvedLog(tradePlan));
    const tradePlanValidation = validateTradePlanAgainstLatestPrice({
      tradePlan,
      latestPriceSnapshot: priceSnapshot,
    });
    if (!tradePlanValidation.ok) {
      console.warn(formatTradePlanPriceValidationFailedLog({
        symbol: input.trade.stockCode,
        tradePlan,
        latestPriceSnapshot: priceSnapshot,
        reason: tradePlanValidation.reason,
      }));
      return rejectSafeModeFill({
        trade: input.trade,
        tradeId,
        executedAtIso,
        reason: 'BAD_FILL_PRICE_DEVIATION',
        learningTag: 'CASE_BAD_SHADOW_FILL_PRICE',
        fillPrice: validation.fillPrice,
        currentPrice: validation.currentPrice,
        proposedFillPrice: validation.proposedFillPrice,
        deviationPct: tradePlanValidation.mismatch?.diffPct ?? validation.deviationPct,
        quote: validation.quote,
        priceSnapshot,
        statusAfter: input.trade.status,
        extra: {
          orderIntentStatus: 'WAIT_PRICE_REBUILD',
          tradePlanValid: false,
          priceSnapshotId: priceSnapshot.priceSnapshotId,
          tradePlanReason: tradePlanValidation.reason,
        },
      });
    }

    applyVerifiedEntryPrice(input.trade, validation, input.marketSession, priceSnapshot, tradePlan);
    console.log(formatPositionTradePlanAttachedLog({
      positionId: input.trade.id,
      symbol: input.trade.stockCode,
      tradePlan,
    }));
    fillPrice = validation.fillPrice;
    verifiedQuote = validation.quote;
    verifiedPriceSnapshot = priceSnapshot;
    verifiedTradePlan = tradePlan;
    verifiedCurrentPrice = validation.currentPrice;
    verifiedProposedFillPrice = validation.proposedFillPrice;
    verifiedDeviationPct = validation.deviationPct;
    console.log(
      `[QUOTE_VERIFIED_FOR_SHADOW_FILL] symbol=${input.trade.stockCode} ` +
        `fillPrice=${fillPrice} currentPrice=${validation.currentPrice} ` +
        `deviationPct=${validation.deviationPct.toFixed(3)} quoteAsOf=${validation.quote.quoteAsOf} ` +
        `quoteSource=${validation.quote.quoteSource} validation=VERIFIED executionImpact=NONE`,
    );
    console.log(formatShadowFillPriceConfirmedLog({
      symbol: input.trade.stockCode,
      priceSnapshot,
      fillPrice,
    }));

    if (validation.currentPrice <= input.trade.stopLoss) {
      markShadowTradeQuarantined({
        trade: input.trade,
        reason: 'ENTRY_ALREADY_BELOW_STOP',
        learningTag: 'CASE_ENTRY_ALREADY_BELOW_STOP',
        now,
        context: {
          currentPrice: validation.currentPrice,
          proposedFillPrice: validation.proposedFillPrice,
          fillPrice,
          deviationPct: validation.deviationPct,
          quoteAsOf: validation.quote.quoteAsOf,
          confidence: validation.quote.confidence,
          quoteSnapshotId: validation.quote.snapshotId,
        },
      });
      return rejectSafeModeFill({
        trade: input.trade,
        tradeId,
        executedAtIso,
        reason: 'ENTRY_ALREADY_BELOW_STOP',
        learningTag: 'CASE_ENTRY_ALREADY_BELOW_STOP',
        fillPrice,
        currentPrice: validation.currentPrice,
        proposedFillPrice: validation.proposedFillPrice,
        deviationPct: validation.deviationPct,
        quote: validation.quote,
        priceSnapshot,
        statusAfter: input.trade.status,
        extra: {
          orderIntentStatus: 'WAIT_PRICE_REBUILD',
          tradePlanValid: false,
          priceSnapshotId: priceSnapshot.priceSnapshotId,
        },
      });
    }
  }

  // ─── Paper-fill 실행 ─────────────────────────────────────────────────────
  // 1. INITIAL_BUY fill 추가 (appendFill SSOT 위임 — fill id 자동 부여)
  const fillsBefore = countFills(input.trade);
  appendFill(input.trade, {
    type: 'BUY',
    subType: 'INITIAL_BUY',
    qty: quantity,
    price: fillPrice,
    reason: 'SHADOW paper-fill (Patch-SHADOW-LIFECYCLE-AND-EXECUTION-001)',
    timestamp: executedAtIso,
    status: 'CONFIRMED',
    confirmedAt: executedAtIso,
  });
  const fillId = latestFillId(input.trade);

  // 2. status PENDING → ACTIVE 전이
  const previousStatus = input.trade.status;
  input.trade.status = 'ACTIVE';
  if (shouldRefreshOriginalQuantity(input.trade, quantity)) {
    input.trade.originalQuantity = quantity;
  }

  // 3. saveShadowTrades atomic 호출 — 실패 시 롤백
  try {
    saveShadowTrades(input.allTrades);
  } catch (err) {
    // 롤백 — appendFill 한 마지막 fill 제거 + status 복구
    if (input.trade.fills && input.trade.fills.length > fillsBefore) {
      input.trade.fills.length = fillsBefore;
    }
    input.trade.status = previousStatus;
    return {
      outcome: 'PERSIST_FAILED',
      reason: `saveShadowTrades throw — ${
        describeError(err)
      }`,
      tradeId,
      executedAtIso,
      ...NOT_SHADOW_RESULT_BASE,
    };
  }

  // 4. shadow log 기록 — `[SHADOW_PAPER_FILLED]` 진단 패턴
  try {
    appendShadowLog({
      event: 'SHADOW_PAPER_FILLED',
      code: input.trade.stockCode,
      tradeId,
      fillId,
      fillPrice,
      quantity,
      filledAt: executedAtIso,
      currentPrice: verifiedCurrentPrice,
      proposedFillPrice: verifiedProposedFillPrice,
      deviationPct: verifiedDeviationPct,
      quoteAsOf: verifiedQuote?.quoteAsOf,
      quoteSource: verifiedQuote?.quoteSource,
      quoteSnapshotId: verifiedQuote?.snapshotId,
      priceSnapshotId: verifiedPriceSnapshot?.priceSnapshotId,
      priceConfidence: verifiedPriceSnapshot?.confidence,
      priceAgeSec: verifiedPriceSnapshot?.ageSec,
      tradePlanRiskReward: verifiedTradePlan?.riskReward,
      validation: safeMode ? 'VERIFIED' : undefined,
      patch: 'Patch-SHADOW-LIFECYCLE-AND-EXECUTION-001',
    });
  } catch {
    // shadow log 실패는 무시 — 영속은 이미 성공
  }

  console.log(
    `[SHADOW_PAPER_FILLED] ${input.trade.stockName}(${input.trade.stockCode}) ` +
      `qty=${quantity} @${fillPrice.toLocaleString()} ` +
      `fillId=${fillId} executionImpact=NONE liveOrderPlaced=false ` +
      `(Patch-SHADOW-LIFECYCLE-AND-EXECUTION-001)`,
  );

  // Patch-SHADOW-POSITION-MANAGEMENT-AND-SELL-LIFECYCLE-002 — SHADOW_POSITION_OPENED
  // 이벤트 영속. try/catch 격리 — lifecycle emit throw 가 paper-fill 결과를 차단하지
  // 않도록 (Always-On Trading Kernel, 사용자 §J #2).
  try {
    const lifecycleResult = emitShadowPositionOpened(input.trade, { now });
    recordShadowLifecycleOutcome('SHADOW_POSITION_OPENED', lifecycleResult.outcome);
  } catch (err) {
    console.warn(
      `[ShadowPositionLifecycle] emitShadowPositionOpened 실패 (paper-fill 완료) — ${
        describeError(err)
      }`,
    );
  }

  // Telegram is the final output: never emit a fill notification before position-open lifecycle.
  if (input.notifyFilled) {
    try {
      await input.notifyFilled({
        stockCode: input.trade.stockCode,
        stockName: input.trade.stockName,
        fillPrice,
        quantity,
        fillId,
        tradeId,
        filledAtIso: executedAtIso,
        currentPrice: verifiedCurrentPrice,
        fillReferencePrice: verifiedCurrentPrice,
        proposedFillPrice: verifiedProposedFillPrice,
        deviationPct: verifiedDeviationPct,
        quoteAsOf: verifiedQuote?.quoteAsOf,
        quoteSource: verifiedQuote?.quoteSource ? String(verifiedQuote.quoteSource) : undefined,
        quoteSnapshotId: verifiedQuote?.snapshotId,
        priceSnapshotId: verifiedPriceSnapshot?.priceSnapshotId,
        priceConfidence: verifiedPriceSnapshot?.confidence,
        priceAgeSec: verifiedPriceSnapshot?.ageSec,
        validation: safeMode ? 'VERIFIED' : undefined,
        signalType: valueOr(input.trade.profileType, 'B'),
        watchlistSource: input.trade.watchlistSource,
        mode: 'SHADOW',
        liveOrderPlaced: false,
      });
    } catch (err) {
      console.warn(
        `[ShadowExecutionPipeline] notifyFilled failed after position-open lifecycle - ${
          describeError(err)
        }`,
      );
    }
  }

  return {
    outcome: 'EXECUTED',
    reason: `Shadow paper-fill 완료 — qty=${quantity} @${fillPrice}`,
    tradeId,
    executedAtIso,
    fillId,
    fillPrice,
    currentPrice: verifiedCurrentPrice,
    proposedFillPrice: verifiedProposedFillPrice,
    deviationPct: verifiedDeviationPct,
    quoteAsOf: verifiedQuote?.quoteAsOf,
    quoteSource: verifiedQuote?.quoteSource ? String(verifiedQuote.quoteSource) : undefined,
    quoteSnapshotId: verifiedQuote?.snapshotId,
    quoteConfidence: verifiedQuote?.confidence,
    priceSnapshotId: verifiedPriceSnapshot?.priceSnapshotId,
    priceConfidence: verifiedPriceSnapshot?.confidence,
    priceAgeSec: verifiedPriceSnapshot?.ageSec,
    tradePlanValid: verifiedTradePlan !== undefined ? true : undefined,
    orderIntentStatus: verifiedPriceSnapshot !== undefined ? 'READY' : undefined,
    statusAfter: input.trade.status,
    ...NOT_SHADOW_RESULT_BASE,
  };
}

// ─── 진단 헬퍼 ────────────────────────────────────────────────────────────────

export interface ShadowExecutionPipelineSummary {
  total: number;
  executed: number;
  alreadyFilled: number;
  invalid: number;
  persistFailed: number;
  envDisabled: number;
  notShadow: number;
  stateTerminal: number;
  safeModeRejected: number;
  badPriceRejected: number;
  staleQuoteRejected: number;
  slotRejected: number;
  stopBlocked: number;
  /** 본 SSOT 는 LIVE 영향 0 — 항상 'NONE' */
  executionImpact: 'NONE';
}

const _summary: ShadowExecutionPipelineSummary = {
  total: 0,
  executed: 0,
  alreadyFilled: 0,
  invalid: 0,
  persistFailed: 0,
  envDisabled: 0,
  notShadow: 0,
  stateTerminal: 0,
  safeModeRejected: 0,
  badPriceRejected: 0,
  staleQuoteRejected: 0,
  slotRejected: 0,
  stopBlocked: 0,
  executionImpact: 'NONE',
};

export function recordShadowExecutionOutcome(
  outcome: ShadowExecutionOutcome,
): void {
  _summary.total++;
  switch (outcome) {
    case 'EXECUTED':
      _summary.executed++;
      break;
    case 'ALREADY_FILLED':
      _summary.alreadyFilled++;
      break;
    case 'INVALID_INPUT':
      _summary.invalid++;
      break;
    case 'PERSIST_FAILED':
      _summary.persistFailed++;
      break;
    case 'ENV_DISABLED':
      _summary.envDisabled++;
      break;
    case 'NOT_SHADOW':
      _summary.notShadow++;
      break;
    case 'STATE_TERMINAL':
      _summary.stateTerminal++;
      break;
    case 'BAD_FILL_PRICE_DEVIATION':
      _summary.safeModeRejected++;
      _summary.badPriceRejected++;
      break;
    case 'STALE_QUOTE_FOR_EXECUTION':
    case 'QUOTE_NOT_VERIFIED_FOR_EXECUTION':
    case 'QUOTE_SOURCE_NOT_EXECUTABLE':
    case 'TRADING_HALTED':
    case 'NO_EXECUTABLE_FILL_PRICE':
      _summary.safeModeRejected++;
      _summary.staleQuoteRejected++;
      break;
    case 'SHADOW_SLOT_FULL_AT_FILL_TIME':
    case 'SECTOR_LIMIT_EXCEEDED_AT_FILL_TIME':
      _summary.safeModeRejected++;
      _summary.slotRejected++;
      break;
    case 'ENTRY_ALREADY_BELOW_STOP':
    case 'STOP_BLOCKED_UNVERIFIED_ENTRY_PRICE':
    case 'POSITION_QTY_MISMATCH':
      _summary.safeModeRejected++;
      _summary.stopBlocked++;
      break;
  }
}

export function getShadowExecutionPipelineSummary(): ShadowExecutionPipelineSummary {
  return { ..._summary };
}

export function __resetShadowExecutionPipelineSummaryForTests(): void {
  _summary.total = 0;
  _summary.executed = 0;
  _summary.alreadyFilled = 0;
  _summary.invalid = 0;
  _summary.persistFailed = 0;
  _summary.envDisabled = 0;
  _summary.notShadow = 0;
  _summary.stateTerminal = 0;
  _summary.safeModeRejected = 0;
  _summary.badPriceRejected = 0;
  _summary.staleQuoteRejected = 0;
  _summary.slotRejected = 0;
  _summary.stopBlocked = 0;
}

/**
 * `/scan_blockers runtime` 출력용 compact section.
 * `[PATCH-RUNTIME]` 태그로 sectionMatchesMode (ADR-0506 §sectionMatchesMode)
 * runtime mode 필터 자동 통과.
 */
export function formatShadowExecutionPipelineSection(): string | null {
  const summary = getShadowExecutionPipelineSummary();
  if (summary.total === 0) return null;
  const lines = [
    '🔌 Shadow Execution Pipeline [PATCH-RUNTIME] (Patch-SHADOW-LIFECYCLE-AND-EXECUTION-001)',
    `• total=${summary.total} executed=${summary.executed} alreadyFilled=${summary.alreadyFilled}`,
  ];
  const otherCounts: string[] = [];
  if (summary.invalid > 0) otherCounts.push(`invalid=${summary.invalid}`);
  if (summary.persistFailed > 0) otherCounts.push(`persistFailed=${summary.persistFailed}`);
  if (summary.envDisabled > 0) otherCounts.push(`envDisabled=${summary.envDisabled}`);
  if (summary.notShadow > 0) otherCounts.push(`notShadow=${summary.notShadow}`);
  if (summary.stateTerminal > 0) otherCounts.push(`stateTerminal=${summary.stateTerminal}`);
  if (summary.safeModeRejected > 0) otherCounts.push(`safeModeRejected=${summary.safeModeRejected}`);
  if (summary.badPriceRejected > 0) otherCounts.push(`badPriceRejected=${summary.badPriceRejected}`);
  if (summary.staleQuoteRejected > 0) otherCounts.push(`staleQuoteRejected=${summary.staleQuoteRejected}`);
  if (summary.slotRejected > 0) otherCounts.push(`slotRejected=${summary.slotRejected}`);
  if (summary.stopBlocked > 0) otherCounts.push(`stopBlocked=${summary.stopBlocked}`);
  if (otherCounts.length > 0) {
    lines.push(`• ${otherCounts.join(' ')}`);
  }
  lines.push(
    `• executionImpact=${summary.executionImpact} liveOrderPlaced=false (paper-fill only)`,
  );
  return lines.join('\n');
}
