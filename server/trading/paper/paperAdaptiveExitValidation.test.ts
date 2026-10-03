// @responsibility Verify persisted adaptive exits preserve observed research evidence.
import { describe, expect, it } from 'vitest';
import type { PaperSnapshot } from '../../../src/types/paperExperiment.js';
import type { PaperStrategyLedger, PaperStrategyTrade } from '../../../src/types/paperStrategy.js';
import { adaptiveTestSnapshot, matureAdaptiveSamples } from './paperAdaptiveFixtures.js';
import { selectPaperAdaptiveState } from './paperAdaptiveSelection.js';
import { emptyStrategyLedger, strategyTestCost } from './paperStrategyFixtures.js';
import { evaluatePaperStrategyScan } from './paperStrategyPolicy.js';
import { assertPaperStrategyLedger } from './paperStrategyValidation.js';
import { capturePaperTradeMeasurements } from './paperTradeMeasurements.js';
import { assertPaperTradeMeasurementRows } from './paperTradeMeasurementValidation.js';

function snapshot(at = '2026-09-18T01:00:00Z', price = 10000): PaperSnapshot {
  const value = adaptiveTestSnapshot();
  value.id = `adaptive-exit-${at}`; value.asOf = at; value.tradingDate = at.slice(0, 10);
  value.observations[0].observedAt = at; value.observations[0].price = price; value.observations[0].features!.asOf = at;
  return value;
}
function opened(): PaperStrategyLedger {
  const source = snapshot(), adaptive = selectPaperAdaptiveState(undefined, matureAdaptiveSamples(), source.asOf);
  const ledger = evaluatePaperStrategyScan(emptyStrategyLedger(), source, strategyTestCost, adaptive);
  capturePaperTradeMeasurements(ledger, source);
  return ledger;
}
function scan(ledger: PaperStrategyLedger, source: PaperSnapshot): PaperStrategyLedger {
  const adaptive = selectPaperAdaptiveState(undefined, [], source.asOf);
  const next = evaluatePaperStrategyScan(ledger, source, strategyTestCost, adaptive);
  const rows = capturePaperTradeMeasurements(next, source);
  expect(() => assertPaperTradeMeasurementRows(rows, next.trades)).not.toThrow();
  expect(() => assertPaperStrategyLedger(JSON.parse(JSON.stringify(next)))).not.toThrow();
  return next;
}
function stopped(): PaperStrategyLedger { return scan(opened(), snapshot('2026-09-18T01:01:00Z', 9400)); }

describe('adaptive exit persistence integrity', () => {
  it('freezes an actual quote exit with entry evidence, costs, policy and terminal measurement', () => {
    const before = opened(), ledger = scan(before, snapshot('2026-09-18T01:01:00Z', 9400));
    const trade = ledger.trades[0];
    expect(trade.exit).toMatchObject({ model: 'ADAPTIVE_OBSERVED', price: 9400, effectiveAt: '2026-09-18T01:01:00Z',
      observedAt: '2026-09-18T01:01:00Z', observedTrigger: { reason: 'ADAPTIVE_STOP_LOSS' },
      observedQuote: { price: 9400, ruleValue: 20, ruleMatches: true } });
    expect(trade.exit!.decision.adaptiveEvidence).toEqual(before.trades[0].entryDecision.adaptiveEvidence);
    expect(trade.exitPolicy).toEqual(before.trades[0].exitPolicy);
    expect(trade.measurement!.latest).toMatchObject({ kind: 'ADAPTIVE_EXIT', reasonCode: 'ADAPTIVE_STOP_LOSS', price: 9400 });
    expect(trade.measurement!.pointCount).toBe(2);
    expect(capturePaperTradeMeasurements(ledger, snapshot('2026-09-18T01:01:00Z', 9400))).toEqual([]);
  });

  it('keeps D1/D3/D5 research separate from forced exit, then validates a later actual trigger', () => {
    let ledger = opened();
    const after = snapshot('2026-09-30T01:00:00Z');
    const benchmark = ledger.trades[0].exitResearch!;
    after.observations[0].dailyCloses = [{ tradingDate: benchmark.watchUntilDate, close: 10000, availableAt: `${benchmark.watchUntilDate}T06:31:00Z` }];
    ledger = scan(ledger, after);
    expect(ledger.trades[0].status).toBe('OPEN');
    expect(ledger.trades[0].exitResearch!.outcomes.BALANCED!.reason).toBe('D5_BENCHMARK');
    expect(ledger.trades[0].measurement!.latest.kind).toBe('QUOTE');
    expect(Date.parse(ledger.trades[0].measurement!.latest.effectiveAt)).toBeGreaterThan(Date.parse(benchmark.watchUntilAt));
    ledger = scan(ledger, snapshot('2026-09-30T01:01:00Z', 9400));
    expect(ledger.trades[0].exit!.observedTrigger!.reason).toBe('ADAPTIVE_STOP_LOSS');
    expect(ledger.trades[0].exitResearch!.outcomes.BALANCED!.reason).toBe('D5_BENCHMARK');
  });

  it('preserves the original exit while later research changes price peaks and signal counters', () => {
    const ledger = stopped(), frozenExit = structuredClone(ledger.trades[0].exit), frozenMeasurement = structuredClone(ledger.trades[0].measurement);
    const later = scan(ledger, snapshot('2026-09-18T01:02:00Z', 12000));
    expect(later.trades[0].exitResearch!.peakNetReturnPct).toBe(20);
    expect(later.trades[0].exit).toEqual(frozenExit);
    expect(later.trades[0].measurement).toEqual(frozenMeasurement);
  });

  it('accepts a genuine trailing trigger from two distinct observed quotes', () => {
    const high = scan(opened(), snapshot('2026-09-18T01:01:00Z', 10400));
    const trailing = scan(high, snapshot('2026-09-18T01:02:00Z', 10200));
    expect(trailing.trades[0].exit!.decision.reasonCode).toBe('ADAPTIVE_TRAILING_STOP');
    expect(trailing.trades[0].exit!.observedTrigger).toMatchObject({ peakNetReturnPct: 4, netReturnPct: 2 });
  });

  it('requires a fresh distinct quote before recording a hold or an observed exit', () => {
    let ledger = opened();
    for (const observedAt of ['2026-09-18T01:00:00Z', '2026-09-18T01:00:59Z', '2026-09-18T01:07:00Z']) {
      const source = snapshot('2026-09-18T01:06:00Z', 9000); source.observations[0].observedAt = observedAt;
      const unchanged = scan(ledger, source);
      expect(unchanged.trades[0].status).toBe('OPEN');
      expect(unchanged.trades[0].measurement!.pointCount).toBe(1);
      expect(unchanged.latestDecisions[0].reasonCode).toBe('ADAPTIVE_EXIT_QUOTE_UNAVAILABLE');
    }
    const boundary = snapshot('2026-09-18T01:06:00Z'); boundary.observations[0].observedAt = '2026-09-18T01:01:00Z';
    ledger = scan(ledger, boundary);
    expect(ledger.trades[0].measurement!.pointCount).toBe(2);
    const repeated = snapshot('2026-09-18T01:06:01Z'); repeated.observations[0].observedAt = '2026-09-18T01:01:00Z';
    expect(scan(ledger, repeated).trades[0].measurement!.pointCount).toBe(2);
  });

  const corrupt: Array<[string, (trade: PaperStrategyTrade) => void]> = [
    ['missing frozen policy', trade => { delete trade.exitPolicy; }],
    ['missing research', trade => { delete trade.exitResearch; }],
    ['mutated profile', trade => { trade.exitPolicy!.profile.stopLossPct = 99; }],
    ['future selected policy', trade => { trade.exitPolicy!.selectedAt = '2026-09-18T01:02:00Z'; }],
    ['unproven learned policy', trade => { trade.exitPolicy!.origin = 'FORWARD_LEARNED'; }],
    ['research before entry', trade => { trade.exitResearch!.startedAt = '2026-09-17T01:00:00Z'; }],
    ['future research', trade => { trade.exitResearch!.lastRecordedAt = '2026-09-18T01:02:00Z'; }],
    ['empty observed count', trade => { trade.exitResearch!.quoteCount = 0; }],
    ['unknown profile outcome', trade => { Object.assign(trade.exitResearch!.outcomes, { CUSTOM: trade.exit!.observedTrigger }); }],
    ['invented outcome costs', trade => { trade.exitResearch!.outcomes.BALANCED!.netPnl += 1; }],
    ['wrong actual trigger priority', trade => { trade.exit!.observedTrigger!.reason = 'ADAPTIVE_TRAILING_STOP'; }],
    ['D5 outcome as real exit', trade => { trade.exit!.observedTrigger!.reason = 'D5_BENCHMARK'; }],
    ['missing original quote', trade => { delete trade.exit!.observedQuote; }],
    ['quote price differs', trade => { trade.exit!.observedQuote!.price += 1; }],
    ['future feature', trade => { trade.exit!.observedQuote!.featureAsOf = '2026-09-18T01:02:00Z'; }],
    ['missing original trigger', trade => { delete trade.exit!.observedTrigger; }],
    ['forged net result', trade => { trade.exit!.observedTrigger!.netReturnPct += 1; }],
    ['changed entry evidence', trade => { trade.exit!.decision.adaptiveEvidence!.candidate.rule.bucket = 1; }],
    ['changed recorded quote source', trade => { trade.measurement!.latest.source = 'rewritten'; }],
    ['changed recorded rule', trade => { trade.measurement!.latest.ruleValue = 21; }],
    ['adaptive exit as scheduled measurement', trade => { trade.measurement!.latest.kind = 'SCHEDULED_CLOSE'; }],
  ];
  it.each(corrupt)('rejects %s', (_, change) => {
    const ledger = stopped(); change(ledger.trades[0]);
    expect(() => assertPaperStrategyLedger(ledger)).toThrow('INVALID');
  });

  it('rejects invalid learned statistics or profile selection without rewriting historical trades', () => {
    const ledger = opened();
    ledger.exitLearning!.selectedProfileId = 'BALANCED';
    expect(() => assertPaperStrategyLedger(ledger)).toThrow('INVALID');
    const other = opened(); other.exitLearning!.candidates[0].training.meanNetReturnPct = 1;
    expect(() => assertPaperStrategyLedger(other)).toThrow('INVALID');
  });
});
