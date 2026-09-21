// @responsibility Project complete observation ledgers into compact read-only daily evaluation evidence.
import type { PaperExperiment, PaperExperimentView } from '../../../src/types/paperExperiment.js';
import type { PaperBotState } from '../../persistence/paperBotRepo.js';
import type { PaperFinancialCache } from '../../persistence/paperFinancialRepo.js';
import { toKstDateKey, isKrxTradingDay } from '../../calendar/krxTradingCalendar.js';
import { addBusinessDaysFromKstDate } from '../krxHolidays.js';

const distinct = (items: string[]) => new Set(items).size;
const horizons = [1, 3, 5] as const;
function summarize(rows: PaperExperiment[]) {
  return { count: rows.length, symbolCount: distinct(rows.map(row => row.symbol)), entryDateCount: distinct(rows.map(row => row.tradingDate)),
    horizons: horizons.map(horizon => {
      const matching = rows.flatMap(row => row.outcomes.filter(outcome => outcome.horizon === horizon).map(outcome => ({ row, outcome })));
      return { horizon, count: matching.length, symbolCount: distinct(matching.map(({ row }) => row.symbol)),
        entryDateCount: distinct(matching.map(({ row }) => row.tradingDate)),
        meanNetReturnPct: matching.length ? matching.reduce((sum, item) => sum + item.outcome.netReturnPct, 0) / matching.length : null,
        winRatePct: matching.length ? 100 * matching.filter(item => item.outcome.netReturnPct > 0).length / matching.length : null };
    }) };
}
export function buildPaperEvaluation(view: PaperExperimentView, bot: PaperBotState | null, financialCache: PaperFinancialCache | null, now: Date) {
  const date = toKstDateKey(now), rows = view.experiments, trades = view.strategy?.trades ?? [];
  const dates = [...new Set(rows.map(row => row.tradingDate))].sort();
  const coverage = view.lastRun?.featureCoverage;
  const financials = Object.values(financialCache?.records ?? {}).map(row => row.facts);
  const ages = financials.map(row => (now.getTime() - Date.parse(row.observedAt)) / 3_600_000);
  const periods = new Map<string, number>();
  for (const facts of financials) {
    const key = `KIS ${facts.kis?.period ?? '미확인'} / DART ${facts.dart?.period ?? '미확인'}`;
    periods.set(key, (periods.get(key) ?? 0) + 1);
  }
  const featureRows = rows.filter(row => row.entryObservation.features);
  const audit = {
    completeLedger: rows.length === view.totalCount && (!view.strategy || trades.length === view.strategy.totalCount),
    duplicateIds: rows.length - distinct(rows.map(row => row.id)),
    duplicateSymbolDates: rows.length - distinct(rows.map(row => `${row.symbol}:${row.tradingDate}`)),
    duplicateTradeIds: trades.length - distinct(trades.map(row => row.id)),
    duplicateTradeSymbolDates: trades.length - distinct(trades.map(row => `${row.symbol}:${row.tradingDate}`)),
    invalidEntryTimes: rows.filter(row => !isKrxTradingDay(row.tradingDate) || toKstDateKey(row.entryAt) !== row.tradingDate
      || !(Date.parse(row.entryAt) <= now.getTime()) || Date.parse(row.entryAt) < Date.parse(`${row.tradingDate}T09:00:00+09:00`)
      || Date.parse(row.entryAt) >= Date.parse(`${row.tradingDate}T15:30:00+09:00`)).length,
    futureEntryEvidence: rows.filter(row => Date.parse(row.entryObservation.observedAt) > Date.parse(row.entryAt)
      || Date.parse(row.entryObservation.features?.asOf ?? '') > Date.parse(row.entryAt)
      || Date.parse(row.entryObservation.features?.financials?.observedAt ?? '') > Date.parse(row.entryAt)
      || Date.parse(row.entryObservation.investorFlow?.observedAt ?? '') > Date.parse(row.entryAt)
      || row.entryObservation.news.some(news => Date.parse(news.observedAt) > Date.parse(row.entryAt))).length,
    invalidOutcomes: rows.reduce((sum, row) => sum + row.outcomes.filter(outcome => outcome.tradingDate !== addBusinessDaysFromKstDate(row.tradingDate, outcome.horizon)
      || !(Date.parse(outcome.availableAt) <= now.getTime()) || Date.parse(outcome.availableAt) < Date.parse(`${outcome.tradingDate}T15:30:00+09:00`)).length
      + row.outcomes.length - distinct(row.outcomes.map(outcome => String(outcome.horizon))), 0),
  };
  const cohortCounts = new Map<string, number>();
  for (const trade of trades) { const key = `${trade.tradingDate}:${trade.entryDecision.cohort}:D${trade.horizon}`; cohortCounts.set(key, (cohortCounts.get(key) ?? 0) + 1); }
  return { generatedAt: now.toISOString(), date, tradingDay: isKrxTradingDay(date), mode: view.mode,
    lastRun: view.lastRun, collection: view.collection ?? null, audit,
    baseline: { ...summarize(rows), completedCount: view.completedCount,
      byEntryDate: dates.map(date => ({ date, ...summarize(rows.filter(row => row.tradingDate === date)) })) },
    features: { recordedCount: featureRows.length, entryDateCount: distinct(featureRows.map(row => row.tradingDate)),
      meanCoveragePct: coverage?.candidateCount ? 100 * Object.values(coverage.available).reduce((sum, value) => sum + value, 0) / (26 * coverage.candidateCount) : null,
      mature: summarize(featureRows).horizons,
      studies: view.featureStudy?.features.filter(feature => feature.groups.some(group => group.outcomes.some(outcome => outcome.count > 0))) ?? [] },
    financials: { available: financialCache !== null, count: financials.length, minAgeHours: ages.length ? Math.min(...ages) : null,
      maxAgeHours: ages.length ? Math.max(...ages) : null, stale48h: ages.filter(age => age > 48).length,
      future: ages.filter(age => age < 0).length, periods: Object.fromEntries(periods) },
    news: view.newsStudy, newsFacts: view.newsFactsStudy, investorFlow: view.investorFlowStudy,
    strategy: view.strategy ? { version: view.strategy.strategyVersion, policy: view.strategy.policy, totalCount: view.strategy.totalCount,
      openCount: view.strategy.openCount, performance: view.strategy.performance, error: view.strategy.error ?? view.strategy.lastRun?.error ?? null,
      entryDateCount: distinct(trades.map(row => row.tradingDate)), cohorts: Object.fromEntries(cohortCounts),
      nextExits: [...new Set(trades.filter(row => !row.exit).map(row => row.scheduledExitDate))].sort().slice(0, 5),
      evidence: trades.slice(0, 1).map(row => { const e = row.entryDecision.evidence; return e ? {
        sampleCount: e.sampleCount, entryDateCount: e.entryDateCount, baselineSampleCount: e.baselineSampleCount,
        historicalSampleCount: e.historicalSampleCount, horizons: e.horizons } : null; }) } : null,
    research: view.research ? { asOf: view.research.asOf, sampleCount: view.research.sampleCount, learningSampleCount: view.research.learningSampleCount,
      symbols: view.research.symbols, error: view.research.error ?? null, features: view.research.featureStudies?.map(row => ({
        feature: row.feature, status: row.status, testCount: row.testCount, testDateCount: row.testDateCount,
        matchedDifferencePct: row.matchedDifferencePct })) } : null,
    bot: bot ? { health: bot.health, lastCheckedAt: bot.lastCheckedAt,
      pending: bot.messages.filter(row => row.state === 'PENDING').length, failed: bot.messages.filter(row => row.state === 'FAILED').length,
      today: bot.messages.filter(row => toKstDateKey(row.createdAt) === date).map(({ id, kind, channel, state, attempts, sentAt, messageId, health, error }) =>
        ({ id, kind, channel, state, attempts, sentAt, messageId, health, error })) } : null,
  };
}
