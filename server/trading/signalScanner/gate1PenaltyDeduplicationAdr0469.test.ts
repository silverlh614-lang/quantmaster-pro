// @responsibility ADR-0469 penalty deduplication dry-run regression tests
import { describe, expect, it } from 'vitest';
import { buildPositiveScoreStarvationFallbackReport } from './gate1PositiveScoreStarvation.js';
import { buildGate1ScoreCeilingRepairReport } from './gate1ScoreCeilingRepair.js';
import {
  buildCandidatePenaltyDedupTrace,
  buildEntryDecisionLedgerPenaltyDedupSummary,
  buildPenaltyDedupScenarioResults,
  buildPenaltyDeduplicationReport,
  buildRiskPenaltyDedupAudit,
  buildSoftFailPenaltyAudit,
  formatPenaltyDeduplicationReport,
  penaltyComponentTrace,
} from './gate1PenaltyDeduplication.js';
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
        { code: 'SECTOR_ENERGY', avgPenalty: -2, affectedCount: 3 },
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

function makeTrace() {
  return buildCandidatePenaltyDedupTrace({
    symbol: '005930',
    grossPositiveScore: 52.7,
    originalPenaltyTotal: 31.3,
    originalNetScore: 21.4,
    requiredScore: 70,
    penalties: [
      penaltyComponentTrace({ code: 'SUPPLY_CONFLUENCE', value: 10, providerIssue: true, marketSignal: false }),
      penaltyComponentTrace({ code: 'INVESTOR_FLOW', value: 8, providerIssue: true, marketSignal: false }),
      penaltyComponentTrace({ code: 'SOFT_FAIL_PENALTY', value: 5, providerIssue: true, marketSignal: false }),
      penaltyComponentTrace({ code: 'RISK_PENALTY', value: 6.3, rootCause: 'RISK_MULTIPLIER_LOW', marketSignal: true }),
      penaltyComponentTrace({ code: 'SECTOR_ENERGY', value: 2, rootCause: 'SECTOR_ENERGY_DIAGNOSTIC', confidence: 'DIAGNOSTIC_ONLY' }),
    ],
  });
}

describe('ADR-0469 supply unknown penalty deduplication', () => {
  it('supply unknown penalties are grouped under SUPPLY_UNKNOWN', () => {
    const trace = makeTrace();

    expect(trace.duplicatePenaltyGroups[0]?.groupKey).toBe('SUPPLY_UNKNOWN');
    expect(trace.duplicatePenaltyGroups[0]?.rootCause).toBe('SUPPLY_PROVIDER_UNKNOWN');
  });

  it('provider issue penalty is not classified as market signal', () => {
    const trace = makeTrace();
    const providerPenalties = trace.penalties.filter((penalty) => penalty.providerIssue);

    expect(providerPenalties.length).toBeGreaterThan(0);
    expect(providerPenalties.every((penalty) => penalty.marketSignal === false)).toBe(true);
  });

  it('bearish supply penalty is not deduped with provider unknown', () => {
    const trace = buildCandidatePenaltyDedupTrace({
      symbol: '000660',
      grossPositiveScore: 60,
      originalPenaltyTotal: 20,
      originalNetScore: 40,
      requiredScore: 70,
      penalties: [
        penaltyComponentTrace({ code: 'SUPPLY_CONFLUENCE', value: 10, rootCause: 'SUPPLY_CONFLUENCE_BEARISH', marketSignal: true }),
        penaltyComponentTrace({ code: 'INVESTOR_FLOW', value: 8, rootCause: 'INVESTOR_FLOW_BEARISH', marketSignal: true }),
      ],
    });

    expect(trace.duplicatePenaltyGroups).toHaveLength(0);
  });

  it('SUPPLY_CONFLUENCE + INVESTOR_FLOW + SOFT_FAIL_PENALTY duplicate group is detected', () => {
    const group = makeTrace().duplicatePenaltyGroups[0];

    expect(group?.components).toEqual(expect.arrayContaining([
      'SUPPLY_CONFLUENCE',
      'INVESTOR_FLOW',
      'SOFT_FAIL_PENALTY',
    ]));
    expect(group?.originalTotalPenalty).toBe(23);
  });

  it('KEEP_LARGEST_PER_ROOT_CAUSE scenario removes duplicate penalties', () => {
    const [result] = buildPenaltyDedupScenarioResults({
      traces: [makeTrace()],
      positiveRepairDelta: 0,
    }).filter((item) => item.scenario === 'KEEP_LARGEST_PER_ROOT_CAUSE');

    expect(result.penaltyAvg).toBeLessThan(31.3);
    expect(result.netScoreAvg).toBeGreaterThan(21.4);
    expect(result.executionImpact).toBe('NONE');
  });

  it('CAP_SUPPLY_UNKNOWN_PENALTY_10 scenario caps total unknown penalty', () => {
    const [result] = buildPenaltyDedupScenarioResults({
      traces: [makeTrace()],
      positiveRepairDelta: 0,
    }).filter((item) => item.scenario === 'CAP_SUPPLY_UNKNOWN_PENALTY_10');

    expect(result.penaltyAvg).toBe(18.3);
    expect(result.executionImpact).toBe('NONE');
  });

  it('KEEP_ONLY_MARKET_SIGNAL_PENALTIES removes provider unknown penalties', () => {
    const [result] = buildPenaltyDedupScenarioResults({
      traces: [makeTrace()],
      positiveRepairDelta: 0,
    }).filter((item) => item.scenario === 'KEEP_ONLY_MARKET_SIGNAL_PENALTIES');

    expect(result.penaltyAvg).toBe(6.3);
    expect(result.netScoreAvg).toBe(46.4);
  });

  it('risk penalty double count with Kelly is detected', () => {
    const audit = buildRiskPenaltyDedupAudit({
      symbol: '005930',
      requiredScore: 70,
      originalNetScore: 21.4,
      riskMultiplier: 0.38,
      signalRiskPenalty: 6.3,
    });

    expect(audit.doubleCountWarning).toBe(true);
    expect(audit.riskPenaltyRootCause).toBe('RISK_MULTIPLIER_LOW');
  });

  it('soft fail penalty duplicate with supply unknown is detected', () => {
    const audit = buildSoftFailPenaltyAudit({
      symbol: '005930',
      penalties: makeTrace().penalties,
    });

    expect(audit.duplicateWithOtherPenalty).toBe(true);
    expect(audit.duplicateGroupKey).toBe('SUPPLY_UNKNOWN');
  });

  it('combined positive repair + penalty dedup scenario is executionImpact NONE', () => {
    const positive = makePositiveReport();
    const repair = buildGate1ScoreCeilingRepairReport({
      positiveStarvationReport: positive,
      timestamp: '2026-05-09T00:00:00.000Z',
      forDate: '2026-05-09',
      regime: 'R3_EARLY',
      marketSession: 'SELL_ONLY',
    });
    const report = buildPenaltyDeduplicationReport({
      positiveStarvationReport: positive,
      scoreCeilingRepairReport: repair,
      timestamp: '2026-05-09T00:00:00.000Z',
      forDate: '2026-05-09',
      regime: 'R3_EARLY',
      marketSession: 'SELL_ONLY',
      riskMultiplier: 0.38,
    });

    expect(report?.combinedCalibrationResults.every((result) => result.executionImpact === 'NONE')).toBe(true);
  });

  it('survivors from dedup scenario are not sent to live order', () => {
    const report = buildPenaltyDeduplicationReport({
      positiveStarvationReport: makePositiveReport(),
      timestamp: '2026-05-09T00:00:00.000Z',
      forDate: '2026-05-09',
      regime: 'R3_EARLY',
      marketSession: 'SELL_ONLY',
      riskMultiplier: 0.38,
    });

    expect(report?.scenarioResults.every((result) => result.executionImpact === 'NONE')).toBe(true);
    expect(report?.executionImpact).toBe('NONE');
  });

  it('ledger includes penaltyDedupSummary', () => {
    const summary = buildEntryDecisionLedgerPenaltyDedupSummary({
      trace: makeTrace(),
      riskAudit: buildRiskPenaltyDedupAudit({
        symbol: '005930',
        requiredScore: 70,
        originalNetScore: 21.4,
        riskMultiplier: 0.38,
        signalRiskPenalty: 6.3,
      }),
    });

    expect(summary.executionImpact).toBe('NONE');
    expect(summary.tags).toContain('CASE_SUPPLY_UNKNOWN_DUPLICATE_PENALTY');
    expect(summary.tags).toContain('CASE_PROVIDER_UNKNOWN_NOT_BEARISH');
    expect(summary.tags).toContain('CASE_PENALTY_DEDUP_DRY_RUN');
    expect(summary.tags).toContain('CASE_SOFT_FAIL_DUPLICATE_PENALTY');
    expect(summary.tags).toContain('CASE_RISK_PENALTY_DOUBLE_COUNT');
  });

  it('SELL_ONLY remains execution blocker only', () => {
    const sellOnly = buildPenaltyDeduplicationReport({
      positiveStarvationReport: makePositiveReport(),
      timestamp: '2026-05-09T00:00:00.000Z',
      forDate: '2026-05-09',
      regime: 'R3_EARLY',
      marketSession: 'SELL_ONLY',
    });
    const buyAllowed = buildPenaltyDeduplicationReport({
      positiveStarvationReport: { ...makePositiveReport(), marketSession: 'BUY_ALLOWED' },
      timestamp: '2026-05-09T00:00:00.000Z',
      forDate: '2026-05-09',
      regime: 'R3_EARLY',
      marketSession: 'BUY_ALLOWED',
    });

    expect(sellOnly?.dedupedNetScoreAvg).toBe(buyAllowed?.dedupedNetScoreAvg);
  });

  it('UNKNOWN provider issue remains non-bearish', () => {
    const trace = makeTrace();

    expect(trace.penalties.filter((penalty) => penalty.providerIssue).every((penalty) => !penalty.marketSignal)).toBe(true);
    expect(trace.penalties.filter((penalty) => penalty.providerIssue).every((penalty) => penalty.rootCause === 'SUPPLY_PROVIDER_UNKNOWN')).toBe(true);
  });

  it('ADR-0469 report appears in /scan_blockers', async () => {
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
        finalKellyMultiplier: 0.38,
        vixGatingActive: false,
        bearDefenseMode: false,
        mhsBelow30: false,
        watchlistEmpty: false,
        sellOnlyMode: true,
      },
    });

    const message = formatScanBlockersMessage(getLastScanSummary());
    expect(message).toContain('Penalty Deduplication Audit (ADR-0469)');
    expect(message).toContain('SUPPLY_UNKNOWN');
    expect(message).toContain('KEEP_LARGEST_PER_ROOT_CAUSE');
    expect(message).toContain('executionImpact: NONE');
  });

  it('formats report with required dry-run fields', () => {
    const report = buildPenaltyDeduplicationReport({
      positiveStarvationReport: makePositiveReport(),
      timestamp: '2026-05-09T00:00:00.000Z',
      forDate: '2026-05-09',
      regime: 'R3_EARLY',
      marketSession: 'SELL_ONLY',
      riskMultiplier: 0.38,
    });

    const section = formatPenaltyDeduplicationReport(report);
    expect(section).toContain('providerIssuePenaltyAvg');
    expect(section).toContain('marketSignalPenaltyAvg');
    expect(section).toContain('doubleCountWarning');
    expect(section).toContain('DEDUP_POSITIVE_REPAIR_AND_RISK_CAP');
  });
});
