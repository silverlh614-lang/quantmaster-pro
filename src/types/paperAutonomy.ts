// @responsibility Define auditable Shadow exploration allocation evidence.
import type { PaperAdaptiveRule } from './paperAdaptive';

export type PaperAutonomyReason = 'EXPLORE' | 'INCREASE' | 'REDUCE' | 'MAINTAIN';
export const PAPER_AUTONOMY_POLICY = Object.freeze({ windowEntryDates: 60, minimumSamples: 10, minimumEntryDates: 3, standardErrors: 2 });
export const PAPER_AUTONOMY_REASON_LABELS: Record<PaperAutonomyReason, string> = {
  EXPLORE: '실제 거래 표본을 더 모읍니다', INCREASE: '탐색 기회를 늘립니다',
  REDUCE: '탐색 기회를 줄입니다', MAINTAIN: '현재 탐색 기회를 유지합니다',
};
export interface PaperAutonomyStats {
  totalCount: number; closedCount: number; pendingCount: number;
  /** Only fully closed entry-date cohorts contribute to grading. */
  sampleCount: number; dateCount: number;
  /** Display mean across all valid closed trades, including incomplete cohorts. */
  meanNetReturnPct: number | null;
  /** Equal weight per completed entry date; never divided by D1/D3/D5. */
  meanDateNetReturnPct: number | null; standardErrorPct: number | null;
  /** Sorted IDs of all counted entries, including pending trades. */
  tradeIdsDigest: string;
}
export interface PaperAutonomyEntry {
  ruleKey: string; lastSelectedAt: string | null; reason: PaperAutonomyReason; weight: 1 | 2 | 3; stats: PaperAutonomyStats;
}
export interface PaperAutonomyState {
  version: 'shadow-autonomy-v1'; evaluatedAt: string; cutoffAt: string; status: 'READY' | 'FALLBACK';
  entries: PaperAutonomyEntry[]; selectedRuleKeys: string[]; fallbackReason?: string;
  selectionHistory?: Array<{ ruleKey: string; selectedAt: string }>;
}
export interface PaperAutonomyAllocation {
  version: 'shadow-autonomy-v1'; evaluatedAt: string; cutoffAt: string; method: 'OUTCOME_WEIGHTED' | 'LEGACY_FALLBACK';
  selectedRuleKey: string; baselineRuleKey: string;
  choices: Array<{ ruleKey: string; purpose: 'VALIDATED' | 'EXPLORATION'; weight: 1 | 2 | 3;
    reason: PaperAutonomyReason | 'FIXED_VALIDATED' | 'FALLBACK'; stats?: PaperAutonomyStats }>;
}
/** Rediscovering the same formula starts a separate prospective allocation history. */
export function paperAutonomyRuleKey(rule: PaperAdaptiveRule): string {
  return `${rule.feature}:${rule.bucket}:D${rule.horizon}${rule.invention ? `:born:${rule.invention.createdAt}` : ''}`;
}
/** Deterministic stock/day assignment, preserving the original allocation when weights match. */
export function paperAutonomyAssignment(symbol: string, tradingDate: string, weights: readonly number[]): number {
  if (!weights.length || weights.some(weight => !Number.isInteger(weight) || weight < 1 || weight > 3)) {
    throw new Error('PAPER_AUTONOMY_INVALID: allocation weights');
  }
  const hash = [...`${symbol}:${tradingDate}`].reduce((value, char) => Math.imul(value ^ char.charCodeAt(0), 16777619) >>> 0, 2166136261);
  if (weights.every(weight => weight === weights[0])) return hash % weights.length;
  let remaining = hash % weights.reduce((sum, weight) => sum + weight, 0);
  for (let index = 0; index < weights.length; index++) {
    if (remaining < weights[index]) return index;
    remaining -= weights[index];
  }
  throw new Error('PAPER_AUTONOMY_INVALID: allocation interval');
}
