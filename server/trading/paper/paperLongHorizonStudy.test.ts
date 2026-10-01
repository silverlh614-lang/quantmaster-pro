// @responsibility Verify the 20-session research study.
import { describe, expect, it } from 'vitest';
import type { HistoricalPaperSample, ResearchArchive } from '../../../src/types/paperResearch.js';
import { addBusinessDaysFromKstDate } from '../krxHolidays.js';
import { buildLongHorizonStudy } from './paperLongHorizonStudy.js';

const days = Array.from({ length: 80 }, (_, i) => addBusinessDaysFromKstDate('2026-02-02', i));
const cost = { version: 't', buyFeeRate: 0, sellFeeRate: 0, sellTaxRate: 0, slippageRate: 0 };
// Strong symbols rise 1% per session, weak ones fall 0.5%; the index stays flat.
const series = (symbol: string, step: number) => ({ id: `chart:${symbol}`, symbol, market: 'KOSPI' as const, source: 'ARCHIVED_CHART' as const,
  retrievedAt: '2026-06-30T07:00:00Z', closes: days.map((date, i) => ({ date, close: 100 * (1 + step * i) })) });
const archive: ResearchArchive = { schemaVersion: 1, news: [], inventory: [], series: [
  series('000001', 0.01), series('000002', -0.005),
  { id: 'kis-index:^KS11', symbol: '^KS11', market: 'KOSPI', source: 'KIS_SNAPSHOT', retrievedAt: '2026-06-30T07:00:00Z',
    closes: days.map(date => ({ date, close: 100 })) }] };
const sample = (symbol: string, step: number, i: number, strength: number): HistoricalPaperSample => ({
  id: `h:${days[i]}:${symbol}`, model: 'HISTORICAL_CLOSE_TO_CLOSE', symbol, tradingDate: days[i], entryAt: `${days[i]}T06:30:00Z`,
  entryPrice: 100 * (1 + step * i), aboveMa20: true, cohort: null, newsIds: [], seriesId: `chart:${symbol}`, source: 'ARCHIVED_CHART',
  reconstructedAt: '2026-06-30T07:00:00Z', costModel: cost, outcomes: [],
  features: { return5dPct: null, volumeRatio20d: null, relativeReturn20dPct: strength, extensionMa20Pct: null, distanceHigh20dPct: null,
    atr14Pct: null, priceSetup: null, benchmarkSeriesId: null } });

describe('20-session research', () => {
  it('measures exact 20-session outcomes, index excess and a purged held-out feature comparison', () => {
    const samples = Array.from({ length: 50 }, (_, i) => [sample('000001', 0.01, i, 5), sample('000002', -0.005, i, -5)]).flat();
    const study = buildLongHorizonStudy(archive, samples, '2026-06-30T08:00:00Z');
    expect(study).toMatchObject({ horizon: 20, sampleCount: 100, symbolCount: 2, entryDateCount: 50, excessCount: 100 });
    const strong = samples.filter(item => item.symbol === '000001').map(item => (100 * (1 + 0.01 * (days.indexOf(item.tradingDate) + 20)) / item.entryPrice - 1) * 100);
    const weak = samples.filter(item => item.symbol === '000002').map(item => (100 * (1 - 0.005 * (days.indexOf(item.tradingDate) + 20)) / item.entryPrice - 1) * 100);
    const all = [...strong, ...weak];
    expect(study.meanNetReturnPct).toBeCloseTo(all.reduce((a, b) => a + b, 0) / all.length);
    expect(study.meanExcessReturnPct).toBeCloseTo(study.meanNetReturnPct!);
    const rs = study.features.find(item => item.feature === 'relativeReturn20dPct')!;
    expect(rs).toMatchObject({ status: 'EVALUATED', selectedGroup: '상위', testDateCount: 15 });
    expect(rs.matchedDifferencePct!).toBeGreaterThan(0);
    // Training labels never reach the held-out period.
    expect(addBusinessDaysFromKstDate(days[0], 20) < study.splitDate!).toBe(true);
    expect(study.features.find(item => item.feature === 'return5dPct')!.status).toBe('MISSING_INPUT');
  });

  it('excludes samples whose 20th session close is not yet known', () => {
    const study = buildLongHorizonStudy(archive, [sample('000001', 0.01, 70, 1)], '2026-06-30T08:00:00Z');
    expect(study).toMatchObject({ sampleCount: 0, meanNetReturnPct: null, splitDate: null });
  });
});
