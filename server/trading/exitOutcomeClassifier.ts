// @responsibility 청산 결과 WIN/LOSS/BE 분류 SSOT — 서킷 카운트·통계의 단일 진실
/**
 * exitOutcomeClassifier.ts (ADR-0112) — BREAKEVEN 분류 SSOT.
 *
 * 1차 로그(2026-04-30) 의 PROFIT_PROTECTION -0.18~-0.45% 청산 3건이 LOSS 와
 * 동일하게 카운트되어 서킷 무한 루프를 트리거하던 결함의 진짜 근본 원인 차단.
 *
 * 사용자 트레이딩 철학:
 *   "본절은 *방향 실패* 가 아니라 *타이밍 실패*. 통계상 손절에는 포함하지 말고,
 *    실전 리스크 관리에는 소손실로 반영."
 *
 * 우선순위 SSOT:
 *   1. ENV BE_CLASSIFICATION_DISABLED=true → 기존 동작 (≥+1 WIN / 그 외 LOSS)
 *   2. NaN/Infinity → LOSS 안전 fallback (서킷 보수적)
 *   3. exitRuleTag === 'TARGET_EXIT' / 'EUPHORIA_PARTIAL' → WIN
 *   4. stopLossExitType === 'PROFIT_PROTECTION' AND -0.5 ≤ returnPct ≤ +0.5 → BE
 *   5. exitRuleTag === 'ENTRY_CIRCUIT_BREAKER' AND -0.5 ≤ returnPct ≤ +0.5 → BE
 *   6. returnPct ≥ +1.0 → WIN
 *   7. -0.5 ≤ returnPct ≤ +0.5 → BE (휴리스틱)
 *   8. returnPct < -0.5 → LOSS
 *   9. +0.5 < returnPct < +1.0 → BE (small positive, never LOSS)
 */

export type ExitOutcome = 'WIN' | 'LOSS' | 'BE';

export const EXIT_OUTCOME_THRESHOLDS = {
  /** +1.0% 이상은 명백한 WIN */
  WIN_PCT_MIN: 1.0,
  /** -0.5% 이하는 명백한 LOSS */
  LOSS_PCT_MAX: -0.5,
  /** BE 영역 하한 */
  BE_PCT_MIN: -0.5,
  /** BE 영역 상한 */
  BE_PCT_MAX: 0.5,
} as const;

const WIN_RULE_TAGS = new Set(['TARGET_EXIT', 'EUPHORIA_PARTIAL']);
const BE_PROTECTION_RULE_TAGS = new Set(['ENTRY_CIRCUIT_BREAKER']);

export function isBreakEvenClassificationDisabled(): boolean {
  return process.env.BE_CLASSIFICATION_DISABLED === 'true';
}

function isFiniteNumber(n: unknown): n is number {
  return typeof n === 'number' && Number.isFinite(n);
}

function isInBeBand(pct: number): boolean {
  return pct >= EXIT_OUTCOME_THRESHOLDS.BE_PCT_MIN && pct <= EXIT_OUTCOME_THRESHOLDS.BE_PCT_MAX;
}

/**
 * 청산 결과 분류. 서킷 카운트·통계 등 모든 호출자가 단일 SSOT 사용.
 *
 * @param returnPct 실현 수익률 (%)
 * @param exitRuleTag ExitRuleTag — 'TARGET_EXIT' / 'HARD_STOP' / ...
 * @param stopLossExitType ServerShadowTrade.stopLossExitType — PROFIT_PROTECTION 식별용
 */
export function classifyExitOutcome(
  returnPct: number,
  exitRuleTag?: string,
  stopLossExitType?: string,
): ExitOutcome {
  // (1) ENV 우회 — 기존 동작
  if (isBreakEvenClassificationDisabled()) {
    if (!isFiniteNumber(returnPct)) return 'LOSS';
    return returnPct >= EXIT_OUTCOME_THRESHOLDS.WIN_PCT_MIN ? 'WIN' : 'LOSS';
  }

  // (2) NaN/Infinity 안전 fallback → LOSS (서킷 보수적)
  if (!isFiniteNumber(returnPct)) return 'LOSS';

  // (3) 명시 WIN 룰
  if (exitRuleTag && WIN_RULE_TAGS.has(exitRuleTag)) return 'WIN';

  // (4) PROFIT_PROTECTION + BE band → BE (1차 로그 시나리오 핵심)
  if (stopLossExitType === 'PROFIT_PROTECTION' && isInBeBand(returnPct)) return 'BE';

  // (5) ENTRY_CIRCUIT_BREAKER 초기 진입 가드 + BE band → BE
  if (exitRuleTag && BE_PROTECTION_RULE_TAGS.has(exitRuleTag) && isInBeBand(returnPct)) return 'BE';

  // (6) 명백 WIN
  if (returnPct >= EXIT_OUTCOME_THRESHOLDS.WIN_PCT_MIN) return 'WIN';

  // (7) BE band 휴리스틱 (룰 미명시여도 등락이 본절 영역이면 BE)
  if (isInBeBand(returnPct)) return 'BE';
  if (returnPct > 0) return 'BE';

  // (8) 명백 LOSS
  if (returnPct < EXIT_OUTCOME_THRESHOLDS.LOSS_PCT_MAX) return 'LOSS';

  // (9) +0.5 < returnPct < +1.0 — small positive, never LOSS.
  return 'LOSS';
}

/**
 * fill-level 휴리스틱 분류 (aggregateFillStats 용).
 * fill 에는 exitRuleTag 가 없으므로 pnlPct 만 사용.
 */
export function classifyFillOutcome(pnlPct: number): ExitOutcome {
  if (isBreakEvenClassificationDisabled()) {
    if (!isFiniteNumber(pnlPct)) return 'LOSS';
    return pnlPct > 0 ? 'WIN' : pnlPct < 0 ? 'LOSS' : 'BE';
  }
  if (!isFiniteNumber(pnlPct)) return 'LOSS';
  if (pnlPct >= EXIT_OUTCOME_THRESHOLDS.WIN_PCT_MIN) return 'WIN';
  if (isInBeBand(pnlPct)) return 'BE';
  if (pnlPct > 0) return 'BE';
  return 'LOSS';
}

export type TradeLifecycleOutcome =
  | 'FULL_WIN'
  | 'PARTIAL_WIN'
  | 'WIN_BREAKEVEN'
  | 'BREAKEVEN'
  | 'SMALL_WIN'
  | 'SMALL_LOSS'
  | 'FULL_LOSS'
  | 'FORCED_EXIT';

type TradeLifecycleLearningTag =
  | 'TP1_THEN_BREAKEVEN'
  | 'PROFIT_PROTECTION_SUCCESS'
  | 'TRAILING_STOP_TO_ENTRY_SUCCESS'
  | 'TREND_EXTENSION_FAILED'
  | 'PARTIAL_PROFIT_PROTECTED'
  | 'BREAKEVEN_EXIT'
  | 'SMALL_WIN'
  | 'SMALL_LOSS'
  | 'FULL_TARGET_WIN'
  | 'FULL_STOP_LOSS'
  | 'FORCED_EXIT';

type LifecycleFillLike = {
  type?: string;
  subType?: string;
  qty?: number;
  price?: number;
  pnl?: number;
  pnlPct?: number;
  reason?: string;
  exitRuleTag?: string;
  timestamp?: string;
  confirmedAt?: string;
  status?: string;
};

export type TradeLifecycleTradeLike = {
  status?: string;
  exitOutcome?: ExitOutcome;
  exitRuleTag?: string;
  stopLossExitType?: string;
  signalPrice?: number;
  shadowEntryPrice?: number;
  entryPrice?: number;
  exitPrice?: number;
  returnPct?: number;
  targetPrice?: number;
  quantity?: number;
  originalQuantity?: number;
  fills?: LifecycleFillLike[];
  tradeLifecycleOutcome?: TradeLifecycleOutcome;
  breakevenStopMoved?: boolean;
  target1Hit?: boolean;
  target2Hit?: boolean;
  finalExitReason?: string;
};

export interface TradeLifecycleClassification {
  tradeLifecycleOutcome: TradeLifecycleOutcome;
  positionWin: boolean;
  economicWin: boolean;
  directionalWin: boolean;
  fullTargetWin: boolean;
  riskControlSuccess: boolean;
  learningTag: TradeLifecycleLearningTag;
  learningTags: TradeLifecycleLearningTag[];
  finalExitReason: string;
  target1Hit: boolean;
  target2Hit: boolean;
  breakevenStopMoved: boolean;
  finalExitNearEntry: boolean;
  finalExitReturnPct: number;
  realizedPnl: number;
  weightedPnlPct: number;
  labelSource: 'TRADE_LIFECYCLE_OUTCOME_SSOT';
  diagnosticOnly: true;
}

export interface TradeLifecycleOptions {
  breakevenBandPct?: number;
  fullWinPct?: number;
  smallLossPct?: number;
}

const TRADE_LIFECYCLE_DEFAULTS = {
  breakevenBandPct: 0.5,
  fullWinPct: 1.0,
  smallLossPct: -1.0,
} as const;

function isLifecycleSell(fill: LifecycleFillLike): boolean {
  return fill.type === 'SELL' && fill.status !== 'REVERTED';
}

function fillTime(fill: LifecycleFillLike): string {
  return fill.confirmedAt ?? fill.timestamp ?? '';
}

function isProfitTakingFill(fill: LifecycleFillLike): boolean {
  if (!isLifecycleSell(fill)) return false;
  if (fill.subType === 'PARTIAL_TP' || fill.subType === 'TRAILING_TP' || fill.subType === 'FULL_CLOSE') return true;
  if (fill.exitRuleTag && WIN_RULE_TAGS.has(fill.exitRuleTag)) return true;
  return (fill.pnl ?? 0) > 0 && fill.subType !== 'STOP_LOSS' && fill.subType !== 'EMERGENCY';
}

function finiteOrZero(value: unknown): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : 0;
}

function resolveEntryPrice(trade: TradeLifecycleTradeLike): number {
  return finiteOrZero(trade.shadowEntryPrice) || finiteOrZero(trade.signalPrice) || finiteOrZero(trade.entryPrice);
}

function resolveRealizedPnl(sells: LifecycleFillLike[]): number {
  const pnlFills = sells.filter((fill) => typeof fill.pnl === 'number' && Number.isFinite(fill.pnl));
  if (pnlFills.length === 0) return 0;
  return pnlFills.reduce((sum, fill) => sum + (fill.pnl ?? 0), 0);
}

function resolveWeightedPnlPct(trade: TradeLifecycleTradeLike, sells: LifecycleFillLike[]): number {
  const pctFills = sells.filter((fill) => typeof fill.pnlPct === 'number' && Number.isFinite(fill.pnlPct));
  const qtySum = pctFills.reduce((sum, fill) => sum + finiteOrZero(fill.qty), 0);
  if (qtySum > 0) return pctFills.reduce((sum, fill) => sum + (fill.pnlPct ?? 0) * finiteOrZero(fill.qty), 0) / qtySum;
  if (pctFills.length > 0) return pctFills.reduce((sum, fill) => sum + (fill.pnlPct ?? 0), 0) / pctFills.length;
  if (typeof trade.returnPct === 'number' && Number.isFinite(trade.returnPct)) return trade.returnPct;
  return 0;
}

function resolveFinalExitReturnPct(
  trade: TradeLifecycleTradeLike,
  finalSell: LifecycleFillLike | undefined,
  entryPrice: number,
): number {
  if (typeof finalSell?.pnlPct === 'number' && Number.isFinite(finalSell.pnlPct)) return finalSell.pnlPct;
  if (finalSell?.price && entryPrice > 0) return ((finalSell.price - entryPrice) / entryPrice) * 100;
  if (typeof trade.returnPct === 'number' && Number.isFinite(trade.returnPct)) return trade.returnPct;
  if (trade.exitPrice && entryPrice > 0) return ((trade.exitPrice - entryPrice) / entryPrice) * 100;
  return 0;
}

function withTags(
  tradeLifecycleOutcome: TradeLifecycleOutcome,
  learningTags: TradeLifecycleLearningTag[],
  finalExitReason: string,
  facts: Omit<TradeLifecycleClassification,
    'tradeLifecycleOutcome' | 'positionWin' | 'economicWin' | 'directionalWin' | 'fullTargetWin' |
    'riskControlSuccess' | 'learningTag' | 'learningTags' | 'finalExitReason' | 'labelSource' | 'diagnosticOnly'>,
): TradeLifecycleClassification {
  const economicWin = facts.realizedPnl > 0 || facts.weightedPnlPct > 0;
  const positionWin = ['FULL_WIN', 'PARTIAL_WIN', 'WIN_BREAKEVEN', 'SMALL_WIN'].includes(tradeLifecycleOutcome);
  const directionalWin = ['FULL_WIN', 'PARTIAL_WIN', 'WIN_BREAKEVEN'].includes(tradeLifecycleOutcome);
  const fullTargetWin = tradeLifecycleOutcome === 'FULL_WIN';
  const riskControlSuccess = ['FULL_WIN', 'PARTIAL_WIN', 'WIN_BREAKEVEN', 'BREAKEVEN', 'SMALL_WIN'].includes(tradeLifecycleOutcome);
  return {
    ...facts,
    tradeLifecycleOutcome,
    positionWin,
    economicWin,
    directionalWin,
    fullTargetWin,
    riskControlSuccess,
    learningTag: learningTags[0] ?? 'BREAKEVEN_EXIT',
    learningTags,
    finalExitReason,
    labelSource: 'TRADE_LIFECYCLE_OUTCOME_SSOT',
    diagnosticOnly: true,
  };
}

export function classifyTradeLifecycleOutcome(
  trade: TradeLifecycleTradeLike,
  options: TradeLifecycleOptions = {},
): TradeLifecycleClassification {
  const breakevenBandPct = options.breakevenBandPct ?? TRADE_LIFECYCLE_DEFAULTS.breakevenBandPct;
  const fullWinPct = options.fullWinPct ?? TRADE_LIFECYCLE_DEFAULTS.fullWinPct;
  const smallLossPct = options.smallLossPct ?? TRADE_LIFECYCLE_DEFAULTS.smallLossPct;
  const sells = [...(trade.fills ?? []).filter(isLifecycleSell)]
    .sort((a, b) => fillTime(a).localeCompare(fillTime(b)));
  const finalSell = sells[sells.length - 1];
  const priorSells = sells.slice(0, -1);
  const entryPrice = resolveEntryPrice(trade);
  const realizedPnl = resolveRealizedPnl(sells);
  const weightedPnlPct = resolveWeightedPnlPct(trade, sells);
  const finalExitReturnPct = resolveFinalExitReturnPct(trade, finalSell, entryPrice);
  const finalExitNearEntry = finalExitReturnPct >= -breakevenBandPct && finalExitReturnPct <= breakevenBandPct;
  const target1Hit = trade.target1Hit === true
    || priorSells.some(isProfitTakingFill)
    || sells.some((fill) => fill.subType === 'PARTIAL_TP' || fill.subType === 'TRAILING_TP');
  const target2Hit = trade.target2Hit === true || sells.some((fill) => fill.subType === 'FULL_CLOSE' || fill.exitRuleTag === 'TARGET_EXIT');
  const profitProtection = trade.stopLossExitType === 'PROFIT_PROTECTION';
  const breakevenStopMoved = trade.breakevenStopMoved === true || (target1Hit && finalExitNearEntry) || profitProtection;
  const finalExitReason = trade.finalExitReason
    ?? (target1Hit && finalExitNearEntry ? 'ENTRY_PRICE_STOP_AFTER_TP1'
      : profitProtection ? 'PROFIT_PROTECTION'
      : finalSell?.exitRuleTag
      ?? finalSell?.subType
      ?? trade.exitRuleTag
      ?? trade.status
      ?? 'UNKNOWN');
  const facts = {
    target1Hit,
    target2Hit,
    breakevenStopMoved,
    finalExitNearEntry,
    finalExitReturnPct,
    realizedPnl,
    weightedPnlPct,
  };

  if (sells.length === 0 && trade.exitOutcome === 'BE') {
    return withTags('BREAKEVEN', ['BREAKEVEN_EXIT'], finalExitReason, facts);
  }

  if (sells.length === 0 && trade.exitOutcome === 'LOSS' && !(typeof trade.returnPct === 'number' && trade.returnPct > 0)) {
    return withTags('FULL_LOSS', ['FULL_STOP_LOSS'], finalExitReason, facts);
  }

  if (
    sells.length === 0
    && trade.status === 'HIT_STOP'
    && trade.exitOutcome !== 'BE'
    && typeof trade.returnPct !== 'number'
    && typeof trade.exitPrice !== 'number'
  ) {
    return withTags('FULL_LOSS', ['FULL_STOP_LOSS'], finalExitReason, facts);
  }

  if (target1Hit && finalExitNearEntry && realizedPnl > 0) {
    return withTags('WIN_BREAKEVEN', [
      'TP1_THEN_BREAKEVEN',
      'PROFIT_PROTECTION_SUCCESS',
      'TRAILING_STOP_TO_ENTRY_SUCCESS',
      'TREND_EXTENSION_FAILED',
    ], 'ENTRY_PRICE_STOP_AFTER_TP1', facts);
  }

  if (target1Hit && realizedPnl > 0) {
    return withTags('PARTIAL_WIN', ['PARTIAL_PROFIT_PROTECTED'], finalExitReason, facts);
  }

  if (finalSell?.subType === 'EMERGENCY' && realizedPnl <= 0) {
    return withTags('FORCED_EXIT', ['FORCED_EXIT'], finalExitReason, facts);
  }

  if (target2Hit || trade.status === 'HIT_TARGET' || weightedPnlPct >= fullWinPct) {
    return withTags('FULL_WIN', ['FULL_TARGET_WIN'], finalExitReason, facts);
  }

  if (finalExitNearEntry && Math.abs(weightedPnlPct) <= breakevenBandPct) {
    return withTags('BREAKEVEN', ['BREAKEVEN_EXIT'], finalExitReason, facts);
  }

  if (weightedPnlPct > 0 || realizedPnl > 0) {
    return withTags('SMALL_WIN', ['SMALL_WIN'], finalExitReason, facts);
  }

  if (weightedPnlPct > smallLossPct) {
    return withTags('SMALL_LOSS', ['SMALL_LOSS'], finalExitReason, facts);
  }

  return withTags('FULL_LOSS', ['FULL_STOP_LOSS'], finalExitReason, facts);
}

export function formatTradeLifecycleOutcome(outcome: TradeLifecycleOutcome): string {
  switch (outcome) {
    case 'FULL_WIN': return '전량 익절';
    case 'PARTIAL_WIN': return '부분익절 종료';
    case 'WIN_BREAKEVEN': return '부분익절 후 본절 종료';
    case 'BREAKEVEN': return '본절 종료';
    case 'SMALL_WIN': return '소폭 수익 종료';
    case 'SMALL_LOSS': return '소손실 종료';
    case 'FULL_LOSS': return '손절 종료';
    case 'FORCED_EXIT': return '강제청산';
  }
}
