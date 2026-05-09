/**
 * @responsibility ADR-0435 investor-flow provider health SSOT.
 *
 * Missing investor-flow data is not a failed supply signal. This module keeps
 * provider availability, semantic net-buy availability, and confirmed flow
 * direction separate so callers do not collapse DATA_UNAVAILABLE into FAIL.
 */

import { isTradingDay } from '../utils/marketDayClassifier.js';
import type { NaverInvestorTrendCollectorResult } from '../trading/signalScanner/naverInvestorTrendCollectorAdr0481.js';
import { formatSupplySourceFreshnessCompactAdr0483, type SupplySourceFreshnessReportAdr0483 } from '../trading/signalScanner/supplySourceFreshnessAdr0483.js';

export type InvestorFlowProviderStatus =
  | 'OK'
  | 'CACHE_HIT'
  | 'CACHE_EMPTY'
  | 'HTTP_400'
  | 'HTTP_403'
  | 'HTTP_429'
  | 'HTTP_5XX'
  | 'TIMEOUT'
  | 'NOT_WIRED'
  | 'MARKET_CLOSED'
  | 'LUNCH_BREAK'
  | 'NON_TRADING_DAY'
  | 'PARAM_INVALID'
  | 'PARSER_EMPTY_ROWS'
  | 'PROVIDER_UNAVAILABLE'
  | 'UNKNOWN_ERROR';

export type InvestorFlowProvider = 'KRX' | 'NAVER' | 'KIS' | 'CACHE' | 'COMPOSITE';

export type InvestorFlowMarketSession =
  | 'PRE_OPEN'
  | 'REGULAR'
  | 'LUNCH_BREAK'
  | 'POST_CLOSE'
  | 'CLOSED';

export interface InvestorFlowProviderHealth {
  provider: InvestorFlowProvider;
  status: InvestorFlowProviderStatus;
  dataAvailable: boolean;
  semanticAvailable: boolean;
  isNegativeFlowConfirmed: boolean;
  isPositiveFlowConfirmed: boolean;
  reason: string;
  observedAtKst: string;
  sourceDateKst?: string;
  endpoint?: string;
  marketSession?: InvestorFlowMarketSession;
  retryable?: boolean;
  cacheFallback?: boolean;
  /**
   * ADR-0445 — KRX investor-flow parser empty rows hardening.
   *
   * 직전 성공/실패 시각 + parser 진단 propagate. 옵셔널 후방호환 — KRX provider
   * 만 본격 사용 (NAVER / KIS / CACHE / COMPOSITE 은 미사용).
   */
  lastSuccessAtKst?: string;
  lastSuccessRowCount?: number;
  lastFailureAtKst?: string;
  lastFailureReason?: string;
  expectedPaths?: string[];
  detectedCandidatePaths?: string[];
  cacheStatus?: 'CACHE_EMPTY' | 'CACHE_HIT' | 'LAST_GOOD_STALE';
}

export interface InvestorFlowSemanticNetBuy {
  foreignNetBuy: number;
  institutionNetBuy: number;
  individualNetBuy?: number;
  programNetBuy?: number;
}

export type SupplyProviderStatus =
  | 'WIRED'
  | 'VERIFIED'
  | 'DEGRADED'
  | 'PARTIAL'
  | 'STALE'
  | 'DATA_UNAVAILABLE'
  | 'NON_TRADING_DAY'
  | 'CACHE_EMPTY'
  | 'EMPTY'
  | 'NOT_WIRED'
  | 'PARSE_ERROR'
  | 'PROVIDER_ERROR'
  | 'DISABLED'
  | 'PROVIDER_MISMATCH'
  | 'ERROR'
  | 'UNKNOWN';

export type SupplyMarketSignal =
  | 'BULLISH'
  | 'NEUTRAL'
  | 'BEARISH'
  | 'UNAVAILABLE';

export interface SemanticNetBuySample {
  code: string;
  source: 'KRX' | 'NAVER' | 'CACHE';
  sourceDate: string;
  investorForeignNetBuy?: number;
  investorInstitutionNetBuy?: number;
  netBuyScore?: number;
  confidence: 'VERIFIED' | 'DEGRADED' | 'STALE' | 'UNKNOWN';
  providerIssue: boolean;
  marketSignal: boolean;
}

export interface SupplyProviderHealthDerivation {
  providerIssue: boolean;
  marketSignal: boolean;
  status: SupplyProviderStatus;
  supplyMarketSignal: SupplyMarketSignal;
  liveStrongBuyAllowed: boolean;
  shadowObservableAllowed: boolean;
  liveExecutionAllowed: false;
  failed: false;
  executionImpact: 'NONE';
}

export interface PreviousTradingDayCacheFallbackDiagnostic {
  requestedSourceDate: string;
  previousTradingDateCandidate: string;
  cacheKeyTried: string;
  cacheHit: boolean;
  cacheAgeBusinessDays: number;
  usableForShadow: boolean;
  usableForLiveStrongBuy: false;
  executionImpact: 'NONE';
}

export interface SupplyProviderWarmupReport {
  krxStatus: SupplyProviderStatus;
  naverStatus: SupplyProviderStatus;
  semanticNetBuySchemaReady: boolean;
  semanticNetBuyCollectorStatus: 'WIRED' | 'NOT_WIRED';
  cacheStatus: SupplyProviderStatus;
  kisStatus: SupplyProviderStatus;
  providerIssue: boolean;
  marketSignal: boolean;
  previousTradingDateDiagnostic: PreviousTradingDayCacheFallbackDiagnostic;
  executionImpact: 'NONE';
  liveExecutionAllowed: false;
  shadowObservableAllowed: true;
  naverInvestorTrendAdr0481?: {
    status: NaverInvestorTrendCollectorResult['status'];
    signal: NaverInvestorTrendCollectorResult['signal'];
    coverage: NaverInvestorTrendCollectorResult['coverage'];
    executionImpact: 'NONE';
    liveExecutionAllowed: false;
    policyPromotionMode: 'SHADOW_ONLY';
  };
  supplySourceFreshnessAdr0483?: SupplySourceFreshnessReportAdr0483;
  investorFlowRouter?: {
    status: string;
    selectedProvider: string;
    providerTried: string[];
    signal: string;
    coverage: {
      available: number;
      total: number;
    };
    executionImpact: 'NONE';
    liveExecutionAllowed: false;
  };
  nextAction: 'WIRE_NAVER_OR_REPAIR_CACHE_KEY' | 'OBSERVE_PROVIDER_WARMUP' | 'NONE';
}

const KST_OFFSET_MS = 9 * 60 * 60_000;
const NEGATIVE_CACHE_TTL_MS = 10 * 60_000;

interface NegativeCacheEntry {
  health: InvestorFlowProviderHealth;
  expiresAtMs: number;
  marketSession: InvestorFlowMarketSession;
}

const negativeCache = new Map<string, NegativeCacheEntry>();
let lastHealth: InvestorFlowProviderHealth[] = [];

export function toInvestorFlowKstDateTime(now: Date = new Date()): { iso: string; date: string; minutes: number } {
  const kst = new Date(now.getTime() + KST_OFFSET_MS);
  const hh = kst.getUTCHours();
  const mm = kst.getUTCMinutes();
  return {
    iso: `${kst.toISOString().slice(0, 19)}+09:00`,
    date: kst.toISOString().slice(0, 10),
    minutes: hh * 60 + mm,
  };
}

function shiftYmd(ymd: string, days: number): string {
  const [y, m, d] = ymd.split('-').map(Number);
  return new Date(Date.UTC(y, m - 1, d) + days * 86_400_000).toISOString().slice(0, 10);
}

export function previousInvestorFlowTradingDate(dateKst: string): string {
  let cursor = shiftYmd(dateKst, -1);
  for (let i = 0; i < 32; i += 1) {
    if (isTradingDay(cursor)) return cursor;
    cursor = shiftYmd(cursor, -1);
  }
  return dateKst;
}

export function classifyInvestorFlowMarketSession(now: Date = new Date()): InvestorFlowMarketSession {
  const kst = toInvestorFlowKstDateTime(now);
  if (!isTradingDay(kst.date)) return 'CLOSED';
  if (kst.minutes < 9 * 60) return 'PRE_OPEN';
  if (kst.minutes >= 11 * 60 + 31 && kst.minutes <= 12 * 60 + 59) return 'LUNCH_BREAK';
  if (kst.minutes >= 9 * 60 && kst.minutes < 15 * 60 + 30) return 'REGULAR';
  if (kst.minutes >= 15 * 60 + 30) return 'POST_CLOSE';
  return 'CLOSED';
}

export function resolveInvestorFlowSourceDateKst(now: Date = new Date()): string {
  const kst = toInvestorFlowKstDateTime(now);
  const session = classifyInvestorFlowMarketSession(now);
  if (session === 'PRE_OPEN' || session === 'CLOSED') return previousInvestorFlowTradingDate(kst.date);
  return kst.date;
}

export function shouldSuppressInvestorFlowFetch(now: Date = new Date()): {
  suppress: boolean;
  status?: Extract<InvestorFlowProviderStatus, 'LUNCH_BREAK' | 'NON_TRADING_DAY' | 'MARKET_CLOSED'>;
  reason?: string;
  marketSession: InvestorFlowMarketSession;
  sourceDateKst: string;
} {
  const session = classifyInvestorFlowMarketSession(now);
  const sourceDateKst = resolveInvestorFlowSourceDateKst(now);
  const today = toInvestorFlowKstDateTime(now).date;
  if (!isTradingDay(today)) {
    return { suppress: true, status: 'NON_TRADING_DAY', reason: 'KRX non-trading day', marketSession: session, sourceDateKst };
  }
  if (session === 'LUNCH_BREAK') {
    return { suppress: true, status: 'LUNCH_BREAK', reason: 'KRX lunch-break retry suppressed', marketSession: session, sourceDateKst };
  }
  if (session === 'PRE_OPEN' || session === 'POST_CLOSE' || session === 'CLOSED') {
    return { suppress: true, status: 'MARKET_CLOSED', reason: `KRX ${session} retry suppressed`, marketSession: session, sourceDateKst };
  }
  return { suppress: false, marketSession: session, sourceDateKst };
}

function isPositiveFinite(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value) && value > 0;
}

function isFiniteNumber(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value);
}

export function makeInvestorFlowProviderHealth(input: {
  provider: InvestorFlowProvider;
  status: InvestorFlowProviderStatus;
  reason: string;
  now?: Date;
  sourceDateKst?: string;
  semantic?: InvestorFlowSemanticNetBuy | null;
  dataAvailable?: boolean;
  semanticAvailable?: boolean;
  endpoint?: string;
  marketSession?: InvestorFlowMarketSession;
  retryable?: boolean;
  cacheFallback?: boolean;
  // ADR-0445 — parser 진단 propagate (옵셔널, 후방호환).
  lastSuccessAtKst?: string;
  lastSuccessRowCount?: number;
  lastFailureAtKst?: string;
  lastFailureReason?: string;
  expectedPaths?: string[];
  detectedCandidatePaths?: string[];
  cacheStatus?: 'CACHE_EMPTY' | 'CACHE_HIT' | 'LAST_GOOD_STALE';
}): InvestorFlowProviderHealth {
  const semantic = input.semantic;
  const semanticAvailable = input.semanticAvailable ?? (
    !!semantic && isFiniteNumber(semantic.foreignNetBuy) && isFiniteNumber(semantic.institutionNetBuy)
  );
  return {
    provider: input.provider,
    status: input.status,
    dataAvailable: input.dataAvailable ?? (input.status === 'OK' || input.status === 'CACHE_HIT'),
    semanticAvailable,
    isNegativeFlowConfirmed: semanticAvailable
      ? (semantic!.foreignNetBuy < 0 && semantic!.institutionNetBuy < 0)
      : false,
    isPositiveFlowConfirmed: semanticAvailable
      ? (isPositiveFinite(semantic!.foreignNetBuy) && isPositiveFinite(semantic!.institutionNetBuy))
      : false,
    reason: input.reason,
    observedAtKst: toInvestorFlowKstDateTime(input.now).iso,
    ...(input.sourceDateKst ? { sourceDateKst: input.sourceDateKst } : {}),
    ...(input.endpoint ? { endpoint: input.endpoint } : {}),
    ...(input.marketSession ? { marketSession: input.marketSession } : {}),
    ...(input.retryable !== undefined ? { retryable: input.retryable } : {}),
    ...(input.cacheFallback !== undefined ? { cacheFallback: input.cacheFallback } : {}),
    // ADR-0445 — parser 진단 propagate (옵셔널, 후방호환).
    ...(input.lastSuccessAtKst ? { lastSuccessAtKst: input.lastSuccessAtKst } : {}),
    ...(input.lastSuccessRowCount !== undefined ? { lastSuccessRowCount: input.lastSuccessRowCount } : {}),
    ...(input.lastFailureAtKst ? { lastFailureAtKst: input.lastFailureAtKst } : {}),
    ...(input.lastFailureReason ? { lastFailureReason: input.lastFailureReason } : {}),
    ...(input.expectedPaths && input.expectedPaths.length > 0 ? { expectedPaths: [...input.expectedPaths] } : {}),
    ...(input.detectedCandidatePaths && input.detectedCandidatePaths.length > 0 ? { detectedCandidatePaths: [...input.detectedCandidatePaths] } : {}),
    ...(input.cacheStatus ? { cacheStatus: input.cacheStatus } : {}),
  };
}

function negativeCacheKey(provider: InvestorFlowProvider, code: string, now: Date): string {
  const session = classifyInvestorFlowMarketSession(now);
  const sourceDateKst = resolveInvestorFlowSourceDateKst(now);
  const safeCode = code.replace(/[^0-9]/g, '').slice(-6).padStart(6, '0');
  return `${provider}:${safeCode}:${session}:${sourceDateKst}`;
}

export function getInvestorFlowNegativeCache(provider: InvestorFlowProvider, code: string, now: Date = new Date()): InvestorFlowProviderHealth | null {
  const key = negativeCacheKey(provider, code, now);
  const hit = negativeCache.get(key);
  if (!hit || hit.expiresAtMs <= now.getTime() || hit.marketSession !== classifyInvestorFlowMarketSession(now)) {
    negativeCache.delete(key);
    return null;
  }
  return {
    ...hit.health,
    observedAtKst: toInvestorFlowKstDateTime(now).iso,
    reason: `negative cache hit: ${hit.health.reason}`,
    cacheFallback: true,
  };
}

export function setInvestorFlowNegativeCache(
  provider: InvestorFlowProvider,
  code: string,
  health: InvestorFlowProviderHealth,
  now: Date = new Date(),
  ttlMs = NEGATIVE_CACHE_TTL_MS,
): void {
  negativeCache.set(negativeCacheKey(provider, code, now), {
    health,
    expiresAtMs: now.getTime() + ttlMs,
    marketSession: classifyInvestorFlowMarketSession(now),
  });
}

export function __resetInvestorFlowProviderHealthForTests(): void {
  negativeCache.clear();
  lastHealth = [];
}

export function rememberInvestorFlowProviderHealth(health: InvestorFlowProviderHealth[]): void {
  lastHealth = health.map((h) => ({ ...h }));
}

export function getLastInvestorFlowProviderHealth(): InvestorFlowProviderHealth[] {
  return lastHealth.map((h) => ({ ...h }));
}

function classifySemanticNetBuySample(sample: SemanticNetBuySample | null | undefined): SupplyMarketSignal {
  if (!sample) return 'UNAVAILABLE';
  const foreign = sample.investorForeignNetBuy;
  const institution = sample.investorInstitutionNetBuy;
  if (!isFiniteNumber(foreign) || !isFiniteNumber(institution)) return 'UNAVAILABLE';
  if (foreign < 0 && institution < 0) return 'BEARISH';
  if (foreign > 0 && institution > 0) return 'BULLISH';
  return 'NEUTRAL';
}

function normalizeSupplyProviderStatus(status: InvestorFlowProviderStatus | SupplyProviderStatus | undefined): SupplyProviderStatus {
  switch (status) {
    case 'OK':
    case 'CACHE_HIT':
    case 'VERIFIED':
      return 'VERIFIED';
    case 'CACHE_EMPTY':
      return 'CACHE_EMPTY';
    case 'NOT_WIRED':
      return 'NOT_WIRED';
    case 'NON_TRADING_DAY':
      return 'NON_TRADING_DAY';
    case 'MARKET_CLOSED':
    case 'LUNCH_BREAK':
    case 'PARSER_EMPTY_ROWS':
    case 'PROVIDER_UNAVAILABLE':
    case 'DATA_UNAVAILABLE':
      return 'DATA_UNAVAILABLE';
    case 'HTTP_400':
    case 'HTTP_403':
    case 'HTTP_429':
    case 'HTTP_5XX':
    case 'TIMEOUT':
    case 'PARAM_INVALID':
    case 'UNKNOWN_ERROR':
    case 'ERROR':
      return 'ERROR';
    case 'WIRED':
    case 'DEGRADED':
    case 'PARTIAL':
    case 'STALE':
    case 'EMPTY':
    case 'PARSE_ERROR':
    case 'PROVIDER_ERROR':
    case 'DISABLED':
    case 'PROVIDER_MISMATCH':
    case 'UNKNOWN':
      return status;
    default:
      return 'UNKNOWN';
  }
}

export function deriveSupplyProviderHealth(input: {
  status?: InvestorFlowProviderStatus | SupplyProviderStatus;
  sample?: SemanticNetBuySample | null;
}): SupplyProviderHealthDerivation {
  const status = normalizeSupplyProviderStatus(input.status);
  const supplyMarketSignal = status === 'VERIFIED'
    ? classifySemanticNetBuySample(input.sample)
    : 'UNAVAILABLE';
  const providerIssue = status !== 'VERIFIED';
  const marketSignal = status === 'VERIFIED' && supplyMarketSignal !== 'UNAVAILABLE';
  return {
    providerIssue,
    marketSignal,
    status,
    supplyMarketSignal,
    liveStrongBuyAllowed: status === 'VERIFIED' && supplyMarketSignal === 'BULLISH',
    shadowObservableAllowed: true,
    liveExecutionAllowed: false,
    failed: false,
    executionImpact: 'NONE',
  };
}

export function isSemanticNetBuyProvider(provider: string): provider is SemanticNetBuySample['source'] {
  return provider === 'KRX' || provider === 'NAVER' || provider === 'CACHE';
}

function businessDayDistance(fromYmd: string, toYmd: string): number {
  let cursor = fromYmd;
  let count = 0;
  for (let i = 0; i < 32 && cursor < toYmd; i += 1) {
    cursor = shiftYmd(cursor, 1);
    if (cursor <= toYmd && isTradingDay(cursor)) count += 1;
  }
  return count;
}

export function buildPreviousTradingDayCacheFallbackDiagnostic(input: {
  code?: string;
  requestedSourceDate: string;
  cacheHit?: boolean;
}): PreviousTradingDayCacheFallbackDiagnostic {
  const previousTradingDateCandidate = previousInvestorFlowTradingDate(input.requestedSourceDate);
  const safeCode = (input.code ?? '000000').replace(/[^0-9]/g, '').slice(-6).padStart(6, '0');
  const cacheHit = input.cacheHit === true;
  return {
    requestedSourceDate: input.requestedSourceDate,
    previousTradingDateCandidate,
    cacheKeyTried: `semantic-netbuy:${safeCode}:${previousTradingDateCandidate}`,
    cacheHit,
    cacheAgeBusinessDays: businessDayDistance(previousTradingDateCandidate, input.requestedSourceDate),
    usableForShadow: true,
    usableForLiveStrongBuy: false,
    executionImpact: 'NONE',
  };
}

function findProviderHealth(
  health: InvestorFlowProviderHealth[],
  provider: InvestorFlowProvider,
): InvestorFlowProviderHealth | undefined {
  return health.find((item) => item.provider === provider);
}

function statusFromHealth(health: InvestorFlowProviderHealth | undefined, fallback: SupplyProviderStatus): SupplyProviderStatus {
  if (!health) return fallback;
  if (health.provider === 'KIS') return 'PROVIDER_MISMATCH';
  return normalizeSupplyProviderStatus(health.status);
}

export function buildSupplyProviderWarmupReport(input: {
  health?: InvestorFlowProviderHealth[];
  now?: Date;
  code?: string;
  cacheHit?: boolean;
  investorFlowRouter?: SupplyProviderWarmupReport['investorFlowRouter'];
  naverInvestorTrendAdr0481?: NaverInvestorTrendCollectorResult | null;
  supplySourceFreshnessAdr0483?: SupplySourceFreshnessReportAdr0483 | null;
} = {}): SupplyProviderWarmupReport {
  const health = input.health ?? [];
  const now = input.now ?? new Date();
  const requestedSourceDate = toInvestorFlowKstDateTime(now).date;
  const krxFallback: SupplyProviderStatus = isTradingDay(requestedSourceDate) ? 'DATA_UNAVAILABLE' : 'NON_TRADING_DAY';
  const krxStatus = statusFromHealth(findProviderHealth(health, 'KRX'), krxFallback);
  const naverAdr0481Status = input.naverInvestorTrendAdr0481?.status;
  const naverStatus = naverAdr0481Status === 'DATA_AVAILABLE'
    ? 'VERIFIED'
    : naverAdr0481Status === 'WIRED'
      ? 'WIRED'
      : naverAdr0481Status === 'PARTIAL'
        ? 'PARTIAL'
        : naverAdr0481Status === 'STALE'
          ? 'STALE'
          : naverAdr0481Status === 'EMPTY'
            ? 'EMPTY'
            : naverAdr0481Status === 'PARSE_ERROR'
              ? 'PARSE_ERROR'
              : naverAdr0481Status === 'PROVIDER_ERROR'
                ? 'PROVIDER_ERROR'
                : naverAdr0481Status === 'NON_TRADING_DAY'
                  ? 'NON_TRADING_DAY'
                  : naverAdr0481Status === 'DISABLED'
                    ? 'DISABLED'
                    : naverAdr0481Status === 'DATA_UNAVAILABLE'
                      ? 'DATA_UNAVAILABLE'
                      : statusFromHealth(findProviderHealth(health, 'NAVER'), 'NOT_WIRED');
  const cacheStatus = statusFromHealth(findProviderHealth(health, 'CACHE'), 'CACHE_EMPTY');
  const kisStatus = statusFromHealth(findProviderHealth(health, 'KIS'), 'PROVIDER_MISMATCH');
  const composite = findProviderHealth(health, 'COMPOSITE');
  const marketSignal = composite?.semanticAvailable === true && composite.isNegativeFlowConfirmed === true;
  const providerIssue = !composite?.semanticAvailable
    || [krxStatus, naverStatus, cacheStatus, kisStatus].some((status) => status !== 'VERIFIED');
  const previousTradingDateDiagnostic = buildPreviousTradingDayCacheFallbackDiagnostic({
    ...(input.code !== undefined ? { code: input.code } : {}),
    requestedSourceDate,
    ...(input.cacheHit !== undefined ? { cacheHit: input.cacheHit } : {}),
  });
  return {
    krxStatus,
    naverStatus,
    semanticNetBuySchemaReady: true,
    semanticNetBuyCollectorStatus: naverStatus === 'NOT_WIRED' ? 'NOT_WIRED' : 'WIRED',
    cacheStatus,
    kisStatus,
    providerIssue,
    marketSignal,
    previousTradingDateDiagnostic,
    executionImpact: 'NONE',
    liveExecutionAllowed: false,
    shadowObservableAllowed: true,
    ...(input.naverInvestorTrendAdr0481 ? { naverInvestorTrendAdr0481: {
      status: input.naverInvestorTrendAdr0481.status,
      signal: input.naverInvestorTrendAdr0481.signal,
      coverage: input.naverInvestorTrendAdr0481.coverage,
      executionImpact: input.naverInvestorTrendAdr0481.executionImpact,
      liveExecutionAllowed: input.naverInvestorTrendAdr0481.liveExecutionAllowed,
      policyPromotionMode: input.naverInvestorTrendAdr0481.policyPromotionMode,
    } } : {}),
    ...(input.investorFlowRouter ? { investorFlowRouter: input.investorFlowRouter } : {}),
    ...(input.supplySourceFreshnessAdr0483 ? { supplySourceFreshnessAdr0483: input.supplySourceFreshnessAdr0483 } : {}),
    nextAction: providerIssue ? 'WIRE_NAVER_OR_REPAIR_CACHE_KEY' : 'NONE',
  };
}

export function formatSupplyProviderWarmupCompactLine(report: SupplyProviderWarmupReport): string {
  const d = report.previousTradingDateDiagnostic;
  return [
    '📊 Supply Provider Warmup (ADR-0473)',
    `  KRX: ${report.krxStatus} / previousTradingDateCandidate=${d.previousTradingDateCandidate} / cacheHit=${String(d.cacheHit)}`,
    `  NAVER: ${report.naverStatus}`,
    ...(report.naverInvestorTrendAdr0481 ? [
      `  ADR-0481 NAVER InvestorTrend: ${report.naverInvestorTrendAdr0481.status} | signal=${report.naverInvestorTrendAdr0481.signal} | days=${report.naverInvestorTrendAdr0481.coverage.availableDays}/${report.naverInvestorTrendAdr0481.coverage.requestedDays} | impact=${report.naverInvestorTrendAdr0481.executionImpact}`,
    ] : []),
    `  Semantic NetBuy: schema ready / collector ${report.semanticNetBuyCollectorStatus === 'WIRED' ? 'wired' : 'not wired'}`,
    ...(report.supplySourceFreshnessAdr0483 ? [`  ${formatSupplySourceFreshnessCompactAdr0483(report.supplySourceFreshnessAdr0483)}`] : []),
    `  CACHE: ${report.cacheStatus}`,
    `  KIS: ${report.kisStatus}`,
    `  providerIssue=${String(report.providerIssue)}`,
    `  marketSignal=${String(report.marketSignal)}`,
    ...(report.investorFlowRouter ? [
      `  ADR-0477 Router: ${report.investorFlowRouter.status} / selected=${report.investorFlowRouter.selectedProvider} / signal=${report.investorFlowRouter.signal} / coverage=${report.investorFlowRouter.coverage.available}/${report.investorFlowRouter.coverage.total}`,
    ] : []),
    `  executionImpact=${report.executionImpact}`,
    `  nextAction: ${report.nextAction}`,
  ].join('\n');
}

function extractKstHhmm(iso: string | undefined): string | null {
  if (typeof iso !== 'string') return null;
  const match = /T(\d{2}):(\d{2})/.exec(iso);
  if (!match) return null;
  return `${match[1]}:${match[2]} KST`;
}

/**
 * ADR-0445 — KRX provider 진단 sub-lines (운영자 lastOK/lastFail/expected/detected/
 * cache 즉시 인지). 옵셔널 propagate 필드가 부재하면 sub-line 자체를 노출하지 않아
 * 기존 ADR-0435 출력과 후방호환.
 */
function formatKrxAdr0445SubLines(krx: InvestorFlowProviderHealth): string[] {
  const sub: string[] = [];
  const lastOkHhmm = extractKstHhmm(krx.lastSuccessAtKst);
  if (lastOkHhmm) {
    const rowsLabel = krx.lastSuccessRowCount !== undefined ? ` rows=${krx.lastSuccessRowCount}` : '';
    sub.push(`  lastOK: ${lastOkHhmm}${rowsLabel}`);
  }
  const lastFailHhmm = extractKstHhmm(krx.lastFailureAtKst);
  if (lastFailHhmm) sub.push(`  lastFail: ${lastFailHhmm}`);
  if (krx.expectedPaths && krx.expectedPaths.length > 0) {
    sub.push(`  expected: ${krx.expectedPaths.slice(0, 4).join(',')}`);
  }
  if (krx.detectedCandidatePaths && krx.detectedCandidatePaths.length > 0) {
    sub.push(`  detected: ${krx.detectedCandidatePaths.slice(0, 3).join(',')}`);
  }
  if (krx.cacheStatus) sub.push(`  cache: ${krx.cacheStatus}`);
  return sub;
}

export function summarizeInvestorFlowProviderHealth(health: InvestorFlowProviderHealth[]): string {
  if (health.length === 0) return 'Supply Provider Health: no recent investor-flow provider sample';
  const byProvider = new Map<InvestorFlowProvider, InvestorFlowProviderHealth>();
  for (const h of health) byProvider.set(h.provider, h);
  const krx = byProvider.get('KRX');
  const naver = byProvider.get('NAVER');
  const composite = byProvider.get('COMPOSITE');
  const cache = byProvider.get('CACHE');
  const lines = ['Supply Provider Health:'];
  if (krx) {
    lines.push(`- KRX: ${krx.dataAvailable ? 'OK' : 'DATA_UNAVAILABLE'} / ${krx.status}`);
    // ADR-0445 — parser 진단 sub-lines (옵셔널, 후방호환).
    lines.push(...formatKrxAdr0445SubLines(krx));
  }
  if (naver) lines.push(`- NAVER: ${naver.status}`);
  lines.push(`- Semantic NetBuy: ${composite?.semanticAvailable ? 'OK' : 'NOT_WIRED'}`);
  if (cache) lines.push(`- CACHE: ${cache.status}`);
  lines.push(`- supply_confluence: ${composite?.semanticAvailable ? (composite.isNegativeFlowConfirmed ? 'FAIL_CONFIRMED' : 'available') : 'DATA_UNAVAILABLE'}, not failed`);
  lines.push(`- liveStrongBuyAllowed: ${composite?.semanticAvailable && composite.isPositiveFlowConfirmed ? 'true' : 'false'}`);
  lines.push('- shadowObservableAllowed: true');
  return lines.join('\n');
}
