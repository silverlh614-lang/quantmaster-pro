// @responsibility ADR-0470 risk double-count split regression tests
import { describe, expect, it } from 'vitest';
import { buildPositiveScoreStarvationFallbackReport } from './gate1PositiveScoreStarvation.js';
import { buildGate1ScoreCeilingRepairReport } from './gate1ScoreCeilingRepair.js';
import { buildPenaltyDeduplicationReport } from './gate1PenaltyDeduplication.js';
import {
  buildCandidateRiskDoubleCountTrace,
  buildEntryDecisionLedgerRiskDoubleCountSummary,
  buildFinalGate1CalibrationMatrix,
  buildRiskDoubleCountAuditReport,
  buildRiskMultiplierBreakdown,
  buildRiskPlacementScenarioResults,
  formatRiskDoubleCountAuditReport,
  riskPenaltyComponent,
} from './gate1RiskDoubleCount.js';
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

function makeRiskReport() {
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
  const report = buildRiskDoubleCountAuditReport({
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
  if (!report) throw new Error('expected risk report');
  return report;
}

describe('ADR-0470 risk penalty double-count split', () => {
  it('REGIME_RISK is normalized to confidence and sizing only', () => {
    const trace = buildCandidateRiskDoubleCountTrace({
      symbol: '005930',
      originalSignalScore: 21.4,
      originalSignalRiskPenalty: 6.3,
      originalKellyMultiplier: 0.26,
      requiredScore: 70,
      rootCause: 'REGIME_RISK',
    });

    expect(trace.doubleCountDetected).toBe(false);
    expect(trace.duplicateRiskRootCauses).not.toContain('REGIME_RISK');
    expect(trace.riskComponents.some((component) => component.placement === 'SIGNAL_SCORE')).toBe(false);
    expect(trace.riskComponents.some((component) => component.placement === 'CONFIDENCE_AND_SIZING_ONLY')).toBe(true);
  });

  it('non-regime same risk root cause in signal and Kelly still creates doubleCountWarning', () => {
    const trace = buildCandidateRiskDoubleCountTrace({
      symbol: '005930',
      originalSignalScore: 21.4,
      originalSignalRiskPenalty: 6.3,
      originalKellyMultiplier: 0.26,
      requiredScore: 70,
      rootCause: 'MACRO_RISK',
    });

    expect(trace.doubleCountDetected).toBe(true);
    expect(trace.duplicateRiskRootCauses).toContain('MACRO_RISK');
  });

  it('RISK_AT_SIZING_ONLY removes signal risk penalty but keeps Kelly multiplier', () => {
    const positive = makePositiveReport();
    const trace = buildCandidateRiskDoubleCountTrace({
      symbol: '005930',
      originalSignalScore: 21.4,
      originalSignalRiskPenalty: 6.3,
      originalKellyMultiplier: 0.26,
      requiredScore: 70,
    });
    const [result] = buildRiskPlacementScenarioResults({
      positive,
      traces: [trace],
      combinedKellyMultiplier: 0.26,
      finalRiskMultiplier: 0.38,
    }).filter((item) => item.scenario === 'RISK_AT_SIZING_ONLY');

    expect(result.riskPenaltyAvg).toBe(0);
    expect(result.kellyMultiplierAvg).toBe(0.26);
    expect(result.netScoreAvg).toBe(positive.netScoreAvg);
  });

  it('REMOVE_SIGNAL_RISK_KEEP_KELLY is executionImpact NONE', () => {
    const report = makeRiskReport();
    const scenario = report.scenarios.find((item) => item.scenario === 'REMOVE_SIGNAL_RISK_KEEP_KELLY');

    expect(scenario?.executionImpact).toBe('NONE');
    expect(scenario?.riskPenaltyAvg).toBe(0);
  });

  it('RISK_CAP_0_70 scenario is dry-run only', () => {
    const scenario = makeRiskReport().scenarios.find((item) => item.scenario === 'RISK_CAP_0_70');

    expect(scenario?.executionImpact).toBe('NONE');
    expect(scenario?.kellyMultiplierAvg).toBe(0.7);
  });

  it('provider issue risk is not classified as market risk', () => {
    const component = riskPenaltyComponent({
      code: 'SUPPLY_PROVIDER_UNKNOWN',
      placement: 'SIGNAL_SCORE',
      value: 3,
      providerIssue: true,
      marketSignal: false,
    });

    expect(component.providerIssue).toBe(true);
    expect(component.marketSignal).toBe(false);
  });

  it('SELL_ONLY is not included as signal risk penalty', () => {
    const component = riskPenaltyComponent({
      code: 'SELL_ONLY_SESSION',
      placement: 'POSITION_CAP',
      value: 0,
      executionBlocking: true,
      sizingOnly: true,
    });

    expect(component.placement).not.toBe('SIGNAL_SCORE');
    expect(component.sizingOnly).toBe(true);
  });

  it('risk multiplier breakdown sums to final risk multiplier', () => {
    const breakdown = buildRiskMultiplierBreakdown({
      regimeMultiplier: 0.7,
      fomcMultiplier: 1,
      sectorMultiplier: 1,
      finalRiskMultiplier: 0.38,
    });

    expect(breakdown.finalRiskMultiplier).toBe(0.38);
    expect(breakdown.combinedKellyMultiplier).toBe(0.27);
  });

  it('combined Kelly multiplier calculation is reported', () => {
    const report = makeRiskReport();

    expect(report.riskMultiplierBreakdown.combinedKellyMultiplier).toBe(0.26);
    expect(report.combinedKellyMultiplierAvg).toBe(0.26);
  });

  it('positive repair + penalty dedup + risk split scenario is calculated', () => {
    const report = makeRiskReport();
    const scenario = report.scenarios.find((item) =>
      item.scenario === 'POSITIVE_REPAIR_DEDUP_RISK_AT_SIZING_ONLY');

    expect(scenario).toBeDefined();
    expect(scenario?.executionImpact).toBe('NONE');
  });

  it('survivor from risk split dry-run is not sent to live order', () => {
    const report = makeRiskReport();

    expect(report.scenarios.every((scenario) => scenario.executionImpact === 'NONE')).toBe(true);
    expect(report.executionImpact).toBe('NONE');
  });

  it('FinalGate1CalibrationMatrix includes all required scenarios', () => {
    const matrix = buildFinalGate1CalibrationMatrix({
      positive: makePositiveReport(),
      positiveRepairDelta: 19,
      dedupDelta: 13,
      signalRiskPenalty: 6.3,
      riskSplitSurvivors: 0,
      riskCapSurvivors: 0,
    });

    expect(matrix.map((item) => item.scenario)).toEqual(expect.arrayContaining([
      'CURRENT',
      'POSITIVE_REPAIR_ONLY',
      'PENALTY_DEDUP_ONLY',
      'RISK_SPLIT_ONLY',
      'POSITIVE_REPAIR + PENALTY_DEDUP',
      'POSITIVE_REPAIR + RISK_SPLIT',
      'PENALTY_DEDUP + RISK_SPLIT',
      'POSITIVE_REPAIR + PENALTY_DEDUP + RISK_SPLIT',
      'POSITIVE_REPAIR + PENALTY_DEDUP + RISK_CAP_0.70',
    ]));
  });

  it('if all scenarios have zero survivors, recommend ADR-0471 scale calibration', () => {
    const report = makeRiskReport();

    expect(report.scaleCalibrationRecommended).toBe(true);
    expect(report.firstSurvivorScenario).toBeUndefined();
  });

  it('EntryDecisionLedger includes riskDoubleCountSummary', () => {
    const trace = buildCandidateRiskDoubleCountTrace({
      symbol: '005930',
      originalSignalScore: 21.4,
      originalSignalRiskPenalty: 6.3,
      originalKellyMultiplier: 0.26,
      requiredScore: 70,
    });
    const summary = buildEntryDecisionLedgerRiskDoubleCountSummary({
      trace,
      scenarios: makeRiskReport().scenarios,
      allScenariosZero: true,
    });

    expect(summary.executionImpact).toBe('NONE');
    expect(summary.tags).not.toContain('CASE_RISK_DOUBLE_COUNT');
    expect(summary.tags).not.toContain('CASE_RISK_SIGNAL_AND_KELLY_DUPLICATE');
    expect(summary.tags).toContain('CASE_RISK_AT_SIZING_ONLY_DRY_RUN');
    expect(summary.tags).toContain('CASE_RISK_CAP_DRY_RUN');
    expect(summary.tags).toContain('CASE_FINAL_GATE1_CALIBRATION_MATRIX');
    expect(summary.tags).toContain('CASE_SCORE_SCALE_MISMATCH_IF_NO_SURVIVORS');
  });

  it('executionImpact remains NONE for all dry-run scenarios', () => {
    const report = makeRiskReport();

    expect(report.scenarios.every((scenario) => scenario.executionImpact === 'NONE')).toBe(true);
    expect(report.finalCalibrationMatrix.every((scenario) => scenario.executionImpact === 'NONE')).toBe(true);
  });

  it('existing ADR-0462~0469 reports are not removed', async () => {
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
    expect(message).toContain('Positive Score Starvation Audit (ADR-0467)');
    expect(message).toContain('Gate1 Score Ceiling Repair Audit (ADR-0468)');
    expect(message).toContain('Penalty Deduplication Audit (ADR-0469)');
    expect(message).toContain('Risk Penalty Double-Count Audit (ADR-0470)');
  });

  it('formats telegram section with required ADR-0470 fields', () => {
    const section = formatRiskDoubleCountAuditReport(makeRiskReport());

    expect(section).toContain('signalRiskPenaltyAvg');
    expect(section).toContain('kellyRiskMultiplierAvg');
    expect(section).toContain('regimeRiskPlacement: CONFIDENCE_AND_SIZING_ONLY');
    expect(section).toContain('signalScorePenaltyApplied: false');
    expect(section).toContain('doubleCountWarning: false');
    expect(section).toContain('finalPlacement: CONFIDENCE_AND_SIZING_ONLY');
    expect(section).toContain('RISK_AT_SIZING_ONLY');
    expect(section).toContain('POSITIVE_REPAIR_DEDUP_RISK_CAP_0.70');
    expect(section).toContain('scaleCalibrationRecommended');
  });
});
