// @responsibility Trade lifecycle outcome SSOT for exit, learning, Telegram, and stats.

export type TradeLifecycleOutcome =
  | 'FULL_TAKE_PROFIT'
  | 'PARTIAL_TAKE_PROFIT_OPEN'
  | 'TP1_THEN_BREAKEVEN'
  | 'TP1_THEN_TRAILING_STOP'
  | 'TP1_THEN_STOP_LOSS_PROFIT_RETAINED'
  | 'BREAKEVEN_EXIT'
  | 'STOP_LOSS'
  | 'TIME_STOP'
  | 'MANUAL_EXIT'
  | 'FORCED_EXIT'
  | 'DATA_INVALID_EXIT'
  | 'UNKNOWN';

export type TradeOutcomeClass =
  | 'WIN'
  | 'WIN_BREAKEVEN'
  | 'BREAKEVEN'
  | 'LOSS'
  | 'OPEN'
  | 'UNKNOWN';

export type LifecycleExitStage =
  | 'ENTRY'
  | 'TP1_HIT'
  | 'TP2_HIT'
  | 'STOP_MOVED_TO_BREAKEVEN'
  | 'TRAILING_ACTIVE'
  | 'FINAL_EXIT'
  | 'CLOSED';

export interface TradeLifecycleState {
  positionId: string;
  symbol: string;
  mode: 'LIVE' | 'SHADOW' | 'PAPER' | 'VIRTUAL';
  entryPrice: number;
  initialStopLoss: number;
  currentStopLoss: number;
  targetPrice1?: number;
  targetPrice2?: number;
  tp1Hit: boolean;
  tp1HitAt?: string;
  tp1Price?: number;
  tp1RealizedPnL?: number;
  tp1RealizedPnLPct?: number;
  tp1QuantityPct?: number;
  stopMovedToBreakeven: boolean;
  breakevenPrice?: number;
  stopMovedAt?: string;
  trailingActivated: boolean;
  finalExitPrice?: number;
  finalExitAt?: string;
  finalExitReason?: string;
  totalRealizedPnL: number;
  totalRealizedPnLPct: number;
  lifecycleOutcome: TradeLifecycleOutcome;
  outcomeClass: TradeOutcomeClass;
}

export interface ResolveTradeLifecycleOutcomeInput {
  positionId?: string;
  symbol?: string;
  mode?: 'LIVE' | 'SHADOW' | 'PAPER' | 'VIRTUAL';
  status?: 'OPEN' | 'PARTIALLY_CLOSED' | 'CLOSED' | string;
  entryPrice: number;
  initialStopLoss: number;
  finalExitPrice: number;
  totalRealizedPnL: number;
  totalRealizedPnLPct: number;
  tp1Hit: boolean;
  tp1RealizedPnL?: number;
  stopMovedToBreakeven: boolean;
  trailingActivated?: boolean;
  finalExitReason: string;
  remainingQuantity?: number;
  remainingExitPnL?: number;
  remainingExitPnLPct?: number;
  resolvedAt?: string;
}

export interface TradeLifecycleOutcomeResult {
  positionId?: string;
  symbol?: string;
  mode?: 'LIVE' | 'SHADOW' | 'PAPER' | 'VIRTUAL';
  entryPrice: number;
  initialStopLoss: number;
  finalExitPrice: number;
  finalExitReason: string;
  tp1Hit: boolean;
  stopMovedToBreakeven: boolean;
  trailingActivated: boolean;
  totalRealizedPnL: number;
  totalRealizedPnLPct: number;
  lifecycleOutcome: TradeLifecycleOutcome;
  outcomeClass: TradeOutcomeClass;
  resolvedBy: 'TradeLifecycleOutcomeResolver';
  resolvedAt: string;
}

export interface TradeLifecycleFillLike {
  type?: string;
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

export interface TradeLifecycleTradeLike {
  id?: string;
  stockCode?: string;
  stockName?: string;
  mode?: 'LIVE' | 'SHADOW' | 'PAPER' | 'VIRTUAL' | string;
  status?: string;
  signalPrice?: number;
  shadowEntryPrice?: number;
  entryPrice?: number;
  stopLoss?: number;
  targetPrice?: number;
  exitPrice?: number;
  exitTime?: string;
  quantity?: number;
  originalQuantity?: number;
  returnPct?: number;
  target1Hit?: boolean;
  target2Hit?: boolean;
  breakevenStopMoved?: boolean;
  trailingEnabled?: boolean;
  stopLossExitType?: string;
  finalExitReason?: string;
  exitRuleTag?: string;
  fills?: TradeLifecycleFillLike[];
}

export interface TradeOutcomeStats {
  winCount: number;
  lossCount: number;
  breakevenCount: number;
  openCount: number;
  unknownCount: number;
  closedCountForWinRate: number;
  winRate: number;
}

export interface ShadowLearningLifecycleOutcome {
  learningOutcome: TradeLifecycleOutcome;
  learningClass: TradeOutcomeClass;
  learningLabels: string[];
}

function finite(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

function finiteOrZero(value: unknown): number {
  return finite(value) ?? 0;
}

function upper(value: string | undefined): string {
  return String(value ?? '').trim().toUpperCase();
}

function kv(key: string, value: unknown): string {
  return `${key}=${value === undefined || value === null ? 'none' : String(value)}`;
}

function isNearEntry(input: ResolveTradeLifecycleOutcomeInput): boolean {
  const entryPrice = finite(input.entryPrice);
  const finalExitPrice = finite(input.finalExitPrice);
  if (entryPrice === null || finalExitPrice === null || entryPrice <= 0) return false;
  return Math.abs((finalExitPrice - entryPrice) / entryPrice) * 100 <= 0.3;
}

function isRemainingExitNearBreakeven(input: ResolveTradeLifecycleOutcomeInput): boolean {
  const pct = finite(input.remainingExitPnLPct);
  if (pct === null) return false;
  return pct >= -0.3 && pct <= 0.3;
}

function hasInvalidCoreData(input: ResolveTradeLifecycleOutcomeInput): boolean {
  return finite(input.entryPrice) === null
    || finite(input.initialStopLoss) === null
    || finite(input.finalExitPrice) === null
    || finite(input.totalRealizedPnL) === null
    || finite(input.totalRealizedPnLPct) === null
    || input.finalExitReason.trim().length === 0;
}

function result(
  input: ResolveTradeLifecycleOutcomeInput,
  lifecycleOutcome: TradeLifecycleOutcome,
  outcomeClass: TradeOutcomeClass,
): TradeLifecycleOutcomeResult {
  return {
    positionId: input.positionId,
    symbol: input.symbol,
    mode: input.mode,
    entryPrice: finiteOrZero(input.entryPrice),
    initialStopLoss: finiteOrZero(input.initialStopLoss),
    finalExitPrice: finiteOrZero(input.finalExitPrice),
    finalExitReason: input.finalExitReason,
    tp1Hit: input.tp1Hit,
    stopMovedToBreakeven: input.stopMovedToBreakeven,
    trailingActivated: input.trailingActivated === true,
    totalRealizedPnL: finiteOrZero(input.totalRealizedPnL),
    totalRealizedPnLPct: finiteOrZero(input.totalRealizedPnLPct),
    lifecycleOutcome,
    outcomeClass,
    resolvedBy: 'TradeLifecycleOutcomeResolver',
    resolvedAt: input.resolvedAt ?? new Date().toISOString(),
  };
}

function classByPnl(totalRealizedPnL: number, totalRealizedPnLPct: number): TradeOutcomeClass {
  if (totalRealizedPnL > 0 || totalRealizedPnLPct > 0.3) return 'WIN';
  if (totalRealizedPnL < 0 || totalRealizedPnLPct < -0.3) return 'LOSS';
  return 'BREAKEVEN';
}

export function resolveTradeLifecycleOutcome(
  input: ResolveTradeLifecycleOutcomeInput,
): TradeLifecycleOutcomeResult {
  if (hasInvalidCoreData(input)) return result(input, 'UNKNOWN', 'UNKNOWN');

  const reason = upper(input.finalExitReason);
  const totalRealizedPnL = finiteOrZero(input.totalRealizedPnL);
  const totalRealizedPnLPct = finiteOrZero(input.totalRealizedPnLPct);
  const remainingQuantity = Math.max(0, finiteOrZero(input.remainingQuantity));
  const status = upper(input.status);
  const tp1Hit = input.tp1Hit === true;
  const stopMoved = input.stopMovedToBreakeven === true;
  const trailing = input.trailingActivated === true;

  if (reason === 'DATA_INVALID_EXIT') return result(input, 'DATA_INVALID_EXIT', 'UNKNOWN');
  if (reason === 'FORCED_EXIT' || reason.includes('EMERGENCY') || reason.includes('FORCE')) {
    return result(input, 'FORCED_EXIT', classByPnl(totalRealizedPnL, totalRealizedPnLPct));
  }
  if (reason === 'TAKE_PROFIT' || reason === 'FULL_TAKE_PROFIT' || reason === 'TARGET_EXIT') {
    if (totalRealizedPnL > 0) return result(input, 'FULL_TAKE_PROFIT', 'WIN');
  }
  if (tp1Hit && status === 'PARTIALLY_CLOSED' && remainingQuantity > 0) {
    return result(input, 'PARTIAL_TAKE_PROFIT_OPEN', 'OPEN');
  }
  if (
    tp1Hit
    && stopMoved
    && ['STOP_LOSS', 'BREAKEVEN', 'TRAILING_STOP'].includes(reason)
    && totalRealizedPnL >= 0
    && (isNearEntry(input) || isRemainingExitNearBreakeven(input))
  ) {
    return result(input, 'TP1_THEN_BREAKEVEN', 'WIN_BREAKEVEN');
  }
  if (tp1Hit && trailing && totalRealizedPnL > 0 && reason === 'TRAILING_STOP') {
    return result(input, 'TP1_THEN_TRAILING_STOP', 'WIN');
  }
  if (tp1Hit && reason === 'STOP_LOSS' && totalRealizedPnL > 0) {
    return result(input, 'TP1_THEN_STOP_LOSS_PROFIT_RETAINED', 'WIN');
  }
  if (!tp1Hit && Math.abs(totalRealizedPnLPct) <= 0.3) {
    return result(input, 'BREAKEVEN_EXIT', 'BREAKEVEN');
  }
  if (!tp1Hit && reason === 'STOP_LOSS' && totalRealizedPnL < 0) {
    return result(input, 'STOP_LOSS', 'LOSS');
  }
  if (reason === 'TIME_STOP') {
    return result(input, 'TIME_STOP', classByPnl(totalRealizedPnL, totalRealizedPnLPct));
  }
  if (reason === 'MANUAL_EXIT') {
    return result(input, 'MANUAL_EXIT', classByPnl(totalRealizedPnL, totalRealizedPnLPct));
  }
  return result(input, 'UNKNOWN', classByPnl(totalRealizedPnL, totalRealizedPnLPct));
}

function isActiveSell(fill: TradeLifecycleFillLike): boolean {
  return fill.type === 'SELL' && fill.status !== 'REVERTED';
}

function isActiveBuy(fill: TradeLifecycleFillLike): boolean {
  return fill.type === 'BUY' && fill.status !== 'REVERTED';
}

function isProfitTakingFill(fill: TradeLifecycleFillLike): boolean {
  if (!isActiveSell(fill)) return false;
  if (fill.subType === 'PARTIAL_TP' || fill.subType === 'TRAILING_TP' || fill.subType === 'FULL_CLOSE') return true;
  if (fill.exitRuleTag === 'TARGET_EXIT' || fill.exitRuleTag === 'EUPHORIA_PARTIAL') return true;
  return finiteOrZero(fill.pnl) > 0 && fill.subType !== 'STOP_LOSS' && fill.subType !== 'EMERGENCY';
}

function fillTime(fill: TradeLifecycleFillLike): string {
  return fill.confirmedAt ?? fill.timestamp ?? '';
}

function resolveWeightedPnlPct(trade: TradeLifecycleTradeLike, sells: TradeLifecycleFillLike[]): number {
  const pctFills = sells.filter((fill) => finite(fill.pnlPct) !== null);
  const qtySum = pctFills.reduce((sum, fill) => sum + finiteOrZero(fill.qty), 0);
  if (qtySum > 0) {
    return pctFills.reduce((sum, fill) => sum + finiteOrZero(fill.pnlPct) * finiteOrZero(fill.qty), 0) / qtySum;
  }
  if (pctFills.length > 0) {
    return pctFills.reduce((sum, fill) => sum + finiteOrZero(fill.pnlPct), 0) / pctFills.length;
  }
  return finiteOrZero(trade.returnPct);
}

function inferFinalExitReason(trade: TradeLifecycleTradeLike, finalSell: TradeLifecycleFillLike | undefined): string {
  if (finalSell?.subType === 'STOP_LOSS') return 'STOP_LOSS';
  if (finalSell?.subType === 'TRAILING_TP' || upper(finalSell?.reason).includes('TRAILING')) return 'TRAILING_STOP';
  if (finalSell?.subType === 'FULL_CLOSE' || finalSell?.exitRuleTag === 'TARGET_EXIT') return 'TAKE_PROFIT';
  if (trade.status === 'HIT_TARGET') return 'TAKE_PROFIT';
  if (trade.status === 'HIT_STOP') return 'STOP_LOSS';
  const explicit = trade.finalExitReason ?? finalSell?.reason ?? finalSell?.exitRuleTag ?? finalSell?.subType ?? trade.exitRuleTag;
  if (explicit) return explicit;
  return 'UNKNOWN';
}

export function resolveTradeLifecycleOutcomeFromShadowTrade(
  trade: TradeLifecycleTradeLike,
  overrides: Partial<ResolveTradeLifecycleOutcomeInput> = {},
): TradeLifecycleOutcomeResult {
  const fills = trade.fills ?? [];
  const buys = fills.filter(isActiveBuy);
  const sells = fills.filter(isActiveSell).sort((a, b) => fillTime(a).localeCompare(fillTime(b)));
  const finalSell = sells[sells.length - 1];
  const priorSells = sells.slice(0, -1);
  const buyQty = buys.reduce((sum, fill) => sum + finiteOrZero(fill.qty), 0);
  const sellQty = sells.reduce((sum, fill) => sum + finiteOrZero(fill.qty), 0);
  const totalQty = finite(trade.originalQuantity) ?? (buyQty > 0 ? buyQty : finiteOrZero(trade.quantity));
  const remainingQuantity = buyQty > 0
    ? Math.max(0, buyQty - sellQty)
    : Math.max(0, finiteOrZero(trade.quantity));
  const entryPrice = finite(trade.shadowEntryPrice) ?? finite(trade.entryPrice) ?? finite(trade.signalPrice) ?? 0;
  const finalExitPrice = finite(finalSell?.price) ?? finite(trade.exitPrice) ?? entryPrice;
  const totalRealizedPnL = sells.reduce((sum, fill) => sum + finiteOrZero(fill.pnl), 0);
  const totalRealizedPnLPct = resolveWeightedPnlPct(trade, sells);
  const tp1Hit = trade.target1Hit === true
    || priorSells.some(isProfitTakingFill)
    || sells.some((fill) => fill.subType === 'PARTIAL_TP' || fill.subType === 'TRAILING_TP');
  const stopMovedToBreakeven = trade.breakevenStopMoved === true
    || trade.stopLossExitType === 'PROFIT_PROTECTION'
    || (tp1Hit && entryPrice > 0 && Math.abs((finalExitPrice - entryPrice) / entryPrice) * 100 <= 0.3);
  const trailingActivated = trade.trailingEnabled === true
    || sells.some((fill) => fill.subType === 'TRAILING_TP')
    || upper(trade.finalExitReason).includes('TRAILING');

  return resolveTradeLifecycleOutcome({
    positionId: trade.id,
    symbol: trade.stockCode,
    mode: trade.mode === 'LIVE' ? 'LIVE' : trade.mode === 'PAPER' ? 'PAPER' : trade.mode === 'VIRTUAL' ? 'VIRTUAL' : 'SHADOW',
    status: remainingQuantity > 0 && sells.length > 0 ? 'PARTIALLY_CLOSED' : 'CLOSED',
    entryPrice,
    initialStopLoss: finiteOrZero(trade.stopLoss),
    tp1Hit,
    tp1RealizedPnL: priorSells.reduce((sum, fill) => sum + finiteOrZero(fill.pnl), 0),
    stopMovedToBreakeven,
    trailingActivated,
    remainingExitPnL: finite(finalSell?.pnl) ?? undefined,
    remainingExitPnLPct: finite(finalSell?.pnlPct) ?? undefined,
    ...overrides,
    totalRealizedPnL: overrides.totalRealizedPnL ?? totalRealizedPnL,
    totalRealizedPnLPct: overrides.totalRealizedPnLPct ?? totalRealizedPnLPct,
    finalExitPrice: overrides.finalExitPrice ?? finalExitPrice,
    finalExitReason: overrides.finalExitReason ?? inferFinalExitReason(trade, finalSell),
    remainingQuantity: overrides.remainingQuantity ?? remainingQuantity,
  });
}

export function formatTradeLifecycleOutcome(outcome: TradeLifecycleOutcome): string {
  switch (outcome) {
    case 'FULL_TAKE_PROFIT': return '전량 익절';
    case 'PARTIAL_TAKE_PROFIT_OPEN': return '부분익절 후 보유 중';
    case 'TP1_THEN_BREAKEVEN': return '부분익절 후 본절 종료';
    case 'TP1_THEN_TRAILING_STOP': return '부분익절 후 트레일링 종료';
    case 'TP1_THEN_STOP_LOSS_PROFIT_RETAINED': return '부분익절 후 잔여 손절, 총수익 유지';
    case 'BREAKEVEN_EXIT': return '본절 종료';
    case 'STOP_LOSS': return '손절 종료';
    case 'TIME_STOP': return '시간 청산';
    case 'MANUAL_EXIT': return '수동 청산';
    case 'FORCED_EXIT': return '강제 청산';
    case 'DATA_INVALID_EXIT': return '데이터 불완전 청산';
    case 'UNKNOWN': return '결과 미확정';
  }
}

export function formatTradeLifecycleOutcomeTelegram(
  outcome: TradeLifecycleOutcomeResult,
  title = '📌 [청산]',
): string {
  return [
    `${title} ${outcome.symbol ?? ''}`.trim(),
    `결과: ${formatTradeLifecycleOutcome(outcome.lifecycleOutcome)}`,
    `lifecycleOutcome: ${outcome.lifecycleOutcome}`,
    `실현손익: ${outcome.totalRealizedPnL >= 0 ? '+' : ''}${outcome.totalRealizedPnL.toLocaleString('ko-KR')}원`,
    `분류: ${outcome.outcomeClass}`,
    outcome.lifecycleOutcome === 'TP1_THEN_BREAKEVEN'
      ? '설명: 1차 익절 후 잔여 물량 본절 종료'
      : `설명: ${formatTradeLifecycleOutcome(outcome.lifecycleOutcome)}`,
  ].join('\n');
}

export function resolveShadowLearningLifecycleOutcome(
  outcome: TradeLifecycleOutcomeResult,
): ShadowLearningLifecycleOutcome {
  const learningLabels: string[] = [outcome.lifecycleOutcome, outcome.outcomeClass];
  if (outcome.lifecycleOutcome === 'TP1_THEN_BREAKEVEN') learningLabels.push('PARTIAL_PROFIT_THEN_BE');
  if (outcome.lifecycleOutcome === 'STOP_LOSS') learningLabels.push('FULL_STOP_LOSS');
  return {
    learningOutcome: outcome.lifecycleOutcome,
    learningClass: outcome.outcomeClass,
    learningLabels: [...new Set(learningLabels)],
  };
}

export function summarizeLifecycleOutcomeStats(
  outcomes: readonly TradeLifecycleOutcomeResult[],
): TradeOutcomeStats {
  const winCount = outcomes.filter((outcome) => outcome.outcomeClass === 'WIN').length;
  const lossCount = outcomes.filter((outcome) => outcome.outcomeClass === 'LOSS').length;
  const breakevenCount = outcomes.filter((outcome) => outcome.outcomeClass === 'BREAKEVEN' || outcome.outcomeClass === 'WIN_BREAKEVEN').length;
  const openCount = outcomes.filter((outcome) => outcome.outcomeClass === 'OPEN').length;
  const unknownCount = outcomes.filter((outcome) => outcome.outcomeClass === 'UNKNOWN').length;
  const closedCountForWinRate = winCount + lossCount;
  return {
    winCount,
    lossCount,
    breakevenCount,
    openCount,
    unknownCount,
    closedCountForWinRate,
    winRate: closedCountForWinRate > 0 ? (winCount / closedCountForWinRate) * 100 : 0,
  };
}

export function buildLifecycleLedgerFields(outcome: TradeLifecycleOutcomeResult): {
  lifecycleOutcome: TradeLifecycleOutcome;
  outcomeClass: TradeOutcomeClass;
  finalExitReason: string;
  tp1Hit: boolean;
  stopMovedToBreakeven: boolean;
  totalRealizedPnL: number;
  totalRealizedPnLPct: number;
  resolvedBy: 'TradeLifecycleOutcomeResolver';
  resolvedAt: string;
} {
  return {
    lifecycleOutcome: outcome.lifecycleOutcome,
    outcomeClass: outcome.outcomeClass,
    finalExitReason: outcome.finalExitReason,
    tp1Hit: outcome.tp1Hit,
    stopMovedToBreakeven: outcome.stopMovedToBreakeven,
    totalRealizedPnL: outcome.totalRealizedPnL,
    totalRealizedPnLPct: outcome.totalRealizedPnLPct,
    resolvedBy: outcome.resolvedBy,
    resolvedAt: outcome.resolvedAt,
  };
}

export function formatTradeLifecycleOutcomeResolvedLog(outcome: TradeLifecycleOutcomeResult): string {
  return [
    '[TRADE_LIFECYCLE_OUTCOME_RESOLVED]',
    kv('positionId', outcome.positionId),
    kv('symbol', outcome.symbol),
    kv('mode', outcome.mode),
    kv('entryPrice', outcome.entryPrice),
    kv('finalExitPrice', outcome.finalExitPrice),
    kv('finalExitReason', outcome.finalExitReason),
    kv('tp1Hit', outcome.tp1Hit),
    kv('stopMovedToBreakeven', outcome.stopMovedToBreakeven),
    kv('totalRealizedPnL', outcome.totalRealizedPnL),
    kv('totalRealizedPnLPct', outcome.totalRealizedPnLPct),
    kv('lifecycleOutcome', outcome.lifecycleOutcome),
    kv('outcomeClass', outcome.outcomeClass),
    "resolvedBy='TradeLifecycleOutcomeResolver'",
  ].join(' ');
}

export function formatStopLossReclassifiedByLifecycleLog(outcome: TradeLifecycleOutcomeResult): string | null {
  if (upper(outcome.finalExitReason) !== 'STOP_LOSS') return null;
  if (outcome.lifecycleOutcome !== 'TP1_THEN_BREAKEVEN') return null;
  return [
    '[STOP_LOSS_RECLASSIFIED_BY_LIFECYCLE]',
    kv('positionId', outcome.positionId),
    kv('symbol', outcome.symbol),
    "finalExitReason='STOP_LOSS'",
    'tp1Hit=true',
    'stopMovedToBreakeven=true',
    kv('totalRealizedPnL', outcome.totalRealizedPnL),
    "newLifecycleOutcome='TP1_THEN_BREAKEVEN'",
    "newOutcomeClass='WIN_BREAKEVEN'",
  ].join(' ');
}

export function formatOutcomeStatsUpdatedFromLifecycleLog(input: {
  tradeId: string;
  outcome: TradeLifecycleOutcomeResult;
}): string {
  return [
    '[OUTCOME_STATS_UPDATED_FROM_LIFECYCLE]',
    kv('tradeId', input.tradeId),
    kv('lifecycleOutcome', input.outcome.lifecycleOutcome),
    kv('outcomeClass', input.outcome.outcomeClass),
    kv('winRateIncluded', input.outcome.outcomeClass === 'WIN'),
    kv('lossIncluded', input.outcome.outcomeClass === 'LOSS'),
    kv('breakevenIncluded', input.outcome.outcomeClass === 'BREAKEVEN' || input.outcome.outcomeClass === 'WIN_BREAKEVEN'),
  ].join(' ');
}
