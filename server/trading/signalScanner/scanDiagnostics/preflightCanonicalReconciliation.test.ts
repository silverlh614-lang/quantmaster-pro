// @responsibility Patch preflight canonical reconciliation 회귀 — frozen preflight vs runtime truth 정합 + mismatch 표시.
import { describe, it, expect, vi, beforeEach } from 'vitest';

const { mockSummarize } = vi.hoisted(() => ({ mockSummarize: vi.fn() }));

vi.mock('../../../persistence/counterfactualUniverseLearningRepo.js', () => ({
  summarizeCounterfactualUniverseLearningLedger: mockSummarize,
}));

import {
  buildPreflightCanonicalReconciliation,
  formatPreflightCanonicalReconciliationSection,
} from './preflightCanonicalReconciliation.js';
import type { PreflightBlockedScanSummary } from '../preflightBlockedScanSummary.js';
import type { ScanSummary } from './scanSummaryTypes.js';

function preflight(overrides: Partial<PreflightBlockedScanSummary> = {}): PreflightBlockedScanSummary {
  return {
    scanId: 'pbs-202605260948-aaaa',
    timestamp: '2026-05-26T09:48:00.000Z',
    stage: 'BEFORE_BUYLIST_LOOP',
    blockedBy: 'HARD_BLOCK',
    candidateSummaryCount: 6,
    universeSnapshotRecorded: false,
    counterfactualRecorded: false,
    buyListLoopEntered: false,
    gateSamples: 0,
    executionImpact: 'NONE',
    liveExecutionAllowed: false,
    ...overrides,
  } as PreflightBlockedScanSummary;
}

function summary(overrides: Record<string, unknown> = {}): ScanSummary {
  return {
    time: '09:48 KST',
    snapshotId: 'scan-eval-20260526094753',
    gateScoreHealth: { samples: 3 },
    gatePassDistribution: { gate1Pass: 0 },
    ...overrides,
  } as unknown as ScanSummary;
}

describe('preflight canonical reconciliation (Patch)', () => {
  beforeEach(() => mockSummarize.mockReset());

  it('reconciles frozen false flags to runtime truth and emits canonical mismatch warnings', () => {
    mockSummarize.mockReturnValue({ totalSnapshots: 2 });
    const recon = buildPreflightCanonicalReconciliation(summary(), preflight());
    expect(recon.universeSnapshotRecorded).toBe(true);
    expect(recon.counterfactualRecorded).toBe(true);
    expect(recon.shadowLearningRecorded).toBe(true);
    expect(recon.buyListLoopEnteredDiagnostic).toBe(true); // gateSamples=3 from summary
    expect(recon.diagnosticCarried).toBe(true);
    expect(recon.executionImpact).toBe('NONE');
    const joined = recon.mismatches.join('\n');
    expect(joined).toContain('[QMP_DIAGNOSTIC_CANONICAL_MISMATCH] universeSnapshotRecorded');
    expect(joined).toContain('[QMP_DIAGNOSTIC_CANONICAL_MISMATCH] counterfactualRecorded');
    expect(joined).toContain('[QMP_DIAGNOSTIC_CANONICAL_MISMATCH] buyListLoopEntered');
  });

  it('prefers summary scanId and warns when it diverges from the preflight scanId', () => {
    mockSummarize.mockReturnValue({ totalSnapshots: 0 });
    const recon = buildPreflightCanonicalReconciliation(
      summary({ snapshotId: 'scan-eval-X' }),
      preflight({ scanId: 'pbs-Y' }),
    );
    expect(recon.canonicalScanId).toBe('scan-eval-X');
    expect(recon.mismatches.join('\n')).toContain('scanId preflight=pbs-Y vs summary=scan-eval-X');
  });

  it('emits no warnings when frozen flags already agree with runtime', () => {
    mockSummarize.mockReturnValue({ totalSnapshots: 0 });
    const recon = buildPreflightCanonicalReconciliation(
      null,
      preflight({ universeSnapshotRecorded: true, counterfactualRecorded: true }),
    );
    expect(recon.universeSnapshotRecorded).toBe(true);
    expect(recon.buyListLoopEnteredDiagnostic).toBe(false);
    expect(recon.mismatches).toHaveLength(0);
    expect(recon.canonicalScanId).toBe('pbs-202605260948-aaaa');
  });

  it('falls back to frozen flags when ledger read is malformed (no silent bearish conversion)', () => {
    // Malformed ledger result → `.totalSnapshots` access throws inside the builder's try/catch.
    mockSummarize.mockReturnValue(null as never);
    const recon = buildPreflightCanonicalReconciliation(null, preflight({ universeSnapshotRecorded: false }));
    expect(recon.universeSnapshotRecorded).toBe(false);
    expect(recon.executionImpact).toBe('NONE');
    expect(recon.mismatches).toHaveLength(0);
  });

  it('renders canonical fields and a warnings line in the formatted section', () => {
    mockSummarize.mockReturnValue({ totalSnapshots: 1 });
    const text = formatPreflightCanonicalReconciliationSection(
      buildPreflightCanonicalReconciliation(summary(), preflight()),
    );
    expect(text).toContain('[Canonical Reconciliation]');
    expect(text).toContain('canonicalScanId=scan-eval-20260526094753');
    expect(text).toContain('preflightBlocked=true');
    expect(text).toContain('liveExecutionBlocked=true');
    expect(text).toContain('universeSnapshotRecorded=true');
    expect(text).toContain('executionImpact=NONE');
    expect(text).toContain('CanonicalWarnings:');
  });
});
