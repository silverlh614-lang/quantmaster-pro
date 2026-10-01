// @responsibility Measure 20-session close-to-close outcomes of archived research samples.
import type { HistoricalPaperSample, PaperLongHorizonStudy, ResearchArchive } from '../../../src/types/paperResearch.js';
import { addBusinessDaysFromKstDate } from '../krxHolidays.js';
import { isKrxTradingDay } from '../../calendar/krxTradingCalendar.js';
import { calculatePaperReturn } from './paperAccounting.js';
import { featureDefinitions } from './paperResearchComparison.js';

const HORIZON = 20;
const closeAt = (date: string) => Date.parse(`${date}T15:30:00+09:00`);
const mean = (values: number[]) => values.length ? values.reduce((sum, value) => sum + value, 0) / values.length : null;

function priceMap(series: ResearchArchive['series'][number], cutoff: number): Map<string, number> {
  const prices = new Map<string, number>();
  const conflicts = new Set<string>();
  for (const bar of series.closes) {
    if (!isKrxTradingDay(bar.date) || !Number.isFinite(bar.close) || bar.close <= 0
      || closeAt(bar.date) > Math.min(cutoff, Date.parse(series.retrievedAt))) continue;
    if (prices.has(bar.date) && prices.get(bar.date) !== bar.close) conflicts.add(bar.date);
    prices.set(bar.date, bar.close);
  }
  for (const date of conflicts) prices.delete(date);
  return prices;
}

/** Overlapping 20-session windows are not independent; the view reports dates, not just rows. */
export function buildLongHorizonStudy(archive: ResearchArchive, samples: HistoricalPaperSample[], asOf: string): PaperLongHorizonStudy {
  const cutoff = Date.parse(asOf);
  const series = new Map(archive.series.map(item => [item.id, item]));
  const prices = new Map<string, Map<string, number>>();
  const pricesOf = (id: string) => {
    if (!prices.has(id)) prices.set(id, series.has(id) ? priceMap(series.get(id)!, cutoff) : new Map());
    return prices.get(id)!;
  };
  const benchmarks = archive.series.filter(item => ['^KS11', '^KQ11'].includes(item.symbol))
    .sort((a, b) => Number(b.source === 'KIS_SNAPSHOT') - Number(a.source === 'KIS_SNAPSHOT') || b.retrievedAt.localeCompare(a.retrievedAt));
  const rows = samples.flatMap(sample => {
    const due = addBusinessDaysFromKstDate(sample.tradingDate, HORIZON);
    const exit = pricesOf(sample.seriesId).get(due);
    if (!exit || closeAt(due) > cutoff) return [];
    const net = calculatePaperReturn(sample.entryPrice, exit, sample.costModel).netReturnPct;
    const market = series.get(sample.seriesId)?.market;
    const symbol = market === 'KOSDAQ' ? '^KQ11' : market === 'KOSPI' ? '^KS11' : null;
    let excess: number | null = null;
    for (const benchmark of benchmarks.filter(item => item.symbol === symbol)) {
      const index = pricesOf(benchmark.id);
      const [start, end] = [index.get(sample.tradingDate), index.get(due)];
      if (start && end) { excess = net - (end / start - 1) * 100; break; }
    }
    return [{ sample, due, net, excess, cell: `${sample.tradingDate}:${sample.cohort ?? `UNKNOWN_${sample.aboveMa20}`}` }];
  });
  const dates = [...new Set(rows.map(row => row.sample.tradingDate))].sort();
  const splitDate = dates.length >= 2 ? dates[Math.floor(dates.length * 0.7)] : null;
  const excess = rows.flatMap(row => row.excess === null ? [] : [row.excess]);
  const features = featureDefinitions.map(([feature, label]) => {
    const available = rows.filter(row => {
      const value = row.sample.features?.[feature];
      return typeof value === 'number' ? Number.isFinite(value) : typeof value === 'string';
    });
    // Purge training rows whose 20-session label reaches the test period.
    const train = splitDate ? available.filter(row => row.due < splitDate) : [];
    const test = splitDate ? available.filter(row => row.sample.tradingDate >= splitDate) : [];
    const numbers = train.map(row => row.sample.features![feature]).filter((v): v is number => typeof v === 'number').sort((a, b) => a - b);
    const mid = Math.floor(numbers.length / 2);
    const threshold = numbers.length ? numbers.length % 2 ? numbers[mid] : (numbers[mid - 1] + numbers[mid]) / 2 : null;
    const bucket = (row: typeof rows[number]) => {
      const value = row.sample.features![feature];
      return typeof value === 'string' ? value : threshold === null ? '미분류' : value! <= threshold ? '하위' : '상위';
    };
    const base = { feature, label, availableCount: available.length, trainingCount: train.length, selectedGroup: null as string | null,
      testCount: 0, testDateCount: 0, matchedDifferencePct: null as number | null,
      status: (available.length ? 'NO_TRAIN_VARIATION' : 'MISSING_INPUT') as PaperLongHorizonStudy['features'][number]['status'] };
    const groups = [...new Set(train.map(bucket))];
    if (groups.length < 2) return base;
    const winner = groups.map(group => ({ group, score: mean(train.filter(row => bucket(row) === group).map(row => row.net))! }))
      .sort((a, b) => b.score - a.score || a.group.localeCompare(b.group))[0].group;
    const selected = test.filter(row => bucket(row) === winner);
    const differences = [...new Set(selected.map(row => row.cell))].map(cell =>
      mean(selected.filter(row => row.cell === cell).map(row => row.net))! - mean(test.filter(row => row.cell === cell).map(row => row.net))!);
    return { ...base, selectedGroup: winner, testCount: selected.length,
      testDateCount: new Set(selected.map(row => row.sample.tradingDate)).size, matchedDifferencePct: mean(differences),
      status: selected.length ? 'EVALUATED' as const : 'NO_TEST_MATCH' as const };
  });
  return { horizon: HORIZON, sampleCount: rows.length, symbolCount: new Set(rows.map(row => row.sample.symbol)).size,
    entryDateCount: dates.length, firstDate: dates[0] ?? null, lastDate: dates.at(-1) ?? null,
    meanNetReturnPct: mean(rows.map(row => row.net)),
    winRatePct: rows.length ? rows.filter(row => row.net > 0).length / rows.length * 100 : null,
    excessCount: excess.length, meanExcessReturnPct: mean(excess), splitDate, features };
}
