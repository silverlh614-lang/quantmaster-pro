// @responsibility GhostCloseResolver — virtual-only ghost/shadow close resolver, never touches broker/live execution
import { loadGhostPortfolio, saveGhostPortfolio } from '../persistence/reflectionRepo.js';
import { appendJson, GHOST_CLOSE_RUNS_FILE } from './learningStorage.js';
import type { GhostCloseResolverResult, LearningCloseReason, LearningGhostCase, PriceSnapshot } from './learningTypes.js';
import { LEARNING_DEFAULT_MAX_HOLDING_MINUTES, LEARNING_DEFAULT_STOP_RETURN_PCT, LEARNING_DEFAULT_TARGET_RETURN_PCT } from './learningConstants.js';

export interface GhostCloseResolverOptions {
  now?: Date;
  dryRun?: boolean;
  priceProvider?: (g: LearningGhostCase) => Promise<PriceSnapshot | null>;
}

function caseId(g: LearningGhostCase): string { return g.id ?? `${g.stockCode}|${g.signalDate}`; }
function entryAt(g: LearningGhostCase): string { return g.entryAt ?? `${g.signalDate}T00:00:00.000Z`; }
function entryPrice(g: LearningGhostCase): number { return g.entryPrice ?? g.signalPriceKrw; }
function targetPrice(g: LearningGhostCase): number { return g.targetPrice ?? entryPrice(g) * (1 + LEARNING_DEFAULT_TARGET_RETURN_PCT / 100); }
function stopPrice(g: LearningGhostCase): number { return g.stopPrice ?? entryPrice(g) * (1 + LEARNING_DEFAULT_STOP_RETURN_PCT / 100); }
function maxHold(g: LearningGhostCase): number { return g.maxHoldingMinutes ?? LEARNING_DEFAULT_MAX_HOLDING_MINUTES; }
function holdingMinutes(g: LearningGhostCase, now: Date): number {
  const t = new Date(entryAt(g)).getTime();
  return Number.isFinite(t) ? Math.max(0, Math.floor((now.getTime() - t) / 60000)) : 0;
}
async function defaultPriceProvider(g: LearningGhostCase): Promise<PriceSnapshot | null> {
  const price = g.exitPriceVirtual ?? (typeof g.currentReturnPct === 'number' ? entryPrice(g) * (1 + g.currentReturnPct / 100) : null);
  return price ? { price, high: price, low: price, close: price } : null;
}

function resolveClose(g: LearningGhostCase, snap: PriceSnapshot, now: Date): { reason: LearningCloseReason; price: number } | null {
  const high = snap.high ?? snap.price ?? snap.close;
  const low = snap.low ?? snap.price ?? snap.close;
  const close = snap.close ?? snap.price ?? high ?? low;
  if (snap.stale && close && close > 0) return { reason: 'VIRTUAL_DATA_STALE_EXIT', price: close };
  if (typeof high === 'number' && high >= targetPrice(g)) return { reason: 'VIRTUAL_TAKE_PROFIT', price: targetPrice(g) };
  if (typeof low === 'number' && low <= stopPrice(g)) return { reason: 'VIRTUAL_STOP_LOSS', price: stopPrice(g) };
  if (holdingMinutes(g, now) >= maxHold(g) && typeof close === 'number' && close > 0) return { reason: 'VIRTUAL_TIME_EXIT', price: close };
  return null;
}

export async function runGhostCloseResolver(opts: GhostCloseResolverOptions = {}): Promise<GhostCloseResolverResult> {
  const now = opts.now ?? new Date();
  const runId = `ghost-close-${now.toISOString()}`;
  const all = loadGhostPortfolio() as LearningGhostCase[];
  const provider = opts.priceProvider ?? defaultPriceProvider;
  const result: GhostCloseResolverResult = { runId, lastRunAt: now.toISOString(), candidatesScanned: 0, closed: 0, pendingRetry: 0, quarantined: 0, closedIds: [], brokerOrdersCreated: 0 };
  for (const g of all) {
    if (g.closed) continue;
    result.candidatesScanned++;
    const e = entryPrice(g);
    if (!Number.isFinite(e) || e <= 0) {
      g.closeReason = 'QUARANTINED_DATA_MISSING'; g.outcomeLabel = 'QUARANTINED'; g.dataQuality = 'QUARANTINED'; g.quarantinedReason = 'entry_price_missing'; g.executionImpact = 'NONE'; result.quarantined++; continue;
    }
    const snap = await provider(g);
    if (!snap || ![snap.price, snap.high, snap.low, snap.close].some((v) => typeof v === 'number' && v > 0)) {
      g.pendingRetryReason = 'price_or_ohlc_missing'; g.dataQuality = 'MISSING'; g.executionImpact = 'NONE'; result.pendingRetry++; continue;
    }
    const close = resolveClose(g, snap, now);
    if (!close) continue;
    g.closed = true; g.closedAt = now.toISOString(); g.lastUpdatedAt = now.toISOString(); g.closeReason = close.reason;
    g.exitPriceVirtual = close.price; g.executionImpact = 'NONE'; g.caseKind = g.caseKind ?? 'ghost'; g.repairRunId = runId; g.cohortType = g.caseKind === 'ghost' ? 'GHOST_REPAIR' : 'BACKLOG_REPAIR';
    result.closed++; result.closedIds.push(caseId(g));
  }
  if (!opts.dryRun) saveGhostPortfolio(all);
  appendJson(GHOST_CLOSE_RUNS_FILE, result);
  return result;
}

export const __ghostCloseResolverInternals = { targetPrice, stopPrice, holdingMinutes, resolveClose };
