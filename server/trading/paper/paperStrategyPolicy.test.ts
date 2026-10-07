// @responsibility Verify empirical strategy lifecycle.
import { describe, expect, it } from 'vitest';
import { buildPaperStrategyView, evaluatePaperStrategyScan } from './paperStrategyPolicy.js';
import { emptyStrategyLedger, legacyStrategyLedger, strategyTestCost, strategyTestSnapshot } from './paperStrategyFixtures.js';
import { adaptiveTestSnapshot, matureAdaptiveSamples } from './paperAdaptiveFixtures.js';
import { selectPaperAdaptiveState } from './paperAdaptiveSelection.js';
import { assertPaperStrategyLedger } from './paperStrategyValidation.js';

const state = () => selectPaperAdaptiveState(undefined, matureAdaptiveSamples(), adaptiveTestSnapshot().asOf);
const inactive = () => selectPaperAdaptiveState(undefined, [], adaptiveTestSnapshot().asOf);
const enter = () => evaluatePaperStrategyScan(emptyStrategyLedger(), adaptiveTestSnapshot(), strategyTestCost, state());
const scheduled = (ledger = enter()) => {
  ledger.trades[0].policy.exitModel = 'SCHEDULED_CLOSE';
  delete ledger.trades[0].exitPolicy; delete ledger.trades[0].exitResearch;
  return ledger;
};
const quote = (at: string, price: number) => {
  const snapshot = adaptiveTestSnapshot();
  snapshot.id = `quote:${at}`; snapshot.asOf = at; snapshot.tradingDate = at.slice(0, 10);
  snapshot.observations[0].observedAt = at; snapshot.observations[0].price = price;
  snapshot.observations[0].features!.asOf = at;
  return snapshot;
};

describe('paper strategy lifecycle', () => {
  it('exits on a fresh loss observation before D1 with frozen costs and evidence', () => {
    const ledger = enter(), snapshot = quote('2026-09-18T01:05:00Z', 9400);
    const result = evaluatePaperStrategyScan(ledger, snapshot, strategyTestCost, state());
    expect(result.trades[0].exit).toMatchObject({ model: 'ADAPTIVE_OBSERVED', price: 9400,
      effectiveAt: snapshot.asOf, observedTrigger: { reason: 'ADAPTIVE_STOP_LOSS' },
      observedQuote: { source: 'KIS_REST_REQUEST_OBSERVED', price: 9400 } });
    expect(result.trades[0].entryDecision).toEqual(ledger.trades[0].entryDecision);
    expect(result.lastRun).toMatchObject({ openedCount: 0, closedCount: 1 });
    expect(() => assertPaperStrategyLedger(JSON.parse(JSON.stringify(result)))).not.toThrow();
    expect(evaluatePaperStrategyScan(result, snapshot, strategyTestCost, state()).lastRun?.closedCount).toBe(0);
  });

  it('protects sampled gains and continues equal comparison paths after the actual exit', () => {
    const peak = evaluatePaperStrategyScan(enter(), quote('2026-09-18T01:05:00Z', 10500), strategyTestCost, state());
    const closed = evaluatePaperStrategyScan(peak, quote('2026-09-18T01:10:00Z', 10300), strategyTestCost, state());
    expect(closed.trades[0].exit?.decision.reasonCode).toBe('ADAPTIVE_TRAILING_STOP');
    const after = evaluatePaperStrategyScan(closed, quote('2026-09-18T01:15:00Z', 10100), strategyTestCost, state());
    expect(after.trades[0].exit).toEqual(closed.trades[0].exit);
    expect(after.trades[0].exitResearch!.quoteCount).toBeGreaterThan(closed.trades[0].exitResearch!.quoteCount);
    expect(after.trades[0].exitResearch!.outcomes.PATIENT?.reason).toBe('ADAPTIVE_TRAILING_STOP');
    expect(() => assertPaperStrategyLedger(after)).not.toThrow();
  });

  it('uses D5 only for comparison and can exit on a fresh observation after D5', () => {
    const ledger = enter(), benchmark = ledger.trades[0].exitResearch!;
    const atClose = quote(`${benchmark.watchUntilDate}T07:00:00Z`, 10000); atClose.marketOpen = false;
    atClose.observations[0].dailyCloses = [{ tradingDate: benchmark.watchUntilDate, close: 10000, availableAt: atClose.asOf }];
    const held = evaluatePaperStrategyScan(ledger, atClose, strategyTestCost, state());
    expect(held.trades[0].status).toBe('OPEN');
    expect(held.trades[0].exitResearch!.completedAt).toBe(atClose.asOf);
    const later = quote('2026-10-02T01:00:00Z', 9400);
    const closed = evaluatePaperStrategyScan(held, later, strategyTestCost, state());
    expect(closed.trades[0].exit?.decision.reasonCode).toBe('ADAPTIVE_STOP_LOSS');
    expect(closed.trades[0].exit?.effectiveAt).toBe(later.asOf);
    expect(() => assertPaperStrategyLedger(closed)).not.toThrow();
  });

  it.each(['old', 'future', 'offhours', 'missing'] as const)('does not manufacture an exit from a %s quote', problem => {
    const snapshot = quote('2026-09-18T01:10:00Z', 9000);
    if (problem === 'old') snapshot.observations[0].observedAt = '2026-09-18T01:01:00Z';
    if (problem === 'future') snapshot.observations[0].observedAt = '2026-09-18T01:11:00Z';
    if (problem === 'offhours') snapshot.marketOpen = false;
    if (problem === 'missing') snapshot.observations[0].price = null;
    const result = evaluatePaperStrategyScan(enter(), snapshot, strategyTestCost, state());
    expect(result.trades[0].exit).toBeNull();
    expect(result.latestDecisions[0].reasonCode).toBe('ADAPTIVE_EXIT_QUOTE_UNAVAILABLE');
  });
  it('preserves the latest intraday reason counts through after-hours scans and restart', () => {
    const snapshot = strategyTestSnapshot();
    let result = evaluatePaperStrategyScan(emptyStrategyLedger(), snapshot, strategyTestCost, inactive());
    const saved = structuredClone(result.lastMarketSession);
    expect(saved).toMatchObject({ tradingDate: '2026-09-18', decisionCount: 1, reasonCounts: { ADAPTIVE_NO_ACTIVE_RULE: 1 } });
    snapshot.asOf = '2026-09-18T07:10:00Z'; snapshot.marketOpen = false;
    result = evaluatePaperStrategyScan(JSON.parse(JSON.stringify(result)), snapshot, strategyTestCost, inactive());
    expect(result.latestDecisions[0].reasonCode).toBe('MARKET_CLOSED');
    expect(result.lastMarketSession).toEqual(saved);
    expect(buildPaperStrategyView(result).lastMarketSession).toEqual(saved);
    expect(() => assertPaperStrategyLedger(result)).not.toThrow();
    result.lastMarketSession!.decisionCount = 2;
    expect(() => assertPaperStrategyLedger(result)).toThrow('inconsistent intraday summary');
    delete result.lastMarketSession;
    expect(() => assertPaperStrategyLedger(result)).not.toThrow();
  });
  it('buys one share with frozen evidence and an observed exit policy independent of its D3 benchmark', () => {
    const result = enter();
    expect(result.lastRun).toMatchObject({ openedCount: 1, closedCount: 0 });
    expect(result.trades[0]).toMatchObject({ status: 'OPEN', quantity: 1, horizon: 3, scheduledExitDate: '2026-09-23',
      policy: { exitModel: 'ADAPTIVE_OBSERVED' }, exitPolicy: { origin: 'EXPLORATION_DEFAULT' },
      entryDecision: { action: 'BUY', reasonCode: 'ADAPTIVE_FEATURE_SELECTED', adaptiveEvidence: { candidate: { active: true } } } });
    expect(() => assertPaperStrategyLedger(result)).not.toThrow();
  });

  it('keeps a halted stock out of new entries even when its rule matches', () => {
    const snapshot = adaptiveTestSnapshot();
    Object.assign(snapshot.observations[0], { price: null, issue: 'TRADING_HALTED' });
    const result = evaluatePaperStrategyScan(emptyStrategyLedger(), snapshot, strategyTestCost, state());
    expect(result.trades).toEqual([]);
    expect(result.latestDecisions[0]).toMatchObject({ action: 'WAIT', reasonCode: 'CURRENT_PRICE_UNAVAILABLE',
      reason: '거래정지 종목 · 진입 대상에서 제외' });
  });

  it('never falls back to the retired news strategy when no adaptive rule is active', () => {
    const snapshot = strategyTestSnapshot();
    const result = evaluatePaperStrategyScan(emptyStrategyLedger(), snapshot, strategyTestCost, inactive());
    expect(result.trades).toEqual([]);
    expect(result.latestDecisions[0].reasonCode).toBe('ADAPTIVE_NO_ACTIVE_RULE');
    expect(buildPaperStrategyView(emptyStrategyLedger()).strategyVersion).toBe('adaptive-features-v1');
  });

  it.each(['news-trend-v1', 'news-trend-v2'] as const)('holds and closes a restored %s trade under its frozen schedule', (version) => {
    const legacy = legacyStrategyLedger(strategyTestSnapshot(), version);
    const result = evaluatePaperStrategyScan(legacy, adaptiveTestSnapshot(), strategyTestCost, state());
    expect(result.trades[0]).toEqual(legacy.trades[0]);
    expect(result.latestDecisions[0].action).toBe('HOLD');
    expect(buildPaperStrategyView(result).strategyVersion).toBe('adaptive-features-v1');
    expect(() => assertPaperStrategyLedger(result)).not.toThrow();
    const close = strategyTestSnapshot();
    close.asOf = '2026-09-23T07:00:00Z'; close.tradingDate = '2026-09-23'; close.marketOpen = false;
    close.observations[0].dailyCloses = [{ tradingDate: '2026-09-23', close: 11000, availableAt: close.asOf }];
    const closed = evaluatePaperStrategyScan(JSON.parse(JSON.stringify(result)), close, strategyTestCost,
      selectPaperAdaptiveState(result.adaptive, [], close.asOf));
    expect(closed.trades[0].exit).toMatchObject({ price: 11000, effectiveAt: '2026-09-23T06:30:00.000Z', netPnl: 1000 });
    expect(closed.trades[0].exit!.decision.evidence).toEqual(legacy.trades[0].entryDecision.evidence);
    expect(() => assertPaperStrategyLedger(closed)).not.toThrow();
  });

  it.each(['unknown', 'price', 'issue', 'future', 'stale', 'closed'] as const)('waits on %s without turning it into a sell', (problem) => {
    const snapshot = adaptiveTestSnapshot();
    if (problem === 'unknown') delete snapshot.observations[0].features;
    if (problem === 'price') snapshot.observations[0].price = null;
    if (problem === 'issue') snapshot.observations[0].issue = 'CURRENT_QUOTE_UNAVAILABLE';
    if (problem === 'future') snapshot.observations[0].observedAt = '2026-09-18T02:00:00Z';
    if (problem === 'stale') snapshot.observations[0].observedAt = '2026-09-17T01:00:00Z';
    if (problem === 'closed') snapshot.marketOpen = false;
    const result = evaluatePaperStrategyScan(emptyStrategyLedger(), snapshot, strategyTestCost, state());
    expect(result.trades).toHaveLength(0);
    expect(result.latestDecisions[0].action).toBe('WAIT');
  });

  it('preserves one open trade across repeated scans and restart', () => {
    const result = enter();
    const next = evaluatePaperStrategyScan(JSON.parse(JSON.stringify(result)), adaptiveTestSnapshot(), strategyTestCost, state());
    expect(next.trades).toHaveLength(1);
    expect(next.latestDecisions[0].action).toBe('HOLD');
    expect(next.lastRun!.openedCount).toBe(0);
    expect(next.trades[0]).toEqual(result.trades[0]);
  });

  it('does not change committed horizon when new evidence turns negative', () => {
    const ledger = enter();
    const snapshot = strategyTestSnapshot();
    snapshot.observations[0].aboveMa20 = false;
    const result = evaluatePaperStrategyScan(ledger, snapshot, strategyTestCost, inactive());
    expect(result.trades[0]).toEqual(ledger.trades[0]);
    expect(result.latestDecisions[0].reasonCode).toBe('ADAPTIVE_EXIT_QUOTE_UNAVAILABLE');
  });

  it('closes at the precommitted exact close with own price/costs and separate observation time', () => {
    const cost = { ...strategyTestCost(), buyFeeRate: 0.01, sellFeeRate: 0.01, sellTaxRate: 0.02, slippageRate: 0.01 };
    const ledger = scheduled(evaluatePaperStrategyScan(emptyStrategyLedger(), adaptiveTestSnapshot(), () => cost, state()));
    cost.buyFeeRate = 1;
    const snapshot = strategyTestSnapshot();
    snapshot.asOf = '2026-09-28T01:00:00Z'; snapshot.tradingDate = '2026-09-28';
    snapshot.observations[0].price = 50000;
    snapshot.observations[0].dailyCloses = [{ tradingDate: '2026-09-23', close: 11000, availableAt: snapshot.asOf }];
    const result = evaluatePaperStrategyScan(ledger, snapshot, strategyTestCost, inactive());
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
    const result = evaluatePaperStrategyScan(scheduled(), snapshot, strategyTestCost, inactive());
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
    const ledger = evaluatePaperStrategyScan(scheduled(), snapshot, strategyTestCost, inactive());
    ledger.trades = Array.from({ length: 205 }, (_, index) => ({ ...structuredClone(ledger.trades[0]), id: `display-test-${index}` }));
    const view = buildPaperStrategyView(ledger);
    expect(view.trades).toHaveLength(200);
    expect(view.totalCount).toBe(205);
    expect(view.performance).toEqual({ closedCount: 205, meanNetReturnPct: 10, winRatePct: 100, totalNetPnl: 205000 });
  });
});
