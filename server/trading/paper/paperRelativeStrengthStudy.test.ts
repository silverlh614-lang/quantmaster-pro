// @responsibility Verify the live-sample index-relative strength study.
import { describe, expect, it } from 'vitest';
import type { PaperExperiment } from '../../../src/types/paperExperiment.js';
import type { ResearchSeries } from '../../../src/types/paperResearch.js';
import { addBusinessDaysFromKstDate } from '../krxHolidays.js';
import { buildPaperRelativeStrengthStudy } from './paperRelativeStrengthStudy.js';

const ENTRY = '2026-09-01';
const dates = Array.from({ length: 21 }, (_, i) => addBusinessDaysFromKstDate('2026-07-31', i));
const index = (symbol: string): ResearchSeries => ({ id: `kis-index:${symbol}`, symbol, source: 'KIS_SNAPSHOT',
  retrievedAt: '2026-08-31T07:00:00Z', closes: dates.map(date => ({ date, close: 100 })) });

function experiment(symbol: string, gainPct: number, d1Pct: number, market: 'KOSPI' | 'KOSDAQ' = 'KOSPI'): PaperExperiment {
  const dailyCloses = dates.map((date, i) => ({ tradingDate: date, close: i === dates.length - 1 ? 100 * (1 + gainPct / 100) : 100,
    availableAt: '2026-08-31T07:00:00Z' }));
  const due = addBusinessDaysFromKstDate(ENTRY, 1);
  return { id: `${symbol}:${ENTRY}`, strategyVersion: 'shadow-baseline-v1', symbol, tradingDate: ENTRY, entryAt: '2026-09-01T01:00:00Z',
    entryObservation: { symbol, market, aboveMa20: true, news: [], dailyCloses },
    outcomes: [{ horizon: 1, tradingDate: due, availableAt: `${due}T07:00:00Z`, netReturnPct: d1Pct }] } as unknown as PaperExperiment;
}

describe('paper relative strength study', () => {
  it('compares same-day upper and lower halves using only closes before entry', () => {
    const rows = [experiment('000001', 10, 3), experiment('000002', 5, 1), experiment('000003', -5, -1), experiment('000004', -10, -2),
      experiment('000005', 0, 9, 'KOSDAQ')];
    const study = buildPaperRelativeStrengthStudy(rows, [index('^KS11'), index('^KQ11')], '2026-09-10T00:00:00Z');
    expect(study).toMatchObject({ experimentCount: 5, measuredCount: 5, indexReady: true });
    // One date × cohort cell of five: the middle row (0%) is left out.
    expect(study.horizons[0]).toMatchObject({ horizon: 1, cellCount: 1, upperWinCount: 1, entryDateCount: 1, sampleCount: 4 });
    expect(study.horizons[0].upperMeanPct).toBeCloseTo(2);
    expect(study.horizons[0].lowerMeanPct).toBeCloseTo(-1.5);
    expect(study.horizons[0].differencePct).toBeCloseTo(3.5);
    expect(study.horizons[1]).toMatchObject({ horizon: 3, cellCount: 0, differencePct: null });
  });

  it('waits for index bars and ignores outcomes not yet available', () => {
    const rows = [experiment('000001', 10, 3), experiment('000002', -10, -2)];
    expect(buildPaperRelativeStrengthStudy(rows, [], '2026-09-10T00:00:00Z')).toMatchObject({ indexReady: false, measuredCount: 0 });
    const early = buildPaperRelativeStrengthStudy(rows, [index('^KS11'), index('^KQ11')], '2026-09-02T00:00:00Z');
    expect(early.measuredCount).toBe(2);
    expect(early.horizons[0].cellCount).toBe(0);
  });
});
