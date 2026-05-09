// @responsibility ADR-0471 final Gate1 calibration regression tests
import { describe, expect, it } from 'vitest';
import { buildPositiveScoreStarvationFallbackReport } from './gate1PositiveScoreStarvation.js';
import { buildGate1ScoreCeilingRepairReport } from './gate1ScoreCeilingRepair.js';
import { buildPenaltyDeduplicationReport } from './gate1PenaltyDeduplication.js';
import { buildRiskDoubleCountAuditReport } from './gate1RiskDoubleCount.js';
import {
  ADR_0471_FREEZE_RULE_MESSAGE,
  buildActiveComponentCoverage,
  buildActiveComponentRequiredScorePolicy,
  buildEntryDecisionLedgerFinalCalibrationSummary,
  buildFinalGate1CalibrationAuditReport,
  buildObservationPlan,
  buildProviderRecoveryPolicyGuard,
  buildThresholdSweep,
  buildUnknownPenaltyPolicyScenarioResults,
  buildUnknownPenaltyPolicyTrace,
  formatFinalGate1CalibrationReport,
} from './gate1FinalCalibration.js';
import {
  createScanCounters,
  formatScanBlockersMessage,
  getLastScanSummary,
  persistScanResults,
} from './scanDiagnostics.js';

function makePositiveReport() {
  const report = buildPositiveScoreStarvationFallbackReport({
    timestamp: '2026-05-09T00:00:00.000Z',
    forDate: '2026-05-09',
    regime: 'R3_EARLY',
    marketSession: 'SELL_ONLY',
    minSignalScoreReport: {
      timestamp: '2026-05-09T00:00:00.000Z',
      forDate: '2026-05-09',
      regime: 'R3_EARLY',
      marketSession: 'SELL_ONLY',
      totalCandidates: 45,
      minSignalFailed: 45,
      requiredScoreAvg: 70,
      actualScoreAvg: 21.4,
      actualScoreMin: 17.7,
      actualScoreMax: 21.7,
      avgScoreGap: -48.6,
      topScoreDeficits: [],
      topPenaltyContributors: [
        { code: 'SUPPLY_CONFLUENCE', avgPenalty: -10, affectedCount: 45 },
        { code: 'INVESTOR_FLOW', avgPenalty: -8, affectedCount: 45 },
        { code: 'RISK_PENALTY', avgPenalty: -6.3, affectedCount: 45 },
        { code: 'SOFT_FAIL_PENALTY', avgPenalty: -5, affectedCount: 45 },
      ],
      unknownTreatmentWarnings: 0,
      wouldPassIfUnknownNeutral: 0,
      wouldPassIfProviderPenaltyRemoved: 0,
      wouldPassIfSessionPenaltyRemoved: 0,
      wouldPassIfRiskPenaltyCapped: 0,
      wouldPassIfSoftFailPenaltyRemoved: 0,
      recommendedAction: 'REVIEW_MIN_SIGNAL_THRESHOLD',
    },
  });
  if (!report) throw new Error('expected positive report');
  return report;
}

function makeFinalReport() {
  const positive = makePositiveReport();
  const repair = buildGate1ScoreCeilingRepairReport({
    positiveStarvationReport: positive,
    timestamp: '2026-05-09T00:00:00.000Z',
    forDate: '2026-05-09',
    regime: 'R3_EARLY',
    marketSession: 'SELL_ONLY',
  });
  const dedup = buildPenaltyDeduplicationReport({
    positiveStarvationReport: positive,
    scoreCeilingRepairReport: repair,
    timestamp: '2026-05-09T00:00:00.000Z',
    forDate: '2026-05-09',
    regime: 'R3_EARLY',
    marketSession: 'SELL_ONLY',
    riskMultiplier: 0.26,
  });
  const risk = buildRiskDoubleCountAuditReport({
    positiveStarvationReport: positive,
    scoreCeilingRepairReport: repair,
    penaltyDeduplicationReport: dedup,
    timestamp: '2026-05-09T00:00:00.000Z',
    forDate: '2026-05-09',
    regime: 'R3_EARLY',
    marketSession: 'SELL_ONLY',
    regimeMultiplier: 0.7,
    fomcMultiplier: 1,
    sectorMultiplier: 1,
    finalRiskMultiplier: 0.38,
    combinedKellyMultiplier: 0.26,
  });
  const report = buildFinalGate1CalibrationAuditReport({
    positiveStarvationReport: positive,
    scoreCeilingRepairReport: repair,
    penaltyDeduplicationReport: dedup,
    riskDoubleCountReport: risk,
    timestamp: '2026-05-09T00:00:00.000Z',
    forDate: '2026-05-09',
    regime: 'R3_EARLY',
    marketSession: 'SELL_ONLY',
    providerHealth: 'UNKNOWN',
  });
  if (!report) throw new Error('expected final report');
  return report;
}

describe('ADR-0471 final Gate1 calibration', () => {
  it('UNKNOWN provider issue is not treated as BEARISH', () => {
    const trace = buildUnknownPenaltyPolicyTrace({
      symbol: '005930',
      supplySignalState: 'UNKNOWN',
      providerIssue: true,
      marketSignal: false,
      providerHealth: 'UNKNOWN',
      originalSupplyUnknownPenalty: 10,
      policyMode: 'UNKNOWN_DIAGNOSTIC_ONLY',
    });

    expect(trace.adjustedPointPenalty).toBe(0);
    expect(trace.marketSignal).toBe(false);
    expect(trace.message).toContain('UNKNOWN is not bearish');
  });

  it('providerIssue=true and marketSignal=false removes bearish point penalty in BEARISH_ONLY_SUPPLY_PENALTY scenario', () => {
    const [result] = buildUnknownPenaltyPolicyScenarioResults({
      candidates: 45,
      currentRequiredScore: 70,
      bestRepairedNetAvg: 59.7,
      originalSupplyUnknownPenalty: 10,
      providerHealth: 'UNKNOWN',
      providerIssue: true,
      marketSignal: false,
    }).filter((item) => item.scenario === 'BEARISH_ONLY_SUPPLY_PENALTY');

    expect(result.pointPenaltyAvg).toBe(0);
    expect(result.netScoreAvg).toBe(69.7);
  });

  it('UNKNOWN_DIAGNOSTIC_ONLY moves supply unknown penalty out of point score', () => {
    const [result] = buildUnknownPenaltyPolicyScenarioResults({
      candidates: 45,
      currentRequiredScore: 70,
      bestRepairedNetAvg: 59.7,
      originalSupplyUnknownPenalty: 10,
      providerHealth: 'UNKNOWN',
    }).filter((item) => item.scenario === 'UNKNOWN_DIAGNOSTIC_ONLY');

    expect(result.pointPenaltyAvg).toBe(0);
    expect(result.netScoreAvg).toBe(69.7);
    expect(result.executionImpact).toBe('NONE');
  });

  it('providerHealth=VERIFIED auto-disables unknown policy', () => {
    const guard = buildProviderRecoveryPolicyGuard({
      providerHealth: 'VERIFIED',
      unknownPolicyActive: false,
      actualSupplySignalState: 'NEUTRAL',
    });

    expect(guard.shouldAutoDisableUnknownPolicy).toBe(true);
    expect(guard.unknownPolicyActive).toBe(false);
  });

  it('provider VERIFIED with unknown policy active creates warning', () => {
    const guard = buildProviderRecoveryPolicyGuard({
      providerHealth: 'VERIFIED',
      unknownPolicyActive: true,
      actualSupplySignalState: 'NEUTRAL',
    });

    expect(guard.warningIfOverridePersists).toBe(true);
  });

  it('actual BEARISH supply signal can still apply penalty', () => {
    const trace = buildUnknownPenaltyPolicyTrace({
      symbol: '005930',
      supplySignalState: 'BEARISH',
      providerIssue: false,
      marketSignal: true,
      providerHealth: 'VERIFIED',
      originalSupplyUnknownPenalty: 10,
      policyMode: 'BEARISH_ONLY_SUPPLY_PENALTY',
    });

    expect(trace.adjustedPointPenalty).toBe(10);
  });

  it('active component required score is calculated from coverage', () => {
    const report = makeFinalReport();
    const coverage = buildActiveComponentCoverage(null);
    const policy = buildActiveComponentRequiredScorePolicy({
      regime: 'R3_EARLY',
      baseRequiredScore: 70,
      coverage,
      recommendedThreshold: report.thresholdSweep.recommendedDryRunThreshold,
    });

    expect(policy.finalDryRunRequiredScore).toBeLessThanOrEqual(70);
    expect(policy.executionImpact).toBe('NONE');
  });

  it('threshold sweep includes 70, 69.7, 68, 65, 63, 60, 58, 55, 52, 50', () => {
    const sweep = buildThresholdSweep({
      candidates: 45,
      regime: 'R3_EARLY',
      currentRequiredScore: 70,
      bestRepairedNetAvg: 59.7,
      unknownDiagnosticNetAvg: 69.7,
      targetSurvivorRange: { min: 3, max: 7 },
    });

    expect(sweep.rows.map((row) => row.threshold)).toEqual(expect.arrayContaining([
      70, 69.7, 68, 65, 63, 60, 58, 55, 52, 50,
    ]));
  });

  it('recommended threshold targets survivor range 3~7', () => {
    const report = makeFinalReport();
    const row = report.thresholdSweep.rows.find((item) =>
      item.unknownPolicy === report.thresholdSweep.recommendedUnknownPolicy &&
      item.threshold === report.thresholdSweep.recommendedDryRunThreshold);

    expect(row?.survivors).toBeGreaterThanOrEqual(3);
    expect(row?.survivors).toBeLessThanOrEqual(7);
  });

  it('liveExecutionAllowed remains false', () => {
    const report = makeFinalReport();

    expect(report.liveExecutionAllowed).toBe(false);
    expect(report.thresholdSweep.liveExecutionAllowed).toBe(false);
  });

  it('observation plan requires operator approval', () => {
    const plan = buildObservationPlan({
      startDate: '2026-05-09',
      regime: 'R3_EARLY',
      recommendedUnknownPolicy: 'UNKNOWN_DIAGNOSTIC_ONLY',
      recommendedDryRunThreshold: 70,
    });

    expect(plan.observationDays).toBe(3);
    expect(plan.operatorApprovalRequired).toBe(true);
    expect(plan.liveExecutionAllowed).toBe(false);
  });

  it('EntryDecisionLedger includes finalCalibrationSummary', () => {
    const summary = buildEntryDecisionLedgerFinalCalibrationSummary({ report: makeFinalReport() });

    expect(summary.executionImpact).toBe('NONE');
    expect(summary.tags).toContain('CASE_FINAL_GATE1_CALIBRATION');
    expect(summary.tags).toContain('CASE_UNKNOWN_NOT_BEARISH');
    expect(summary.tags).toContain('CASE_PROVIDER_RECOVERY_AUTO_DISABLE');
    expect(summary.tags).toContain('CASE_THREE_DAY_SHADOW_OBSERVATION');
    expect(summary.tags).toContain('CASE_ADR_0471_LAST_DIAGNOSTIC_ADR');
  });

  it('ADR freeze rule message appears', () => {
    const section = formatFinalGate1CalibrationReport(makeFinalReport());

    expect(section).toContain(ADR_0471_FREEZE_RULE_MESSAGE);
  });

  it('existing ADR-0464~0470 reports are not removed', async () => {
    const counters = createScanCounters();
    await persistScanResults(counters, {
      buyListLength: 45,
      intradayBuyListLength: 0,
      swingListLength: 45,
      catalystListLength: 0,
      momentumListLength: 0,
      candidateSnapshots: Array.from({ length: 45 }, (_, index) => ({
        symbol: `${index}`.padStart(6, '0'),
        name: `candidate-${index}`,
        stageReached: 'WATCHLIST',
        gateScore: 21.4,
        minSignalRequiredScore: 70,
        gate1Passed: false,
        supplyConfluenceState: 'UNKNOWN',
        minSignalScorePassed: false,
      })),
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
    expect(message).toContain('Entry Filter Decomposition (ADR-0464)');
    expect(message).toContain('Positive Score Starvation Audit (ADR-0467)');
    expect(message).toContain('Gate1 Score Ceiling Repair Audit (ADR-0468)');
    expect(message).toContain('Penalty Deduplication Audit (ADR-0469)');
    expect(message).toContain('Risk Penalty Double-Count Audit (ADR-0470)');
    expect(message).toContain('Final Gate1 Calibration (ADR-0471)');
  });

  it('executionImpact remains NONE', () => {
    const report = makeFinalReport();

    expect(report.executionImpact).toBe('NONE');
    expect(report.unknownPolicyScenarios.every((item) => item.executionImpact === 'NONE')).toBe(true);
  });
});
