/**
 * @responsibility ADR-0019 pre-breakout accumulation detection extracted from buyListLoop.
 */

import type { WatchlistEntry } from '../../../../persistence/watchlistRepo.js';
import { fetchKisQuoteFallback, fetchYahooQuote } from '../../../../screener/stockScreener.js';
import { fetchYahooQuoteByCode } from '../../../../screener/adapters/yahooSymbolResolver.js';
import { logNoiseDetail } from '../../../../utils/logger.js';
import { detectPreBreakoutAccumulation } from '../../../preBreakoutAccumulationDetector.js';
import type { BuyListLoopContext } from '../types.js';

export type PreBreakoutAccumulationQuote =
  | NonNullable<Awaited<ReturnType<typeof fetchYahooQuoteByCode>>>
  | NonNullable<Awaited<ReturnType<typeof fetchKisQuoteFallback>>>;

export interface PreBreakoutAccumulationDetected {
  quote: PreBreakoutAccumulationQuote;
  result: ReturnType<typeof detectPreBreakoutAccumulation>;
}

export async function detectPreBreakoutAccumulationStep(
  ctx: BuyListLoopContext,
  stock: WatchlistEntry,
  currentPrice: number,
  nearEntryThreshold: number,
): Promise<PreBreakoutAccumulationDetected | null> {
  const priceDiffPct = ((currentPrice - stock.entryPrice) / stock.entryPrice * 100).toFixed(1);
  ctx.scanCounters.preBreakoutPriceDistance++;
  logNoiseDetail({
    category: 'PRE_BREAKOUT_PRICE_DISTANCE',
    message: `[AutoTrade] ${stock.name}(${stock.code}) 진입가 미도달 — ` +
      `현재가 ${currentPrice.toLocaleString()} vs 진입가 ${stock.entryPrice.toLocaleString()} (${priceDiffPct}%, 기준 ±${(nearEntryThreshold * 100).toFixed(0)}%) → Pre-Breakout 판별 ` +
      `actionable=false executionImpact=NONE telegram=false`,
  });

  const quote = await fetchYahooQuoteByCode(stock.code, fetchYahooQuote)
    ?? await fetchKisQuoteFallback(stock.code).catch(() => null);
  if (
    quote == null ||
    (quote.recentCloses10d?.length ?? 0) < 5 ||
    (quote.recentVolumes10d?.length ?? 0) < 4 ||
    (quote.recentHighs10d?.length ?? 0) < 6 ||
    (quote.recentLows10d?.length ?? 0) < 6
  ) {
    return null;
  }

  return {
    quote,
    result: detectPreBreakoutAccumulation({
      recentCloses: quote.recentCloses10d!,
      recentVolumes: quote.recentVolumes10d!,
      avgVolume20d: quote.avgVolume,
      recentHighs: quote.recentHighs10d!,
      recentLows: quote.recentLows10d!,
      atrRatio: quote.price > 0 ? quote.atr / quote.price : 0.02,
      foreignNetBuy5d: ctx.macroState?.foreignNetBuy5d ?? 0,
      institutionalNetBuy5d: 0,
    }),
  };
}
