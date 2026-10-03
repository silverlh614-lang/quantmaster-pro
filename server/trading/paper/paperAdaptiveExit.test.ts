// @responsibility Verify prospective exit triggers with chronological equal-trade learning.
import { describe, expect, it } from 'vitest';
import type { PaperSnapshot } from '../../../src/types/paperExperiment.js';
import type { PaperStrategyTrade } from '../../../src/types/paperStrategy.js';
import { previousKrxTradingDay } from '../../calendar/krxTradingCalendar.js';
import { addBusinessDaysFromKstDate } from '../krxHolidays.js';
import { adaptiveTestSnapshot } from './paperAdaptiveFixtures.js';
import { PAPER_ADAPTIVE_POLICY } from './paperAdaptiveSelection.js';
import { calculatePaperReturn } from './paperAccounting.js';
import { legacyStrategyLedger } from './paperStrategyFixtures.js';
import { advancePaperExitResearch, freezePaperExitPolicy, initializePaperExitResearch,
  PAPER_EXIT_PROFILES, selectPaperExitLearning } from './paperAdaptiveExit.js';
import { assertPaperAdaptiveExit } from './paperAdaptiveExitValidation.js';

const base = legacyStrategyLedger().trades[0];
function trade(date = '2026-09-18', symbol = '005930'): PaperStrategyTrade {
  const value = structuredClone(base), at = `${date}T01:00:00.000Z`;
  Object.assign(value, { id: `exit:${date}:${symbol}`, symbol, tradingDate: date, entryAt: at, entryPrice: 100,
    strategyVersion: 'adaptive-features-v1', entrySnapshotId: `entry:${at}` });
  value.policy = { ...value.policy, version: 'adaptive-features-v1', exitModel: 'ADAPTIVE_OBSERVED', horizonSelection: 'FORWARD_VALIDATED_FEATURE' };
  value.entryObservation = structuredClone(adaptiveTestSnapshot().observations[0]);
  Object.assign(value.entryObservation, { symbol, observedAt: at, price: 100 });
  value.entryObservation.features!.asOf = at;
  value.entryObservation.features!.technicalDate = previousKrxTradingDay(new Date(at));
  const stats = { sampleCount: 0, dateCount: 0, symbolCount: 0, meanNetReturnPct: null, meanDailyExcessPct: null };
  value.entryDecision = { ...value.entryDecision, snapshotId: value.entrySnapshotId, decisionAt: at, symbol,
    reasonCode: 'ADAPTIVE_EXPLORATION_SELECTED', tradeId: value.id, cohort: null, evidence: null,
    explorationEvidence: { cutoffAt: `${date}T00:00:00+09:00`, evaluatedAt: at, registeredAt: `${date}T00:30:00Z`,
      validationStartDate: null, trialId: 'test-trial', policy: { ...PAPER_ADAPTIVE_POLICY },
      candidate: { rule: { feature: 'rsi14', bucket: 0, horizon: 1 }, training: stats,
        validation: structuredClone(stats), active: false, reason: 'INSUFFICIENT_TRAINING' } } };
  value.exitPolicy = freezePaperExitPolicy(selectPaperExitLearning([], at), at);
  value.exitResearch = initializePaperExitResearch(value);
  return value;
}
function quote(value: PaperStrategyTrade, at: string, price: number): PaperSnapshot {
  const observation = structuredClone(value.entryObservation);
  Object.assign(observation, { observedAt: at, price });
  observation.features!.asOf = at;
  observation.features!.technicalDate = previousKrxTradingDay(new Date(at));
  return { id: `quote:${at}`, asOf: at, tradingDate: at.slice(0, 10), marketOpen: true, observations: [observation] };
}
function advance(value: PaperStrategyTrade, source: PaperSnapshot) {
  const result = advancePaperExitResearch(value, source, source.observations[0]);
  value.exitResearch = result.research;
  return result;
}
function complete(value: PaperStrategyTrade, price = 102) {
  const date = value.exitResearch!.watchUntilDate;
  const source = quote(value, `${date}T07:00:00.000Z`, price);
  source.marketOpen = false;
  source.observations[0].dailyCloses = [{ tradingDate: date, close: price, availableAt: source.asOf }];
  return advance(value, source);
}
function learnedTrades(): PaperStrategyTrade[] {
  return Array.from({ length: 30 }, (_, index) => {
    const date = addBusinessDaysFromKstDate('2026-07-01', index);
    return Array.from({ length: 4 }, (_, symbol) => {
      const value = trade(date, `00010${symbol}`);
      for (const [minute, price] of [[1, 110], [2, 108.8], [3, 108], [4, 105]]) {
        const result = advance(value, quote(value, `${date}T01:0${minute}:00.000Z`, price));
        if (result.trigger) value.status = 'CLOSED';
      }
      complete(value);
      return value;
    });
  }).flat();
}

describe('observed exit policies', () => {
  it('uses price-only peaks for trailing exits without consuming missing signal features', () => {
    const value = trade();
    value.exitResearch!.signalFailureCount = 3;
    value.exitResearch!.signalFailureStartedAt = value.entryAt;
    const peak = quote(value, '2026-09-18T01:30:00.000Z', 110);
    peak.quoteOnly = true; delete peak.observations[0].features;
    expect(advance(value, peak).trigger).toBeNull();
    expect(value.exitResearch!.signalFailureCount).toBe(3);
    const drop = quote(value, '2026-09-18T01:30:30.000Z', 108);
    drop.quoteOnly = true; delete drop.observations[0].features;
    expect(advance(value, drop).trigger?.reason).toBe('ADAPTIVE_TRAILING_STOP');
    const old = quote(value, '2026-09-18T01:30:15.000Z', 80); old.quoteOnly = true;
    expect(advance(value, old).quoteAccepted).toBe(false);
  });
  it('freezes explicit exploration defaults without inventing learned evidence', () => {
    const learning = selectPaperExitLearning([], '2026-09-18T01:00:00Z');
    const policy = freezePaperExitPolicy(learning, learning.evaluatedAt);
    expect(policy).toMatchObject({ origin: 'EXPLORATION_DEFAULT', evidence: null, profile: { id: 'BALANCED' } });
    policy.profile.stopLossPct = 100;
    expect(PAPER_EXIT_PROFILES[1].stopLossPct).toBe(5);
    expect(() => freezePaperExitPolicy(learning, '2026-09-17T01:00:00Z')).toThrow('future');
  });

  it('exits at a fresh same-day stop using entry-frozen costs without waiting for D1', () => {
    const value = trade();
    value.costModel = { version: 'cost', buyFeeRate: 0.001, sellFeeRate: 0.002, sellTaxRate: 0.003, slippageRate: 0.004 };
    value.exitResearch = initializePaperExitResearch(value);
    const source = quote(value, '2026-09-18T01:01:00.000Z', 96), before = structuredClone(value);
    const result = advancePaperExitResearch(value, source, source.observations[0]);
    expect(value).toEqual(before);
    expect(result.trigger).toMatchObject({ reason: 'ADAPTIVE_STOP_LOSS', price: 96,
      observedAt: source.asOf, effectiveAt: source.asOf, recordedAt: source.asOf,
      ...calculatePaperReturn(100, 96, value.costModel) });
    expect(result.research.outcomes.BALANCED).toEqual(result.trigger);
    expect(result.research.outcomes.PATIENT).toBeUndefined();
  });

  it('arms trailing exits only after observed net profit then freezes each first trigger', () => {
    const value = trade();
    expect(advance(value, quote(value, '2026-09-18T01:01:00Z', 101)).trigger).toBeNull();
    expect(advance(value, quote(value, '2026-09-18T01:02:00Z', 99)).trigger).toBeNull();
    expect(advance(value, quote(value, '2026-09-18T01:03:00Z', 104)).trigger).toBeNull();
    const result = advance(value, quote(value, '2026-09-18T01:04:00Z', 102));
    expect(result.trigger).toMatchObject({ reason: 'ADAPTIVE_TRAILING_STOP', peakNetReturnPct: 4, netReturnPct: 2 });
    const first = structuredClone(result.research.outcomes.BALANCED);
    value.status = 'CLOSED';
    advance(value, quote(value, '2026-09-18T01:05:00Z', 90));
    expect(value.exitResearch!.outcomes.BALANCED).toEqual(first);
    expect(value.exitResearch!.outcomes.PATIENT).toMatchObject({ reason: 'ADAPTIVE_STOP_LOSS', price: 90 });
  });

  it('rejects missing, stale, future, duplicate, reversed, off-hours or invalid quotes', () => {
    const value = trade();
    advance(value, quote(value, '2026-09-18T01:02:00Z', 101));
    const original = structuredClone(value.exitResearch);
    const invalid = Array.from({ length: 10 }, () => quote(value, '2026-09-18T01:10:00Z', 80));
    invalid[0].observations[0].price = null;
    invalid[1].observations[0].observedAt = '2026-09-18T01:03:00Z';
    invalid[2].observations[0].observedAt = '2026-09-18T01:11:00Z';
    invalid[3].observations[0].observedAt = '2026-09-18T01:02:00Z';
    invalid[4].asOf = '2026-09-18T01:01:00Z';
    invalid[5].marketOpen = false;
    invalid[6].observations[0].issue = 'CURRENT_QUOTE_STALE';
    invalid[7].observations[0].price = Number.NaN;
    invalid[8].observations[0].symbol = '000001';
    invalid[9] = quote(value, '2026-09-18T06:30:00Z', 80);
    for (const source of invalid) {
      const result = advancePaperExitResearch(value, source, source.observations[0]);
      expect(result).toEqual({ research: original, trigger: null, quoteAccepted: false });
    }
    expect(advancePaperExitResearch(value, invalid[0])).toEqual({ research: original, trigger: null, quoteAccepted: false });
  });

  it('counts distinct completed technical sessions instead of repeated cached indicators', () => {
    const value = trade();
    for (const at of ['2026-09-18T01:01:00Z', '2026-09-18T01:11:00Z', '2026-09-18T01:31:00Z']) {
      const source = quote(value, at, 100); source.observations[0].features!.values.rsi14 = 60;
      expect(advance(value, source).trigger).toBeNull();
    }
    expect(value.exitResearch!.signalFailureCount).toBe(1);
    for (const date of ['2026-09-21', '2026-09-22']) {
      const source = quote(value, `${date}T01:01:00Z`, 100); source.observations[0].features!.values.rsi14 = 60;
      const result = advance(value, source);
      expect(result.trigger?.reason ?? null).toBe(date === '2026-09-22' ? 'ADAPTIVE_SIGNAL_LOST' : null);
    }
    expect(value.exitResearch!.signalFailureCount).toBe(3);
  });

  it('does not treat missing or stale feature values as a failing entry signal', () => {
    const value = trade();
    const first = quote(value, '2026-09-18T01:01:00Z', 100); first.observations[0].features!.values.rsi14 = 60;
    advance(value, first);
    const missing = quote(value, '2026-09-18T01:02:00Z', 100); missing.observations[0].features!.values.rsi14 = null;
    expect(advance(value, missing).trigger).toBeNull();
    expect(value.exitResearch!.signalFailureCount).toBe(0);
    const stale = quote(value, '2026-09-21T01:01:00Z', 100);
    stale.observations[0].features!.values.rsi14 = 60; stale.observations[0].features!.technicalDate = '2026-09-10';
    expect(advance(value, stale).trigger).toBeNull();
    expect(value.exitResearch!.signalFailureCount).toBe(0);
  });

  it('requires elapsed time as well as distinct fresh quote-dependent signal failures', () => {
    const value = trade(); value.entryDecision.explorationEvidence!.candidate.rule.feature = 'pbr';
    for (const minute of [1, 5, 10, 21]) {
      const source = quote(value, `2026-09-18T01:${String(minute).padStart(2, '0')}:00Z`, 100);
      source.observations[0].features!.values.pbr = 2;
      const result = advance(value, source);
      expect(result.trigger?.reason ?? null).toBe(minute === 21 ? 'ADAPTIVE_SIGNAL_LOST' : null);
    }
  });

  it('measures sustained signal loss from when features became known, not the earlier quote time', () => {
    const value = trade(); value.entryDecision.explorationEvidence!.candidate.rule.feature = 'pbr';
    for (const minute of [5, 10, 20, 25]) {
      const source = quote(value, `2026-09-18T01:${String(minute).padStart(2, '0')}:00Z`, 100);
      if (minute === 5) source.observations[0].observedAt = '2026-09-18T01:01:00Z';
      source.observations[0].features!.values.pbr = 2;
      const result = advance(value, source);
      expect(result.research.signalFailureStartedAt).toBe('2026-09-18T01:05:00Z');
      expect(result.trigger?.reason ?? null).toBe(minute === 25 ? 'ADAPTIVE_SIGNAL_LOST' : null);
      expect(() => assertPaperAdaptiveExit(value, source.asOf)).not.toThrow();
    }
  });

  it('uses D5 solely for equal comparisons and keeps real exits responsive after D5', () => {
    const value = trade(), result = complete(value, 110);
    expect(result.trigger).toBeNull();
    expect(value.status).toBe('OPEN');
    expect(Object.values(result.research.outcomes)).toHaveLength(3);
    expect(Object.values(result.research.outcomes).every(item => item.reason === 'D5_BENCHMARK')).toBe(true);
    const frozen = structuredClone(result.research.outcomes);
    const nextDate = addBusinessDaysFromKstDate(result.research.watchUntilDate, 1);
    expect(advance(value, quote(value, `${nextDate}T01:01:00Z`, 108)).trigger).toBeNull();
    expect(advance(value, quote(value, `${nextDate}T01:02:00Z`, 106)).trigger).toMatchObject({ reason: 'ADAPTIVE_TRAILING_STOP', price: 106 });
    expect(value.exitResearch!.outcomes).toEqual(frozen);
  });

  it('continues research after actual exit and waits for a known D5 close without retroactive triggers', () => {
    const value = trade();
    const actual = advance(value, quote(value, '2026-09-18T01:01:00Z', 94));
    expect(actual.trigger?.reason).toBe('ADAPTIVE_STOP_LOSS'); value.status = 'CLOSED';
    expect(value.exitResearch!.outcomes.PATIENT).toBeUndefined();
    advance(value, quote(value, '2026-09-18T01:02:00Z', 92));
    expect(value.exitResearch!.outcomes.PATIENT).toMatchObject({ price: 92 });
    const pending = quote(value, `${value.exitResearch!.watchUntilDate}T07:00:00Z`, 200); pending.marketOpen = false;
    pending.observations[0].dailyCloses = [{ tradingDate: value.exitResearch!.watchUntilDate, close: 110, availableAt: '2026-12-31T07:00:00Z' }];
    expect(advance(value, pending).research.completedAt).toBeNull();
    complete(value, 110);
    expect(value.exitResearch!.baseline!.price).toBe(110);
    expect(value.exitResearch!.outcomes.BALANCED!.price).toBe(94);
    const prior = structuredClone(value.exitResearch);
    const nextDate = addBusinessDaysFromKstDate(value.exitResearch!.watchUntilDate, 1);
    expect(advance(value, quote(value, `${nextDate}T01:01:00Z`, 50)).research).toEqual(prior);
  });

  it('keeps later signal observations out of a delayed D5 comparison', () => {
    const value = trade(), d5 = value.exitResearch!.watchUntilDate;
    const next = addBusinessDaysFromKstDate(d5, 1);
    const source = quote(value, `${next}T01:01:00Z`, 105);
    source.observations[0].features!.values.rsi14 = 60;
    source.observations[0].dailyCloses = [{ tradingDate: d5, close: 110, availableAt: `${d5}T07:00:00Z` }];
    const result = advance(value, source);
    expect(result.research).toMatchObject({ peakNetReturnPct: 5, signalFailureCount: 1, signalFailureStartedAt: source.asOf });
    expect(result.research.baseline).toMatchObject({ netReturnPct: 10, peakNetReturnPct: 0,
      signalFailureCount: 0, signalFailureStartedAt: null, observedAt: `${d5}T07:00:00Z`, recordedAt: source.asOf });
    expect(result.trigger).toBeNull();
    expect(() => assertPaperAdaptiveExit(value, source.asOf)).not.toThrow();
  });
});

describe('exit learning from equal forward paths', () => {
  it('selects on training then verifies the same profile on purged later entry dates', () => {
    const values = learnedTrades(), before = structuredClone(values);
    const learning = selectPaperExitLearning(values, '2026-09-18T01:00:00Z');
    expect(values).toEqual(before);
    expect(learning).toMatchObject({ completedTradeCount: 120, completedDateCount: 30, reason: 'FORWARD_VALIDATED', selectedProfileId: 'RESPONSIVE' });
    const candidate = learning.candidates[0];
    expect(candidate.training.sampleCount).toBeLessThan(21 * 4);
    expect(candidate.training.sampleCount).toBeGreaterThanOrEqual(10);
    expect(candidate.validation).toMatchObject({ sampleCount: 36, dateCount: 9 });
    for (const item of learning.candidates) {
      expect(item.training.tradeIdsDigest).toBe(candidate.training.tradeIdsDigest);
      expect(item.validation.tradeIdsDigest).toBe(candidate.validation.tradeIdsDigest);
    }
    const policy = freezePaperExitPolicy(learning, learning.evaluatedAt);
    expect(policy).toMatchObject({ origin: 'FORWARD_LEARNED', profile: { id: 'RESPONSIVE' }, evidence: { validationStartDate: learning.validationStartDate } });
    learning.candidates[0].training.sampleCount = 0;
    expect(policy.evidence!.training.sampleCount).toBeGreaterThanOrEqual(10);
  });

  it('does not learn from merely profitable exits when later performance loses to the baseline', () => {
    const values = learnedTrades(), initial = selectPaperExitLearning(values, '2026-09-18T01:00:00Z');
    for (const value of values) if (value.tradingDate >= initial.validationStartDate!) {
      const baseline = value.exitResearch!.baseline!;
      Object.assign(baseline, { price: 112, ...calculatePaperReturn(100, 112, value.costModel) });
    }
    const learning = selectPaperExitLearning(values, '2026-09-18T01:00:00Z');
    expect(learning).toMatchObject({ selectedProfileId: null, reason: 'NO_VALIDATION_EDGE' });
    expect(freezePaperExitPolicy(learning, learning.evaluatedAt).origin).toBe('EXPLORATION_DEFAULT');
  });

  it('excludes unbalanced, future, duplicate and same-day newly completed trade evidence', () => {
    const values = learnedTrades(), at = '2026-09-18T01:00:00Z';
    delete values[0].exitResearch!.outcomes.PATIENT;
    values[1].exitResearch!.baseline!.recordedAt = '2026-12-31T01:00:00Z';
    values[2].exitResearch!.completedAt = at;
    const learning = selectPaperExitLearning([...values, ...values], at);
    expect(learning.completedTradeCount).toBe(117);
    expect(selectPaperExitLearning([], at).reason).toBe('INSUFFICIENT_TRAINING');
  });

  it('purges by the latest known outcome time and rejects cost-inconsistent return evidence', () => {
    const values = learnedTrades(), at = '2026-09-18T01:00:00Z';
    const original = selectPaperExitLearning(values, at);
    values[0].exitResearch!.outcomes.RESPONSIVE!.recordedAt = `${original.validationStartDate}T01:00:00Z`;
    values[1].exitResearch!.outcomes.RESPONSIVE!.netReturnPct = 100;
    const learning = selectPaperExitLearning(values, at);
    expect(learning.completedTradeCount).toBe(original.completedTradeCount - 1);
    expect(learning.candidates[0].training.sampleCount).toBe(original.candidates[0].training.sampleCount - 2);
    expect(learning.candidates[0].validation.sampleCount).toBe(original.candidates[0].validation.sampleCount);
  });
});
