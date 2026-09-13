// @responsibility Read archived research inputs.
import fs from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';
import type { ResearchArchive, ResearchInventory, ResearchNews, ResearchSeries } from '../../../src/types/paperResearch.js';
import type { PaperObservation } from '../../../src/types/paperExperiment.js';
import { toKstDateKey } from '../../calendar/krxTradingCalendar.js';
import { researchBarFields } from './paperResearchFeatures.js';

type Row = Record<string, any>;
const object = (value: unknown): value is Row => Boolean(value && typeof value === 'object' && !Array.isArray(value));
const symbol = (value: unknown): string | null => {
  if (typeof value !== 'string') return null;
  const code = value.replace(/\.(KS|KQ)$/i, '');
  return /^\d{6}$/.test(code) ? code : null;
};
const hash = (value: unknown) => createHash('sha256').update(JSON.stringify(value)).digest('hex').slice(0, 24);

export function seriesFromObservations(observations: PaperObservation[], retrievedAt: string): ResearchSeries[] {
  return observations.flatMap((item) => {
    // This collector's dailyCloses originate from the existing KIS daily-bar channel.
    if (!['KIS_REST_REQUEST_OBSERVED', 'KIS'].includes(item.source) || !symbol(item.symbol)) return [];
    const closes = item.dailyCloses.filter((bar) => Number.isFinite(bar.close) && bar.close > 0)
      .filter((bar) => Date.parse(bar.availableAt) <= Date.parse(retrievedAt))
      .map((bar) => ({ date: bar.tradingDate, close: bar.close, ...researchBarFields(bar) }));
    return [{ id: `kis:${item.symbol}:${hash(closes)}`, symbol: item.symbol, market: item.market,
      source: 'KIS_SNAPSHOT' as const, retrievedAt, closes }];
  });
}

export function readPaperResearchSources(dataDir: string, asOf: string): ResearchArchive {
  const inventory: ResearchInventory[] = [];
  const read = (file: string): any => {
    const target = path.join(dataDir, file);
    if (!fs.existsSync(target)) { inventory.push({ file, records: 0, status: 'MISSING' }); return null; }
    try {
      const value: unknown = JSON.parse(fs.readFileSync(target, 'utf8'));
      const rows = Array.isArray(value) ? value : object(value) ? value.entries ?? value.experiments ?? value.samples ?? value.records : null;
      if (!Array.isArray(rows)) throw new Error('지원하지 않는 저장 형식');
      inventory.push({ file, records: rows.length, status: 'FOUND' });
      return rows;
    } catch (error) {
      inventory.push({ file, records: 0, status: 'ERROR', issue: error instanceof Error ? error.message : String(error) });
      return null;
    }
  };
  const series: ResearchSeries[] = [];
  const chartStore = read('offhours-snapshot.json');
  for (const item of chartStore ?? []) {
    if (!object(item) || typeof item.key !== 'string' || !/:1d$/.test(item.key)) continue;
    const ticker = item.key.split(':')[0];
    const code = symbol(ticker) ?? (['^KS11', '^KQ11'].includes(ticker) ? ticker : null);
    const fetched = item.entry?.fetchedAt;
    if (!code || !Number.isFinite(fetched) || fetched > Date.parse(asOf)) continue;
    try {
      const body = JSON.parse(item.entry.body);
      const chart = body.chart?.result?.[0];
      if (!Array.isArray(chart?.timestamp) || !Array.isArray(chart?.indicators?.quote?.[0]?.close)) continue;
      const quote = chart.indicators.quote[0];
      const closes = chart.timestamp.map((time: number, index: number) => ({
        date: Number.isFinite(time) ? toKstDateKey(new Date(time * 1000)) : '',
        close: quote.close[index],
        ...researchBarFields({ open: quote.open?.[index], high: quote.high?.[index], low: quote.low?.[index], volume: quote.volume?.[index] }),
      })).filter((bar: { date: string; close: number }) => bar.date && Number.isFinite(bar.close) && bar.close > 0);
      series.push({ id: `chart:${code}:${hash(closes)}`, symbol: code,
        market: ticker.endsWith('.KQ') || ticker === '^KQ11' ? 'KOSDAQ' : 'KOSPI', source: 'ARCHIVED_CHART',
        retrievedAt: new Date(fetched).toISOString(), closes });
    } catch {
      inventory.push({ file: `offhours-snapshot.json:${item.key}`, records: 0, status: 'ERROR', issue: '차트 본문 해석 실패' });
    }
  }
  const baseline = read('paper-experiments.json');
  for (const item of baseline ?? []) {
    if (!object(item?.entryObservation) || !Array.isArray(item.entryObservation.dailyCloses)) continue;
    series.push(...seriesFromObservations([item.entryObservation], item.entryAt));
  }
  const news: ResearchNews[] = [];
  const addNews = (code: unknown, id: unknown, at: unknown, headline: unknown, source: string) => {
    const normalized = symbol(code);
    if (!normalized || typeof id !== 'string' || typeof at !== 'string' || !Number.isFinite(Date.parse(at))
      || Date.parse(at) > Date.parse(asOf) || typeof headline !== 'string') return;
    news.push({ symbol: normalized, id: `${source}:${id}`, observedAt: at, headline, source });
  };
  for (const item of read('news-supply-log.json') ?? []) {
    if (!object(item)) continue;
    for (const code of Array.isArray(item.koreanStockCodes) ? item.koreanStockCodes : []) {
      addNews(code, item.id, item.detectedAt, item.newsHeadline, 'NEWS_SUPPLY');
    }
  }
  for (const item of read('dart-alerts.json') ?? []) {
    if (object(item)) addNews(item.stock_code, item.rcept_no, item.alertedAt, item.report_nm, 'DART');
  }
  // Existing selections remain identifiable. Their old exit P&L is never copied into new outcomes.
  for (const file of ['shadow-trades.json', 'learning-samples.json', 'shadow-learning-only-signals.json',
    'counterfactual-shadow-learning-ledger.json', 'counterfactual-universe-learning-ledger.json',
    'counterfactual-shadow.json', 'parallel-universe-ledger.json']) read(file);
  return { schemaVersion: 1, series, news, inventory };
}
