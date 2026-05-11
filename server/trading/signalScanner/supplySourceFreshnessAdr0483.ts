// @responsibility ADR-0483 supply source freshness dual-clock diagnostics; SHADOW_ONLY refresh recommendations only.
import { isTradingDay } from '../../utils/marketDayClassifier.js';

export type SupplyFreshnessSourceAdr0483 = 'FSS' | 'SHORT_CREDIT' | 'NAVER' | 'KIS_PROGRAM' | 'SEMANTIC_NETBUY' | 'CACHE' | 'UNKNOWN';
export type SupplyFreshnessClockStateAdr0483 = 'FRESH' | 'STALE' | 'MISSING' | 'UNKNOWN';
export type SupplyFreshnessStatusAdr0483 = 'FRESH' | 'CACHE_ONLY_FRESH' | 'SOURCE_STALE' | 'SOURCE_MISSING' | 'NON_TRADING_DAY' | 'REFRESH_RECOMMENDED' | 'PROVIDER_ERROR' | 'UNKNOWN';
export type SupplyFreshnessRefreshStatusAdr0483 = 'NOT_NEEDED' | 'RECOMMENDED' | 'DRY_RUN_RECORDED' | 'SKIPPED_NON_TRADING_DAY' | 'PROVIDER_FAILED';

export interface SupplySourceFreshnessPointAdr0483 {
  source: SupplyFreshnessSourceAdr0483;
  cacheUpdatedAt?: string | Date | null;
  sourceDate?: string | Date | null;
  providerStatus?: 'OK' | 'EMPTY' | 'STALE' | 'ERROR' | 'DISABLED' | 'UNKNOWN';
  refreshDryRunRecorded?: boolean;
}

export interface SupplySourceFreshnessRowAdr0483 {
  source: SupplyFreshnessSourceAdr0483;
  cacheState: SupplyFreshnessClockStateAdr0483;
  sourceState: SupplyFreshnessClockStateAdr0483;
  cacheAgeMinutes: number | null;
  sourceAgeTradingDays: number | null;
  sourceDate: string | null;
  refreshStatus: SupplyFreshnessRefreshStatusAdr0483;
  providerIssue: boolean;
  expectedFreshnessDays: number;
  usableForSemantic: boolean;
  usableForLive: false;
  nextAction: string;
}

export interface SupplySourceFreshnessReportAdr0483 {
  status: SupplyFreshnessStatusAdr0483;
  rows: SupplySourceFreshnessRowAdr0483[];
  affectedSources: SupplyFreshnessSourceAdr0483[];
  oldestSourceAgeTradingDays: number | null;
  refreshStatus: SupplyFreshnessRefreshStatusAdr0483;
  diagnostics: string[];
  executionImpact: 'NONE';
  liveExecutionAllowed: false;
  policyPromotionMode: 'SHADOW_ONLY';
  operatorApprovalRequired: true;
}

export interface BuildSupplySourceFreshnessInputAdr0483 {
  now?: Date;
  staleSourceTradingDays?: number;
  staleCacheMinutes?: number;
  sources?: SupplySourceFreshnessPointAdr0483[];
}

const ADR_0483_POLICY = {
  executionImpact: 'NONE' as const,
  liveExecutionAllowed: false as const,
  policyPromotionMode: 'SHADOW_ONLY' as const,
  operatorApprovalRequired: true as const,
};

function toDate(value: string | Date | null | undefined): Date | null {
  if (!value) return null;
  const date = value instanceof Date ? value : new Date(value);
  return Number.isFinite(date.getTime()) ? date : null;
}

function ymd(date: Date): string {
  return date.toISOString().slice(0, 10);
}

function shiftYmd(value: string, days: number): string {
  const [year, month, day] = value.split('-').map(Number);
  return new Date(Date.UTC(year, month - 1, day) + days * 86_400_000).toISOString().slice(0, 10);
}

export function tradingDayDistanceAdr0483(fromYmd: string, toYmd: string): number {
  if (fromYmd >= toYmd) return 0;
  let cursor = shiftYmd(fromYmd, 1);
  let count = 0;
  for (let guard = 0; guard < 370 && cursor <= toYmd; guard += 1) {
    if (isTradingDay(cursor)) count += 1;
    cursor = shiftYmd(cursor, 1);
  }
  return count;
}

function buildRow(point: SupplySourceFreshnessPointAdr0483, now: Date, staleSourceTradingDays: number, staleCacheMinutes: number): SupplySourceFreshnessRowAdr0483 {
  const cacheUpdatedAt = toDate(point.cacheUpdatedAt);
  const sourceDate = toDate(point.sourceDate);
  const cacheAgeMinutes = cacheUpdatedAt ? Math.max(0, Math.floor((now.getTime() - cacheUpdatedAt.getTime()) / 60_000)) : null;
  const sourceAgeTradingDays = sourceDate ? tradingDayDistanceAdr0483(ymd(sourceDate), ymd(now)) : null;
  const providerIssue = point.providerStatus === 'ERROR' || point.providerStatus === 'EMPTY' || point.providerStatus === 'DISABLED';
  const cacheState: SupplyFreshnessClockStateAdr0483 = cacheAgeMinutes === null ? 'MISSING' : cacheAgeMinutes > staleCacheMinutes ? 'STALE' : 'FRESH';
  const sourceState: SupplyFreshnessClockStateAdr0483 = sourceAgeTradingDays === null
    ? 'MISSING'
    : point.providerStatus === 'STALE' || sourceAgeTradingDays > staleSourceTradingDays
      ? 'STALE'
      : 'FRESH';
  const refreshStatus: SupplyFreshnessRefreshStatusAdr0483 = point.refreshDryRunRecorded
    ? 'DRY_RUN_RECORDED'
    : providerIssue
      ? 'PROVIDER_FAILED'
      : sourceState === 'STALE' || sourceState === 'MISSING'
        ? 'RECOMMENDED'
        : 'NOT_NEEDED';
  return {
    source: point.source,
    cacheState,
    sourceState,
    cacheAgeMinutes,
    sourceAgeTradingDays,
    sourceDate: sourceDate ? ymd(sourceDate) : null,
    refreshStatus,
    providerIssue,
    expectedFreshnessDays: staleSourceTradingDays,
    usableForSemantic: sourceAgeTradingDays !== null && sourceAgeTradingDays <= 7 && point.providerStatus !== 'ERROR',
    usableForLive: false,
    nextAction: point.source === 'FSS' && (sourceState === 'STALE' || sourceState === 'MISSING')
      ? 'REFRESH_FSS_PASSIVE_ACTIVE'
      : refreshStatus === 'RECOMMENDED'
        ? `REFRESH_${point.source}`
        : 'NOT_NEEDED',
  };
}

export function buildSupplySourceFreshnessReportAdr0483(input: BuildSupplySourceFreshnessInputAdr0483 = {}): SupplySourceFreshnessReportAdr0483 {
  const now = input.now ?? new Date();
  const today = ymd(now);
  const staleSourceTradingDays = input.staleSourceTradingDays ?? 2;
  const staleCacheMinutes = input.staleCacheMinutes ?? 60;
  const rows = (input.sources ?? []).map((point) => buildRow(point, now, staleSourceTradingDays, staleCacheMinutes));
  const affectedSources = rows
    .filter((row) => row.sourceState === 'STALE' || row.sourceState === 'MISSING' || row.providerIssue)
    .map((row) => row.source);
  const oldestSourceAgeTradingDays = rows.reduce<number | null>((max, row) => (
    row.sourceAgeTradingDays === null ? max : Math.max(max ?? row.sourceAgeTradingDays, row.sourceAgeTradingDays)
  ), null);
  const anyDryRun = rows.some((row) => row.refreshStatus === 'DRY_RUN_RECORDED');
  const anyProviderFailed = rows.some((row) => row.refreshStatus === 'PROVIDER_FAILED');
  const anyRefreshRecommended = rows.some((row) => row.refreshStatus === 'RECOMMENDED');
  const nonTradingDay = !isTradingDay(today);
  const refreshStatus: SupplyFreshnessRefreshStatusAdr0483 = anyDryRun
    ? 'DRY_RUN_RECORDED'
    : anyProviderFailed
      ? 'PROVIDER_FAILED'
      : anyRefreshRecommended && nonTradingDay
        ? 'SKIPPED_NON_TRADING_DAY'
        : anyRefreshRecommended
          ? 'RECOMMENDED'
          : 'NOT_NEEDED';
  const status: SupplyFreshnessStatusAdr0483 = rows.length === 0
    ? 'UNKNOWN'
    : anyProviderFailed
      ? 'PROVIDER_ERROR'
      : anyRefreshRecommended && nonTradingDay
        ? 'NON_TRADING_DAY'
        : anyRefreshRecommended
          ? 'REFRESH_RECOMMENDED'
          : rows.some((row) => row.sourceState === 'STALE')
            ? 'SOURCE_STALE'
            : rows.some((row) => row.sourceState === 'MISSING')
              ? 'SOURCE_MISSING'
              : rows.some((row) => row.cacheState === 'FRESH' && row.sourceState !== 'FRESH')
                ? 'CACHE_ONLY_FRESH'
                : 'FRESH';
  return {
    status,
    rows,
    affectedSources,
    oldestSourceAgeTradingDays,
    refreshStatus,
    diagnostics: [
      'ADR-0483 separates cache freshness from source-data freshness.',
      'Stale or missing source data is data-health evidence, not bearish supply evidence.',
      `refreshStatus=${refreshStatus}`,
    ],
    ...ADR_0483_POLICY,
  };
}

export function safeBuildSupplySourceFreshnessReportAdr0483(input: BuildSupplySourceFreshnessInputAdr0483 = {}): SupplySourceFreshnessReportAdr0483 {
  try {
    return buildSupplySourceFreshnessReportAdr0483(input);
  } catch (error) {
    return {
      status: 'PROVIDER_ERROR',
      rows: [],
      affectedSources: ['UNKNOWN'],
      oldestSourceAgeTradingDays: null,
      refreshStatus: 'PROVIDER_FAILED',
      diagnostics: ['ADR-0483 freshness diagnostic failed in isolation.', error instanceof Error ? error.message : String(error)],
      ...ADR_0483_POLICY,
    };
  }
}

export function formatSupplySourceFreshnessCompactAdr0483(report?: SupplySourceFreshnessReportAdr0483 | null): string | null {
  if (!report) return null;
  const affected = report.affectedSources.length > 0 ? report.affectedSources.join('/') : 'NONE';
  return `ADR-0483 SupplyFreshness: ${report.status} | oldest=${report.oldestSourceAgeTradingDays ?? 'NA'}d | affected=${affected} | refresh=${report.refreshStatus} | impact=${report.executionImpact}`;
}

export function formatSupplySourceFreshnessDetailAdr0483(report?: SupplySourceFreshnessReportAdr0483 | null): string | null {
  if (!report) return null;
  return [
    '🕒 ADR-0483 Supply Source Freshness',
    `status=${report.status} refresh=${report.refreshStatus} oldest=${report.oldestSourceAgeTradingDays ?? 'NA'}d`,
    ...report.rows.map((row) => `- ${row.source}: cache=${row.cacheState}(${row.cacheAgeMinutes ?? 'NA'}m) source=${row.sourceState}(${row.sourceAgeTradingDays ?? 'NA'}d) lastUpdated=${row.sourceDate ?? 'none'} expectedFreshnessDays=${row.expectedFreshnessDays} usableForSemantic=${row.usableForSemantic} usableForLive=${row.usableForLive} nextAction=${row.nextAction} refresh=${row.refreshStatus}`),
    `guardrails: executionImpact=${report.executionImpact}, liveExecutionAllowed=${report.liveExecutionAllowed}, policyPromotionMode=${report.policyPromotionMode}, operatorApprovalRequired=${report.operatorApprovalRequired}`,
  ].join('\n');
}

export interface SupplySourceFreshnessDetailRegistryEntryAdr0483 {
  adr: '0483';
  sectionId: 'supply_source_freshness';
  commandHint: '/supply_health_detail';
  adrTraceHint: '/adr_trace 0483';
  executionImpact: 'NONE';
  liveExecutionAllowed: false;
  render: () => string;
}

export function getSupplySourceFreshnessDetailRegistryEntryAdr0483(report: SupplySourceFreshnessReportAdr0483): SupplySourceFreshnessDetailRegistryEntryAdr0483 {
  return {
    adr: '0483',
    sectionId: 'supply_source_freshness',
    commandHint: '/supply_health_detail',
    adrTraceHint: '/adr_trace 0483',
    executionImpact: 'NONE',
    liveExecutionAllowed: false,
    render: () => formatSupplySourceFreshnessDetailAdr0483(report) ?? '',
  };
}
