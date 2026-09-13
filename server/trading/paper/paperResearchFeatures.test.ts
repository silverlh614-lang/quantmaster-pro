// @responsibility Verify historical feature timing.
import { describe, expect, it } from 'vitest';
import type { ResearchArchive, ResearchBar } from '../../../src/types/paperResearch.js';
import { createResearchFeatureReader } from './paperResearchFeatures.js';
import { buildPaperResearch } from './paperResearch.js';
import { strategyTestCost } from './paperStrategyFixtures.js';
import { isKrxTradingDay } from '../../calendar/krxTradingCalendar.js';

function fixture() {
  const closes: ResearchBar[] = [];
  for (let day = new Date('2026-01-01T12:00:00Z'); day < new Date('2026-06-01'); day.setUTCDate(day.getUTCDate() + 1)) {
    const date = day.toISOString().slice(0, 10);
    if (isKrxTradingDay(date)) {
      const close = 100 + closes.length;
      closes.push({ date, close, open: close - 1, high: close + 2, low: close - 2, volume: 1000 });
    }
  }
  const series = { id: 'stock', symbol: '005930', market: 'KOSPI' as const, source: 'ARCHIVED_CHART' as const, retrievedAt: '2026-06-01T07:00:00Z', closes };
  const archive: ResearchArchive = { schemaVersion: 1, inventory: [], news: [], series: [series,
    { ...structuredClone(series), id: 'index', symbol: '^KS11', closes: closes.map(bar => ({ date: bar.date, close: 100 })) }] };
  const index = 35;
  return { archive, series, date: closes[index].date, prior: closes.slice(index - 20, index).reverse().map(bar => bar.date) };
}
const asOf = '2026-09-13T00:00:00Z';

describe('archived Gate features', () => {
  it('uses entry volume, prior highs and exact matching market returns without future bars', () => {
    const { archive, series, date, prior } = fixture();
    series.closes.find(bar => bar.date === date)!.volume = 2000;
    const first = createResearchFeatureReader(archive, asOf)(series, date, prior);
    expect(first.volumeRatio20d).toBe(2);
    expect(first.return5dPct).toBeCloseTo((135 / 130 - 1) * 100);
    expect(first.relativeReturn20dPct).toBeCloseTo((135 / 115 - 1) * 100);
    expect(first.distanceHigh20dPct).toBeCloseTo((135 / 136 - 1) * 100);
    expect(first.atr14Pct).toBeCloseTo(4 / 135 * 100);
    expect(first.benchmarkSeriesId).toBe('index');
    for (const bar of series.closes.filter(bar => bar.date > date)) Object.assign(bar, { close: 99999, high: 99999, volume: 999999 });
    expect(createResearchFeatureReader(archive, asOf)(series, date, prior)).toEqual(first);
  });
  it('does not borrow a KOSPI benchmark for KOSDAQ or fill missing volume with zero', () => {
    const { archive, series, date, prior } = fixture();
    const kosdaq = { ...series, market: 'KOSDAQ' as const };
    delete series.closes.find(bar => bar.date === prior[0])!.volume;
    const result = createResearchFeatureReader(archive, asOf)(kosdaq, date, prior);
    expect(result.relativeReturn20dPct).toBeNull();
    expect(result.volumeRatio20d).toBeNull();
    expect(result.priceSetup).not.toBeNull();
  });
  it('requires exact benchmark dates and rejects an impossible OHLC range', () => {
    const { archive, series, date, prior } = fixture();
    archive.series[1].closes = archive.series[1].closes.filter(bar => bar.date !== prior[4]);
    series.closes.find(bar => bar.date === prior[0])!.high = 1;
    const result = createResearchFeatureReader(archive, asOf)(series, date, prior);
    expect(result.relativeReturn20dPct).toBeNull();
    expect(result.priceSetup).toBeNull();
    expect(result.atr14Pct).toBeNull();
  });
  it('retains the same baseline samples when optional features are absent', () => {
    const { archive } = fixture();
    const rich = buildPaperResearch(archive, asOf, strategyTestCost);
    const lean = structuredClone(archive);
    lean.series.forEach(series => { series.closes = series.closes.map(({ date, close }) => ({ date, close })); });
    const original = buildPaperResearch(lean, asOf, strategyTestCost);
    expect(rich.samples.map(item => [item.id, item.outcomes])).toEqual(original.samples.map(item => [item.id, item.outcomes]));
    expect(original.view.featureStudies!.find(item => item.feature === 'volumeRatio20d')!.status).toBe('MISSING_INPUT');
    expect(rich.samples.every(item => /^\d{6}$/.test(item.symbol))).toBe(true);
  });
});
