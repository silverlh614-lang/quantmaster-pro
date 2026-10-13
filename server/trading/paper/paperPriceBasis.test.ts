// @responsibility Verify held Shadow positions keep their entry price basis across a KIS share-count re-basing.
import { describe, expect, it } from 'vitest';
import type { PaperSnapshot } from '../../../src/types/paperExperiment.js';
import { advancePaperAccount, buildPaperAccountView, createPaperAccount } from './paperAccount.js';
import { accountSignalFixture } from './paperAccountFixtures.js';
import { adaptiveTestSnapshot, matureAdaptiveSamples } from './paperAdaptiveFixtures.js';
import { selectPaperAdaptiveState } from './paperAdaptiveSelection.js';
import { createPaperExperiment, updatePaperOutcomes } from './paperExperimentPolicy.js';
import { PAPER_PRICE_BASIS_UNCONFIRMED, paperPriceBasisFactor, paperTradeObservation } from './paperPriceBasis.js';
import { emptyStrategyLedger, strategyTestCost } from './paperStrategyFixtures.js';
import { evaluatePaperHoldingPrices, evaluatePaperStrategyScan } from './paperStrategyPolicy.js';
import { assertPaperStrategyLedger } from './paperStrategyValidation.js';
import { capturePaperTradeMeasurements } from './paperTradeMeasurements.js';

const bar = (tradingDate: string, close: number) => ({ tradingDate, close, availableAt: `${tradingDate}T07:00:00Z` });
const state = () => selectPaperAdaptiveState(undefined, matureAdaptiveSamples(), adaptiveTestSnapshot().asOf);
/** Entry on 09-18 at 10,000 with the 09-17 close recorded at entry. */
function entered() {
  const snapshot = adaptiveTestSnapshot();
  snapshot.observations[0].dailyCloses = [bar('2026-09-16', 9900), bar('2026-09-17', 10000)];
  const ledger = evaluatePaperStrategyScan(emptyStrategyLedger(), snapshot, strategyTestCost, state());
  capturePaperTradeMeasurements(ledger, snapshot);
  return ledger;
}
function later(at: string, price: number, bars: ReturnType<typeof bar>[] = []): PaperSnapshot {
  const snapshot = adaptiveTestSnapshot();
  snapshot.id = `scan:${at}`; snapshot.asOf = at; snapshot.tradingDate = at.slice(0, 10);
  Object.assign(snapshot.observations[0], { observedAt: at, price, dailyCloses: bars });
  snapshot.observations[0].features!.asOf = at;
  return snapshot;
}

describe('paper price basis', () => {
  it('reads a re-basing from the same past session recorded at entry and ignores whole-won noise', () => {
    const entry = [bar('2026-09-30', 650), bar('2026-10-01', 696), bar('2026-10-07', 700)];
    expect(paperPriceBasisFactor(entry, [bar('2026-10-01', 3480), bar('2026-10-28', 3500)], '2026-10-07'))
      .toEqual({ factor: 5, referenceDate: '2026-10-01' });
    expect(paperPriceBasisFactor(entry, [bar('2026-10-01', 696)], '2026-10-07')).toEqual({ factor: 1, referenceDate: '2026-10-01' });
    expect(paperPriceBasisFactor(entry, [bar('2026-10-01', 697)], '2026-10-07')?.factor).toBe(1);
    expect(paperPriceBasisFactor(entry, [bar('2026-10-28', 3500)], '2026-10-07')).toBeNull();
    expect(paperPriceBasisFactor([], [bar('2026-10-01', 3480)], '2026-10-07')).toBeNull();
  });

  it('keeps a merged stock on the entry basis instead of booking a five-fold gain, then exits on the converted price', () => {
    const relisted = evaluatePaperStrategyScan(entered(),
      later('2026-09-21T01:05:00Z', 50000, [bar('2026-09-17', 50000), bar('2026-09-18', 50000)]), strategyTestCost, state());
    const trade = relisted.trades[0];
    expect(trade.exit).toBeNull();
    expect(trade.priceBasis).toEqual({ factor: 5, referenceDate: '2026-09-17', checkedAt: '2026-09-21T01:05:00Z' });
    expect(relisted.latestDecisions[0]).toMatchObject({ action: 'HOLD', reasonCode: 'ADAPTIVE_EXIT_HOLD' });
    expect(relisted.latestDecisions[0].reason).toContain('주식 수 변경 반영(KIS 가격 ÷ 5)');
    expect(trade.exitResearch!.peakNetReturnPct).toBeLessThan(1);
    expect(() => assertPaperStrategyLedger(JSON.parse(JSON.stringify(relisted)))).not.toThrow();
    // Minute quotes carry no bars and reuse the recorded factor.
    const sold = evaluatePaperHoldingPrices(relisted, { ...later('2026-09-21T01:06:00Z', 47000), quoteOnly: true });
    expect(sold.trades[0].exit).toMatchObject({ price: 9400, observedTrigger: { reason: 'ADAPTIVE_STOP_LOSS' } });
    expect(sold.trades[0].exit!.netReturnPct).toBeGreaterThan(-7);
  });

  it('waits for daily bars before using a price beyond the daily limit on a quote-only check', () => {
    const ledger = entered();
    expect(ledger.trades[0].measurement?.latest.price).toBe(10000);
    const held = evaluatePaperHoldingPrices(ledger, { ...later('2026-09-21T00:01:00Z', 50000), quoteOnly: true });
    expect(held.trades[0].exit).toBeNull();
    expect(held.latestDecisions[0]).toMatchObject({ action: 'HOLD', reasonCode: 'ADAPTIVE_EXIT_QUOTE_UNAVAILABLE',
      reason: '하루 가격 제한폭을 넘는 가격 변화 · 주식 수 변경(병합·분할 등)을 일봉으로 확인할 때까지 매도 판단 대기' });
    expect(paperTradeObservation(held.trades[0], later('2026-09-21T00:02:00Z', 10300).observations[0])?.price).toBe(10300);
    expect(paperTradeObservation(held.trades[0], later('2026-09-21T00:02:00Z', 50000).observations[0]))
      .toMatchObject({ price: null, issue: PAPER_PRICE_BASIS_UNCONFIRMED });
  });

  it('values and sells an account holding on the entry basis after a re-basing', () => {
    const { strategy, snapshot, trade } = accountSignalFixture();
    snapshot.observations[0].source = 'KIS_REST_REQUEST_OBSERVED';
    const account = createPaperAccount({ initialCash: 10000, maxPositionPct: 20, includeExploration: false },
      new Date(Date.parse(snapshot.asOf) - 60000).toISOString(), 'virtual-basis');
    const bought = advancePaperAccount(account, strategy, snapshot);
    const quantity = bought.orders[0].quantity;
    trade.priceBasis = { factor: 5, referenceDate: '2026-09-17', checkedAt: '2026-09-21T01:00:00Z' };
    const next = later('2026-09-21T01:05:00Z', 500);
    next.observations[0].source = 'KIS_REST_REQUEST_OBSERVED';
    const marked = advancePaperAccount(bought, strategy, next);
    expect(marked.marks[trade.id].price).toBe(100);
    const view = buildPaperAccountView(marked, next.asOf);
    expect(view.positions[0].liquidationValue!).toBeLessThan(quantity * 101);
  });

  it('completes baseline outcomes on the entry basis', () => {
    const snapshot = later('2026-09-18T01:00:00Z', 1000, [bar('2026-09-17', 1000)]);
    const experiment = createPaperExperiment(snapshot, snapshot.observations[0], strategyTestCost())!;
    const after = later('2026-09-21T07:10:00Z', 5100, [bar('2026-09-17', 5000), { ...bar('2026-09-21', 5100), availableAt: '2026-09-21T07:00:00Z' }]);
    const updated = updatePaperOutcomes(experiment, after.observations[0], after.asOf);
    expect(updated.outcomes[0]).toMatchObject({ horizon: 1, exitPrice: 1020 });
    expect(updated.outcomes[0].grossReturnPct).toBeCloseTo(2);
  });
});
