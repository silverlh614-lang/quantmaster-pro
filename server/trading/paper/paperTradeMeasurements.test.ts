// @responsibility Verify prospective Shadow trade measurement boundaries.
import { describe, expect, it } from 'vitest';
import type { PaperSnapshot } from '../../../src/types/paperExperiment.js';
import type { PaperStrategyLedger } from '../../../src/types/paperStrategy.js';
import { createPaperIndicatorFormula, paperIndicatorFormulaId } from '../../../src/types/paperIndicatorFormula.js';
import { adaptiveTestSnapshot, matureAdaptiveSamples } from './paperAdaptiveFixtures.js';
import { selectPaperAdaptiveState } from './paperAdaptiveSelection.js';
import { calculatePaperReturn } from './paperAccounting.js';
import { emptyStrategyLedger, legacyStrategyLedger, strategyTestCost } from './paperStrategyFixtures.js';
import { evaluatePaperStrategyScan } from './paperStrategyPolicy.js';
import { capturePaperTradeMeasurements } from './paperTradeMeasurements.js';

const cost = { version: 'frozen-cost', buyFeeRate: 0.001, sellFeeRate: 0.002, sellTaxRate: 0.003, slippageRate: 0.004 };
function snapshot(at = '2026-09-18T01:00:00Z', price = 10000): PaperSnapshot {
  const value = adaptiveTestSnapshot();
  value.id = `measurement-${at}`; value.asOf = at; value.tradingDate = at.slice(0, 10);
  value.observations[0].observedAt = at; value.observations[0].price = price; value.observations[0].features!.asOf = at;
  return value;
}
function entry() {
  const source = snapshot();
  const adaptive = selectPaperAdaptiveState(undefined, matureAdaptiveSamples(), source.asOf);
  const ledger = evaluatePaperStrategyScan(emptyStrategyLedger(), source, () => cost, adaptive);
  for (const trade of ledger.trades) {
    trade.policy.exitModel = 'SCHEDULED_CLOSE'; delete trade.exitPolicy; delete trade.exitResearch;
  }
  return { source, ledger };
}
function scan(ledger: PaperStrategyLedger, source: PaperSnapshot) {
  return evaluatePaperStrategyScan(ledger, source, strategyTestCost, ledger.adaptive ?? selectPaperAdaptiveState(undefined, [], source.asOf));
}

describe('observed Shadow trade paths', () => {
  it('starts a new trade at the actual entry with frozen round-trip costs, leaving core evidence intact', () => {
    const { source, ledger } = entry(), before = structuredClone(ledger);
    const rows = capturePaperTradeMeasurements(ledger, source), trade = ledger.trades[0];
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ tradeId: trade.id, entrySnapshotId: source.id, kind: 'ENTRY', effectiveAt: trade.entryAt,
      observedAt: trade.entryObservation.observedAt, recordedAt: source.asOf, price: 10000, netPnl: -140,
      action: 'BUY', reasonCode: 'ADAPTIVE_FEATURE_SELECTED', ruleValue: 20, ruleMatches: true, ruleConnected: true, featureAsOf: source.asOf });
    expect(rows[0].netReturnPct).toBeCloseTo(-1.4);
    expect(trade.measurement).toMatchObject({ version: 'observed-trade-path-v1', startedAt: source.asOf, fromEntry: true, pointCount: 1 });
    expect(trade.measurement!.highest).toEqual(trade.measurement!.lowest);
    expect(trade.measurement!.latest).not.toHaveProperty('grossReturnPct');
    const withoutMeasurement = structuredClone(ledger); delete withoutMeasurement.trades[0].measurement;
    expect(withoutMeasurement).toEqual(before);
    rows[0].price = 1;
    expect(trade.measurement!.latest.price).toBe(10000);
  });

  it('replaces summaries without mutating old references and keeps the first point for tied extrema', () => {
    let { ledger } = entry();
    capturePaperTradeMeasurements(ledger, snapshot());
    const high = snapshot('2026-09-18T01:01:00Z', 11000);
    ledger = scan(ledger, high);
    const previous = ledger.trades[0].measurement!, original = structuredClone(previous);
    capturePaperTradeMeasurements(ledger, high);
    expect(previous).toEqual(original);
    expect(ledger.trades[0].measurement).not.toBe(previous);
    for (const at of ['2026-09-18T01:02:00Z', '2026-09-18T01:03:00Z']) {
      const low = snapshot(at, 9000); ledger = scan(ledger, low); capturePaperTradeMeasurements(ledger, low);
    }
    expect(ledger.trades[0].measurement).toMatchObject({ pointCount: 4,
      latest: { recordedAt: '2026-09-18T01:03:00Z', price: 9000 },
      highest: { recordedAt: high.asOf, price: 11000 }, lowest: { recordedAt: '2026-09-18T01:02:00Z', price: 9000 } });
  });

  it('starts existing trades only from the first valid observed quote without backfilling an entry', () => {
    const old = legacyStrategyLedger(), source = snapshot('2026-09-21T01:00:00Z', 11000);
    const ledger = scan(old, source), before = structuredClone(ledger.trades[0]);
    const rows = capturePaperTradeMeasurements(ledger, source);
    expect(rows).toHaveLength(1);
    expect(ledger.trades[0].measurement).toMatchObject({ startedAt: source.asOf, fromEntry: false, pointCount: 1,
      highest: { kind: 'QUOTE', price: 11000 }, lowest: { kind: 'QUOTE', price: 11000 } });
    expect(rows[0]).toMatchObject({ ruleValue: null, ruleMatches: null, ruleConnected: null, featureAsOf: null });
    expect(ledger.trades[0].entryObservation).toEqual(before.entryObservation);
    expect(ledger.trades[0].entryDecision).toEqual(before.entryDecision);
  });

  it('does not count repeated, out-of-order, or future observations as new price points', () => {
    let { ledger } = entry(); capturePaperTradeMeasurements(ledger, snapshot());
    const fresh = snapshot('2026-09-18T01:02:00Z', 10500);
    ledger = scan(ledger, fresh); capturePaperTradeMeasurements(ledger, fresh);
    const original = structuredClone(ledger.trades[0].measurement);
    expect(capturePaperTradeMeasurements(ledger, fresh)).toEqual([]);
    for (const observedAt of ['2026-09-18T01:01:00Z', fresh.asOf, '2026-09-18T03:00:00Z']) {
      const source = snapshot('2026-09-18T02:00:00Z', 50000); source.observations[0].observedAt = observedAt;
      const next = scan(ledger, source);
      expect(capturePaperTradeMeasurements(next, source)).toEqual([]);
      expect(next.trades[0].measurement).toEqual(original);
    }
  });

  it('ignores closed markets, invalid prices, provider errors, mismatched dates, and prices after the planned exit', () => {
    const { ledger } = entry();
    const invalid = [snapshot('2026-09-18T01:01:00Z'), snapshot('2026-09-18T01:01:00Z'), snapshot('2026-09-18T01:01:00Z'),
      snapshot('2026-09-18T01:01:00Z'), snapshot('2026-09-19T01:00:00Z'), snapshot('2026-09-21T00:00:00Z'),
      snapshot('2026-09-21T06:30:00Z'), snapshot('2026-09-24T01:00:00Z')];
    invalid[0].marketOpen = false;
    invalid[1].observations[0].price = Number.NaN;
    invalid[2].observations[0].issue = 'quote unavailable';
    invalid[3].observations[0].observedAt = '2026-09-17T01:00:00Z';
    // The pre-open boundary is 09:00 KST; move this snapshot just before it.
    invalid[5].asOf = '2026-09-20T23:59:00Z'; invalid[5].observations[0].observedAt = invalid[5].asOf;
    for (const source of invalid) {
      const next = scan(ledger, source);
      expect(capturePaperTradeMeasurements(next, source)).toEqual([]);
      expect(next.trades[0].measurement).toBeUndefined();
    }
  });

  it('measures the entry-frozen rule after selection changes rather than substituting the new rule', () => {
    const { ledger: opened } = entry(), source = snapshot('2026-09-18T01:01:00Z');
    const ledger = scan(opened, source);
    const current = ledger.adaptive!.candidates.find(item => item.active)!;
    current.rule.bucket = 2;
    const rows = capturePaperTradeMeasurements(ledger, source);
    expect(rows[0]).toMatchObject({ ruleValue: 20, ruleMatches: true, ruleConnected: false });
    expect(ledger.trades[0].entryDecision.adaptiveEvidence!.candidate.rule.bucket).toBe(0);
  });

  it('recognizes a frozen invention separately from a later invention using the same formula ID', () => {
    const { ledger: opened } = entry(), source = snapshot('2026-09-18T01:01:00Z');
    const formula = createPaperIndicatorFormula('DIFFERENCE', 'adx14', 'currentRatio');
    const frozen = opened.trades[0].entryDecision.adaptiveEvidence!.candidate;
    frozen.rule = { feature: paperIndicatorFormulaId(formula), bucket: 0, horizon: 3,
      invention: { id: paperIndicatorFormulaId(formula), formula, createdAt: '2026-09-17T01:00:00Z',
        discoveryCutoffAt: '2026-09-16T15:00:00Z', rule: { bucket: 0, horizon: 3 }, training: structuredClone(frozen.training) } };
    opened.adaptive!.candidates = [structuredClone(frozen)];
    Object.assign(source.observations[0].features!.values, { adx14: 15, currentRatio: 250 });
    const connected = scan(opened, source);
    expect(capturePaperTradeMeasurements(connected, source)[0]).toMatchObject({ ruleValue: -1.5, ruleMatches: true, ruleConnected: true });
    const replacement = scan(opened, source);
    replacement.adaptive!.candidates[0].rule.invention!.createdAt = '2026-09-18T01:00:00Z';
    expect(capturePaperTradeMeasurements(replacement, source)[0]).toMatchObject({ ruleValue: -1.5, ruleMatches: true, ruleConnected: false });
  });

  it('keeps valid price measurements when feature values are missing or dated after the snapshot', () => {
    const { ledger: opened } = entry();
    for (const mode of ['future', 'missing-value', 'missing-features', 'previous-day'] as const) {
      const source = snapshot('2026-09-18T01:01:00Z');
      if (mode === 'future') source.observations[0].features!.asOf = '2026-09-18T01:02:00Z';
      if (mode === 'missing-value') source.observations[0].features!.values.rsi14 = null;
      if (mode === 'missing-features') delete source.observations[0].features;
      if (mode === 'previous-day') source.observations[0].features!.asOf = '2026-09-17T01:00:00Z';
      const ledger = scan(opened, source), rows = capturePaperTradeMeasurements(ledger, source);
      expect(rows).toHaveLength(1);
      expect(rows[0]).toMatchObject({ ruleValue: null, ruleMatches: null, ruleConnected: true,
        featureAsOf: mode === 'missing-value' ? source.asOf : null });
    }
  });

  it('records delayed scheduled closes at their effective time without using today’s quote or features', () => {
    const { ledger: opened } = entry(); capturePaperTradeMeasurements(opened, snapshot());
    const source = snapshot('2026-09-24T01:00:00Z', 50000);
    source.observations[0].features!.values.rsi14 = 99;
    source.observations[0].dailyCloses = [{ tradingDate: '2026-09-23', close: 10500, availableAt: '2026-09-24T00:30:00Z' }];
    const ledger = scan(opened, source), exitBefore = structuredClone(ledger.trades[0].exit);
    const rows = capturePaperTradeMeasurements(ledger, source), trade = ledger.trades[0];
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ kind: 'SCHEDULED_CLOSE', action: 'EXIT', reasonCode: 'SCHEDULED_CLOSE_REACHED',
      effectiveAt: trade.scheduledExitAt, observedAt: '2026-09-24T00:30:00Z', recordedAt: source.asOf,
      price: 10500, source: 'SCHEDULED_CLOSE_CONFIRMED', ruleValue: null, ruleMatches: null, ruleConnected: null, featureAsOf: null });
    expect(rows[0].netReturnPct).toBe(calculatePaperReturn(trade.entryPrice, 10500, cost).netReturnPct);
    expect(trade.measurement).toMatchObject({ fromEntry: true, pointCount: 2, highest: { price: 10500 } });
    expect(trade.exit).toEqual(exitBefore);
    expect(capturePaperTradeMeasurements(ledger, source)).toEqual([]);
    const later = snapshot('2026-09-24T02:00:00Z', 80000), final = scan(ledger, later);
    expect(capturePaperTradeMeasurements(final, later)).toEqual([]);
    expect(final.trades[0].measurement).toEqual(trade.measurement);
  });

  it('can start partial measurement at a newly confirmed close while leaving already closed trades untouched', () => {
    const { ledger: opened } = entry(), source = snapshot('2026-09-24T01:00:00Z');
    source.observations[0].dailyCloses = [{ tradingDate: '2026-09-23', close: 11000, availableAt: source.asOf }];
    const ledger = scan(opened, source);
    expect(capturePaperTradeMeasurements(ledger, source)).toHaveLength(1);
    expect(ledger.trades[0].measurement).toMatchObject({ fromEntry: false, startedAt: source.asOf, pointCount: 1,
      lowest: { price: 11000 }, highest: { price: 11000 } });
    delete ledger.trades[0].measurement;
    const later = snapshot('2026-09-24T02:00:00Z', 50000), oldClosed = scan(ledger, later);
    expect(capturePaperTradeMeasurements(oldClosed, later)).toEqual([]);
    expect(oldClosed.trades[0].measurement).toBeUndefined();
  });
});
