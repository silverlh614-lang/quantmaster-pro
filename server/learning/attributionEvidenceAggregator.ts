// @responsibility Bucket and summarize Attribution Evidence Ledger records.

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
      if (record.winLoss === 'WIN' || record.winLoss === 'PARTIAL_WIN' || (record.returnPct ?? 0) > 0) entry.wins += 1;
      if (record.winLoss === 'LOSS' || (record.returnPct ?? 0) < 0) entry.losses += 1;
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
