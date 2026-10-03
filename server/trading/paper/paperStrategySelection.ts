// @responsibility Measure how selectively the Shadow strategy buys among same-day baseline candidates.
import type { PaperExperiment } from '../../../src/types/paperExperiment.js';
import type { PaperStrategyCohort, PaperStrategySelection, PaperStrategyTrade } from '../../../src/types/paperStrategy.js';
import { addBusinessDaysFromKstDate } from '../krxHolidays.js';
import { paperStrategyCohort } from './paperStrategyEvidence.js';

const COHORTS: PaperStrategyCohort[] = ['NEWS_RECENT_ABOVE_MA20', 'NEWS_RECENT_BELOW_MA20', 'NEWS_ABSENT_ABOVE_MA20', 'NEWS_ABSENT_BELOW_MA20'];
const mean = (values: number[]) => values.length ? values.reduce((sum, value) => sum + value, 0) / values.length : null;

/** Read-only research: compares bought vs. not-bought candidates on the same date and horizon; never feeds decisions. */
export function buildPaperStrategySelection(trades: PaperStrategyTrade[], experiments: PaperExperiment[]): PaperStrategySelection {
  const dates = new Set(trades.map(trade => trade.tradingDate));
  const bought = new Map(trades.map(trade => [`${trade.symbol}:${trade.tradingDate}`, trade]));
  const candidates = [...new Map(experiments.filter(row => row.strategyVersion === 'shadow-baseline-v1' && dates.has(row.tradingDate))
    .map(row => [`${row.symbol}:${row.tradingDate}`, row])).values()];
  const bySymbol = new Map<string, PaperStrategyTrade[]>();
  for (const trade of trades) bySymbol.set(trade.symbol, [...(bySymbol.get(trade.symbol) ?? []), trade]);
  // A symbol held from an earlier entry is not re-evaluated that day, so it is neither bought nor rejected.
  const held = (row: PaperExperiment) => (bySymbol.get(row.symbol) ?? []).some(trade =>
    trade.tradingDate < row.tradingDate && (trade.policy?.exitModel === 'ADAPTIVE_OBSERVED'
      ? !trade.exit || Date.parse(row.entryAt) <= Date.parse(trade.exit.decisionAt)
      : row.tradingDate <= trade.scheduledExitDate));
  const cohorts = COHORTS.map(cohort => ({ cohort, candidateCount: 0, boughtCount: 0 }));
  let boughtCount = 0, heldCount = 0;
  for (const row of candidates) {
    const isBought = bought.has(`${row.symbol}:${row.tradingDate}`);
    if (isBought) boughtCount++; else if (held(row)) heldCount++;
    const cohort = cohorts.find(item => item.cohort === paperStrategyCohort(row.entryObservation, row.entryAt));
    if (!cohort) continue;
    cohort.candidateCount++;
    if (isBought) cohort.boughtCount++;
  }
  // Equal weight per entry date × horizon so a crowded day cannot dominate the difference.
  const groups = new Map<string, { strategy: number[]; unselected: number[]; all: number[] }>();
  for (const trade of trades) {
    // Observed exits have different durations; do not present them as matched fixed-horizon returns.
    if (trade.policy?.exitModel === 'ADAPTIVE_OBSERVED' || trade.status !== 'CLOSED' || !trade.exit || !Number.isFinite(trade.exit.netReturnPct)) continue;
    const key = `${trade.tradingDate}:${trade.horizon}`;
    if (!groups.has(key)) groups.set(key, { strategy: [], unselected: [], all: [] });
    groups.get(key)!.strategy.push(trade.exit.netReturnPct);
  }
  for (const [key, group] of groups) {
    const [date, horizonText] = key.split(':');
    const horizon = Number(horizonText);
    const due = addBusinessDaysFromKstDate(date, horizon);
    for (const row of candidates.filter(item => item.tradingDate === date)) {
      const outcome = row.outcomes.find(item => item.horizon === horizon && item.tradingDate === due && Number.isFinite(item.netReturnPct));
      if (!outcome) continue;
      group.all.push(outcome.netReturnPct);
      if (!bought.has(`${row.symbol}:${row.tradingDate}`)) group.unselected.push(outcome.netReturnPct);
    }
  }
  const compared = [...groups.values()].filter(group => group.unselected.length > 0);
  const strategyMeanPct = mean(compared.map(group => mean(group.strategy)!));
  const unselectedMeanPct = mean(compared.map(group => mean(group.unselected)!));
  return {
    dateCount: dates.size, candidateCount: candidates.length, boughtCount, heldCount,
    notBoughtCount: candidates.length - boughtCount - heldCount,
    selectionRatePct: candidates.length ? boughtCount / candidates.length * 100 : null,
    cohorts,
    comparison: {
      groupCount: compared.length,
      strategyTradeCount: compared.reduce((sum, group) => sum + group.strategy.length, 0),
      unselectedCount: compared.reduce((sum, group) => sum + group.unselected.length, 0),
      strategyMeanPct, unselectedMeanPct,
      baselineMeanPct: mean(compared.map(group => mean(group.all)!)),
      differencePct: strategyMeanPct !== null && unselectedMeanPct !== null ? strategyMeanPct - unselectedMeanPct : null,
    },
  };
}
