/**
 * @responsibility Advisory screener universe loading
 */

import { getAllStockEntries, isTradableKrxEquity } from '../persistence/krxStockMasterRepo.js';
import type { DataConfidence, ScreenerMarket, ScreenerUniverseItem } from './quantScreenerTypes.js';

export interface UniverseLoaderOptions {
  maxUniverseSize?: number;
  fallbackUniverse?: ScreenerUniverseItem[];
}

const CORE_FALLBACK: ScreenerUniverseItem[] = [
  { symbol: '005930', name: '삼성전자', market: 'KOSPI' },
  { symbol: '000660', name: 'SK하이닉스', market: 'KOSPI' },
  { symbol: '035420', name: 'NAVER', market: 'KOSPI' },
  { symbol: '247540', name: '에코프로비엠', market: 'KOSDAQ' },
];

function confidenceFromSource(hasSource: boolean): DataConfidence {
  return hasSource ? 'UNKNOWN' : 'MISSING';
}

function normalizeMarket(market: string): ScreenerMarket {
  if (market === 'KOSPI' || market === 'KOSDAQ' || market === 'KONEX') return market;
  return 'UNKNOWN';
}

export async function loadScreenerUniverse(options: UniverseLoaderOptions = {}): Promise<ScreenerUniverseItem[]> {
  const master = getAllStockEntries().filter(isTradableKrxEquity);
  const sourceItems = master.length > 0
    ? master.map((entry) => ({ symbol: entry.code, name: entry.name, market: normalizeMarket(entry.market), sector: entry.sector }))
    : (options.fallbackUniverse ?? CORE_FALLBACK);

  const limited = sourceItems.slice(0, options.maxUniverseSize ?? sourceItems.length);
  const hasMasterSource = master.length > 0;
  return limited.map((item) => ({
    ...item,
    marketCapKrw: { value: undefined, confidence: confidenceFromSource(false), source: hasMasterSource ? 'KRX_MASTER_METADATA_PENDING' : 'FALLBACK_UNIVERSE' },
    avgTradingValue20dKrw: { value: undefined, confidence: confidenceFromSource(false), source: 'MARKET_DATA_PENDING' },
    latestClose: { value: undefined, confidence: confidenceFromSource(false), source: 'MARKET_DATA_PENDING' },
    providerIssues: hasMasterSource ? [] : ['MISSING_SOURCE:KrxMasterUniverse'],
    missingData: ['marketCapKrw', 'avgTradingValue20dKrw', 'latestClose'],
  }));
}
