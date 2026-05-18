// @responsibility Diagnostic-only market-level program flow provider pipeline (KIS → KRX → CACHE → NONE).
import fs from 'fs';
import path from 'path';
import { fetchKisMarketProgramTrade, type KisMarketProgramTrade } from '../../clients/kisClient.js';
import { fetchKrxIntradayProgramTradeAggregate } from '../../clients/krxClient/intradayProgramTradeFetcher.js';
import type { KrxMarketProgramAggregate } from '../../clients/krxClient/programTradeFetcher.js';
import { DATA_DIR } from '../../persistence/paths.js';
import { logVisibilityEvent } from '../../utils/logger.js';

export type MarketProgramFlowSource = 'KIS_API' | 'KRX_FALLBACK' | 'CACHE' | 'CACHE_STALE' | 'NONE';
export type MarketProgramFlowStatus = 'MISSING' | 'ACCEPTED_EMPTY' | 'PROVIDER_ERROR' | 'PARSE_FAILED' | 'PARSED';
export type MarketProgramProviderStatus = 'NOT_ATTEMPTED' | 'ACCEPTED_EMPTY' | 'ERROR' | 'PARSE_FAILED' | 'PARSED' | 'SUCCESS' | 'EMPTY';
export type MarketProgramCacheStatus = 'HIT' | 'MISS' | 'STALE';

export interface LastMarketProgramSnapshot {
  source: Exclude<MarketProgramFlowSource, 'NONE' | 'CACHE_STALE'>;
  netBuyAmount: number;
  arbitrageNetBuyAmount: number | null;
  nonArbitrageNetBuyAmount: number | null;
  fetchedAt: string;
  ttlSec: number;
}

export interface MarketProgramFlowResult {
  available: boolean;
  source: MarketProgramFlowSource;
  netBuyAmount: number | null;
  arbitrageNetBuyAmount: number | null;
  nonArbitrageNetBuyAmount: number | null;
  fetchedAt: string | null;
  providerIssue: boolean;
  marketSignal: 'BULLISH' | 'NEUTRAL' | 'BEARISH' | 'UNKNOWN';
  parsedFieldName?: string;
  rawFieldKeys?: string[];
  breakPoint: string;
  executionImpact: 'NONE';
  marketProgramDataStatus: MarketProgramFlowStatus;
  kisAttempted: boolean;
  kisStatus: Extract<MarketProgramProviderStatus, 'NOT_ATTEMPTED' | 'ACCEPTED_EMPTY' | 'ERROR' | 'PARSE_FAILED' | 'PARSED'>;
  krxFallbackAttempted: boolean;
  krxFallbackStatus: Extract<MarketProgramProviderStatus, 'NOT_ATTEMPTED' | 'SUCCESS' | 'EMPTY' | 'ERROR'>;
  cacheFallbackAttempted: boolean;
  cacheStatus: MarketProgramCacheStatus;
  lastMarketProgramSnapshot?: LastMarketProgramSnapshot;
  programFlowUsedForLiveDecision: false;
  passiveProxyUsedForLiveDecision: false;
  programPenaltyApplied: false;
}

export interface ResolveMarketProgramFlowOptions {
  fetchKis?: () => Promise<KisMarketProgramTrade | null>;
  fetchKrx?: () => Promise<KrxMarketProgramAggregate | null>;
  now?: Date;
  skipKis?: boolean;
}

const CACHE_FILE = path.join(DATA_DIR, 'last-market-program-snapshot.json');
const INTRADAY_TTL_SEC = 15 * 60;
const AFTER_HOURS_TTL_SEC = 24 * 60 * 60;

export async function resolveMarketProgramFlow(options: ResolveMarketProgramFlowOptions = {}): Promise<MarketProgramFlowResult> {
  const now = options.now ?? new Date();
  let kisStatus: MarketProgramFlowResult['kisStatus'] = options.skipKis ? 'NOT_ATTEMPTED' : 'ERROR';
  let krxFallbackStatus: MarketProgramFlowResult['krxFallbackStatus'] = 'NOT_ATTEMPTED';
  let kisProviderIssue = false;

  if (!options.skipKis) {
    logProviderAttempt('KIS_API');
    try {
      const kis = await (options.fetchKis ?? fetchKisMarketProgramTrade)();
      const kisParsed = normalizeKisResult(kis);
      kisStatus = kisParsed.status;
      kisProviderIssue = kisParsed.providerIssue;
      logProviderResult('KIS_API', kisStatus, kisParsed.rawFieldKeys, kisParsed.parsedFieldName, kisParsed.netBuyAmount);
      if (kisParsed.available) {
        const result = resolved({
          available: true,
          source: 'KIS_API',
          netBuyAmount: kisParsed.netBuyAmount,
          arbitrageNetBuyAmount: kisParsed.arbitrageNetBuyAmount,
          nonArbitrageNetBuyAmount: kisParsed.nonArbitrageNetBuyAmount,
          fetchedAt: kisParsed.fetchedAt,
          providerIssue: false,
          parsedFieldName: kisParsed.parsedFieldName,
          rawFieldKeys: kisParsed.rawFieldKeys,
          breakPoint: 'OK_MARKET_PROGRAM_WIRED',
          marketProgramDataStatus: 'PARSED',
          kisAttempted: true,
          kisStatus,
          krxFallbackAttempted: false,
          krxFallbackStatus,
          cacheFallbackAttempted: false,
          cacheStatus: 'MISS',
        });
        saveLastMarketProgramSnapshot(result, now);
        logResolved(result);
        return result;
      }
    } catch (error) {
      kisStatus = 'ERROR';
      kisProviderIssue = true;
      logProviderResult('KIS_API', 'ERROR', [], undefined, null, error);
    }
  }

  logFallbackAttempt('KRX_FALLBACK');
  let krxProviderIssue = false;
  try {
    const krx = await (options.fetchKrx ?? (() => fetchKrxIntradayProgramTradeAggregate(now.getTime())))();
    const krxParsed = normalizeKrxResult(krx);
    krxFallbackStatus = krxParsed.available ? 'SUCCESS' : 'EMPTY';
    logProviderResult('KRX_FALLBACK', krxFallbackStatus, krxParsed.rawFieldKeys, krxParsed.parsedFieldName, krxParsed.netBuyAmount);
    if (krxParsed.available) {
      const result = resolved({
        available: true,
        source: 'KRX_FALLBACK',
        netBuyAmount: krxParsed.netBuyAmount,
        arbitrageNetBuyAmount: krxParsed.arbitrageNetBuyAmount,
        nonArbitrageNetBuyAmount: krxParsed.nonArbitrageNetBuyAmount,
        fetchedAt: krxParsed.fetchedAt,
        providerIssue: false,
        parsedFieldName: krxParsed.parsedFieldName,
        rawFieldKeys: krxParsed.rawFieldKeys,
        breakPoint: 'OK_MARKET_PROGRAM_WIRED',
        marketProgramDataStatus: 'PARSED',
        kisAttempted: !options.skipKis,
        kisStatus,
        krxFallbackAttempted: true,
        krxFallbackStatus,
        cacheFallbackAttempted: false,
        cacheStatus: 'MISS',
      });
      saveLastMarketProgramSnapshot(result, now);
      logResolved(result);
      return result;
    }
  } catch (error) {
    krxFallbackStatus = 'ERROR';
    krxProviderIssue = true;
    logProviderResult('KRX_FALLBACK', 'ERROR', [], undefined, null, error);
  }

  const cache = loadLastMarketProgramSnapshot(now);
  logCacheResult(cache.status);
  if (cache.snapshot && cache.status !== 'MISS') {
    const result = resolved({
      available: cache.status === 'HIT',
      source: cache.status === 'HIT' ? 'CACHE' : 'CACHE_STALE',
      netBuyAmount: cache.snapshot.netBuyAmount,
      arbitrageNetBuyAmount: cache.snapshot.arbitrageNetBuyAmount,
      nonArbitrageNetBuyAmount: cache.snapshot.nonArbitrageNetBuyAmount,
      fetchedAt: cache.snapshot.fetchedAt,
      providerIssue: kisProviderIssue || krxProviderIssue,
      parsedFieldName: 'lastMarketProgramSnapshot.netBuyAmount',
      rawFieldKeys: ['lastMarketProgramSnapshot'],
      breakPoint: cache.status === 'HIT' ? 'OK_MARKET_PROGRAM_WIRED' : 'KIS_ACCEPTED_EMPTY_KRX_EMPTY_CACHE_STALE',
      marketProgramDataStatus: cache.status === 'HIT' ? 'PARSED' : 'MISSING',
      kisAttempted: !options.skipKis,
      kisStatus,
      krxFallbackAttempted: true,
      krxFallbackStatus,
      cacheFallbackAttempted: true,
      cacheStatus: cache.status,
      lastMarketProgramSnapshot: cache.snapshot,
    });
    logResolved(result);
    return result;
  }

  const dataStatus: MarketProgramFlowStatus = kisProviderIssue || krxProviderIssue
    ? 'PROVIDER_ERROR'
    : kisStatus === 'PARSE_FAILED'
      ? 'PARSE_FAILED'
      : kisStatus === 'ACCEPTED_EMPTY'
        ? 'ACCEPTED_EMPTY'
        : 'MISSING';
  const result = resolved({
    available: false,
    source: 'NONE',
    netBuyAmount: null,
    arbitrageNetBuyAmount: null,
    nonArbitrageNetBuyAmount: null,
    fetchedAt: null,
    providerIssue: kisProviderIssue || krxProviderIssue,
    breakPoint: buildMissingBreakPoint(kisStatus, krxFallbackStatus, cache.status),
    marketProgramDataStatus: dataStatus,
    kisAttempted: !options.skipKis,
    kisStatus,
    krxFallbackAttempted: true,
    krxFallbackStatus,
    cacheFallbackAttempted: true,
    cacheStatus: cache.status,
  });
  logResolved(result);
  return result;
}

function normalizeKisResult(kis: KisMarketProgramTrade | null): {
  available: boolean;
  status: MarketProgramFlowResult['kisStatus'];
  providerIssue: boolean;
  netBuyAmount: number | null;
  arbitrageNetBuyAmount: number | null;
  nonArbitrageNetBuyAmount: number | null;
  fetchedAt: string | null;
  parsedFieldName?: string;
  rawFieldKeys: string[];
} {
  if (!kis) return { available: false, status: 'ACCEPTED_EMPTY', providerIssue: false, netBuyAmount: null, arbitrageNetBuyAmount: null, nonArbitrageNetBuyAmount: null, fetchedAt: null, rawFieldKeys: [] };
  const rawFieldKeys = Array.from(new Set([...(kis.rawFieldKeys ?? []), ...Object.keys(kis), ...Object.keys(kis.aggregateDiagnostic ?? {})])).sort();
  if (kis.providerIssue === true || kis.marketProgramStatus === 'PROVIDER_ERROR') {
    return { available: false, status: 'ERROR', providerIssue: true, netBuyAmount: null, arbitrageNetBuyAmount: null, nonArbitrageNetBuyAmount: null, fetchedAt: kis.fetchedAt, rawFieldKeys };
  }
  const candidates: Array<[string, unknown]> = [
    ['marketProgramNetBuy', (kis as unknown as Record<string, unknown>).marketProgramNetBuy],
    ['programNetBuy', (kis as unknown as Record<string, unknown>).programNetBuy],
    ['programNetBuyAmount', kis.programNetBuyAmount],
    ['programNetValue', (kis as unknown as Record<string, unknown>).programNetValue],
    ['totalProgramNetBuy', (kis as unknown as Record<string, unknown>).totalProgramNetBuy],
    ['totalProgramNetBuyAmount', (kis as unknown as Record<string, unknown>).totalProgramNetBuyAmount],
    ['kospiProgramNetBuy', (kis as unknown as Record<string, unknown>).kospiProgramNetBuy],
    ['kosdaqProgramNetBuy', (kis as unknown as Record<string, unknown>).kosdaqProgramNetBuy],
    ['netBuyAmount', (kis as unknown as Record<string, unknown>).netBuyAmount],
    ['prgmNetBuy', (kis as unknown as Record<string, unknown>).prgmNetBuy],
    ['prgmNetBuyAmount', (kis as unknown as Record<string, unknown>).prgmNetBuyAmount],
  ];
  for (const [key, raw] of candidates) {
    const parsed = parseNumber(raw);
    if (parsed !== null) return { available: true, status: 'PARSED', providerIssue: false, netBuyAmount: parsed, arbitrageNetBuyAmount: parseNumber(kis.programArbitrageNetBuy), nonArbitrageNetBuyAmount: parseNumber(kis.programNonArbitrageNetBuy), fetchedAt: kis.fetchedAt, parsedFieldName: key, rawFieldKeys };
  }
  const buy = parseNumber(kis.programBuyAmount ?? (kis as unknown as Record<string, unknown>).buyAmount);
  const sell = parseNumber(kis.programSellAmount ?? (kis as unknown as Record<string, unknown>).sellAmount);
  if (buy !== null && sell !== null) return { available: true, status: 'PARSED', providerIssue: false, netBuyAmount: buy - sell, arbitrageNetBuyAmount: parseNumber(kis.programArbitrageNetBuy), nonArbitrageNetBuyAmount: parseNumber(kis.programNonArbitrageNetBuy), fetchedAt: kis.fetchedAt, parsedFieldName: 'buyAmount-sellAmount', rawFieldKeys };
  if (candidates.some(([, raw]) => hasPresentUnparsedNumericValue(raw))
    || hasPresentUnparsedNumericValue(kis.programBuyAmount ?? (kis as unknown as Record<string, unknown>).buyAmount)
    || hasPresentUnparsedNumericValue(kis.programSellAmount ?? (kis as unknown as Record<string, unknown>).sellAmount)) {
    return { available: false, status: 'PARSE_FAILED', providerIssue: false, netBuyAmount: null, arbitrageNetBuyAmount: null, nonArbitrageNetBuyAmount: null, fetchedAt: kis.fetchedAt, rawFieldKeys };
  }
  return { available: false, status: 'ACCEPTED_EMPTY', providerIssue: false, netBuyAmount: null, arbitrageNetBuyAmount: null, nonArbitrageNetBuyAmount: null, fetchedAt: kis.fetchedAt, rawFieldKeys };
}

function hasPresentUnparsedNumericValue(raw: unknown): boolean {
  if (raw === null || raw === undefined || raw === '') return false;
  return parseNumber(raw) === null;
}

function normalizeKrxResult(krx: KrxMarketProgramAggregate | null): { available: boolean; netBuyAmount: number | null; arbitrageNetBuyAmount: number | null; nonArbitrageNetBuyAmount: number | null; fetchedAt: string | null; parsedFieldName?: string; rawFieldKeys: string[] } {
  if (!krx || krx.totalProgramNet === null || krx.confidence === 'EMPTY') return { available: false, netBuyAmount: null, arbitrageNetBuyAmount: null, nonArbitrageNetBuyAmount: null, fetchedAt: krx?.fetchedAt ?? null, rawFieldKeys: krx ? Object.keys(krx) : [] };
  return { available: true, netBuyAmount: krx.totalProgramNet, arbitrageNetBuyAmount: krx.arbitrageNet, nonArbitrageNetBuyAmount: krx.nonArbitrageNet, fetchedAt: krx.fetchedAt, parsedFieldName: 'totalProgramNet', rawFieldKeys: Object.keys(krx) };
}

function resolved(input: Omit<MarketProgramFlowResult, 'marketSignal' | 'executionImpact' | 'programFlowUsedForLiveDecision' | 'passiveProxyUsedForLiveDecision' | 'programPenaltyApplied'>): MarketProgramFlowResult {
  return { ...input, marketSignal: input.available && input.netBuyAmount !== null ? signalFromNetBuy(input.netBuyAmount) : 'UNKNOWN', executionImpact: 'NONE', programFlowUsedForLiveDecision: false, passiveProxyUsedForLiveDecision: false, programPenaltyApplied: false };
}

function signalFromNetBuy(value: number): MarketProgramFlowResult['marketSignal'] {
  if (value >= 1000) return 'BULLISH';
  if (value <= -1000) return 'BEARISH';
  return 'NEUTRAL';
}

function parseNumber(raw: unknown): number | null {
  if (raw === null || raw === undefined || raw === '') return null;
  const n = typeof raw === 'number' ? raw : Number(String(raw).replace(/,/g, '').trim());
  return Number.isFinite(n) ? n : null;
}

function saveLastMarketProgramSnapshot(result: MarketProgramFlowResult, now: Date): void {
  if (!result.available || result.netBuyAmount === null || result.source === 'NONE' || result.source === 'CACHE' || result.source === 'CACHE_STALE') return;
  const snapshot: LastMarketProgramSnapshot = {
    source: result.source,
    netBuyAmount: result.netBuyAmount,
    arbitrageNetBuyAmount: result.arbitrageNetBuyAmount,
    nonArbitrageNetBuyAmount: result.nonArbitrageNetBuyAmount,
    fetchedAt: result.fetchedAt ?? now.toISOString(),
    ttlSec: isKstIntradaySession(now) ? INTRADAY_TTL_SEC : AFTER_HOURS_TTL_SEC,
  };
  try {
    if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
    fs.writeFileSync(`${CACHE_FILE}.tmp`, JSON.stringify(snapshot, null, 2), 'utf-8');
    fs.renameSync(`${CACHE_FILE}.tmp`, CACHE_FILE);
  } catch {
    // diagnostic cache write failures must not affect command execution.
  }
}

function loadLastMarketProgramSnapshot(now: Date): { status: MarketProgramCacheStatus; snapshot?: LastMarketProgramSnapshot } {
  try {
    if (!fs.existsSync(CACHE_FILE)) return { status: 'MISS' };
    const parsed = JSON.parse(fs.readFileSync(CACHE_FILE, 'utf-8')) as LastMarketProgramSnapshot;
    if (!Number.isFinite(parsed.netBuyAmount) || !parsed.fetchedAt) return { status: 'MISS' };
    const ttlSec = isKstIntradaySession(now) ? INTRADAY_TTL_SEC : (parsed.ttlSec ?? AFTER_HOURS_TTL_SEC);
    const ageSec = (now.getTime() - new Date(parsed.fetchedAt).getTime()) / 1000;
    return { status: ageSec <= ttlSec ? 'HIT' : 'STALE', snapshot: { ...parsed, ttlSec } };
  } catch {
    return { status: 'MISS' };
  }
}

function isKstIntradaySession(now: Date): boolean {
  const kstMs = now.getTime() + 9 * 60 * 60 * 1000;
  const kst = new Date(kstMs);
  const day = kst.getUTCDay();
  if (day === 0 || day === 6) return false;
  const minutes = kst.getUTCHours() * 60 + kst.getUTCMinutes();
  return minutes >= 9 * 60 && minutes <= 15 * 60 + 30;
}

function buildMissingBreakPoint(kis: string, krx: string, cache: string): string {
  return `KIS_${kis}_KRX_${krx}_CACHE_${cache}`;
}

function logProviderAttempt(provider: 'KIS_API'): void {
  logVisibilityEvent({ visibility: 'DIAGNOSTIC', category: 'PROGRAM', message: `[MARKET_PROGRAM_PROVIDER_ATTEMPT] provider=${provider} session=REGULAR_SESSION executionImpact=NONE`, summary: { provider, executionImpact: 'NONE' }, details: { provider }, level: 'info', executionImpact: 'NONE' });
}
function logFallbackAttempt(provider: 'KRX_FALLBACK'): void {
  logVisibilityEvent({ visibility: 'DIAGNOSTIC', category: 'PROGRAM', message: `[MARKET_PROGRAM_FALLBACK_ATTEMPT] provider=${provider} executionImpact=NONE`, summary: { provider, executionImpact: 'NONE' }, details: { provider }, level: 'info', executionImpact: 'NONE' });
}
function logProviderResult(provider: string, status: string, rawFieldKeys: string[] = [], parsedField?: string, netBuyAmount?: number | null, error?: unknown): void {
  logVisibilityEvent({ visibility: 'DIAGNOSTIC', category: 'PROGRAM', message: `[MARKET_PROGRAM_PROVIDER_RESULT] provider=${provider} status=${status} rawFieldKeys=${rawFieldKeys.join(',') || 'none'} parsedField=${parsedField ?? 'none'} netBuyAmount=${netBuyAmount ?? 'N/A'} executionImpact=NONE`, summary: { provider, status, netBuyAmount: netBuyAmount ?? null, executionImpact: 'NONE' }, details: { provider, status, rawFieldKeys, parsedField, netBuyAmount, error: error instanceof Error ? error.message : error }, level: status === 'ERROR' ? 'warn' : 'info', executionImpact: 'NONE' });
}
function logCacheResult(status: MarketProgramCacheStatus): void {
  logVisibilityEvent({ visibility: 'DIAGNOSTIC', category: 'PROGRAM', message: `[MARKET_PROGRAM_CACHE_RESULT] status=${status} executionImpact=NONE`, summary: { status, executionImpact: 'NONE' }, details: { status }, level: 'info', executionImpact: 'NONE' });
}
function logResolved(result: MarketProgramFlowResult): void {
  logVisibilityEvent({ visibility: 'DIAGNOSTIC', category: 'PROGRAM', message: `[MARKET_PROGRAM_FLOW_RESOLVED] available=${result.available} source=${result.source} netBuyAmount=${result.netBuyAmount ?? 'N/A'} signal=${result.marketSignal} providerIssue=${result.providerIssue} executionImpact=NONE`, summary: { available: result.available, source: result.source, signal: result.marketSignal, providerIssue: result.providerIssue, executionImpact: 'NONE' }, details: result as unknown as Record<string, unknown>, level: 'info', executionImpact: 'NONE' });
}
