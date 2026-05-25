// @responsibility KIS official/basket SectorEnergy provider (read-only, shadow-safe)

import { fetchKisDailyCandles, type KisChartCandle } from '../screener/kisChartDataFetcher.js';
import { SECTOR_INDEX_MASTER, getSectorByAlias, type SectorKey } from './sectorEnergyMaster.js';
import { fetchKisSectorIndexDaily, KIS_SECTOR_ISCD_MAP } from './kisClient/query.js';
import type { KisInvestorTradeByStockDaily } from './kisClient/index.js';
import type { KisSectorIndexDaily, KisSectorIndexDailyRow } from './kisClient/types.js';
import type { SectorEnergyDataQuality, SectorEnergyInput } from './sectorEnergyProvider.js';
import type { KisRepresentativeBasketAudit, SectorEnergyCoverageBreakdown } from './sectorEnergyQualityDiagnostic.js';
import { appendKisSectorIndexPromotionHistoryRecord, type KisSectorIndexPromotionHistoryRecord } from '../persistence/kisSectorIndexPromotionHistoryRepo.js';
import {
  sectorIndexMappingRegistry,
  setSectorIndexIdxcodeMasterRowsForTests,
  verifySectorIndexCodeWithIdxMaster,
  type SectorIndexCodeVerificationMatchedBy,
} from './kisSectorIndexCodeVerifier.js';

export {
  sectorIndexMappingRegistry,
  setSectorIndexIdxcodeMasterRowsForTests,
  verifySectorIndexCodeWithIdxMaster,
};

export type KisSectorEnergySourceTier =
  | 'KIS_OFFICIAL_INDEX'
  | 'KIS_OFFICIAL_DAILY'
  | 'KIS_STOCK_BASKET_DERIVED'
  | 'MISSING';

export type KisSectorEnergyLeadershipConfidence =
  | 'WEIGHTED'
  | 'READY_FOR_SHADOW'
  | 'PARTIAL'
  | 'BLOCKED';

export interface KisSectorEnergyCoverageBreakdown {
  totalSectors: number;
  verifiedIndexCodeCount: number;
  verifiedIndexCodeCoverage: number;
  kisOfficialCount: number;
  kisOfficialCoverage: number;
  kisBasketCount: number;
  kisBasketCoverage: number;
  internalProxyCount: number;
  internalProxyCoverage: number;
  stockDailyFallbackCount: number;
  stockDailyFallbackCoverage: number;
  yahooGlobalProxyCount: number;
  yahooGlobalProxyCoverage: number;
}

export interface KisSectorBasketRow {
  sectorKey: string;
  displayName: string;
  representativeCodes: string[];
  validPriceCount: number;
  return1d?: number;
  return5d?: number;
  return20d?: number;
  turnoverAcceleration?: number;
  breadthAbove20ma?: number;
  source: 'KIS_PRICE' | 'KIS_DAILY_CHART';
  confidence: 'PARTIAL' | 'VERIFIED';
}

export interface KisSectorEnergyIndexRow {
  sectorKey: SectorKey;
  sectorReturn5d: number;
  sectorReturn20d: number;
  turnoverAcceleration?: number;
  breadthAbove20ma?: number;
  foreignInstitutionFlowAlignment?: number;
  sectorRelativeStrengthVsKospi?: number;
  sectorRelativeStrengthVsKosdaq?: number;
  leadingStockCount?: number;
  topConstituentMomentum?: number;
  sourceTier?: Extract<KisSectorEnergySourceTier, 'KIS_OFFICIAL_INDEX' | 'KIS_OFFICIAL_DAILY'>;
}

export type SectorIndexVerificationStatus =
  | 'NO_ALIAS_FOUND'
  | 'SAFE_ALIAS_CANDIDATE_FOUND'
  | 'UNSAFE_ALIAS_REJECTED'
  | 'PENDING_IDXCODE_MST_VERIFY'
  | 'VERIFIED'
  | 'UNRESOLVED';

export type KisSectorIndexDryRunErrorClass =
  | 'EMPTY'
  | 'INVALID_CODE'
  | 'PROVIDER_500'
  | 'TIMEOUT'
  | 'DISABLED'
  | 'INSUFFICIENT_SERIES'
  | 'UNRESOLVED_EMPTY';

export interface KisSectorIndexDryRunRow {
  sectorKey: SectorKey;
  iscd: string;
  previousIscd?: string;
  label: string;
  success: boolean;
  seriesCount: number;
  latestDate?: string;
  return5d?: number;
  return20d?: number;
  turnoverAcceleration?: number;
  providerIssue?: boolean;
  marketSignal?: false;
  verificationStatus?: SectorIndexVerificationStatus | 'NOT_REQUIRED';
  verificationAction?: string;
  resolutionStatus?: 'PENDING_IDXCODE_MST_VERIFY' | 'REQUIRES_IDXCODE_MST_LOOKUP' | 'IDXCODE_MST_VERIFIED' | 'IDXCODE_MST_NOT_FOUND' | 'ENDPOINT_COMPATIBILITY_FAILED' | 'UNRESOLVED_EMPTY' | 'NONE';
  safeAliasCandidate?: { sectorKey: SectorKey; displayName: string; krxIndexCode: string };
  aliasCandidates?: string[];
  verifiedName?: string;
  matchedBy?: SectorIndexCodeVerificationMatchedBy;
  errorClass?: KisSectorIndexDryRunErrorClass;
  useForProduction?: false;
  useForDryRun?: boolean;
  error?: string;
}

export interface KisSectorIndexDryRunReport {
  enabled: boolean;
  attempted: number;
  succeeded: number;
  failed: number;
  rows: KisSectorIndexDryRunRow[];
  sourceTier: 'KIS_SECTOR_INDEX_DAILY_DRYRUN';
  dataQuality: 'PARTIAL';
  officialBenchmark: false;
  sectorBoostAllowed: false;
  strongBuyAllowed: false;
  executionImpact: 'NONE';
  marketSignal: false;
  providerIssue: boolean;
  candidateCoverage: number;
  promotionStage: 'OBSERVE' | 'SHADOW_SCORE' | 'ADVISORY' | 'WEIGHTED' | 'GATED' | 'CORE';
  promotionBlockedReason: 'OBSERVE_20D_REQUIRED' | 'SHADOW_SCORE_CANDIDATE_MANUAL_AUDIT_REQUIRED';
  daysCollected: number;
  promotionHistoryRecorded: boolean;
}

interface KisSectorIndexDryRunCacheEntry {
  expiresAt: number;
  report: KisSectorIndexDryRunReport;
}

const KIS_SECTOR_INDEX_DRYRUN_TTL_MS = 20 * 60 * 1000;
const KIS_SECTOR_INDEX_NEGATIVE_COOLDOWN_MS = 10 * 60 * 1000;
const KIS_SECTOR_INDEX_MIN_SERIES_COUNT = 21;
const KIS_SECTOR_INDEX_DRYRUN_LOG_TTL_MS = 20 * 60 * 1000;
let kisSectorIndexDryRunLastLogKey: string | null = null;
let kisSectorIndexDryRunLastLogExpiresAt = 0;
let kisSectorIndexDryRunSuppressedCount = 0;
let kisSectorIndexDryRunCache: KisSectorIndexDryRunCacheEntry | null = null;
const kisSectorIndexNegativeCooldownUntil = new Map<string, number>();


function dryRunDedupDateKey(nowMs: number): string {
  return new Date(nowMs).toISOString().slice(0, 10);
}

function dryRunFailedCodes(rows: readonly KisSectorIndexDryRunRow[]): string {
  return rows
    .filter((row) => !row.success)
    .map((row) => row.iscd)
    .sort()
    .join(',') || 'none';
}

function logKisSectorIndexDryRunCandidate(report: KisSectorIndexDryRunReport, nowMs: number): void {
  const failedCodes = dryRunFailedCodes(report.rows);
  const key = `SECTOR_INDEX_DRYRUN:${dryRunDedupDateKey(nowMs)}:${report.attempted}:${report.succeeded}:${failedCodes}`;
  if (kisSectorIndexDryRunLastLogKey === key && kisSectorIndexDryRunLastLogExpiresAt > nowMs) {
    kisSectorIndexDryRunSuppressedCount += 1;
    console.log(`[SECTOR_INDEX_DRYRUN_CANDIDATE_SUPPRESSED] key=${key} suppressedCount=${kisSectorIndexDryRunSuppressedCount}`);
    return;
  }
  kisSectorIndexDryRunLastLogKey = key;
  kisSectorIndexDryRunLastLogExpiresAt = nowMs + KIS_SECTOR_INDEX_DRYRUN_LOG_TTL_MS;
  kisSectorIndexDryRunSuppressedCount = 0;
  console.log(
    `[SECTOR_INDEX_DRYRUN_CANDIDATE] attempted=${report.attempted} succeeded=${report.succeeded} failed=${report.failed} candidateCoverage=${(report.candidateCoverage * 100).toFixed(1)} promotionStage=${report.promotionStage} executionImpact=${report.executionImpact}`,
  );
  console.log(
    `[SECTOR_INDEX_PROMOTION_BLOCKED] reason=${report.promotionBlockedReason} strongBuyAllowed=${report.strongBuyAllowed} sectorBoostAllowed=${report.sectorBoostAllowed}`,
  );
  const verifyRequired = report.rows.filter((row) => !row.success && (row.resolutionStatus === 'PENDING_IDXCODE_MST_VERIFY' || row.errorClass === 'UNRESOLVED_EMPTY'));
  if (verifyRequired.length > 0) {
    console.log(
      `[SECTOR_INDEX_CODE_VERIFY_REQUIRED] failedCodes=${verifyRequired.map((row) => row.iscd).join(',')} resolutionStatus=PENDING_IDXCODE_MST_VERIFY marketSignal=false executionImpact=${report.executionImpact}`,
    );
  }
}

function emptyKisSectorIndexDryRunReport(enabled: boolean): KisSectorIndexDryRunReport {
  return {
    enabled,
    attempted: 0,
    succeeded: 0,
    failed: 0,
    rows: [],
    sourceTier: 'KIS_SECTOR_INDEX_DAILY_DRYRUN',
    dataQuality: 'PARTIAL',
    officialBenchmark: false,
    sectorBoostAllowed: false,
    strongBuyAllowed: false,
    executionImpact: 'NONE',
    marketSignal: false,
    providerIssue: false,
    candidateCoverage: 0,
    promotionStage: 'OBSERVE',
    promotionBlockedReason: 'OBSERVE_20D_REQUIRED',
    daysCollected: 0,
    promotionHistoryRecorded: false,
  };
}

function roundMetric(value: number | undefined): number | undefined {
  if (!finite(value)) return undefined;
  return Math.round(value * 10000) / 10000;
}

function sortedKisSectorIndexSeries(series: readonly KisSectorIndexDailyRow[]): KisSectorIndexDailyRow[] {
  return [...series]
    .filter((row) => /^\d{8}$/.test(row.baseDate) && finite(row.close) && row.close > 0)
    .sort((a, b) => a.baseDate.localeCompare(b.baseDate));
}

function classifyKisSectorIndexDryRunError(error: unknown): KisSectorIndexDryRunErrorClass {
  const message = error instanceof Error ? error.message : String(error ?? '');
  const normalized = message.toLowerCase();
  if (normalized.includes('kis_empty_or_disabled')) return 'EMPTY';
  if (
    normalized.includes('timeout') ||
    normalized.includes('timed out') ||
    normalized.includes('etimedout')
  ) {
    return 'TIMEOUT';
  }
  if (
    normalized.includes('500') ||
    normalized.includes('provider_500') ||
    normalized.includes('internal server')
  ) {
    return 'PROVIDER_500';
  }
  if (
    normalized.includes('disabled') ||
    normalized.includes('not enabled')
  ) {
    return 'DISABLED';
  }
  if (
    normalized.includes('invalid') ||
    normalized.includes('bad iscd') ||
    normalized.includes('invalid_code')
  ) {
    return 'INVALID_CODE';
  }
  if (normalized.includes('insufficient')) return 'INSUFFICIENT_SERIES';
  return 'EMPTY';
}



export interface SectorIdxcodeMasterRow {
  iscd: string;
  koreanName: string;
  englishKey?: string;
  aliases?: string[];
}

export interface SectorIndexCodeMasterVerificationResult {
  verification: 'VERIFIED' | 'UNRESOLVED';
  resolutionStatus: 'IDXCODE_MST_VERIFIED' | 'IDXCODE_MST_NOT_FOUND';
  useForProduction: false;
  useForDryRun: boolean;
  marketSignal: false;
  executionImpact: 'NONE';
  matchedBy?: 'EXACT_ISCD' | 'KOREAN_NAME' | 'ENGLISH_SECTOR_KEY' | 'ALIAS' | 'ENDPOINT_COMPATIBILITY_DRY_RUN';
  matchedIscd?: string;
  matchedName?: string;
}

const STATIC_IDXCODE_MASTER_ROWS: ReadonlyArray<SectorIdxcodeMasterRow> = Object.freeze([
  { iscd: '2001', koreanName: '코스피200', englishKey: 'OTHER', aliases: ['기타', 'KOSPI200 proxy'] },
  { iscd: '2002', koreanName: '자동차', englishKey: 'AUTOMOTIVE', aliases: ['자동차'] },
  { iscd: '2003', koreanName: '유통/소비재', englishKey: 'CONSUMER_RETAIL', aliases: ['유통', '소비재'] },
  { iscd: '2004', koreanName: '반도체', englishKey: 'SEMICONDUCTOR', aliases: ['반도체'] },
  { iscd: '0029', koreanName: 'IT 서비스', englishKey: 'IT_INTERNET', aliases: ['인터넷', '플랫폼', 'IT', '서비스업', '통신업', 'IT 서비스'] },
  { iscd: '0021', koreanName: '금융', englishKey: 'FINANCE', aliases: ['금융', '은행', '증권', '보험'] },
  { iscd: '2007', koreanName: '철강', englishKey: 'STEEL', aliases: ['철강'] },
  { iscd: '2008', koreanName: '에너지/화학', englishKey: 'CHEMICAL', aliases: ['화학', '에너지'] },
  { iscd: '2009', koreanName: '바이오/헬스케어', englishKey: 'BIO_HEALTHCARE', aliases: ['바이오', '헬스케어'] },
  { iscd: '2010', koreanName: '조선', englishKey: 'SHIPBUILDING', aliases: ['조선'] },
  { iscd: '2011', koreanName: '건설/부동산', englishKey: 'CONSTRUCTION', aliases: ['건설', '부동산'] },
  { iscd: '2012', koreanName: '이차전지', englishKey: 'BATTERY', aliases: ['2차전지', '이차전지', '배터리'] },
]);

function normalizeLookupText(value: string): string {
  return value.toLowerCase().replace(/[\s/_-]+/g, '').trim();
}

export function verifySectorIndexCodeWithMaster(input: {
  sectorKey: SectorKey;
  sectorNameKo: string;
  candidateIscd: string;
  aliasCandidates: string[];
  masterRows?: readonly SectorIdxcodeMasterRow[];
  endpointCompatible?: boolean;
}): SectorIndexCodeMasterVerificationResult {
  const rows = input.masterRows ?? STATIC_IDXCODE_MASTER_ROWS;
  const candidate = input.candidateIscd.trim();
  const ko = normalizeLookupText(input.sectorNameKo);
  const key = normalizeLookupText(input.sectorKey);
  const aliases = input.aliasCandidates.map(normalizeLookupText).filter(Boolean);
  const match = (matchedBy: NonNullable<SectorIndexCodeMasterVerificationResult['matchedBy']>, row?: SectorIdxcodeMasterRow): SectorIndexCodeMasterVerificationResult => ({
    verification: 'VERIFIED',
    resolutionStatus: 'IDXCODE_MST_VERIFIED',
    useForProduction: false,
    useForDryRun: true,
    marketSignal: false,
    executionImpact: 'NONE',
    matchedBy,
    matchedIscd: row?.iscd ?? candidate,
    matchedName: row?.koreanName,
  });
  const exact = rows.find((row) => row.iscd === candidate && normalizeLookupText(row.englishKey ?? '') === key);
  if (exact) return match('EXACT_ISCD', exact);
  const byKo = rows.find((row) => row.iscd === candidate && normalizeLookupText(row.koreanName) === ko);
  if (byKo) return match('KOREAN_NAME', byKo);
  const byKey = rows.find((row) => row.iscd === candidate && normalizeLookupText(row.englishKey ?? '') === key);
  if (byKey) return match('ENGLISH_SECTOR_KEY', byKey);
  const byAlias = rows.find((row) => row.iscd === candidate && (row.aliases ?? []).some((alias) => aliases.includes(normalizeLookupText(alias))));
  if (byAlias) return match('ALIAS', byAlias);
  if (input.endpointCompatible === true) return match('ENDPOINT_COMPATIBILITY_DRY_RUN');
  return {
    verification: 'UNRESOLVED',
    resolutionStatus: 'IDXCODE_MST_NOT_FOUND',
    useForProduction: false,
    useForDryRun: false,
    marketSignal: false,
    executionImpact: 'NONE',
  };
}

function buildKisSectorIndexCodeVerification(input: {
  sectorKey: SectorKey;
  iscd: string;
  label: string;
  errorClass: KisSectorIndexDryRunErrorClass;
}): Pick<KisSectorIndexDryRunRow, 'providerIssue' | 'marketSignal' | 'verificationStatus' | 'verificationAction' | 'resolutionStatus' | 'safeAliasCandidate' | 'aliasCandidates' | 'errorClass' | 'useForProduction' | 'useForDryRun'> {
  if (input.errorClass !== 'EMPTY') {
    return {
      providerIssue: true,
      marketSignal: false,
      verificationStatus: 'NOT_REQUIRED',
      verificationAction: 'NONE',
      resolutionStatus: 'NONE',
      errorClass: input.errorClass,
    };
  }

  const tokens = Array.from(new Set([
    input.label,
    ...input.label.split('/'),
    ...(input.sectorKey === 'FINANCE' ? ['금융'] : []),
    ...(input.sectorKey === 'IT_INTERNET' ? ['인터넷', '플랫폼'] : []),
  ].map((value) => value.trim()).filter(Boolean)));
  const exactEntry = SECTOR_INDEX_MASTER.find((entry) => entry.sectorKey === input.sectorKey) ?? null;
  const safeAlias = tokens
    .map((token) => getSectorByAlias(token))
    .find((entry): entry is NonNullable<ReturnType<typeof getSectorByAlias>> =>
      !!entry && entry.sectorKey === input.sectorKey && entry.displayName === exactEntry?.displayName,
    );

  if (safeAlias && exactEntry) {
    return {
      providerIssue: false,
      marketSignal: false,
      verificationStatus: 'SAFE_ALIAS_CANDIDATE_FOUND',
      verificationAction: 'VERIFY_WITH_IDXCODE_MST_BEFORE_L4_WIRING',
      resolutionStatus: 'PENDING_IDXCODE_MST_VERIFY',
      safeAliasCandidate: {
        sectorKey: safeAlias.sectorKey,
        displayName: safeAlias.displayName,
        krxIndexCode: safeAlias.krxIndexCode,
      },
      aliasCandidates: tokens,
      errorClass: 'EMPTY',
      useForProduction: false,
      useForDryRun: false,
    };
  }

  return {
    providerIssue: false,
    marketSignal: false,
    verificationStatus: 'NO_ALIAS_FOUND',
    verificationAction: 'VERIFY_WITH_IDXCODE_MST',
    resolutionStatus: 'REQUIRES_IDXCODE_MST_LOOKUP',
    aliasCandidates: tokens,
    errorClass: 'UNRESOLVED_EMPTY',
    useForProduction: false,
    useForDryRun: false,
  };
}


function yyyymmddFromNowMs(nowMs: number): string {
  return new Date(nowMs).toISOString().slice(0, 10).replace(/-/g, '');
}

function promotionLatestDateTop(rows: readonly KisSectorIndexDryRunRow[]): string | null {
  return rows.map((row) => row.latestDate).filter((date): date is string => typeof date === 'string' && /^\d{8}$/.test(date)).sort().at(-1) ?? null;
}

function buildPromotionHistoryRecord(report: KisSectorIndexDryRunReport, nowMs: number): KisSectorIndexPromotionHistoryRecord {
  const rowsBySector: Record<string, number> = {};
  const return5dBySector: Record<string, number | null> = {};
  const return20dBySector: Record<string, number | null> = {};
  for (const row of report.rows) {
    rowsBySector[row.sectorKey] = row.seriesCount;
    return5dBySector[row.sectorKey] = finite(row.return5d) ? row.return5d : null;
    return20dBySector[row.sectorKey] = finite(row.return20d) ? row.return20d : null;
  }
  return {
    date: yyyymmddFromNowMs(nowMs),
    attempted: report.attempted,
    succeeded: report.succeeded,
    failed: report.failed,
    failedCodes: report.rows.filter((row) => !row.success).map((row) => row.iscd).sort(),
    latestDateTop: promotionLatestDateTop(report.rows),
    rowsBySector,
    return5dBySector,
    return20dBySector,
    officialBenchmark: report.officialBenchmark,
    promotionStage: report.promotionStage,
    candidateCoverage: report.candidateCoverage,
    verifiedCodes: Object.fromEntries(report.rows.filter((row) => row.success && row.verificationStatus === 'VERIFIED').map((row) => [row.sectorKey, row.iscd])),
    unresolvedCodes: Object.fromEntries(report.rows.filter((row) => !row.success).map((row) => [row.sectorKey, row.iscd])),
    sectorBoostAllowed: false,
    strongBuyAllowed: false,
    executionImpact: 'NONE',
    corePromotionAllowed: false,
    manualAuditFlagRequired: true,
    recordedAt: new Date(nowMs).toISOString(),
  };
}

function recordKisSectorIndexPromotionHistory(report: KisSectorIndexDryRunReport, nowMs: number): KisSectorIndexDryRunReport {
  const stored = appendKisSectorIndexPromotionHistoryRecord(buildPromotionHistoryRecord(report, nowMs));
  const daysCollected = Math.min(20, stored.length);
  const eligibleForShadow = stored.length >= 20 && report.failed === 0 && report.candidateCoverage >= 1 && report.officialBenchmark === false;
  const promotionStage = 'OBSERVE';
  const promotionBlockedReason = eligibleForShadow ? 'SHADOW_SCORE_CANDIDATE_MANUAL_AUDIT_REQUIRED' : 'OBSERVE_20D_REQUIRED';
  const updated: KisSectorIndexDryRunReport = {
    ...report,
    promotionStage,
    promotionBlockedReason,
    daysCollected,
    promotionHistoryRecorded: true,
    sectorBoostAllowed: false,
    strongBuyAllowed: false,
    executionImpact: 'NONE',
  };
  console.log(
    `[SECTOR_INDEX_PROMOTION_HISTORY_RECORDED] date=${yyyymmddFromNowMs(nowMs)} attempted=${updated.attempted} succeeded=${updated.succeeded} failed=${updated.failed} failedCodes=${dryRunFailedCodes(updated.rows)} candidateCoverage=${(updated.candidateCoverage * 100).toFixed(1)}% promotionStage=${updated.promotionStage} daysCollected=${daysCollected}/20 executionImpact=NONE`,
  );
  return updated;
}

async function tryRecoverKisSectorIndexDryRunRow(input: {
  entry: { sectorKey: SectorKey; iscd: string; label: string };
  verification: Pick<KisSectorIndexDryRunRow, 'aliasCandidates'>;
  nowMs: number;
}): Promise<KisSectorIndexDryRunRow | null> {
  if (input.entry.sectorKey !== 'FINANCE' && input.entry.sectorKey !== 'IT_INTERNET') return null;
  const result = await verifySectorIndexCodeWithIdxMaster({
    sectorKey: input.entry.sectorKey,
    sectorNameKo: input.entry.label,
    currentCandidateIscd: input.entry.iscd,
    aliasCandidates: input.verification.aliasCandidates ?? [],
  }, { nowMs: input.nowMs });
  const compatible = result.candidatesTried.find((candidate) => candidate.compatible && candidate.iscd === result.verifiedIscd);
  if (result.verification !== 'VERIFIED' || result.resolutionStatus !== 'IDXCODE_MST_VERIFIED' || !result.verifiedIscd || !compatible) {
    console.log(
      `[SECTOR_INDEX_CODE_VERIFY_FAILED] sectorKey=${input.entry.sectorKey} originalIscd=${input.entry.iscd} reason=NO_COMPATIBLE_IDXCODE_FOUND marketSignal=false executionImpact=NONE`,
    );
    return null;
  }
  const endpoint = await fetchKisSectorIndexDaily(result.verifiedIscd);
  const metrics = endpoint ? deriveKisSectorIndexDryRunMetrics(endpoint) : {
    seriesCount: compatible.endpointRows ?? 0,
    latestDate: compatible.latestDate,
    return5d: undefined,
    return20d: undefined,
    turnoverAcceleration: undefined,
  };
  sectorIndexMappingRegistry.update({
    sectorKey: input.entry.sectorKey,
    sectorNameKo: input.entry.label,
    previousIscd: input.entry.iscd,
    verifiedIscd: result.verifiedIscd,
    verifiedName: result.verifiedName,
    source: 'IDXCODE_MST',
    matchedBy: result.matchedBy,
    verification: 'VERIFIED',
    resolutionStatus: 'IDXCODE_MST_VERIFIED',
    useForDryRun: true,
    useForProduction: false,
    promotionStage: 'OBSERVE',
    sectorBoostAllowed: false,
    strongBuyAllowed: false,
    executionImpact: 'NONE',
    verifiedAt: new Date(input.nowMs).toISOString(),
  });
  console.log(
    `[SECTOR_INDEX_CODE_VERIFIED] sectorKey=${input.entry.sectorKey} previousIscd=${input.entry.iscd} verifiedIscd=${result.verifiedIscd} verifiedName=${result.verifiedName ?? 'N/A'} matchedBy=${result.matchedBy} rows=${metrics.seriesCount} latestDate=${metrics.latestDate ?? 'N/A'} verification=VERIFIED resolutionStatus=IDXCODE_MST_VERIFIED executionImpact=NONE`,
  );
  return {
    sectorKey: input.entry.sectorKey,
    iscd: result.verifiedIscd,
    previousIscd: input.entry.iscd,
    label: input.entry.label,
    success: true,
    providerIssue: false,
    marketSignal: false,
    verificationStatus: 'VERIFIED',
    resolutionStatus: 'IDXCODE_MST_VERIFIED',
    verifiedName: result.verifiedName,
    matchedBy: result.matchedBy,
    useForProduction: false,
    useForDryRun: true,
    ...metrics,
  };
}

function deriveKisSectorIndexDryRunMetrics(result: KisSectorIndexDaily): Pick<KisSectorIndexDryRunRow, 'seriesCount' | 'latestDate' | 'return5d' | 'return20d' | 'turnoverAcceleration'> {
  const rows = sortedKisSectorIndexSeries(result.series);
  const latest = rows.at(-1);
  const return5d = rows.length >= 6 ? pctChange(rows.at(-6)!.close, latest!.close) : undefined;
  const return20d = rows.length >= 21 ? pctChange(rows.at(-21)!.close, latest!.close) : undefined;
  const recentVolumes = rows.slice(-5).map((row) => row.volume).filter(finite);
  const previousVolumes = rows.slice(-25, -5).map((row) => row.volume).filter(finite);
  const previousAvg = avg(previousVolumes);
  const turnoverAcceleration = previousAvg > 0 ? ((avg(recentVolumes) - previousAvg) / previousAvg) * 100 : undefined;
  return {
    seriesCount: rows.length,
    latestDate: latest?.baseDate,
    return5d: roundMetric(return5d),
    return20d: roundMetric(return20d),
    turnoverAcceleration: roundMetric(turnoverAcceleration),
  };
}

/**
 * KIS 援?궡?낆쥌 湲곌컙蹂?吏??dry-run diagnostic.
 *
 * read-only invariant:
 * - ENV `KIS_SECTOR_INDEX_DAILY_ENABLED === 'true'` ?먯꽌留?KIS ?몄텧.
 * - `/sector_energy_diag` 媛숈? ?댁쁺??吏꾨떒?먯꽌留??몄텧?섎ŉ live fallback ???곌껐?섏? ?딅뒗??
 * - KIS ?묐떟? KRX official benchmark 濡??밴꺽?섏? ?딄퀬 dataQuality=PARTIAL / executionImpact=NONE 怨좎젙.
 */
export async function fetchKisSectorIndexRowsDryRun(nowMs = Date.now()): Promise<KisSectorIndexDryRunReport> {
  const enabled = process.env.KIS_SECTOR_INDEX_DAILY_ENABLED === 'true';
  if (!enabled) {
    kisSectorIndexDryRunCache = null;
    return emptyKisSectorIndexDryRunReport(false);
  }
  if (kisSectorIndexDryRunCache && kisSectorIndexDryRunCache.expiresAt > nowMs) {
    return kisSectorIndexDryRunCache.report;
  }

  const rows = await mapLimit([...KIS_SECTOR_ISCD_MAP], 3, async (entry): Promise<KisSectorIndexDryRunRow> => {
    const cooldownUntil = kisSectorIndexNegativeCooldownUntil.get(entry.iscd) ?? 0;
    if (cooldownUntil > nowMs) {
      const verification = buildKisSectorIndexCodeVerification({
        sectorKey: entry.sectorKey,
        iscd: entry.iscd,
        label: entry.label,
        errorClass: 'EMPTY',
      });
      return {
        sectorKey: entry.sectorKey,
        iscd: entry.iscd,
        label: entry.label,
        success: false,
        seriesCount: 0,
        ...verification,
        error: 'NEGATIVE_COOLDOWN_ACTIVE',
      };
    }
    try {
      const result = await fetchKisSectorIndexDaily(entry.iscd);
      if (!result || result.series.length === 0) {
        kisSectorIndexNegativeCooldownUntil.set(entry.iscd, nowMs + KIS_SECTOR_INDEX_NEGATIVE_COOLDOWN_MS);
        const errorClass = result ? 'EMPTY' : classifyKisSectorIndexDryRunError('KIS_EMPTY_OR_DISABLED');
        const verification = buildKisSectorIndexCodeVerification({
          sectorKey: entry.sectorKey,
          iscd: entry.iscd,
          label: entry.label,
          errorClass,
        });
        const recovered = await tryRecoverKisSectorIndexDryRunRow({ entry, verification, nowMs });
        if (recovered) return recovered;
        return {
          sectorKey: entry.sectorKey,
          iscd: entry.iscd,
          label: entry.label,
          success: false,
          seriesCount: 0,
          ...verification,
          error: result ? 'EMPTY_SERIES' : 'KIS_EMPTY_OR_DISABLED',
        };
      }
      const metrics = deriveKisSectorIndexDryRunMetrics(result);
      if (metrics.seriesCount < KIS_SECTOR_INDEX_MIN_SERIES_COUNT) {
        kisSectorIndexNegativeCooldownUntil.set(entry.iscd, nowMs + KIS_SECTOR_INDEX_NEGATIVE_COOLDOWN_MS);
        return {
          sectorKey: entry.sectorKey,
          iscd: entry.iscd,
          label: entry.label,
          success: false,
          providerIssue: true,
          errorClass: 'INSUFFICIENT_SERIES',
          error: `INSUFFICIENT_SERIES_${metrics.seriesCount}`,
          ...metrics,
        };
      }
      return {
        sectorKey: entry.sectorKey,
        iscd: entry.iscd,
        label: entry.label,
        success: true,
        providerIssue: false,
        marketSignal: false,
        verificationStatus: 'VERIFIED',
        resolutionStatus: 'NONE',
        ...metrics,
      };
    } catch (error) {
      kisSectorIndexNegativeCooldownUntil.set(entry.iscd, nowMs + KIS_SECTOR_INDEX_NEGATIVE_COOLDOWN_MS);
      return {
        sectorKey: entry.sectorKey,
        iscd: entry.iscd,
        label: entry.label,
        success: false,
        seriesCount: 0,
        providerIssue: true,
        errorClass: classifyKisSectorIndexDryRunError(error),
        error: error instanceof Error ? error.message : String(error),
      };
    }
  });

  const succeeded = rows.filter((row) => row.success).length;
  const report: KisSectorIndexDryRunReport = {
    enabled: true,
    attempted: rows.length,
    succeeded,
    failed: rows.length - succeeded,
    rows,
    sourceTier: 'KIS_SECTOR_INDEX_DAILY_DRYRUN',
    dataQuality: 'PARTIAL',
    officialBenchmark: false,
    sectorBoostAllowed: false,
    strongBuyAllowed: false,
    executionImpact: 'NONE',
    marketSignal: false,
    providerIssue: rows.some((row) => row.providerIssue),
    candidateCoverage: rows.length > 0 ? succeeded / rows.length : 0,
    promotionStage: 'OBSERVE',
    promotionBlockedReason: 'OBSERVE_20D_REQUIRED',
    daysCollected: 0,
    promotionHistoryRecorded: false,
  };
  const recordedReport = recordKisSectorIndexPromotionHistory(report, nowMs);
  if (recordedReport.attempted === 12 && recordedReport.succeeded === 12 && recordedReport.failed === 0) {
    console.log(
      `[SECTOR_INDEX_DRYRUN_RECOVERED] attempted=12 succeeded=12 failed=0 candidateCoverage=100.0% promotionStage=OBSERVE sectorBoostAllowed=false strongBuyAllowed=false executionImpact=NONE`,
    );
  }
  kisSectorIndexDryRunCache = {
    expiresAt: nowMs + KIS_SECTOR_INDEX_DRYRUN_TTL_MS,
    report: recordedReport,
  };
  logKisSectorIndexDryRunCandidate(recordedReport, nowMs);
  return recordedReport;
}

export function resetKisSectorIndexDryRunCacheForTests(options: { keepNegativeCooldown?: boolean } = {}): void {
  kisSectorIndexDryRunCache = null;
  kisSectorIndexDryRunLastLogKey = null;
  kisSectorIndexDryRunLastLogExpiresAt = 0;
  kisSectorIndexDryRunSuppressedCount = 0;
  setSectorIndexIdxcodeMasterRowsForTests(null);
  sectorIndexMappingRegistry.clearForTests();
  if (!options.keepNegativeCooldown) kisSectorIndexNegativeCooldownUntil.clear();
}

export function formatKisSectorIndexDryRunSection(report: KisSectorIndexDryRunReport): string {
  const latestDateTop = report.rows
    .map((row) => row.latestDate)
    .filter((date): date is string => typeof date === 'string' && /^\d{8}$/.test(date))
    .sort()
    .at(-1) ?? 'N/A';
  const failedRows = report.rows.filter((row) => !row.success);
  const recoveredRows = report.rows.filter((row) => row.success && row.previousIscd);
  const successRows = report.rows
    .filter((row) => row.success)
    .sort((a, b) => (b.latestDate ?? '').localeCompare(a.latestDate ?? '') || b.seriesCount - a.seriesCount)
    .slice(0, 5);
  const lines = [
    '<b>[KIS Sector Index Candidate Dry Run]</b>',
    `sourceTier: <code>${report.sourceTier}</code>`,
    `attempted: <b>${report.attempted}</b>`,
    `succeeded: <b>${report.succeeded}</b>`,
    `failed: <b>${report.failed}</b>`,
    `candidateCoverage: <b>${(report.candidateCoverage * 100).toFixed(1)}%</b>`,
    `officialBenchmark: <b>${String(report.officialBenchmark)}</b>`,
    `promotionStage: <code>${report.promotionStage}</code>`,
    `sectorBoostAllowed: <b>${String(report.sectorBoostAllowed)}</b>`,
    `strongBuyAllowed: <b>${String(report.strongBuyAllowed)}</b>`,
    `executionImpact: <code>${report.executionImpact}</code>`,
    `latestDateTop: <code>${latestDateTop}</code>`,
    'failed:',
  ];
  if (failedRows.length === 0) {
    lines.push('  0. <code>none</code>');
  } else {
    failedRows.forEach((row, idx) => {
      const status = row.verificationStatus ? ` / verification=<code>${row.verificationStatus}</code>` : '';
      const resolution = row.resolutionStatus ? ` / resolutionStatus=<code>${row.resolutionStatus}</code>` : '';
      lines.push(
        `  ${idx + 1}. <code>${row.sectorKey}</code> / ${row.label} / iscd=<code>${row.iscd}</code> / layer=<code>KIS_SECTOR_INDEX_DAILY_DRYRUN</code> / errorClass=<code>${row.errorClass ?? 'EMPTY'}</code>${status}${resolution}`,
      );
    });
  }
  lines.push('successTop:');
  if (successRows.length === 0) {
    lines.push('  0. <code>none</code>');
  } else {
    successRows.forEach((row, idx) => {
      lines.push(
        `  ${idx + 1}. <code>${row.sectorKey}</code> / ${row.label} / iscd=<code>${row.iscd}</code> / layer=<code>KIS_SECTOR_INDEX_DAILY_DRYRUN</code> / latest=<code>${row.latestDate ?? 'N/A'}</code> / rows=<b>${row.seriesCount}</b> / return5d=<code>${formatDryRunMetric(row.return5d)}</code> / return20d=<code>${formatDryRunMetric(row.return20d)}</code>`,
      );
    });
  }
  if (recoveredRows.length > 0) {
    lines.push('recovered:');
    recoveredRows.forEach((row, idx) => {
      lines.push(
        `  ${idx + 1}. <code>${row.sectorKey}</code> / ${row.label} / iscd=<code>${row.iscd}</code> / verification=<code>${row.verificationStatus ?? 'VERIFIED'}</code> / rows=<b>${row.seriesCount}</b> / latest=<code>${row.latestDate ?? 'N/A'}</code>`,
      );
    });
  }
  lines.push(
    report.failed === 0
      ? 'nextAction: <code>OBSERVE_20D_THEN_PROMOTION_AUDIT</code>'
      : 'nextAction: <code>VERIFY_FAILED_ISCD_2005_2006_WITH_IDXCODE_MST_BEFORE_L4_WIRING</code>',
  );
  return lines.join('\n');
}

export interface KisSectorEnergyProviderOverrides {
  fetchOfficialIndexRows?: () => Promise<KisSectorEnergyIndexRow[]>;
  fetchOfficialDailyRows?: () => Promise<KisSectorEnergyIndexRow[]>;
  fetchCandles?: (code: string) => Promise<KisChartCandle[]>;
  fetchInvestorFlow?: (code: string) => Promise<KisInvestorTradeByStockDaily | null>;
  now?: () => Date;
}

export interface KisSectorEnergyProviderResult {
  inputs: SectorEnergyInput[];
  dataQuality: SectorEnergyDataQuality;
  validSectorCount: number;
  totalSectorCount: number;
  sourceTier: KisSectorEnergySourceTier;
  confidence: number;
  leadershipConfidence: KisSectorEnergyLeadershipConfidence;
  coverageBreakdown: KisSectorEnergyCoverageBreakdown;
  selectedSectors: string[];
  providerIssue: boolean;
  marketSignal: false;
  liveExecutionAllowed: false;
  executionImpact: 'NONE';
  reasons: string[];
  diagnostics: string[];
  recoveryAudit?: KisRepresentativeBasketAudit;
  sectorCoverageBreakdown?: SectorEnergyCoverageBreakdown;
}

const TOTAL_SECTOR_COUNT = SECTOR_INDEX_MASTER.length;

export const KIS_REPRESENTATIVE_SECTOR_BASKET: Readonly<Record<string, readonly string[]>> = Object.freeze({
  SHIPBUILDING: ['329180', '042660', '010140', '009540'],
  DEFENSE: ['012450', '064350', '079550', '047810'],
  NUCLEAR: ['034020', '010120', '051600', '052690'],
  SEMICONDUCTOR: ['005930', '000660', '042700', '039030'],
  AUTOMOTIVE: ['005380', '000270', '012330', '161390'],
  BATTERY: ['373220', '051910', '006400', '247540'],
  BIO_HEALTHCARE: ['207940', '068270', '326030', '128940'],
  FINANCE: ['105560', '055550', '086790', '316140'],
  CHEMICAL: ['096770', '010950', '051910', '011170'],
  STEEL: ['005490', '004020', '010130', '016380'],
  CONSTRUCTION: ['000720', '028050', '047040', '006360'],
  CONSUMER_RETAIL: ['023530', '004170', '097950', '271560'],
  IT_INTERNET: ['035420', '035720', '036570', '259960'],
  OTHER: ['003550', '034730', '012750', '010120'],
});

const KIS_SECTOR_BASKET_PRICE_ROW_FALLBACKS: Readonly<Record<string, readonly string[]>> = Object.freeze({
  BATTERY: ['003670'],
});

const KIS_SECTOR_BASKET_DEFINITIONS: ReadonlyArray<{ sectorKey: string; displayName: string; representativeCodes: readonly string[] }> = Object.freeze([
  { sectorKey: 'SHIPBUILDING', displayName: '조선', representativeCodes: KIS_REPRESENTATIVE_SECTOR_BASKET.SHIPBUILDING },
  { sectorKey: 'DEFENSE', displayName: '방산', representativeCodes: KIS_REPRESENTATIVE_SECTOR_BASKET.DEFENSE },
  { sectorKey: 'NUCLEAR', displayName: '원자력', representativeCodes: KIS_REPRESENTATIVE_SECTOR_BASKET.NUCLEAR },
  { sectorKey: 'SEMICONDUCTOR', displayName: '반도체', representativeCodes: KIS_REPRESENTATIVE_SECTOR_BASKET.SEMICONDUCTOR },
  { sectorKey: 'AUTOMOTIVE', displayName: '자동차', representativeCodes: KIS_REPRESENTATIVE_SECTOR_BASKET.AUTOMOTIVE },
  { sectorKey: 'BATTERY', displayName: '2차전지', representativeCodes: KIS_REPRESENTATIVE_SECTOR_BASKET.BATTERY },
  { sectorKey: 'BIO_HEALTHCARE', displayName: '바이오', representativeCodes: KIS_REPRESENTATIVE_SECTOR_BASKET.BIO_HEALTHCARE },
  { sectorKey: 'FINANCE', displayName: '금융', representativeCodes: KIS_REPRESENTATIVE_SECTOR_BASKET.FINANCE },
  { sectorKey: 'CHEMICAL', displayName: '화학', representativeCodes: KIS_REPRESENTATIVE_SECTOR_BASKET.CHEMICAL },
  { sectorKey: 'STEEL', displayName: '철강', representativeCodes: KIS_REPRESENTATIVE_SECTOR_BASKET.STEEL },
  { sectorKey: 'CONSTRUCTION', displayName: '건설', representativeCodes: KIS_REPRESENTATIVE_SECTOR_BASKET.CONSTRUCTION },
  { sectorKey: 'CONSUMER_RETAIL', displayName: '유통', representativeCodes: KIS_REPRESENTATIVE_SECTOR_BASKET.CONSUMER_RETAIL },
]);

let overridesForTests: KisSectorEnergyProviderOverrides = {};

export function setKisSectorEnergyProviderOverridesForTests(overrides: KisSectorEnergyProviderOverrides): void {
  overridesForTests = { ...overrides };
}

export function resetKisSectorEnergyProviderOverridesForTests(): void {
  overridesForTests = {};
}

function finite(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value);
}

function clamp(value: number, min: number, max: number): number {
  if (!Number.isFinite(value)) return min;
  return Math.max(min, Math.min(max, value));
}

function avg(values: number[]): number {
  const finiteValues = values.filter(finite);
  if (finiteValues.length === 0) return 0;
  return finiteValues.reduce((sum, value) => sum + value, 0) / finiteValues.length;
}

function pctChange(from: number, to: number): number {
  if (!finite(from) || from <= 0 || !finite(to)) return 0;
  return ((to - from) / from) * 100;
}

function safeCode(code: string): string {
  const digits = code.replace(/[^0-9]/g, '');
  return digits.length >= 6 ? digits.slice(-6) : digits.padStart(6, '0');
}

function formatDryRunMetric(value: number | undefined): string {
  return finite(value) ? value.toFixed(4) : 'N/A';
}

function sectorName(sectorKey: string): string {
  return SECTOR_INDEX_MASTER.find((entry) => entry.sectorKey === sectorKey)?.displayName ?? sectorKey;
}

function coverageBreakdown(input: Partial<KisSectorEnergyCoverageBreakdown>): KisSectorEnergyCoverageBreakdown {
  const total = input.totalSectors ?? TOTAL_SECTOR_COUNT;
  const count = (value: number | undefined) => Math.max(0, Math.floor(value ?? 0));
  const ratio = (value: number | undefined) => total > 0 ? clamp(count(value) / total, 0, 1) : 0;
  return {
    totalSectors: total,
    verifiedIndexCodeCount: count(input.verifiedIndexCodeCount),
    verifiedIndexCodeCoverage: input.verifiedIndexCodeCoverage ?? ratio(input.verifiedIndexCodeCount),
    kisOfficialCount: count(input.kisOfficialCount),
    kisOfficialCoverage: input.kisOfficialCoverage ?? ratio(input.kisOfficialCount),
    kisBasketCount: count(input.kisBasketCount),
    kisBasketCoverage: input.kisBasketCoverage ?? ratio(input.kisBasketCount),
    internalProxyCount: count(input.internalProxyCount),
    internalProxyCoverage: input.internalProxyCoverage ?? ratio(input.internalProxyCount),
    stockDailyFallbackCount: count(input.stockDailyFallbackCount),
    stockDailyFallbackCoverage: input.stockDailyFallbackCoverage ?? ratio(input.stockDailyFallbackCount),
    yahooGlobalProxyCount: count(input.yahooGlobalProxyCount),
    yahooGlobalProxyCoverage: input.yahooGlobalProxyCoverage ?? ratio(input.yahooGlobalProxyCount),
  };
}

function leadershipPhase(return5d: number, return20d: number, breadth: number): 'EARLY' | 'MID' | 'LATE' | 'UNKNOWN' {
  if (!finite(return5d) || !finite(return20d)) return 'UNKNOWN';
  if (return5d > 0 && return20d <= 5) return 'EARLY';
  if (return20d > 5 && breadth >= 60) return 'MID';
  if (return20d > 10 && breadth < 50) return 'LATE';
  return 'UNKNOWN';
}

function scoreForRanking(input: SectorEnergyInput): number {
  return (
    (input.sectorReturn5d ?? 0) * 0.30 +
    (input.sectorReturn20d ?? 0) * 0.25 +
    (input.turnoverAcceleration ?? 0) * 0.20 +
    (input.breadthAbove20ma ?? 0) * 0.15 +
    (input.foreignInstitutionFlowAlignment ?? 0) * 0.10
  );
}

export function rankKisSectorEnergyInputs(inputs: SectorEnergyInput[]): SectorEnergyInput[] {
  return [...inputs].sort((a, b) => scoreForRanking(b) - scoreForRanking(a));
}

function stockMetrics(candles: KisChartCandle[]): {
  return1d: number;
  return5d: number;
  return20d: number;
  turnoverAcceleration: number;
  above20ma: boolean;
  latestVolume: number;
} | null {
  const rows = [...candles]
    .filter((c) => finite(c.close) && c.close > 0)
    .sort((a, b) => a.date.localeCompare(b.date));
  if (rows.length < 6) return null;

  const latest = rows[rows.length - 1]!;
  const oneAgo = rows[Math.max(0, rows.length - 2)]!;
  const fiveAgo = rows[Math.max(0, rows.length - 6)]!;
  const twentyAgo = rows[Math.max(0, rows.length - 21)]!;
  const last20 = rows.slice(Math.max(0, rows.length - 20));
  const prev20 = rows.slice(Math.max(0, rows.length - 40), Math.max(0, rows.length - 20));
  const last5 = rows.slice(Math.max(0, rows.length - 5));
  const avgVol5 = avg(last5.map((c) => c.volume));
  const avgVol20 = avg((prev20.length > 0 ? prev20 : last20).map((c) => c.volume));
  const ma20 = avg(last20.map((c) => c.close));

  return {
    return1d: pctChange(oneAgo.close, latest.close),
    return5d: pctChange(fiveAgo.close, latest.close),
    return20d: pctChange(twentyAgo.close, latest.close),
    turnoverAcceleration: avgVol20 > 0 ? pctChange(avgVol20, avgVol5) : 0,
    above20ma: ma20 > 0 && latest.close > ma20,
    latestVolume: latest.volume,
  };
}

function flowAlignment(flows: Array<KisInvestorTradeByStockDaily | null | undefined>): number {
  const finiteScores: number[] = [];
  for (const flow of flows) {
    if (!flow) continue;
    const net = (flow.foreignNetBuy ?? 0) + (flow.institutionalNetBuy ?? 0);
    if (!finite(net)) continue;
    finiteScores.push(net > 0 ? 100 : net < 0 ? 0 : 50);
  }
  if (finiteScores.length === 0) return 0;
  return avg(finiteScores);
}

function inputFromMetrics(
  sectorKey: string,
  displayName: string,
  metrics: Array<ReturnType<typeof stockMetrics>>,
  codes: string[],
  flowScore: number,
): SectorEnergyInput | null {
  const valid = metrics.filter((item): item is NonNullable<typeof item> => item !== null);
  if (valid.length === 0) return null;
  const sectorReturn5d = avg(valid.map((item) => item.return5d));
  const sectorReturn20d = avg(valid.map((item) => item.return20d));
  const turnoverAcceleration = avg(valid.map((item) => item.turnoverAcceleration));
  const breadthAbove20ma = (valid.filter((item) => item.above20ma).length / valid.length) * 100;
  const topConstituentMomentum = Math.max(...valid.map((item) => item.return5d));
  const leadingStockCount = valid.filter((item) => item.return5d > 0 && item.above20ma).length;
  return {
    name: displayName,
    return4w: sectorReturn20d,
    volumeChangePct: turnoverAcceleration,
    foreignConcentration: flowScore,
    sourceTier: 'KIS_STOCK_BASKET_DERIVED',
    sectorReturn5d,
    sectorReturn20d,
    turnoverAcceleration,
    breadthAbove20ma,
    foreignInstitutionFlowAlignment: flowScore,
    sectorVolumeSurge: turnoverAcceleration >= 30,
    sectorBreadth: breadthAbove20ma,
    leadingStockCount,
    topConstituentMomentum,
    leadershipPhase: leadershipPhase(sectorReturn5d, sectorReturn20d, breadthAbove20ma),
    constituentCount: valid.length,
    basketCodes: codes,
  };
}

export function buildKisSectorBasketRowsFromSeries(
  seriesByCode: Record<string, KisChartCandle[]>,
): KisSectorBasketRow[] {
  const rows: KisSectorBasketRow[] = [];
  for (const entry of KIS_SECTOR_BASKET_DEFINITIONS) {
    const codes = entry.representativeCodes.map(safeCode);
    const metrics = codes
      .map((code) => stockMetrics(seriesByCode[code] ?? []))
      .filter((item): item is NonNullable<ReturnType<typeof stockMetrics>> => item !== null);
    if (metrics.length === 0) continue;
    rows.push({
      sectorKey: entry.sectorKey,
      displayName: entry.displayName,
      representativeCodes: codes,
      validPriceCount: metrics.length,
      return1d: avg(metrics.map((item) => item.return1d)),
      return5d: avg(metrics.map((item) => item.return5d)),
      return20d: avg(metrics.map((item) => item.return20d)),
      turnoverAcceleration: avg(metrics.map((item) => item.turnoverAcceleration)),
      breadthAbove20ma: (metrics.filter((item) => item.above20ma).length / metrics.length) * 100,
      source: 'KIS_DAILY_CHART',
      confidence: 'PARTIAL',
    });
  }
  return rows;
}

export function buildKisSectorEnergyBasketFromSeries(
  seriesByCode: Record<string, KisChartCandle[]>,
  flowByCode: Record<string, KisInvestorTradeByStockDaily | null | undefined> = {},
): SectorEnergyInput[] {
  const inputs: SectorEnergyInput[] = [];
  for (const entry of KIS_SECTOR_BASKET_DEFINITIONS) {
    const codes = entry.representativeCodes.map(safeCode);
    const metrics = codes.map((code) => stockMetrics(seriesByCode[code] ?? []));
    const flowScore = flowAlignment(codes.map((code) => flowByCode[code]));
    const input = inputFromMetrics(entry.sectorKey, entry.displayName, metrics, codes, flowScore);
    if (input) inputs.push(input);
  }

  const marketReturn20 = avg(inputs.map((input) => input.sectorReturn20d ?? 0));
  const turnoverRanks = rankKisSectorEnergyInputs(inputs)
    .map((input, idx) => [input.name, idx + 1] as const);
  const rankByName = new Map(turnoverRanks);
  return inputs.map((input) => ({
    ...input,
    sectorRelativeStrengthVsKospi: (input.sectorReturn20d ?? 0) - marketReturn20,
    sectorRelativeStrengthVsKosdaq: (input.sectorReturn20d ?? 0) - marketReturn20,
    turnoverRank: rankByName.get(input.name) ?? 0,
  }));
}


function batteryMissingCodes(seriesByCode: Record<string, KisChartCandle[]>): string[] {
  const battery = KIS_SECTOR_BASKET_DEFINITIONS.find((entry) => entry.sectorKey === 'BATTERY');
  if (!battery) return [];
  return battery.representativeCodes
    .map(safeCode)
    .filter((code) => stockMetrics(seriesByCode[code] ?? []) === null);
}

async function refreshBatteryMissingPriceRows(input: {
  seriesByCode: Record<string, KisChartCandle[]>;
  fetchCandles: (code: string) => Promise<KisChartCandle[]>;
}): Promise<void> {
  const beforeMissing = batteryMissingCodes(input.seriesByCode);
  if (beforeMissing.length === 0) {
    console.log('[SECTOR_BASKET_PRICE_ROWS_REFRESH] sector=2李⑥쟾吏 layer=PRODUCTION_BASKET before=FULL_QUALITY after=FULL_QUALITY executionImpact=NONE');
    return;
  }
  const refreshed = await mapLimit(beforeMissing, 2, async (code) => {
    const candles = await input.fetchCandles(code).catch(() => [] as KisChartCandle[]);
    return [code, candles] as const;
  });
  for (const [code, candles] of refreshed) {
    if (candles.length > 0) input.seriesByCode[code] = candles;
  }
  const fallbackCodes = KIS_SECTOR_BASKET_PRICE_ROW_FALLBACKS.BATTERY.map(safeCode);
  for (const missingCode of batteryMissingCodes(input.seriesByCode)) {
    for (const fallbackCode of fallbackCodes) {
      if (fallbackCode === missingCode) continue;
      const candles = await input.fetchCandles(fallbackCode).catch(() => [] as KisChartCandle[]);
      if (stockMetrics(candles) === null) continue;
      input.seriesByCode[missingCode] = candles;
      console.log(
        `[SECTOR_BASKET_PRICE_ROWS_REFRESH] sector=BATTERY layer=PRODUCTION_BASKET missingCode=${missingCode} fallbackCode=${fallbackCode} fallbackApplied=true executionImpact=NONE`,
      );
      break;
    }
  }
  const afterMissing = batteryMissingCodes(input.seriesByCode);
  console.log(
    `[SECTOR_BASKET_PRICE_ROWS_REFRESH] sector=2李⑥쟾吏 layer=PRODUCTION_BASKET before=PARTIAL after=${afterMissing.length === 0 ? 'FULL_QUALITY' : 'PARTIAL'} executionImpact=NONE`,
  );
}

function inputFromOfficialRow(row: KisSectorEnergyIndexRow): SectorEnergyInput {
  const breadth = row.breadthAbove20ma ?? 0;
  return {
    name: sectorName(row.sectorKey),
    return4w: row.sectorReturn20d,
    volumeChangePct: row.turnoverAcceleration ?? 0,
    foreignConcentration: row.foreignInstitutionFlowAlignment ?? 0,
    sourceTier: row.sourceTier ?? 'KIS_OFFICIAL_INDEX',
    sectorReturn5d: row.sectorReturn5d,
    sectorReturn20d: row.sectorReturn20d,
    turnoverAcceleration: row.turnoverAcceleration ?? 0,
    breadthAbove20ma: breadth,
    foreignInstitutionFlowAlignment: row.foreignInstitutionFlowAlignment ?? 0,
    sectorRelativeStrengthVsKospi: row.sectorRelativeStrengthVsKospi,
    sectorRelativeStrengthVsKosdaq: row.sectorRelativeStrengthVsKosdaq,
    sectorVolumeSurge: (row.turnoverAcceleration ?? 0) >= 30,
    sectorBreadth: breadth,
    leadingStockCount: row.leadingStockCount ?? 0,
    topConstituentMomentum: row.topConstituentMomentum ?? row.sectorReturn5d,
    leadershipPhase: leadershipPhase(row.sectorReturn5d, row.sectorReturn20d, breadth),
    constituentCount: 0,
  };
}

async function defaultOfficialIndexRows(): Promise<KisSectorEnergyIndexRow[]> {
  if (process.env.KIS_SECTOR_INDEX_DAILY_ENABLED !== 'true') return [];
  const results: Array<KisSectorEnergyIndexRow | null> = await mapLimit(
    Array.from(KIS_SECTOR_ISCD_MAP),
    3,
    async (entry): Promise<KisSectorEnergyIndexRow | null> => {
      try {
        const endpoint = await fetchKisSectorIndexDaily(entry.iscd);
        if (!endpoint) return null;
        const metrics = deriveKisSectorIndexDryRunMetrics(endpoint);
        if (metrics.return20d == null || metrics.seriesCount < KIS_SECTOR_INDEX_MIN_SERIES_COUNT) return null;
        const row: KisSectorEnergyIndexRow = {
          sectorKey: entry.sectorKey,
          sectorReturn5d: metrics.return5d ?? 0,
          sectorReturn20d: metrics.return20d,
          ...(metrics.turnoverAcceleration != null ? { turnoverAcceleration: metrics.turnoverAcceleration } : {}),
          sourceTier: 'KIS_OFFICIAL_DAILY',
        };
        return row;
      } catch {
        return null;
      }
    },
  );
  return results.filter((row): row is KisSectorEnergyIndexRow => row !== null);
}

async function defaultOfficialDailyRows(): Promise<KisSectorEnergyIndexRow[]> {
  return [];
}

async function defaultFetchCandles(code: string): Promise<KisChartCandle[]> {
  return fetchKisDailyCandles(code);
}

async function mapLimit<T, R>(
  items: T[],
  limit: number,
  worker: (item: T) => Promise<R>,
): Promise<R[]> {
  const output: R[] = new Array(items.length);
  let cursor = 0;
  async function run(): Promise<void> {
    while (cursor < items.length) {
      const idx = cursor;
      cursor += 1;
      output[idx] = await worker(items[idx]!);
    }
  }
  const workers = Array.from({ length: Math.max(1, Math.min(limit, items.length)) }, () => run());
  await Promise.all(workers);
  return output;
}

function parseYmd(date: string | undefined): Date | null {
  if (!date || !/^\d{8}$/.test(date)) return null;
  return new Date(Date.UTC(Number(date.slice(0, 4)), Number(date.slice(4, 6)) - 1, Number(date.slice(6, 8))));
}

function tradingDayAge(latest: string | undefined, now: Date): number | null {
  const start = parseYmd(latest);
  if (!start) return null;
  const end = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
  let age = 0;
  for (let d = new Date(start); d < end; d.setUTCDate(d.getUTCDate() + 1)) {
    const day = d.getUTCDay();
    if (day !== 0 && day !== 6) age += 1;
  }
  return Math.max(0, age);
}

function previousTradingDate(now: Date): string {
  const d = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
  do {
    d.setUTCDate(d.getUTCDate() - 1);
  } while (d.getUTCDay() === 0 || d.getUTCDay() === 6);
  return `${d.getUTCFullYear()}${String(d.getUTCMonth() + 1).padStart(2, '0')}${String(d.getUTCDate()).padStart(2, '0')}`;
}

function latestCandleDate(candles: KisChartCandle[]): string | undefined {
  return candles.map((c) => c.date).filter((date) => /^\d{8}$/.test(date)).sort().at(-1);
}

function deriveKisBasketDiagnostics(
  seriesByCode: Record<string, KisChartCandle[]>,
  basketRows: KisSectorBasketRow[],
  now: Date,
): { audit: KisRepresentativeBasketAudit; coverage: SectorEnergyCoverageBreakdown } {
  const expected = KIS_SECTOR_BASKET_DEFINITIONS.length;
  const actual = basketRows.length;
  const rowBySector = new Map(basketRows.map((row) => [row.sectorKey, row]));
  const staleThresholdTradingDays = 1;
  let priceRowsFetched = 0;
  let priceRowsFresh = 0;
  let priceRowsStale = 0;
  let representativeSymbolsResolved = 0;
  let representativeSymbolsMissing = 0;
  let latestAvailableDate: string | undefined;

  const sectorRows = KIS_SECTOR_BASKET_DEFINITIONS.map((entry) => {
    const symbols = entry.representativeCodes.map(safeCode);
    const latestDates = symbols.map((code) => latestCandleDate(seriesByCode[code] ?? []));
    const found = latestDates.filter(Boolean).length;
    const missing = Math.max(0, symbols.length - found);
    const latest = latestDates.filter((date): date is string => Boolean(date)).sort().at(-1);
    if (latest && (!latestAvailableDate || latest > latestAvailableDate)) latestAvailableDate = latest;
    const age = tradingDayAge(latest, now);
    priceRowsFetched += found;
    representativeSymbolsResolved += symbols.length;
    representativeSymbolsMissing += symbols.length === 0 ? 1 : 0;
    const row = rowBySector.get(entry.sectorKey);
    let freshness: SectorEnergyCoverageBreakdown['sectorRows'][number]['freshness'];
    let reason: SectorEnergyCoverageBreakdown['sectorRows'][number]['reason'];
    if (symbols.length === 0) {
      freshness = 'MISSING';
      reason = 'NO_REPRESENTATIVE_SYMBOLS';
    } else if (found === 0 || !row) {
      freshness = 'MISSING';
      reason = 'PRICE_ROWS_MISSING';
    } else if (missing > 0) {
      freshness = 'PARTIAL';
      reason = 'PRICE_ROWS_MISSING';
    } else if (age !== null && age > staleThresholdTradingDays) {
      freshness = 'STALE';
      reason = 'PRICE_ROWS_STALE';
    } else {
      freshness = 'FRESH';
      reason = 'OK';
    }
    if (freshness === 'FRESH') priceRowsFresh += 1;
    if (freshness === 'STALE' || freshness === 'PARTIAL') priceRowsStale += 1;
    const rowLevelStatus: NonNullable<SectorEnergyCoverageBreakdown['sectorRows'][number]['rowLevelStatus']> = freshness === 'FRESH' ? 'COMPLETE' : freshness === 'MISSING' ? 'MISSING' : freshness === 'STALE' ? 'STALE' : 'PARTIAL';
    const sectorLevelStatus: NonNullable<SectorEnergyCoverageBreakdown['sectorRows'][number]['sectorLevelStatus']> = freshness === 'FRESH' ? 'FULL_QUALITY' : freshness === 'MISSING' ? 'MISSING' : freshness === 'STALE' ? 'STALE' : 'PARTIAL';
    const problemType: NonNullable<SectorEnergyCoverageBreakdown['sectorRows'][number]['problemType']> = reason === 'OK' ? 'RESOLVED' : reason === 'PRICE_ROWS_MISSING' ? 'PRICE_ROWS_MISSING' : reason === 'PRICE_ROWS_STALE' ? 'PRICE_ROWS_STALE' : reason === 'NO_REPRESENTATIVE_SYMBOLS' ? 'NO_REPRESENTATIVE_SYMBOLS' : 'UNKNOWN';
    return {
      sectorName: entry.displayName,
      sectorCode: entry.sectorKey,
      representativeSymbols: symbols,
      representativeSymbolCount: symbols.length,
      priceRowsFound: found,
      priceRowsMissing: missing,
      latestPriceDate: latest ?? null,
      ageTradingDays: age,
      freshness,
      reason,
      rowLevelStatus,
      sectorLevelStatus,
      problemType,
    };
  });

  const staleSectorCount = sectorRows.filter((row) => row.freshness === 'STALE').length;
  const missingSectorCount = sectorRows.filter((row) => row.freshness === 'MISSING').length;
  const partialSectorCount = sectorRows.filter((row) => row.freshness === 'PARTIAL').length;
  const fullQualitySectorCount = sectorRows.filter((row) => row.freshness === 'FRESH').length;
  const breakPoint: KisRepresentativeBasketAudit['breakPoint'] = actual < 8
    ? 'BASKET_ROWS_BELOW_MINIMUM'
    : representativeSymbolsMissing > 0
      ? 'REPRESENTATIVE_SYMBOLS_MISSING'
      : missingSectorCount > 0
        ? 'REPRESENTATIVE_PRICE_ROWS_MISSING'
        : staleSectorCount + partialSectorCount > 0
          ? 'REPRESENTATIVE_PRICE_ROWS_STALE'
          : 'OFFICIAL_SECTOR_INDEX_UNAVAILABLE';
  const nextAction = breakPoint === 'OFFICIAL_SECTOR_INDEX_UNAVAILABLE'
    ? 'REPAIR_KRX_OR_KIS_SECTOR_INDEX_MASTER'
    : breakPoint === 'REPRESENTATIVE_SYMBOLS_MISSING'
      ? 'REPAIR_SECTOR_REPRESENTATIVE_SYMBOL_MAP'
      : breakPoint === 'REPRESENTATIVE_PRICE_ROWS_MISSING' || breakPoint === 'BASKET_ROWS_BELOW_MINIMUM'
        ? 'WIRE_KIS_DAILY_PRICE_ROWS_FOR_SECTOR_BASKET'
        : breakPoint === 'REPRESENTATIVE_PRICE_ROWS_STALE' || breakPoint === 'CACHE_STALE'
          ? 'REFRESH_SECTOR_BASKET_PRICE_CACHE'
          : breakPoint === 'DATE_ALIGNMENT_FAILED'
            ? 'FIX_SECTOR_BASKET_TRADING_DATE_ALIGNMENT'
            : 'RECOVER_SECTOR_COVERAGE_BEFORE_GATE2_PROMOTION';
  return {
    audit: {
      officialSectorIndexAvailable: false,
      usingKisRepresentativeBasket: true,
      representativeBasketExpectedRows: expected,
      representativeBasketActualRows: actual,
      representativeBasketMissingRows: Math.max(0, expected - actual),
      representativeSymbolsResolved,
      representativeSymbolsMissing,
      priceRowsFetched,
      priceRowsFresh,
      priceRowsStale,
      latestAvailableDate: latestAvailableDate ?? null,
      previousTradingDate: previousTradingDate(now),
      staleThresholdTradingDays,
      breakPoint,
      nextAction,
      sectorBoostAllowed: false,
      strongBuyAllowed: false,
      executionHardBlock: false,
      executionImpact: 'NONE',
    },
    coverage: {
      expectedSectorCount: expected,
      validSectorCount: actual,
      fullQualitySectorCount,
      partialQualitySectorCount: partialSectorCount,
      staleSectorCount,
      missingSectorCount,
      partialSectorCount,
      sectorRows,
      executionImpact: 'NONE',
    },
  };
}

function resultFromInputs(
  inputs: SectorEnergyInput[],
  sourceTier: KisSectorEnergySourceTier,
  reasons: string[],
  diagnostics?: { audit?: KisRepresentativeBasketAudit; coverage?: SectorEnergyCoverageBreakdown },
): KisSectorEnergyProviderResult {
  const validSectorCount = inputs.length;
  const selectedSectors = rankKisSectorEnergyInputs(inputs).slice(0, 3).map((input) => String(input.name));
  const dataQuality: SectorEnergyDataQuality =
    sourceTier === 'KIS_STOCK_BASKET_DERIVED'
      ? (validSectorCount >= 9 ? 'PARTIAL' : validSectorCount > 0 ? 'STALE' : 'FAILED')
      : validSectorCount >= TOTAL_SECTOR_COUNT ? 'OK' : validSectorCount >= 9 ? 'PARTIAL' : validSectorCount > 0 ? 'STALE' : 'FAILED';
  const confidence =
    sourceTier === 'KIS_OFFICIAL_INDEX'
      ? clamp(0.95 * (validSectorCount / TOTAL_SECTOR_COUNT), 0, 1)
      : sourceTier === 'KIS_OFFICIAL_DAILY'
        ? clamp(0.9 * (validSectorCount / TOTAL_SECTOR_COUNT), 0, 1)
        : sourceTier === 'KIS_STOCK_BASKET_DERIVED'
          ? clamp(0.65 * (validSectorCount / TOTAL_SECTOR_COUNT), 0, 1)
          : 0;
  const leadershipConfidence: KisSectorEnergyLeadershipConfidence =
    sourceTier === 'KIS_OFFICIAL_INDEX' || sourceTier === 'KIS_OFFICIAL_DAILY'
      ? 'WEIGHTED'
      : sourceTier === 'KIS_STOCK_BASKET_DERIVED' && validSectorCount > 0
        ? 'READY_FOR_SHADOW'
        : 'BLOCKED';
  const breakdown = coverageBreakdown({
    verifiedIndexCodeCount: sourceTier === 'KIS_OFFICIAL_INDEX' || sourceTier === 'KIS_OFFICIAL_DAILY' ? validSectorCount : 0,
    kisOfficialCount: sourceTier === 'KIS_OFFICIAL_INDEX' || sourceTier === 'KIS_OFFICIAL_DAILY' ? validSectorCount : 0,
    kisBasketCount: sourceTier === 'KIS_STOCK_BASKET_DERIVED' ? validSectorCount : 0,
  });
  return {
    inputs,
    dataQuality,
    validSectorCount,
    totalSectorCount: TOTAL_SECTOR_COUNT,
    sourceTier,
    confidence,
    leadershipConfidence,
    coverageBreakdown: breakdown,
    selectedSectors,
    providerIssue: validSectorCount === 0,
    marketSignal: false,
    liveExecutionAllowed: false,
    executionImpact: 'NONE',
    reasons,
    diagnostics: [
      `sourceTier=${sourceTier}`,
      `validSectorCount=${validSectorCount}/${TOTAL_SECTOR_COUNT}`,
      `leadershipConfidence=${leadershipConfidence}`,
      'officialSource=KIS_API',
      'officialIndex=false',
      'sectorBoostAllowed=false',
      'strongBuyAllowed=false',
      'sourcePolicy=KIS_STOCK_BASKET_DERIVED',
      'liveExecutionAllowed=false',
      'executionImpact=NONE',
      ...(diagnostics?.audit ? [
        `representativeBasketExpectedRows=${diagnostics.audit.representativeBasketExpectedRows}`,
        `representativeBasketActualRows=${diagnostics.audit.representativeBasketActualRows}`,
        `representativeBasketMissingRows=${diagnostics.audit.representativeBasketMissingRows}`,
        `priceRowsFetched=${diagnostics.audit.priceRowsFetched}`,
        `priceRowsFresh=${diagnostics.audit.priceRowsFresh}`,
        `priceRowsStale=${diagnostics.audit.priceRowsStale}`,
        `breakPoint=${diagnostics.audit.breakPoint}`,
      ] : []),
    ],
    ...(diagnostics?.audit ? { recoveryAudit: diagnostics.audit } : {}),
    ...(diagnostics?.coverage ? { sectorCoverageBreakdown: diagnostics.coverage } : {}),
  };
}

export async function buildKisSectorEnergyInputsWithMeta(
  overrides: KisSectorEnergyProviderOverrides = {},
): Promise<KisSectorEnergyProviderResult> {
  const used = { ...overridesForTests, ...overrides };

  const fetchOfficialIndexRows = used.fetchOfficialIndexRows ?? defaultOfficialIndexRows;
  const fetchOfficialDailyRows = used.fetchOfficialDailyRows ?? defaultOfficialDailyRows;
  const fetchCandles = used.fetchCandles ?? defaultFetchCandles;
  const fetchInvestorFlow = used.fetchInvestorFlow;
  const now = used.now?.() ?? new Date();

  const indexRows = await fetchOfficialIndexRows().catch(() => [] as KisSectorEnergyIndexRow[]);
  const indexInputs = indexRows.map((row) => inputFromOfficialRow({ ...row, sourceTier: 'KIS_OFFICIAL_INDEX' }));
  if (indexInputs.length > 0) {
    return resultFromInputs(indexInputs, 'KIS_OFFICIAL_INDEX', [
      'KIS official sector/index quote selected before KRX indexCode validation.',
    ]);
  }

  const dailyRows = await fetchOfficialDailyRows().catch(() => [] as KisSectorEnergyIndexRow[]);
  const dailyInputs = dailyRows.map((row) => inputFromOfficialRow({ ...row, sourceTier: 'KIS_OFFICIAL_DAILY' }));
  if (dailyInputs.length > 0) {
    return resultFromInputs(dailyInputs, 'KIS_OFFICIAL_DAILY', [
      'KIS official sector/index daily chart selected before KRX indexCode validation.',
    ]);
  }

  const allCodes = Array.from(
    new Set(
      KIS_SECTOR_BASKET_DEFINITIONS
        .flatMap((entry) => entry.representativeCodes)
        .map(safeCode),
    ),
  );
  const candleEntries = await mapLimit(allCodes, 4, async (code) => {
    const candles = await fetchCandles(code).catch(() => [] as KisChartCandle[]);
    return [code, candles] as const;
  });
  const seriesByCode = Object.fromEntries(candleEntries);
  await refreshBatteryMissingPriceRows({ seriesByCode, fetchCandles });

  const flowByCode: Record<string, KisInvestorTradeByStockDaily | null> = {};
  if (fetchInvestorFlow) {
    const flowEntries = await mapLimit(allCodes, 4, async (code) => {
      const flow = await fetchInvestorFlow(code).catch(() => null);
      return [code, flow] as const;
    });
    Object.assign(flowByCode, Object.fromEntries(flowEntries));
  }

  const basketRows = buildKisSectorBasketRowsFromSeries(seriesByCode);
  const basketDiagnostics = deriveKisBasketDiagnostics(seriesByCode, basketRows, now);
  const basketInputs = buildKisSectorEnergyBasketFromSeries(seriesByCode, flowByCode);
  if (basketInputs.length > 0) {
    return resultFromInputs(basketInputs, 'KIS_STOCK_BASKET_DERIVED', [
      'KIS official sector index unavailable; derived representative basket from official KIS daily prices.',
      `basketRows=${basketRows.length}`,
      'Basket is PARTIAL, not KRX official index.',
    ], { audit: basketDiagnostics.audit, coverage: basketDiagnostics.coverage });
  }

  return resultFromInputs([], 'MISSING', [
    'KIS sector index and representative basket returned no materialized rows.',
    'providerIssue=true; marketSignal=false',
  ], { audit: basketDiagnostics.audit, coverage: basketDiagnostics.coverage });
}
