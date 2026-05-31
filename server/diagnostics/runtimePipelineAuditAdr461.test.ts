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

  // ADR-0528 carry: section must expose the canonical sourceSnapshotId of the cycle it reflects.
  it('canonical sourceSnapshotId를 섹션에 carry (scanEvaluation.scanId fallback)', async () => {
    mockSummary = baseSummary({
      scanEvaluation: { scanId: 'scan-eval-2026-05-25T13:10:00' } as never,
    });
    const { buildRuntimePipelineAuditSnapshot, formatRuntimePipelineAuditSection } = await import('./runtimePipelineAudit.js');
    const s = buildRuntimePipelineAuditSnapshot();
    expect(s.sourceSnapshotId).toBe('scan-eval-2026-05-25T13:10:00');
    expect(formatRuntimePipelineAuditSection(s)).toContain('sourceSnapshotId: <code>scan-eval-2026-05-25T13:10:00</code>');
  });

  it('summary snapshotId 우선 — canonical id로 사용', async () => {
    mockSummary = baseSummary({ snapshotId: 'scan-eval-canonical-001' });
    const { buildRuntimePipelineAuditSnapshot } = await import('./runtimePipelineAudit.js');
    expect(buildRuntimePipelineAuditSnapshot().sourceSnapshotId).toBe('scan-eval-canonical-001');
  });

  it('summary 부재 시 NO_SCAN_SUMMARY fallback (회귀 0)', async () => {
    mockSummary = null;
    const { buildRuntimePipelineAuditSnapshot } = await import('./runtimePipelineAudit.js');
    const id = buildRuntimePipelineAuditSnapshot().sourceSnapshotId;
    // preflight-blocked store가 비어 있으면 NO_SCAN_SUMMARY, 있으면 그 scanId — 둘 다 비-비결정 표시.
    expect(typeof id).toBe('string');
    expect(id.length).toBeGreaterThan(0);
  });

  // ADR-0544 follow-up (GAP-C): 휴일/세션닫힘 verify-skip 은 SECTOR_ENERGY_DEGRADED blocker 가 아니다.
  function sectorEnergyReport(canonicalOverrides: Record<string, unknown>): unknown {
    return {
      sectorEnergyCanonicalState: {
        verifiedOfficialSectorCount: 0,
        promotionCoveragePass: false,
        ...canonicalOverrides,
      },
      // promotion-audit builder 가 읽는 최소 필드 (게이팅 무관 — blocker 산출 경로만 통과).
      sectorEnergyMaster: {
        records: [], missing: 1, stale: 0, providerError: 0,
        leadershipConfidence: 'SHADOW_ONLY', coveragePct: 0,
      },
      supplyUnknownPolicy: { providerIssue: false, marketSignal: false },
    };
  }

  it('SESSION_NOT_VERIFIABLE canonical → blockedBy 에 SECTOR_ENERGY_DEGRADED 없음', async () => {
    mockSummary = baseSummary({
      sectorEnergyQuality: 'DEGRADED',
      sectorEnergySupplyUnknownAdr0488: sectorEnergyReport({
        dataQuality: 'SESSION_NOT_VERIFIABLE',
        sectorIndexVerifyMode: 'VERIFY_SKIPPED_SESSION_CLOSED',
      }) as never,
    });
    const { buildRuntimePipelineAuditSnapshot } = await import('./runtimePipelineAudit.js');
    expect(buildRuntimePipelineAuditSnapshot().blockedBy).not.toContain('SECTOR_ENERGY_DEGRADED');
  });

  // 대조군: 장중 실제 verify 0건(MISSING)은 여전히 DEGRADED blocker 유지 (분류 분리 보존).
  it('장중 MISSING canonical → SECTOR_ENERGY_DEGRADED blocker 유지', async () => {
    mockSummary = baseSummary({
      sectorEnergyQuality: 'DEGRADED',
      sectorEnergySupplyUnknownAdr0488: sectorEnergyReport({
        dataQuality: 'MISSING',
        sectorIndexVerifyMode: 'LIVE_VERIFY',
      }) as never,
    });
    const { buildRuntimePipelineAuditSnapshot } = await import('./runtimePipelineAudit.js');
    expect(buildRuntimePipelineAuditSnapshot().blockedBy).toContain('SECTOR_ENERGY_DEGRADED');
  });
});
