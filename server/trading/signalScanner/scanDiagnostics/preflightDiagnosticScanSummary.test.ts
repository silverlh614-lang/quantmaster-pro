// @responsibility Patch preflight diagnostic ScanSummary 회귀 — SNAPSHOT_MISSING/NO_SCAN_SUMMARY/PERSIST_SKIPPED 제거 검증.
import { describe, it, expect } from 'vitest';
import {
  buildPreflightDiagnosticScanSummary,
  isPreflightDiagnosticScanSummary,
} from './preflightDiagnosticScanSummary.js';
import {
  getLastScanSummary,
  setPreflightDiagnosticScanSummaryIfAbsent,
} from './persistScanResults.js';
import { buildSnapshotBundleFromScanSummary } from '../../../telegram/renderers/snapshotBundle.js';
import type { PreflightBlockedScanSummary } from '../preflightBlockedScanSummary.js';
import type { ScanSummary } from './scanSummaryTypes.js';

function preflight(overrides: Partial<PreflightBlockedScanSummary> = {}): PreflightBlockedScanSummary {
  return {
    scanId: 'pbs-202605260133-bc93',
    timestamp: '2026-05-26T01:33:00.000Z',
    stage: 'BEFORE_BUYLIST_LOOP',
    blockedBy: 'HARD_BLOCK',
    candidateSummaryCount: 9,
    universeSnapshotRecorded: true,
    counterfactualRecorded: true,
    buyListLoopEntered: false,
    gateSamples: 0,
    executionImpact: 'NONE',
    liveExecutionAllowed: false,
    scanEvaluation: {
      scanId: 'pbs-202605260133-bc93',
      asOf: '2026-05-26T01:33:00.000Z',
      evaluationState: 'NOT_EVALUATED_DIAGNOSTIC_ONLY',
      marketSessionState: 'PRE_FLIGHT_BLOCKED',
      engineMode: 'NORMAL',
      effectiveRegime: 'R3_EARLY',
      totalCandidates: 9,
      evaluated: 0,
      skipped: 9,
      rejected: 0,
      survivors: 0,
      quoteHydrated: 0,
      quoteHydrationFailed: 0,
      sourcePath: 'preflightBlockedScanSummary.recordPreflightBlockedScanSummary',
      executionImpact: 'NONE',
      shadowLearningAllowed: true,
    },
    ...overrides,
  } as PreflightBlockedScanSummary;
}

describe('preflight diagnostic ScanSummary (Patch)', () => {
  it('carries canonical scanId / candidates / zero gate pass / gate-diagnostic carry', () => {
    const summary = buildPreflightDiagnosticScanSummary(preflight());
    expect(summary.snapshotId).toBe('pbs-202605260133-bc93');
    expect(summary.candidates).toBe(9);
    expect(summary.gatePassDistribution?.gate1Pass).toBe(0);
    expect(summary.gateDiagnostics?.marketSignal).toBe(false);
    expect(summary.gateDiagnostics?.diagnosticOnly).toBe(true);
    expect(summary.gateDiagnostics?.gate1CompactText).toBeTruthy();
    expect(summary.scanEvaluation?.effectiveRegime).toBe('R3_EARLY');
    expect(isPreflightDiagnosticScanSummary(summary)).toBe(true);
  });

  it('removes SNAPSHOT_MISSING / 1970 / UNKNOWN in the gate_full snapshot bundle', () => {
    const bundle = buildSnapshotBundleFromScanSummary(buildPreflightDiagnosticScanSummary(preflight()));
    expect(bundle.sourceSnapshotId).toBe('pbs-202605260133-bc93');
    expect(bundle.sourceSnapshotId).not.toBe('SNAPSHOT_MISSING');
    expect(bundle.asOf).not.toContain('1970');
    expect(bundle.effectiveRegime).toBe('R3_EARLY');
  });

  it('isPreflightDiagnosticScanSummary returns false for a real scan summary', () => {
    const real = {
      time: '09:48 KST',
      candidates: 6,
      trackB: 0, swing: 0, catalyst: 0, momentum: 0,
      yahooFails: 0, gateMisses: 0, rrrMisses: 0, entries: 0,
      snapshotId: 'scan-eval-20260526094753',
      scanEvaluation: { sourcePath: 'scanDiagnosticsCore.persistScanResults' },
    } as unknown as ScanSummary;
    expect(isPreflightDiagnosticScanSummary(real)).toBe(false);
  });

  it('setter persists when absent and refreshes a prior preflight diagnostic without clobbering it', () => {
    // Fresh module singleton starts null in an isolated test file.
    expect(getLastScanSummary()).toBeNull();
    const first = buildPreflightDiagnosticScanSummary(preflight());
    setPreflightDiagnosticScanSummaryIfAbsent(first);
    expect(getLastScanSummary()).toBe(first);

    // A later preflight block refreshes the scanId (existing is itself a preflight diagnostic).
    const secondPf = preflight();
    secondPf.scanId = 'pbs-202605260200-aa01';
    secondPf.scanEvaluation!.scanId = 'pbs-202605260200-aa01';
    const second = buildPreflightDiagnosticScanSummary(secondPf);
    setPreflightDiagnosticScanSummaryIfAbsent(second);
    expect(getLastScanSummary()).toBe(second);
    expect(getLastScanSummary()?.snapshotId).toBe('pbs-202605260200-aa01');
  });
});
