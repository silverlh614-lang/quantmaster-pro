// @responsibility KIS official inquire-price quote normalization and diagnostics.

import { KIS_OFFICIAL_INQUIRE_PRICE_ENDPOINT } from './kisOfficialEndpointRegistry.js';

export type KisProviderStatus =
  | 'OK_WITH_DATA'
  | 'OK_EMPTY'
  | 'HTTP_ERROR'
  | 'KIS_ERROR_CODE'
  | 'TOKEN_EXPIRED'
  | 'RATE_LIMITED'
  | 'FIELD_MISSING'
  | 'PARSE_ERROR'
  | 'UNKNOWN_ERROR';

export type KisOfficialQuoteConfidence =
  | 'VERIFIED'
  | 'DEGRADED'
  | 'STALE'
  | 'MISSING'
  | 'AI_ESTIMATED';

export type KisOfficialQuoteCoverageSource =
  | 'KIS_OFFICIAL'
  | 'QMP_QUOTE'
  | 'YAHOO'
  | 'CACHE'
  | 'UNKNOWN';

export interface KisOfficialDriftDiagnostic {
  type: 'KIS_OFFICIAL_DRIFT_DETECTED';
  api: 'INQUIRE_PRICE';
  expectedPath: string;
  actualPath: string;
  expectedTrId: string;
  actualTrId: string;
  action: 'DO_NOT_AUTO_REPLACE_REQUIRE_REVIEW';
}

export interface NormalizedKisOfficialQuote {
  symbol: string | null;
  currentPrice: number | null;
  price: number | null;
  open: number | null;
  high: number | null;
  low: number | null;
  previousClose: number | null;
  change: number | null;
  changePercent: number | null;
  volume: number | null;
  tradingValue: number | null;
  asOf: string | null;
  provider: 'KIS_OFFICIAL';
  providerStatus: KisProviderStatus;
  dataConfidence: KisOfficialQuoteConfidence;
  marketDivCode: string | null;
}

export interface KisOfficialQuoteCoverageDiagnostic {
  source: KisOfficialQuoteCoverageSource;
  endpoint: string;
  trId: string;
  requiredParams: string[];
  requiredFields: string[];
  presentFields: string[];
  missingFields: string[];
  allRequiredFieldsPresent: boolean;
  providerStatus: KisProviderStatus;
  confidence: KisOfficialQuoteConfidence;
  providerIssue: boolean;
  marketSignal: false;
  executionImpact: 'DIAGNOSTIC_ONLY';
  asOf: string | null;
  provider: 'KIS_OFFICIAL' | null;
  normalizedQuote: NormalizedKisOfficialQuote;
  rawFieldKeys: string[];
  driftDiagnostics: KisOfficialDriftDiagnostic[];
}

export interface NormalizeKisOfficialQuoteOptions {
  symbol?: string | null;
  marketDivCode?: string | null;
  asOf?: string | null;
  fetchedAt?: string | null;
  actualPath?: string | null;
  actualTrId?: string | null;
}

export const KIS_OFFICIAL_QUOTE_REQUIRED_FIELDS = [
  'currentPrice',
  'volume',
  'high',
  'low',
  'changePercent',
  'tradingValue',
] as const;

const KIS_RAW_FIELD_ALIASES = {
  symbol: ['stck_shrn_iscd', 'mksc_shrn_iscd', 'pdno'],
  currentPrice: ['stck_prpr', 'STCK_PRPR'],
  open: ['stck_oprc', 'STCK_OPRC'],
  high: ['stck_hgpr', 'STCK_HGPR'],
  low: ['stck_lwpr', 'STCK_LWPR'],
  previousClose: ['prdy_clpr', 'stck_sdpr', 'PRDY_CLPR', 'STCK_SDPR'],
  change: ['prdy_vrss', 'stck_prdy_vrss', 'PRDY_VRSS', 'STCK_PRDY_VRSS'],
  changePercent: ['prdy_ctrt', 'stck_prdy_ctrt', 'PRDY_CTRT', 'STCK_PRDY_CTRT'],
  volume: ['acml_vol', 'ACML_VOL'],
  tradingValue: ['acml_tr_pbmn', 'ACML_TR_PBMN'],
  marketDivCode: ['fid_cond_mrkt_div_code', 'FID_COND_MRKT_DIV_CODE', 'marketDivCode'],
} as const;

const QUOTE_FIELD_ALIASES: Record<string, readonly string[]> = {
  currentPrice: ['currentPrice', 'price', 'regularMarketPrice', 'stck_prpr'],
  volume: ['volume', 'regularMarketVolume', 'acmlVol', 'acml_vol'],
  high: ['high', 'dayHigh', 'regularMarketDayHigh', 'highPrice', 'stck_hgpr'],
  low: ['low', 'dayLow', 'regularMarketDayLow', 'lowPrice', 'stck_lwpr'],
  changePercent: ['changePercent', 'changeRate', 'prdyCtrt', 'prdy_ctrt', 'stck_prdy_ctrt'],
  tradingValue: ['tradingValue', 'tradeValue', 'accTradePrice', 'acmlTrPbmn', 'acml_tr_pbmn'],
};

interface ParsedNumber {
  value: number | null;
  present: boolean;
  parseError: boolean;
  alias: string | null;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === 'object' && !Array.isArray(value);
}

function cleanNumber(value: unknown): number | null {
  if (typeof value === 'number') return Number.isFinite(value) ? value : null;
  if (typeof value !== 'string') return null;
  const cleaned = value.replace(/,/g, '').replace(/%/g, '').trim();
  if (!cleaned) return null;
  const n = Number(cleaned);
  return Number.isFinite(n) ? n : null;
}

function parseNumberFromAliases(row: Record<string, unknown> | null, aliases: readonly string[]): ParsedNumber {
  if (!row) return { value: null, present: false, parseError: false, alias: null };
  for (const alias of aliases) {
    if (!Object.prototype.hasOwnProperty.call(row, alias)) continue;
    const raw = row[alias];
    if (raw == null || raw === '') return { value: null, present: false, parseError: false, alias };
    const value = cleanNumber(raw);
    return {
      value,
      present: true,
      parseError: value == null,
      alias,
    };
  }
  return { value: null, present: false, parseError: false, alias: null };
}

function readStringFromAliases(row: Record<string, unknown> | null, aliases: readonly string[]): string | null {
  if (!row) return null;
  for (const alias of aliases) {
    const raw = row[alias];
    if (typeof raw === 'string' && raw.trim().length > 0) return raw.trim();
    if (typeof raw === 'number' && Number.isFinite(raw)) return String(raw);
  }
  return null;
}

function pickOutput(payload: unknown): Record<string, unknown> | null {
  if (!isRecord(payload)) return null;
  const output = payload.output;
  if (isRecord(output)) return output;
  if (Array.isArray(output) && output.length > 0 && isRecord(output[0])) return output[0];
  const hasRawField = Object.values(KIS_RAW_FIELD_ALIASES)
    .flat()
    .some(field => Object.prototype.hasOwnProperty.call(payload, field));
  return hasRawField ? payload : null;
}

function classifyKisStatus(payload: unknown, output: Record<string, unknown> | null): KisProviderStatus | null {
  if (!isRecord(payload)) return 'OK_EMPTY';
  const httpStatus = cleanNumber(payload.httpStatus ?? payload.statusCode ?? payload.status);
  if (httpStatus != null && httpStatus >= 400) {
    if (httpStatus === 401 || httpStatus === 403) return 'TOKEN_EXPIRED';
    if (httpStatus === 429) return 'RATE_LIMITED';
    return 'HTTP_ERROR';
  }
  const rtCd = payload.rt_cd;
  if (rtCd != null && String(rtCd) !== '0') {
    const message = [
      payload.msg_cd,
      payload.msg1,
      payload.message,
      payload.error_description,
      payload.error,
    ].map(value => String(value ?? '')).join(' ').toUpperCase();
    if (/TOKEN|AUTH|OAUTH|UNAUTHORIZED|EXPIRED|401/.test(message)) return 'TOKEN_EXPIRED';
    if (/RATE|THROTTLE|TOO MANY|429|LIMIT/.test(message)) return 'RATE_LIMITED';
    return 'KIS_ERROR_CODE';
  }
  if (!output || Object.keys(output).length === 0) return 'OK_EMPTY';
  return null;
}

function confidenceForStatus(status: KisProviderStatus, source: KisOfficialQuoteCoverageSource): KisOfficialQuoteConfidence {
  if (status === 'OK_WITH_DATA' && source !== 'UNKNOWN') return 'VERIFIED';
  if (status === 'OK_EMPTY') return 'MISSING';
  return 'DEGRADED';
}

function hasQuoteValue(quote: Record<string, unknown>, aliases: readonly string[]): boolean {
  return aliases.some((alias) => {
    if (!Object.prototype.hasOwnProperty.call(quote, alias)) return false;
    const value = quote[alias];
    if (value == null) return false;
    if (typeof value === 'number') return Number.isFinite(value);
    if (typeof value === 'string') return value.trim().length > 0;
    return true;
  });
}

function firstQuoteValue(quote: Record<string, unknown>, aliases: readonly string[]): unknown {
  for (const alias of aliases) {
    if (Object.prototype.hasOwnProperty.call(quote, alias) && quote[alias] != null) return quote[alias];
  }
  return undefined;
}

function stringOrNull(value: unknown): string | null {
  return typeof value === 'string' && value.trim().length > 0 ? value.trim() : null;
}

function inferQuoteProviderLabel(quote: Record<string, unknown>): string | null {
  const priceMetadata = quote.priceMetadata as { source?: unknown } | undefined;
  return stringOrNull(priceMetadata?.source)
    ?? stringOrNull(quote.quoteProvider)
    ?? stringOrNull(quote.provider)
    ?? stringOrNull(quote.source)
    ?? stringOrNull(quote.priceProvider);
}

function inferQuoteCoverageSource(quote: Record<string, unknown>): KisOfficialQuoteCoverageSource {
  const provider = (inferQuoteProviderLabel(quote) ?? '').toUpperCase();
  const priceProvider = String(quote.priceProvider ?? '').toUpperCase();
  const dataQuality = String(quote.dataQuality ?? '').toUpperCase();
  if (provider.includes('KIS') || priceProvider.includes('KIS')) return 'KIS_OFFICIAL';
  if (provider.includes('QMP')) return 'QMP_QUOTE';
  if (provider.includes('YAHOO') || priceProvider.includes('YAHOO')) return 'YAHOO';
  if (provider.includes('CACHE') || priceProvider.includes('CACHE') || dataQuality.includes('CACHE')) return 'CACHE';
  return 'UNKNOWN';
}

function signedByKisDirection(value: number | null, output: Record<string, unknown> | null): number | null {
  if (value == null) return null;
  const sign = readStringFromAliases(output, ['prdy_vrss_sign', 'PRDY_VRSS_SIGN']);
  if (sign === '4' || sign === '5') return -Math.abs(value);
  if (sign === '1' || sign === '2') return Math.abs(value);
  return value;
}

function coverageFieldsFromQuote(quote: Record<string, unknown>): {
  presentFields: string[];
  missingFields: string[];
  allRequiredFieldsPresent: boolean;
} {
  const presentFields: string[] = [];
  const missingFields: string[] = [];
  for (const field of KIS_OFFICIAL_QUOTE_REQUIRED_FIELDS) {
    if (hasQuoteValue(quote, QUOTE_FIELD_ALIASES[field])) presentFields.push(field);
    else missingFields.push(field);
  }
  return {
    presentFields,
    missingFields,
    allRequiredFieldsPresent: missingFields.length === 0,
  };
}

export function mapKisProviderStatusToConfidence(status: KisProviderStatus): KisOfficialQuoteConfidence {
  return status === 'OK_WITH_DATA'
    ? 'VERIFIED'
    : status === 'OK_EMPTY'
      ? 'MISSING'
      : 'DEGRADED';
}

export function detectKisOfficialQuoteDrift(input: {
  path?: string | null;
  trId?: string | null;
} = {}): KisOfficialDriftDiagnostic | null {
  const expectedPath = KIS_OFFICIAL_INQUIRE_PRICE_ENDPOINT.path;
  const expectedTrId = KIS_OFFICIAL_INQUIRE_PRICE_ENDPOINT.trId;
  const actualPath = input.path ?? expectedPath;
  const actualTrId = input.trId ?? expectedTrId;
  if (actualPath === expectedPath && actualTrId === expectedTrId) return null;
  return {
    type: 'KIS_OFFICIAL_DRIFT_DETECTED',
    api: 'INQUIRE_PRICE',
    expectedPath,
    actualPath,
    expectedTrId,
    actualTrId,
    action: 'DO_NOT_AUTO_REPLACE_REQUIRE_REVIEW',
  };
}

export function normalizeKisOfficialQuotePayload(
  payload: unknown,
  options: NormalizeKisOfficialQuoteOptions = {},
): KisOfficialQuoteCoverageDiagnostic {
  const output = pickOutput(payload);
  const earlyStatus = classifyKisStatus(payload, output);

  const currentPrice = parseNumberFromAliases(output, KIS_RAW_FIELD_ALIASES.currentPrice);
  const open = parseNumberFromAliases(output, KIS_RAW_FIELD_ALIASES.open);
  const high = parseNumberFromAliases(output, KIS_RAW_FIELD_ALIASES.high);
  const low = parseNumberFromAliases(output, KIS_RAW_FIELD_ALIASES.low);
  const previousClose = parseNumberFromAliases(output, KIS_RAW_FIELD_ALIASES.previousClose);
  const change = parseNumberFromAliases(output, KIS_RAW_FIELD_ALIASES.change);
  const changePercent = parseNumberFromAliases(output, KIS_RAW_FIELD_ALIASES.changePercent);
  const volume = parseNumberFromAliases(output, KIS_RAW_FIELD_ALIASES.volume);
  const tradingValue = parseNumberFromAliases(output, KIS_RAW_FIELD_ALIASES.tradingValue);

  const parsedRequired = {
    currentPrice,
    volume,
    high,
    low,
    changePercent,
    tradingValue,
  };
  const presentFields = KIS_OFFICIAL_QUOTE_REQUIRED_FIELDS.filter(field => parsedRequired[field].value != null);
  const missingFields = KIS_OFFICIAL_QUOTE_REQUIRED_FIELDS.filter(field => parsedRequired[field].value == null);
  const hasParseError = Object.values(parsedRequired).some(field => field.parseError);

  let providerStatus: KisProviderStatus = earlyStatus ?? 'OK_WITH_DATA';
  if (!earlyStatus) {
    if (hasParseError) providerStatus = 'PARSE_ERROR';
    else if (missingFields.length > 0) providerStatus = 'FIELD_MISSING';
  }

  const dataConfidence = mapKisProviderStatusToConfidence(providerStatus);
  const symbol = options.symbol
    ?? readStringFromAliases(output, KIS_RAW_FIELD_ALIASES.symbol)
    ?? null;
  const marketDivCode = options.marketDivCode
    ?? readStringFromAliases(output, KIS_RAW_FIELD_ALIASES.marketDivCode)
    ?? 'J';
  const asOf = options.asOf ?? options.fetchedAt ?? null;
  const normalizedQuote: NormalizedKisOfficialQuote = {
    symbol,
    currentPrice: currentPrice.value,
    price: currentPrice.value,
    open: open.value,
    high: high.value,
    low: low.value,
    previousClose: previousClose.value,
    change: signedByKisDirection(change.value, output),
    changePercent: signedByKisDirection(changePercent.value, output),
    volume: volume.value,
    tradingValue: tradingValue.value,
    asOf,
    provider: 'KIS_OFFICIAL',
    providerStatus,
    dataConfidence,
    marketDivCode,
  };
  const drift = detectKisOfficialQuoteDrift({
    path: options.actualPath,
    trId: options.actualTrId,
  });

  return {
    source: 'KIS_OFFICIAL',
    endpoint: KIS_OFFICIAL_INQUIRE_PRICE_ENDPOINT.path,
    trId: KIS_OFFICIAL_INQUIRE_PRICE_ENDPOINT.trId,
    requiredParams: [...KIS_OFFICIAL_INQUIRE_PRICE_ENDPOINT.requiredParams],
    requiredFields: [...KIS_OFFICIAL_QUOTE_REQUIRED_FIELDS],
    presentFields,
    missingFields,
    allRequiredFieldsPresent: missingFields.length === 0,
    providerStatus,
    confidence: dataConfidence,
    providerIssue: !['OK_WITH_DATA', 'OK_EMPTY'].includes(providerStatus),
    marketSignal: false,
    executionImpact: 'DIAGNOSTIC_ONLY',
    asOf,
    provider: 'KIS_OFFICIAL',
    normalizedQuote,
    rawFieldKeys: output ? Object.keys(output) : [],
    driftDiagnostics: drift ? [drift] : [],
  };
}

export function buildKisOfficialQuoteCoverageFromQuote(
  quote: Record<string, unknown>,
): KisOfficialQuoteCoverageDiagnostic {
  const rawPayload = firstQuoteValue(quote, [
    'kisOfficialQuoteRaw',
    'kisRawQuote',
    'kisQuoteRaw',
    'kisOfficialPayload',
    'kisPayload',
  ]);
  if (rawPayload) {
    return normalizeKisOfficialQuotePayload(rawPayload, {
      symbol: stringOrNull(quote.symbol) ?? stringOrNull(quote.code) ?? stringOrNull(quote.stockCode),
      marketDivCode: stringOrNull(quote.marketDivCode),
      asOf: stringOrNull(quote.asOf),
      fetchedAt: stringOrNull(quote.fetchedAt),
      actualPath: stringOrNull(quote.kisOfficialEndpoint) ?? stringOrNull(quote.kisEndpoint),
      actualTrId: stringOrNull(quote.kisOfficialTrId) ?? stringOrNull(quote.kisTrId) ?? stringOrNull(quote.trId),
    });
  }

  const embedded = quote.kisOfficialQuote;
  if (isRecord(embedded) && embedded.provider === 'KIS_OFFICIAL') {
    const quoteFields = coverageFieldsFromQuote(embedded);
    const providerStatus = String(embedded.providerStatus ?? '') as KisProviderStatus;
    const status: KisProviderStatus = providerStatus || (quoteFields.allRequiredFieldsPresent ? 'OK_WITH_DATA' : 'FIELD_MISSING');
    const confidence = mapKisProviderStatusToConfidence(status);
    const drift = detectKisOfficialQuoteDrift({
      path: stringOrNull(quote.kisOfficialEndpoint) ?? stringOrNull(quote.kisEndpoint),
      trId: stringOrNull(quote.kisOfficialTrId) ?? stringOrNull(quote.kisTrId) ?? stringOrNull(quote.trId),
    });
    return {
      source: 'KIS_OFFICIAL',
      endpoint: KIS_OFFICIAL_INQUIRE_PRICE_ENDPOINT.path,
      trId: KIS_OFFICIAL_INQUIRE_PRICE_ENDPOINT.trId,
      requiredParams: [...KIS_OFFICIAL_INQUIRE_PRICE_ENDPOINT.requiredParams],
      requiredFields: [...KIS_OFFICIAL_QUOTE_REQUIRED_FIELDS],
      ...quoteFields,
      providerStatus: status,
      confidence,
      providerIssue: !['OK_WITH_DATA', 'OK_EMPTY'].includes(status),
      marketSignal: false,
      executionImpact: 'DIAGNOSTIC_ONLY',
      asOf: stringOrNull(embedded.asOf) ?? stringOrNull(quote.asOf) ?? stringOrNull(quote.fetchedAt),
      provider: 'KIS_OFFICIAL',
      normalizedQuote: embedded as unknown as NormalizedKisOfficialQuote,
      rawFieldKeys: [],
      driftDiagnostics: drift ? [drift] : [],
    };
  }

  const source = inferQuoteCoverageSource(quote);
  const quoteFields = coverageFieldsFromQuote(quote);
  const dataQuality = String(quote.dataQuality ?? '').toUpperCase();
  const providerLabel = (inferQuoteProviderLabel(quote) ?? '').toUpperCase();
  const status: KisProviderStatus = quoteFields.presentFields.length === 0
    ? 'OK_EMPTY'
    : quoteFields.allRequiredFieldsPresent
      ? 'OK_WITH_DATA'
      : 'FIELD_MISSING';
  const confidence = providerLabel.includes('AI')
    ? 'AI_ESTIMATED'
    : dataQuality.includes('STALE') || quote.yahooDerivedIndicatorsReliable === false
      ? 'STALE'
      : quoteFields.presentFields.length === 0 || (
        quoteFields.missingFields.includes('currentPrice')
        && quoteFields.missingFields.includes('volume')
      )
        ? 'MISSING'
        : !quoteFields.allRequiredFieldsPresent || source === 'UNKNOWN'
          ? 'DEGRADED'
          : confidenceForStatus(status, source);
  const normalizedQuote: NormalizedKisOfficialQuote = {
    symbol: stringOrNull(quote.symbol) ?? stringOrNull(quote.code) ?? stringOrNull(quote.stockCode),
    currentPrice: cleanNumber(firstQuoteValue(quote, QUOTE_FIELD_ALIASES.currentPrice)),
    price: cleanNumber(firstQuoteValue(quote, QUOTE_FIELD_ALIASES.currentPrice)),
    open: cleanNumber(firstQuoteValue(quote, ['open', 'dayOpen', 'regularMarketOpen'])),
    high: cleanNumber(firstQuoteValue(quote, QUOTE_FIELD_ALIASES.high)),
    low: cleanNumber(firstQuoteValue(quote, QUOTE_FIELD_ALIASES.low)),
    previousClose: cleanNumber(firstQuoteValue(quote, ['previousClose', 'prevClose', 'regularMarketPreviousClose'])),
    change: cleanNumber(firstQuoteValue(quote, ['change', 'priceChange', 'prdyVrss', 'prdy_vrss'])),
    changePercent: cleanNumber(firstQuoteValue(quote, QUOTE_FIELD_ALIASES.changePercent)),
    volume: cleanNumber(firstQuoteValue(quote, QUOTE_FIELD_ALIASES.volume)),
    tradingValue: cleanNumber(firstQuoteValue(quote, QUOTE_FIELD_ALIASES.tradingValue)),
    asOf: stringOrNull(quote.asOf) ?? stringOrNull(quote.fetchedAt),
    provider: 'KIS_OFFICIAL',
    providerStatus: status,
    dataConfidence: confidence,
    marketDivCode: stringOrNull(quote.marketDivCode),
  };
  const drift = detectKisOfficialQuoteDrift({
    path: stringOrNull(quote.kisOfficialEndpoint) ?? stringOrNull(quote.kisEndpoint),
    trId: stringOrNull(quote.kisOfficialTrId) ?? stringOrNull(quote.kisTrId) ?? stringOrNull(quote.trId),
  });

  return {
    source,
    endpoint: KIS_OFFICIAL_INQUIRE_PRICE_ENDPOINT.path,
    trId: KIS_OFFICIAL_INQUIRE_PRICE_ENDPOINT.trId,
    requiredParams: [...KIS_OFFICIAL_INQUIRE_PRICE_ENDPOINT.requiredParams],
    requiredFields: [...KIS_OFFICIAL_QUOTE_REQUIRED_FIELDS],
    ...quoteFields,
    providerStatus: status,
    confidence,
    providerIssue: confidence !== 'VERIFIED' && status !== 'OK_EMPTY',
    marketSignal: false,
    executionImpact: 'DIAGNOSTIC_ONLY',
    asOf: normalizedQuote.asOf,
    provider: source === 'KIS_OFFICIAL' ? 'KIS_OFFICIAL' : null,
    normalizedQuote,
    rawFieldKeys: [],
    driftDiagnostics: drift ? [drift] : [],
  };
}
