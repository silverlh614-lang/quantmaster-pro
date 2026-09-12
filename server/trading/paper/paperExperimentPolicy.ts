// @responsibility Evaluate independent paper experiments.
import { createHash } from 'node:crypto';
import type {
  PaperCostModel, PaperExperiment, PaperExperimentLedger, PaperExperimentView,
  PaperLearningGroup, PaperObservation, PaperOutcome, PaperSnapshot,
} from '../../../src/types/paperExperiment.js';
import { addBusinessDaysFromKstDate } from '../krxHolidays.js';
import { getExecutionCostConfig, type Market } from '../executionCosts.js';

export const PAPER_STRATEGY_VERSION = 'shadow-baseline-v1' as const;
const HORIZONS = [1, 3, 5] as const;

export function capturePaperCostModel(market: Market): PaperCostModel {
  const config = getExecutionCostConfig();
  const rates = {
    buyFeeRate: config.buyCommissionRate,
    sellFeeRate: config.sellCommissionRate,
    sellTaxRate: config.transferTaxRate[market] + config.ruralTaxRate[market],
    slippageRate: config.slippageRate,
  };
  return {
    version: `executionCosts-${createHash('sha256').update(JSON.stringify(rates)).digest('hex').slice(0, 16)}`,
    ...rates,
  };
}

export function paperExperimentId(symbol: string, tradingDate: string): string {
  return `${PAPER_STRATEGY_VERSION}:${tradingDate}:${symbol}`;
}

export function createPaperExperiment(
  snapshot: PaperSnapshot,
  observation: PaperObservation,
  costModel: PaperCostModel,
): PaperExperiment | null {
  const price = observation.price;
  if (!snapshot.marketOpen || price === null || !Number.isFinite(price) || price <= 0) return null;
  const cutoff = Date.parse(snapshot.asOf);
  if (!Number.isFinite(cutoff) || !Number.isFinite(Date.parse(observation.observedAt)) || Date.parse(observation.observedAt) > cutoff) return null;
  return {
    id: paperExperimentId(observation.symbol, snapshot.tradingDate),
    strategyVersion: PAPER_STRATEGY_VERSION,
    snapshotId: snapshot.id,
    symbol: observation.symbol,
    name: observation.name,
    entryAt: snapshot.asOf,
    tradingDate: snapshot.tradingDate,
    entryPrice: price,
    quantity: 1,
    entryObservation: {
      ...structuredClone(observation),
      news: observation.news.filter((item) => Date.parse(item.observedAt) <= cutoff).map((item) => ({ ...item })),
      dailyCloses: observation.dailyCloses.filter((item) => Date.parse(item.availableAt) <= cutoff).map((item) => ({ ...item })),
    },
    costModel: { ...costModel },
    status: 'OPEN',
    outcomes: [],
  };
}

/** Each horizon uses its exact calendar date; missing D1 is never relabelled D2. */
export function updatePaperOutcomes(
  experiment: PaperExperiment,
  observation: PaperObservation,
  asOf: string,
): PaperExperiment {
  const outcomes = [...experiment.outcomes];
  for (const horizon of HORIZONS) {
    if (outcomes.some((item) => item.horizon === horizon)) continue;
    const tradingDate = addBusinessDaysFromKstDate(experiment.tradingDate, horizon);
    const close = observation.dailyCloses.find((item) =>
      item.tradingDate === tradingDate && Number.isFinite(item.close) && item.close > 0
      && Date.parse(item.availableAt) <= Date.parse(asOf)
      && Date.parse(item.availableAt) >= Date.parse(`${tradingDate}T15:30:00+09:00`));
    if (!close) continue;
    const entry = experiment.entryPrice;
    const exit = close.close;
    const cost = experiment.costModel;
    // Same additive cost convention as executionCosts.computeNetPnL, with entry-frozen rates.
    const gross = exit - entry;
    const netPnl = gross - entry * (cost.buyFeeRate + cost.slippageRate)
      - exit * (cost.sellFeeRate + cost.sellTaxRate + cost.slippageRate);
    const outcome: PaperOutcome = {
      horizon, tradingDate, availableAt: close.availableAt, exitPrice: exit,
      grossReturnPct: gross / entry * 100,
      netReturnPct: netPnl / entry * 100,
      netPnl,
    };
    outcomes.push(outcome);
  }
  outcomes.sort((a, b) => a.horizon - b.horizon);
  return { ...experiment, outcomes, status: outcomes.some((item) => item.horizon === 5) ? 'COMPLETED' : 'OPEN' };
}

function summarize(label: string, values: number[]): PaperLearningGroup {
  return {
    label, count: values.length,
    meanNetReturnPct: values.length ? values.reduce((sum, value) => sum + value, 0) / values.length : null,
    winRatePct: values.length ? values.filter((value) => value > 0).length / values.length * 100 : null,
  };
}

export function buildPaperExperimentView(ledger: PaperExperimentLedger): PaperExperimentView {
  const d5Values = (test: (item: PaperExperiment) => boolean) => ledger.experiments.filter(test)
    .flatMap((item) => item.outcomes.filter((outcome) => outcome.horizon === 5).map((outcome) => outcome.netReturnPct));
  return {
    mode: 'SHADOW', strategyVersion: PAPER_STRATEGY_VERSION, lastRun: ledger.lastRun,
    totalCount: ledger.experiments.length,
    openCount: ledger.experiments.filter((item) => item.status === 'OPEN').length,
    completedCount: ledger.experiments.filter((item) => item.status === 'COMPLETED').length,
    outcomes: HORIZONS.map((horizon) => ({
      ...summarize(`D${horizon}`, ledger.experiments.flatMap((item) => item.outcomes
        .filter((outcome) => outcome.horizon === horizon).map((outcome) => outcome.netReturnPct))), horizon,
    })),
    groups: [
      summarize('NEWS_PRESENT', d5Values((item) => item.entryObservation.news.length > 0)),
      summarize('NEWS_ABSENT', d5Values((item) => item.entryObservation.news.length === 0)),
      summarize('ABOVE_MA20', d5Values((item) => item.entryObservation.aboveMa20 === true)),
      summarize('BELOW_MA20', d5Values((item) => item.entryObservation.aboveMa20 === false)),
      summarize('TREND_UNKNOWN', d5Values((item) => item.entryObservation.aboveMa20 === null)),
    ],
    experiments: ledger.experiments.slice(-200).reverse(),
  };
}
