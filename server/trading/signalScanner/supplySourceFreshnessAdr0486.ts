// @responsibility ADR-0486 supply source freshness dual-clock diagnostics; SHADOW_ONLY refresh evidence.
import { isTradingDay } from '../../utils/marketDayClassifier.js';

export type SupplySourceId =
  | 'NAVER_INVESTOR_TREND'
  | 'SEMANTIC_NETBUY'
  | 'FSS_PASSIVE_ACTIVE'
  | 'SHORT_BALANCE'
  | 'CREDIT_BALANCE'
  | 'KIS_PROGRAM_TRADING'
  | 'MARKET_PROGRAM_TRADING'
  | 'CACHE'
  | 'UNKNOWN';

export type SupplyCacheState =
  | 'FRESH'
  | 'STALE'
  | 'EMPTY'
  | 'MISSING'
  | 'UNKNOWN';

export type SupplySourceState =
  | 'FRESH'
  | 'STALE'
  | 'EMPTY'
  | 'MISSING'
  | 'DATA_UNAVAILABLE'
  | 'PROVIDER_ERROR'
  | 'NON_TRADING_DAY'
  | 'UNKNOWN';

export type SupplyFreshnessSeverity =
  | 'OK'
  | 'INFO'
  | 'DEGRADED'
  | 'STALE'
  | 'DATA_UNAVAILABLE'
  | 'ERROR';

export type SupplyRefreshJobStatus =
  | 'NOT_REQUIRED'
  | 'RECOMMENDED'
  | 'SCHEDULED'
  | 'DRY_RUN'
  | 'SKIPPED_NON_TRADING_DAY'
  | 'FAILED'
  | 'UNKNOWN';

export interface SupplySourceFreshnessInput {
  sourceId: SupplySourceId;
  provider: string;
  cacheUpdatedAt: string | null;
  sourceDate: string | null;
  collectedAt: string | null;
  marketSession?: string | null;
  isTradingDay?: boolean | null;
  sourceStatus?: string | null;
  diagnostics?: string[];
  now?: string | Date | null;
  dryRunRefresh?: boolean;
}

export interface SupplySourceFreshnessItem {
  sourceId: SupplySourceId;
  provider: string;
  cacheState: SupplyCacheState;
  sourceState: SupplySourceState;
  cacheAgeMinutes: number | null;
  sourceAgeTradingDays: number | null;
  sourceDate: string | null;
  cacheUpdatedAt: string | null;
  collectedAt: string | null;
  severity: SupplyFreshnessSeverity;
  refreshStatus: SupplyRefreshJobStatus;
  refreshRecommended: boolean;
  isProviderIssue: boolean;
  isMarketSignal: false;
  executionImpact: 'NONE';
  liveExecutionAllowed: false;
  policyPromotionMode: 'SHADOW_ONLY';
  operatorApprovalRequired: true;
  diagnostics: string[];
}

export interface SupplySourceFreshnessReportAdr0486 {
  generatedAt: string;
  items: SupplySourceFreshnessItem[];
  overallSeverity: SupplyFreshnessSeverity;
  cacheStateSummary: {
    fresh: number;
    stale: number;
    empty: number;
    missing: number;
    unknown: number;
  };
  sourceStateSummary: {
    fresh: number;
    stale: number;
    empty: number;
    missing: number;
    dataUnavailable: number;
    providerError: number;
    nonTradingDay: number;
    unknown: number;
  };
  affectedSources: SupplySourceId[];
  oldestSourceAgeTradingDays: number | null;
  refreshRecommendedSources: SupplySourceId[];
  executionImpact: 'NONE';
  liveExecutionAllowed: false;
  policyPromotionMode: 'SHADOW_ONLY';
  operatorApprovalRequired: true;
  diagnostics: string[];
}

export interface BuildSupplySourceFreshnessReportInputAdr0486 {
  inputs?: readonly SupplySourceFreshnessInput[];
  generatedAt?: string | Date | null;
}

const ADR_0486_POLICY = {
  executionImpact: 'NONE',
  liveExecutionAllowed: false,
  policyPromotionMode: 'SHADOW_ONLY',
  operatorApprovalRequired: true,
} as const;

const CACHE_FRESH_MINUTES = 30;
const CACHE_STALE_MINUTES = 240;
const SOURCE_DEGRADED_DAYS = 2;
const SOURCE_STALE_DAYS = 4;

function asDate(value: string | Date | null | undefined): Date | null {
  if (!value) return null;
  const date = value instanceof Date ? value : new Date(value);
  return Number.isFinite(date.getTime()) ? date : null;
}

function ymd(date: Date): string {
  return date.toISOString().slice(0, 10);
}

function shiftYmd(day: string, days: number): string {
  const [year, month, date] = day.split('-').map(Number);
  return new Date(Date.UTC(year, month - 1, date) + days * 86_400_000).toISOString().slice(0, 10);
}

function tradingDayDistance(fromYmd: string, toYmd: string): { days: number; usedFallback: boolean } {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(fromYmd) || !/^\d{4}-\d{2}-\d{2}$/.test(toYmd)) {
    const from = new Date(fromYmd);
    const to = new Date(toYmd);
    const diff = Math.max(0, Math.floor((to.getTime() - from.getTime()) / 86_400_000));
    return { days: Number.isFinite(diff) ? diff : 0, usedFallback: true };
  }
  if (fromYmd >= toYmd) return { days: 0, usedFallback: false };
  let cursor = fromYmd;
  let days = 0;
  for (let i = 0; i < 370 && cursor < toYmd; i += 1) {
    cursor = shiftYmd(cursor, 1);
    if (cursor <= toYmd && isTradingDay(cursor)) days += 1;
  }
  return { days, usedFallback: false };
}

function normalizeStatus(status: string | null | undefined): string {
  return (status ?? '').trim().toUpperCase();
}

function cacheAgeMinutes(cacheUpdatedAt: string | null, now: Date): number | null {
  const cacheDate = asDate(cacheUpdatedAt);
  if (!cacheDate) return null;
  return Math.max(0, Math.round((now.getTime() - cacheDate.getTime()) / 60_000));
}

function cacheStateFromAge(input: SupplySourceFreshnessInput, age: number | null): SupplyCacheState {
  const status = normalizeStatus(input.sourceStatus);
  if (status === 'CACHE_EMPTY') return 'EMPTY';
  if (!input.cacheUpdatedAt) return 'MISSING';
  if (age === null) return 'UNKNOWN';
  if (age <= CACHE_FRESH_MINUTES) return 'FRESH';
  if (age >= CACHE_STALE_MINUTES) return 'STALE';
  return 'UNKNOWN';
}

function sourceStateFromInput(input: SupplySourceFreshnessInput, age: number | null): SupplySourceState {
  const status = normalizeStatus(input.sourceStatus);
  if (input.isTradingDay === false || status === 'NON_TRADING_DAY') return 'NON_TRADING_DAY';
  if (status === 'PROVIDER_ERROR' || status === 'ERROR' || status === 'HTTP_5XX' || status === 'TIMEOUT') return 'PROVIDER_ERROR';
  if (status === 'DATA_UNAVAILABLE') return 'DATA_UNAVAILABLE';
  if (status === 'EMPTY' || status === 'CACHE_EMPTY') return 'EMPTY';
  if (!input.sourceDate) return status === 'DATA_UNAVAILABLE' ? 'DATA_UNAVAILABLE' : 'MISSING';
  if (age === null) return 'UNKNOWN';
  if (age >= SOURCE_STALE_DAYS) return 'STALE';
  return 'FRESH';
}

function severityFromState(sourceState: SupplySourceState, sourceAgeTradingDays: number | null): SupplyFreshnessSeverity {
  if (sourceState === 'PROVIDER_ERROR') return 'ERROR';
  if (sourceState === 'DATA_UNAVAILABLE' || sourceState === 'MISSING') return 'DATA_UNAVAILABLE';
  if (sourceState === 'STALE') return 'STALE';
  if (sourceState === 'EMPTY' || sourceState === 'NON_TRADING_DAY' || sourceState === 'UNKNOWN') return 'INFO';
  if (sourceAgeTradingDays !== null && sourceAgeTradingDays >= SOURCE_DEGRADED_DAYS) return 'DEGRADED';
  return 'OK';
}

export function deriveSupplyRefreshJobStatusAdr0486(item: Pick<SupplySourceFreshnessItem, 'sourceState' | 'severity'> & { dryRunRefresh?: boolean }): SupplyRefreshJobStatus {
  if (item.sourceState === 'FRESH') return 'NOT_REQUIRED';
  if (item.sourceState === 'NON_TRADING_DAY') return 'SKIPPED_NON_TRADING_DAY';
  if (item.sourceState === 'PROVIDER_ERROR') return 'FAILED';
  if (item.dryRunRefresh === true && (item.sourceState === 'STALE' || item.sourceState === 'DATA_UNAVAILABLE' || item.sourceState === 'MISSING')) return 'DRY_RUN';
  if (item.sourceState === 'STALE' || item.sourceState === 'DATA_UNAVAILABLE' || item.sourceState === 'MISSING') return 'RECOMMENDED';
  return item.severity === 'DEGRADED' ? 'RECOMMENDED' : 'NOT_REQUIRED';
}

export function buildSupplySourceFreshnessItemAdr0486(input: SupplySourceFreshnessInput): SupplySourceFreshnessItem {
  const now = asDate(input.now) ?? new Date();
  const sourceDate = input.sourceDate;
  const sourceAge = sourceDate ? tradingDayDistance(sourceDate, ymd(now)) : { days: null as number | null, usedFallback: false };
  const cacheAge = cacheAgeMinutes(input.cacheUpdatedAt, now);
  const cacheState = cacheStateFromAge(input, cacheAge);
  const sourceAgeTradingDays = sourceAge.days;
  const sourceState = sourceStateFromInput(input, sourceAgeTradingDays);
  const severity = severityFromState(sourceState, sourceAgeTradingDays);
  const refreshStatus = deriveSupplyRefreshJobStatusAdr0486({ sourceState, severity, dryRunRefresh: input.dryRunRefresh });
  const refreshRecommended = refreshStatus === 'RECOMMENDED' || refreshStatus === 'DRY_RUN';
  return {
    sourceId: input.sourceId,
    provider: input.provider,
    cacheState,
    sourceState,
    cacheAgeMinutes: cacheAge,
    sourceAgeTradingDays,
    sourceDate,
    cacheUpdatedAt: input.cacheUpdatedAt,
    collectedAt: input.collectedAt,
    severity,
    refreshStatus,
    refreshRecommended,
    isProviderIssue: sourceState !== 'FRESH',
    isMarketSignal: false,
    ...ADR_0486_POLICY,
    diagnostics: [
      'ADR-0486 dual clock separates cache freshness from source freshness.',
      `cacheState=${cacheState}`,
      `sourceState=${sourceState}`,
      cacheState === 'FRESH' && sourceState === 'STALE' ? 'cache fresh, source stale' : null,
      sourceAge.usedFallback ? 'trading calendar unavailable; used calendar-day fallback' : null,
      ...(input.diagnostics ?? []),
    ].filter((item): item is string => typeof item === 'string' && item.length > 0),
  };
}

function emptyCacheSummary(): SupplySourceFreshnessReportAdr0486['cacheStateSummary'] {
  return { fresh: 0, stale: 0, empty: 0, missing: 0, unknown: 0 };
}

function emptySourceSummary(): SupplySourceFreshnessReportAdr0486['sourceStateSummary'] {
  return { fresh: 0, stale: 0, empty: 0, missing: 0, dataUnavailable: 0, providerError: 0, nonTradingDay: 0, unknown: 0 };
}

function incrementCache(summary: SupplySourceFreshnessReportAdr0486['cacheStateSummary'], state: SupplyCacheState): void {
  if (state === 'FRESH') summary.fresh += 1;
  else if (state === 'STALE') summary.stale += 1;
  else if (state === 'EMPTY') summary.empty += 1;
  else if (state === 'MISSING') summary.missing += 1;
  else summary.unknown += 1;
}

function incrementSource(summary: SupplySourceFreshnessReportAdr0486['sourceStateSummary'], state: SupplySourceState): void {
  if (state === 'FRESH') summary.fresh += 1;
  else if (state === 'STALE') summary.stale += 1;
  else if (state === 'EMPTY') summary.empty += 1;
  else if (state === 'MISSING') summary.missing += 1;
  else if (state === 'DATA_UNAVAILABLE') summary.dataUnavailable += 1;
  else if (state === 'PROVIDER_ERROR') summary.providerError += 1;
  else if (state === 'NON_TRADING_DAY') summary.nonTradingDay += 1;
  else summary.unknown += 1;
}

function overallSeverity(items: readonly SupplySourceFreshnessItem[]): SupplyFreshnessSeverity {
  if (items.some((item) => item.severity === 'ERROR')) return 'ERROR';
  if (items.some((item) => item.severity === 'STALE')) return 'STALE';
  if (items.some((item) => item.severity === 'DATA_UNAVAILABLE')) return 'DATA_UNAVAILABLE';
  if (items.some((item) => item.severity === 'DEGRADED')) return 'DEGRADED';
  if (items.some((item) => item.severity === 'INFO')) return 'INFO';
  return 'OK';
}

export function buildSupplySourceFreshnessReportAdr0486(input: BuildSupplySourceFreshnessReportInputAdr0486 = {}): SupplySourceFreshnessReportAdr0486 {
  const generatedAt = (asDate(input.generatedAt) ?? new Date()).toISOString();
  const items = (input.inputs ?? []).map((item) => buildSupplySourceFreshnessItemAdr0486({ ...item, now: generatedAt }));
  const cacheStateSummary = emptyCacheSummary();
  const sourceStateSummary = emptySourceSummary();
  for (const item of items) {
    incrementCache(cacheStateSummary, item.cacheState);
    incrementSource(sourceStateSummary, item.sourceState);
  }
  const affectedSources = Array.from(new Set(items
    .filter((item) => item.sourceState === 'STALE' || item.sourceState === 'DATA_UNAVAILABLE' || item.sourceState === 'PROVIDER_ERROR' || item.sourceState === 'MISSING')
    .map((item) => item.sourceId)));
  const refreshRecommendedSources = Array.from(new Set(items.filter((item) => item.refreshRecommended).map((item) => item.sourceId)));
  const oldestSourceAgeTradingDays = items
    .map((item) => item.sourceAgeTradingDays)
    .filter((age): age is number => typeof age === 'number' && Number.isFinite(age))
    .sort((a, b) => b - a)[0] ?? null;
  const severity = overallSeverity(items);
  return {
    generatedAt,
    items,
    overallSeverity: severity,
    cacheStateSummary,
    sourceStateSummary,
    affectedSources,
    oldestSourceAgeTradingDays,
    refreshRecommendedSources,
    ...ADR_0486_POLICY,
    diagnostics: [
      `ADR-0486 overallSeverity=${severity}`,
      `oldestSourceAgeTradingDays=${oldestSourceAgeTradingDays ?? 'unknown'}`,
      affectedSources.length > 0 ? `affected=${affectedSources.join('/')}` : 'affected=none',
      'stale/provider issue is not bearish',
    ],
  };
}

export function safeBuildSupplySourceFreshnessReportAdr0486(input: BuildSupplySourceFreshnessReportInputAdr0486 = {}): SupplySourceFreshnessReportAdr0486 {
  try {
    return buildSupplySourceFreshnessReportAdr0486(input);
  } catch (error) {
    return {
      generatedAt: (asDate(input.generatedAt) ?? new Date()).toISOString(),
      items: [],
      overallSeverity: 'ERROR',
      cacheStateSummary: emptyCacheSummary(),
      sourceStateSummary: emptySourceSummary(),
      affectedSources: [],
      oldestSourceAgeTradingDays: null,
      refreshRecommendedSources: [],
      ...ADR_0486_POLICY,
      diagnostics: ['ADR-0486 freshness failure isolated; scan and Shadow Learning continue.', error instanceof Error ? error.message : String(error)],
    };
  }
}

function compactSource(source: SupplySourceId): string {
  if (source === 'FSS_PASSIVE_ACTIVE') return 'FSS';
  if (source === 'SHORT_BALANCE') return 'short';
  if (source === 'CREDIT_BALANCE') return 'credit';
  if (source === 'NAVER_INVESTOR_TREND') return 'NAVER';
  if (source === 'SEMANTIC_NETBUY') return 'semantic';
  return source.toLowerCase();
}

export function formatSupplySourceFreshnessCompactAdr0486(report?: SupplySourceFreshnessReportAdr0486 | null): string | null {
  if (!report) return null;
  const affected = report.affectedSources.length > 0 ? report.affectedSources.map(compactSource).join('/') : 'none';
  const action = report.refreshRecommendedSources.length > 0 ? 'refresh stale source / split cache-source freshness' : 'observe freshness clocks';
  return `🕒 ADR-0486 SupplyFreshness: ${report.overallSeverity} | oldest=${report.oldestSourceAgeTradingDays ?? 'unknown'}d | affected=${affected} | impact=${report.executionImpact}\n   action: ${action}`;
}

export function formatSupplySourceFreshnessDetailAdr0486(report?: SupplySourceFreshnessReportAdr0486 | null): string | null {
  if (!report) return null;
  const lines = [
    '🕒 ADR-0486 Supply Source Freshness',
    `- overallSeverity: ${report.overallSeverity}`,
    `- oldestSourceAgeTradingDays: ${report.oldestSourceAgeTradingDays ?? 'unknown'}`,
    `- affectedSources: ${report.affectedSources.join('/') || 'none'}`,
    `- refreshRecommendedSources: ${report.refreshRecommendedSources.join('/') || 'none'}`,
    `- executionImpact: ${report.executionImpact}`,
    `- liveExecutionAllowed: ${report.liveExecutionAllowed}`,
    `- policyPromotionMode: ${report.policyPromotionMode}`,
  ];
  report.items.forEach((item) => {
    lines.push(`- ${item.sourceId}: cache=${item.cacheState}(${item.cacheAgeMinutes ?? 'unknown'}m), source=${item.sourceState}(${item.sourceAgeTradingDays ?? 'unknown'}d), refresh=${item.refreshStatus}, diagnostics=${item.diagnostics.join(' | ')}`);
  });
  return lines.join('\n');
}

export interface SupplySourceFreshnessDetailRegistryEntryAdr0486 {
  adr: '0486';
  sectionId: 'supply_source_freshness';
  commandHint: '/supply_health_detail';
  scanBlockersDetailHint: '/scan_blockers_detail supply_source_freshness';
  adrTraceHint: '/adr_trace 0486';
  executionImpact: 'NONE';
  liveExecutionAllowed: false;
  render: () => string;
}

export function getSupplySourceFreshnessDetailRegistryEntryAdr0486(report: SupplySourceFreshnessReportAdr0486): SupplySourceFreshnessDetailRegistryEntryAdr0486 {
  return {
    adr: '0486',
    sectionId: 'supply_source_freshness',
    commandHint: '/supply_health_detail',
    scanBlockersDetailHint: '/scan_blockers_detail supply_source_freshness',
    adrTraceHint: '/adr_trace 0486',
    executionImpact: 'NONE',
    liveExecutionAllowed: false,
    render: () => formatSupplySourceFreshnessDetailAdr0486(report) ?? '',
  };
}
