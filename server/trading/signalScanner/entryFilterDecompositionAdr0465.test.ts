import { describe, expect, it } from 'vitest';
import {
  buildEntryFilterDecomposition,
  formatEntryFilterDecompositionSection,
  type CandidateSnapshot,
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

function snapshots(n: number, patch: Partial<CandidateSnapshot> = {}): CandidateSnapshot[] {
  return Array.from({ length: n }, (_, i) => ({
    symbol: `A${i + 1}`,
    name: `Alpha ${i + 1}`,
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

describe('ADR-0465 Gate1 survivor decomposition', () => {
  it('Gate1 fail decomposes into condition traces and ledger primaryGate1FailCode', () => {
    const d = buildEntryFilterDecomposition({
      now,
      universeCandidates: 2,
      watchlistCandidates: 2,
      entries: 0,
      macroGateState: macro(),
      waitDistribution: { dataHold: 0, preBreakout: 0, gateFail: 2, sizingBlocked: 0, driftRemove: 0, corpAction: 0, volumeDrop: 0, other: 0 },
      candidateSnapshots: snapshots(2),
      supplyProviderHealth: noRecentSample,
    });
    expect(d.gate1CandidateTraces).toHaveLength(2);
    expect(d.gate1CandidateTraces[0].conditions.map((c) => c.code)).toContain('MIN_SIGNAL_SCORE_PASS');
    expect(d.ledgerRows[0].primaryGate1FailCode).toBe('SUPPLY_PROVIDER_HEALTH_PASS');
    expect(d.ledgerRows[0].gate1TraceSummary?.tags).toContain('CASE_GATE1_ZERO_SURVIVOR');
  });

  it('no recent investor-flow sample is providerIssue=true and marketSignal=false', () => {
    const d = buildEntryFilterDecomposition({
      now,
      universeCandidates: 1,
      watchlistCandidates: 1,
      entries: 0,
      macroGateState: macro(),
      candidateSnapshots: snapshots(1),
      supplyProviderHealth: noRecentSample,
    });
    const health = d.gate1CandidateTraces[0].conditions.find((c) => c.code === 'SUPPLY_PROVIDER_HEALTH_PASS');
    expect(health?.passed).toBe(false);
    expect(health?.providerIssue).toBe(true);
    expect(health?.marketSignal).toBe(false);
    expect(d.supplyProviderHealth.gate1Severity).toBe('SOFT_FAIL');
  });

  it('supplyConfluence UNKNOWN is not treated as BEARISH and remains soft/provider issue', () => {
    const d = buildEntryFilterDecomposition({
      now,
      universeCandidates: 1,
      watchlistCandidates: 1,
      entries: 0,
      macroGateState: macro(),
      candidateSnapshots: snapshots(1, { supplyConfluenceState: 'UNKNOWN' }),
    });
    const supply = d.gate1CandidateTraces[0].conditions.find((c) => c.code === 'SUPPLY_CONFLUENCE_PASS');
    expect(supply?.severity).toBe('SOFT_FAIL');
    expect(supply?.providerIssue).toBe(true);
    expect(supply?.marketSignal).toBe(false);
  });

  it('BEARISH supplyConfluence is the only supply marketSignal hard fail', () => {
    const d = buildEntryFilterDecomposition({
      now,
      universeCandidates: 1,
      watchlistCandidates: 1,
      entries: 0,
      macroGateState: macro(),
      candidateSnapshots: snapshots(1, { supplyConfluenceState: 'BEARISH' }),
    });
    const supply = d.gate1CandidateTraces[0].conditions.find((c) => c.code === 'SUPPLY_CONFLUENCE_PASS');
    expect(supply?.severity).toBe('HARD_FAIL');
    expect(supply?.marketSignal).toBe(true);
  });

  it('actualGate1Survivors and counterfactual provider survivors are separated and executionImpact remains NONE', () => {
    const d = buildEntryFilterDecomposition({
      now,
      universeCandidates: 1,
      watchlistCandidates: 1,
      entries: 0,
      macroGateState: macro(),
      candidateSnapshots: snapshots(1),
      supplyProviderHealth: noRecentSample,
    });
    expect(d.gate1CounterfactualSurvivorReport.actualGate1Survivors).toBe(0);
    expect(d.gate1CounterfactualSurvivorReport.ifProviderIssueSoftened).toBe(1);
    expect(d.gate1CounterfactualSurvivorReport.candidateExamples[0].counterfactualPassReason).toContain('CASE_GATE1_PROVIDER_SOFTENED_SURVIVOR');
    expect(d.gate1CandidateTraces[0].executionImpact).toBe('NONE');
  });

  it('SELL_ONLY does not overwrite Gate1 reasons; signal vs execution eligibility are separated', () => {
    const d = buildEntryFilterDecomposition({
      now,
      universeCandidates: 1,
      watchlistCandidates: 1,
      entries: 0,
      macroGateState: macro({ sellOnlyMode: true }),
      waitDistribution: { dataHold: 0, preBreakout: 0, gateFail: 1, sizingBlocked: 0, driftRemove: 0, corpAction: 0, volumeDrop: 0, other: 0 },
      candidateSnapshots: snapshots(1),
      supplyProviderHealth: noRecentSample,
    });
    expect(d.candidateTraces[0].blockers.map((b) => b.code)).toEqual(expect.arrayContaining(['SELL_ONLY_TIME_WINDOW', 'GATE1_FAIL']));
    expect(d.gate1CandidateTraces[0].primaryFailCode).toBe('SUPPLY_PROVIDER_HEALTH_PASS');
    expect(d.gate1CandidateTraces[0].conditions.find((c) => c.code === 'TRADING_SESSION_PASS')?.severity).toBe('SOFT_FAIL');
    expect(d.gate1CounterfactualSurvivorReport.ifTimeWindowIgnored).toBe(0);
  });

  it('wouldEnterIfNoOrderBlock is false without an order blocker and true only when order is sole blocker', () => {
    const gateFail = buildEntryFilterDecomposition({
      now,
      universeCandidates: 1,
      watchlistCandidates: 1,
      entries: 0,
      macroGateState: macro(),
      waitDistribution: { dataHold: 0, preBreakout: 0, gateFail: 1, sizingBlocked: 0, driftRemove: 0, corpAction: 0, volumeDrop: 0, other: 0 },
      candidateSnapshots: snapshots(1),
    });
    expect(gateFail.candidateTraces[0].wouldEnterIfNoOrderBlock).toBe(false);

    const orderOnly = buildEntryFilterDecomposition({
      now,
      universeCandidates: 1,
      watchlistCandidates: 1,
      entries: 0,
      macroGateState: macro({ autoTradeEnabled: false }),
      candidateSnapshots: snapshots(1, { supplyProviderHealth: { status: 'VERIFIED', providerIssue: false, marketSignal: false, gate1Severity: 'NONE', reason: ['ok'] } }),
    });
    expect(orderOnly.candidateTraces[0].wouldEnterIfNoOrderBlock).toBe(true);

    const gateAndOrder = buildEntryFilterDecomposition({
      now,
      universeCandidates: 1,
      watchlistCandidates: 1,
      entries: 0,
      macroGateState: macro({ autoTradeEnabled: false }),
      waitDistribution: { dataHold: 0, preBreakout: 0, gateFail: 1, sizingBlocked: 0, driftRemove: 0, corpAction: 0, volumeDrop: 0, other: 0 },
      candidateSnapshots: snapshots(1),
    });
    expect(gateAndOrder.candidateTraces[0].wouldEnterIfNoOrderBlock).toBe(false);
  });

  it('SectorEnergy diagnostic only remains STRONG_BUY_ONLY/diagnostic and learningBlocking=false for provider issue', () => {
    const d = buildEntryFilterDecomposition({
      now,
      universeCandidates: 1,
      watchlistCandidates: 1,
      entries: 0,
      macroGateState: macro(),
      sectorEnergyQuality: 'DEGRADED',
      candidateSnapshots: snapshots(1),
      supplyProviderHealth: noRecentSample,
    });
    const sectorBlocker = d.candidateTraces[0].blockers.find((b) => b.category === 'SECTOR_ENERGY');
    expect(sectorBlocker?.severity).toBe('DIAGNOSTIC_ONLY');
    expect(sectorBlocker?.executionBlocking).toBe('STRONG_BUY_ONLY');
    expect(d.gate1CandidateTraces[0].conditions.filter((c) => c.providerIssue).every((c) => c.learningBlocking === false)).toBe(true);
  });

  it('Gate1 zero survivor creates decomposition report and Telegram section', () => {
    const d = buildEntryFilterDecomposition({
      now,
      universeCandidates: 3,
      watchlistCandidates: 3,
      entries: 0,
      macroGateState: macro({ sellOnlyMode: true }),
      waitDistribution: { dataHold: 0, preBreakout: 0, gateFail: 3, sizingBlocked: 0, driftRemove: 0, corpAction: 0, volumeDrop: 0, other: 0 },
      candidateSnapshots: snapshots(3),
      supplyProviderHealth: noRecentSample,
    });
    expect(d.gate1DecompositionReport.gate1Passed).toBe(0);
    expect(d.gate1DecompositionReport.providerIssueDistribution.SUPPLY_PROVIDER_HEALTH_PASS).toBe(3);
    const section = formatEntryFilterDecompositionSection(d);
    expect(section).toContain('Gate1 Survivor Decomposition (ADR-0465)');
    expect(section).toContain('provider-softened survivor');
  });
});
