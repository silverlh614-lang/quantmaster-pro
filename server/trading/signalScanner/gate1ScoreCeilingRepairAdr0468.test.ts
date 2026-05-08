// @responsibility ADR-0468 score ceiling repair and positive feature wiring regression tests
import { describe, expect, it } from 'vitest';
import {
  buildPositiveScoreStarvationFallbackReport,
  type Gate1ScoreStarvationTrace,
} from './gate1PositiveScoreStarvation.js';
import {
  buildBreakoutStructureScoreTrace,
  buildEntryDecisionLedgerScoreCeilingRepairSummary,
  buildGate1PositiveWeightMapAudit,
  buildGate1ScoreCeilingRepairAudit,
  buildGate1ScoreCeilingRepairReport,
  buildGate1ScoreRepairDryRunResults,
  buildOtherPositiveDecomposition,
  buildRelativeStrengthScoreTrace,
  buildScoreDifferentiationAudit,
  buildWatchlistScoreImportResult,
  formatGate1ScoreCeilingRepairReport,
} from './gate1ScoreCeilingRepair.js';
import {
  createScanCounters,
  formatScanBlockersMessage,
  getLastScanSummary,
  persistScanResults,
} from './scanDiagnostics.js';

function makeAdr0467Report() {
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
  if (!report) throw new Error('expected ADR-0467 fallback report');
  return report;
}

describe('ADR-0468 Gate1 score ceiling repair dry-run', () => {
  it('score ceiling below required score creates warning', () => {
    const audit = buildGate1ScoreCeilingRepairAudit({
      requiredScore: 70,
      configuredPositiveMaxScoreBefore: 52.7,
      observedPositiveMaxBefore: 52.7,
    });

    expect(audit.message).toContain('SCORE_CEILING_BELOW_THRESHOLD');
    expect(audit.requiredReachableBefore).toBe(false);
    expect(audit.executionImpact).toBe('NONE');
  });

  it('requiredReachable=false when configuredPositiveMaxScore < requiredScore', () => {
    const audit = buildGate1ScoreCeilingRepairAudit({
      requiredScore: 70,
      configuredPositiveMaxScoreBefore: 52.7,
      observedPositiveMaxBefore: 52.7,
    });

    expect(audit.requiredReachableBefore).toBe(false);
    expect(audit.requiredReachableAfter).toBe(true);
  });

  it('watchlist upstream score zero for all candidates creates warning', () => {
    const audit = buildGate1PositiveWeightMapAudit({ report: makeAdr0467Report() });

    expect(audit.missingCoreComponents).toContain('WATCHLIST_UPSTREAM_SCORE');
  });

  it('watchlist score import dry-run produces nonzero contribution when upstream score exists', () => {
    const result = buildWatchlistScoreImportResult({
      symbol: '005930',
      upstreamCandidateScore: 80,
      maxImportScore: 15,
    });

    expect(result.importedScore).toBe(12);
    expect(result.importApplied).toBe(true);
    expect(result.executionImpact).toBe('NONE');
  });

  it('relative strength zero for all candidates creates warning', () => {
    const audit = buildGate1PositiveWeightMapAudit({ report: makeAdr0467Report() });
    const rs = buildRelativeStrengthScoreTrace({ symbol: '005930' });

    expect(audit.missingCoreComponents).toContain('RELATIVE_STRENGTH');
    expect(rs.normalizedRSScore).toBe(0);
    expect(rs.confidence).toBe('MISSING');
  });

  it('breakout structure zero for all candidates creates warning', () => {
    const audit = buildGate1PositiveWeightMapAudit({ report: makeAdr0467Report() });
    const breakout = buildBreakoutStructureScoreTrace({ symbol: '005930' });

    expect(audit.missingCoreComponents).toContain('BREAKOUT_STRUCTURE');
    expect(breakout.normalizedBreakoutScore).toBe(0);
    expect(breakout.confidence).toBe('MISSING');
  });

  it('OTHER_POSITIVE share > 50% creates warning', () => {
    const audit = buildGate1PositiveWeightMapAudit({ report: makeAdr0467Report() });

    expect(audit.otherPositiveSharePct).toBeGreaterThan(50);
    expect(audit.otherPositiveTooLarge).toBe(true);
  });

  it('OTHER_POSITIVE decomposition reduces remainingOtherPositive', () => {
    const decomposition = buildOtherPositiveDecomposition({
      symbol: '005930',
      otherPositiveRaw: 52.7,
    });

    expect(decomposition.remainingOtherPositive).toBeLessThan(decomposition.otherPositiveRaw);
    expect(decomposition.decompositionCoveragePct).toBeGreaterThan(50);
  });

  it('score compression detected when actualScoreRange is narrow', () => {
    const audit = buildScoreDifferentiationAudit({ report: makeAdr0467Report() });

    expect(audit.beforeActualScoreRange).toBe(4);
    expect(audit.compressionCause).toBe('WATCHLIST_SCORE_NOT_IMPORTED');
  });

  it('score repair dry-run never changes live execution', () => {
    const report = makeAdr0467Report();
    const dryRuns = buildGate1ScoreRepairDryRunResults({
      report,
      watchlistImportAvg: 5,
      relativeStrengthRestoreAvg: 9,
      breakoutRestoreAvg: 5,
    });

    expect(dryRuns.every((result) => result.executionImpact === 'NONE')).toBe(true);
  });

  it('normalize positive max to 100 scenario is executionImpact NONE', () => {
    const [result] = buildGate1ScoreRepairDryRunResults({
      report: makeAdr0467Report(),
      watchlistImportAvg: 5,
      relativeStrengthRestoreAvg: 9,
      breakoutRestoreAvg: 5,
    }).filter((item) => item.scenario === 'NORMALIZE_POSITIVE_MAX_TO_100');

    expect(result.executionImpact).toBe('NONE');
  });

  it('all positive wiring repaired scenario is executionImpact NONE', () => {
    const [result] = buildGate1ScoreRepairDryRunResults({
      report: makeAdr0467Report(),
      watchlistImportAvg: 5,
      relativeStrengthRestoreAvg: 9,
      breakoutRestoreAvg: 5,
    }).filter((item) => item.scenario === 'ALL_POSITIVE_WIRING_REPAIRED');

    expect(result.executionImpact).toBe('NONE');
  });

  it('ledger includes scoreCeilingRepairSummary', () => {
    const report = buildGate1ScoreCeilingRepairReport({
      positiveStarvationReport: makeAdr0467Report(),
      timestamp: '2026-05-09T00:00:00.000Z',
      forDate: '2026-05-09',
      regime: 'R3_EARLY',
      marketSession: 'SELL_ONLY',
    });
    if (!report) throw new Error('expected ADR-0468 report');
    const summary = buildEntryDecisionLedgerScoreCeilingRepairSummary({ report });

    expect(summary.executionImpact).toBe('NONE');
    expect(summary.tags).toContain('CASE_SCORE_CEILING_BELOW_THRESHOLD');
    expect(summary.tags).toContain('CASE_WATCHLIST_SCORE_NOT_IMPORTED');
    expect(summary.tags).toContain('CASE_RELATIVE_STRENGTH_ZERO_CONTRIBUTION');
    expect(summary.tags).toContain('CASE_BREAKOUT_STRUCTURE_ZERO_CONTRIBUTION');
    expect(summary.tags).toContain('CASE_OTHER_POSITIVE_TOO_LARGE');
    expect(summary.tags).toContain('CASE_GATE1_SCORE_REPAIR_DRY_RUN');
  });

  it('SELL_ONLY does not affect signal score repair', () => {
    const sellOnly = buildGate1ScoreCeilingRepairReport({
      positiveStarvationReport: makeAdr0467Report(),
      timestamp: '2026-05-09T00:00:00.000Z',
      forDate: '2026-05-09',
      regime: 'R3_EARLY',
      marketSession: 'SELL_ONLY',
    });
    const buyAllowed = buildGate1ScoreCeilingRepairReport({
      positiveStarvationReport: { ...makeAdr0467Report(), marketSession: 'BUY_ALLOWED' },
      timestamp: '2026-05-09T00:00:00.000Z',
      forDate: '2026-05-09',
      regime: 'R3_EARLY',
      marketSession: 'BUY_ALLOWED',
    });

    expect(sellOnly?.dryRunResults).toEqual(buyAllowed?.dryRunResults);
  });

  it('UNKNOWN provider issue is not bearish during repair scenarios', () => {
    const report = buildGate1ScoreCeilingRepairReport({
      positiveStarvationReport: makeAdr0467Report(),
      traces: [] as Gate1ScoreStarvationTrace[],
      timestamp: '2026-05-09T00:00:00.000Z',
      forDate: '2026-05-09',
      regime: 'R3_EARLY',
      marketSession: 'SELL_ONLY',
    });

    expect(report?.watchlistScoreImports).toHaveLength(0);
    expect(report?.dryRunResults.every((result) => result.executionImpact === 'NONE')).toBe(true);
    expect(formatGate1ScoreCeilingRepairReport(report)).toContain('executionImpact: NONE');
  });

  it('/scan_blockers includes ADR-0468 fallback section when gateScoreHealthSamples=0', async () => {
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
    expect(message).toContain('Gate1 Score Ceiling Repair Audit (ADR-0468)');
    expect(message).toContain('configuredPositiveMaxBefore');
    expect(message).toContain('WATCHLIST_UPSTREAM_SCORE');
    expect(message).toContain('NORMALIZE_POSITIVE_MAX_TO_100');
    expect(message).toContain('executionImpact: NONE');
  });
});
