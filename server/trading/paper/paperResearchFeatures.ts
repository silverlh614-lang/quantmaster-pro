// @responsibility Reconstruct observable historical Gate features.
import type { ResearchArchive, ResearchBar, ResearchFeatures, ResearchSeries } from '../../../src/types/paperResearch.js';
import { buildGate3PriceConfirmation } from '../../quant/gate3PriceConfirmation.js';

export function researchBarFields(value: { open?: unknown; high?: unknown; low?: unknown; volume?: unknown }): Partial<ResearchBar> {
  const fields: Partial<ResearchBar> = {};
  for (const key of ['open', 'high', 'low', 'volume'] as const) {
    const amount = value[key];
    if (typeof amount === 'number' && Number.isFinite(amount) && (key === 'volume' ? amount >= 0 : amount > 0)) fields[key] = amount;
  }
  return fields;
}

const average = (values: number[]) => values.reduce((sum, value) => sum + value, 0) / values.length;
const positive = (value: unknown): value is number => typeof value === 'number' && Number.isFinite(value) && value > 0;
const validRange = (bar: ResearchBar | undefined): bar is ResearchBar & { high: number; low: number } =>
  Boolean(bar && positive(bar.high) && positive(bar.low) && bar.high >= bar.close && bar.low <= bar.close
    && (bar.open === undefined || bar.open >= bar.low && bar.open <= bar.high));

/** One coherent series per symbol; future bars never enter an entry feature. */
export function createResearchFeatureReader(archive: ResearchArchive, asOf: string) {
  const barMaps = new Map<string, Map<string, ResearchBar>>();
  for (const series of archive.series) {
    const bars = new Map<string, ResearchBar>();
    const conflicts = new Set<string>();
    for (const bar of series.closes) {
      if (!positive(bar.close) || !/^\d{4}-\d{2}-\d{2}$/.test(bar.date)
        || !(Date.parse(`${bar.date}T15:30:00+09:00`) <= Math.min(Date.parse(asOf), Date.parse(series.retrievedAt)))) continue;
      const previous = bars.get(bar.date);
      if (previous && JSON.stringify(previous) !== JSON.stringify(bar)) conflicts.add(bar.date);
      bars.set(bar.date, bar);
    }
    for (const date of conflicts) bars.delete(date);
    barMaps.set(series.id, bars);
  }
  const benchmarks = archive.series.filter((item) => ['^KS11', '^KQ11'].includes(item.symbol)
    && Date.parse(item.retrievedAt) <= Date.parse(asOf)).sort((a, b) => b.retrievedAt.localeCompare(a.retrievedAt));
  return (series: ResearchSeries, date: string, priorDates: string[]): ResearchFeatures => {
    const values: ResearchFeatures = { return5dPct: null, volumeRatio20d: null, relativeReturn20dPct: null,
      extensionMa20Pct: null, distanceHigh20dPct: null, atr14Pct: null, priceSetup: null, benchmarkSeriesId: null };
    const bars = barMaps.get(series.id);
    const entry = bars?.get(date);
    const prior = priorDates.map((day) => bars?.get(day));
    if (!entry || prior.length !== 20 || prior.some((bar) => !bar)) return values;
    const complete = prior as ResearchBar[];
    const ma20 = average(complete.map((bar) => bar.close));
    values.return5dPct = (entry.close / complete[4].close - 1) * 100;
    values.extensionMa20Pct = (entry.close / ma20 - 1) * 100;
    if (typeof entry.volume === 'number' && Number.isFinite(entry.volume) && entry.volume >= 0
      && complete.every((bar) => typeof bar.volume === 'number' && Number.isFinite(bar.volume) && bar.volume >= 0)) {
      const mean = average(complete.map((bar) => bar.volume!));
      if (mean > 0) values.volumeRatio20d = entry.volume / mean;
    }
    const high20d = complete.every(validRange) ? Math.max(...complete.map((bar) => bar.high!)) : null;
    const high5d = complete.slice(0, 5).every(validRange) ? Math.max(...complete.slice(0, 5).map((bar) => bar.high!)) : null;
    const ranges = complete.slice(0, 14).map((bar, index) => validRange(bar)
      ? Math.max(bar.high - bar.low, Math.abs(bar.high - complete[index + 1].close), Math.abs(bar.low - complete[index + 1].close)) : null);
    const atr14 = ranges.every((value) => value !== null) ? average(ranges as number[]) : null;
    values.atr14Pct = atr14 === null ? null : atr14 / entry.close * 100;
    if (high20d !== null && high5d !== null && atr14 !== null) {
      const result = buildGate3PriceConfirmation({ currentPrice: entry.close, high20d, high5d, ma20, atr14 }, {});
      values.distanceHigh20dPct = result.distanceToHigh20dPct;
      values.priceSetup = result.status === 'DATA_UNAVAILABLE' ? null : result.status;
    }
    const benchmarkSymbol = series.market === 'KOSPI' ? '^KS11' : series.market === 'KOSDAQ' ? '^KQ11' : null;
    for (const benchmark of benchmarks.filter((item) => item.symbol === benchmarkSymbol)) {
      const indexBars = barMaps.get(benchmark.id)!;
      const current = indexBars.get(date);
      if (!current || priorDates.some((day) => !indexBars.has(day))) continue;
      values.relativeReturn20dPct = ((entry.close / complete[19].close - 1)
        - (current.close / indexBars.get(priorDates[19])!.close - 1)) * 100;
      values.benchmarkSeriesId = benchmark.id;
      break;
    }
    return values;
  };
}
