// @responsibility Shadow 성과를 live 직접 반영하지 않고 승격 후보 리포트만 생성
import { SHADOW_PROMOTION_MAX_DATA_CORRUPTION_RATE, SHADOW_PROMOTION_MAX_DUPLICATE_SIGNAL_RATE, SHADOW_PROMOTION_MIN_CLOSED_SAMPLE_RATE, SHADOW_PROMOTION_MIN_LABEL_COMPLETION_RATE, SHADOW_PROMOTION_MIN_PAPER_FILL_RATE, SHADOW_PROMOTION_MIN_RETURN_FLOW_HIT_RATE, SHADOW_PROMOTION_MIN_SAMPLE_SIZE } from './shadowConstants.js';
import type { ShadowCaseLedgerStore } from './shadowCaseLedger.js';
import type { PromotionReport, ShadowCase } from './shadowTypes.js';

const EXCLUDED = new Set(['DATA_CORRUPTED', 'QUARANTINED', 'INVALID']);
const CLOSED = new Set(['WIN', 'LOSS', 'BREAKEVEN', 'MISSED_WIN', 'AVOIDED_LOSS', 'GOOD_BLOCK', 'BAD_BLOCK', 'NEUTRAL_BLOCK', 'EXPIRED']);

function avg(xs: number[]): number { return xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : 0; }
function rate(n: number, d: number, empty = 0): number { return d === 0 ? empty : n / d; }
function validCases(cases: ShadowCase[]): ShadowCase[] { return cases.filter((c) => !EXCLUDED.has(c.outcomeLabel ?? '')); }

export function buildPromotionReport(ledger: ShadowCaseLedgerStore, returnFlowHitRate: number, pendingStaleCount = 0): PromotionReport {
  const all = ledger.listCases();
  const cases = validCases(all);
  const sampleSize = cases.length;
  const closed = cases.filter((c) => CLOSED.has(c.outcomeLabel ?? ''));
  const wins = closed.filter((c) => ['WIN', 'MISSED_WIN', 'BAD_BLOCK'].includes(c.outcomeLabel ?? ''));
  const losses = closed.filter((c) => ['LOSS', 'AVOIDED_LOSS', 'GOOD_BLOCK'].includes(c.outcomeLabel ?? ''));
  const duplicateSignalRate = rate(sampleSize - new Set(cases.map((c) => c.signalId)).size, sampleSize);
  const paperFillRate = rate(cases.filter((c) => ['SHADOW_PAPER_FILLED', 'SHADOW_POSITION_OPENED', 'SHADOW_POSITION_CLOSED', 'OUTCOME_LABELED'].includes(c.state ?? '')).length, sampleSize, 1);
  const labelCompletionRate = rate(closed.length, cases.filter((c) => c.state === 'SHADOW_POSITION_CLOSED' || CLOSED.has(c.outcomeLabel ?? '')).length, 1);
  const dataCorruptionRate = rate(all.filter((c) => c.outcomeLabel === 'DATA_CORRUPTED' || c.outcomeLabel === 'QUARANTINED').length, all.length);
  const avgWinR = avg(wins.map((c) => c.finalReturnPct ?? 0));
  const avgLossR = avg(losses.map((c) => Math.abs(c.finalReturnPct ?? 0)));
  const winRate = rate(wins.length, closed.length);
  const expectancyR = winRate * avgWinR - (1 - winRate) * avgLossR;
  const blockers: string[] = [];
  if (sampleSize < SHADOW_PROMOTION_MIN_SAMPLE_SIZE) blockers.push('sampleSize');
  if (rate(closed.length, sampleSize) < SHADOW_PROMOTION_MIN_CLOSED_SAMPLE_RATE) blockers.push('closedSampleRate');
  if (labelCompletionRate < SHADOW_PROMOTION_MIN_LABEL_COMPLETION_RATE) blockers.push('labelCompletionRate');
  if (duplicateSignalRate > SHADOW_PROMOTION_MAX_DUPLICATE_SIGNAL_RATE) blockers.push('duplicateSignalRate');
  if (paperFillRate < SHADOW_PROMOTION_MIN_PAPER_FILL_RATE) blockers.push('paperFillRate');
  if (returnFlowHitRate < SHADOW_PROMOTION_MIN_RETURN_FLOW_HIT_RATE) blockers.push('returnFlowHitRate');
  if (pendingStaleCount !== 0) blockers.push('pendingStaleCount');
  if (expectancyR <= 0) blockers.push('expectancyR');
  if (dataCorruptionRate > SHADOW_PROMOTION_MAX_DATA_CORRUPTION_RATE) blockers.push('dataCorruptionRate');
  const regimeBreakdown: PromotionReport['regimeBreakdown'] = {};
  for (const c of cases) {
    const key = c.regimeTag ?? 'UNKNOWN';
    const bucket = regimeBreakdown[key] ?? { sampleSize: 0, winRate: 0 };
    bucket.sampleSize += 1;
    regimeBreakdown[key] = bucket;
  }
  for (const [key, bucket] of Object.entries(regimeBreakdown)) {
    const subset = cases.filter((c) => (c.regimeTag ?? 'UNKNOWN') === key);
    bucket.winRate = rate(subset.filter((c) => ['WIN', 'MISSED_WIN', 'BAD_BLOCK'].includes(c.outcomeLabel ?? '')).length, subset.length);
  }
  return { sampleSize, closedSampleCount: closed.length, closedSampleRate: rate(closed.length, sampleSize), winRate, avgWinR, avgLossR, expectancyR, maxDrawdownVirtual: Math.min(0, ...closed.map((c) => c.finalReturnPct ?? 0)), duplicateSignalRate, paperFillRate, labelCompletionRate, returnFlowHitRate, pendingStaleCount, dataCorruptionRate, regimeBreakdown, promotionStatus: blockers.length ? 'BLOCKED' : 'READY_FOR_CANARY', blockers, generatedAt: new Date().toISOString() };
}
