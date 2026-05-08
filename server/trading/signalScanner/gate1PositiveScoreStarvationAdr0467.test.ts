// @responsibility ADR-0467 positive score starvation audit regression tests
import { describe, expect, it } from 'vitest';
import {
  buildEntryDecisionLedgerPositiveStarvationSummary,
  buildGate1ScoreStarvationTrace,
  buildPenaltyApplicationOrderAudit,
  buildPositiveFeatureAvailabilityAudit,
  buildPositiveScoreCalibrationResults,
  buildPositiveScoreStarvationReport,
  buildScoreCeilingAudit,
  buildScoreRangeCompressionReport,
  buildWatchlistGate1PropagationTrace,
  formatPositiveScoreStarvationReport,
  penaltyComponent,
  positiveComponent,
  type Gate1ScoreStarvationTrace,
} from './gate1PositiveScoreStarvation.js';

function makeTrace(overrides: {
  symbol?: string;
  actualScore?: number;
  watchlistScore?: number;
  importedWatchlist?: number;
  relativeStrength?: number;
  configuredPositiveMaxScore?: number;
} = {}): Gate1ScoreStarvationTrace {
  return buildGate1ScoreStarvationTrace({
    symbol: overrides.symbol ?? '005930',
    name: 'Samsung',
    requiredScore: 70,
    actualScore: overrides.actualScore ?? 21,
    watchlistScore: overrides.watchlistScore ?? 18,
    gate1ImportedWatchlistScore: overrides.importedWatchlist ?? 0,
    configuredPositiveMaxScore: overrides.configuredPositiveMaxScore,
    positiveComponents: [
      positiveComponent({ code: 'PRICE_MOMENTUM', weightedScore: 8, maxScore: 15 }),
      positiveComponent({ code: 'VOLUME_LIQUIDITY', weightedScore: 6, maxScore: 10 }),
      positiveComponent({ code: 'TECHNICAL_TREND', weightedScore: 7, maxScore: 15 }),
      positiveComponent({
        code: 'RELATIVE_STRENGTH',
        weightedScore: overrides.relativeStrength ?? 0,
        maxScore: 15,
        available: true,
        zeroContributionReason: 'not wired',
      }),
      positiveComponent({
        code: 'WATCHLIST_UPSTREAM_SCORE',
        weightedScore: overrides.importedWatchlist ?? 0,
        maxScore: 20,
        available: false,
        zeroContributionReason: 'not imported',
      }),
      positiveComponent({
        code: 'BREAKOUT_STRUCTURE',
        weightedScore: 0,
        maxScore: 10,
        available: false,
      }),
    ],
    penaltyComponents: [
      penaltyComponent({ code: 'SUPPLY_CONFLUENCE', weightedScore: -10, providerIssue: true }),
      penaltyComponent({ code: 'INVESTOR_FLOW', weightedScore: -8, providerIssue: true }),
      penaltyComponent({ code: 'SOFT_FAIL_PENALTY', weightedScore: -5, providerIssue: true }),
    ],
  });
}

describe('ADR-0467 Gate1 positive score starvation trace', () => {
  it('records grossPositiveScore and penalty separately', () => {
    const trace = makeTrace();

    expect(trace.grossPositiveScore).toBe(21);
    expect(trace.totalPenaltyScore).toBe(23);
    expect(trace.positiveUtilizationPct).toBeGreaterThan(0);
    expect(trace.scoreStarved).toBe(true);
  });

  it('netScoreAfterPenalty equals actualScore when gross and penalties reconcile', () => {
    const trace = buildGate1ScoreStarvationTrace({
      symbol: '000660',
      requiredScore: 70,
      actualScore: 21,
      positiveComponents: [
        positiveComponent({ code: 'PRICE_MOMENTUM', weightedScore: 44, maxScore: 50 }),
      ],
      penaltyComponents: [
        penaltyComponent({ code: 'RISK_PENALTY', weightedScore: -23 }),
      ],
    });

    expect(trace.netScoreAfterPenalty).toBe(trace.actualScore);
    expect(trace.starvationReason).not.toContain('NET_SCORE_ACTUAL_MISMATCH');
  });

  it('watchlist score exists but is not imported creates warning', () => {
    const propagation = buildWatchlistGate1PropagationTrace({
      symbol: '005930',
      watchlistScore: 18,
      gate1BaseScoreBeforePenalty: 21,
      gate1PositiveScore: 21,
      gate1NetScore: 21,
      actualContribution: 0,
    });

    expect(propagation.propagationIssue).toBe(true);
    expect(propagation.issueReason).toBe('WATCHLIST_SCORE_NOT_IMPORTED');
  });

  it('positive feature all zero creates allZeroFeatures warning', () => {
    const audit = buildPositiveFeatureAvailabilityAudit([
      makeTrace({ symbol: 'A', relativeStrength: 0 }),
      makeTrace({ symbol: 'B', relativeStrength: 0 }),
      makeTrace({ symbol: 'C', relativeStrength: 0 }),
    ]);

    expect(audit.allZeroFeatures).toContain('RELATIVE_STRENGTH');
    expect(audit.allZeroFeatures).toContain('WATCHLIST_UPSTREAM_SCORE');
  });

  it('actual score range compression is detected', () => {
    const report = buildScoreRangeCompressionReport([
      makeTrace({ symbol: 'A', actualScore: 17.7 }),
      makeTrace({ symbol: 'B', actualScore: 19.8 }),
      makeTrace({ symbol: 'C', actualScore: 21.7 }),
    ]);

    expect(report.compressed).toBe(true);
    expect(report.actualScoreRange).toBe(4);
  });

  it('score ceiling below required threshold creates warning', () => {
    const audit = buildScoreCeilingAudit({
      traces: [makeTrace({ configuredPositiveMaxScore: 40 })],
      configuredPositiveMaxScore: 40,
      theoreticalMaxScore: 100,
    });

    expect(audit.scoreCeilingBelowThreshold).toBe(true);
    expect(audit.message).toContain('SCORE_CEILING_BELOW_THRESHOLD');
  });

  it('requiredScoreReachable=false when configuredPositiveMaxScore < requiredScore', () => {
    const audit = buildScoreCeilingAudit({
      traces: [makeTrace()],
      configuredPositiveMaxScore: 30,
      theoreticalMaxScore: 100,
    });

    expect(audit.requiredScoreReachable).toBe(false);
  });

  it('duplicate supply penalty is detected', () => {
    const trace = makeTrace();
    const audit = buildPenaltyApplicationOrderAudit({
      symbol: trace.symbol,
      positiveBeforePenalty: trace.grossPositiveScore,
      netScore: trace.actualScore,
      penaltyComponents: trace.penaltyComponents,
    });

    expect(audit.duplicatePenaltyWarnings).toContain('DUPLICATE_SUPPLY_UNKNOWN_PENALTY');
  });

  it('risk penalty double count with Kelly is detected', () => {
    const audit = buildPenaltyApplicationOrderAudit({
      symbol: '005930',
      positiveBeforePenalty: 40,
      netScore: 30,
      sizingRiskPenalty: 0.38,
      penaltyComponents: [
        penaltyComponent({ code: 'RISK_PENALTY', weightedScore: -6.3 }),
      ],
    });

    expect(audit.duplicatePenaltyWarnings).toContain('RISK_PENALTY_DOUBLE_COUNT_WITH_KELLY');
  });

  it('IMPORT_WATCHLIST_SCORE scenario is counterfactual only', () => {
    const [result] = buildPositiveScoreCalibrationResults([makeTrace()], ['IMPORT_WATCHLIST_SCORE']);

    expect(result.scenario).toBe('IMPORT_WATCHLIST_SCORE');
    expect(result.executionImpact).toBe('NONE');
  });

  it('RESTORE_RELATIVE_STRENGTH scenario is counterfactual only', () => {
    const [result] = buildPositiveScoreCalibrationResults([makeTrace()], ['RESTORE_RELATIVE_STRENGTH']);

    expect(result.scenario).toBe('RESTORE_RELATIVE_STRENGTH');
    expect(result.executionImpact).toBe('NONE');
  });

  it('CAP_TOTAL_PENALTY scenario is counterfactual only', () => {
    const [result] = buildPositiveScoreCalibrationResults([makeTrace()], ['CAP_TOTAL_PENALTY']);

    expect(result.scenario).toBe('CAP_TOTAL_PENALTY');
    expect(result.executionImpact).toBe('NONE');
  });

  it('NORMALIZE_WEIGHTS_TO_100 scenario is counterfactual only', () => {
    const [result] = buildPositiveScoreCalibrationResults([makeTrace()], ['NORMALIZE_WEIGHTS_TO_100']);

    expect(result.scenario).toBe('NORMALIZE_WEIGHTS_TO_100');
    expect(result.executionImpact).toBe('NONE');
  });

  it('EntryDecisionLedger includes positiveScoreStarvationSummary', () => {
    const trace = makeTrace();
    const compression = buildScoreRangeCompressionReport([
      trace,
      makeTrace({ symbol: 'B', actualScore: 21.2 }),
      makeTrace({ symbol: 'C', actualScore: 21.4 }),
    ]);
    const summary = buildEntryDecisionLedgerPositiveStarvationSummary({
      trace,
      propagationTrace: buildWatchlistGate1PropagationTrace({
        symbol: trace.symbol,
        watchlistScore: 18,
        gate1BaseScoreBeforePenalty: 21,
        gate1PositiveScore: 21,
        gate1NetScore: 21,
      }),
      ceilingAudit: buildScoreCeilingAudit({ traces: [trace], configuredPositiveMaxScore: 40 }),
      compressionReport: compression,
      penaltyAudit: buildPenaltyApplicationOrderAudit({
        symbol: trace.symbol,
        positiveBeforePenalty: trace.grossPositiveScore,
        netScore: trace.actualScore,
        penaltyComponents: trace.penaltyComponents,
      }),
    });

    expect(summary.executionImpact).toBe('NONE');
    expect(summary.tags).toContain('CASE_GATE1_POSITIVE_SCORE_STARVATION');
    expect(summary.tags).toContain('CASE_WATCHLIST_SCORE_NOT_IMPORTED');
    expect(summary.tags).toContain('CASE_SCORE_CEILING_BELOW_THRESHOLD');
    expect(summary.tags).toContain('CASE_SCORE_RANGE_COMPRESSION');
    expect(summary.tags).toContain('CASE_DUPLICATE_PENALTY');
  });

  it('calibration scenarios always executionImpact NONE and report formats scan_blockers section', () => {
    const report = buildPositiveScoreStarvationReport({
      traces: [
        makeTrace({ symbol: 'A', actualScore: 17.7 }),
        makeTrace({ symbol: 'B', actualScore: 21.4 }),
        makeTrace({ symbol: 'C', actualScore: 21.7 }),
      ],
      timestamp: '2026-05-09T00:00:00.000Z',
      forDate: '2026-05-09',
      regime: 'R3_EARLY',
      marketSession: 'SELL_ONLY',
      configuredPositiveMaxScore: 40,
    });

    expect(report.calibrationResults.every((result) => result.executionImpact === 'NONE')).toBe(true);
    expect(report.wouldPassIfWatchlistScoreImported).toBe(0);
    const section = formatPositiveScoreStarvationReport(report);
    expect(section).toContain('Positive Score Starvation Audit (ADR-0467)');
    expect(section).toContain('executionImpact: NONE');
    expect(section).toContain('importWatchlist=');
  });
});
