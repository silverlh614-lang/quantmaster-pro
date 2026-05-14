/**
 * @responsibility KIS API error taxonomy, coverage diagnosis, retry/fallback routing,
 * temporary unsupported TTL, circuit breaker hints, and call-pressure telemetry.
 *
 * Patch ID: KIS-ERROR-TAXONOMY-AND-ROUTER-007
 *
 * Safety invariants:
 *   - KIS provider errors are never converted into market signals.
 *   - executionImpact is always isolated as 'NONE'.
 *   - 404 unsupported/parameter mismatch paths do not retry and do not trip circuits.
 *   - 5xx server/provider failures retry only with bounded backoff and may open a
 *     provider/TR circuit before falling back to degraded data sources.
 */

export type KisErrorClass =
  | 'AUTH_ERROR'
  | 'NOT_FOUND_OR_UNSUPPORTED'
  | 'SERVER_ERROR'
  | 'TIMEOUT'
  | 'EMPTY_OUTPUT'
  | 'PARAM_MISMATCH'
  | 'RATE_LIMIT_OR_THROTTLE'
  | 'UNKNOWN_PROVIDER_ERROR';

export type KisCoverageDiagnosis =
  | 'TR_NOT_SUPPORTED'
  | 'ENDPOINT_PATH_MISMATCH'
  | 'MOCK_ENV_UNSUPPORTED'
  | 'LIVE_ENV_UNSUPPORTED'
  | 'MARKET_CODE_MISMATCH'
  | 'SYMBOL_FORMAT_MISMATCH'
  | 'SUPPORTED_OR_UNKNOWN';

export type KisFallbackProvider = 'KIS_ALT' | 'KRX' | 'CACHE' | 'NONE';
export type KisFallbackConfidence = 'DEGRADED' | 'STALE' | 'MISSING';

export interface KisTrCoverageEntry {
  purpose: string;
  endpoint: string;
  supportsLive: boolean;
  supportsMock: boolean;
  supportsIntraday: boolean;
  supportedMarket: readonly string[];
  fallback: readonly KisFallbackProvider[];
}

export const kisTrCoverageMap: Readonly<Record<string, KisTrCoverageEntry>> = Object.freeze({
  FHKST01710000: Object.freeze({
    purpose: 'KIS domestic stock real-time/intraday quotation data probe',
    endpoint: '/uapi/domestic-stock/v1/quotations/inquire-time-itemchartprice',
    supportsLive: true,
    supportsMock: false,
    supportsIntraday: true,
    supportedMarket: Object.freeze(['KOSPI', 'KOSDAQ']),
    fallback: Object.freeze(['KIS_ALT', 'KRX', 'CACHE'] satisfies KisFallbackProvider[]),
  }),
  FHKST03010100: Object.freeze({
    purpose: 'KIS domestic stock investor/program intraday data probe',
    endpoint: '/uapi/domestic-stock/v1/quotations/inquire-investor',
    supportsLive: true,
    supportsMock: false,
    supportsIntraday: true,
    supportedMarket: Object.freeze(['KOSPI', 'KOSDAQ']),
    fallback: Object.freeze(['CACHE', 'KRX'] satisfies KisFallbackProvider[]),
  }),
  FHKST01010100: Object.freeze({
    purpose: 'KIS domestic stock current quote',
    endpoint: '/uapi/domestic-stock/v1/quotations/inquire-price',
    supportsLive: true,
    supportsMock: true,
    supportsIntraday: false,
    supportedMarket: Object.freeze(['KOSPI', 'KOSDAQ']),
    fallback: Object.freeze(['KRX', 'CACHE'] satisfies KisFallbackProvider[]),
  }),
});

export interface ClassifyKisErrorInput {
  httpStatus?: number;
  trId?: string;
  endpoint?: string;
  marketCode?: string;
  symbol?: string;
  responseCode?: string;
  responseMessage?: string;
  outputLength?: number;
  environment?: 'LIVE' | 'MOCK';
}

export interface KisErrorClassification {
  errorClass: KisErrorClass;
  retryable: boolean;
  fallbackRequired: boolean;
  circuitBreakerEligible: boolean;
  providerIssue: true;
  marketSignal: false;
  executionImpact: 'NONE';
  coverageDiagnosis: KisCoverageDiagnosis;
}

function normalizeMarketCode(marketCode?: string): string | undefined {
  if (!marketCode) return undefined;
  const upper = marketCode.trim().toUpperCase();
  if (upper === 'J' || upper === 'KOSPI') return 'KOSPI';
  if (upper === 'Q' || upper === 'KOSDAQ') return 'KOSDAQ';
  return upper;
}

function looksLikeDomesticStockSymbol(symbol?: string): boolean {
  return !symbol || /^\d{6}$/.test(symbol.trim());
}

export function diagnoseKisCoverage(input: ClassifyKisErrorInput): KisCoverageDiagnosis {
  const entry = input.trId ? kisTrCoverageMap[input.trId] : undefined;
  if (!entry) return input.trId ? 'TR_NOT_SUPPORTED' : 'SUPPORTED_OR_UNKNOWN';

  if (input.environment === 'MOCK' && !entry.supportsMock) return 'MOCK_ENV_UNSUPPORTED';
  if (input.environment === 'LIVE' && !entry.supportsLive) return 'LIVE_ENV_UNSUPPORTED';

  const market = normalizeMarketCode(input.marketCode);
  if (market && !entry.supportedMarket.includes(market)) return 'MARKET_CODE_MISMATCH';
  if (!looksLikeDomesticStockSymbol(input.symbol)) return 'SYMBOL_FORMAT_MISMATCH';

  if (input.endpoint && input.endpoint !== entry.endpoint) return 'ENDPOINT_PATH_MISMATCH';
  return 'SUPPORTED_OR_UNKNOWN';
}

export function classifyKisError(input: ClassifyKisErrorInput): KisErrorClassification {
  const status = input.httpStatus;
  const message = (input.responseMessage ?? '').toLowerCase();
  const responseCode = (input.responseCode ?? '').toLowerCase();
  const coverageDiagnosis = diagnoseKisCoverage(input);

  let errorClass: KisErrorClass = 'UNKNOWN_PROVIDER_ERROR';
  if (
    message.includes('timeout')
    || message.includes('etimedout')
    || message.includes('econnreset')
    || responseCode.includes('timeout')
  ) {
    errorClass = 'TIMEOUT';
  } else if (status === 401 || status === 403 || message.includes('token') || message.includes('appkey')) {
    errorClass = 'AUTH_ERROR';
  } else if (status === 429 || message.includes('rate limit') || message.includes('throttle') || message.includes('초과')) {
    errorClass = 'RATE_LIMIT_OR_THROTTLE';
  } else if (status === 404) {
    errorClass = coverageDiagnosis === 'MARKET_CODE_MISMATCH' || coverageDiagnosis === 'SYMBOL_FORMAT_MISMATCH'
      ? 'PARAM_MISMATCH'
      : 'NOT_FOUND_OR_UNSUPPORTED';
  } else if (status === 500 || status === 502 || status === 503 || status === 504) {
    errorClass = 'SERVER_ERROR';
  } else if (status === 200 && input.outputLength === 0) {
    errorClass = 'EMPTY_OUTPUT';
  } else if (coverageDiagnosis === 'MARKET_CODE_MISMATCH' || coverageDiagnosis === 'SYMBOL_FORMAT_MISMATCH') {
    errorClass = 'PARAM_MISMATCH';
  }

  const policy = policyForKisErrorClass(errorClass);
  return {
    ...policy,
    errorClass,
    coverageDiagnosis,
    providerIssue: true,
    marketSignal: false,
    executionImpact: 'NONE',
  };
}

export function policyForKisErrorClass(errorClass: KisErrorClass): Pick<
  KisErrorClassification,
  'retryable' | 'fallbackRequired' | 'circuitBreakerEligible'
> {
  switch (errorClass) {
    case 'AUTH_ERROR':
      return { retryable: true, fallbackRequired: true, circuitBreakerEligible: false };
    case 'NOT_FOUND_OR_UNSUPPORTED':
    case 'PARAM_MISMATCH':
      return { retryable: false, fallbackRequired: true, circuitBreakerEligible: false };
    case 'SERVER_ERROR':
      return { retryable: true, fallbackRequired: true, circuitBreakerEligible: true };
    case 'TIMEOUT':
      return { retryable: true, fallbackRequired: true, circuitBreakerEligible: true };
    case 'EMPTY_OUTPUT':
      return { retryable: false, fallbackRequired: true, circuitBreakerEligible: false };
    case 'RATE_LIMIT_OR_THROTTLE':
      return { retryable: true, fallbackRequired: true, circuitBreakerEligible: false };
    case 'UNKNOWN_PROVIDER_ERROR':
    default:
      return { retryable: false, fallbackRequired: true, circuitBreakerEligible: false };
  }
}

const DEFAULT_UNSUPPORTED_TTL_MS = 10 * 60_000;
const _temporaryUnsupportedUntil = new Map<string, number>();

export function buildTemporaryUnsupportedKey(input: Pick<ClassifyKisErrorInput, 'trId' | 'endpoint' | 'marketCode'>): string {
  return `${input.trId ?? 'UNKNOWN_TR'}:${input.endpoint ?? 'UNKNOWN_ENDPOINT'}:${normalizeMarketCode(input.marketCode) ?? 'ANY_MARKET'}`;
}

export function registerKisTemporaryUnsupported(
  input: Pick<ClassifyKisErrorInput, 'trId' | 'endpoint' | 'marketCode'>,
  nowMs = Date.now(),
  ttlMs = DEFAULT_UNSUPPORTED_TTL_MS,
): number {
  const until = nowMs + ttlMs;
  _temporaryUnsupportedUntil.set(buildTemporaryUnsupportedKey(input), until);
  return until;
}

export function isKisTemporaryUnsupported(
  input: Pick<ClassifyKisErrorInput, 'trId' | 'endpoint' | 'marketCode'>,
  nowMs = Date.now(),
): boolean {
  const key = buildTemporaryUnsupportedKey(input);
  const until = _temporaryUnsupportedUntil.get(key) ?? 0;
  if (until <= nowMs) {
    _temporaryUnsupportedUntil.delete(key);
    return false;
  }
  return true;
}

export function recordKisUnsupported404(input: ClassifyKisErrorInput, nowMs = Date.now()): KisErrorClassification {
  const classified = classifyKisError({ ...input, httpStatus: 404 });
  registerKisTemporaryUnsupported(input, nowMs);
  return classified;
}

export const KIS_ERROR_TAXONOMY_CONSTANTS = Object.freeze({
  UNSUPPORTED_TTL_MS: DEFAULT_UNSUPPORTED_TTL_MS,
  SERVER_TR_BURST_WINDOW_MS: 60_000,
  SERVER_TR_BURST_THRESHOLD: 3,
  SERVER_PROVIDER_BURST_WINDOW_MS: 5 * 60_000,
  SERVER_PROVIDER_BURST_THRESHOLD: 10,
  SERVER_CONSECUTIVE_FAILURE_THRESHOLD: 5,
  SERVER_CIRCUIT_COOLDOWN_MS: 60_000,
  SERVER_MAX_RETRIES: 2,
});

interface ServerFailureEvent { trId: string; atMs: number }
interface ServerCircuitState {
  state: 'CLOSED' | 'OPEN';
  cooldownUntilMs: number;
  consecutiveFailures: number;
  lastOpenedReason: string | null;
}

const _serverFailures: ServerFailureEvent[] = [];
const _serverCircuitByTrId = new Map<string, ServerCircuitState>();

function getCircuitState(trId: string): ServerCircuitState {
  const existing = _serverCircuitByTrId.get(trId);
  if (existing) return existing;
  const created: ServerCircuitState = {
    state: 'CLOSED',
    cooldownUntilMs: 0,
    consecutiveFailures: 0,
    lastOpenedReason: null,
  };
  _serverCircuitByTrId.set(trId, created);
  return created;
}

export function isKisServerCircuitOpen(trId: string, nowMs = Date.now()): boolean {
  const state = getCircuitState(trId);
  if (state.state === 'OPEN' && nowMs < state.cooldownUntilMs) return true;
  if (state.state === 'OPEN') {
    state.state = 'CLOSED';
    state.cooldownUntilMs = 0;
    state.consecutiveFailures = 0;
  }
  return false;
}

export function recordKisServerErrorForCircuit(trId: string, nowMs = Date.now()): {
  opened: boolean;
  reason: 'HTTP_500_BURST' | 'PROVIDER_500_BURST' | 'CONSECUTIVE_FAILURES' | null;
  cooldownSec: number;
} {
  const state = getCircuitState(trId);
  state.consecutiveFailures += 1;
  _serverFailures.push({ trId, atMs: nowMs });
  const providerWindowStart = nowMs - KIS_ERROR_TAXONOMY_CONSTANTS.SERVER_PROVIDER_BURST_WINDOW_MS;
  while (_serverFailures.length > 0 && _serverFailures[0]!.atMs < providerWindowStart) _serverFailures.shift();

  const trWindowStart = nowMs - KIS_ERROR_TAXONOMY_CONSTANTS.SERVER_TR_BURST_WINDOW_MS;
  const trBurstCount = _serverFailures.filter((e) => e.trId === trId && e.atMs >= trWindowStart).length;
  const providerBurstCount = _serverFailures.length;

  let reason: 'HTTP_500_BURST' | 'PROVIDER_500_BURST' | 'CONSECUTIVE_FAILURES' | null = null;
  if (trBurstCount >= KIS_ERROR_TAXONOMY_CONSTANTS.SERVER_TR_BURST_THRESHOLD) reason = 'HTTP_500_BURST';
  else if (providerBurstCount >= KIS_ERROR_TAXONOMY_CONSTANTS.SERVER_PROVIDER_BURST_THRESHOLD) reason = 'PROVIDER_500_BURST';
  else if (state.consecutiveFailures >= KIS_ERROR_TAXONOMY_CONSTANTS.SERVER_CONSECUTIVE_FAILURE_THRESHOLD) reason = 'CONSECUTIVE_FAILURES';

  if (reason) {
    state.state = 'OPEN';
    state.cooldownUntilMs = nowMs + KIS_ERROR_TAXONOMY_CONSTANTS.SERVER_CIRCUIT_COOLDOWN_MS;
    state.lastOpenedReason = reason;
  }

  return {
    opened: state.state === 'OPEN' && reason !== null,
    reason,
    cooldownSec: Math.ceil(KIS_ERROR_TAXONOMY_CONSTANTS.SERVER_CIRCUIT_COOLDOWN_MS / 1000),
  };
}

export function recordKisServerSuccess(trId: string): void {
  const state = getCircuitState(trId);
  state.state = 'CLOSED';
  state.cooldownUntilMs = 0;
  state.consecutiveFailures = 0;
  state.lastOpenedReason = null;
}

interface KisCallPressureEvent { trId: string; atMs: number }
const _callPressureEvents: KisCallPressureEvent[] = [];
let _concurrentCalls = 0;
let _queuedCalls = 0;
let _deferredCalls = 0;

export function recordKisCallStarted(trId: string, nowMs = Date.now()): void {
  _concurrentCalls += 1;
  _callPressureEvents.push({ trId, atMs: nowMs });
  const minuteStart = nowMs - 60_000;
  while (_callPressureEvents.length > 0 && _callPressureEvents[0]!.atMs < minuteStart) _callPressureEvents.shift();
}

export function recordKisCallFinished(): void {
  _concurrentCalls = Math.max(0, _concurrentCalls - 1);
}

export function recordKisCallDeferred(): void {
  _deferredCalls += 1;
}

export function getKisCallPressureSnapshot(nowMs = Date.now()): {
  windowSec: 1;
  totalCalls: number;
  byTrId: Record<string, number>;
  sameSecondCalls: number;
  sameMinuteCalls: number;
  concurrentCalls: number;
  queuedCalls: number;
  deferredCalls: number;
  retryWaveDetected: boolean;
} {
  const secondStart = nowMs - 1_000;
  const minuteStart = nowMs - 60_000;
  const sameSecond = _callPressureEvents.filter((e) => e.atMs >= secondStart);
  const sameMinute = _callPressureEvents.filter((e) => e.atMs >= minuteStart);
  const byTrId: Record<string, number> = {};
  for (const event of sameSecond) byTrId[event.trId] = (byTrId[event.trId] ?? 0) + 1;
  return {
    windowSec: 1,
    totalCalls: sameSecond.length,
    byTrId,
    sameSecondCalls: sameSecond.length,
    sameMinuteCalls: sameMinute.length,
    concurrentCalls: _concurrentCalls,
    queuedCalls: _queuedCalls,
    deferredCalls: _deferredCalls,
    retryWaveDetected: sameSecond.length >= 3 || sameMinute.length >= 10,
  };
}

export function selectKisFallback(input: {
  trId?: string;
  errorClass: KisErrorClass;
}): {
  fallbackProvider: KisFallbackProvider;
  reason: string;
  confidence: KisFallbackConfidence;
  marketSignal: false;
  executionImpact: 'NONE';
} {
  const entry = input.trId ? kisTrCoverageMap[input.trId] : undefined;
  const first = entry?.fallback[0] ?? 'CACHE';
  let fallbackProvider: KisFallbackProvider = first;
  if (input.errorClass === 'NOT_FOUND_OR_UNSUPPORTED' || input.errorClass === 'PARAM_MISMATCH') {
    fallbackProvider = entry?.fallback.find((p) => p !== 'NONE') ?? 'CACHE';
  } else if (input.errorClass === 'SERVER_ERROR') {
    fallbackProvider = entry?.fallback.find((p) => p === 'KRX' || p === 'CACHE') ?? 'CACHE';
  }
  return {
    fallbackProvider,
    reason: `${input.errorClass}_ROUTE`,
    confidence: fallbackProvider === 'CACHE' ? 'STALE' : 'DEGRADED',
    marketSignal: false,
    executionImpact: 'NONE',
  };
}

export function formatKisFallbackSelectedLog(input: {
  fromTrId?: string;
  errorClass: KisErrorClass;
  fallbackProvider: KisFallbackProvider;
  reason: string;
  confidence: KisFallbackConfidence;
}): string {
  return `[KIS_FALLBACK_SELECTED] fromTrId=${input.fromTrId ?? 'UNKNOWN_TR'} errorClass=${input.errorClass} `
    + `fallbackProvider=${input.fallbackProvider} reason=${input.reason} confidence=${input.confidence} executionImpact=NONE`;
}

export function formatKisProviderHealthSummary(input: {
  notFoundCount?: number;
  serverErrorCount?: number;
  circuitActive?: boolean;
}): string {
  return [
    'KIS Provider Health:',
    `- 404: endpoint unsupported / param mismatch suspected${input.notFoundCount ? ` (${input.notFoundCount})` : ''}`,
    `- 500: server error${input.circuitActive ? ', circuit breaker active' : ''}${input.serverErrorCount ? ` (${input.serverErrorCount})` : ''}`,
    '- executionImpact=NONE',
    '- marketSignal=false',
  ].join('\n');
}

export function __resetKisErrorTaxonomyForTests(): void {
  _temporaryUnsupportedUntil.clear();
  _serverFailures.splice(0, _serverFailures.length);
  _serverCircuitByTrId.clear();
  _callPressureEvents.splice(0, _callPressureEvents.length);
  _concurrentCalls = 0;
  _queuedCalls = 0;
  _deferredCalls = 0;
}
