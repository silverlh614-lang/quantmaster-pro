// @responsibility Verify empirical strategy lifecycle.
import { describe, expect, it } from 'vitest';
import { buildPaperStrategyView, evaluatePaperStrategyScan } from './paperStrategyPolicy.js';
import { emptyStrategyLedger, matureStrategySamples, strategyTestCost, strategyTestSnapshot } from './paperStrategyFixtures.js';
import { assertPaperStrategyLedger } from './paperStrategyValidation.js';

const enter = () => evaluatePaperStrategyScan(emptyStrategyLedger(), matureStrategySamples(), strategyTestSnapshot(), strategyTestCost);

describe('paper strategy lifecycle', () => {
  it('buys one share with frozen evidence and a precommitted D3 scheduled close', () => {
    const result = enter();
    expect(result.lastRun).toMatchObject({ openedCount: 1, closedCount: 0 });
    expect(result.trades[0]).toMatchObject({ status: 'OPEN', quantity: 1, horizon: 3, scheduledExitDate: '2026-09-23',
      entryDecision: { action: 'BUY', reasonCode: 'POSITIVE_COHORT_EXPECTANCY', evidence: { sampleCount: 12 } } });
    expect(() => assertPaperStrategyLedger(result)).not.toThrow();
  });

  it('waits for sufficient mature samples and multiple entry dates', () => {
    const snapshot = strategyTestSnapshot();
    let samples = matureStrategySamples().slice(0, 9);
    let result = evaluatePaperStrategyScan(emptyStrategyLedger(), samples, snapshot, strategyTestCost);
    expect(result.latestDecisions[0].reasonCode).toBe('INSUFFICIENT_MATURE_SAMPLES');
    samples = matureStrategySamples().slice(0, 4);
    samples = Array.from({ length: 12 }, (_, index) => {
      const item = structuredClone(samples[index % 4]);
      item.id = `one-day-${index}`; item.symbol = `0001${String(index).padStart(2, '0')}`;
      item.entryObservation.symbol = item.symbol;
      return item;
    });
    result = evaluatePaperStrategyScan(emptyStrategyLedger(), samples, snapshot, strategyTestCost);
    expect(result.latestDecisions[0].reasonCode).toBe('INSUFFICIENT_ENTRY_DATES');
  });

  it('waits for non-positive net expectancy even with sufficient evidence', () => {
    const result = evaluatePaperStrategyScan(emptyStrategyLedger(), matureStrategySamples([-1, -2, -3]), strategyTestSnapshot(), strategyTestCost);
    expect(result.trades).toEqual([]);
    expect(result.latestDecisions[0].reasonCode).toBe('NON_POSITIVE_EXPECTANCY');
  });

  it.each(['unknown', 'price', 'issue', 'future', 'stale', 'closed'] as const)('waits on %s without turning it into a sell', (problem) => {
    const snapshot = strategyTestSnapshot();
    if (problem === 'unknown') snapshot.observations[0].aboveMa20 = null;
    if (problem === 'price') snapshot.observations[0].price = null;
    if (problem === 'issue') snapshot.observations[0].issue = 'CURRENT_QUOTE_UNAVAILABLE';
    if (problem === 'future') snapshot.observations[0].observedAt = '2026-09-18T02:00:00Z';
    if (problem === 'stale') snapshot.observations[0].observedAt = '2026-09-17T01:00:00Z';
    if (problem === 'closed') snapshot.marketOpen = false;
    const result = evaluatePaperStrategyScan(emptyStrategyLedger(), matureStrategySamples(), snapshot, strategyTestCost);
    expect(result.trades).toHaveLength(0);
    expect(result.latestDecisions[0].action).toBe('WAIT');
  });

  it('preserves one open trade across repeated scans and restart', () => {
    const result = enter();
    const next = evaluatePaperStrategyScan(JSON.parse(JSON.stringify(result)), matureStrategySamples(), strategyTestSnapshot(), strategyTestCost);
    expect(next.trades).toHaveLength(1);
    expect(next.latestDecisions[0].action).toBe('HOLD');
    expect(next.lastRun!.openedCount).toBe(0);
    expect(next.trades[0]).toEqual(result.trades[0]);
  });

  it('does not change committed horizon when new evidence turns negative', () => {
    const ledger = enter();
    const snapshot = strategyTestSnapshot();
    snapshot.observations[0].aboveMa20 = false;
    const result = evaluatePaperStrategyScan(ledger, matureStrategySamples([-10, -20, -30]), snapshot, strategyTestCost);
    expect(result.trades[0]).toEqual(ledger.trades[0]);
    expect(result.latestDecisions[0].reasonCode).toBe('HORIZON_PENDING');
  });

  it('closes at the precommitted exact close with own price/costs and separate observation time', () => {
    const cost = { ...strategyTestCost(), buyFeeRate: 0.01, sellFeeRate: 0.01, sellTaxRate: 0.02, slippageRate: 0.01 };
    const ledger = evaluatePaperStrategyScan(emptyStrategyLedger(), matureStrategySamples(), strategyTestSnapshot(), () => cost);
    cost.buyFeeRate = 1;
    const snapshot = strategyTestSnapshot();
    snapshot.asOf = '2026-09-28T01:00:00Z'; snapshot.tradingDate = '2026-09-28';
    snapshot.observations[0].price = 50000;
    snapshot.observations[0].dailyCloses = [{ tradingDate: '2026-09-23', close: 11000, availableAt: snapshot.asOf }];
    const result = evaluatePaperStrategyScan(ledger, [], snapshot, strategyTestCost);
    expect(result.trades[0].exit).toMatchObject({ model: 'SCHEDULED_CLOSE', price: 11000, netPnl: 360,
      effectiveAt: '2026-09-23T06:30:00.000Z', observedAt: '2026-09-28T01:00:00Z', decisionAt: snapshot.asOf });
    expect(result.trades[0].exit!.netReturnPct).toBeCloseTo(3.6);
    expect(result.latestDecisions[0].action).toBe('EXIT');
    expect(ledger.trades[0].status).toBe('OPEN');
    expect(() => assertPaperStrategyLedger(result)).not.toThrow();
    expect(buildPaperStrategyView(result).performance).toMatchObject({ closedCount: 1, totalNetPnl: 360 });
  });

  it.each(['missing', 'next-date', 'future', 'intraday', 'absent-symbol'] as const)('holds an overdue trade with %s close data', (problem) => {
    const snapshot = strategyTestSnapshot();
    snapshot.asOf = '2026-09-28T01:00:00Z'; snapshot.tradingDate = '2026-09-28';
    if (problem !== 'missing') snapshot.observations[0].dailyCloses = [{ tradingDate: '2026-09-23', close: 11000, availableAt: snapshot.asOf }];
    if (problem === 'next-date') snapshot.observations[0].dailyCloses[0].tradingDate = '2026-09-28';
    if (problem === 'future') snapshot.observations[0].dailyCloses[0].availableAt = '2026-09-28T02:00:00Z';
    if (problem === 'intraday') snapshot.observations[0].dailyCloses[0].availableAt = '2026-09-23T06:00:00Z';
    if (problem === 'absent-symbol') snapshot.observations = [];
    const result = evaluatePaperStrategyScan(enter(), [], snapshot, strategyTestCost);
    expect(result.latestDecisions[0]).toMatchObject({ action: 'HOLD', reasonCode: 'SCHEDULED_CLOSE_UNAVAILABLE' });
    expect(result.trades[0].exit).toBeNull();
  });

  it('keeps unavailable strategy performance null and never mixes baseline returns into it', () => {
    expect(buildPaperStrategyView(enter()).performance).toEqual({ closedCount: 0, meanNetReturnPct: null, winRatePct: null, totalNetPnl: null });
  });

  it('aggregates all realized trades before truncating the recent display', () => {
    const snapshot = strategyTestSnapshot();
    snapshot.asOf = '2026-09-23T07:00:00Z'; snapshot.tradingDate = '2026-09-23'; snapshot.marketOpen = false;
    snapshot.observations[0].dailyCloses = [{ tradingDate: '2026-09-23', close: 11000, availableAt: snapshot.asOf }];
    const ledger = evaluatePaperStrategyScan(enter(), [], snapshot, strategyTestCost);
    ledger.trades = Array.from({ length: 205 }, (_, index) => ({ ...structuredClone(ledger.trades[0]), id: `display-test-${index}` }));
    const view = buildPaperStrategyView(ledger);
    expect(view.trades).toHaveLength(200);
    expect(view.totalCount).toBe(205);
    expect(view.performance).toEqual({ closedCount: 205, meanNetReturnPct: 10, winRatePct: 100, totalNetPnl: 205000 });
  });
});
