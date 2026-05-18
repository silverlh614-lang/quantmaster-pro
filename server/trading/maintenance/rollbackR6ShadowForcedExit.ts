// @responsibility Roll back Shadow fills created by forbidden R6 forced-exit policy violations
import {
  type PositionFill,
  type ServerShadowTrade,
  appendShadowLog,
  isActiveFill,
  loadShadowTrades,
  saveShadowTrades,
} from '../../persistence/shadowTradeRepo.js';
import {
  type ServerAttributionRecord,
  loadAttributionRecords,
  saveAttributionRecords,
} from '../../persistence/attributionRepo.js';
import { R6_FORCED_EXIT_SUSPECT_TAGS } from '../exitEngine/r6ForcedExitPolicy.js';

const DEFAULT_TARGET_CODES = ['017670', '454910'];
const ROLLBACK_REASON = 'R6_FORCED_EXIT_SHADOW_POLICY_VIOLATION';

export interface R6ShadowForcedExitRollbackItem {
  tradeId: string;
  stockCode: string;
  stockName: string;
  removedSellFillCount: number;
  before: { quantity: number; status: string; exitRuleTag?: string };
  after: { quantity: number; status: string };
}

export interface R6ShadowForcedExitRollbackResult {
  dryRun: boolean;
  targetDate: string;
  checked: number;
  restored: number;
  items: R6ShadowForcedExitRollbackItem[];
}

export interface R6ShadowForcedExitRollbackOptions {
  trades?: ServerShadowTrade[];
  attributionRecords?: ServerAttributionRecord[];
  now?: Date;
  dryRun?: boolean;
  targetCodes?: string[];
  persist?: boolean;
  appendLog?: boolean;
}

export interface R6ShadowForcedExitLearningQuarantineResult {
  dryRun: boolean;
  targetDate: string;
  checked: number;
  quarantined: number;
  tradeIds: string[];
  attributionRecordsRemoved: number;
}

function kstDateString(input: Date | string): string {
  const date = typeof input === 'string' ? new Date(input) : input;
  return new Date(date.getTime() + 9 * 60 * 60 * 1000).toISOString().slice(0, 10);
}

function fillHasForbiddenR6Origin(fill: PositionFill): boolean {
  const candidate = fill as PositionFill & { origin?: string; source?: string };
  const tokens = [
    fill.exitRuleTag,
    fill.reason,
    fill.attribution?.ruleId,
    candidate.origin,
    candidate.source,
  ].filter((v): v is string => typeof v === 'string');
  return tokens.some(token => Array.from(R6_FORCED_EXIT_SUSPECT_TAGS).some(tag => token.includes(tag)));
}

function isShadowTrade(trade: ServerShadowTrade): boolean {
  const candidate = trade as ServerShadowTrade & { source?: string };
  return trade.mode !== 'LIVE' || candidate.source === 'ShadowPositionLedger';
}

function isTargetViolation(trade: ServerShadowTrade, targetDate: string, targetCodes: Set<string>): boolean {
  if (!targetCodes.has(trade.stockCode)) return false;
  if (!isShadowTrade(trade)) return false;
  if (typeof trade.exitRuleTag === 'string' && R6_FORCED_EXIT_SUSPECT_TAGS.has(trade.exitRuleTag)) {
    const exitDate = trade.exitTime ? kstDateString(trade.exitTime) : targetDate;
    return exitDate === targetDate;
  }
  return (trade.fills ?? []).some(fill =>
    fill.type === 'SELL' &&
    fillHasForbiddenR6Origin(fill) &&
    kstDateString(fill.timestamp) === targetDate
  );
}

function remainingQtyFromFills(fills: PositionFill[]): number {
  const buyQty = fills
    .filter(fill => fill.type === 'BUY' && isActiveFill(fill))
    .reduce((sum, fill) => sum + fill.qty, 0);
  const sellQty = fills
    .filter(fill => fill.type === 'SELL' && isActiveFill(fill))
    .reduce((sum, fill) => sum + fill.qty, 0);
  return Math.max(0, buyQty - sellQty);
}

export function rollbackR6ShadowForcedExitPolicyViolations(
  options: R6ShadowForcedExitRollbackOptions = {},
): R6ShadowForcedExitRollbackResult {
  const dryRun = options.dryRun === true;
  const targetDate = kstDateString(options.now ?? new Date());
  const targetCodes = new Set(options.targetCodes ?? DEFAULT_TARGET_CODES);
  const trades = options.trades ?? loadShadowTrades();
  const result: R6ShadowForcedExitRollbackResult = {
    dryRun,
    targetDate,
    checked: trades.length,
    restored: 0,
    items: [],
  };

  for (const trade of trades) {
    if (!isTargetViolation(trade, targetDate, targetCodes)) continue;

    const before = {
      quantity: trade.quantity,
      status: trade.status,
      exitRuleTag: trade.exitRuleTag,
    };
    const fills = trade.fills ?? [];
    const keptFills = fills.filter(fill => !(
      fill.type === 'SELL' &&
      fillHasForbiddenR6Origin(fill) &&
      kstDateString(fill.timestamp) === targetDate
    ));
    const removedSellFillCount = fills.length - keptFills.length;
    if (removedSellFillCount === 0 && before.exitRuleTag !== 'R6_EMERGENCY_EXIT') continue;

    const restoredQty = remainingQtyFromFills(keptFills);
    if (restoredQty <= 0) continue;

    if (!dryRun) {
      trade.fills = keptFills;
      trade.quantity = restoredQty;
      trade.originalQuantity = Math.max(trade.originalQuantity ?? 0, restoredQty);
      trade.status = 'ACTIVE';
      delete trade.exitTime;
      delete trade.exitPrice;
      delete trade.exitRuleTag;
      delete trade.returnPct;
      trade.r6EmergencySold = false;
      trade.needsManualReview = false;
      delete trade.manualReviewReason;
      trade.rollbackReason = ROLLBACK_REASON;
      if (options.appendLog !== false) {
        appendShadowLog({
          event: 'R6_SHADOW_FORCED_EXIT_ROLLBACK',
          ...trade,
          removedSellFillCount,
          restoredQty,
          rollbackReason: ROLLBACK_REASON,
        });
      }
    }

    result.restored++;
    result.items.push({
      tradeId: trade.id,
      stockCode: trade.stockCode,
      stockName: trade.stockName,
      removedSellFillCount,
      before,
      after: {
        quantity: restoredQty,
        status: 'ACTIVE',
      },
    });
  }

  if (!dryRun && (options.trades === undefined || options.persist) && result.restored > 0) {
    saveShadowTrades(trades);
  }

  return result;
}

export { ROLLBACK_REASON as R6_SHADOW_FORCED_EXIT_ROLLBACK_REASON };

export function quarantineR6ShadowForcedExitLearningSamples(
  options: R6ShadowForcedExitRollbackOptions = {},
): R6ShadowForcedExitLearningQuarantineResult {
  const dryRun = options.dryRun === true;
  const targetDate = kstDateString(options.now ?? new Date());
  const targetCodes = new Set(options.targetCodes ?? DEFAULT_TARGET_CODES);
  const trades = options.trades ?? loadShadowTrades();
  const tradeIds = new Set<string>();

  for (const trade of trades) {
    if (!isTargetViolation(trade, targetDate, targetCodes)) continue;
    tradeIds.add(trade.id);
    if (!dryRun) {
      trade.incidentFlag = ROLLBACK_REASON;
      trade.needsManualReview = true;
      trade.manualReviewReason = 'SHADOW_R6_FORCED_EXIT_FILL_SUSPECTED';
      if (options.appendLog !== false) {
        appendShadowLog({
          event: 'R6_SHADOW_FORCED_EXIT_LEARNING_QUARANTINE',
          ...trade,
          quarantineReason: ROLLBACK_REASON,
          executionImpact: 'NONE',
          liveOrderSent: false,
        });
      }
    }
  }

  const attributionRecords = options.attributionRecords ?? loadAttributionRecords();
  const keptAttributionRecords = attributionRecords.filter(record => !tradeIds.has(record.tradeId));
  const attributionRecordsRemoved = attributionRecords.length - keptAttributionRecords.length;

  if (!dryRun && tradeIds.size > 0 && (options.trades === undefined || options.persist)) {
    saveShadowTrades(trades);
  }
  if (!dryRun && attributionRecordsRemoved > 0) {
    if (options.attributionRecords) {
      options.attributionRecords.splice(0, options.attributionRecords.length, ...keptAttributionRecords);
    } else {
      saveAttributionRecords(keptAttributionRecords);
    }
  }

  return {
    dryRun,
    targetDate,
    checked: trades.length,
    quarantined: tradeIds.size,
    tradeIds: Array.from(tradeIds),
    attributionRecordsRemoved,
  };
}
