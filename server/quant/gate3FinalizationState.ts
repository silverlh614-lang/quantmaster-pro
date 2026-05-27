// @responsibility Lightweight in-process Gate3 finalization state for learning pulse display.

import type { Gate3CompletionSummaryInput, Gate3EvidenceSnapshot } from './gate3CompletionScore.js';
import { buildGate3LearningFinalization, isValidCompleteGate3Snapshot, toGate3EvidenceSnapshot } from './gate3CompletionScore.js';

let lastGate3FinalizationSummary: Gate3CompletionSummaryInput | null = null;
let lastValidGate3Snapshot: Gate3EvidenceSnapshot | null = null;

export function rememberGate3FinalizationSummary(summary: Gate3CompletionSummaryInput | null | undefined): void {
  lastGate3FinalizationSummary = summary ?? null;
  if (!summary) return;
  // Only a genuinely COMPLETE non-zero finalization promotes the last-valid snapshot; an empty or
  // stale current run must never overwrite a previously COMPLETE Gate3 evidence snapshot.
  const finalization = buildGate3LearningFinalization(summary);
  if (isValidCompleteGate3Snapshot(finalization)) {
    lastValidGate3Snapshot = toGate3EvidenceSnapshot(finalization, { source: 'GATE3_EVIDENCE_REPO' });
  }
}

export function getLastGate3FinalizationSummary(): Gate3CompletionSummaryInput | null {
  return lastGate3FinalizationSummary;
}

export function getLastValidGate3Snapshot(): Gate3EvidenceSnapshot | null {
  return lastValidGate3Snapshot;
}

export function __resetGate3FinalizationSummaryForTests(): void {
  lastGate3FinalizationSummary = null;
  lastValidGate3Snapshot = null;
}
