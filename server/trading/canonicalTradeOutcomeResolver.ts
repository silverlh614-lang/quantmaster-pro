// @responsibility Canonical position-level trade outcome resolver for LIVE/SHADOW/COUNTERFACTUAL samples.

export type TradeOutcome =
  | 'FULL_WIN'
  | 'PARTIAL_WIN'
  | 'PARTIAL_WIN_BREAKEVEN'
  | 'BREAKEVEN'
  | 'FULL_LOSS'
  | 'PARTIAL_LOSS'
  | 'FORCED_EXIT_WIN'
  | 'FORCED_EXIT_LOSS'
  | 'FORCED_EXIT_BREAKEVEN'
  | 'PENDING'
  | 'INVALID';

export type WinRateBucket =
  | 'WIN_FULL'
  | 'WIN_PARTIAL'
  | 'BREAKEVEN'
  | 'LOSS'
  | 'EXCLUDED';

export type ExitPath =
  | 'TP1_ONLY'
  | 'TP1_THEN_TP2'
  | 'TP1_THEN_BREAKEVEN_EXIT'
  | 'TP1_THEN_TRAILING_STOP'
  | 'STOP_LOSS_DIRECT'
  | 'BREAKEVEN_STOP_DIRECT'
  | 'TRAILING_STOP_WIN'
  | 'TIME_STOP'
  | 'R6_FORCE_EXIT'
  | 'MANUAL_EXIT'
  | 'UNKNOWN';

export type CanonicalTradeSource = 'LIVE' | 'SHADOW' | 'COUNTERFACTUAL';

export interface CanonicalTradeOutcome {
  tradeId: string;
  symbol: string;
  source: CanonicalTradeSource;

  grossReturnPct: number;
  netReturnPct?: number;
  returnR: number;

  realizedProfit: number;
  maxRiskAmount: number;

  entryPrice: number;
  avgExitPrice?: number;
  finalExitPrice?: number;

  totalQty: number;
  exitedQty: number;
  remainingQty: number;

  tp1Hit: boolean;
  tp2Hit?: boolean;
  stopHit: boolean;
  breakevenStopActivated: boolean;
  trailingStopActivated: boolean;
  forcedExit: boolean;

  outcome: TradeOutcome;
  winRateBucket: WinRateBucket;
  exitPath: ExitPath;

  attributionEligible: boolean;
  learningTags: string[];

  createdAt: string;
  updatedAt: string;
}

export interface ResolveCanonicalTradeOutcomeInput {
  tradeId: string;
  symbol: string;
  source: CanonicalTradeSource;

  grossReturnPct?: number;
  netReturnPct?: number;
  returnR?: number;

  realizedProfit?: number;
  maxRiskAmount?: number;

  entryPrice?: number;
  avgExitPrice?: number;
  finalExitPrice?: number;

  totalQty?: number;
  exitedQty?: number;
  remainingQty?: number;

  tp1Hit?: boolean;
  tp2Hit?: boolean;
  stopHit?: boolean;
  breakevenStopActivated?: boolean;
  trailingStopActivated?: boolean;
  forcedExit?: boolean;
  forcedExitReason?: string;
  exitPathHint?: ExitPath;

  createdAt?: string;
  updatedAt?: string;
  now?: string;
  breakevenPriceTolerancePct?: number;
}

interface ShadowFillLike {
  type?: 'BUY' | 'SELL' | string;
  subType?: string;
  qty?: number;
  price?: number;
  pnl?: number;
  pnlPct?: number;
  reason?: string;
  exitRuleTag?: string;
  status?: string;
  timestamp?: string;
  confirmedAt?: string;
}

export interface ShadowTradeOutcomeLike {
  id: string;
  stockCode: string;
  stockName?: string;
  signalPrice?: number;
  shadowEntryPrice?: number;
  entryPrice?: number;
  exitPrice?: number;
  stopLoss?: number;
  targetPrice?: number;
  quantity?: number;
  originalQuantity?: number;
  status?: string;
  returnPct?: number;
  fills?: ShadowFillLike[];
  target1Hit?: boolean;
  target2Hit?: boolean;
  breakevenStopMoved?: boolean;
  trailingEnabled?: boolean;
  stopLossExitType?: string;
  exitRuleTag?: string;
  finalExitReason?: string;
  r6EmergencySold?: boolean;
  mode?: 'LIVE' | 'SHADOW' | string;
}

function finiteNumber(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isFinite(value) ? value : undefined;
}

function finiteOrZero(value: unknown): number {
  return finiteNumber(value) ?? 0;
}

function isValidPositive(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value) && value > 0;
}

function normalizeQty(value: unknown): number | undefined {
  const qty = finiteNumber(value);
  return qty === undefined ? undefined : Math.max(0, qty);
}

function isNearEntryPrice(entryPrice: number, finalExitPrice: number | undefined, tolerancePct: number): boolean {
  if (!isValidPositive(entryPrice) || !isValidPositive(finalExitPrice)) return false;
  return Math.abs(finalExitPrice - entryPrice) / entryPrice <= tolerancePct;
}

function resolveReturnR(input: ResolveCanonicalTradeOutcomeInput): number {
  const direct = finiteNumber(input.returnR);
  if (direct !== undefined) return direct;
  const realizedProfit = finiteNumber(input.realizedProfit);
  const maxRiskAmount = finiteNumber(input.maxRiskAmount);
  if (realizedProfit !== undefined && maxRiskAmount !== undefined && maxRiskAmount > 0) {
    return realizedProfit / maxRiskAmount;
  }
  return 0;
}

function resolveExitPathForForced(input: ResolveCanonicalTradeOutcomeInput): ExitPath {
  if (input.exitPathHint) return input.exitPathHint;
  const reason = `${input.forcedExitReason ?? ''}`.toUpperCase();
  if (reason.includes('R6')) return 'R6_FORCE_EXIT';
  if (reason.includes('MANUAL')) return 'MANUAL_EXIT';
  return 'UNKNOWN';
}

function buildOutcome(
  input: ResolveCanonicalTradeOutcomeInput,
  outcome: TradeOutcome,
  winRateBucket: WinRateBucket,
  exitPath: ExitPath,
  facts: {
    grossReturnPct: number;
    returnR: number;
    realizedProfit: number;
    maxRiskAmount: number;
    entryPrice: number;
    totalQty: number;
    exitedQty: number;
    remainingQty: number;
    tp1Hit: boolean;
    tp2Hit: boolean;
    stopHit: boolean;
    breakevenStopActivated: boolean;
    trailingStopActivated: boolean;
    forcedExit: boolean;
    now: string;
  },
): CanonicalTradeOutcome {
  const learningTags = [
    outcome,
    winRateBucket,
    exitPath,
    `${input.source}_OUTCOME`,
  ];
  if (outcome === 'PARTIAL_WIN_BREAKEVEN') learningTags.push('TP1_THEN_BREAKEVEN_EXIT');
  if (outcome === 'PARTIAL_WIN') learningTags.push('PARTIAL_PROFIT_PROTECTED');
  if (outcome === 'BREAKEVEN') learningTags.push('BREAKEVEN_EXIT');
  if (outcome === 'FULL_LOSS') learningTags.push('FULL_STOP_LOSS');
  if (outcome.startsWith('FORCED_EXIT')) learningTags.push('FORCED_EXIT');

  return {
    tradeId: input.tradeId,
    symbol: input.symbol,
    source: input.source,
    grossReturnPct: facts.grossReturnPct,
    netReturnPct: input.netReturnPct,
    returnR: facts.returnR,
    realizedProfit: facts.realizedProfit,
    maxRiskAmount: facts.maxRiskAmount,
    entryPrice: facts.entryPrice,
    avgExitPrice: input.avgExitPrice,
    finalExitPrice: input.finalExitPrice,
    totalQty: facts.totalQty,
    exitedQty: facts.exitedQty,
    remainingQty: facts.remainingQty,
    tp1Hit: facts.tp1Hit,
    tp2Hit: facts.tp2Hit,
    stopHit: facts.stopHit,
    breakevenStopActivated: facts.breakevenStopActivated,
    trailingStopActivated: facts.trailingStopActivated,
    forcedExit: facts.forcedExit,
    outcome,
    winRateBucket,
    exitPath,
    attributionEligible: winRateBucket !== 'EXCLUDED',
    learningTags: [...new Set(learningTags)],
    createdAt: input.createdAt ?? facts.now,
    updatedAt: input.updatedAt ?? facts.now,
  };
}

export function resolveCanonicalTradeOutcome(
  input: ResolveCanonicalTradeOutcomeInput,
): CanonicalTradeOutcome {
  const now = input.now ?? new Date().toISOString();
  const entryPrice = finiteOrZero(input.entryPrice);
  const totalQty = normalizeQty(input.totalQty) ?? 0;
  const finalExitPrice = finiteNumber(input.finalExitPrice);
  const remainingQty = normalizeQty(input.remainingQty)
    ?? (finalExitPrice === undefined ? Math.max(0, totalQty - (normalizeQty(input.exitedQty) ?? 0)) : 0);
  const exitedQty = normalizeQty(input.exitedQty) ?? Math.max(0, totalQty - remainingQty);
  const realizedProfit = finiteOrZero(input.realizedProfit);
  const maxRiskAmount = finiteOrZero(input.maxRiskAmount);
  const returnR = resolveReturnR(input);
  const grossReturnPct = finiteNumber(input.grossReturnPct)
    ?? (isValidPositive(entryPrice) && isValidPositive(finalExitPrice)
      ? ((finalExitPrice - entryPrice) / entryPrice) * 100
      : 0);
  const tp1Hit = input.tp1Hit === true;
  const tp2Hit = input.tp2Hit === true;
  const stopHit = input.stopHit === true;
  const breakevenStopActivated = input.breakevenStopActivated === true;
  const trailingStopActivated = input.trailingStopActivated === true;
  const forcedExit = input.forcedExit === true;
  const facts = {
    grossReturnPct,
    returnR,
    realizedProfit,
    maxRiskAmount,
    entryPrice,
    totalQty,
    exitedQty,
    remainingQty,
    tp1Hit,
    tp2Hit,
    stopHit,
    breakevenStopActivated,
    trailingStopActivated,
    forcedExit,
    now,
  };

  if (!isValidPositive(entryPrice) || !isValidPositive(totalQty) || !isValidPositive(maxRiskAmount)) {
    return buildOutcome(input, 'INVALID', 'EXCLUDED', 'UNKNOWN', facts);
  }

  if (remainingQty > 0 && finalExitPrice === undefined) {
    return buildOutcome(input, 'PENDING', 'EXCLUDED', 'UNKNOWN', facts);
  }

  if (forcedExit) {
    const exitPath = resolveExitPathForForced(input);
    if (Math.abs(returnR) <= 0.05) {
      return buildOutcome(input, 'FORCED_EXIT_BREAKEVEN', 'BREAKEVEN', exitPath, facts);
    }
    if (returnR > 0) {
      return buildOutcome(input, 'FORCED_EXIT_WIN', 'WIN_PARTIAL', exitPath, facts);
    }
    return buildOutcome(input, 'FORCED_EXIT_LOSS', 'LOSS', exitPath, facts);
  }

  const nearEntry = isNearEntryPrice(
    entryPrice,
    finalExitPrice,
    input.breakevenPriceTolerancePct ?? 0.005,
  );

  if (tp1Hit && breakevenStopActivated && nearEntry && returnR > 0) {
    return buildOutcome(input, 'PARTIAL_WIN_BREAKEVEN', 'WIN_PARTIAL', 'TP1_THEN_BREAKEVEN_EXIT', facts);
  }

  if (tp1Hit && trailingStopActivated && returnR > 0) {
    return buildOutcome(input, 'PARTIAL_WIN', 'WIN_PARTIAL', 'TP1_THEN_TRAILING_STOP', facts);
  }

  if (returnR > 0 && (tp1Hit || tp2Hit) && remainingQty === 0 && !stopHit) {
    return buildOutcome(input, 'FULL_WIN', 'WIN_FULL', tp2Hit ? 'TP1_THEN_TP2' : 'TP1_ONLY', facts);
  }

  if (!tp1Hit && Math.abs(returnR) <= 0.05) {
    return buildOutcome(input, 'BREAKEVEN', 'BREAKEVEN', 'BREAKEVEN_STOP_DIRECT', facts);
  }

  if (!tp1Hit && stopHit && returnR < 0) {
    return buildOutcome(input, 'FULL_LOSS', 'LOSS', 'STOP_LOSS_DIRECT', facts);
  }

  if (tp1Hit && returnR > 0) {
    return buildOutcome(input, 'PARTIAL_WIN', 'WIN_PARTIAL', input.exitPathHint ?? 'UNKNOWN', facts);
  }

  if (tp1Hit && returnR < 0) {
    return buildOutcome(input, 'PARTIAL_LOSS', 'LOSS', input.exitPathHint ?? 'UNKNOWN', facts);
  }

  if (returnR > 0) {
    return buildOutcome(input, 'FULL_WIN', 'WIN_FULL', input.exitPathHint ?? 'UNKNOWN', facts);
  }

  if (Math.abs(returnR) <= 0.05) {
    return buildOutcome(input, 'BREAKEVEN', 'BREAKEVEN', input.exitPathHint ?? 'UNKNOWN', facts);
  }

  return buildOutcome(input, 'FULL_LOSS', 'LOSS', stopHit ? 'STOP_LOSS_DIRECT' : 'UNKNOWN', facts);
}

function isActiveFill(fill: ShadowFillLike): boolean {
  return fill.status !== 'REVERTED';
}

function fillTime(fill: ShadowFillLike): string {
  return fill.confirmedAt ?? fill.timestamp ?? '';
}

function isSell(fill: ShadowFillLike): boolean {
  return fill.type === 'SELL' && isActiveFill(fill);
}

function isBuy(fill: ShadowFillLike): boolean {
  return fill.type === 'BUY' && isActiveFill(fill);
}

function isProfitTakingFill(fill: ShadowFillLike): boolean {
  if (!isSell(fill)) return false;
  if (fill.subType === 'PARTIAL_TP' || fill.subType === 'TRAILING_TP' || fill.subType === 'FULL_CLOSE') return true;
  if (fill.exitRuleTag === 'TARGET_EXIT' || fill.exitRuleTag === 'EUPHORIA_PARTIAL') return true;
  return (fill.pnl ?? 0) > 0 && fill.subType !== 'STOP_LOSS' && fill.subType !== 'EMERGENCY';
}

function weightedSellPnlPct(trade: ShadowTradeOutcomeLike, sells: ShadowFillLike[]): number {
  const pctFills = sells.filter((fill) => finiteNumber(fill.pnlPct) !== undefined);
  const qtySum = pctFills.reduce((sum, fill) => sum + finiteOrZero(fill.qty), 0);
  if (qtySum > 0) return pctFills.reduce((sum, fill) => sum + finiteOrZero(fill.pnlPct) * finiteOrZero(fill.qty), 0) / qtySum;
  if (pctFills.length > 0) return pctFills.reduce((sum, fill) => sum + finiteOrZero(fill.pnlPct), 0) / pctFills.length;
  return finiteOrZero(trade.returnPct);
}

function averageExitPrice(sells: ShadowFillLike[]): number | undefined {
  const priced = sells.filter((fill) => isValidPositive(fill.price));
  const qtySum = priced.reduce((sum, fill) => sum + finiteOrZero(fill.qty), 0);
  if (qtySum > 0) return priced.reduce((sum, fill) => sum + finiteOrZero(fill.price) * finiteOrZero(fill.qty), 0) / qtySum;
  if (priced.length > 0) return priced.reduce((sum, fill) => sum + finiteOrZero(fill.price), 0) / priced.length;
  return undefined;
}

function includesAny(text: string | undefined, needles: string[]): boolean {
  const upper = `${text ?? ''}`.toUpperCase();
  return needles.some((needle) => upper.includes(needle));
}

export function resolveCanonicalTradeOutcomeFromShadowTrade(
  trade: ShadowTradeOutcomeLike,
  opts: { now?: string; source?: CanonicalTradeSource } = {},
): CanonicalTradeOutcome {
  const fills = trade.fills ?? [];
  const buys = fills.filter(isBuy);
  const sells = fills.filter(isSell).sort((a, b) => fillTime(a).localeCompare(fillTime(b)));
  const finalSell = sells[sells.length - 1];
  const priorSells = sells.slice(0, -1);
  const buyQty = buys.reduce((sum, fill) => sum + finiteOrZero(fill.qty), 0);
  const sellQty = sells.reduce((sum, fill) => sum + finiteOrZero(fill.qty), 0);
  const totalQty = normalizeQty(trade.originalQuantity)
    ?? (buyQty > 0 ? buyQty : normalizeQty(trade.quantity) ?? 0);
  const isClosedStatus = trade.status === 'HIT_TARGET' || trade.status === 'HIT_STOP' || trade.status === 'REJECTED';
  const remainingQty = buyQty > 0
    ? Math.max(0, buyQty - sellQty)
    : (isClosedStatus ? 0 : normalizeQty(trade.quantity) ?? 0);
  const entryPrice = finiteNumber(trade.shadowEntryPrice) ?? finiteNumber(trade.entryPrice) ?? finiteNumber(trade.signalPrice) ?? 0;
  const avgExitPrice = averageExitPrice(sells);
  const finalExitPrice = finiteNumber(finalSell?.price) ?? finiteNumber(trade.exitPrice);
  const realizedProfit = sells.reduce((sum, fill) => sum + finiteOrZero(fill.pnl), 0);
  const inferredRealizedProfit = realizedProfit !== 0
    ? realizedProfit
    : (finiteNumber(trade.returnPct) !== undefined && isValidPositive(entryPrice) && totalQty > 0
      ? entryPrice * totalQty * (finiteOrZero(trade.returnPct) / 100)
      : 0);
  const stopLoss = finiteNumber(trade.stopLoss);
  const maxRiskAmount = isValidPositive(entryPrice) && isValidPositive(stopLoss) && entryPrice > stopLoss
    ? (entryPrice - stopLoss) * totalQty
    : 0;
  const tp1Hit = trade.target1Hit === true
    || priorSells.some(isProfitTakingFill)
    || sells.some((fill) => fill.subType === 'PARTIAL_TP' || fill.subType === 'TRAILING_TP');
  const tp2Hit = trade.target2Hit === true
    || trade.status === 'HIT_TARGET'
    || sells.some((fill) => fill.subType === 'FULL_CLOSE' || fill.exitRuleTag === 'TARGET_EXIT');
  const finalNearEntry = isNearEntryPrice(entryPrice, finalExitPrice, 0.005);
  const breakevenStopActivated = trade.breakevenStopMoved === true
    || trade.stopLossExitType === 'PROFIT_PROTECTION'
    || (tp1Hit && finalNearEntry);
  const trailingStopActivated = trade.trailingEnabled === true
    || sells.some((fill) => fill.subType === 'TRAILING_TP')
    || includesAny(trade.finalExitReason, ['TRAILING']);
  const forcedExit = trade.r6EmergencySold === true
    || finalSell?.subType === 'EMERGENCY'
    || includesAny(finalSell?.reason, ['R6', 'EMERGENCY', 'FORCE'])
    || includesAny(finalSell?.exitRuleTag, ['R6', 'EMERGENCY', 'FORCE', 'MA60_DEATH'])
    || includesAny(trade.exitRuleTag, ['R6', 'EMERGENCY', 'FORCE', 'MA60_DEATH'])
    || includesAny(trade.finalExitReason, ['R6', 'EMERGENCY', 'FORCE', 'MA60_DEATH']);

  return resolveCanonicalTradeOutcome({
    tradeId: trade.id,
    symbol: trade.stockCode,
    source: opts.source ?? (trade.mode === 'LIVE' ? 'LIVE' : 'SHADOW'),
    grossReturnPct: weightedSellPnlPct(trade, sells),
    returnR: maxRiskAmount > 0 ? inferredRealizedProfit / maxRiskAmount : undefined,
    realizedProfit: inferredRealizedProfit,
    maxRiskAmount,
    entryPrice,
    avgExitPrice,
    finalExitPrice,
    totalQty,
    exitedQty: sellQty,
    remainingQty,
    tp1Hit,
    tp2Hit,
    stopHit: trade.status === 'HIT_STOP' || finalSell?.subType === 'STOP_LOSS' || finalSell?.subType === 'EMERGENCY',
    breakevenStopActivated,
    trailingStopActivated,
    forcedExit,
    forcedExitReason: trade.finalExitReason ?? finalSell?.reason ?? finalSell?.exitRuleTag ?? trade.exitRuleTag,
    now: opts.now,
  });
}

export function describeCanonicalTradeOutcome(outcome: TradeOutcome): string {
  switch (outcome) {
    case 'FULL_WIN':
      return '전량 목표가 익절로 종료되었습니다.';
    case 'PARTIAL_WIN':
      return '부분익절 후 남은 물량도 수익권에서 종료되었습니다.';
    case 'PARTIAL_WIN_BREAKEVEN':
      return '1차 익절 후 잔여 물량은 본절로 보호 청산되었습니다.';
    case 'BREAKEVEN':
      return '순손익이 본절권으로 종료되었습니다.';
    case 'FULL_LOSS':
      return '직접 손절로 종료되었습니다.';
    case 'PARTIAL_LOSS':
      return '부분익절 이력은 있으나 최종 R 기준 손실로 종료되었습니다.';
    case 'FORCED_EXIT_WIN':
      return '강제청산이었지만 최종 R은 수익입니다.';
    case 'FORCED_EXIT_LOSS':
      return '강제청산 결과 최종 R은 손실입니다.';
    case 'FORCED_EXIT_BREAKEVEN':
      return '강제청산 결과 최종 R은 본절권입니다.';
    case 'PENDING':
      return '아직 종료되지 않아 승률 집계에서 제외됩니다.';
    case 'INVALID':
      return '필수 가격/수량/리스크 정보가 부족해 집계에서 제외됩니다.';
  }
}

export function formatCanonicalTradeOutcomeTelegram(
  outcome: CanonicalTradeOutcome,
  title = '[거래 청산 결과]',
): string {
  const sign = outcome.returnR > 0 ? '+' : '';
  return [
    title,
    `종목: ${outcome.symbol}`,
    `결과: ${outcome.outcome}`,
    `승률 반영: ${outcome.winRateBucket}`,
    `실현 R: ${sign}${outcome.returnR.toFixed(2)}R`,
    `경로: ${outcome.exitPath}`,
    `설명: ${describeCanonicalTradeOutcome(outcome.outcome)}`,
  ].join('\n');
}
