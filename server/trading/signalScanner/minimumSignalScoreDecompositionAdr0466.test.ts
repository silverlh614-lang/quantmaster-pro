import { describe, expect, it } from 'vitest';
import {
  buildEntryFilterDecomposition,
  formatEntryFilterDecompositionSection,
  type CandidateSnapshot,
} from './entryFilterDecomposition.js';
import {
  buildMinimumSignalScoreTrace,
  buildUnknownDataTreatmentAudit,
  normalizeSignalScoreTo100,
  type MinimumSignalScoreTrace,
} from './minimumSignalScoreTrace.js';
import { buildPositiveScoreStarvationFallbackReport } from './gate1PositiveScoreStarvation.js';

const now = new Date('2026-05-08T01:00:00.000Z');

function macro(overrides: Partial<NonNullable<Parameters<typeof buildEntryFilterDecomposition>[0]['macroGateState']>> = {}) {
  return {
    emergencyStop: false,
    autoTradeEnabled: true,
    regime: 'R3_EARLY',
    kellyMultiplierFromRegime: 0.7,
    fomcPhase: 'NORMAL',
    fomcKellyMultiplier: 1,
    finalKellyMultiplier: 0.2646,
    vixGatingActive: false,
    bearDefenseMode: false,
    mhsBelow30: false,
    watchlistEmpty: false,
    sellOnlyMode: false,
    ...overrides,
  };
}

function snapshots(n: number, patch: Partial<CandidateSnapshot> = {}): CandidateSnapshot[] {
  return Array.from({ length: n }, (_, i) => ({
    symbol: `B${i + 1}`,
    name: `Beta ${i + 1}`,
    stageReached: 'WATCHLIST',
    ...patch,
  }));
}

const noRecentSample = {
  status: 'NO_RECENT_SAMPLE' as const,
  providerName: 'investor-flow',
  expectedMaxAgeMinutes: 30,
  providerIssue: true,
  marketSignal: false,
  gate1Severity: 'SOFT_FAIL' as const,
  reason: ['no recent investor-flow provider sample'],
};

const verifiedSupply = { status: 'VERIFIED' as const, providerIssue: false, marketSignal: false, gate1Severity: 'NONE' as const, reason: ['ok'] };

function minTrace(patch: Partial<Parameters<typeof buildMinimumSignalScoreTrace>[0]['trace']> = {}) {
  return buildMinimumSignalScoreTrace({
    trace: {
      symbol: 'WIRE',
      stageReached: 'WATCHLIST',
      blockers: [],
      executionImpact: 'NONE',
      ...patch,
    },
    hasGate1Blocker: true,
    regime: 'R3_EARLY',
    marketSession: 'NORMAL',
    supplyProviderHealth: verifiedSupply,
    supplyConfluenceState: 'NEUTRAL',
    hasSectorEnergyDiagnostic: false,
  });
}

describe('ADR-0466 minimum signal score decomposition', () => {
  it('normalizes 0-10 and 0-27 upstream scores for WATCHLIST_UPSTREAM_SCORE', () => {
    expect(normalizeSignalScoreTo100(6.4)).toBe(64);
    expect(Math.round(normalizeSignalScoreTo100(18) * 10) / 10).toBe(66.7);
    const score64 = minTrace({ gateScore: 6.4 }).components.find((c) => c.code === 'WATCHLIST_UPSTREAM_SCORE');
    const total18 = minTrace({ totalGateScore: 18 }).components.find((c) => c.code === 'WATCHLIST_UPSTREAM_SCORE');
    expect(score64?.weightedScore).toBeGreaterThan(6);
    expect(score64?.message).toContain('imported from gateScore');
    expect(total18?.weightedScore).toBeGreaterThan(6.5);
    expect(total18?.message).toContain('imported from totalGateScore');
  });

  it('marks missing WATCHLIST_UPSTREAM_SCORE without silently zeroing it', () => {
    const watchlist = minTrace({}).components.find((c) => c.code === 'WATCHLIST_UPSTREAM_SCORE');
    expect(watchlist?.weightedScore).toBe(0);
    expect(watchlist?.confidence).toBe('MISSING');
    expect(watchlist?.message).toContain('source missing');
  });

  it('separates relative strength and breakout structure positive components', () => {
    const trace = minTrace({
      relativeStrengthScore: 72,
      breakoutSignals: { breakout_momentum: 'FIRED', turtle_high: 'FIRED' },
    });
    expect(trace.components.find((c) => c.code === 'RELATIVE_STRENGTH')?.weightedScore).toBeGreaterThan(7);
    expect(trace.components.find((c) => c.code === 'BREAKOUT_STRUCTURE')?.weightedScore).toBe(10);
  });

  it('does not promote unavailable or error breakout structure to positive', () => {
    const trace = minTrace({ breakoutSignals: { breakout_momentum: 'ERROR', turtle_high: 'UNAVAILABLE' } });
    const breakout = trace.components.find((c) => c.code === 'BREAKOUT_STRUCTURE');
    expect(breakout?.weightedScore).toBe(0);
    expect(breakout?.confidence).toBe('UNKNOWN');
    expect(breakout?.marketSignal).toBe(false);
  });

  it('fallback score ceiling is reachable and OTHER_POSITIVE is decomposed', () => {
    const report = buildPositiveScoreStarvationFallbackReport({
      minSignalScoreReport: {
        timestamp: '2026-05-11T00:00:00.000Z',
        forDate: '2026-05-11',
        regime: 'R3_EARLY',
        marketSession: 'NORMAL',
        totalCandidates: 45,
        minSignalFailed: 45,
        requiredScoreAvg: 70,
        actualScoreAvg: 21.4,
        actualScoreMin: 20,
        actualScoreMax: 23,
        avgScoreGap: -48.6,
        topScoreDeficits: [],
        topPenaltyContributors: [],
        unknownTreatmentWarnings: 0,
        wouldPassIfUnknownNeutral: 0,
        wouldPassIfProviderPenaltyRemoved: 0,
        wouldPassIfSessionPenaltyRemoved: 0,
        wouldPassIfRiskPenaltyCapped: 0,
        wouldPassIfSoftFailPenaltyRemoved: 0,
        recommendedAction: 'REVIEW_MIN_SIGNAL_THRESHOLD',
      },
      timestamp: '2026-05-11T00:00:00.000Z',
      forDate: '2026-05-11',
      regime: 'R3_EARLY',
      marketSession: 'NORMAL',
    });
    expect(report?.scoreCeilingAudit.requiredScoreReachable).toBe(true);
    expect(report?.scoreCeilingAudit.configuredPositiveMaxScore).toBeGreaterThanOrEqual(70);
    const other = report?.topPositiveContributors.find((item) => item.code === 'OTHER_POSITIVE')?.avgContribution ?? 0;
    expect(other).toBeLessThan(report?.grossPositiveScoreAvg ?? 0);
  });

  it('records requiredScore, actualScore, scoreGap and component weighted scores', () => {
    const d = buildEntryFilterDecomposition({
      now,
      universeCandidates: 1,
      watchlistCandidates: 1,
      entries: 0,
      macroGateState: macro(),
      waitDistribution: { dataHold: 0, preBreakout: 0, gateFail: 1, sizingBlocked: 0, driftRemove: 0, corpAction: 0, volumeDrop: 0, other: 0 },
      candidateSnapshots: snapshots(1),
      supplyProviderHealth: noRecentSample,
    });
    const trace = d.minSignalScoreTraces[0];
    expect(trace.requiredScore).toBe(70);
    expect(trace.actualScore).toBeLessThan(trace.requiredScore);
    expect(trace.scoreGap).toBe(trace.actualScore - trace.requiredScore);
    expect(trace.components.every((c) => typeof c.weightedScore === 'number')).toBe(true);
  });

  it('UNKNOWN supplyConfluence is not BEARISH and provider penalty is separated from market penalty', () => {
    const d = buildEntryFilterDecomposition({
      now,
      universeCandidates: 1,
      watchlistCandidates: 1,
      entries: 0,
      macroGateState: macro(),
      waitDistribution: { dataHold: 0, preBreakout: 0, gateFail: 1, sizingBlocked: 0, driftRemove: 0, corpAction: 0, volumeDrop: 0, other: 0 },
      candidateSnapshots: snapshots(1, { supplyConfluenceState: 'UNKNOWN' }),
      supplyProviderHealth: noRecentSample,
    });
    const audit = d.unknownDataTreatmentAudits[0];
    expect(audit.hasBearishEquivalentUnknown).toBe(false);
    expect(d.minSignalScoreTraces[0].providerIssuePenaltyTotal).toBeLessThan(0);
    expect(d.minSignalScoreTraces[0].components.find((c) => c.code === 'INVESTOR_FLOW')?.marketSignal).toBe(false);
  });

  it('SELL_ONLY blocks execution eligibility only and does not reduce signal score', () => {
    const baseInput = {
      now,
      universeCandidates: 1,
      watchlistCandidates: 1,
      entries: 0,
      waitDistribution: { dataHold: 0, preBreakout: 0, gateFail: 1, sizingBlocked: 0, driftRemove: 0, corpAction: 0, volumeDrop: 0, other: 0 },
      candidateSnapshots: snapshots(1),
      supplyProviderHealth: noRecentSample,
    };
    const normal = buildEntryFilterDecomposition({ ...baseInput, macroGateState: macro({ sellOnlyMode: false }) });
    const sellOnly = buildEntryFilterDecomposition({ ...baseInput, macroGateState: macro({ sellOnlyMode: true }) });
    expect(sellOnly.minSignalScoreTraces[0].sessionPenaltyTotal).toBe(0);
    expect(sellOnly.minSignalScoreTraces[0].actualScore).toBe(normal.minSignalScoreTraces[0].actualScore);
    expect(sellOnly.candidateTraces[0].blockers.some((b) => b.code === 'SELL_ONLY_TIME_WINDOW')).toBe(true);
    expect(sellOnly.minSignalScoreTraces[0].wouldPassIfSessionPenaltyRemoved).toBe(false);
  });

  it('risk penalty double-count warning appears if applied to both signal and sizing', () => {
    const d = buildEntryFilterDecomposition({
      now,
      universeCandidates: 1,
      watchlistCandidates: 1,
      entries: 0,
      macroGateState: macro({ finalKellyMultiplier: 0.2646 }),
      waitDistribution: { dataHold: 0, preBreakout: 0, gateFail: 1, sizingBlocked: 0, driftRemove: 0, corpAction: 0, volumeDrop: 0, other: 0 },
      candidateSnapshots: snapshots(1),
      supplyProviderHealth: noRecentSample,
    });
    expect(d.riskPenaltyTraces[0].signalScoreRiskPenalty).toBeLessThan(0);
    expect(d.riskPenaltyTraces[0].sizingRiskPenalty).toBeGreaterThan(0);
    expect(d.riskPenaltyTraces[0].doubleCountWarning).toBe(true);
  });

  it('SectorEnergy diagnostic is not a general hard block and sector penalty is traced', () => {
    const d = buildEntryFilterDecomposition({
      now,
      universeCandidates: 1,
      watchlistCandidates: 1,
      entries: 0,
      macroGateState: macro(),
      sectorEnergyQuality: 'DEGRADED',
      waitDistribution: { dataHold: 0, preBreakout: 0, gateFail: 1, sizingBlocked: 0, driftRemove: 0, corpAction: 0, volumeDrop: 0, other: 0 },
      candidateSnapshots: snapshots(1),
      supplyProviderHealth: noRecentSample,
    });
    expect(d.candidateTraces[0].blockers.find((b) => b.code === 'SECTOR_ENERGY_DIAGNOSTIC_ONLY')?.executionBlocking).toBe('STRONG_BUY_ONLY');
    expect(d.gate1CandidateTraces[0].conditions.find((c) => c.code === 'SECTOR_ENERGY_CONFIDENCE_PASS')?.severity).toBe('DIAGNOSTIC_ONLY');
    expect(d.minSignalScoreTraces[0].sectorPenaltyTotal).toBeLessThan(0);
  });

  it('soft fail accumulation trace records threshold, total, and provider/session/sector counterfactuals', () => {
    const d = buildEntryFilterDecomposition({
      now,
      universeCandidates: 1,
      watchlistCandidates: 1,
      entries: 0,
      macroGateState: macro({ sellOnlyMode: true }),
      sectorEnergyQuality: 'DEGRADED',
      waitDistribution: { dataHold: 0, preBreakout: 0, gateFail: 1, sizingBlocked: 0, driftRemove: 0, corpAction: 0, volumeDrop: 0, other: 0 },
      candidateSnapshots: snapshots(1),
      supplyProviderHealth: noRecentSample,
    });
    const soft = d.softFailAccumulationTraces[0];
    expect(soft.softFailThreshold).toBe(3);
    expect(soft.totalSoftFailScore).toBeGreaterThanOrEqual(3);
    expect(soft.failedBySoftAccumulation).toBe(true);
    expect(soft.softFails.map((f) => f.code)).toEqual(expect.arrayContaining(['PROVIDER_UNKNOWN', 'SESSION_SOFT_BLOCK', 'SECTOR_DIAGNOSTIC', 'MIN_SIGNAL_GAP']));
  });

  it('calibration scenarios are advisory-only and include threshold -5/-10/R3_EARLY survivors', () => {
    const d = buildEntryFilterDecomposition({
      now,
      universeCandidates: 2,
      watchlistCandidates: 2,
      entries: 0,
      macroGateState: macro(),
      waitDistribution: { dataHold: 0, preBreakout: 0, gateFail: 2, sizingBlocked: 0, driftRemove: 0, corpAction: 0, volumeDrop: 0, other: 0 },
      candidateSnapshots: snapshots(2, { gateScore: 64 }),
      supplyProviderHealth: { status: 'VERIFIED', providerIssue: false, marketSignal: false, gate1Severity: 'NONE', reason: ['ok'] },
    });
    const minus5 = d.signalScoreCalibrationResults.find((r) => r.scenario === 'MIN_SIGNAL_THRESHOLD_MINUS_5');
    const minus10 = d.signalScoreCalibrationResults.find((r) => r.scenario === 'MIN_SIGNAL_THRESHOLD_MINUS_10');
    const adaptive = d.signalScoreCalibrationResults.find((r) => r.scenario === 'R3_EARLY_ADAPTIVE_THRESHOLD');
    expect(minus5?.hypotheticalSurvivors).toBe(0);
    expect(minus10?.hypotheticalSurvivors).toBe(2);
    expect(adaptive?.hypotheticalSurvivors).toBe(2);
    expect(d.signalScoreCalibrationResults.every((r) => r.executionImpact === 'NONE')).toBe(true);
  });

  it('EntryDecisionLedger includes minSignalScoreSummary and ADR-0466 tags', () => {
    const d = buildEntryFilterDecomposition({
      now,
      universeCandidates: 1,
      watchlistCandidates: 1,
      entries: 0,
      macroGateState: macro(),
      waitDistribution: { dataHold: 0, preBreakout: 0, gateFail: 1, sizingBlocked: 0, driftRemove: 0, corpAction: 0, volumeDrop: 0, other: 0 },
      candidateSnapshots: snapshots(1),
      supplyProviderHealth: noRecentSample,
    });
    expect(d.ledgerRows[0].minSignalScoreSummary?.scoreGap).toBeLessThan(0);
    expect(d.ledgerRows[0].gate1TraceSummary?.tags).toEqual(expect.arrayContaining(['CASE_MIN_SIGNAL_SCORE_GAP', 'CASE_UNKNOWN_DATA_PENALTY', 'CASE_SOFT_FAIL_ACCUMULATION', 'CASE_RISK_PENALTY_DOUBLE_COUNT_WARNING']));
    expect(d.ledgerRows[0].minSignalScoreSummary?.executionImpact).toBe('NONE');
  });

  it('UNKNOWN treated as BEARISH_EQUIVALENT creates audit warning', () => {
    const trace: MinimumSignalScoreTrace = {
      symbol: 'WARN',
      requiredScore: 70,
      actualScore: 60,
      scoreGap: -10,
      passed: false,
      components: [{
        code: 'SUPPLY_CONFLUENCE',
        normalizedScore: -10,
        weight: 1,
        weightedScore: -10,
        maxScore: 8,
        contributionPct: -125,
        confidence: 'UNKNOWN',
        providerIssue: true,
        marketSignal: true,
        penaltyApplied: true,
        penaltyReason: 'BAD_UNKNOWN_BEARISH_EQUIVALENT',
        message: 'bad treatment',
      }],
      positiveScoreTotal: 0,
      penaltyTotal: -10,
      unknownPenaltyTotal: -10,
      providerIssuePenaltyTotal: -10,
      sessionPenaltyTotal: 0,
      sectorPenaltyTotal: 0,
      riskPenaltyTotal: 0,
      softFailPenaltyTotal: 0,
      topMissingContributors: ['SUPPLY_CONFLUENCE'],
      topPenaltyContributors: ['SUPPLY_CONFLUENCE'],
      wouldPassIfUnknownNeutral: true,
      wouldPassIfProviderPenaltyRemoved: true,
      wouldPassIfSessionPenaltyRemoved: false,
      wouldPassIfRiskPenaltyCapped: false,
      wouldPassIfSectorPenaltyRemoved: false,
      wouldPassIfSoftFailPenaltyRemoved: false,
    };
    expect(buildUnknownDataTreatmentAudit(trace).hasBearishEquivalentUnknown).toBe(true);
  });

  it('Telegram /scan_blockers section includes ADR-0466 required averages and scenarios', () => {
    const d = buildEntryFilterDecomposition({
      now,
      universeCandidates: 1,
      watchlistCandidates: 1,
      entries: 0,
      macroGateState: macro(),
      waitDistribution: { dataHold: 0, preBreakout: 0, gateFail: 1, sizingBlocked: 0, driftRemove: 0, corpAction: 0, volumeDrop: 0, other: 0 },
      candidateSnapshots: snapshots(1),
      supplyProviderHealth: noRecentSample,
    });
    const section = formatEntryFilterDecompositionSection(d);
    expect(section).toContain('Min Signal Score Decomposition (ADR-0466)');
    expect(section).toContain('requiredScoreAvg');
    expect(section).toContain('thresholdMinus5Survivors');
  });
});
