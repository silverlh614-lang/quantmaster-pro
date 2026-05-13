// @responsibility GhostOutcomeFinalizer — converts virtual closes into validated labels for attribution only
import { loadGhostPortfolio, saveGhostPortfolio } from '../persistence/reflectionRepo.js';
import type { LearningGhostCase, OutcomeFinalizerResult } from './learningTypes.js';

function entryPrice(g: LearningGhostCase): number { return g.entryPrice ?? g.signalPriceKrw; }
function riskPerShare(g: LearningGhostCase): number {
  const e = entryPrice(g);
  const s = g.stopPrice ?? e * 0.97;
  return Math.max(0.000001, Math.abs(e - s));
}
function labelFromReturn(pct: number, closeReason?: string) {
  if (closeReason === 'VIRTUAL_TIME_EXIT') return pct > 0.1 ? 'WIN' : pct < -0.1 ? 'LOSS' : 'EXPIRED';
  if (pct > 0.1) return 'WIN';
  if (pct < -0.1) return 'LOSS';
  return 'BREAKEVEN';
}

export function runGhostOutcomeFinalizer(opts: { dryRun?: boolean } = {}): OutcomeFinalizerResult {
  const all = loadGhostPortfolio() as LearningGhostCase[];
  const warnings: string[] = [];
  let scanned = 0, finalized = 0, skipped = 0;
  for (const g of all) {
    if (!g.closed) continue;
    scanned++;
    if (g.outcomeLabel && Number.isFinite(g.finalReturnPct)) { skipped++; continue; }
    const e = entryPrice(g), x = g.exitPriceVirtual;
    if (!Number.isFinite(e) || e <= 0 || !Number.isFinite(x) || (x ?? 0) <= 0) {
      g.outcomeLabel = g.closeReason === 'QUARANTINED_DATA_MISSING' ? 'QUARANTINED' : 'DATA_CORRUPTED';
      g.dataQuality = g.outcomeLabel === 'QUARANTINED' ? 'QUARANTINED' : 'CORRUPTED';
      warnings.push(`close_without_calculable_return:${g.stockCode}|${g.signalDate}`);
      skipped++; continue;
    }
    const finalReturnPct = Number((((x! - e) / e) * 100).toFixed(4));
    g.finalReturnPct = finalReturnPct;
    g.returnR = Number(((x! - e) / riskPerShare(g)).toFixed(4));
    const target = g.targetPrice ?? e;
    const stop = g.stopPrice ?? e;
    g.mfe = Number(((Math.max(x!, target, e) - e) / e * 100).toFixed(4));
    g.mae = Number(((Math.min(x!, stop, e) - e) / e * 100).toFixed(4));
    const closeMs = g.closedAt ? new Date(g.closedAt).getTime() : Date.now();
    const entryMs = new Date(g.entryAt ?? `${g.signalDate}T00:00:00.000Z`).getTime();
    (g as LearningGhostCase & { holdingMinutes?: number }).holdingMinutes = Number.isFinite(entryMs) ? Math.max(0, Math.floor((closeMs - entryMs) / 60000)) : 0;
    g.outcomeLabel = labelFromReturn(finalReturnPct, g.closeReason);
    g.labelConfidence = g.closeReason === 'VIRTUAL_DATA_STALE_EXIT' ? 0.55 : 0.95;
    g.dataQuality = g.dataQuality ?? 'OK';
    g.sourceConfidence = g.sourceConfidence ?? 0.9;
    g.executionImpact = 'NONE';
    finalized++;
  }
  if (!opts.dryRun) saveGhostPortfolio(all);
  for (const g of all) if (g.closed && !g.outcomeLabel) warnings.push(`close_without_outcome:${g.stockCode}|${g.signalDate}`);
  return { scanned, finalized, skipped, warnings, conditionWeightsChanged: 0 };
}
