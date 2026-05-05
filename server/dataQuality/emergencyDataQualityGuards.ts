/**
 * @responsibility Emergency data-quality guards for KRX master, KRX codes, Yahoo stale quote, sanity circuit breaker, and Stage1 reject classification.
 *
 * Production invariant:
 * - missing/stale/fetch-failed market data is never coerced to 0.
 * - static seed master is diagnostic-only and must not drive scan/recommend/autotrade paths.
 */

export type DataQualityFatalCode =
  | 'KRX_MASTER_MISSING'
  | 'KRX_MASTER_TOO_SMALL'
  | 'KRX_MASTER_TTL_EXPIRED'
  | 'STATIC_SEED_NOT_ALLOWED_FOR_SCAN'
  | 'QUOTE_SANITY_DEGRADED';

export type DataQualityRejectCode =
  | 'INVALID_KRX_CODE'
  | 'STALE_QUOTE'
  | 'STALE_RETURN_BASE'
  | 'FETCH_FAIL'
  | 'FETCH_FAIL_KIS_404'
  | 'DATA_MISSING_QUOTE'
  | 'DATA_MISSING_PRICE'
  | 'DATA_MISSING_VOLUME'
  | 'DATA_MISSING_PER'
  | 'DATA_MISSING_RETURN'
  | 'MIN_PRICE'
  | 'LOW_VOLUME'
  | 'HIGH_PER'
  | 'PASS';

export interface DataQualityErrorMeta {
  [key: string]: unknown;
}

export class FatalDataQualityError extends Error {
  readonly code: DataQualityFatalCode;
  readonly meta: DataQualityErrorMeta;

  constructor(code: DataQualityFatalCode, meta: DataQualityErrorMeta = {}) {
    super(code);
    this.name = 'FatalDataQualityError';
    this.code = code;
    this.meta = meta;
  }
}

export class DataQualityError extends Error {
  readonly code: DataQualityRejectCode;
  readonly meta: DataQualityErrorMeta;

  constructor(code: DataQualityRejectCode, meta: DataQualityErrorMeta = {}) {
    super(code);
    this.name = 'DataQualityError';
    this.code = code;
    this.meta = meta;
  }
}

export interface KrxMasterHealthSnapshot {
  total?: number | null;
  ageHours?: number | null;
  source?: string | null;
  lastUpdatedAt?: string | null;
}

export interface KrxMasterGuardOptions {
  minTotal?: number;
  ttlHours?: number;
  disallowedSources?: readonly string[];
}

export const DEFAULT_KRX_MASTER_GUARD = {
  minTotal: 2000,
  ttlHours: 24,
  disallowedSources: ['STATIC_SEED', 'FALLBACK_SEED'],
} as const;

export function assertUsableKrxMaster(
  master: KrxMasterHealthSnapshot | null | undefined,
  options: KrxMasterGuardOptions = {},
): true {
  const minTotal = options.minTotal ?? DEFAULT_KRX_MASTER_GUARD.minTotal;
  const ttlHours = options.ttlHours ?? DEFAULT_KRX_MASTER_GUARD.ttlHours;
  const disallowedSources = options.disallowedSources ?? DEFAULT_KRX_MASTER_GUARD.disallowedSources;

  if (!master) {
    throw new FatalDataQualityError('KRX_MASTER_MISSING');
  }

  const total = Number(master.total);
  if (!Number.isFinite(total) || total < minTotal) {
    throw new FatalDataQualityError('KRX_MASTER_TOO_SMALL', {
      total: master.total,
      minRequired: minTotal,
      source: master.source,
    });
  }

  const ageHours = Number(master.ageHours);
  if (!Number.isFinite(ageHours) || ageHours > ttlHours) {
    throw new FatalDataQualityError('KRX_MASTER_TTL_EXPIRED', {
      ageHours: master.ageHours,
      ttlHours,
      lastUpdatedAt: master.lastUpdatedAt,
      source: master.source,
    });
  }

  const source = String(master.source ?? '').toUpperCase();
  if (disallowedSources.includes(source)) {
    throw new FatalDataQualityError('STATIC_SEED_NOT_ALLOWED_FOR_SCAN', {
      source: master.source,
      total: master.total,
    });
  }

  return true;
}

export function normalizeKrxCode(input: unknown): string | null {
  if (input === null || input === undefined) return null;

  const raw = String(input).trim().toUpperCase();
  if (raw.length === 0) return null;

  const code = raw
    .replace(/\.KS$/u, '')
    .replace(/\.KQ$/u, '')
    .replace(/\.KOSPI$/u, '')
    .replace(/\.KOSDAQ$/u, '');

  return /^\d{6}$/u.test(code) ? code : null;
}

export function assertValidKrxCode(input: unknown): string {
  const code = normalizeKrxCode(input);
  if (!code) {
    throw new DataQualityError('INVALID_KRX_CODE', {
      input,
      reason: 'KRX code must be exactly 6 numeric digits',
    });
  }
  return code;
}

export interface QuoteSanityReport {
  checked: number;
  violations: number;
}

export interface QuoteSanityGuardOptions {
  minChecked?: number;
  maxFailRate?: number;
}

export function assertQuoteSanityHealth(
  report: QuoteSanityReport,
  options: QuoteSanityGuardOptions = {},
): true {
  const minChecked = options.minChecked ?? 5;
  const maxFailRate = options.maxFailRate ?? 0.5;
  const checked = Number(report.checked);
  const violations = Number(report.violations);
  const failRate = checked > 0 ? violations / checked : 1;

  if (checked >= minChecked && failRate >= maxFailRate) {
    throw new FatalDataQualityError('QUOTE_SANITY_DEGRADED', {
      checked,
      failed: violations,
      failRate,
      threshold: maxFailRate,
    });
  }

  return true;
}

export interface NumericQuoteLike {
  usableForSignal?: boolean | null;
  currentPrice?: number | null;
  price?: number | null;
  volume?: number | null;
  avgVolume?: number | null;
  return20d?: number | null;
}

export interface FundamentalLike {
  per?: number | null;
}

export interface Stage1StrictInput {
  quote?: NumericQuoteLike | null;
  fundamental?: FundamentalLike | null;
  minPrice?: number;
  minVolume?: number;
  maxPer?: number;
}

export function classifyStage1RejectStrict(input: Stage1StrictInput): DataQualityRejectCode {
  const quote = input.quote;
  if (!quote || quote.usableForSignal === false) return 'DATA_MISSING_QUOTE';

  const price = quote.currentPrice ?? quote.price ?? null;
  if (!Number.isFinite(price)) return 'DATA_MISSING_PRICE';

  if (!Number.isFinite(quote.volume)) return 'DATA_MISSING_VOLUME';

  if (!Number.isFinite(input.fundamental?.per)) return 'DATA_MISSING_PER';

  if (!Number.isFinite(quote.return20d)) return 'DATA_MISSING_RETURN';

  const minPrice = input.minPrice ?? 3000;
  const minVolume = input.minVolume ?? 0;
  const maxPer = input.maxPer ?? 60;

  if ((price as number) < minPrice) return 'MIN_PRICE';
  if ((quote.volume as number) < minVolume) return 'LOW_VOLUME';
  if ((input.fundamental?.per as number) > maxPer) return 'HIGH_PER';

  return 'PASS';
}

export type GuardedQuoteStatus =
  | 'OK'
  | 'STALE_QUOTE'
  | 'STALE_RETURN_BASE'
  | 'FETCH_FAIL'
  | 'INVALID_CODE';

export interface GuardedQuoteResult {
  ok: boolean;
  status: GuardedQuoteStatus;
  usableForSignal: boolean;
  currentPrice: number | null;
  changePercent: number | null;
  return20d: number | null;
  asOf: string | null;
  baseAsOf?: string | null;
  source?: string;
  reason?: string;
}

export function makeStaleQuoteResult(params: {
  status?: Extract<GuardedQuoteStatus, 'STALE_QUOTE' | 'STALE_RETURN_BASE'>;
  currentPrice?: number | null;
  asOf?: string | null;
  baseAsOf?: string | null;
  source?: string;
  reason?: string;
} = {}): GuardedQuoteResult {
  return {
    ok: false,
    status: params.status ?? 'STALE_QUOTE',
    usableForSignal: false,
    currentPrice: params.currentPrice ?? null,
    changePercent: null,
    return20d: null,
    asOf: params.asOf ?? null,
    baseAsOf: params.baseAsOf ?? null,
    source: params.source,
    reason: params.reason ?? 'Quote base is stale. Do not coerce to 0.',
  };
}

export function formatNullablePct(value: number | null | undefined): string {
  return Number.isFinite(value) ? `${(value as number).toFixed(2)}%` : 'N/A';
}

// ─── ADR-0184 (PR-B12-A) ENV 우회 헬퍼 ──────────────────────────────────────
/**
 * ADR-0168b §"Future wiring" 의 *scanner start* (universeScanner 3 함수) wiring 활성화 여부.
 *
 * default OFF — productionMasterGuard SSOT 와의 일관성을 운영자가 검증한 후 ENV 활성화로 결정.
 * 활성 시 runStage1PreScreening / runStage2_3FinalScreening / runFullDiscoveryPipeline 진입부에서
 * `assertProductionMasterUsable('SCANNER')` 호출 → master 결손 시 SCAN_ABORTED early return.
 *
 * @returns true = wiring 활성, false = legacy 동작 (master guard 우회)
 */
export function isEmergencyMasterGuardScanEnabled(): boolean {
  return process.env.EMERGENCY_MASTER_GUARD_SCAN_ENABLED === 'true';
}

/**
 * ADR-0168b §"Future wiring" 의 *watchlist sanity* (saveWatchlist invalid code filter) wiring 활성화 여부.
 *
 * default ON — `0070X0` 같은 잘못된 code 가 watchlist 에 영원히 박제되던 결함을 자동 차단.
 * ENV `EMERGENCY_WATCHLIST_CODE_GUARD_DISABLED=true` 명시 시 legacy 동작 (필터 비활성).
 *
 * @returns true = wiring 활성 (default), false = legacy 동작 (필터 우회)
 */
export function isEmergencyWatchlistCodeGuardEnabled(): boolean {
  return process.env.EMERGENCY_WATCHLIST_CODE_GUARD_DISABLED !== 'true';
}
