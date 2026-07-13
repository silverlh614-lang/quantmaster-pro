/**
 * @responsibility Screener confidence counting utilities
 */

import type { DataConfidence, DataConfidenceSummary, ScreenerDataPoint, ScreenerUniverseItem } from './quantScreenerTypes.js';

export function emptyDataConfidenceSummary(): DataConfidenceSummary {
  return { verified: 0, degraded: 0, stale: 0, missing: 0, aiEstimated: 0, unknown: 0 };
}

export function addConfidence(summary: DataConfidenceSummary, confidence: DataConfidence): DataConfidenceSummary {
  const next = { ...summary };
  if (confidence === 'VERIFIED') next.verified += 1;
  else if (confidence === 'DEGRADED') next.degraded += 1;
  else if (confidence === 'STALE') next.stale += 1;
  else if (confidence === 'MISSING') next.missing += 1;
  else if (confidence === 'AI_ESTIMATED') next.aiEstimated += 1;
  else next.unknown += 1;
  return next;
}

function confidenceOf<T>(point: ScreenerDataPoint<T> | undefined): DataConfidence {
  if (!point || point.value === null || point.value === undefined) return 'MISSING';
  return point.confidence ?? 'UNKNOWN';
}

export function hasVerifiedValue<T>(point: ScreenerDataPoint<T> | undefined): point is ScreenerDataPoint<T> {
  return Boolean(point && point.value !== null && point.value !== undefined && point.confidence === 'VERIFIED');
}

export function summarizeItemConfidence(item: ScreenerUniverseItem): DataConfidenceSummary {
  let summary = emptyDataConfidenceSummary();
  const points: Array<ScreenerDataPoint<unknown> | undefined> = [
    item.marketCapKrw,
    item.avgTradingValue20dKrw,
    item.latestClose,
    item.per,
    item.isManaged,
    item.isTradingHalt,
    item.volume,
    item.avgVolume20d,
    item.high52w,
    item.ma20,
    item.relativeStrengthPct,
    item.institutionForeignNetBuy3d,
    item.volatilityContraction,
  ];
  for (const point of points) summary = addConfidence(summary, confidenceOf(point));
  for (const missing of item.missingData ?? []) {
    if (missing.trim()) summary = addConfidence(summary, 'MISSING');
  }
  return summary;
}
