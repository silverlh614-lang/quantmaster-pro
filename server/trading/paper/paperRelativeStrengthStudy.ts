// @responsibility Compare same-day upper vs lower index-relative strength in live Shadow samples.
import type { PaperExperiment, PaperRelativeStrengthStudy } from '../../../src/types/paperExperiment.js';
import type { ResearchSeries } from '../../../src/types/paperResearch.js';
import { addBusinessDaysFromKstDate } from '../krxHolidays.js';
import { paperStrategyCohort } from './paperStrategyEvidence.js';

const HORIZONS = [1, 3, 5] as const;
const mean = (values: number[]) => values.length ? values.reduce((sum, value) => sum + value, 0) / values.length : null;

/**
 * Uses only sessions completed before entry: the last completed close vs the close 20 index sessions earlier,
 * minus the same-date KOSPI/KOSDAQ change. Each date × news/MA20 cohort cell is split at its own median.
 */
export function buildPaperRelativeStrengthStudy(experiments: PaperExperiment[], indices: ResearchSeries[], asOf: string): PaperRelativeStrengthStudy {
  const cutoff = Date.parse(asOf);
  const index = new Map(indices.map(series => {
    const bars = [...series.closes].sort((a, b) => a.date.localeCompare(b.date));
    return [series.symbol, { dates: bars.map(bar => bar.date), closes: new Map(bars.map(bar => [bar.date, bar.close])) }] as const;
  }));
  const rows = [...new Map(experiments.filter(row => row.strategyVersion === 'shadow-baseline-v1' && Date.parse(row.entryAt) <= cutoff)
    .map(row => [`${row.symbol}:${row.tradingDate}`, row])).values()];
  const measured: Array<{ row: PaperExperiment; value: number; cell: string }> = [];
  for (const row of rows) {
    const market = index.get(row.entryObservation.market === 'KOSDAQ' ? '^KQ11' : '^KS11');
    if (!market) continue;
    const prior = market.dates.filter(date => date < row.tradingDate);
    if (prior.length < 21) continue;
    const [start, end] = [prior[prior.length - 21], prior[prior.length - 1]];
    const closes = new Map(row.entryObservation.dailyCloses.map(bar => [bar.tradingDate, bar.close]));
    const [s0, s1, i0, i1] = [closes.get(start), closes.get(end), market.closes.get(start), market.closes.get(end)];
    if (!s0 || !s1 || !i0 || !i1) continue;
    measured.push({ row, value: ((s1 / s0 - 1) - (i1 / i0 - 1)) * 100,
      cell: `${row.tradingDate}:${paperStrategyCohort(row.entryObservation, row.entryAt) ?? 'TREND_UNKNOWN'}` });
  }
  const horizons = HORIZONS.map(horizon => {
    const cells = new Map<string, Array<{ value: number; ret: number; date: string }>>();
    for (const item of measured) {
      const due = addBusinessDaysFromKstDate(item.row.tradingDate, horizon);
      const outcome = item.row.outcomes.find(entry => entry.horizon === horizon && entry.tradingDate === due
        && Number.isFinite(entry.netReturnPct) && Date.parse(entry.availableAt) <= cutoff);
      if (!outcome) continue;
      cells.set(item.cell, [...(cells.get(item.cell) ?? []), { value: item.value, ret: outcome.netReturnPct, date: item.row.tradingDate }]);
    }
    const uppers: number[] = [], lowers: number[] = [], dates = new Set<string>();
    let sampleCount = 0;
    for (const members of cells.values()) {
      if (members.length < 2) continue;
      const sorted = [...members].sort((a, b) => a.value - b.value);
      const half = Math.floor(sorted.length / 2);
      // An odd middle row is left out so both halves are the same size.
      uppers.push(mean(sorted.slice(sorted.length - half).map(item => item.ret))!);
      lowers.push(mean(sorted.slice(0, half).map(item => item.ret))!);
      sampleCount += half * 2;
      dates.add(members[0].date);
    }
    const upperMeanPct = mean(uppers), lowerMeanPct = mean(lowers);
    return { horizon, cellCount: uppers.length, upperWinCount: uppers.filter((value, i) => value > lowers[i]).length,
      entryDateCount: dates.size, sampleCount, upperMeanPct, lowerMeanPct,
      differencePct: upperMeanPct !== null && lowerMeanPct !== null ? upperMeanPct - lowerMeanPct : null };
  });
  return { experimentCount: rows.length, measuredCount: measured.length,
    indexReady: index.has('^KS11') && index.has('^KQ11'), horizons };
}
