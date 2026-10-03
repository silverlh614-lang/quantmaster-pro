// @responsibility Verify same-day Shadow strategy selectivity research.
import { describe, expect, it } from 'vitest';
import type { PaperStrategyTrade } from '../../../src/types/paperStrategy.js';
import { buildPaperStrategySelection } from './paperStrategySelection.js';
import { matureStrategySamples } from './paperStrategyFixtures.js';

const trade = (symbol: string, tradingDate: string, horizon: 1 | 3 | 5, scheduledExitDate: string, netReturnPct?: number) => ({
  symbol, tradingDate, horizon, scheduledExitDate, status: netReturnPct === undefined ? 'OPEN' : 'CLOSED',
  exit: netReturnPct === undefined ? null : { netReturnPct },
}) as unknown as PaperStrategyTrade;

describe('paper strategy selectivity', () => {
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
});
