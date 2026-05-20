// @responsibility AttributionBackfillEngine — backfills closed virtual ghost/shadow labels into attribution samples without changing weights
import { loadGhostPortfolio, saveGhostPortfolio } from '../persistence/reflectionRepo.js';
import { appendAttributionRecord, loadCurrentSchemaRecords } from '../persistence/attributionRepo.js';
import { appendJson, ATTRIBUTION_BACKFILL_RUNS_FILE } from './learningStorage.js';
import type { AttributionBackfillResult, LearningGhostCase } from './learningTypes.js';
import { LEARNING_ATTRIBUTION_TARGET_7D, LEARNING_VALID_ATTRIBUTION_LABELS } from './learningConstants.js';

function withinDays(iso: string | undefined, days: number, now: Date): boolean {
  const t = iso ? new Date(iso).getTime() : NaN;
  return Number.isFinite(t) && t >= now.getTime() - days * 86400000;
}
function id(g: LearningGhostCase): string { return `ghost:${g.stockCode}:${g.signalDate}`; }
function countAttr(days: number, now: Date): number { return loadCurrentSchemaRecords().filter(r => withinDays(r.closedAt, days, now)).length; }

export function runAttributionBackfill(opts: { now?: Date; dryRun?: boolean } = {}): AttributionBackfillResult {
  const now = opts.now ?? new Date();
  const all = loadGhostPortfolio() as LearningGhostCase[];
  const skipReasons: Record<string, number> = {};
  let processedCount = 0, skippedCount = 0;
  const inc = (k: string) => { skipReasons[k] = (skipReasons[k] ?? 0) + 1; skippedCount++; };
  for (const g of all) {
    if (!g.closed || g.attributionProcessed || !withinDays(g.closedAt, 30, now)) continue;
    if (!g.outcomeLabel || !LEARNING_VALID_ATTRIBUTION_LABELS.has(g.outcomeLabel)) { inc('invalid_outcome_label'); continue; }
    if (!Number.isFinite(g.finalReturnPct) || !Number.isFinite(g.returnR)) { inc('missing_final_return'); continue; }
    if (g.dataQuality === 'CORRUPTED' || g.dataQuality === 'QUARANTINED' || g.outcomeLabel === 'DATA_CORRUPTED' || g.outcomeLabel === 'QUARANTINED') { inc('data_quarantined'); continue; }
    const conditionScores = g.conditionScores ?? { 1: g.finalReturnPct! > 0 ? 7 : 3 };
    if (!opts.dryRun) {
      appendAttributionRecord({ tradeId: id(g), stockCode: g.stockCode, stockName: g.stockName, closedAt: g.closedAt!, returnPct: g.finalReturnPct!, isWin: g.outcomeLabel === 'WIN', conditionScores, holdingDays: Math.max(0, Math.round(((g as any).holdingMinutes ?? 0) / 1440)), sellReason: g.closeReason, evidenceSource: 'COUNTERFACTUAL', evidenceDataConfidence: 'VERIFIED', evidenceExecutionStatus: 'NOT_EXECUTED', evidenceEngineMode: 'NORMAL', evidenceExecutionImpact: 'NONE' });
      g.attributionProcessed = true;
    }
    processedCount++;
  }
  if (!opts.dryRun) saveGhostPortfolio(all);
  const res: AttributionBackfillResult = { runId: `attr-backfill-${now.toISOString()}`, processedCount, skippedCount, skipReasons, attributionSamples7d: countAttr(7, now) + (opts.dryRun ? processedCount : 0), attributionSamples14d: countAttr(14, now) + (opts.dryRun ? processedCount : 0), attributionSamples30d: countAttr(30, now) + (opts.dryRun ? processedCount : 0), targetSampleCount: LEARNING_ATTRIBUTION_TARGET_7D, starvationFlag: countAttr(7, now) + processedCount < LEARNING_ATTRIBUTION_TARGET_7D };
  appendJson(ATTRIBUTION_BACKFILL_RUNS_FILE, res);
  return res;
}
