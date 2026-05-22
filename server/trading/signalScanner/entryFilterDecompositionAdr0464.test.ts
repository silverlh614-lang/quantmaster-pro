import { describe, expect, it } from 'vitest';
import {
  buildEntryFilterDecomposition,
  blocker,
  createKellySizingTrace,
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
    expect(k.blockedBySizing).toBe(true);
    expect(k.reason).toBe('KELLY_ADJUSTED_TOO_LOW');
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
      universeCandidates: 1,
      watchlistCandidates: 1,
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
