// @responsibility Benchmark return normalization for Gate2 relative-strength diagnostics.

export type BenchmarkMarket = 'KOSPI' | 'KOSDAQ' | 'KONEX' | 'UNKNOWN';

export type BenchmarkKey = 'KOSPI' | 'KOSDAQ' | 'KOSPI200' | 'KRX300' | 'UNKNOWN';

export type BenchmarkPeriod = '5D' | '20D' | '60D' | '120D';

export type BenchmarkReturnSource =
  | 'KIS_INDEX'
  | 'YAHOO'
  | 'KRX_CACHE'
  | 'QMP_MACRO'
  | 'CACHE'
  | 'UNKNOWN';

export type BenchmarkProviderStatus =
  | 'OK_WITH_DATA'
  | 'OK_EMPTY'
  | 'HTTP_ERROR'
  | 'PROVIDER_ERROR'
  | 'RATE_LIMITED'
  | 'FIELD_MISSING'
  | 'PARSE_ERROR'
  | 'STALE_CACHE'
  | 'UNKNOWN_ERROR';

export type BenchmarkConfidence =
  | 'VERIFIED'
  | 'DEGRADED'
  | 'STALE'
  | 'MISSING'
  | 'EMPTY_VALID'
  | 'AI_ESTIMATED';

export interface BenchmarkRawFieldCoverage {
  requiredFields: string[];
  presentFields: string[];
  missingFields: string[];
  allRequiredFieldsPresent: boolean;
}

export interface QmpBenchmarkReturn {
  symbol: string;
  market: BenchmarkMarket;
  benchmarkKey: BenchmarkKey;
  benchmarkName: string | null;

  period: BenchmarkPeriod;
  benchmarkReturn: number | null;
  stockReturn: number | null;
  relativeReturn: number | null;
  relativeReturnPctPoint: number | null;

  benchmarkStartDate: string | null;
  benchmarkEndDate: string | null;
  stockStartDate: string | null;
  stockEndDate: string | null;

  source: BenchmarkReturnSource;
  providerStatus: BenchmarkProviderStatus;
  dataConfidence: BenchmarkConfidence;
  providerIssue: boolean;
  marketSignal: false;
  executionImpact: 'NONE' | 'DIAGNOSTIC_ONLY';
  notes: string[];

  rawFieldCoverage?: BenchmarkRawFieldCoverage;
}

export interface SelectBenchmarkInput {
  symbol: string;
  market?: BenchmarkMarket | string | null;
  stockMaster?: unknown;
  quote?: unknown;
}

export interface BenchmarkSelection {
  benchmarkKey: BenchmarkKey;
  benchmarkName: string | null;
  market: BenchmarkMarket;
  reason: string;
}

export interface NormalizeBenchmarkReturnForGate2Input {
  symbol: string;
  market?: BenchmarkMarket | string | null;
  quote?: unknown;
  stockMaster?: unknown;
  benchmarkKey?: BenchmarkKey | string | null;
  benchmarkRaw?: unknown;
  kospi20dReturn?: number | null;
  kosdaq20dReturn?: number | null;
  stockReturn20d?: number | null;
  period?: '20D';
  evaluationStage?: string | null;
}

const BENCHMARK_NAMES: Record<BenchmarkKey, string | null> = {
  KOSPI: 'KOSPI',
  KOSDAQ: 'KOSDAQ',
  KOSPI200: 'KOSPI 200',
  KRX300: 'KRX 300',
  UNKNOWN: null,
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === 'object' && !Array.isArray(value);
}

function numberOrNull(value: unknown): number | null {
  if (typeof value === 'number') return Number.isFinite(value) ? value : null;
  if (typeof value !== 'string') return null;
  const cleaned = value.replace(/,/g, '').replace(/%/g, '').replace(/\+/g, '').trim();
  if (!cleaned || cleaned === '-' || cleaned.toUpperCase() === 'N/A') return null;
  const parsed = Number(cleaned);
  return Number.isFinite(parsed) ? parsed : null;
}

function stringOrNull(value: unknown): string | null {
  return typeof value === 'string' && value.trim() ? value.trim() : null;
}

function firstRecordValue(record: Record<string, unknown>, keys: readonly string[]): unknown {
  for (const key of keys) {
    if (Object.prototype.hasOwnProperty.call(record, key)) return record[key];
  }
  return undefined;
}

function normalizeMarket(value: unknown): BenchmarkMarket {
  const raw = String(value ?? '').trim().toUpperCase();
  if (!raw) return 'UNKNOWN';
  if (raw === 'KOSPI' || raw === 'KS' || raw === 'J' || raw.includes('KOSPI')) return 'KOSPI';
  if (raw === 'KOSDAQ' || raw === 'KQ' || raw === 'Q' || raw.includes('KOSDAQ')) return 'KOSDAQ';
  if (raw === 'KONEX' || raw.includes('KONEX')) return 'KONEX';
  return 'UNKNOWN';
}

function marketFromInput(input: SelectBenchmarkInput): BenchmarkMarket {
  const quote = isRecord(input.quote) ? input.quote : {};
  const stockMaster = isRecord(input.stockMaster) ? input.stockMaster : {};
  return normalizeMarket(
    input.market
      ?? stockMaster.market
      ?? stockMaster.marketName
      ?? quote.market
      ?? quote.marketName
      ?? quote.marketDivCode,
  );
}

function normalizeBenchmarkKey(value: unknown): BenchmarkKey {
  const raw = String(value ?? '').trim().toUpperCase().replace(/[-_\s]/g, '');
  if (raw === 'KOSPI') return 'KOSPI';
  if (raw === 'KOSDAQ') return 'KOSDAQ';
  if (raw === 'KOSPI200') return 'KOSPI200';
  if (raw === 'KRX300') return 'KRX300';
  return 'UNKNOWN';
}

export function selectBenchmarkForSymbol(input: SelectBenchmarkInput): BenchmarkSelection {
  const market = marketFromInput(input);
  if (market === 'KOSPI') {
    return {
      market,
      benchmarkKey: 'KOSPI',
      benchmarkName: BENCHMARK_NAMES.KOSPI,
      reason: 'MARKET_KOSPI_DEFAULT_BENCHMARK',
    };
  }
  if (market === 'KOSDAQ') {
    return {
      market,
      benchmarkKey: 'KOSDAQ',
      benchmarkName: BENCHMARK_NAMES.KOSDAQ,
      reason: 'MARKET_KOSDAQ_DEFAULT_BENCHMARK',
    };
  }
  if (market === 'KONEX') {
    return {
      market,
      benchmarkKey: 'UNKNOWN',
      benchmarkName: null,
      reason: 'KONEX_BENCHMARK_NOT_CONFIGURED',
    };
  }
  return {
    market: 'UNKNOWN',
    benchmarkKey: 'UNKNOWN',
    benchmarkName: null,
    reason: 'BENCHMARK_MARKET_UNKNOWN',
  };
}

function normalizeSource(value: unknown): BenchmarkReturnSource {
  const raw = String(value ?? '').toUpperCase();
  if (raw.includes('KIS')) return 'KIS_INDEX';
  if (raw.includes('YAHOO')) return 'YAHOO';
  if (raw.includes('KRX')) return 'KRX_CACHE';
  if (raw.includes('QMP') || raw.includes('MACRO')) return 'QMP_MACRO';
  if (raw.includes('CACHE')) return 'CACHE';
  return 'UNKNOWN';
}

function normalizeProviderStatus(value: unknown): BenchmarkProviderStatus | null {
  if (value == null || value === '') return null;
  const raw = String(value).toUpperCase();
  const allowed: BenchmarkProviderStatus[] = [
    'OK_WITH_DATA',
    'OK_EMPTY',
    'HTTP_ERROR',
    'PROVIDER_ERROR',
    'RATE_LIMITED',
    'FIELD_MISSING',
    'PARSE_ERROR',
    'STALE_CACHE',
    'UNKNOWN_ERROR',
  ];
  if ((allowed as string[]).includes(raw)) return raw as BenchmarkProviderStatus;
  if (raw.includes('EMPTY')) return 'OK_EMPTY';
  if (raw.includes('STALE')) return 'STALE_CACHE';
  if (raw.includes('RATE') || raw.includes('LIMIT')) return 'RATE_LIMITED';
  if (raw.includes('FIELD')) return 'FIELD_MISSING';
  if (raw.includes('PARSE')) return 'PARSE_ERROR';
  if (raw.includes('HTTP')) return 'HTTP_ERROR';
  if (raw.includes('ERROR')) return 'PROVIDER_ERROR';
  return null;
}

export function confidenceForBenchmarkStatus(status: BenchmarkProviderStatus): BenchmarkConfidence {
  if (status === 'OK_WITH_DATA') return 'VERIFIED';
  if (status === 'OK_EMPTY') return 'EMPTY_VALID';
  if (status === 'STALE_CACHE') return 'STALE';
  if (status === 'FIELD_MISSING') return 'MISSING';
  return 'DEGRADED';
}

function providerIssueForStatus(status: BenchmarkProviderStatus): boolean {
  return status !== 'OK_WITH_DATA' && status !== 'OK_EMPTY';
}

function benchmarkReturnFromRaw(raw: unknown, benchmarkKey: BenchmarkKey): {
  value: number | null;
  parseError: boolean;
  source: BenchmarkReturnSource;
  providerStatus: BenchmarkProviderStatus | null;
  dates: Pick<QmpBenchmarkReturn, 'benchmarkStartDate' | 'benchmarkEndDate' | 'stockStartDate' | 'stockEndDate'>;
} {
  const record = isRecord(raw) ? raw : {};
  const keySpecific = benchmarkKey === 'KOSDAQ'
    ? firstRecordValue(record, ['kosdaq20dReturn', 'kosdaqReturn20d', 'benchmarkReturn20d'])
    : firstRecordValue(record, ['kospi20dReturn', 'kospiReturn20d', 'benchmarkReturn20d']);
  const rawValue = keySpecific ?? firstRecordValue(record, ['benchmarkReturn', 'return20d', 'return', 'value']);
  const value = numberOrNull(rawValue);
  return {
    value,
    parseError: rawValue != null && rawValue !== '' && value == null,
    source: normalizeSource(record.source ?? record.provider ?? record.dataSource),
    providerStatus: normalizeProviderStatus(record.providerStatus ?? record.status ?? record.dataConfidence),
    dates: {
      benchmarkStartDate: stringOrNull(record.benchmarkStartDate ?? record.startDate),
      benchmarkEndDate: stringOrNull(record.benchmarkEndDate ?? record.endDate),
      stockStartDate: stringOrNull(record.stockStartDate),
      stockEndDate: stringOrNull(record.stockEndDate),
    },
  };
}

function finiteOrNull(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : numberOrNull(value);
}

export function normalizeBenchmarkReturnForGate2(input: NormalizeBenchmarkReturnForGate2Input): QmpBenchmarkReturn {
  const selection = selectBenchmarkForSymbol({
    symbol: input.symbol,
    market: input.market,
    quote: input.quote,
    stockMaster: input.stockMaster,
  });
  const explicitBenchmarkKey = normalizeBenchmarkKey(input.benchmarkKey);
  const benchmarkKey = explicitBenchmarkKey === 'UNKNOWN' ? selection.benchmarkKey : explicitBenchmarkKey;
  const raw = benchmarkReturnFromRaw(input.benchmarkRaw, benchmarkKey);
  const quote = isRecord(input.quote) ? input.quote : {};
  const stockReturn = finiteOrNull(input.stockReturn20d ?? quote.return20d);
  const notes = [selection.reason];

  let benchmarkReturn: number | null = raw.value;
  let source = raw.source;
  if (benchmarkKey === 'KOSDAQ') {
    if (benchmarkReturn == null) benchmarkReturn = finiteOrNull(input.kosdaq20dReturn);
    if (source === 'UNKNOWN' && benchmarkReturn != null) source = 'QMP_MACRO';
    if (benchmarkReturn == null && finiteOrNull(input.kospi20dReturn) != null) {
      benchmarkReturn = finiteOrNull(input.kospi20dReturn);
      source = source === 'UNKNOWN' ? 'QMP_MACRO' : source;
      notes.push('KOSDAQ_BENCHMARK_MISSING_KOSPI_FALLBACK_DIAGNOSTIC_ONLY');
      notes.push('SYMBOL_MARKET_KOSDAQ_BUT_CURRENT_FORMULA_USES_KOSPI_BENCHMARK_FALLBACK');
    } else {
      notes.push('CURRENT_GATE2_FORMULA_STILL_USES_CTX_KOSPI20D_RETURN');
    }
  } else if (benchmarkKey === 'KOSPI') {
    if (benchmarkReturn == null) benchmarkReturn = finiteOrNull(input.kospi20dReturn);
    if (source === 'UNKNOWN' && benchmarkReturn != null) source = 'QMP_MACRO';
  } else if (benchmarkReturn == null) {
    benchmarkReturn = finiteOrNull(input.kospi20dReturn);
    if (benchmarkReturn != null) {
      source = source === 'UNKNOWN' ? 'QMP_MACRO' : source;
      notes.push('MARKET_UNKNOWN_USING_CTX_KOSPI20D_RETURN_DIAGNOSTIC_FALLBACK');
    }
  }

  const relativeReturn = stockReturn != null && benchmarkReturn != null
    ? stockReturn - benchmarkReturn
    : null;
  const missingFields = [
    ...(stockReturn == null ? ['stockReturn20d'] : []),
    ...(benchmarkReturn == null ? ['benchmarkReturn20d'] : []),
  ];
  const rawFieldCoverage: BenchmarkRawFieldCoverage = {
    requiredFields: ['stockReturn20d', 'benchmarkReturn20d'],
    presentFields: ['stockReturn20d', 'benchmarkReturn20d'].filter(field => !missingFields.includes(field)),
    missingFields,
    allRequiredFieldsPresent: missingFields.length === 0,
  };

  const explicitStatus = raw.providerStatus;
  const status = explicitStatus
    ?? (raw.parseError ? 'PARSE_ERROR' : missingFields.length === 0 ? 'OK_WITH_DATA' : 'FIELD_MISSING');
  const dataConfidence = confidenceForBenchmarkStatus(status);

  return {
    symbol: input.symbol,
    market: selection.market,
    benchmarkKey,
    benchmarkName: BENCHMARK_NAMES[benchmarkKey],
    period: input.period ?? '20D',
    benchmarkReturn,
    stockReturn,
    relativeReturn,
    relativeReturnPctPoint: relativeReturn,
    benchmarkStartDate: raw.dates.benchmarkStartDate,
    benchmarkEndDate: raw.dates.benchmarkEndDate,
    stockStartDate: raw.dates.stockStartDate,
    stockEndDate: raw.dates.stockEndDate,
    source,
    providerStatus: status,
    dataConfidence,
    providerIssue: providerIssueForStatus(status),
    marketSignal: false,
    executionImpact: 'DIAGNOSTIC_ONLY',
    notes: unique(notes),
    rawFieldCoverage,
  };
}

function unique(values: readonly string[]): string[] {
  return [...new Set(values.filter(Boolean))];
}
