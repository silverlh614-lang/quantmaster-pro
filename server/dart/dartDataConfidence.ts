// @responsibility DART 선행공시 신뢰도 집계 계산
import type { DataConfidence, DataConfidenceSummary, DartExtractedFact } from './dartPreNewsTypes.js';

function emptyConfidenceSummary(): DataConfidenceSummary {
  return { verified: 0, degraded: 0, stale: 0, missing: 0, aiEstimated: 0, unknown: 0 };
}

export function summarizeDataConfidence(facts: DartExtractedFact[]): DataConfidenceSummary {
  const summary = emptyConfidenceSummary();
  for (const fact of facts) incrementConfidence(summary, fact.confidence);
  return summary;
}

function incrementConfidence(summary: DataConfidenceSummary, confidence: DataConfidence): void {
  if (confidence === 'VERIFIED') summary.verified += 1;
  else if (confidence === 'DEGRADED') summary.degraded += 1;
  else if (confidence === 'STALE') summary.stale += 1;
  else if (confidence === 'MISSING') summary.missing += 1;
  else if (confidence === 'AI_ESTIMATED') summary.aiEstimated += 1;
  else summary.unknown += 1;
}

export function originalFact(key: string, label: string, value?: string | number, unit?: string): DartExtractedFact {
  return { key, label, value, unit, source: 'DART_ORIGINAL', confidence: value === undefined || value === '' ? 'MISSING' : 'VERIFIED' };
}

export function parsedFact(key: string, label: string, value?: string | number, unit?: string, degraded = false): DartExtractedFact {
  return { key, label, value, unit, source: 'DART_PARSED', confidence: value === undefined || value === '' ? 'MISSING' : degraded ? 'DEGRADED' : 'VERIFIED' };
}

export function missingFact(key: string, label: string): DartExtractedFact {
  return { key, label, source: 'UNKNOWN', confidence: 'MISSING' };
}

export function aiEstimatedFact(key: string, label: string, value?: string | number, unit?: string): DartExtractedFact {
  return { key, label, value, unit, source: 'AI_ESTIMATED', confidence: 'AI_ESTIMATED' };
}
