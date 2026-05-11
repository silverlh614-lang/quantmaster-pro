import { existsSync, readFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { describe, expect, it } from 'vitest';
import {
  buildGate1DryRunObservationRows,
  formatGate1DryRunObservationSummary,
  listGate1DryRunObservationRows,
  saveGate1DryRunObservationRows,
  summarizeGate1DryRunObservationRows,
  updateGate1DryRunObservationOutcomes,
} from './gate1DryRunObservationLedgerAdr0476.js';
import {
  createScanCounters,
  formatScanBlockersMessage,
  getLastScanSummary,
  persistScanResults,
} from './scanDiagnostics.js';
import { buildRuntimePipelineAuditSnapshot } from '../../diagnostics/runtimePipelineAudit.js';
import type { ScanSummary } from './scanDiagnostics.js';
import { collectOperatorActionSourcesFromScanSummaryAdr0480, buildOperatorActionQueueAdr0480 } from './operatorActionRouterAdr0480.js';
import type { CandidateSnapshot } from './entryFilterDecomposition.js';
import type { FinalGate1CalibrationAuditReport } from './gate1FinalCalibration.js';
import type { Gate1PositiveSourceWiringReport } from './gate1PositiveSourceWiringAdr0475.js';

function moduleSource(): string {
  return readFileSync(new URL('./gate1DryRunObservationLedgerAdr0476.ts', import.meta.url), 'utf8');
}

function scanDiagnosticsSource(): string {
  return readFileSync(new URL('./scanDiagnostics.ts', import.meta.url), 'utf8');
}

function runtimeAuditSource(): string {
  return readFileSync(new URL('../../diagnostics/runtimePipelineAudit.ts', import.meta.url), 'utf8');
}

function finalCalibrationReport(): FinalGate1CalibrationAuditReport {
  return {
    timestamp: '2026-05-09T00:00:00.000Z',
    forDate: '2026-05-09',
    candidates: 45,
    regime: 'R3_EARLY',
    marketSession: 'SELL_ONLY',
    currentRequiredScore: 70,
    bestRepairedNetAvg: 59.7,
    unknownDiagnosticNetAvg: 69.7,
    gapToRequiredAfterUnknownDiagnostic: -0.3,
    unknownPolicyScenarios: [{
      scenario: 'UNKNOWN_DIAGNOSTIC_ONLY',
      pointPenaltyAvg: 0,
      confidenceDowngradeAvg: 0.15,
      netScoreAvg: 69.7,
      scoreMin: 68,
      scoreMax: 72,
      gate1Survivors: 4,
      strongBuyBlockedCount: 45,
      executionImpact: 'NONE',
      survivorExamples: [{
        symbol: '005930',
        name: 'Samsung',
        beforeScore: 59.7,
        afterScore: 70.2,
        requiredScore: 70,
        reason: ['UNKNOWN_DIAGNOSTIC_ONLY'],
      }],
    }],
    providerRecoveryGuard: {
      providerHealth: 'UNKNOWN',
      unknownPolicyActive: true,
      shouldAutoDisableUnknownPolicy: false,
      actualSupplySignalState: 'UNKNOWN',
      warningIfOverridePersists: false,
      message: 'unknown policy active only while provider is not VERIFIED',
    },
    activeComponentCoverage: {
      totalCoreComponents: 6,
      activeCoreComponents: 6,
      activeCoveragePct: 100,
      missingComponents: [],
      diagnosticOnlyComponents: ['SUPPLY_UNKNOWN'],
      verifiedComponents: ['WATCHLIST_UPSTREAM_SCORE'],
    },
    requiredScorePolicy: {
      regime: 'SELL_ONLY',
      baseRequiredScore: 70,
      activeCoveragePct: 100,
      coverageAdjustedRequiredScore: 70,
      unknownPolicyAdjustedRequiredScore: 70,
      finalDryRunRequiredScore: 70,
      hardFloor: 50,
      hardCeiling: 70,
      targetSurvivorRange: { min: 3, max: 7 },
      enableMode: 'SHADOW_ONLY',
      executionImpact: 'NONE',
    },
    thresholdSweep: {
      candidates: 45,
      regime: 'R3_EARLY',
      currentRequiredScore: 70,
      bestRepairedNetAvg: 59.7,
      unknownDiagnosticNetAvg: 69.7,
      rows: [],
      targetSurvivorRange: { min: 3, max: 7 },
      recommendedUnknownPolicy: 'UNKNOWN_DIAGNOSTIC_ONLY',
      liveExecutionAllowed: false,
    },
    observationPlan: {
      observationDays: 3,
      startDate: '2026-05-09',
      regime: 'R3_EARLY',
      recommendedUnknownPolicy: 'UNKNOWN_DIAGNOSTIC_ONLY',
      recommendedDryRunThreshold: 70,
      targetSurvivorRange: { min: 3, max: 7 },
      metricsToTrack: {
        survivorCount: true,
        avgForwardReturn1D: true,
        avgForwardReturn3D: true,
        avgForwardReturn5D: true,
        falsePositiveRate: true,
        wouldHaveHitStopLoss: true,
        wouldHaveReachedTarget: true,
      },
      liveExecutionAllowed: false,
      operatorApprovalRequired: true,
    },
    freezeRuleMessage: 'ADR-0471 marks the final diagnostic calibration ADR.',
    liveExecutionAllowed: false,
    executionImpact: 'NONE',
  };
}

function positiveWiringReport(): Gate1PositiveSourceWiringReport {
  return {
    timestamp: '2026-05-09T00:00:00.000Z',
    forDate: '2026-05-09',
    regime: 'R3_EARLY',
    marketSession: 'SELL_ONLY',
    totalCandidates: 45,
    watchlistUpstreamZeroCount: 45,
    relativeStrengthZeroCount: 45,
    breakoutStructureZeroCount: 45,
    otherPositiveSharePct: 100,
    watchlistUpstreamAvgScore: 7.8,
    watchlistScoreVerified: 0,
    watchlistScoreMissing: 45,
    watchlistScoreScale: 'NORMALIZED_100',
    watchlistScoreSourceFieldDistribution: { none: 45 },
    relativeStrengthAvgScore: 5.7,
    breakoutStructureAvgScore: 2.8,
    beforeNetScoreAvg: 21.4,
    afterDryRunNetScoreAvg: 64.8,
    beforeScoreRange: 4,
    afterDryRunScoreRange: 9.8,
    beforeCompressed: true,
    afterCompressed: false,
    dryRunScenarios: [{
      scenario: 'WIRE_ALL_PLUS_DEDUP_PLUS_RISK_SPLIT',
      positiveScoreAvg: 68.9,
      penaltyAvg: 4.1,
      netScoreAvg: 64.8,
      scoreMin: 60.2,
      scoreMax: 66.4,
      scoreRange: 9.8,
      compressed: false,
      requiredScore: 70,
      hypotheticalSurvivors: 0,
      executionImpact: 'NONE',
      liveExecutionAllowed: false,
      policyPromotionMode: 'SHADOW_ONLY',
    }],
    watchlistTraces: [],
    relativeStrengthTraces: [],
    breakoutTraces: [],
    otherPositiveDecompositions: [],
    executionImpact: 'NONE',
    liveExecutionAllowed: false,
    policyPromotionMode: 'SHADOW_ONLY',
    observationDays: 3,
    operatorApprovalRequired: true,
    recommendedAction: 'OBSERVE_3D',
  };
}

function snapshots(): CandidateSnapshot[] {
  return [
    {
      symbol: '005930',
      name: 'Samsung',
      gateScore: 65.2,
      minSignalRequiredScore: 70,
      gate1Passed: false,
      supplyProviderHealth: { providerIssue: true, marketSignal: false },
      sectorEnergyState: 'DIAGNOSTIC_ONLY',
    },
    {
      symbol: '000660',
      name: 'SK hynix',
      gateScore: 61,
      minSignalRequiredScore: 70,
      gate1Passed: false,
      supplyProviderHealth: { providerIssue: true, marketSignal: false },
    },
  ];
}

describe('ADR-0476 Gate1 Dry-run Observation Ledger', () => {
  it('records ADR-0471 UNKNOWN_DIAGNOSTIC_ONLY survivor as observation only', () => {
    const rows = buildGate1DryRunObservationRows({
      forDate: '2026-05-09',
      finalGate1Calibration: finalCalibrationReport(),
      sellOnly: true,
      providerIssue: true,
      marketSignal: false,
    });
    const row = rows.find((item) => item.source === 'ADR_0471_UNKNOWN_DIAGNOSTIC_ONLY');
    expect(row).toBeTruthy();
    expect(row?.dryRunDecision).toBe('UNKNOWN_DIAGNOSTIC_ONLY');
    expect(row?.liveExecutionAllowed).toBe(false);
    expect(row?.executionImpact).toBe('NONE');
    expect(row?.actualLiveEligible).toBe(false);
  });

  it('records ADR-0475 positive wiring near-miss and preserves provider semantics', () => {
    const rows = buildGate1DryRunObservationRows({
      forDate: '2026-05-09',
      gate1PositiveSourceWiring: positiveWiringReport(),
      candidateSnapshots: snapshots(),
      sellOnly: true,
      providerIssue: true,
      marketSignal: false,
      sectorEnergyDiagnosticOnly: true,
    });
    const row = rows.find((item) => item.source === 'ADR_0475_POSITIVE_SOURCE_WIRING');
    expect(row?.dryRunScenario).toBe('WIRE_ALL_PLUS_DEDUP_PLUS_RISK_SPLIT');
    expect(row?.sellOnly).toBe(true);
    expect(row?.providerIssue).toBe(true);
    expect(row?.marketSignal).toBe(false);
    expect(row?.sectorEnergyDiagnosticOnly).toBe(true);
    expect(row?.liveExecutionAllowed).toBe(false);
  });

  it('stores scoreGap >= -5 actual Gate1 near-miss rows', () => {
    const rows = buildGate1DryRunObservationRows({
      forDate: '2026-05-09',
      candidateSnapshots: snapshots(),
      sellOnly: true,
    });
    const nearMiss = rows.find((item) => item.source === 'GATE1_NEAR_MISS');
    expect(nearMiss?.scoreGap).toBeGreaterThanOrEqual(-5);
    expect(nearMiss?.dryRunDecision).toBe('NEAR_MISS');
  });

  it('dedupes same forDate+symbol+source+scenario while preserving createdAt', async () => {
    const filePath = join(tmpdir(), `adr0476-${Date.now()}.json`);
    try {
      const rows = buildGate1DryRunObservationRows({
        now: new Date('2026-05-09T00:00:00.000Z'),
        forDate: '2026-05-09',
        finalGate1Calibration: finalCalibrationReport(),
      });
      await saveGate1DryRunObservationRows(rows, filePath);
      await saveGate1DryRunObservationRows(rows.map((row) => ({ ...row, createdAt: '2099-01-01T00:00:00.000Z' })), filePath);
      const saved = await listGate1DryRunObservationRows({}, filePath);
      expect(saved).toHaveLength(rows.length);
      expect(saved[0]?.createdAt).toBe('2026-05-09T00:00:00.000Z');
    } finally {
      rmSync(filePath, { force: true });
    }
  });

  it('/scan_blockers includes ADR-0476 section without raw Telegram HTML', async () => {
    const counters = createScanCounters();
    await persistScanResults(counters, {
      sellOnly: true,
      buyListLength: 2,
      intradayBuyListLength: 0,
      swingListLength: 2,
      catalystListLength: 0,
      momentumListLength: 0,
      candidateSnapshots: snapshots(),
      macroGateState: {
        emergencyStop: false,
        autoTradeEnabled: true,
        regime: 'R3_EARLY',
        kellyMultiplierFromRegime: 0.7,
        fomcPhase: 'NONE',
        fomcKellyMultiplier: 1,
        finalKellyMultiplier: 0.26,
        vixGatingActive: false,
        bearDefenseMode: false,
        mhsBelow30: false,
        watchlistEmpty: false,
        sellOnlyMode: true,
      },
    });
    const message = formatScanBlockersMessage(getLastScanSummary());
    const start = message.indexOf('Gate1 Dry-run Observation Ledger (ADR-0476)');
    const end = message.indexOf('\n\n', start);
    const section = message.slice(start, end === -1 ? undefined : end);
    expect(section).toContain('rowsCreated:');
    expect(section).toContain('liveExecutionAllowed: false');
    expect(section).not.toMatch(/<b>|<i>|<code>/);
  });

  it('runtimePipelineAudit removes NO_DRY_RUN_RECORDS when ADR-0476 rows exist and keeps ADR_460_NOT_INSTALLED', async () => {
    const counters = createScanCounters();
    await persistScanResults(counters, {
      sellOnly: true,
      buyListLength: 2,
      intradayBuyListLength: 0,
      swingListLength: 2,
      catalystListLength: 0,
      momentumListLength: 0,
      candidateSnapshots: snapshots(),
      macroGateState: {
        emergencyStop: false,
        autoTradeEnabled: true,
        regime: 'R3_EARLY',
        kellyMultiplierFromRegime: 0.7,
        fomcPhase: 'NONE',
        fomcKellyMultiplier: 1,
        finalKellyMultiplier: 0.26,
        vixGatingActive: false,
        bearDefenseMode: false,
        mhsBelow30: false,
        watchlistEmpty: false,
        sellOnlyMode: true,
      },
    });
    const snapshot = buildRuntimePipelineAuditSnapshot();
    expect(snapshot.dryRunRecordCount).toBeGreaterThan(0);
    expect(snapshot.blockedBy).not.toContain('NO_DRY_RUN_RECORDS');
    expect(snapshot.blockedBy).toContain('ADR_460_NOT_INSTALLED');
  });

  it('outcome updater remains pending when price cache is unavailable or not matured', async () => {
    const rows = buildGate1DryRunObservationRows({
      now: new Date('2026-05-09T00:00:00.000Z'),
      forDate: '2026-05-09',
      candidateSnapshots: snapshots(),
    });
    const missing = await updateGate1DryRunObservationOutcomes({ rows, priceCacheAvailable: false });
    const notMatured = await updateGate1DryRunObservationOutcomes({
      rows,
      now: new Date('2026-05-09T01:00:00.000Z'),
    });
    expect(missing.reason).toBe('PRICE_CACHE_MISSING');
    expect(notMatured.reason).toBe('NOT_MATURED');
  });

  it('summarizes rows by status and source', () => {
    const rows = buildGate1DryRunObservationRows({
      forDate: '2026-05-09',
      finalGate1Calibration: finalCalibrationReport(),
      gate1PositiveSourceWiring: positiveWiringReport(),
      candidateSnapshots: snapshots(),
    });
    const summary = summarizeGate1DryRunObservationRows(rows);
    const formatted = formatGate1DryRunObservationSummary(summary);
    expect(summary.pending).toBe(rows.length);
    expect(summary.sources.ADR_0471_UNKNOWN_DIAGNOSTIC_ONLY).toBeGreaterThan(0);
    expect(summary.executionImpact).toBe('NONE');
    expect(formatted).toContain('TRACK_1D_3D_5D_FORWARD_RETURNS');
  });

  it('static guards and ADR document/index are present', () => {
    const source = moduleSource();
    const scanSource = scanDiagnosticsSource();
    const runtimeSource = runtimeAuditSource();
    for (const text of [source, scanSource, runtimeSource]) {
      expect(text).not.toContain('placeKisMarketBuyOrder');
      expect(text).not.toContain('placeKisSellOrder');
      expect(text).not.toContain('placeKisStopLossOrder');
      expect(text).not.toContain('placeKisTakeProfitOrder');
      expect(text).not.toContain('cancelKisOrder');
      expect(text).not.toContain('fetch(');
      expect(text).not.toContain('axios');
      expect(text).not.toContain('setGateThreshold');
      expect(text).not.toContain('GATE_RELAX');
      expect(text).not.toContain('STRONG_BUY_OVERRIDE');
      expect(text).not.toContain('liveExecutionAllowed: true');
      expect(text).not.toContain("executionImpact: 'HARD_BLOCK'");
      expect(text).not.toContain('rawPayload');
    }
    const root = process.cwd();
    const doc = join(root, 'docs/adr/0476-gate1-near-miss-dry-run-observation-ledger.md');
    expect(existsSync(doc)).toBe(true);
    expect(readFileSync(doc, 'utf8')).toContain('Shadow-only observation');
    expect(readFileSync(join(root, 'docs/adr/INDEX.md'), 'utf8')).toContain('다음 ADR 번호:');
  });
});


describe('ADR-0476 Gate1 dry-run observation ledger evidence for ADR-0480', () => {
  it('DATA_BLOCKED_NEAR_MISS summary becomes advisory Gate1 near-miss operator action', () => {
    const summary = {
      time: '2026-05-09 09:00',
      candidates: 1,
      trackB: 0,
      swing: 0,
      catalyst: 0,
      momentum: 0,
      yahooFails: 0,
      gateMisses: 1,
      rrrMisses: 0,
      entries: 0,
      gateScoreCandidateBuckets: { counts: { DATA_BLOCKED_NEAR_MISS: 2 } as never, dataBlockedNearMissTopUnavailable: [], probingTopConditions: [], totalNearMissLike: 2 },
    } as ScanSummary;
    const report = buildOperatorActionQueueAdr0480({ sources: collectOperatorActionSourcesFromScanSummaryAdr0480(summary) });
    expect(report.allActions.map((a) => a.rootCause)).toContain('GATE1_NEAR_MISS_DATA_BLOCKED');
    expect(report.allActions.every((a) => a.policyPromotionMode === 'SHADOW_ONLY')).toBe(true);
  });
});
