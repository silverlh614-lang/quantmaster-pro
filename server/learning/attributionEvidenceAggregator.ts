// @responsibility Summarize bucketed Attribution Evidence Ledger records.

import {
  resolveAttributionEligibility,
} from './attributionEligibilityResolver.js';
import type {
  AttributionBuckets,
  AttributionBucketSummary,
  AttributionEvidenceRecord,
} from './attributionEvidenceTypes.js';
import type { ServerAttributionRecord } from '../persistence/attributionRepo.js';

export interface AttributionConditionPerformance {
  conditionKey: string;
  total: number;
  wins: number;
  losses: number;
  winRate: number;
  avgReturnPct: number;
}

export interface AttributionOutcomeQualitySummary {
  fullWin: number;
  partialWin: number;
  partialWinBreakeven: number;
  breakeven: number;
  loss: number;
  pendingExcluded: number;
  invalidExcluded: number;
  denominator: number;
  standardWinRate: number;
  conservativeWinRate: number;
  breakevenAdjustedWinRate: number;
  avgR: number;
}

export function createEmptyAttributionBuckets(): AttributionBuckets {
  return {
    coreEligible: [],
    candidateOnly: [],
    shadowOnly: [],
    counterfactualOnly: [],
    diagnosticOnly: [],
    excluded: [],
    pending: [],
  };
}

export function bucketAttributionEvidence(records: AttributionEvidenceRecord[]): AttributionBuckets {
  const buckets = createEmptyAttributionBuckets();

  for (const record of records) {
    if (record.outcomeStatus === 'PENDING') {
      buckets.pending.push(record);
      continue;
    }

    const eligibility = resolveAttributionEligibility(record);
    switch (eligibility) {
      case 'CORE_ELIGIBLE':
        buckets.coreEligible.push(record);
        break;
      case 'CANDIDATE_ONLY':
        buckets.candidateOnly.push(record);
        break;
      case 'SHADOW_ONLY':
        buckets.shadowOnly.push(record);
        break;
      case 'COUNTERFACTUAL_ONLY':
        buckets.counterfactualOnly.push(record);
        break;
      case 'DIAGNOSTIC_ONLY':
        buckets.diagnosticOnly.push(record);
        break;
      case 'EXCLUDED':
      default:
        buckets.excluded.push(record);
        break;
    }
  }

  return buckets;
}

export function summarizeAttributionBuckets(buckets: AttributionBuckets): AttributionBucketSummary {
  return {
    total:
      buckets.coreEligible.length
      + buckets.candidateOnly.length
      + buckets.shadowOnly.length
      + buckets.counterfactualOnly.length
      + buckets.diagnosticOnly.length
      + buckets.pending.length
      + buckets.excluded.length,
    coreEligible: buckets.coreEligible.length,
    candidateOnly: buckets.candidateOnly.length,
    shadowOnly: buckets.shadowOnly.length,
    counterfactualOnly: buckets.counterfactualOnly.length,
    diagnosticOnly: buckets.diagnosticOnly.length,
    pending: buckets.pending.length,
    excluded: buckets.excluded.length,
  };
}

export function isAttributionEvidenceWin(record: AttributionEvidenceRecord): boolean {
  if (record.winRateBucket === 'WIN_FULL' || record.winRateBucket === 'WIN_PARTIAL') return true;
  if (record.winRateBucket === 'BREAKEVEN' || record.winRateBucket === 'LOSS' || record.winRateBucket === 'EXCLUDED') return false;

  if (
    record.canonicalOutcome === 'FULL_WIN'
    || record.canonicalOutcome === 'PARTIAL_WIN'
    || record.canonicalOutcome === 'PARTIAL_WIN_BREAKEVEN'
    || record.canonicalOutcome === 'FORCED_EXIT_WIN'
  ) return true;
  if (
    record.canonicalOutcome === 'BREAKEVEN'
    || record.canonicalOutcome === 'FORCED_EXIT_BREAKEVEN'
    || record.canonicalOutcome === 'FULL_LOSS'
    || record.canonicalOutcome === 'PARTIAL_LOSS'
    || record.canonicalOutcome === 'FORCED_EXIT_LOSS'
    || record.canonicalOutcome === 'PENDING'
    || record.canonicalOutcome === 'INVALID'
  ) return false;

  return record.winLoss === 'WIN'
    || record.winLoss === 'PARTIAL_WIN'
    || (record.winLoss === undefined && (record.returnPct ?? 0) > 0);
}

export function isAttributionEvidenceLoss(record: AttributionEvidenceRecord): boolean {
  if (record.winRateBucket === 'LOSS') return true;
  if (record.winRateBucket === 'WIN_FULL' || record.winRateBucket === 'WIN_PARTIAL' || record.winRateBucket === 'BREAKEVEN' || record.winRateBucket === 'EXCLUDED') return false;

  if (
    record.canonicalOutcome === 'FULL_LOSS'
    || record.canonicalOutcome === 'PARTIAL_LOSS'
    || record.canonicalOutcome === 'FORCED_EXIT_LOSS'
  ) return true;
  if (
    record.canonicalOutcome === 'FULL_WIN'
    || record.canonicalOutcome === 'PARTIAL_WIN'
    || record.canonicalOutcome === 'PARTIAL_WIN_BREAKEVEN'
    || record.canonicalOutcome === 'BREAKEVEN'
    || record.canonicalOutcome === 'FORCED_EXIT_WIN'
    || record.canonicalOutcome === 'FORCED_EXIT_BREAKEVEN'
    || record.canonicalOutcome === 'PENDING'
    || record.canonicalOutcome === 'INVALID'
  ) return false;

  return record.winLoss === 'LOSS' || (record.winLoss === undefined && (record.returnPct ?? 0) < 0);
}

export function computeConditionPerformance(
  records: AttributionEvidenceRecord[],
): AttributionConditionPerformance[] {
  const map = new Map<string, { total: number; wins: number; losses: number; returnSum: number }>();

  for (const record of records) {
    if (record.outcomeStatus !== 'CONFIRMED') continue;
    if (!Number.isFinite(record.returnPct)) continue;
    const keys = record.conditionKeys.length > 0 ? record.conditionKeys : ['UNKNOWN_CONDITION'];
    for (const key of keys) {
      const entry = map.get(key) ?? { total: 0, wins: 0, losses: 0, returnSum: 0 };
      entry.total += 1;
      entry.returnSum += record.returnPct ?? 0;
      if (isAttributionEvidenceWin(record)) entry.wins += 1;
      if (isAttributionEvidenceLoss(record)) entry.losses += 1;
      map.set(key, entry);
    }
  }

  return [...map.entries()]
    .map(([conditionKey, entry]) => ({
      conditionKey,
      total: entry.total,
      wins: entry.wins,
      losses: entry.losses,
      winRate: entry.total > 0 ? entry.wins / entry.total : 0,
      avgReturnPct: entry.total > 0 ? entry.returnSum / entry.total : 0,
    }))
    .sort((a, b) => a.conditionKey.localeCompare(b.conditionKey));
}

export function summarizeAttributionOutcomeQuality(
  records: AttributionEvidenceRecord[],
): AttributionOutcomeQualitySummary {
  const summary: AttributionOutcomeQualitySummary = {
    fullWin: 0,
    partialWin: 0,
    partialWinBreakeven: 0,
    breakeven: 0,
    loss: 0,
    pendingExcluded: 0,
    invalidExcluded: 0,
    denominator: 0,
    standardWinRate: 0,
    conservativeWinRate: 0,
    breakevenAdjustedWinRate: 0,
    avgR: 0,
  };
  const rValues: number[] = [];

  for (const record of records) {
    if (
      record.outcomeStatus === 'PENDING'
      || record.canonicalOutcome === 'PENDING'
      || record.winLoss === 'PENDING'
    ) {
      summary.pendingExcluded++;
      continue;
    }
    if (
      record.outcomeStatus === 'INVALID'
      || record.canonicalOutcome === 'INVALID'
      || record.winLoss === 'INVALID'
      || record.winRateBucket === 'EXCLUDED'
    ) {
      summary.invalidExcluded++;
      continue;
    }
    if (record.outcomeStatus !== 'CONFIRMED') continue;

    if (record.canonicalOutcome === 'PARTIAL_WIN_BREAKEVEN') {
      summary.partialWinBreakeven++;
    } else if (record.canonicalOutcome === 'FULL_WIN' || record.winRateBucket === 'WIN_FULL') {
      summary.fullWin++;
    } else if (
      record.canonicalOutcome === 'PARTIAL_WIN'
      || record.canonicalOutcome === 'FORCED_EXIT_WIN'
      || record.winRateBucket === 'WIN_PARTIAL'
    ) {
      summary.partialWin++;
    } else if (
      record.canonicalOutcome === 'BREAKEVEN'
      || record.canonicalOutcome === 'FORCED_EXIT_BREAKEVEN'
      || record.winRateBucket === 'BREAKEVEN'
      || record.winLoss === 'BREAKEVEN'
    ) {
      summary.breakeven++;
    } else if (
      record.canonicalOutcome === 'FULL_LOSS'
      || record.canonicalOutcome === 'PARTIAL_LOSS'
      || record.canonicalOutcome === 'FORCED_EXIT_LOSS'
      || record.winRateBucket === 'LOSS'
      || record.winLoss === 'LOSS'
    ) {
      summary.loss++;
    } else if (record.winLoss === 'PARTIAL_WIN') {
      summary.partialWin++;
    } else if (record.winLoss === 'WIN' || (record.returnPct ?? 0) > 0) {
      summary.fullWin++;
    } else if ((record.returnPct ?? 0) < 0) {
      summary.loss++;
    } else {
      summary.breakeven++;
    }

    if (Number.isFinite(record.returnR)) rValues.push(record.returnR ?? 0);
  }

  summary.denominator = summary.fullWin + summary.partialWin + summary.partialWinBreakeven + summary.breakeven + summary.loss;
  const standardWins = summary.fullWin + summary.partialWin + summary.partialWinBreakeven;
  summary.standardWinRate = summary.denominator > 0 ? standardWins / summary.denominator : 0;
  summary.conservativeWinRate = summary.denominator > 0 ? summary.fullWin / summary.denominator : 0;
  summary.breakevenAdjustedWinRate = summary.denominator > 0
    ? (standardWins + summary.breakeven * 0.5) / summary.denominator
    : 0;
  summary.avgR = rValues.length > 0 ? rValues.reduce((sum, value) => sum + value, 0) / rValues.length : 0;
  return summary;
}

export function formatOutcomeQualityBlock(summary: AttributionOutcomeQualitySummary): string {
  const pct = (value: number) => `${(value * 100).toFixed(0)}%`;
  return [
    '🎯 <b>Outcome Quality</b>',
    '━━━━━━━━━━━━━━━━',
    `• Full Win: ${summary.fullWin}`,
    `• Partial Win: ${summary.partialWin}`,
    `• Partial Win → Breakeven: ${summary.partialWinBreakeven}`,
    `• Breakeven: ${summary.breakeven}`,
    `• Loss: ${summary.loss}`,
    `• Pending excluded: ${summary.pendingExcluded}`,
    '',
    '승률:',
    `• Standard WR: ${pct(summary.standardWinRate)}`,
    `• Conservative WR: ${pct(summary.conservativeWinRate)}`,
    `• Breakeven-adjusted WR: ${pct(summary.breakevenAdjustedWinRate)}`,
    `• Avg R: ${summary.avgR >= 0 ? '+' : ''}${summary.avgR.toFixed(2)}R`,
  ].join('\n');
}

export function filterAttributionRecordsByEvidence(
  records: ServerAttributionRecord[],
  evidenceRecords: AttributionEvidenceRecord[],
): ServerAttributionRecord[] {
  const evidenceTradeIds = new Set<string>();
  const evidenceTradeFillIds = new Set<string>();

  for (const evidence of evidenceRecords) {
    const tradeId = evidence.positionId ?? evidence.shadowPositionId ?? evidence.counterfactualId ?? evidence.signalId;
    if (!tradeId) continue;
    evidenceTradeIds.add(tradeId);
    if (evidence.orderId) evidenceTradeFillIds.add(`${tradeId}|${evidence.orderId}`);
  }

  return records.filter((record) => {
    if (record.fillId && evidenceTradeFillIds.has(`${record.tradeId}|${record.fillId}`)) return true;
    return evidenceTradeIds.has(record.tradeId);
  });
}

export function formatEvidenceHygieneBlock(summary: AttributionBucketSummary): string {
  return [
    '🧾 <b>Evidence Hygiene</b>',
    '━━━━━━━━━━━━━━━━',
    `• Total evidence: ${summary.total}`,
    `• CORE eligible: ${summary.coreEligible}`,
    `• Candidate only: ${summary.candidateOnly}`,
    `• Shadow only: ${summary.shadowOnly}`,
    `• Counterfactual only: ${summary.counterfactualOnly}`,
    `• Diagnostic only: ${summary.diagnosticOnly}`,
    `• Pending outcome: ${summary.pending}`,
    `• Excluded: ${summary.excluded}`,
    '',
    '⚠️ CORE 가중치 판단은 LIVE + VERIFIED + OUTCOME_CONFIRMED 샘플만 사용했습니다.',
    'Shadow/Counterfactual/Diagnostic 샘플은 active weight에 직접 반영하지 않았습니다.',
  ].join('\n');
}
