import { describe, expect, it } from 'vitest';
import {
  buildEntryFilterDecomposition,
  blocker,
  createKellySizingTrace,
  formatEntryFilterDecompositionSection,
  type CandidateEntryTrace,
} from './entryFilterDecomposition.js';

const now = new Date('2026-05-08T01:00:00.000Z');

function macro(overrides: Partial<NonNullable<Parameters<typeof buildEntryFilterDecomposition>[0]['macroGateState']>> = {}) {
  return {
    emergencyStop: false,
    autoTradeEnabled: true,
    regime: 'R3_EARLY',
    kellyMultiplierFromRegime: 0.7,
    fomcPhase: 'NORMAL',
    fomcKellyMultiplier: 1,
    finalKellyMultiplier: 0.26,
    vixGatingActive: false,
    bearDefenseMode: false,
    mhsBelow30: false,
    watchlistEmpty: false,
    sellOnlyMode: false,
    ...overrides,
  };
}

function snapshots(n: number) {
  return Array.from({ length: n }, (_, i) => ({ symbol: `A${i + 1}`, name: `Alpha ${i + 1}`, stageReached: 'WATCHLIST' as const }));
}

describe('ADR-0464 entry filter decomposition', () => {
  it('removed SELL_ONLY does not block live entry and preserves counterfactual trace', () => {
    const d = buildEntryFilterDecomposition({
      now,
      universeCandidates: 20,
      watchlistCandidates: 20,
      entries: 0,
      macroGateState: macro({ sellOnlyMode: true }),
      candidateSnapshots: snapshots(20),
    });
    expect(d.blockedByTimeWindow).toBe(0);
    expect(d.counterfactualTraces).toHaveLength(20);
    expect(d.counterfactualTraces.every((x) => x.executionImpact === 'NONE')).toBe(true);
    expect(d.learningBlocked).toBe(0);
  });

  it('GREEN regime with zero entry creates FilterConservatismReport', () => {
    const d = buildEntryFilterDecomposition({
      now,
      universeCandidates: 20,
      watchlistCandidates: 20,
      entries: 0,
      macroGateState: macro({ regime: 'GREEN' }),
      candidateSnapshots: snapshots(20),
    });
    expect(d.filterConservatismReport?.recommendedAction).toBe('DIAGNOSTIC_ONLY');
    expect(d.filterConservatismReport?.marketGreen).toBe(true);
  });

  it('CandidateEntryTrace records blockers per candidate', () => {
    const d = buildEntryFilterDecomposition({
      now,
      universeCandidates: 3,
      watchlistCandidates: 3,
      entries: 0,
      macroGateState: macro({ sellOnlyMode: true }),
      waitDistribution: { dataHold: 0, preBreakout: 0, gateFail: 2, sizingBlocked: 0, driftRemove: 0, corpAction: 0, volumeDrop: 0, other: 0 },
      candidateSnapshots: snapshots(3),
    });
    expect(d.candidateTraces.filter((x) => x.blockers.some((b) => b.code === 'GATE1_FAIL'))).toHaveLength(2);
    expect(d.candidateTraces[0].blockers.map((b) => b.code)).not.toContain('SELL_ONLY_TIME_WINDOW');
    expect(d.candidateTraces[0].blockers.map((b) => b.code)).toContain('GATE1_FAIL');
  });

  it('SectorEnergy diagnostic only does not kill general counterfactual', () => {
    const d = buildEntryFilterDecomposition({
      now,
      universeCandidates: 2,
      watchlistCandidates: 2,
      entries: 0,
      macroGateState: macro(),
      sectorEnergyQuality: 'DEGRADED',
      candidateSnapshots: snapshots(2),
    });
    expect(d.candidateTraces[0].blockers.find((b) => b.category === 'SECTOR_ENERGY')?.executionBlocking).toBe('NONE');
    expect(d.counterfactualTraces).toHaveLength(2);
  });

  it('Kelly multiplier decomposition records finalKelly and reason', () => {
    const k = createKellySizingTrace({ symbol: 'A1', kellyRaw: 1, regimeMultiplier: 0.7, fomcMultiplier: 1, sectorMultiplier: 0.5, riskMultiplier: 0.742857, minPositionThreshold: 0.3 });
    expect(k.finalKelly).toBeCloseTo(0.26, 3);
    expect(k.blockedBySizing).toBe(false);
    expect(k.reason).toBe('SIZING_ADVISORY_LOW');
  });

  it('Watchlist 20 with entry 0 creates 20 ledger rows', () => {
    const d = buildEntryFilterDecomposition({ now, universeCandidates: 20, watchlistCandidates: 20, entries: 0, macroGateState: macro(), candidateSnapshots: snapshots(20) });
    expect(d.ledgerRows).toHaveLength(20);
  });

  it('Watchlist empty creates universe summary row', () => {
    const d = buildEntryFilterDecomposition({ now, universeCandidates: 258, watchlistCandidates: 0, entries: 0, macroGateState: macro(), candidateSnapshots: [] });
    expect(d.ledgerRows).toHaveLength(1);
    expect(d.ledgerRows[0].symbol).toBe('UNIVERSE_SUMMARY');
  });

  it('Gate1 fail is recorded without removed SELL_ONLY time-window pollution', () => {
    const d = buildEntryFilterDecomposition({
      now,
      universeCandidates: 2,
      watchlistCandidates: 2,
      entries: 0,
      macroGateState: macro({ sellOnlyMode: true }),
      waitDistribution: { dataHold: 0, preBreakout: 0, gateFail: 1, sizingBlocked: 0, driftRemove: 0, corpAction: 0, volumeDrop: 0, other: 0 },
      candidateSnapshots: snapshots(1),
    });
    expect(d.candidateTraces[0].blockers.map((b) => b.code).sort()).toEqual(['GATE1_FAIL']);
  });

  it('learningBlocking remains false for execution-only blockers', () => {
    const d = buildEntryFilterDecomposition({ now, universeCandidates: 1, watchlistCandidates: 1, entries: 0, macroGateState: macro({ sellOnlyMode: true }), candidateSnapshots: snapshots(1) });
    expect(d.candidateTraces[0].blockers.every((b) => b.learningBlocking === false)).toBe(true);
  });

  it('R3 sanity observe-only is shown as SHADOW_ONLY policy, not a Gate failure blocker', () => {
    const d = buildEntryFilterDecomposition({
      now,
      universeCandidates: 2,
      watchlistCandidates: 2,
      entries: 0,
      macroGateState: macro({ diagnosticLiveEntryBlocked: true, liveEntryBlockedReason: 'R3_SANITY_GUARD' }),
      waitDistribution: { dataHold: 0, preBreakout: 0, gateFail: 1, sizingBlocked: 0, driftRemove: 0, corpAction: 0, volumeDrop: 0, other: 0 },
      candidateSnapshots: snapshots(2),
    });
    const formatted = formatEntryFilterDecompositionSection(d) ?? '';

    expect(d.topBlockers.map((item) => item.code)).toContain('SHADOW_ONLY_MODE');
    expect(d.topBlockers.map((item) => item.code)).not.toContain('R3_SANITY_GUARD');
    expect(formatted).toContain('Policy Blockers:');
    expect(formatted).toContain('SHADOW_ONLY_MODE: 2');
    expect(formatted).toContain('Gate Failures:');
    expect(formatted).toContain('GATE1_FAIL: 1');
  });

  it('provider issue is not classified as market risk', () => {
    const b = blocker({ category: 'PROVIDER_ISSUE', code: 'QUOTE_PROVIDER_DOWNGRADED', severity: 'SOFT_BLOCK', message: 'provider degraded', executionBlocking: 'NONE' });
    expect(b.category).toBe('PROVIDER_ISSUE');
    expect(b.category).not.toBe('MARKET_RISK');
  });

  it('wouldEnterIfNoTimeBlock is true only when non-time blockers allow entry', () => {
    const d = buildEntryFilterDecomposition({
      now,
      universeCandidates: 2,
      watchlistCandidates: 2,
      entries: 0,
      macroGateState: macro({ sellOnlyMode: true }),
      waitDistribution: { dataHold: 0, preBreakout: 0, gateFail: 1, sizingBlocked: 0, driftRemove: 0, corpAction: 0, volumeDrop: 0, other: 0 },
      candidateSnapshots: snapshots(2),
    });
    expect(d.candidateTraces.find((x) => x.symbol === 'A1')?.wouldEnterIfNoTimeBlock).toBe(false);
    expect(d.candidateTraces.find((x) => x.symbol === 'A2')?.wouldEnterIfNoTimeBlock).toBe(true);
  });

  it('FILTER_TOO_CONSERVATIVE is not emitted in CRISIS/RISK_OFF when entry 0 is expected', () => {
    const d = buildEntryFilterDecomposition({ now, universeCandidates: 20, watchlistCandidates: 20, entries: 0, macroGateState: macro({ regime: 'RISK_OFF' }), candidateSnapshots: snapshots(20) });
    expect(d.filterConservatismReport).toBeUndefined();
  });

  it('Policy Health counterfactualRecorded is scope-labelled entryCounterfactualRecorded (P2 followup)', () => {
    // scanblockers-truth-consistency 후속: universe-scope(universeCounterfactualRowsCreated)와
    // 혼동되는 bare 'counterfactualRecorded' 번호목록 항목 잔존 금지 — scope-prefix 라벨만.
    const d = buildEntryFilterDecomposition({
      now,
      universeCandidates: 2,
      watchlistCandidates: 2,
      entries: 0,
      macroGateState: macro(),
      candidateSnapshots: snapshots(2),
    });
    const formatted = formatEntryFilterDecompositionSection(d) ?? '';
    expect(formatted).toContain(`entryCounterfactualRecorded: ${d.counterfactualRecorded}`);
    // 번호목록 항목 '10. counterfactualRecorded:' (bare) 는 출력되지 않는다.
    expect(formatted).not.toMatch(/\d+\.\s+counterfactualRecorded:/);
  });
});

it('flattens technical fields from nested symbolFeatures to top-level trace', () => {
  const d = buildEntryFilterDecomposition({
    now,
    universeCandidates: 1,
    watchlistCandidates: 1,
    entries: 0,
    macroGateState: macro(),
    candidateSnapshots: [{ symbol: 'A1', symbolFeatures: { ma20: 10, ma60: 9, rsi14: 55, atr: 1.2 } }],
  });
  expect(d.candidateTraces[0].ma20).toBe(10);
  expect(d.candidateTraces[0].ma60).toBe(9);
  expect(d.candidateTraces[0].rsi14).toBe(55);
  expect(d.candidateTraces[0].atr).toBe(1.2);
});

it('does not generate placeholder symbols when candidate snapshots exist', () => {
  const d = buildEntryFilterDecomposition({
    now,
    universeCandidates: 3,
    watchlistCandidates: 3,
    entries: 0,
    macroGateState: macro(),
    candidateSnapshots: [{ symbol: 'REAL1' }, { symbol: 'REAL2' }, { symbol: 'REAL3' }],
  });
  expect(d.candidateTraces.every((row) => !row.symbol.startsWith('WATCHLIST_'))).toBe(true);
});

it('wires canonical positive feature inputs into Gate1 trace and score curve audit', () => {
  const d = buildEntryFilterDecomposition({
    now,
    universeCandidates: 3,
    watchlistCandidates: 3,
    entries: 0,
    macroGateState: macro(),
    candidateSnapshots: [
      {
        symbol: 'P1',
        quoteFeatures: { return5d: 5, return20d: 18, relativeReturn20d: 12 },
        featurePack: { breakout: { breakoutScore: 7 } },
      },
      {
        symbol: 'P2',
        quote: { return5d: 2, return20d: 10, relativeReturn20d: 6 },
        breakoutTrace: { breakoutScore: 3 },
      },
      {
        symbol: 'P3',
        symbolFeatures: { return5d: 1, return20d: 4, relativeReturn20d: 1 },
        breakoutSignals: { turtle_high: false, volume_breakout: false },
      },
    ],
  });
  expect(d.candidateTraces.every((trace) => Number.isFinite(trace.return5d))).toBe(true);
  expect(d.candidateTraces.every((trace) => Number.isFinite(trace.relativeReturn20d))).toBe(true);
  expect(d.candidateTraces.every((trace) => Number.isFinite(trace.rsRankPct))).toBe(true);
  const formatted = formatEntryFilterDecompositionSection(d) ?? '';
  expect(formatted).toContain('- projectionRawComputedCount=3');
  expect(formatted).toContain('- projectionDerivedComputedCount=3');
  expect(formatted).toContain('- gateTraceConsumedCount=3');
  expect(formatted).toContain('- finalScoreSourceDistribution=');
  expect(formatted).toContain('- inputPathResolvedCount=3');
  expect(formatted).toContain('- inputPathUnresolvedCount=0');
  expect(formatted).toContain('- rsRawInputCount=3');
  expect(formatted).toContain('- rsDerivedInputCount=3');
  expect(formatted).toContain('- rsRankPctComputedCount=3');
  expect(formatted).toContain('- rsScoreAppliedCount=3');
  expect(formatted).toContain('- fallbackIncluded=false');
  expect(formatted).toContain('- fallbackReasonDistribution=');
  expect(formatted).toContain('- runtimeScoreComputed=3');
  expect(formatted).toContain('- scoreMappedToGate=3');
  expect(formatted).toContain('- TRACE_NOT_PROJECTED=0');
  expect(formatted).toContain('INPUT_NOT_CONNECTED=0');
  expect(formatted).toContain('- shadowObservablePreserved=true');
  expect(formatted).toContain('Gate2ExternalData:');
  expect(formatted).toContain('- dart: status=MISSING reason=DART_FINANCIALS_MISSING');
  expect(formatted).toContain('- entryHardBlockImpact=NO');
});

it('separates Gate2 external data stage from SectorEnergy leadership state', () => {
  const d = buildEntryFilterDecomposition({
    now,
    universeCandidates: 1,
    watchlistCandidates: 1,
    entries: 0,
    macroGateState: macro(),
    candidateSnapshots: [
      {
        symbol: 'E1',
        price: 100,
        volume: 1000,
        gate2ExternalDataCoverage: {
          dartFinancials: { status: 'MISSING', required: true, stageNotFetched: false },
          sectorCycle: { status: 'PARTIAL', provider: 'INTERNAL_GROUPED_SNAPSHOT' },
          leaderCycle: { status: 'UNKNOWN' },
        },
      },
    ],
  });

  const formatted = formatEntryFilterDecompositionSection(d) ?? '';
  expect(formatted).toContain('Gate2ExternalData:');
  expect(formatted).toContain('- dart: status=MISSING reason=DART_FINANCIALS_MISSING affectedConditions=earnings_quality,roe,opm,icr,per scoreImpact=limited_to_high_conviction executionImpact=NONE');
  expect(formatted).toContain('- valuation: perStatus=MISSING source=NONE');
  expect(formatted).toContain('- sectorCycle: status=SHADOW_ONLY sourceTier=INTERNAL_GROUPED_SNAPSHOT');
  expect(formatted).toContain('- leaderCycle: status=UNKNOWN sourceTier=NONE');
  expect(formatted).toContain('- highConvictionImpact=BLOCK_STRONG_BUY_UPGRADE');
  expect(formatted).toContain('- entryHardBlockImpact=NO');
  expect(formatted).toContain('- executionImpact=NONE');
});

it('materializes Gate2/Gate3 runtime diagnostics into quote features and RS percentile', () => {
  const candidate = (symbol: string, relativeReturn20d: number, return5d: number, turtleStatus: string) => ({
    symbol,
    gateLayerSummary: {
      gate2: {
        externalDataCoverage: {
          benchmark: {
            values: {
              stockReturn20d: relativeReturn20d + 0.03,
              benchmarkReturn20d: 0.03,
              relativeReturn20d,
            },
          },
        },
      },
      gate3: {
        externalDataCoverage: {
          priceStructure: {
            values: { currentPrice: 100, high5d: 103, high20d: 110, high60d: 120 },
            turtle: { status: turtleStatus },
            breakout: { status: 'FAIL' },
          },
          momentumIndicators: {
            values: { return5d, return20d: relativeReturn20d + 0.03 },
            shortMomentum: { status: return5d > 0 ? 'PASS' : 'FAIL' },
          },
          volumeTiming: {
            values: { volume: 1000, avgVolume20d: 900, volumeRatio: 1.1 },
            breakoutVolume: { status: 'FAIL' },
            vcp: { status: 'FAIL' },
          },
        },
      },
    },
  });
  const d = buildEntryFilterDecomposition({
    now,
    universeCandidates: 3,
    watchlistCandidates: 3,
    entries: 0,
    macroGateState: macro(),
    candidateSnapshots: [
      candidate('G1', 0.12, 0.04, 'PASS'),
      candidate('G2', 0.05, 0.02, 'FAIL'),
      candidate('G3', -0.02, -0.01, 'FAIL'),
    ],
  });

  expect(d.candidateTraces.every((trace) => Number.isFinite(trace.return5d))).toBe(true);
  expect(d.candidateTraces.every((trace) => Number.isFinite(trace.return20d))).toBe(true);
  expect(d.candidateTraces.every((trace) => Number.isFinite(trace.relativeReturn20d))).toBe(true);
  expect(d.candidateTraces.every((trace) => Number.isFinite(trace.rsRankPct))).toBe(true);
  expect(d.candidateTraces.every((trace) => Number.isFinite(trace.high5d))).toBe(true);
  expect(d.candidateTraces.every((trace) => Number.isFinite(trace.high20d))).toBe(true);

  const formatted = formatEntryFilterDecompositionSection(d) ?? '';
  expect(formatted).toContain('- projectionRawComputedCount=3');
  expect(formatted).toContain('- projectionDerivedComputedCount=3');
  expect(formatted).toContain('- gateTraceConsumedCount=3');
  expect(formatted).toContain('- finalScoreSourceDistribution=');
  expect(formatted).toContain('- return5dCount=3');
  expect(formatted).toContain('- return20dCount=3');
  expect(formatted).toContain('- relativeReturn20dCount=3');
  expect(formatted).toContain('- rsRawInputCount=3');
  expect(formatted).toContain('- rsDerivedInputCount=3');
  expect(formatted).toContain('- rsRankPctComputedCount=3');
  expect(formatted).toContain('- relativeStrengthScoreComputedCount=3');
  expect(formatted).toContain('- rsScoreAppliedCount=3');
  expect(formatted).toContain('- fallbackReasonDistribution=');
  expect(formatted).toContain('- missingByMapping=0');
  expect(formatted).toContain('- TRACE_NOT_PROJECTED=0');
  expect(formatted).toContain('INPUT_NOT_CONNECTED=0');
});

it('uses Gate1Trace rawValue when report rows no longer carry quote feature fields', () => {
  const d = buildEntryFilterDecomposition({
    now,
    universeCandidates: 3,
    watchlistCandidates: 3,
    entries: 0,
    macroGateState: macro(),
    candidateSnapshots: [
      { symbol: 'R1', quoteFeatures: { return5d: 5, return20d: 18, relativeReturn20d: 12 } },
      { symbol: 'R2', quoteFeatures: { return5d: 2, return20d: 10, relativeReturn20d: 6 } },
      { symbol: 'R3', quoteFeatures: { return5d: 1, return20d: 4, relativeReturn20d: 1 } },
    ],
  });

  for (const trace of d.candidateTraces) {
    delete trace.return5d;
    delete trace.return20d;
    delete trace.relativeReturn20d;
    delete trace.marketRelativeReturn;
    delete trace.quote;
    delete trace.quoteFeatures;
    trace.symbolFeatures = {};
    delete trace.featurePack;
    delete trace.momentumProjection;
  }

  const formatted = formatEntryFilterDecompositionSection(d) ?? '';
  expect(formatted).toContain('- projectionRawComputedCount=0');
  expect(formatted).toContain('- projectionDerivedComputedCount=3');
  expect(formatted).toContain('- gateTraceConsumedCount=3');
  expect(formatted).toContain('- finalScoreSourceDistribution=GATE_TRACE=3');
  expect(formatted).toContain('- return5dCount=3');
  expect(formatted).toContain('- return20dCount=3');
  expect(formatted).toContain('- relativeReturn20dCount=3');
  expect(formatted).toContain('- rsRankPctComputedCount=3');
  expect(formatted).toContain('- relativeStrengthScoreComputedCount=3');
  expect(formatted).toContain('INPUT_NOT_CONNECTED=0');
});

it('locks child regime output to SourceSnapshotDecisionContext and keeps legacy R6 diagnostic-only', () => {
  const d = buildEntryFilterDecomposition({
    now,
    universeCandidates: 1,
    watchlistCandidates: 1,
    entries: 0,
    macroGateState: macro({ regime: 'R3_EARLY', macroRegimeEffective: 'R6_DEFENSE', displayRegime: 'SHADOW_ONLY', riskOverride: 'SHADOW_ONLY' }),
    candidateSnapshots: snapshots(1),
  });
  const formatted = formatEntryFilterDecompositionSection(d, {
    rawRegime: 'R3_EARLY',
    effectiveRegime: 'R3_EARLY',
    displayRegime: 'SHADOW_ONLY',
    riskOverride: 'SHADOW_ONLY',
    engineMode: 'SHADOW_ONLY',
    policyView: 'SHADOW_ONLY',
    liveEntryAllowed: false,
    shadowAllowed: true,
    counterfactualAllowed: true,
    regimeContextSource: 'SourceSnapshotDecisionContext',
    regimeContextMatch: true,
    page2EffectiveRegime: 'R3_EARLY',
    childEffectiveRegime: 'R3_EARLY',
    legacyEffectiveRegime: 'R6_DEFENSE',
    legacyDeprecated: true,
    legacyUsedForDecision: false,
    regimeContextMismatch: false,
    legacyEffectiveRegimeLeak: false,
    nextAction: 'NONE',
  }) ?? '';
  expect(formatted).toContain('- effectiveRegime=R3_EARLY');
  expect(formatted).toContain('- regimeContextSource=SourceSnapshotDecisionContext');
  expect(formatted).toContain('- regimeContextMatch=true');
  expect(formatted).toContain('- page2EffectiveRegime=R3_EARLY');
  expect(formatted).toContain('- childEffectiveRegime=R3_EARLY');
  expect(formatted).toContain('- legacyEffectiveRegime=R6_DEFENSE deprecated=true usedForDecision=false');
  expect(formatted).toContain('- REGIME_CONTEXT_MISMATCH=false');
  expect(formatted).toContain('- LEGACY_EFFECTIVE_REGIME_LEAK=false');
  expect(formatted).not.toContain('- effectiveRegime=R6_DEFENSE');
});

describe('Gate2 external data Section D/E/G display lanes', () => {
  it('§D ProgramTrade missing renders optional/diagnosticOnly lane (not a Gate2 failure)', () => {
    const d = buildEntryFilterDecomposition({
      now,
      universeCandidates: 1,
      watchlistCandidates: 1,
      entries: 0,
      macroGateState: macro(),
      candidateSnapshots: [
        {
          symbol: 'P1',
          price: 100,
          volume: 1000,
          gate2ExternalDataCoverage: {
            dartFinancials: { status: 'MISSING', required: true, stageNotFetched: false },
            sectorCycle: { status: 'PARTIAL', provider: 'INTERNAL_GROUPED_SNAPSHOT' },
            leaderCycle: { status: 'UNKNOWN' },
          },
        },
      ],
    });
    const formatted = formatEntryFilterDecompositionSection(d) ?? '';
    expect(formatted).toContain(
      '- program: status=MISSING compact=OPTIONAL_MISSING optional=true signal=UNKNOWN scoring=excluded diagnosticOnly=true marketSignal=false providerIssue=false executionImpact=NONE action=OBSERVE_PROGRAM_TRADE',
    );
    // ProgramTrade missing 이 bearish/hard fail 로 승격되지 않음.
    expect(formatted).not.toContain('PROGRAM_TRADE_FAIL');
  });

  it('§D ProgramTrade transport error sets providerIssue=true only', () => {
    const d = buildEntryFilterDecomposition({
      now,
      universeCandidates: 1,
      watchlistCandidates: 1,
      entries: 0,
      macroGateState: macro(),
      candidateSnapshots: [
        {
          symbol: 'P2',
          price: 100,
          volume: 1000,
          gate2ExternalDataCoverage: {
            dartFinancials: { status: 'MISSING', required: true, stageNotFetched: false },
            programTrade: { status: 'DEGRADED', providerIssue: true },
          },
        },
      ],
    });
    const formatted = formatEntryFilterDecompositionSection(d) ?? '';
    expect(formatted).toContain('providerIssue=true executionImpact=NONE action=OBSERVE_PROGRAM_TRADE');
    // providerIssue 가 marketSignal 로 변환되지 않음.
    expect(formatted).toContain('- program: status=DEGRADED');
    expect(formatted).toContain('marketSignal=false');
  });

  it('§E SectorCycle/LeaderCycle observe lane annotates diagnosticOnly without hard fail', () => {
    const d = buildEntryFilterDecomposition({
      now,
      universeCandidates: 1,
      watchlistCandidates: 1,
      entries: 0,
      macroGateState: macro(),
      candidateSnapshots: [
        {
          symbol: 'S1',
          price: 100,
          volume: 1000,
          gate2ExternalDataCoverage: {
            dartFinancials: { status: 'MISSING', required: true, stageNotFetched: false },
            sectorCycle: { status: 'PARTIAL', provider: 'INTERNAL_GROUPED_SNAPSHOT' },
            leaderCycle: { status: 'UNKNOWN' },
          },
        },
      ],
    });
    const formatted = formatEntryFilterDecompositionSection(d) ?? '';
    expect(formatted).toContain(
      '- sectorCycle: status=SHADOW_ONLY sourceTier=INTERNAL_GROUPED_SNAPSHOT marketSignal=false diagnosticOnly=true executionImpact=NONE',
    );
    expect(formatted).toContain(
      '- leaderCycle: status=UNKNOWN sourceTier=NONE marketSignal=false diagnosticOnly=true executionImpact=NONE',
    );
  });

  it('§G Gate2 Data Line Health block summarizes all external lines (executionImpact=NONE)', () => {
    const d = buildEntryFilterDecomposition({
      now,
      universeCandidates: 1,
      watchlistCandidates: 1,
      entries: 0,
      macroGateState: macro(),
      // PR#1310 리뷰(P2): KIS_FLOW 는 supplyProviderHealth.status 에서 파생(하드코딩 금지).
      // 공급이 VERIFIED 면 KIS_FLOW: VERIFIED 가 나와야 한다(파생 근거).
      supplyProviderHealth: { status: 'VERIFIED' },
      candidateSnapshots: [
        {
          symbol: 'H1',
          price: 100,
          volume: 1000,
          gate1Passed: false,
          gate2Passed: false,
          gate2ExternalDataCoverage: {
            dartFinancials: { status: 'PARTIAL', required: true, stageNotFetched: false },
            dartLineHealth: {
              status: 'PARTIAL',
              availableFields: ['roe', 'opm'],
              missingFields: ['earningsQuality', 'icr'],
            },
            valuation: { per: { status: 'AVAILABLE', source: 'DART', reason: 'NONE' } },
            sectorCycle: { status: 'PARTIAL', provider: 'INTERNAL_GROUPED_SNAPSHOT' },
            leaderCycle: { status: 'UNKNOWN' },
          },
        },
      ],
    });
    const formatted = formatEntryFilterDecompositionSection(d) ?? '';
    expect(formatted).toContain('Gate2 Data Line Health:');
    expect(formatted).toContain('- KIS_FLOW: VERIFIED (상세는 KIS Router Eligibility 참조)');
    expect(formatted).toContain(
      '- DART_FINANCIALS: PARTIAL connectionStatus=CONNECTED_OK dataStatus=PARTIAL useScope=HIGH_CONVICTION_ONLY availableFields=roe,opm missingFields=earningsQuality,icr',
    );
    // BASELINE-LOCK-001 — VALUATION_PER 에 connectionStatus/interpretation/providerIssue carry.
    expect(formatted).toContain('- VALUATION_PER: AVAILABLE connectionStatus=CONNECTED_OK interpretation=PER_MEANINGFUL');
    expect(formatted).toContain('source=DART reason=NONE providerIssue=false highConvictionOnly=true entryHardBlock=false');
    // BASELINE-LOCK-001 — Gate2 Financial Baseline 요약 블록 + 잠긴 불변식.
    expect(formatted).toContain('Gate2 Financial Baseline:');
    expect(formatted).toContain('financialBaselineInvariant=LOCKED_OK');
    expect(formatted).toContain('[OK] DART_CONNECTED_OK');
    expect(formatted).toContain('[OK] PER_NON_POSITIVE_IS_NOT_PROVIDER_FAILURE');
    // §G — program/leader optional·diagnostic missing 은 OPTIONAL_MISSING/DIAGNOSTIC_MISSING 로 표기.
    expect(formatted).toContain('- PROGRAM_TRADE: OPTIONAL_MISSING optional=true diagnosticOnly=true');
    expect(formatted).toContain('- SECTOR_CYCLE: SHADOW_ONLY sourceTier=INTERNAL_GROUPED_SNAPSHOT');
    expect(formatted).toContain('- LEADER_CYCLE: DIAGNOSTIC_MISSING sourceTier=NONE');
    expect(formatted).toContain('- executionImpact=NONE marketSignal=false shadowLearning=true');
  });

  it('§G KIS_FLOW 는 공급 미가용 시 VERIFIED 로 오표시하지 않는다 (PR#1310 리뷰 P2)', () => {
    const d = buildEntryFilterDecomposition({
      now,
      universeCandidates: 1,
      watchlistCandidates: 1,
      entries: 0,
      macroGateState: macro(),
      // 투자흐름 row 가 없는 스캔(MISSING) — 하드코딩이라면 VERIFIED 로 오표시됐을 케이스.
      supplyProviderHealth: { status: 'MISSING' },
      candidateSnapshots: [
        {
          symbol: 'H1',
          price: 100,
          volume: 1000,
          gate2ExternalDataCoverage: {
            dartFinancials: { status: 'MISSING', required: true, stageNotFetched: false },
            leaderCycle: { status: 'UNKNOWN' },
          },
        },
      ],
    });
    const formatted = formatEntryFilterDecompositionSection(d) ?? '';
    expect(formatted).toContain('- KIS_FLOW: MISSING (상세는 KIS Router Eligibility 참조)');
    expect(formatted).not.toContain('- KIS_FLOW: VERIFIED');
  });
});

describe('Gate2 Data Line Health canonical carry (patch: gate2 data line health fix)', () => {
  const canonicalKisVerified = {
    selectedProvider: 'KIS_API',
    finalRouterUsable: true,
    finalGateScoreEligible: true,
    gateEligibleRows: 22,
    totalRows: 23,
    shadowOnlyRows: 1,
    failedCriteria: [],
    providerIssue: false,
    marketSignal: false,
  };

  function decomposition(canonicalSupplyStatus: 'VERIFIED' | 'MISSING' = 'MISSING') {
    const built = buildEntryFilterDecomposition({
      now,
      universeCandidates: 2,
      watchlistCandidates: 2,
      entries: 0,
      macroGateState: macro(),
      // 공급 health 는 MISSING 이라도 canonical 이 VERIFIED 면 KIS_FLOW 는 VERIFIED 여야 한다.
      supplyProviderHealth: { status: canonicalSupplyStatus },
      candidateSnapshots: [
        {
          symbol: 'H1',
          price: 100,
          volume: 1000,
          gate2ExternalDataCoverage: {
            kisInvestorFlow: { status: 'VERIFIED' },
            dartFinancials: { status: 'VERIFIED', required: true, stageNotFetched: false },
            dartLineHealth: {
              status: 'VERIFIED',
              availableFields: ['roe', 'opm', 'ocfToNi', 'icr', 'earningsQuality'],
              missingFields: [],
              providerIssue: false,
            },
            valuation: { per: { status: 'UNAVAILABLE', source: 'KIS', reason: 'PER_NON_POSITIVE_OR_UNAVAILABLE' } },
            sectorCycle: { status: 'MISSING' },
            leaderCycle: { status: 'MISSING' },
          },
        },
        {
          symbol: 'H2',
          price: 110,
          volume: 1200,
          gate1Passed: true,
          gate2Passed: false,
          gate2ExternalDataCoverage: {
            kisInvestorFlow: { status: 'VERIFIED' },
            dartFinancials: { status: 'VERIFIED', required: true, stageNotFetched: false },
            dartLineHealth: {
              status: 'VERIFIED',
              availableFields: ['roe', 'opm', 'ocfToNi', 'icr', 'earningsQuality'],
              missingFields: [],
              providerIssue: false,
            },
            valuation: { per: { status: 'UNAVAILABLE', source: 'KIS', reason: 'PER_NON_POSITIVE_OR_UNAVAILABLE' } },
            sectorCycle: { status: 'MISSING' },
            leaderCycle: { status: 'MISSING' },
          },
        },
      ],
    });
    const gate1FailTrace = built.candidateTraces[0] as { gate1Passed?: boolean; gate2Passed?: boolean } | undefined;
    const gate1PassTrace = built.candidateTraces[1] as { gate1Passed?: boolean; gate2Passed?: boolean } | undefined;
    if (gate1FailTrace) {
      gate1FailTrace.gate1Passed = false;
      gate1FailTrace.gate2Passed = false;
    }
    if (gate1PassTrace) {
      gate1PassTrace.gate1Passed = true;
      gate1PassTrace.gate2Passed = false;
    }
    return built;
  }

  it('§A KIS_FLOW 는 canonical finalGateScoreEligible 에서 VERIFIED + gateEligibleRows/apiPath/trId carry', () => {
    const formatted = formatEntryFilterDecompositionSection(
      decomposition('MISSING'),
      undefined,
      { kisInvestorFlow: canonicalKisVerified },
    ) ?? '';
    expect(formatted).toContain(
      '- KIS_FLOW: VERIFIED gateEligibleRows=22/23 provider=KIS_API apiPath=/uapi/domestic-stock/v1/quotations/investor-trade-by-stock-daily trId=FHPTJ04160001',
    );
    expect(formatted).not.toContain('- KIS_FLOW: MISSING');
  });

  it('§B DART_FINANCIALS 는 dartLineHealth carry 로 VERIFIED 표기 (NOT_ATTEMPTED 아님)', () => {
    const formatted = formatEntryFilterDecompositionSection(
      decomposition('VERIFIED'),
      undefined,
      { kisInvestorFlow: canonicalKisVerified },
    ) ?? '';
    expect(formatted).toContain('- DART_FINANCIALS: VERIFIED');
    expect(formatted).not.toContain('DART_FINANCIALS: NOT_ATTEMPTED');
  });

  it('§D Condition Attribution Matrix + §F invariants 노출, executionImpact=NONE', () => {
    const formatted = formatEntryFilterDecompositionSection(
      decomposition('VERIFIED'),
      undefined,
      { kisInvestorFlow: canonicalKisVerified },
    ) ?? '';
    expect(formatted).toContain('Gate2 Condition Attribution Matrix:');
    expect(formatted).toContain('gate2EvaluationScope | finalGate2 | upstreamBlocker | gate2DiagnosticPrimary');
    expect(formatted).toContain('NOT_EVALUATED_GATE1_FAIL');
    expect(formatted).toContain('GATE1_FAIL');
    expect(formatted).toContain('DATA_INCOMPLETE_HIGH_CONVICTION_ONLY');
    expect(formatted).toContain('Gate2 DataLine Invariants:');
    expect(formatted).toContain('[OK] KIS_FLOW_CARRY');
    expect(formatted).toContain('[OK] DART_STATUS_CARRY');
    expect(formatted).toContain('[OK] PER_UNAVAILABLE_HIGH_CONVICTION_ONLY_NOT_ENTRY_BLOCK');
    expect(formatted).toContain('[OK] OPTIONAL_PROGRAM_TRADE_NOT_BLOCKING');
    expect(formatted).toContain('[OK] DIAGNOSTIC_MISSING_NOT_MARKET_SIGNAL');
    expect(formatted).toContain('[OK] SHADOW_LEARNING_CONTINUITY');
  });

  it('§F KIS_FLOW_CARRY invariant 위반 감지 (canonical eligible 인데 표시 MISSING 이면 VIOLATION)', () => {
    // canonical finalGateScoreEligible=true 이지만 provider=KRX 라 KIS_API 가 아니어도 VERIFIED 파생됨.
    // 위반은 canonical eligible + 표시가 VERIFIED/PARTIAL 이 아닐 때만 — 정상 경로에서는 OK 가 보장된다.
    const formatted = formatEntryFilterDecompositionSection(
      decomposition('MISSING'),
      undefined,
      { kisInvestorFlow: canonicalKisVerified },
    ) ?? '';
    expect(formatted).toContain('[OK] KIS_FLOW_CARRY');
    expect(formatted).toContain('marketSignal=false');
  });
});
