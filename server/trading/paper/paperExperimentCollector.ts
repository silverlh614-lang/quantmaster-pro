// @responsibility Collect paper experiment observations.
import { randomUUID } from 'node:crypto';
import type { PaperNewsObservation, PaperObservation, PaperSnapshot } from '../../../src/types/paperExperiment.js';
import { getExpandedUniverse } from '../../screener/dynamicUniverseExpander.js';
import { loadWatchlist } from '../../persistence/watchlistRepo.js';
import { loadDartAlerts } from '../../persistence/dartRepo.js';
import { loadNewsSupplyRecords } from '../../learning/newsSupplyLogger.js';
import { toKstDateKey, isKrxTradingDay, previousKrxTradingDay } from '../../calendar/krxTradingCalendar.js';
import { collectUnifiedSnapshot } from '../symbolDataCollector.js';
import { researchBarFields } from './paperResearchFeatures.js';
import { assessPaperNews } from './paperNewsAssessment.js';
import { observePaperInvestorFlow } from './paperInvestorFlowCollector.js';

function codeOf(input: string): string | null {
  const code = input.trim().replace(/\.(KS|KQ)$/i, '');
  return /^\d{6}$/.test(code) ? code : null;
}

export function isPaperMarketOpen(now: Date): boolean {
  const minutes = new Date(now.getTime() + 9 * 3_600_000);
  const clock = minutes.getUTCHours() * 60 + minutes.getUTCMinutes();
  return isKrxTradingDay(toKstDateKey(now)) && clock >= 540 && clock < 930;
}

export async function collectPaperExperimentSnapshot(
  openSymbols: string[], onProgress?: (completed: number, total: number) => void,
): Promise<PaperSnapshot> {
  const startedAt = new Date();
  const startMs = startedAt.getTime();
  const names = new Map<string, string>();
  const news = new Map<string, PaperNewsObservation[]>();
  const addNews = (symbol: string, item: PaperNewsObservation) => {
    const code = codeOf(symbol);
    if (!code || !Number.isFinite(Date.parse(item.observedAt)) || Date.parse(item.observedAt) > startMs) return;
    const items = news.get(code) ?? [];
    if (!items.some((existing) => existing.id === item.id)) {
      items.push({ ...item, assessment: assessPaperNews(item, startedAt.toISOString()) });
    }
    news.set(code, items);
  };
  // Candidate admission is independent of the retired regime/Gate watchlist pipeline.
  for (const item of [...getExpandedUniverse(), ...loadWatchlist()]) {
    const code = codeOf(item.code);
    if (code) names.set(code, item.name);
  }
  for (const item of loadNewsSupplyRecords()) {
    for (const symbol of item.koreanStockCodes ?? []) {
      addNews(symbol, { id: item.id, headline: item.newsHeadline, observedAt: item.detectedAt, source: item.source });
    }
  }
  for (const item of loadDartAlerts()) {
    addNews(item.stock_code, { id: `dart:${item.rcept_no}`, headline: item.report_nm, observedAt: item.alertedAt, source: 'DART' });
  }
  const codes = [...new Set([...names.keys(), ...news.keys(), ...openSymbols.map(codeOf).filter((code): code is string => code !== null)])];
  const id = `paper_${randomUUID()}`;
  const source = await collectUnifiedSnapshot(codes, { scanCycleId: id, profile: 'PAPER', onProgress });
  const finishedAt = new Date();
  const asOf = finishedAt.toISOString();
  const tradingDate = toKstDateKey(finishedAt);
  const observations: PaperObservation[] = codes.map((symbol) => {
    const data = source.perSymbol[symbol];
    const quote = data?.quote;
    const quoteMs = Date.parse(quote?.fetchedAt ?? '');
    const issue = !quote ? 'CURRENT_QUOTE_UNAVAILABLE'
      : quote.code !== symbol ? 'CURRENT_QUOTE_SYMBOL_MISMATCH'
        : !Number.isFinite(quote.currentPrice) || (quote.currentPrice ?? 0) <= 0 ? 'CURRENT_QUOTE_INVALID_PRICE'
          : !Number.isFinite(quoteMs) || quoteMs > finishedAt.getTime() ? 'CURRENT_QUOTE_TIME_INVALID'
            : quoteMs < startMs ? 'CURRENT_QUOTE_STALE' : undefined;
    const validQuote = issue === undefined;
    const dailyCloses = (data?.dailyBars ?? []).flatMap((bar) => {
      const date = bar.date.replace(/^(\d{4})(\d{2})(\d{2})$/, '$1-$2-$3');
      const closedAt = Date.parse(`${date}T15:30:00+09:00`);
      if (!isKrxTradingDay(date) || !Number.isFinite(closedAt) || !Number.isFinite(bar.close) || bar.close <= 0 || closedAt > startMs) return [];
      return [{ tradingDate: date, close: bar.close, availableAt: asOf, ...researchBarFields(bar) }];
    }).sort((a, b) => b.tradingDate.localeCompare(a.tradingDate));
    const priorCloses = dailyCloses.filter((item) => item.tradingDate < tradingDate);
    let referenceDate = tradingDate;
    const priorDates = Array.from({ length: 5 }, () => {
      referenceDate = previousKrxTradingDay(new Date(`${referenceDate}T12:00:00+09:00`));
      return referenceDate;
    });
    const previousClose = priorCloses.find((item) => item.tradingDate === priorDates[0]);
    const fifthClose = priorCloses.find((item) => item.tradingDate === priorDates[4]);
    const price = validQuote ? quote!.currentPrice : null;
    const average20 = priorCloses.length >= 20 ? priorCloses.slice(0, 20).reduce((sum, item) => sum + item.close, 0) / 20 : null;
    return {
      symbol, name: names.get(symbol) || data?.name || symbol,
      price, observedAt: quote?.fetchedAt ?? asOf, source: 'KIS_REST_REQUEST_OBSERVED',
      ...(data?.market === 'KOSPI' || data?.market === 'KOSDAQ' ? { market: data.market } : {}),
      return1dPct: price !== null && previousClose ? (price / previousClose.close - 1) * 100 : null,
      return5dPct: price !== null && fifthClose ? (price / fifthClose.close - 1) * 100 : null,
      aboveMa20: price !== null && average20 !== null ? price > average20 : null,
      news: news.get(symbol) ?? [], dailyCloses,
      investorFlow: observePaperInvestorFlow(symbol, data?.investorFlow, dailyCloses, asOf),
      ...(issue ? { issue } : {}),
    };
  });
  return { id, asOf, tradingDate, marketOpen: isPaperMarketOpen(startedAt) && isPaperMarketOpen(finishedAt), observations };
}
