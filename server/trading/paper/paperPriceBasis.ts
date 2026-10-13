// @responsibility Keep pre-event Shadow positions on their entry price basis when KIS re-bases a stock's prices.
import type { PaperDailyClose, PaperObservation } from '../../../src/types/paperExperiment.js';
import type { PaperStrategyTrade } from '../../../src/types/paperStrategy.js';

/**
 * KIS daily bars are adjusted prices. After a share-count change (병합·분할·무상증자·감자) KIS rescales every earlier
 * close, so the same past session reads differently than it did at entry. An unchanged series repeats the same
 * whole-won close; anything wider than this is a re-basing.
 */
const BASIS_TOLERANCE = 0.002;
/** KRX daily price limit. Without daily bars, a held price beyond it versus the last accepted price waits for a bar check. */
const DAILY_LIMIT = 0.3;
export const PAPER_PRICE_BASIS_UNCONFIRMED = 'PRICE_BASIS_UNCONFIRMED';

const positive = (value: unknown): value is number => typeof value === 'number' && Number.isFinite(value) && value > 0;

/** Ratio of today's close to the close recorded at entry on the latest shared session before entry; null without one. */
export function paperPriceBasisFactor(entryBars: readonly PaperDailyClose[], currentBars: readonly PaperDailyClose[],
  entryDate: string): { factor: number; referenceDate: string } | null {
  const current = new Map(currentBars.filter(bar => positive(bar.close)).map(bar => [bar.tradingDate, bar.close]));
  const reference = entryBars.filter(bar => bar.tradingDate < entryDate && positive(bar.close) && current.has(bar.tradingDate))
    .sort((a, b) => b.tradingDate.localeCompare(a.tradingDate))[0];
  if (!reference) return null;
  const factor = current.get(reference.tradingDate)! / reference.close;
  return { factor: Math.abs(factor - 1) <= BASIS_TOLERANCE ? 1 : factor, referenceDate: reference.tradingDate };
}

/** Prices divided by the factor read on the entry basis; volumes and features stay as observed. */
export function scalePaperObservation(observation: PaperObservation, factor: number): PaperObservation {
  if (factor === 1) return observation;
  return { ...observation, price: observation.price === null ? null : observation.price / factor,
    dailyCloses: observation.dailyCloses.map(bar => {
      const scaled = { ...bar, close: bar.close / factor };
      for (const key of ['open', 'high', 'low'] as const) if (bar[key] !== undefined) scaled[key] = bar[key]! / factor;
      return scaled;
    }) };
}

/**
 * The observation a held trade may use. Daily bars set the factor (recorded on the trade when `checkedAt` is given);
 * quote-only prices reuse the recorded factor, and a jump beyond the daily limit carries no price until bars confirm it.
 */
export function paperTradeObservation(trade: PaperStrategyTrade, observation: PaperObservation | undefined,
  checkedAt?: string): PaperObservation | undefined {
  if (!observation || observation.symbol !== trade.symbol) return observation;
  const basis = paperPriceBasisFactor(trade.entryObservation.dailyCloses, observation.dailyCloses, trade.tradingDate);
  if (basis && checkedAt) {
    if (basis.factor === 1) delete trade.priceBasis;
    else if (trade.priceBasis?.factor !== basis.factor) trade.priceBasis = { ...basis, checkedAt };
  }
  const scaled = scalePaperObservation(observation, basis?.factor ?? trade.priceBasis?.factor ?? 1);
  const last = trade.measurement?.latest.price;
  if (!basis && positive(scaled.price) && positive(last) && Math.abs(scaled.price / last - 1) > DAILY_LIMIT) {
    return { ...scaled, price: null, issue: PAPER_PRICE_BASIS_UNCONFIRMED };
  }
  return scaled;
}
