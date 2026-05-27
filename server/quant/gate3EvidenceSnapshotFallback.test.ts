// @responsibility 회귀 테스트 — Gate3 evidence snapshot fallback 정규화(current vs lastValid) + 보존 가드.
import { describe, expect, it, beforeEach } from 'vitest';
import {
  buildGate3LearningFinalization,
  isValidCompleteGate3Snapshot,
  normalizeGate3LearningDisplay,
  toGate3EvidenceSnapshot,
  type Gate3EvidenceSnapshot,
  type Gate3LearningFinalizationSummary,
  type Gate3CompletionSummaryInput,
} from './gate3CompletionScore.js';
import { buildGate3EvidenceWarmupStatus, type Gate3EvidenceWarmupStatus } from './gate3EvidenceWarmup.js';
import {
  rememberGate3FinalizationSummary,
  getLastValidGate3Snapshot,
  getLastGate3FinalizationSummary,
  __resetGate3FinalizationSummaryForTests,
} from './gate3FinalizationState.js';

function warmup(overrides: Partial<Gate3EvidenceWarmupStatus> = {}): Gate3EvidenceWarmupStatus {
  return { ...buildGate3EvidenceWarmupStatus([]), ...overrides };
}

function finalization(overrides: Partial<Gate3LearningFinalizationSummary> = {}): Gate3LearningFinalizationSummary {
  return {
    outcomeSeeds: 0,
    labeled: 0,
    pending: 0,
    dataInsufficient: 0,
    thresholdEvidenceSampleSize: 0,
    suggestions: 0,
    completionScore: 0,
    status: 'INCOMPLETE',
    evidenceWarmup: warmup(),
    marketSignal: false,
    ...overrides,
  };
}

function completeSnapshot(overrides: Partial<Gate3EvidenceSnapshot> = {}): Gate3EvidenceSnapshot {
  return {
    snapshotId: 'gate3-prev',
    createdAt: '2026-05-26T00:00:00.000Z',
    source: 'GATE3_EVIDENCE_REPO',
    outcomeSeeds: 12,
    labeled: 1790,
    pending: 112,
    dataInsufficient: 0,
    thresholdEvidenceSampleSize: 1790,
    suggestions: 3,
    completionScore: 100,
    status: 'COMPLETE',
    evidenceReady: true,
    schedulerHealthy: true,
    ...overrides,
  };
}

const completeSummary = {
  outcomeSeeds: new Array(12).fill({}),
  outcomeTracking: { labeled: 1790, pending: 112, partial: 0, dataInsufficient: 0 },
  thresholdEvidence: { sampleSize: 1790, suggestions: [{}, {}, {}] },
  evidenceWarmup: warmup({ evidenceReady: true, schedulerHealthy: true }),
  completionScore: { status: 'COMPLETE', score: 100 },
} as unknown as Gate3CompletionSummaryInput;

const emptySummary = {
  outcomeSeeds: [],
  outcomeTracking: { labeled: 0, pending: 0, partial: 0, dataInsufficient: 0 },
  thresholdEvidence: { sampleSize: 0, suggestions: [] },
  evidenceWarmup: warmup({ evidenceReady: false }),
  completionScore: { status: 'INCOMPLETE', score: 0 },
} as unknown as Gate3CompletionSummaryInput;

describe('Gate3 Learning Evidence Snapshot Fallback Normalization', () => {
  beforeEach(() => __resetGate3FinalizationSummaryForTests());

  it('keeps last valid COMPLETE snapshot when current evidence source is empty', () => {
    const r = normalizeGate3LearningDisplay({ current: finalization(), lastValid: completeSnapshot() });
    expect(r.displayStatus).toBe('COMPLETE_LAST_VALID');
    expect(r.currentEvidenceStatus).toBe('SOURCE_EMPTY');
    expect(r.lastValidSnapshotAvailable).toBe(true);
    expect(r.lastValidLabeled).toBe(1790);
    expect(r.lastValidCompletionScore).toBe(100);
    expect(r.currentLabeled).toBe(0);
    expect(r.displaySeverity).toBe('INFO');
    expect(r.executionImpact).toBe('NONE');
  });

  it('classifies stale cohort snapshot as SOURCE_STALE and keeps last valid Gate3 evidence', () => {
    const r = normalizeGate3LearningDisplay({
      current: finalization(),
      lastValid: completeSnapshot(),
      cohortSnapshotStatus: 'COHORT_BACKFILL_SNAPSHOT_STALE',
    });
    expect(r.currentEvidenceStatus).toBe('SOURCE_STALE');
    expect(r.displayStatus).toBe('COMPLETE_LAST_VALID');
    expect(r.operatorAction).toBe('KEEP_LAST_VALID_GATE3_EVIDENCE');
    expect(r.executionImpact).toBe('NONE');
  });

  it('shows true INCOMPLETE only when no last valid snapshot exists and current evidence is empty', () => {
    const r = normalizeGate3LearningDisplay({ current: finalization(), lastValid: null });
    expect(r.displayStatus).toBe('INCOMPLETE');
    expect(r.currentEvidenceStatus).toBe('SOURCE_EMPTY');
    expect(r.operatorAction).toBe('WAIT_GATE3_EVIDENCE_WARMUP');
    expect(r.executionImpact).toBe('NONE');
  });

  it('warns when evidence source is missing but does not erase last valid complete snapshot', () => {
    const r = normalizeGate3LearningDisplay({
      current: finalization(),
      lastValid: completeSnapshot(),
      evidenceRepoAvailable: false,
    });
    expect(r.displayStatus).toBe('COMPLETE_LAST_VALID');
    expect(r.currentEvidenceStatus).toBe('SOURCE_MISSING');
    expect(r.displaySeverity).toBe('WARN');
    expect(r.operatorAction).toBe('CHECK_GATE3_EVIDENCE_SOURCE');
    expect(r.executionImpact).toBe('NONE');
  });

  it('reports COMPLETE / OK when current Gate3 evidence is complete and non-zero', () => {
    const r = normalizeGate3LearningDisplay({
      current: finalization({ labeled: 1790, thresholdEvidenceSampleSize: 1790, completionScore: 100, status: 'COMPLETE', evidenceWarmup: warmup({ evidenceReady: true }) }),
    });
    expect(r.displayStatus).toBe('COMPLETE');
    expect(r.currentEvidenceStatus).toBe('OK');
    expect(r.evidenceReady).toBe(true);
  });

  it('updates last valid snapshot only when current Gate3 evidence is complete and non-zero', () => {
    expect(getLastValidGate3Snapshot()).toBeNull();
    rememberGate3FinalizationSummary(emptySummary);
    expect(getLastValidGate3Snapshot()).toBeNull();
    rememberGate3FinalizationSummary(completeSummary);
    const snap = getLastValidGate3Snapshot();
    expect(snap?.status).toBe('COMPLETE');
    expect(snap?.labeled).toBe(1790);
    expect(snap?.thresholdEvidenceSampleSize).toBe(1790);
  });

  it('does not allow OBSERVE_ONLY or MARKET_CLOSED to zero out Gate3 last valid evidence', () => {
    rememberGate3FinalizationSummary(completeSummary);
    rememberGate3FinalizationSummary(emptySummary); // later market-closed / OBSERVE_ONLY empty scan
    const snap = getLastValidGate3Snapshot();
    expect(snap?.status).toBe('COMPLETE');
    expect(snap?.labeled).toBe(1790);
    const display = normalizeGate3LearningDisplay({
      current: buildGate3LearningFinalization(getLastGate3FinalizationSummary()),
      lastValid: getLastValidGate3Snapshot(),
    });
    expect(display.displayStatus).toBe('COMPLETE_LAST_VALID');
    expect(display.currentLabeled).toBe(0);
    expect(display.lastValidLabeled).toBe(1790);
  });

  it('validates and maps a complete finalization into a persistable snapshot', () => {
    const complete = finalization({ labeled: 1790, thresholdEvidenceSampleSize: 1790, completionScore: 100, status: 'COMPLETE', outcomeSeeds: 12, pending: 112, suggestions: 3, evidenceWarmup: warmup({ evidenceReady: true }) });
    expect(isValidCompleteGate3Snapshot(complete)).toBe(true);
    expect(isValidCompleteGate3Snapshot(finalization())).toBe(false);
    const snap = toGate3EvidenceSnapshot(complete, { snapshotId: 's1', createdAt: '2026-05-27T00:00:00.000Z' });
    expect(snap).toMatchObject({ snapshotId: 's1', labeled: 1790, thresholdEvidenceSampleSize: 1790, completionScore: 100, status: 'COMPLETE', evidenceReady: true });
  });
});
