import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { ScanSummary } from '../trading/signalScanner/scanDiagnostics.js';

let mockSummary: ScanSummary | null = null;
let mockWatchlist: unknown[] = [];
let mockNearMiss: unknown[] = [];
let mockDryRun: unknown[] = [];
let mockRollout: { items: unknown[] } | null = null;
let mockProviderHealth: unknown[] = [];

vi.mock('../trading/signalScanner/scanDiagnostics.js', () => ({
  getLastScanSummary: () => mockSummary,
  // Patch-VITEST-BASELINE-001: scanDiagnostics.ts:374 canonical default — mock must export
  // this value because runtimePipelineAudit.ts:458 uses it as a non-null fallback.
  DEFAULT_DATA_PROMOTION_STATUS: {
    kisInvestorFlow: 'WEIGHTED',
    sectorEnergy: 'WEIGHTED',
    dartFinancials: 'ADVISORY',
    yahooPrice: 'GATED',
  },
}));
vi.mock('../persistence/watchlistRepo.js', () => ({ loadWatchlist: () => mockWatchlist }));
vi.mock('../persistence/nearMissOutcomeLedger.js', () => ({ getAllNearMissOutcomes: () => mockNearMiss }));
vi.mock('../persistence/gateReclassificationDryRunRepo.js', () => ({ loadGateReclassificationDryRunRecords: () => mockDryRun }));
// Patch-VITEST-BASELINE-001: runtimePipelineAudit.ts:322 adds gate1ObservationLedgerCount
// to dryRunRecordCount; without this mock the test reads real on-disk persisted data
// (data/gate1-dry-run-observation-ledger.json) and the "dryRunRecordCount === 0" assertion fails.
vi.mock('../trading/signalScanner/gate1DryRunObservationLedgerAdr0476.js', () => ({
  getGate1DryRunObservationLedgerCount: () => 0,
}));
vi.mock('../persistence/gateReclassificationRolloutRepo.js', () => ({ loadGateReclassificationRolloutPlan: () => mockRollout }));
vi.mock('../supply/investorFlowProviderHealth.js', () => ({ getLastInvestorFlowProviderHealth: () => mockProviderHealth }));
vi.mock('../state.js', () => ({ getEmergencyStop: () => false, getExecutionMode: () => 'OFF' }));
vi.mock('./livePathSafetyAudit.js', () => ({
  runLivePathSafetyAudit: () => ({
    kisOrderImportDetected: false,
    normalizedGateScoreLiveDecisionDetected: false,
    createLiveOrderTrueDetected: false,
    executionImpactFullOrPartialDetected: false,
    gateThresholdMutationDetected: false,
    kellyMutationDetected: false,
    coreRolloutDetected: false,
    unexpectedAdr460ArtifactDetected: false,
    passed: true,
    findings: ['ok'],
  }),
}));

function baseSummary(overrides: Partial<ScanSummary> = {}): ScanSummary {
  return {
    time: '2026-05-08 08:00',
    candidates: 3,
    trackB: 0,
    swing: 0,
    catalyst: 0,
    momentum: 0,
    yahooFails: 0,
    gateMisses: 0,
    rrrMisses: 0,
    entries: 0,
    macroGateState: {
      emergencyStop: false,
      autoTradeEnabled: false,
      regime: 'NORMAL',
      kellyMultiplierFromRegime: 1,
      fomcPhase: 'NONE',
      fomcKellyMultiplier: 1,
      finalKellyMultiplier: 1,
      vixGatingActive: false,
      bearDefenseMode: false,
      mhsBelow30: false,
      watchlistEmpty: false,
      sellOnlyMode: false,
    },
    ...overrides,
  } as ScanSummary;
}

describe('ADR-461 runtime pipeline audit', () => {
  beforeEach(() => {
    mockSummary = null;
    mockWatchlist = [{ code: '005930' }];
    mockNearMiss = [];
    mockDryRun = [];
    mockRollout = null;
    mockProviderHealth = [];
    delete process.env.RUNTIME_PIPELINE_AUDIT_DISABLED;
    delete process.env.AUTO_TRADE_ENABLED;
  });

  it('ScanSummary 없음 → latestStage NOT_RUN', async () => {
    const { buildRuntimePipelineAuditSnapshot } = await import('./runtimePipelineAudit.js');
    const s = buildRuntimePipelineAuditSnapshot();
    expect(s.latestStage).toBe('NOT_RUN');
    expect(s.scanSummaryPersisted).toBe(false);
  });

  it('장외 SELL_ONLY → blockedBy SELL_ONLY_SESSION', async () => {
    mockSummary = baseSummary({ macroGateState: { ...baseSummary().macroGateState!, sellOnlyMode: true } });
    const { buildRuntimePipelineAuditSnapshot } = await import('./runtimePipelineAudit.js');
    expect(buildRuntimePipelineAuditSnapshot().blockedBy).toContain('SELL_ONLY_SESSION');
  });

  it('buyListLoop 미도달 → gate samples 0 이유 표시', async () => {
    mockSummary = baseSummary();
    const { buildRuntimePipelineAuditSnapshot } = await import('./runtimePipelineAudit.js');
    const s = buildRuntimePipelineAuditSnapshot();
    expect(s.latestStage).toBe('BEFORE_BUYLIST_LOOP');
    expect(s.gateScoreHealthSamples).toBe(0);
    expect(s.operatorMessage).toContain('buyListLoop 이전');
  });

  it('Gate Score Health samples > 0이면 sample count 표시', async () => {
    mockSummary = baseSummary({ gateScoreHealth: { samples: 2, rawScoreAvg: 1, availableMaxScoreAvg: 2, normalizedGateScoreAvg: 0.5, unavailableTop: [], thresholdNotMetTop: [], providerDegradedTop: [], diagnosis: 'MIXED' } });
    const { buildRuntimePipelineAuditSnapshot } = await import('./runtimePipelineAudit.js');
    expect(buildRuntimePipelineAuditSnapshot().gateScoreHealthSamples).toBe(2);
  });

  it('NearMiss bucket samples > 0이면 count 표시', async () => {
    mockSummary = baseSummary({ gateScoreHealth: { samples: 1, rawScoreAvg: 1, availableMaxScoreAvg: 2, normalizedGateScoreAvg: 0.5, unavailableTop: [], thresholdNotMetTop: [], providerDegradedTop: [], diagnosis: 'MIXED' }, gateScoreCandidateBuckets: { counts: { DATA_BLOCKED_NEAR_MISS: 2 } as never, dataBlockedNearMissTopUnavailable: [], probingTopConditions: [], totalNearMissLike: 2 } });
    const { buildRuntimePipelineAuditSnapshot } = await import('./runtimePipelineAudit.js');
    expect(buildRuntimePipelineAuditSnapshot().nearMissBucketSamples).toBe(2);
  });

  it('nearMissOutcome ledger count 표시', async () => {
    mockSummary = baseSummary();
    mockNearMiss = [{ id: 'a' }, { id: 'b' }];
    const { buildRuntimePipelineAuditSnapshot } = await import('./runtimePipelineAudit.js');
    expect(buildRuntimePipelineAuditSnapshot().nearMissOutcomeLedgerCount).toBe(2);
  });

  it('dry-run repo 없으면 dryRunRecordCount 0', async () => {
    mockSummary = baseSummary();
    const { buildRuntimePipelineAuditSnapshot } = await import('./runtimePipelineAudit.js');
    expect(buildRuntimePipelineAuditSnapshot().dryRunRecordCount).toBe(0);
  });

  it('rollout repo 없으면 rolloutItemCount 0', async () => {
    mockSummary = baseSummary();
    const { buildRuntimePipelineAuditSnapshot } = await import('./runtimePipelineAudit.js');
    expect(buildRuntimePipelineAuditSnapshot().rolloutItemCount).toBe(0);
  });

  it('ADR-460은 항상 not installed로 표시', async () => {
    const { buildRuntimePipelineAuditSnapshot, formatRuntimePipelineAuditSection } = await import('./runtimePipelineAudit.js');
    const s = buildRuntimePipelineAuditSnapshot();
    expect(s.adr460Installed).toBe(false);
    expect(formatRuntimePipelineAuditSection(s)).toContain('not installed');
  });

  it('ENV disabled 정확 비교', async () => {
    const { isRuntimePipelineAuditDisabled } = await import('./runtimePipelineAudit.js');
    process.env.RUNTIME_PIPELINE_AUDIT_DISABLED = 'TRUE';
    expect(isRuntimePipelineAuditDisabled()).toBe(false);
    process.env.RUNTIME_PIPELINE_AUDIT_DISABLED = 'true';
    expect(isRuntimePipelineAuditDisabled()).toBe(true);
  });
});
