// @responsibility Quarantine R6 counterfactual Shadow positions that were opened without approval.

import {
  appendShadowLog,
  getRemainingQty,
  isActiveFill,
  loadShadowTrades,
  saveShadowTrades,
  type ServerShadowTrade,
} from '../../persistence/shadowTradeRepo.js';

export const R6_COUNTERFACTUAL_POSITION_QUARANTINE_REASON =
  'R6_COUNTERFACTUAL_ACTIVE_POSITION_WITHOUT_APPROVAL';

export interface R6CounterfactualQuarantineItem {
  tradeId: string;
  stockCode: string;
  stockName: string;
  revertedBuyFillCount: number;
  before: { quantity: number; remainingQty: number; status: string };
  after: { quantity: number; remainingQty: number; status: string };
}

export interface R6CounterfactualQuarantineResult {
  dryRun: boolean;
  checked: number;
  quarantined: number;
  items: R6CounterfactualQuarantineItem[];
}

export interface R6CounterfactualQuarantineOptions {
  trades?: ServerShadowTrade[];
  dryRun?: boolean;
  targetCodes?: string[];
  persist?: boolean;
  appendLog?: boolean;
  now?: Date;
}

const OPEN_STATUSES = new Set(['PENDING', 'ORDER_SUBMITTED', 'PARTIALLY_FILLED', 'ACTIVE', 'EUPHORIA_PARTIAL']);

function isR6CounterfactualTrade(trade: ServerShadowTrade): boolean {
  return (
    trade.mode !== 'LIVE' &&
    (
      trade.entryType === 'R6_COUNTERFACTUAL_BUY' ||
      trade.riskUnit === 'R6_COUNTERFACTUAL' ||
      trade.entryReason === 'R6_COUNTERFACTUAL_RECOVERY_TEST' ||
      trade.learningTag === 'R6_COUNTERFACTUAL_RECOVERY_TEST' ||
      Boolean(trade.r6Counterfactual)
    )
  );
}

function isOpenPosition(trade: ServerShadowTrade): boolean {
  const remainingQty = getRemainingQty(trade);
  return OPEN_STATUSES.has(trade.status) && (remainingQty > 0 || trade.quantity > 0);
}

function shouldQuarantine(trade: ServerShadowTrade, targetCodes?: Set<string>): boolean {
  if (targetCodes && !targetCodes.has(trade.stockCode)) return false;
  if (!isR6CounterfactualTrade(trade)) return false;
  if (!isOpenPosition(trade)) return false;
  return true;
}

function revertCounterfactualBuyFills(trade: ServerShadowTrade, nowIso: string): number {
  let reverted = 0;
  for (const fill of trade.fills ?? []) {
    if (fill.type !== 'BUY' || !isActiveFill(fill)) continue;
    fill.status = 'REVERTED';
    fill.revertedAt = nowIso;
    fill.revertReason = R6_COUNTERFACTUAL_POSITION_QUARANTINE_REASON;
    reverted += 1;
  }
  return reverted;
}

function countRevertableCounterfactualBuyFills(trade: ServerShadowTrade): number {
  return (trade.fills ?? []).filter(fill => fill.type === 'BUY' && isActiveFill(fill)).length;
}

export function quarantineR6CounterfactualActivePositions(
  options: R6CounterfactualQuarantineOptions = {},
): R6CounterfactualQuarantineResult {
  const dryRun = options.dryRun === true;
  const trades = options.trades ?? loadShadowTrades();
  const targetCodes = options.targetCodes ? new Set(options.targetCodes) : undefined;
  const nowIso = (options.now ?? new Date()).toISOString();
  const result: R6CounterfactualQuarantineResult = {
    dryRun,
    checked: trades.length,
    quarantined: 0,
    items: [],
  };

  for (const trade of trades) {
    if (!shouldQuarantine(trade, targetCodes)) continue;

    const before = {
      quantity: trade.quantity,
      remainingQty: getRemainingQty(trade),
      status: trade.status,
    };
    const revertedBuyFillCount = dryRun
      ? countRevertableCounterfactualBuyFills(trade)
      : revertCounterfactualBuyFills(trade, nowIso);

    if (!dryRun) {
      trade.quantity = 0;
      trade.status = 'REJECTED';
      trade.incidentFlag = R6_COUNTERFACTUAL_POSITION_QUARANTINE_REASON;
      trade.rollbackReason = R6_COUNTERFACTUAL_POSITION_QUARANTINE_REASON;
      trade.needsManualReview = true;
      trade.manualReviewReason = R6_COUNTERFACTUAL_POSITION_QUARANTINE_REASON;
      trade.liveOrderSent = false;
      trade.executionImpact = 'NONE';
      delete trade.exitTime;
      delete trade.exitPrice;
      delete trade.exitRuleTag;
      delete trade.returnPct;
      delete trade.shadowExitDeferredReason;
      delete trade.shadowExitDeferredSession;
      delete trade.shadowExitDeferredAt;

      if (options.appendLog !== false) {
        appendShadowLog({
          event: 'R6_COUNTERFACTUAL_ACTIVE_POSITION_QUARANTINED',
          ...trade,
          before,
          revertedBuyFillCount,
          reason: R6_COUNTERFACTUAL_POSITION_QUARANTINE_REASON,
          liveOrderSent: false,
          executionImpact: 'NONE',
        });
      }
    }

    result.quarantined += 1;
    result.items.push({
      tradeId: trade.id,
      stockCode: trade.stockCode,
      stockName: trade.stockName,
      revertedBuyFillCount,
      before,
      after: {
        quantity: dryRun ? 0 : trade.quantity,
        remainingQty: dryRun ? 0 : getRemainingQty(trade),
        status: 'REJECTED',
      },
    });
  }

  if (!dryRun && result.quarantined > 0 && (options.trades === undefined || options.persist)) {
    saveShadowTrades(trades);
  }

  return result;
}
