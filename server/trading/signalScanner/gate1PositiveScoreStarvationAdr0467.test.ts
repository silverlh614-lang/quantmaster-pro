// @responsibility ADR-0467 positive score starvation audit regression tests
import { describe, expect, it } from 'vitest';
import {
  buildPositiveScoreStarvationFallbackReport,
  buildEntryDecisionLedgerPositiveStarvationSummary,
  buildGate1ScoreStarvationTrace,
  buildGate1ScoreStarvationTraceFromGateResult,
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
import {
  createScanCounters,
  formatScanBlockersMessage,
  getLastScanSummary,
  persistScanResults,
} from './scanDiagnostics.js';

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
    expect(audit.featureAvailability.find((item) => item.code === 'WATCHLIST_UPSTREAM_SCORE')?.missingCount).toBe(3);
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
    expect(section).toContain('🧬 Positive Score Starvation Audit (ADR-0467)');
    expect(section).toContain('executionImpact: NONE');
    expect(section).toContain('importWatchlist=');
  });

  it('/scan_blockers includes ADR-0467 section when buyListLoopEntered=false', async () => {
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
        finalKellyMultiplier: 0.2646,
        vixGatingActive: false,
        bearDefenseMode: false,
        mhsBelow30: false,
        watchlistEmpty: false,
        sellOnlyMode: true,
      },
    });

    const message = formatScanBlockersMessage(getLastScanSummary());
    expect(message).toContain('🧬 Positive Score Starvation Audit (ADR-0467)');
    expect(message).toContain('grossPositiveScoreAvg');
    expect(message).toContain('totalPenaltyScoreAvg');
    expect(message).toContain('positiveUtilizationAvg');
    expect(message).toContain('zeroContributionComponents');
    expect(message).toContain('scoreCeilingAudit');
    expect(message).toContain('actualScoreRange');
    expect(message).toContain('compressed');
  });



  it('current-path verified WATCHLIST_UPSTREAM_SCORE is not counted as zero starvation', () => {
    const trace = buildGate1ScoreStarvationTrace({
      symbol: 'P08',
      requiredScore: 70,
      actualScore: 24,
      positiveComponents: [
        positiveComponent({ code: 'PRICE_MOMENTUM', weightedScore: 8, maxScore: 15 }),
        positiveComponent({
          code: 'WATCHLIST_UPSTREAM_SCORE',
          weightedScore: 2.6,
          maxScore: 20,
          available: true,
          confidence: 'VERIFIED',
        }),
        positiveComponent({ code: 'BREAKOUT_STRUCTURE', weightedScore: 0, maxScore: 10, available: false, confidence: 'MISSING' }),
      ],
      penaltyComponents: [],
    });
    const report = buildPositiveScoreStarvationReport({
      traces: [trace],
      timestamp: '2026-05-11T00:00:00.000Z',
      forDate: '2026-05-11',
      regime: 'R3_EARLY',
      marketSession: 'SELL_ONLY',
    });

    expect(report.zeroContributionComponents.map((item) => item.code)).not.toContain('WATCHLIST_UPSTREAM_SCORE');
    expect(report.missingPositiveComponents.map((item) => item.code)).toContain('BREAKOUT_STRUCTURE');
    expect(report.currentPathComponentStatus.find((item) => item.code === 'WATCHLIST_UPSTREAM_SCORE')).toMatchObject({
      verified: 1,
      missing: 0,
      avgContribution: 2.6,
    });
    expect(formatPositiveScoreStarvationReport(report)).toContain('WATCHLIST_UPSTREAM_SCORE: verified 1 / missing 0 / avg +2.6');
  });

  it('canonical runtime wiring removes computed RS and mapped breakout from missing display', () => {
    const report = buildPositiveScoreStarvationReport({
      traces: [makeTrace()],
      timestamp: '2026-05-11T00:00:00.000Z',
      forDate: '2026-05-11',
      regime: 'R3_EARLY',
      marketSession: 'SELL_ONLY',
    });
    const section = formatPositiveScoreStarvationReport(report, {
      watchlist: { verified: 1, missing: 0, avg: 2.6, selectedInputPath: 'gateScoreInputSnapshot.watchlist.watchlistScore', conflict: false },
      momentum: { return5dCount: 1, return20dCount: 1, relativeReturn20dCount: 1, marketRelativeReturnCount: 1, priceMomentumComputedCount: 1, projectedToGate1: true },
      breakout: { traceAvailable: 1, scoreComputed: 1, scoreMapped: 1, zeroByCondition: 1, missingByMapping: 0, waitFeatureMissing: 0, waitEntryPriceNotReached: 0 },
    } as never) ?? '';
    const missingLine = section.split('\n').find((line) => line.includes('missingContributionComponents')) ?? '';

    expect(missingLine).not.toContain('WATCHLIST_UPSTREAM_SCORE');
    expect(missingLine).not.toContain('RELATIVE_STRENGTH');
    expect(missingLine).not.toContain('BREAKOUT_STRUCTURE');
    expect(section).toContain('RELATIVE_STRENGTH: rsRankPctComputedCount 1');
    expect(section).toContain('BREAKOUT_STRUCTURE: traceAvailable 1 / scoreMappedToGate 1 / missingByMapping 0');
    expect(section).toContain('componentScopes: CORE_SIGNAL=');
  });

  it('ADR-0467 fallback report is emitted when gateScoreHealthSamples=0', () => {
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

    expect(report?.totalCandidates).toBe(45);
    expect(report?.requiredScoreAvg).toBe(70);
    expect(report?.actualScoreAvg).toBe(21.4);
    expect(report?.rangeCompressionReport.compressed).toBe(true);
    expect(formatPositiveScoreStarvationReport(report)).toContain('zeroContributionComponents');
  });

  it('ADR-0467 CORE_SIGNAL contribution is attributed from minSignalComponents, not OTHER_POSITIVE', () => {
    // momentum condition output is THRESHOLD_NOT_MET score=0 (Gate2-level), yet the
    // canonical Gate1 minimum-signal PRICE_MOMENTUM weightedScore is positive (12/20).
    const trace = buildGate1ScoreStarvationTraceFromGateResult({
      symbol: '005930',
      name: 'Samsung',
      requiredScore: 7,
      gateResult: {
        rawScore: 4,
        availableMaxScore: 9,
        outputs: [
          { key: 'momentum', output: { score: 0, status: 'THRESHOLD_NOT_MET' } },
          // an unmapped condition that would otherwise inflate OTHER_POSITIVE
          { key: 'some_unmapped_condition', output: { score: 0.5, status: 'PASS' } },
        ],
      },
      minSignalComponents: [
        { code: 'PRICE_MOMENTUM', weightedScore: 12, maxScore: 20, confidence: 'VERIFIED' },
      ],
      scoreScale: 10,
    });

    const momentum = trace.positiveComponents.find((c) => c.code === 'PRICE_MOMENTUM');
    expect(momentum?.weightedScore).toBe(12);
    expect(momentum?.source).toBe('minimumSignalScoreTrace.components');
    // PRICE_MOMENTUM must NOT be marked zeroContribution.
    expect(trace.zeroContributionComponents).not.toContain('PRICE_MOMENTUM');
    expect(trace.verifiedZeroComponents).not.toContain('PRICE_MOMENTUM');
    // the momentum value must not have leaked into OTHER_POSITIVE.
    const otherPositive = trace.positiveComponents.find((c) => c.code === 'OTHER_POSITIVE');
    expect(otherPositive?.weightedScore ?? 0).toBeLessThan(12);
    expect(trace.grossPositiveScore).toBeGreaterThanOrEqual(12);
  });

  it('ADR-0467 fallback: without minSignalComponents the legacy gateResult.outputs path is preserved', () => {
    const gateResult = {
      rawScore: 4,
      availableMaxScore: 9,
      outputs: [
        { key: 'momentum', output: { score: 0, status: 'THRESHOLD_NOT_MET' } },
        { key: 'volume_breakout', output: { score: 0.6, status: 'PASS' } },
      ],
    };
    const legacy = buildGate1ScoreStarvationTraceFromGateResult({
      symbol: '005930',
      requiredScore: 7,
      gateResult,
      scoreScale: 10,
    });
    // PRICE_MOMENTUM resolved purely from the momentum condition output (score 0).
    const momentum = legacy.positiveComponents.find((c) => c.code === 'PRICE_MOMENTUM');
    expect(momentum?.source).toBe('evaluateServerGate.outputs');
    expect(momentum?.weightedScore).toBe(0);
    // VOLUME_LIQUIDITY from volume_breakout condition output (0.6 * scale = 6).
    const volume = legacy.positiveComponents.find((c) => c.code === 'VOLUME_LIQUIDITY');
    expect(volume?.weightedScore).toBe(6);
  });

  it('ADR-0467 reporter does not block engine if score data is missing', () => {
    expect(() => formatPositiveScoreStarvationReport(null)).not.toThrow();
    expect(() => buildPositiveScoreStarvationFallbackReport({
      timestamp: '2026-05-09T00:00:00.000Z',
      forDate: '2026-05-09',
      regime: 'UNKNOWN',
      marketSession: 'UNKNOWN',
      minSignalScoreReport: null,
    })).not.toThrow();
  });
});
