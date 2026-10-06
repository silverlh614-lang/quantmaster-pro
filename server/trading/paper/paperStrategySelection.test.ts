// @responsibility Verify same-day Shadow strategy selectivity research.
import { describe, expect, it } from 'vitest';
import type { PaperStrategyTrade } from '../../../src/types/paperStrategy.js';
import { buildPaperStrategySelection } from './paperStrategySelection.js';
import { matureStrategySamples } from './paperStrategyFixtures.js';
import { tradeSignalIdentity } from '../../../src/utils/paperTradeReview.js';

const trade = (symbol: string, tradingDate: string, horizon: 1 | 3 | 5, scheduledExitDate: string, netReturnPct?: number) => ({
  symbol, tradingDate, horizon, scheduledExitDate, status: netReturnPct === undefined ? 'OPEN' : 'CLOSED',
  strategyVersion: 'adaptive-features-v1', entryDecision: { cohort: null },
  exit: netReturnPct === undefined ? null : { netReturnPct },
}) as unknown as PaperStrategyTrade;

describe('paper strategy selectivity', () => {
  it('keeps other signal purchases out of controls and weights dates equally per signal', () => {
    const experiments = matureStrategySamples([0, 0, 0]);
    for (const row of experiments) {
      row.outcomes.find(outcome => outcome.horizon === 5)!.netReturnPct = row.symbol === '000100' ? 10
        : row.symbol === '000101' ? 100 : 1;
    }
    const observed = (symbol: string, date: string, bucket: number) => ({ ...trade(symbol, date, 5, '2026-09-10', 3),
      policy: { exitModel: 'ADAPTIVE_OBSERVED' }, entryDecision: { adaptiveEvidence: { candidate: { rule: { feature: 'rsi14', bucket, horizon: 5 } } } },
      exit: { netReturnPct: 3, decisionAt: '2026-09-04T02:00:00Z' }, exitResearch: { baseline: { netReturnPct: 5 } },
    }) as unknown as PaperStrategyTrade;
    const first = observed('000100', '2026-09-01', 1), other = observed('000101', '2026-09-01', 2);
    const next = observed('000102', '2026-09-02', 1);
    const crowdedDay = observed('000102', '2026-09-01', 1);
    const before = JSON.stringify([first, other, next, crowdedDay, experiments]);
    const result = buildPaperStrategySelection([first, other, next, crowdedDay], experiments).adaptive!.signals!;
    expect(result.find(row => row.key === tradeSignalIdentity(first).key)).toMatchObject({
      entry: { edgePct: 2.25, tradeCount: 3, dateCount: 2 }, exit: { edgePct: -2, tradeCount: 3, dateCount: 2 },
    });
    expect(result.find(row => row.key === tradeSignalIdentity(other).key)?.entry.edgePct).toBe(99);
    expect(JSON.stringify([first, other, next, crowdedDay, experiments])).toBe(before);
    // No unbought controls means unknown, not zero advantage.
    const onlyBought = experiments.filter(row => row.tradingDate === first.tradingDate && row.symbol === first.symbol);
    expect(buildPaperStrategySelection([first], onlyBought).adaptive!.signals![0].entry).toEqual({ edgePct: null, tradeCount: 0, dateCount: 0 });
  });
  it('counts observed holdings past the benchmark without mixing observed exits into fixed-duration returns', () => {
    const observed = trade('000100', '2026-08-31', 1, '2026-09-01');
    observed.policy = { exitModel: 'ADAPTIVE_OBSERVED' } as PaperStrategyTrade['policy'];
    const result = buildPaperStrategySelection([observed, trade('000101', '2026-09-02', 3, '2026-09-07')], matureStrategySamples());
    expect(result.heldCount).toBe(1);
    observed.status = 'CLOSED'; observed.exit = { netReturnPct: 99, decisionAt: '2026-09-02T02:00:00Z' } as PaperStrategyTrade['exit'];
    expect(buildPaperStrategySelection([observed], matureStrategySamples()).comparison.strategyTradeCount).toBe(0);
  });

  it('separates new entries, held symbols and same-day unselected outcomes', () => {
    const experiments = matureStrategySamples();
    const result = buildPaperStrategySelection([
      trade('000102', '2026-08-31', 5, '2026-09-02'),
      trade('000100', '2026-09-01', 3, '2026-09-04', 5),
      trade('000101', '2026-09-01', 3, '2026-09-04', 5),
      trade('000100', '2026-09-02', 3, '2026-09-07'),
    ], experiments);
    expect(result).toMatchObject({ dateCount: 3, candidateCount: 8, boughtCount: 3, heldCount: 3, notBoughtCount: 2 });
    expect(result.selectionRatePct).toBeCloseTo(37.5);
    expect(result.cohorts.find(item => item.cohort === 'NEWS_ABSENT_ABOVE_MA20')).toMatchObject({ candidateCount: 8, boughtCount: 3 });
    expect(result.comparison).toMatchObject({ groupCount: 1, strategyTradeCount: 2, unselectedCount: 2 });
    expect(result.comparison.strategyMeanPct).toBeCloseTo(5);
    expect(result.comparison.unselectedMeanPct).toBeCloseTo(9);
    expect(result.comparison.differencePct).toBeCloseTo(-4);
  });

  it('waits for a comparison when nothing has closed', () => {
    const result = buildPaperStrategySelection([trade('000100', '2026-09-01', 3, '2026-09-04')], matureStrategySamples());
    expect(result.comparison).toMatchObject({ groupCount: 0, differencePct: null });
    expect(buildPaperStrategySelection([], [])).toMatchObject({ candidateCount: 0, selectionRatePct: null });
  });

  it('measures entry choice and observed exits separately at the D5 close', () => {
    const strong = matureStrategySamples([0, 0, 4]), weak = matureStrategySamples([0, 0, 1]);
    const experiments = [...strong.filter(row => row.symbol === '000100'), ...weak.filter(row => row.symbol !== '000100')];
    const observed = {
      symbol: '000100', tradingDate: '2026-09-01', horizon: 5, scheduledExitDate: '2026-09-08', status: 'CLOSED',
      strategyVersion: 'adaptive-features-v1', policy: { exitModel: 'ADAPTIVE_OBSERVED' }, entryDecision: { adaptiveEvidence: {} },
      exit: { netReturnPct: 2, decisionAt: '2026-09-03T02:00:00Z' }, exitResearch: { baseline: { netReturnPct: 4 } },
    } as unknown as PaperStrategyTrade;
    const result = buildPaperStrategySelection([observed], experiments);
    expect(result.comparison.strategyTradeCount).toBe(0);
    const adaptive = result.adaptive!;
    expect(adaptive.entry).toMatchObject({ dateCount: 1, tradeCount: 1 });
    expect(adaptive.entry.edgePct).toBeCloseTo(3);
    expect(adaptive.validatedEntry).toEqual(adaptive.entry);
    expect(adaptive.explorationEntry).toEqual({ dateCount: 0, tradeCount: 0, edgePct: null });
    expect(adaptive.exit).toMatchObject({ dateCount: 1, tradeCount: 1 });
    expect(adaptive.exit.edgePct).toBeCloseTo(-2);
    expect(adaptive.months).toEqual([{ month: '2026-09', entry: adaptive.entry, exit: adaptive.exit }]);
    observed.status = 'OPEN'; observed.exit = null;
    expect(buildPaperStrategySelection([observed], experiments).adaptive!.exit).toEqual({ dateCount: 0, tradeCount: 0, edgePct: null });
  });
});
