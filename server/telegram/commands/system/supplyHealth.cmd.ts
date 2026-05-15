/**
 * @responsibility 수급 데이터 채널의 source/freshness/coverage/zero-filled 의심을 read-only로 진단한다.
 * PR-574~584: fake-zero/accepted-empty/provider-mismatch/unwired-collection 상태를 neutral 로 격리하고 investor-flow policy route 를 표시한다.
 *
 * ADR-0421 — investor-flow marker NEUTRAL 폐기. success=0 + missing>0 시점은
 *   DATA_UNAVAILABLE 로 분류 (NEUTRAL 절대 금지). NEUTRAL 은 *real data + weak
 *   direction* 시점에만 사용 (사용자 명시 핵심 불변식 #2/#3).
 */

import fs from 'fs';
import { fetchKisMarketProgramTrade, fetchKisStockProgramTrade } from '../../../clients/kisClient/index.js';
import { diagnoseKisMarketProgramRaw, diagnoseKisStockProgramRaw, formatKisRawSupplyDiagnostic } from '../../../clients/kisClient/supplyDiagnostics.js';
// Patch-PROGRAM-MARKET-EMPTY-OUTPUT-ROUTER-004 — 7-state classifier + KRX/CACHE fallback + Provider Coverage Map SSOT.
import {
  routeProgramMarketEmpty,
  deriveCacheFallbackFromMacroState,
  formatProgramMarketRouted,
  type ProgramMarketRoutingDecision,
} from '../../../clients/kisClient/programMarketRouterPatch004.js';
// Patch-MARKET-PROGRAM-TRADING-FALLBACK-RECOVERY-006 — actual KRX aggregate wiring + 3-tier CACHE TTL + intraday session.
import {
  routeProgramMarketEmptyWithKrxAggregate,
  formatProgramMarketRoutedV2,
  isPatch006Disabled,
  isProgramTradingIntradaySession,
  type ProgramMarketRoutingDecisionV2,
} from '../../../clients/krxClient/programMarketRouterPatch006.js';
import { MARKET_PROGRAM_INDEX_CODE } from '../../../clients/kisClient/programMaterializer.js';
import { FSS_RECORDS_FILE, MACRO_STATE_FILE } from '../../../persistence/paths.js';
import { loadForeignerRatioSeries } from '../../../persistence/foreignerRatioRepo.js';
import { loadWatchlist, type WatchlistEntry } from '../../../persistence/watchlistRepo.js';
import type { MacroState } from '../../../persistence/macroStateRepo.js';
import {
  fetchInvestorFlowWithPolicy,
  summarizeInvestorFlowAttempts,
  summarizeInvestorFlowProviderHealth,
  type InvestorFlowSample,
} from '../../../supply/investorFlowRouter.js';
import { getSupplyProviderPolicy, type SupplyProvider, type SupplySignalKey } from '../../../supply/supplyProviderPolicy.js';
// ADR-0421 — investor-flow marker classification SSOT (NEUTRAL 폐기).
import { classifyInvestorFlowMarker, describeInvestorFlowMarker } from '../../../supply/investorFlowSemanticAvailability.js';
import { fetchKrxShortSelling } from '../../../trading/marketDataRefresh.js';
import { commandRegistry } from '../../commandRegistry.js';
import type { TelegramCommand } from '../_types.js';
import type { SourceHealth, SupplyHealthSnapshot } from '../../../learning/supplyHealthLearning.js';
import { getLastScanSummary } from '../../../trading/signalScanner/scanDiagnostics.js';
import type {
  InvestorFlowProviderRouteResult,
  InvestorFlowProviderStatus as RouterInvestorFlowProviderStatus,
} from '../../../trading/signalScanner/investorFlowProviderRouterAdr0477.js';
import type {
  KisOfficialSupplyPack,
  KisSupplyEnemyChecklistDecision,
} from '../../../supply/kisOfficialSupplyPack.js';
import { buildKisOnlyHealthReport, formatKisOnlyHealthReport, isKisOnlyRebuildMode } from '../../../diagnostics/kisOnlyHealth.js';

export const SUPPLY_HEALTH_CACHE_TTL_MS = 30_000;
const TOP_N = 10;
const KIS_STALE_MS = 5 * 60 * 1000;
const DAY_MS = 86_400_000;
const TWO_DAYS = 2;
const FSS_STALE_DAYS = 4;
const SHORT_STALE_DAYS = 2;
const INVESTOR_FLOW_CACHE_STALE_DAYS = 2;
const ZERO_FILLED_MIN_COUNT = 3;
const ZERO_FILLED_RATIO_WARN = 0.8;
const ATTEMPT_REASON_MAX_LEN = 110;
const PROGRAM_TRADING_SESSION_CLOSED_LOG_COOLDOWN_MS = 5 * 60 * 1000;
const programTradingSessionClosedLastLog = new Map<'STOCK' | 'MARKET', number>();

// ADR-0421 — DATA_UNAVAILABLE 추가 (NEUTRAL 은 real-data + weak-direction 영역만 보존).
type Marker = 'OK' | 'STALE' | 'DEGRADED' | 'MISSING' | 'NEUTRAL' | 'DATA_UNAVAILABLE' | 'N/A';
interface ZeroSuspectDetail {
  code: string;
  source: 'KIS_INVESTOR_TRADE_BY_STOCK_DAILY' | 'KRX_INVESTOR_FLOW' | 'NAVER_INVESTOR_TREND' | 'CACHE' | 'UNKNOWN';
  foreignNetBuy: number | null;
  institutionalNetBuy: number | null;
  individualNetBuy: number | null;
  reason: 'REAL_ZERO_FIELD' | 'FALLBACK_ZERO' | 'UNKNOWN';
}
interface ChannelStatus { key: SupplySignalKey; title: string; marker: Marker; lines: string[]; riskReason?: string; zeroSuspect?: { count: number; total: number; details?: ZeroSuspectDetail[] } }
interface FssRecordRow { date: string; passiveNetBuy: number; activeNetBuy: number }
interface KisOfficialSupplyPackLoad {
  code: string | null;
  pack: KisOfficialSupplyPack | null;
  enemy: KisSupplyEnemyChecklistDecision | null;
  error?: string;
}

let cache: { message: string; builtAt: number; mode: 'LEGACY' | 'KIS_ONLY_REBUILD' } | null = null;


function logProgramTradingSessionClosed(scope: 'STOCK' | 'MARKET', nowMs: number): void {
  const last = programTradingSessionClosedLastLog.get(scope) ?? 0;
  if (nowMs - last < PROGRAM_TRADING_SESSION_CLOSED_LOG_COOLDOWN_MS) return;
  programTradingSessionClosedLastLog.set(scope, nowMs);
  console.info(
    `[PROGRAM_TRADING_SESSION_CLOSED] scope=${scope} sessionState=CLOSED status=SESSION_CLOSED scoring=excluded_afterhours action=observe providerIssue=false marketSignal=false executionImpact=NONE`,
  );
}

function buildProgramTradingSessionClosedStatus(scope: 'STOCK' | 'MARKET', source: 'KIS_API' | 'NONE', nowMs: number): ChannelStatus {
  logProgramTradingSessionClosed(scope, nowMs);
  const isStock = scope === 'STOCK';
  return {
    key: isStock ? 'stockProgram' : 'marketProgram',
    title: isStock ? '종목 프로그램매매' : '시장 프로그램매매',
    marker: 'NEUTRAL',
    lines: [
      `source: ${source}`,
      'status: SESSION_CLOSED',
      'lamp: GRAY',
      'success: N/A',
      'missing: N/A',
      'zero-filled 의심: N/A',
      'scoring=excluded_afterhours',
      'providerIssue=false',
      'marketSignal=false',
      'executionImpact=NONE',
      'dataVacuum=false',
      'newBuyBlocked=false',
      'generalBuyBlocked=false',
      'strongBuyBlocked=false',
      'action=observe',
      `reason: ${isStock ? 'STOCK_PROGRAM_INTRADAY_ONLY_SESSION_CLOSED' : 'MARKET_PROGRAM_INTRADAY_ONLY_SESSION_CLOSED'}`,
      isStock ? '상세: /program_today' : '상세: /program_market',
    ],
  };
}

function markerIcon(marker: Marker): string {
  if (marker === 'OK') return '🟢';
  if (marker === 'STALE') return '🟡';
  if (marker === 'DEGRADED') return '🟠';
  if (marker === 'MISSING') return '🔴';
  // ADR-0421 — DATA_UNAVAILABLE 은 MISSING 과 시각적으로 동등 (semantic data 부재).
  if (marker === 'DATA_UNAVAILABLE') return '🔴';
  return '⚪';
}
function readJsonFile<T>(file: string): T | null {
  try { return fs.existsSync(file) ? JSON.parse(fs.readFileSync(file, 'utf-8')) as T : null; } catch { return null; }
}
function loadMacroStateReadOnly(): MacroState | null { return readJsonFile<MacroState>(MACRO_STATE_FILE); }
function loadFssRecordsReadOnly(): FssRecordRow[] { const rows = readJsonFile<FssRecordRow[]>(FSS_RECORDS_FILE); return Array.isArray(rows) ? rows : []; }
function selectTopWatchlist(limit = TOP_N): WatchlistEntry[] {
  return [...loadWatchlist()].sort((a, b) => Number((b as any).stage2Score ?? 0) - Number((a as any).stage2Score ?? 0)).slice(0, limit);
}
function formatTargetLine(totalWatchlist: number, picked: number): string {
  return totalWatchlist >= TOP_N ? `검증 종목: stage2Score 상위 10개 중 ${picked}개` : `검증 종목: stage2Score 상위 ${picked}개`;
}
function elapsedMs(iso: string | undefined, nowMs: number): number | null {
  if (!iso) return null; const ts = Date.parse(iso); return Number.isFinite(ts) ? Math.max(0, nowMs - ts) : null;
}
function formatAgo(ms: number | null): string {
  if (ms === null) return 'N/A';
  const sec = Math.floor(ms / 1000); if (sec < 60) return `${sec}s ago`;
  const min = Math.floor(sec / 60); if (min < 60) return `${min}m ago`;
  const hr = Math.floor(min / 60); if (hr < 48) return `${hr}h ago`;
  return `${Math.floor(hr / 24)}일 전`;
}
function todayKstDate(nowMs: number): string { return new Date(nowMs + 9 * 3600_000).toISOString().slice(0, 10); }
function elapsedDays(date: string | null | undefined, nowMs: number): number | null {
  if (!date || !/^\d{4}-\d{2}-\d{2}$/.test(date)) return null;
  const today = Date.parse(`${todayKstDate(nowMs)}T00:00:00Z`);
  const then = Date.parse(`${date}T00:00:00Z`);
  return Number.isFinite(today) && Number.isFinite(then) ? Math.max(0, Math.round((today - then) / DAY_MS)) : null;
}
function isZeroFilledSuspicious(count: number, total: number): boolean { return total > 0 && count >= ZERO_FILLED_MIN_COUNT && count / total >= ZERO_FILLED_RATIO_WARN; }
function zeroWarn(count: number, total: number): string { return `${count}/${total}${isZeroFilledSuspicious(count, total) ? ' ⚠️' : ''}`; }
function zeroSuspectSource(provider: InvestorFlowSample['provider']): ZeroSuspectDetail['source'] {
  if (provider === 'KIS_API') return 'KIS_INVESTOR_TRADE_BY_STOCK_DAILY';
  if (provider === 'KRX_INVESTOR_FLOW') return 'KRX_INVESTOR_FLOW';
  if (provider === 'NAVER_INVESTOR_TREND') return 'NAVER_INVESTOR_TREND';
  if (provider === 'CACHE') return 'CACHE';
  return 'UNKNOWN';
}
function classifyZeroSuspectReason(sample: InvestorFlowSample): ZeroSuspectDetail['reason'] {
  const hasRequiredNetBuyFields = Number.isFinite(sample.foreignNetBuy) && Number.isFinite(sample.institutionalNetBuy);
  const hasOptionalIndividualField = sample.individualNetBuy === undefined || Number.isFinite(sample.individualNetBuy);
  if (sample.provider === 'KIS_API' && hasRequiredNetBuyFields && hasOptionalIndividualField) return 'REAL_ZERO_FIELD';
  if (!hasRequiredNetBuyFields) return 'FALLBACK_ZERO';
  return 'UNKNOWN';
}
function formatZeroSuspectLines(count: number, total: number, details: ZeroSuspectDetail[]): string[] {
  const reasonSet = new Set(details.map((detail) => detail.reason));
  const reason = reasonSet.size === 1 ? [...reasonSet][0] : details.length > 0 ? 'UNKNOWN' : 'UNKNOWN';
  const action = reason === 'REAL_ZERO_FIELD' ? 'none' : reason === 'FALLBACK_ZERO' ? 'block materialization' : 'trace required';
  return [
    'zeroSuspect:',
    `  count=${count}/${total}`,
    `  codes=${details.length > 0 ? details.map((detail) => detail.code).join(',') : 'NONE'}`,
    `  reason=${reason}`,
    `  action=${action}`,
    ...details.slice(0, 3).map((detail) => `  detail code=${detail.code} source=${detail.source} foreignNetBuy=${detail.foreignNetBuy ?? 'N/A'} institutionalNetBuy=${detail.institutionalNetBuy ?? 'N/A'} individualNetBuy=${detail.individualNetBuy ?? 'N/A'} reason=${detail.reason}`),
  ];
}
function formatEokwon(value: number | null | undefined): string {
  if (value === null || value === undefined || !Number.isFinite(value)) return 'N/A';
  if (Math.abs(value) < 0.05) return '0억';
  return `${value > 0 ? '+' : ''}${value.toFixed(0)}억`;
}
function zeroFilledRiskReason(count: number, total: number): string { return `zero-filled 의심 ${count}/${total} — KIS success지만 실데이터 신뢰 불가`; }
function firstTargetCode(targets: WatchlistEntry[]): string | null { return targets[0]?.code ?? null; }
function formatSignedNumeric(value: number | null | undefined, suffix = ''): string {
  if (value === null || value === undefined || !Number.isFinite(value)) return 'N/A';
  return `${value > 0 ? '+' : ''}${value.toLocaleString('ko-KR')}${suffix}`;
}
function formatPctValue(value: number | null | undefined): string {
  if (value === null || value === undefined || !Number.isFinite(value)) return 'N/A';
  return `${value.toFixed(2)}%`;
}
/**
 * Patch-SUPPLY-HEALTH-DEGENERATE-DISPLAY-001: degenerate-zero 컨텍스트 보강 SSOT.
 *
 * `percentChange(latest=0, previous>0)` 가 mathematically `(0 - prev) / |prev| * 100 = -100%` 를
 * 반환하는 정상 동작이지만, 운영자가 "-100%" 를 *데이터 결함* 으로 오인할 수 있음.
 * `latestActual === 0` (또는 |latestActual| < 0.005) 인 degenerate 케이스에서만
 * "(전량 회복)" suffix 를 붙여 명시.
 *
 * - `value === undefined / NaN / Infinity` → 'N/A' (기존 동작 보존)
 * - `value !== -100` (대략) → 기존 `formatPctValue` 와 byte-equivalent
 * - ENV `SUPPLY_HEALTH_DEGENERATE_DISPLAY_DISABLED=true` (default OFF, ADR-0157 정확 비교) → 1줄 즉시 기존 동작 100% 복원
 */
export function formatPctValueWithZeroContext(
  value: number | null | undefined,
  latestActual: number | null | undefined,
): string {
  if (value === null || value === undefined || !Number.isFinite(value)) return 'N/A';
  const base = `${value.toFixed(2)}%`;
  if (process.env.SUPPLY_HEALTH_DEGENERATE_DISPLAY_DISABLED === 'true') return base;
  // -100% 근처 (±0.5%p) AND latestActual 이 0 근처 (절대값 < 0.005%) → degenerate-zero
  const isNearMinusHundred = Math.abs(value + 100) < 0.5;
  const latestIsEffectivelyZero =
    typeof latestActual === 'number' && Number.isFinite(latestActual) && Math.abs(latestActual) < 0.005;
  if (isNearMinusHundred && latestIsEffectivelyZero) {
    return `${base} (latest=0 — 전량 회복)`;
  }
  return base;
}
function compactProviderName(provider: SupplyProvider): string {
  const names: Partial<Record<SupplyProvider, string>> = {
    KIS_API: 'KIS', KRX_INVESTOR_FLOW: 'KRX', KRX_MARKET_PROGRAM: 'KRX', KRX_SHORT_SELLING: 'KRX', KRX_MARGIN_BALANCE: 'KRX',
    NAVER_INVESTOR_TREND: 'NAVER', NAVER_FOREIGNER_RATIO: 'NAVER', NAVER_SHORT_SELLING: 'NAVER', FSS_RECORDS: 'FSS',
    ECOS_API: 'ECOS', FINANCIAL_INVESTMENT_ASSOCIATION: '금투협', CACHE: 'CACHE', MANUAL_BACKFILL: 'BACKFILL',
  };
  return names[provider] ?? provider;
}
function compactProviderRoute(key: SupplySignalKey): string {
  const p = getSupplyProviderPolicy(key);
  const primary = p.primary.map(compactProviderName).join('>') || 'NONE';
  const fallback = p.fallback.length > 0 ? p.fallback.map(compactProviderName).join('>') : 'NONE';
  const diagnostic = p.diagnostic.length > 0 ? p.diagnostic.map(compactProviderName).join('>') : 'NONE';
  return `route: ${primary} | fb=${fallback} | diag=${diagnostic} | scoring=${p.scoringMode}`;
}

function isKrxAutoFetchDisabledForSupplyHealth(): boolean {
  return process.env.KIS_FIRST_REBUILD_MODE === 'true' || process.env.KRX_AUTO_FETCH_DISABLED === 'true';
}

function renderKrxDisabledByKisFirstChannel(key: SupplySignalKey, title: string): ChannelStatus {
  return {
    key,
    title,
    marker: 'NEUTRAL',
    lines: [
      'source: KRX',
      'status: DISABLED_BY_KIS_FIRST_MODE',
      'reason: KIS-first mode; KRX retained for manual diagnostics only',
      'providerIssue=false',
      'marketSignal=false',
      'useForRouter=false',
      'useForGate=false',
      'executionImpact=NONE',
    ],
  };
}

function renderInvestorFlowDecision(marker: Marker): string {
  // ADR-0421 — DATA_UNAVAILABLE / MISSING 시 *명시적* 판정 메시지 (NEUTRAL 폐기).
  //   NEUTRAL 은 본 함수에서 더 이상 반환되지 않음 — classifyInvestorFlowMarker SSOT
  //   가 success=0 + missing>0 시점을 DATA_UNAVAILABLE 로 분류 (사용자 §F/G 정합).
  if (marker === 'OK') return describeInvestorFlowMarker('OK');
  if (marker === 'STALE') return describeInvestorFlowMarker('STALE');
  if (marker === 'DEGRADED') return describeInvestorFlowMarker('DEGRADED');
  if (marker === 'DATA_UNAVAILABLE') return describeInvestorFlowMarker('DATA_UNAVAILABLE');
  if (marker === 'MISSING') return describeInvestorFlowMarker('MISSING');
  // 회귀 호환 — 외부 호출자가 NEUTRAL 명시 시 (test fixture 등) 기존 텍스트 보존.
  return '판정: KRX/NAVER/CACHE 미연결 — KIS는 진단용, 점수 제외';
}
function isAcceptedEmptyRaw(rawDiagLine: string): boolean { return rawDiagLine.includes('rawDiag=MARKET_PROGRAM') && rawDiagLine.includes('zeroReason=ACCEPTED_EMPTY'); }

function bumpProviderCount(counts: Map<SupplyProvider, number>, provider: SupplyProvider | null): void {
  if (!provider) return;
  counts.set(provider, (counts.get(provider) ?? 0) + 1);
}

function formatProviderCounts(counts: Map<SupplyProvider, number>): string {
  if (counts.size === 0) return 'POLICY_ROUTER';
  return [...counts.entries()].map(([provider, count]) => `${provider}:${count}`).join(',');
}

function cacheAgeMs(sample: InvestorFlowSample, nowMs: number): number | null {
  const ts = Date.parse(sample.fetchedAt);
  return Number.isFinite(ts) ? Math.max(0, nowMs - ts) : null;
}

function cacheDate(sample: InvestorFlowSample): string {
  return sample.tradingDate ?? (Number.isFinite(Date.parse(sample.fetchedAt)) ? new Date(sample.fetchedAt).toISOString().slice(0, 10) : 'N/A');
}

function compactReason(reason: string): string {
  const oneLine = reason.replace(/\s+/g, ' ').trim();
  return oneLine.length > ATTEMPT_REASON_MAX_LEN ? `${oneLine.slice(0, ATTEMPT_REASON_MAX_LEN)}...` : oneLine;
}

type SupplyHealthRouterView = {
  status: string;
  selectedProvider: string;
  selectedReason?: string | null;
  providerTried: string[];
  providerStatuses?: Record<string, string>;
  signal: string;
  coverage: {
    available: number;
    total: number;
  };
  executionImpact: 'NONE';
  liveExecutionAllowed: false;
};

function routerViewForSupplyHealth(router: InvestorFlowProviderRouteResult | null | undefined): SupplyHealthRouterView | null {
  if (!router) return null;
  return {
    status: router.status,
    selectedProvider: router.selectedProvider,
    selectedReason: router.selectedReason,
    providerTried: [...router.providerTried],
    providerStatuses: { ...router.providerStatuses },
    signal: router.signal,
    coverage: {
      available: router.coverage.available,
      total: router.coverage.total,
    },
    executionImpact: router.executionImpact,
    liveExecutionAllowed: router.liveExecutionAllowed,
  };
}

function firstRouterDiagnosticValue(router: InvestorFlowProviderRouteResult, key: string): string | null {
  for (const diagnostic of router.diagnostics) {
    const match = new RegExp(`${key}=([^;\\s]+)`).exec(diagnostic);
    if (match?.[1]) return match[1];
  }
  return null;
}

function compactRouterReason(reason: string | undefined): string {
  if (!reason) return '';
  return compactReason(reason.replace(/\.$/, ''));
}

function normalizeRouterProviderStatus(
  status: RouterInvestorFlowProviderStatus | string | undefined,
): string | null {
  if (!status || status === 'UNKNOWN') return null;
  return status;
}

function providerStatusWithReason(provider: string, status: string, reason?: string): string {
  const compact = compactRouterReason(reason);
  return `${provider}:${status}${compact ? `(${compact})` : ''}`;
}

function isKisFirstRebuildModeForSupplyHealth(): boolean {
  return process.env.KIS_FIRST_REBUILD_MODE === 'true' || isKisOnlyRebuildMode();
}

function semanticNetBuyVerifiedStatus(status: string | undefined): boolean {
  return status === 'VERIFIED' || status === 'READY_FOR_SHADOW' || status === 'OK';
}

export function formatRouterAwareInvestorFlowAttemptSummary(router: InvestorFlowProviderRouteResult | null | undefined): string | null {
  if (!router) return null;
  const statuses = router.providerStatuses;
  const parts: string[] = [];
  const kisStatus = normalizeRouterProviderStatus(statuses.KIS ?? statuses.KIS_API);
  if (kisStatus) {
    parts.push(providerStatusWithReason('KIS_API', kisStatus, router.providerReasons.KIS ?? router.providerReasons.KIS_API));
  }
  const krxStatus = normalizeRouterProviderStatus(statuses.KRX ?? statuses.KRX_INVESTOR_FLOW);
  if (krxStatus) {
    parts.push(providerStatusWithReason('KRX_INVESTOR_FLOW', krxStatus, router.providerReasons.KRX ?? router.providerReasons.KRX_INVESTOR_FLOW));
  }
  const naverStatus = normalizeRouterProviderStatus(statuses.NAVER_INVESTOR_TREND ?? statuses.NAVER);
  if (naverStatus) {
    parts.push(providerStatusWithReason('NAVER_INVESTOR_TREND', naverStatus, router.providerReasons.NAVER_INVESTOR_TREND ?? router.providerReasons.NAVER));
  }
  const semanticStatus = normalizeRouterProviderStatus(statuses.SEMANTIC_NETBUY);
  if (semanticStatus) {
    const semanticDisplay = semanticStatus === 'DATA_UNAVAILABLE'
      ? 'DATA_UNAVAILABLE(NO_INPUT_SAMPLE)'
      : semanticStatus;
    parts.push(providerStatusWithReason('SEMANTIC_NETBUY', semanticDisplay, router.providerReasons.SEMANTIC_NETBUY));
  }
  const cacheLookupResult = firstRouterDiagnosticValue(router, 'cacheLookupResult');
  const cacheStatus = normalizeRouterProviderStatus(statuses.CACHE) ?? cacheLookupResult;
  if (cacheStatus) {
    parts.push(providerStatusWithReason('CACHE', cacheStatus, router.providerReasons.CACHE));
  }
  if (parts.length === 0) return null;
  parts.push(`selectedProvider=${router.selectedProvider}`);
  if (router.selectedProvider === 'CACHE' && cacheStatus && cacheStatus !== 'CACHE_EMPTY') {
    parts.push('CACHE selected');
  }
  if (router.selectedReason) parts.push(`selectedReason=${compactReason(router.selectedReason)}`);
  return parts.join(' / ');
}

function formatKisFirstInvestorFlowProviderTriedLines(
  router: InvestorFlowProviderRouteResult | null | undefined,
  success: number,
  total: number,
  sourceCounts: Map<SupplyProvider, number>,
): string[] {
  const kisSuccess = sourceCounts.get('KIS_API') ?? 0;
  const semanticStatus = router?.providerStatuses.SEMANTIC_NETBUY;
  const kisVerified = total > 0
    && success === total
    && kisSuccess === total
    && (!router || router.selectedProvider === 'KIS_API')
    && (!router || semanticNetBuyVerifiedStatus(semanticStatus));
  if (!isKisFirstRebuildModeForSupplyHealth() || !kisVerified) return [];
  return [
    'providerTried:',
    `  KIS_API:OK endpoint=KIS_INVESTOR_TRADE_BY_STOCK_DAILY confidence=VERIFIED materialized=${success}/${total}`,
    '  KRX:DISABLED_BY_KIS_FIRST_MODE diagnosticOnly=true',
    '  NAVER:DIAGNOSTIC_ONLY',
    '  CACHE:FALLBACK_DISABLED_KIS_VERIFIED',
  ];
}

function formatSupplyConfluenceLines(router: InvestorFlowProviderRouteResult | null | undefined, success: number): string[] {
  if (!router || router.signal === 'UNKNOWN') return [];
  const dataStatus = success > 0 ? 'OK' : 'DATA_UNAVAILABLE';
  const providerIssue = dataStatus === 'OK' ? false : router.status !== 'VERIFIED';
  const lines = [
    'supply_confluence:',
    `  signal=${router.signal}`,
    `  dataStatus=${dataStatus}`,
    `  providerIssue=${providerIssue}`,
  ];
  if (router.signal === 'BEARISH' && dataStatus === 'OK') {
    lines.push(
      '  interpretation=actual KIS verified flow is bearish, not provider failure',
      '  executionImpact=NONE',
      '  BEARISH는 데이터 장애가 아니라 KIS 실데이터 기반 약세 수급 신호입니다.',
      '  일반 BUY는 최종 Gate 정책에 따르며, STRONG_BUY는 별도 제한될 수 있습니다.',
    );
  } else {
    lines.push('  executionImpact=NONE');
  }
  return lines;
}

async function diagnoseInvestorFlow(targets: WatchlistEntry[], now: Date, nowMs: number): Promise<ChannelStatus> {
  let success = 0, zero = 0;
  const zeroDetails: ZeroSuspectDetail[] = [];
  const attemptSummaries: string[] = [];
  let providerHealthSummary: string | null = null;
  const router = getLastScanSummary()?.investorFlowProviderRouter ?? null;
  const routerSummary = formatRouterAwareInvestorFlowAttemptSummary(router);
  const routerView = routerViewForSupplyHealth(router);
  if (routerSummary) {
    attemptSummaries.push(`${router?.code ?? firstTargetCode(targets) ?? 'UNKNOWN'}:${routerSummary}`);
  }
  const sourceCounts = new Map<SupplyProvider, number>();
  const cacheSamples: InvestorFlowSample[] = [];
  for (const stock of targets) {
    const routed = await fetchInvestorFlowWithPolicy(stock.code, now, { krxAutoFetchDisabled: isKrxAutoFetchDisabledForSupplyHealth() });
    if (attemptSummaries.length < 3 && !routerSummary) attemptSummaries.push(`${stock.code}:${summarizeInvestorFlowAttempts(routed.attempts)}`);
    if (!providerHealthSummary) providerHealthSummary = summarizeInvestorFlowProviderHealth(routed.health, routerView);
    if (!routed.data) continue;
    success++;
    bumpProviderCount(sourceCounts, routed.source);
    if (routed.source === 'CACHE') cacheSamples.push(routed.data);
    if (routed.data.foreignNetBuy + routed.data.institutionalNetBuy === 0) {
      zero++;
      zeroDetails.push({
        code: stock.code,
        source: zeroSuspectSource(routed.data.provider),
        foreignNetBuy: Number.isFinite(routed.data.foreignNetBuy) ? routed.data.foreignNetBuy : null,
        institutionalNetBuy: Number.isFinite(routed.data.institutionalNetBuy) ? routed.data.institutionalNetBuy : null,
        individualNetBuy: Number.isFinite(routed.data.individualNetBuy) ? routed.data.individualNetBuy! : null,
        reason: classifyZeroSuspectReason(routed.data),
      });
    }
  }
  const total = targets.length;
  const missing = Math.max(0, total - success);
  const zeroSuspicious = isZeroFilledSuspicious(zero, total);
  const cacheAges = cacheSamples.map((sample) => cacheAgeMs(sample, nowMs)).filter((age): age is number => age !== null);
  const staleCache = cacheAges.filter((age) => age > INVESTOR_FLOW_CACHE_STALE_DAYS * DAY_MS).length;
  const oldestCacheAge = cacheAges.length > 0 ? Math.max(...cacheAges) : null;
  const cacheDates = [...new Set(cacheSamples.map(cacheDate))].filter((v) => v !== 'N/A');
  const partial = total > 0 && success > 0 && success < total;
  // ADR-0421 — classifyInvestorFlowMarker SSOT 위임. success=0 + missing>0 시점은
  //   DATA_UNAVAILABLE (NEUTRAL 절대 금지, 사용자 명시 핵심 불변식 #2).
  const marker: Marker = classifyInvestorFlowMarker({
    total,
    success,
    missing,
    zeroSuspicious,
    staleCacheCount: staleCache,
  });
  // ADR-0421 — DATA_UNAVAILABLE 시 명시적 reason 추가 (success=0 + missing>0 영역).
  const riskReason = marker === 'DATA_UNAVAILABLE'
    ? `scoring-eligible investor flow semantic fields unavailable (success ${success}/${total})`
    : zeroSuspicious
      ? zeroFilledRiskReason(zero, total)
      : partial
        ? `coverage ${success}/${total}`
        : staleCache > 0
          ? `CACHE stale ${staleCache}/${cacheSamples.length}, oldest ${formatAgo(oldestCacheAge)}`
          : undefined;
  const kisVerified = total > 0
    && sourceCounts.get('KIS_API') === total
    && success === total
    && (!router || router.selectedProvider === 'KIS_API')
    && (!router || semanticNetBuyVerifiedStatus(router.providerStatuses.SEMANTIC_NETBUY));
  const kisFirstProviderTriedLines = formatKisFirstInvestorFlowProviderTriedLines(router, success, total, sourceCounts);
  return {
    key: 'investorFlow', title: '기관/외인 수급', marker,
    riskReason,
    zeroSuspect: { count: zero, total, details: zeroDetails },
    lines: [
      `source: ${formatProviderCounts(sourceCounts)}`,
      `status: ${marker}`,
      `success: ${success}/${total}`,
      `missing: ${missing}`,
      `stale: ${staleCache}`,
      `cache: ${cacheSamples.length}/${total}${oldestCacheAge !== null ? `, oldest=${formatAgo(oldestCacheAge)}` : ''}${cacheDates.length > 0 ? `, dates=${cacheDates.join(',')}` : ''}`,
      `zero-filled 의심: ${zeroWarn(zero, total)}`,
      ...formatZeroSuspectLines(zero, total, zeroDetails),
      ...(kisFirstProviderTriedLines.length > 0 ? kisFirstProviderTriedLines : [`providerTried: ${attemptSummaries[0] ?? 'N/A'}`]),
      ...(providerHealthSummary ? providerHealthSummary.split('\n').map((line) => `providerHealth: ${line}`) : []),
      ...formatSupplyConfluenceLines(router, success),
      renderInvestorFlowDecision(marker),
      ...(kisVerified
        ? ['fallback: disabled because KIS verified sample is available', 'legacyProviders: KRX/NAVER/CACHE diagnostic-only', 'KRX role=MANUAL_VALIDATION_ONLY']
        : isKrxAutoFetchDisabledForSupplyHealth()
          ? ['fallback: disabled by KIS-first mode until KIS verified sample is available', 'legacyProviders: KRX/NAVER/CACHE diagnostic-only', 'KRX role=MANUAL_VALIDATION_ONLY']
          : ['대체: KRX / NAVER / CACHE']),
      '상세: /investor_flow 예정',
    ],
  };
}

function stockProgramLamp(success: number, total: number, zeroSuspicious: boolean): { marker: Marker; status: 'OK' | 'PARTIAL' | 'DEGRADED'; lamp: 'GREEN' | 'AMBER' | 'RED' } {
  if (total > 0 && success === total && !zeroSuspicious) return { marker: 'OK', status: 'OK', lamp: 'GREEN' };
  if (success >= 8) return { marker: 'DEGRADED', status: 'PARTIAL', lamp: 'AMBER' };
  return { marker: 'MISSING', status: 'DEGRADED', lamp: 'RED' };
}

async function diagnoseStockProgram(targets: WatchlistEntry[], nowMs = Date.now()): Promise<ChannelStatus> {
  if (!isProgramTradingIntradaySession(nowMs)) {
    return buildProgramTradingSessionClosedStatus('STOCK', targets.length > 0 ? 'KIS_API' : 'NONE', nowMs);
  }
  let success = 0, zero = 0;
  for (const stock of targets) {
    try { const data = await fetchKisStockProgramTrade(stock.code, 'MEDIUM'); if (!data) continue; success++; if (data.programNetBuyAmount === 0) zero++; } catch {}
  }
  const total = targets.length, missing = Math.max(0, total - success);
  const zeroSuspicious = isZeroFilledSuspicious(zero, total);
  const lamp = stockProgramLamp(success, total, zeroSuspicious);
  const rawDiagLine = zeroSuspicious && firstTargetCode(targets) ? formatKisRawSupplyDiagnostic(await diagnoseKisStockProgramRaw(firstTargetCode(targets) as string, 'MEDIUM')) : null;
  return {
    key: 'stockProgram', title: '종목 프로그램매매', marker: lamp.marker,
    riskReason: lamp.status === 'DEGRADED' ? '조회 성공 5건 미만' : zeroSuspicious ? zeroFilledRiskReason(zero, total) : missing > 0 ? `missing ${missing}` : undefined,
    zeroSuspect: { count: zero, total },
    lines: [
      'source: KIS_API',
      `status: ${lamp.status}`,
      `lamp: ${lamp.lamp}`,
      `success: ${success}/${total}`,
      `missing: ${missing}`,
      `zero-filled 의심: ${zeroWarn(zero, total)}`,
      'scoring=allowed_when_non_empty',
      'providerIssue=false',
      'executionImpact=NONE',
      lamp.status === 'OK' ? '판정: OK' : lamp.status === 'PARTIAL' ? '판정: PARTIAL — KIS stock program usable for non-empty symbols' : '판정: DEGRADED — 프로그램 수급 coverage/zero-filled 확인 필요',
      ...(rawDiagLine ? [rawDiagLine] : []),
      '상세: /program_today',
    ],
  };
}

// Patch-PROGRAM-MARKET-EMPTY-OUTPUT-ROUTER-004: routed marker SSOT mapping.
// Patch-006 격상: V2 routedStatus (PARTIAL_VERIFIED / UNSUPPORTED_INTRADAY / 3-tier cache) 분기 추가.
function markerForRoutedStatus(decision: ProgramMarketRoutingDecision | ProgramMarketRoutingDecisionV2): Marker {
  switch (decision.routedStatus) {
    case 'VERIFIED': return 'OK';
    case 'PARTIAL_VERIFIED': return 'STALE'; // Patch-006: KOSPI 또는 KOSDAQ 만 회복
    case 'STALE_CACHE': return 'STALE';
    case 'STALE_CACHE_BUT_USABLE_FOR_DIAG': return 'STALE'; // Patch-006: ≤5min
    case 'STALE_CACHE_SHADOW_ONLY': return 'STALE'; // Patch-006: 5-30min
    case 'CACHE_EXPIRED': return 'MISSING'; // Patch-006: >30min (excluded)
    case 'DEGRADED': return 'DEGRADED';
    case 'SESSION_CLOSED':
    case 'SESSION_CLOSED_NOT_APPLICABLE':
    case 'UNSUPPORTED':
    case 'UNSUPPORTED_INTRADAY': // Patch-006: KRX 장중 미지원
    case 'PARAM_MISMATCH': return 'NEUTRAL';
    case 'EMPTY_VALID':
    case 'MISSING':
    default: return 'NEUTRAL';
  }
}

function renderRoutedMarketProgram(decision: ProgramMarketRoutingDecision | ProgramMarketRoutingDecisionV2): ChannelStatus {
  const marker = markerForRoutedStatus(decision);
  // Patch-006: V2 decision 인 경우 V2 formatter 사용 (KRX aggregate / cacheTtl / intraday 노출).
  const lines = isV2Decision(decision)
    ? formatProgramMarketRoutedV2(decision)
    : formatProgramMarketRouted(decision);
  // Patch-SUPPLY-HEALTH-DEGENERATE-DISPLAY-001 — UNSUPPORTED_INTRADAY 표시 정직성 격상.
  //
  // 사용자 지적 (2026-05-15): "시장프로그램 데이터가 정상적으로 안들어오고 있는거 아니야?" — 정확한 진단.
  //
  // Patch-006 가정: "KRX 시장 프로그램매매 endpoint 가 EOD-only 라 장중에는 미제공" → UNSUPPORTED_INTRADAY 분류.
  // 실제 코드: `KRX_BLD_MARKET_PROGRAM_TRADE = MDCSTAT01701` 만 호출 (EOD-only daily aggregate).
  // 진실: KRX 는 별도 intraday endpoint (예: MDCSTAT00301 일중 프로그램매매 추이) 가 존재할 가능성이 높지만
  //       Patch-006 가 wiring 하지 않았음. → "UNSUPPORTED_INTRADAY" 는 *데이터 wiring 결손* 이지
  //       "KRX 자체의 장중 미지원" 이 아닐 수 있음.
  //
  // 따라서 "정상 동작" 이라고 주장하지 않음. 정직한 "endpoint wiring 결손" 안내 + 후속 PR 의무 명시.
  // ENV `SUPPLY_HEALTH_DEGENERATE_DISPLAY_DISABLED=true` (default OFF, ADR-0157) 1줄로 즉시 기존 동작 복원.
  const isIntradayUnsupported =
    isV2Decision(decision) && decision.routedStatus === 'UNSUPPORTED_INTRADAY' && decision.isIntradaySession === true;
  if (isIntradayUnsupported && process.env.SUPPLY_HEALTH_DEGENERATE_DISPLAY_DISABLED !== 'true') {
    // Patch-KRX-INTRADAY-MARKET-PROGRAM-WIRING-001: intraday endpoint wiring 활성화 여부 분기.
    const v2 = decision as ProgramMarketRoutingDecisionV2;
    if (v2.intradayWiringAttempted === true) {
      lines.push('주의: KRX EOD + intraday endpoint 모두 empty (intraday endpoint shape/BLD ID 미검증 가능성)');
      lines.push('후속: KRX_BLD_MARKET_PROGRAM_INTRADAY ENV 로 BLD ID override + 응답 shape 검증 필요');
    } else {
      lines.push('주의: KRX intraday endpoint 미연동 — 현재 EOD-only (MDCSTAT01701) 만 호출 중');
      lines.push('후속: ENV `KRX_INTRADAY_MARKET_PROGRAM_ENABLED=true` 로 intraday endpoint wiring 활성화 (default OFF — endpoint shape 검증 의무)');
    }
  }
  // routedStatus + decisionDetail invariants 가 모든 분기에 노출됨.
  return {
    key: 'marketProgram',
    title: '시장 프로그램매매',
    marker,
    // UNSUPPORTED_INTRADAY 는 정상 동작이므로 riskReason 노출 안 함 (NEUTRAL marker 유지하되 risk reason 는 비표시).
    riskReason:
      marker === 'NEUTRAL' && decision.routedStatus !== 'EMPTY_VALID' && !isIntradayUnsupported
        ? decision.routedStatus
        : undefined,
    lines,
  };
}

function isV2Decision(d: ProgramMarketRoutingDecision | ProgramMarketRoutingDecisionV2): d is ProgramMarketRoutingDecisionV2 {
  return 'patch006Activated' in d;
}

async function diagnoseMarketProgram(macro: MacroState | null, nowMs: number): Promise<ChannelStatus> {
  if (!isProgramTradingIntradaySession(nowMs)) {
    return buildProgramTradingSessionClosedStatus('MARKET', macro?.programSource === 'KIS_API' ? 'KIS_API' : 'NONE', nowMs);
  }
  const rawDiag = await diagnoseKisMarketProgramRaw('HIGH');
  const rawDiagLine = formatKisRawSupplyDiagnostic(rawDiag);
  // Patch-006: KIS ACCEPTED_EMPTY → 실제 KRX aggregate 호출 + 3-tier CACHE TTL + intraday session 분류.
  if (isAcceptedEmptyRaw(rawDiagLine)) {
    const cacheFallback = deriveCacheFallbackFromMacroState(macro, nowMs);
    const input = {
      rawDiag: {
        zeroReason: rawDiag.zeroReason ?? undefined,
        outputLength: rawDiag.outputKeys?.length ?? 0,
        outputKeys: rawDiag.outputKeys,
        trId: rawDiag.trId,
        endpoint: rawDiag.path,
        marketCode: MARKET_PROGRAM_INDEX_CODE,
      },
      cacheFallback,
    };
    // Patch-006: ENV disabled → Patch-004 직접 위임 (V1 동작 100% 보존).
    if (isPatch006Disabled()) {
      const decisionV1 = routeProgramMarketEmpty(input);
      return renderRoutedMarketProgram(decisionV1);
    }
    const decisionV2 = await routeProgramMarketEmptyWithKrxAggregate(input, { nowMs });
    return renderRoutedMarketProgram(decisionV2);
  }
  const macroAge = elapsedMs(macro?.programFetchedAt, nowMs);
  if (macro?.programSource === 'KIS_API' && macro.programNetBuyAmount !== undefined && macroAge !== null && macroAge <= KIS_STALE_MS) {
    return { key: 'marketProgram', title: '시장 프로그램매매', marker: 'OK', lines: ['source: KIS_API', `latest: ${formatEokwon(macro.programNetBuyAmount)}`, `updated: ${formatAgo(macroAge)}`, rawDiagLine, '상세: /program_market'] };
  }
  try {
    const live = await fetchKisMarketProgramTrade('MEDIUM');
    if (live && live.programNetBuyAmount !== null) {
      const status = live.marketProgramStatus ?? (live.programNetBuyAmount === 0 ? 'OK_RAW_ZERO' : 'OK_NONZERO');
      const neutral = status !== 'OK_NONZERO';
      return {
        key: 'marketProgram',
        title: '시장 프로그램매매',
        marker: neutral ? 'NEUTRAL' : 'OK',
        lines: [
          'source: KIS_API',
          `status: ${status}`,
          `latest: ${live.latest ?? formatEokwon(live.programNetBuyAmount / 100_000_000)}`,
          `updated: ${live.updated ?? '0s ago'}`,
          `selectedNetBuy: ${formatEokwon(live.programNetBuyAmount / 100_000_000)}`,
          `selectedReason: ${live.selectedReason ?? 'N/A'}`,
          `nonZeroRows: ${live.nonZeroRowCount ?? 0}/${live.rowCount ?? 0}`,
          live.zeroReason ? `zeroReason: ${live.zeroReason}` : '',
          `providerIssue=${live.providerIssue ?? false}`,
          `executionImpact=${live.executionImpact ?? 'NONE'}`,
          `판정: ${neutral ? 'observe / scoring excluded' : 'usable'}`,
          rawDiagLine,
          '상세: /program_market',
        ].filter(Boolean),
      };
    }
  } catch {}
  if (macro?.programSource === 'KIS_API' && macro.programNetBuyAmount !== undefined) {
    const stale = macroAge !== null && macroAge > KIS_STALE_MS;
    return { key: 'marketProgram', title: '시장 프로그램매매', marker: stale ? 'STALE' : 'MISSING', riskReason: stale ? `updated ${formatAgo(macroAge)}` : 'updatedAt 없음', lines: ['source: KIS_API', `latest: ${formatEokwon(macro.programNetBuyAmount)}`, `updated: ${formatAgo(macroAge)}`, rawDiagLine, '상세: /program_market'] };
  }
  return { key: 'marketProgram', title: '시장 프로그램매매', marker: 'MISSING', riskReason: 'KIS/macroState 결손', lines: ['source: KIS_API', 'latest: N/A', 'updated: N/A', rawDiagLine, '상세: /program_market'] };
}

function diagnoseFss(macro: MacroState | null, nowMs: number, kisPack: KisOfficialSupplyPack | null): ChannelStatus {
  const marketSupply = kisPack?.marketSupply;
  const foreignInstitution = kisPack?.foreignInstitutionTotal;
  if (marketSupply || foreignInstitution) {
    const age = elapsedMs(kisPack?.fetchedAt, nowMs);
    return {
      key: 'fssPassiveActive',
      title: 'FSS Passive/Active',
      marker: marketSupply ? 'OK' : 'DEGRADED',
      riskReason: marketSupply ? undefined : 'KIS foreign/institution aggregate only; FSS passive/active split unavailable',
      lines: [
        'source: KIS_API',
        `status: ${marketSupply ? 'KIS_MARKET_SUPPLY' : 'KIS_FOREIGN_INSTITUTION_TOTAL'}`,
        'passiveActiveBoth: N/A',
        `foreignNetBuy: ${formatSignedNumeric(marketSupply?.foreignNetBuy ?? foreignInstitution?.foreignNetBuy)}`,
        `institutionNetBuy: ${formatSignedNumeric(marketSupply?.institutionNetBuy ?? foreignInstitution?.institutionalNetBuy)}`,
        `confidence: ${marketSupply?.confidence ?? foreignInstitution?.confidence ?? 'ESTIMATED'}`,
        `updated: ${formatAgo(age)}`,
        'via: KIS Official Supply Pack',
        'note: FSS passive/active split unavailable; KIS official flow is used for shadow diagnostics.',
        'detail: /fss_status',
      ],
    };
  }
  const rows = loadFssRecordsReadOnly().sort((a, b) => a.date.localeCompare(b.date));
  if (rows.length === 0) {
    return { key: 'fssPassiveActive', title: 'FSS Passive/Active', marker: 'NEUTRAL', lines: ['source: FSS_RECORDS', 'status: COLLECTION_EMPTY', `passiveActiveBoth: ${macro?.passiveActiveBoth === undefined ? 'N/A' : String(macro.passiveActiveBoth)}`, 'updated: N/A', '판정: FSS 레코드 미누적 — 점수 제외', '수집: fssRecords / macroState wiring / backfill', '상세: /fss_status'] };
  }
  const latest = rows[rows.length - 1].date;
  const days = elapsedDays(latest, nowMs);
  const marker: Marker = days !== null && days > FSS_STALE_DAYS ? 'STALE' : 'OK';
  return { key: 'fssPassiveActive', title: 'FSS Passive/Active', marker, riskReason: marker === 'STALE' ? `${days}영업일 stale` : undefined, lines: [`status: ${marker}`, `passiveActiveBoth: ${macro?.passiveActiveBoth === undefined ? 'N/A' : String(macro.passiveActiveBoth)}`, `updated: ${days === null ? 'N/A' : `${days}영업일 전`}`, '상세: /fss_status'] };
}

function renderShortStatus(source: MacroState['shortSellingSource'], ratio: number, fetchedAt: string | undefined, nowMs: number, via: 'macroState' | 'liveProbe'): ChannelStatus {
  const age = elapsedMs(fetchedAt, nowMs);
  const ageStale = age !== null && age > SHORT_STALE_DAYS * DAY_MS;
  const sourceStale = source === 'KIS_ESTIMATE';
  const stale = ageStale || sourceStale;
  return { key: 'shortSelling', title: '공매도/대차잔고', marker: stale ? 'STALE' : 'OK', riskReason: sourceStale ? 'KIS_ESTIMATE — KRX 폴백 실패, 정확도 ↓' : ageStale ? `updated ${formatAgo(age)}` : undefined, lines: [`source: ${source}`, `ratio: ${ratio.toFixed(2)}%`, `updated: ${formatAgo(age)}`, `via: ${via}`, '상세: /short_status 예정'] };
}
async function diagnoseShort(macro: MacroState | null, nowMs: number, kisPack: KisOfficialSupplyPack | null): Promise<ChannelStatus> {
  if (kisPack?.shortSelling || kisPack?.loanTransaction) {
    const age = elapsedMs(kisPack.fetchedAt, nowMs);
    const partial = !kisPack.shortSelling || !kisPack.loanTransaction;
    return {
      key: 'shortSelling',
      title: '공매도/대차잔고',
      marker: partial ? 'DEGRADED' : 'OK',
      riskReason: partial ? 'KIS short/loan partial coverage' : undefined,
      lines: [
        'source: KIS_API',
        `shortRatio: ${formatPctValue(kisPack.shortSelling?.shortSaleRatio)}`,
        `shortTrend: ${kisPack.shortSelling?.trend ?? 'DATA_UNAVAILABLE'}`,
        // Patch-SUPPLY-HEALTH-DEGENERATE-DISPLAY-001 — shortRatio=0 + shortIncreaseRate=-100% 는
        // mathematically 정확하지만 운영자가 데이터 결함으로 오인 가능. (전량 회복) suffix 명시.
        `shortIncreaseRate: ${formatPctValueWithZeroContext(kisPack.shortSelling?.shortSaleIncreaseRate, kisPack.shortSelling?.shortSaleRatio)}`,
        `loanTrend: ${kisPack.loanTransaction?.trend ?? 'DATA_UNAVAILABLE'}`,
        `loanIncreaseRate: ${formatPctValue(kisPack.loanTransaction?.loanIncreaseRate)}`,
        `confidence: ${kisPack.shortSelling?.confidence ?? kisPack.loanTransaction?.confidence ?? 'MISSING'}`,
        `updated: ${formatAgo(age)}`,
        'via: KIS Official Supply Pack',
        'marketSignal=false',
        'executionImpact=NONE',
        'detail: /short_status',
      ],
    };
  }
  if (macro?.shortSellingSource && macro.shortSellingRatio !== undefined) return renderShortStatus(macro.shortSellingSource, macro.shortSellingRatio, macro.shortSellingFetchedAt, nowMs, 'macroState');
  if (isKrxAutoFetchDisabledForSupplyHealth()) {
    const disabled = renderKrxDisabledByKisFirstChannel('shortSelling', '공매도/대차잔고');
    disabled.lines.push('ratio: N/A', 'updated: N/A', '상세: /short_status 예정');
    return disabled;
  }
  try { const live = await fetchKrxShortSelling(); if (live) { const status = renderShortStatus(live.source, live.ratio, live.fetchedAt, nowMs, 'liveProbe'); status.lines.push('판정: macroState 결손이나 live probe 성공 — refresh wiring 필요'); return status; } } catch {}
  return { key: 'shortSelling', title: '공매도/대차잔고', marker: 'NEUTRAL', lines: ['source: N/A', 'status: PROVIDER_UNAVAILABLE', 'ratio: N/A', 'updated: N/A', '판정: 사용 가능한 provider 없음 — 점수 제외', '대체: KRX / KIND CSV·OTP / NAVER / 공공데이터', '상세: /short_status 예정'] };
}

function diagnoseForeignerRatio(targets: WatchlistEntry[], nowMs: number, kisPack: KisOfficialSupplyPack | null): ChannelStatus {
  const marketSupply = kisPack?.marketSupply;
  const foreignInstitution = kisPack?.foreignInstitutionTotal;
  const estimate = kisPack?.investorFlowEstimate;
  if (marketSupply || foreignInstitution || estimate?.confidence === 'ESTIMATED') {
    const age = elapsedMs(kisPack?.fetchedAt, nowMs);
    return {
      key: 'foreignerRatioTrend',
      title: '외인 보유율 추세',
      marker: marketSupply || foreignInstitution ? 'OK' : 'DEGRADED',
      riskReason: marketSupply || foreignInstitution ? undefined : 'KIS intraday estimate only',
      lines: [
        'source: KIS_API',
        'series: KIS_FLOW_PROXY',
        'stale: 0',
        `foreignNetBuy: ${formatSignedNumeric(marketSupply?.foreignNetBuy ?? foreignInstitution?.foreignNetBuy ?? estimate?.foreignNetBuyEstimate)}`,
        `confidence: ${marketSupply?.confidence ?? foreignInstitution?.confidence ?? estimate?.confidence ?? 'ESTIMATED'}`,
        `updated: ${formatAgo(age)}`,
        'via: KIS Official Supply Pack',
        'note: NAVER holding-ratio series unavailable; KIS official foreign flow proxy is used for diagnostics.',
        'detail: /foreigner_trend',
      ],
    };
  }
  let seriesCount = 0, stale = 0;
  for (const stock of targets) {
    const series = loadForeignerRatioSeries(stock.code); if (series.length === 0) continue;
    seriesCount++; const days = elapsedDays(series[series.length - 1]?.date, nowMs); if (days !== null && days > TWO_DAYS) stale++;
  }
  const total = targets.length;
  if (total > 0 && seriesCount === 0) return { key: 'foreignerRatioTrend', title: '외인 보유율 추세', marker: 'NEUTRAL', lines: ['source: NAVER', 'status: COLLECTION_EMPTY', `series: ${seriesCount}/${total}`, `stale: ${stale}`, '판정: 시계열 미누적 — 점수 제외', '수집: aiUniverseService / negative cache 해제 / warm-up', '상세: /foreigner_trend'] };
  const partial = total > 0 && seriesCount > 0 && seriesCount < total;
  const marker: Marker = total === 0 ? 'MISSING' : stale > 0 ? 'STALE' : partial ? 'DEGRADED' : 'OK';
  return { key: 'foreignerRatioTrend', title: '외인 보유율 추세', marker, riskReason: marker === 'STALE' ? `stale ${stale}/${seriesCount}` : marker === 'DEGRADED' ? `coverage ${seriesCount}/${total}` : marker === 'MISSING' ? 'watchlist 없음' : undefined, lines: ['source: NAVER', `series: ${seriesCount}/${total}`, `stale: ${stale}`, '상세: /foreigner_trend'] };
}

function diagnoseMargin(macro: MacroState | null, nowMs: number, kisPack: KisOfficialSupplyPack | null): ChannelStatus {
  if (kisPack?.creditBalance) {
    const age = elapsedMs(kisPack.fetchedAt, nowMs);
    return {
      key: 'marginBalance',
      title: '신용잔고',
      marker: 'OK',
      lines: [
        'source: KIS_API',
        `change5d: ${formatPctValue(kisPack.creditBalance.creditIncreaseRate)}`,
        `balanceQty: ${formatSignedNumeric(kisPack.creditBalance.creditBalanceQty)}`,
        `balanceAmount: ${formatSignedNumeric(kisPack.creditBalance.creditBalanceAmount)}`,
        `trend: ${kisPack.creditBalance.trend ?? 'UNKNOWN'}`,
        `confidence: ${kisPack.creditBalance.confidence}`,
        `updated: ${formatAgo(age)}`,
        'via: KIS Official Supply Pack',
        'marketSignal=false',
        'executionImpact=NONE',
        'detail: /margin_balance',
      ],
    };
  }
  if (!macro?.marginBalanceSource || macro.marginBalance5dChange === undefined) {
    return { key: 'marginBalance', title: '신용잔고', marker: 'NEUTRAL', lines: ['source: ECOS', 'status: PROVIDER_UNAVAILABLE', 'updated: N/A', 'reason: macroState 결손', '판정: provider/wiring 미확정 — 점수 제외', '대체: KRX / 금투협 / ECOS 재시도 / CACHE', '상세: /margin_balance'] };
  }
  const age = elapsedMs(macro.marginBalanceFetchedAt, nowMs);
  const stale = age !== null && age > TWO_DAYS * DAY_MS;
  return { key: 'marginBalance', title: '신용잔고', marker: stale ? 'STALE' : 'OK', riskReason: stale ? `updated ${formatAgo(age)}` : undefined, lines: [`source: ${macro.marginBalanceSource}`, `change5d: ${macro.marginBalance5dChange.toFixed(2)}%`, `updated: ${formatAgo(age)}`, 'via: macroState', '상세: /margin_balance'] };
}

async function loadKisOfficialSupplyPackForSupplyHealth(targets: WatchlistEntry[]): Promise<KisOfficialSupplyPackLoad> {
  const code = firstTargetCode(targets);
  if (!code) return { code: null, pack: null, enemy: null };
  try {
    const { evaluateKisSupplyEnemyChecklist, fetchKisOfficialSupplyPack } = await import('../../../supply/kisOfficialSupplyPack.js');
    const pack = await fetchKisOfficialSupplyPack(code);
    return { code, pack, enemy: evaluateKisSupplyEnemyChecklist(pack) };
  } catch (err) {
    return {
      code,
      pack: null,
      enemy: null,
      error: err instanceof Error ? err.message.split('\n')[0] : String(err),
    };
  }
}

function diagnoseLoadedKisOfficialSupplyPack(load: KisOfficialSupplyPackLoad): ChannelStatus {
  if (!load.code) {
    return {
      key: 'marketSupply',
      title: 'KIS Official Supply Pack',
      marker: 'N/A',
      lines: ['source: KIS_API', 'status: NO_TARGET', 'executionImpact=NONE'],
    };
  }
  const pack = load.pack;
  if (!pack) {
    return {
      key: 'marketSupply',
      title: 'KIS Official Supply Pack',
      marker: 'NEUTRAL',
      riskReason: 'KIS supply pack unavailable',
      lines: [
        'source: KIS_API',
        'officialSource=true',
        `target: ${load.code}`,
        'status: PROVIDER_UNAVAILABLE',
        `reason: ${load.error ?? 'UNKNOWN'}`,
        'providerIssue=true',
        'marketSignal=false',
        'executionImpact=NONE',
      ],
    };
  }
  const enemy = load.enemy ?? {
    warningCount: 0,
    warnings: [],
    strongBuyAllowed: true,
    newBuyAllowed: true,
    shadowOnly: false,
    advisoryBoost: false,
    reason: '',
    learningTags: [],
  };
  const okCount = [
    pack.price?.confidence === 'VERIFIED',
    pack.investorFlowDaily?.hasRealFields === true,
    !!pack.shortSelling,
    !!pack.loanTransaction,
    !!pack.creditBalance,
    !!pack.stockProgram,
    !!pack.marketProgram,
    !!pack.marketSupply,
  ].filter(Boolean).length;
  const marker: Marker = pack.providerIssue ? 'MISSING' : okCount >= 4 ? 'OK' : 'DEGRADED';
  return {
    key: 'marketSupply',
    title: 'KIS Official Supply Pack',
    marker,
    riskReason: enemy.warningCount > 0 ? enemy.reason : undefined,
    lines: [
      'source: KIS_API',
      'officialSource=true',
      `target: ${load.code}`,
      `price=${pack.price?.confidence ?? 'MISSING'}; investorFlowDaily=${pack.investorFlowDaily?.hasRealFields ? 'OK' : 'DATA_UNAVAILABLE'}; estimate=${pack.investorFlowEstimate?.confidence ?? 'MISSING'}`,
      `short=${pack.shortSelling ? pack.shortSelling.trend ?? 'UNKNOWN' : 'DATA_UNAVAILABLE'}; loan=${pack.loanTransaction ? pack.loanTransaction.trend ?? 'UNKNOWN' : 'DATA_UNAVAILABLE'}; credit=${pack.creditBalance ? pack.creditBalance.trend ?? 'UNKNOWN' : 'DATA_UNAVAILABLE'}`,
      `program=${pack.stockProgram ? 'OK' : 'DATA_UNAVAILABLE'}; marketProgram=${pack.marketProgram ? 'OK' : 'DATA_UNAVAILABLE'}; marketSupply=${pack.marketSupply ? 'OK' : 'DATA_UNAVAILABLE'}`,
      `enemyWarnings=${enemy.warningCount}; packLocalStrongBuyAllowed=${String(enemy.strongBuyAllowed)}; newBuyAllowed=${String(enemy.newBuyAllowed)}`,
      'finalStrongBuyAllowed=controlledByFinalGate',
      'finalGateNote=enemyWarnings=1 does not block STRONG_BUY alone; final decision is controlled by FinalGate.',
      'marketSignal=false',
      'executionImpact=NONE',
    ],
  };
}

function buildRiskTop3(channels: ChannelStatus[]): string[] {
  const risks: string[] = [];
  for (const channel of channels) if (channel.zeroSuspect && isZeroFilledSuspicious(channel.zeroSuspect.count, channel.zeroSuspect.total)) risks.push(`- 🟠 ${channel.title}: ${zeroFilledRiskReason(channel.zeroSuspect.count, channel.zeroSuspect.total)}`);
  for (const channel of channels) if (channel.marker !== 'OK' && channel.marker !== 'N/A' && channel.marker !== 'NEUTRAL') risks.push(`- ${markerIcon(channel.marker)} ${channel.title}: ${channel.riskReason ?? channel.marker}`);
  for (const channel of channels) if (channel.marker === 'NEUTRAL') risks.push(`- ${markerIcon(channel.marker)} ${channel.title}: ${channel.riskReason ?? '점수 제외/관찰 필요'}`);
  for (const channel of channels) if (channel.marker === 'N/A') risks.push(`- ${markerIcon(channel.marker)} ${channel.title}: ${channel.riskReason ?? channel.marker}`);
  return risks.slice(0, 3);
}

function compactSupplyHealthLinesForTelegram(lines: string[]): string[] {
  const compacted = lines.filter((line) => {
    const trimmed = line.trim();
    return !trimmed.startsWith('providerHealth:')
      && !trimmed.startsWith('providerTried:')
      && !trimmed.startsWith('detail code=');
  });
  const cacheIndex = compacted.findIndex((line) => line.startsWith('캐시:'));
  if (cacheIndex >= 0) compacted.splice(cacheIndex + 1, 0, '출력: compacted to preserve all 8 section boundaries');
  return compacted;
}

function renderMessage(channels: ChannelStatus[], targetLine: string, cacheLine: string): string {
  const kisFirstMode = isKisFirstRebuildModeForSupplyHealth();
  const ok = channels.filter((c) => c.marker === 'OK').length;
  const neutral = channels.filter((c) => c.marker === 'NEUTRAL').length;
  const stale = channels.filter((c) => c.marker === 'STALE').length;
  const degraded = channels.filter((c) => c.marker === 'DEGRADED').length;
  const missing = channels.filter((c) => c.marker === 'MISSING').length;
  const risks = buildRiskTop3(channels);
  const lines = [
    ...(kisFirstMode ? [
      `Current Data Mode: ${isKisOnlyRebuildMode() ? 'KIS_ONLY_REBUILD' : 'KIS_FIRST_REBUILD'}`,
      'Primary Provider: KIS_API',
      'Legacy Providers: diagnostic-only',
      '',
    ] : []),
    `📊 Supply Health: ${ok}/${channels.length} OK | ${neutral} NEUTRAL | ${degraded} DEGRADED | ${stale} STALE | ${missing} MISSING`, targetLine, cacheLine, '', '⚠️ 위험 TOP 3', ...(risks.length > 0 ? risks : ['- 🟢 주요 위험 없음']), ''];
  channels.forEach((channel, index) => {
    lines.push(`${index + 1}. ${markerIcon(channel.marker)} ${channel.title}`);
    if (channel.marker === 'NEUTRAL' && !channel.lines.some((line) => line.startsWith('route:')) && channel.key !== 'marketSupply') lines.push(`  ${compactProviderRoute(channel.key)}`);
    for (const line of channel.lines) lines.push(`  ${line}`);
    if (index !== channels.length - 1) lines.push('');
  });
  const message = lines.join('\n');
  if (message.length < 4096) return message;
  const compactMessage = compactSupplyHealthLinesForTelegram(lines).join('\n');
  return compactMessage.length < 4096 ? compactMessage : `${compactMessage.slice(0, 4050)}\n...`;
}

function extractProviderTriedEntries(lines: string[]): string[] {
  const entries: string[] = [];
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (line.startsWith('providerTried:')) {
      const inline = line.split(':').slice(1).join(':').trim();
      if (inline) entries.push(inline);
      for (let j = i + 1; j < lines.length && /^\s{2}\S/.test(lines[j]); j++) {
        entries.push(lines[j].trim());
      }
    }
  }
  return entries;
}

function sourceFromLine(lines: string[]): SourceHealth['source'] {
  const line = lines.find((l) => l.startsWith('source:')) ?? '';
  if (line.includes('KIS')) return 'KIS_API';
  if (line.includes('KRX')) return 'KRX';
  if (line.includes('NAVER')) return 'NAVER';
  if (line.includes('CACHE')) return 'CACHE';
  if (line.includes('FSS')) return 'FSS';
  if (line.includes('macroState')) return 'MACRO_STATE';
  return 'UNKNOWN';
}

function sourceHealthFromChannel(channel: ChannelStatus): SourceHealth {
  const successLine = channel.lines.find((l) => l.startsWith('success:'));
  const missingLine = channel.lines.find((l) => l.startsWith('missing:'));
  const staleLine = channel.lines.find((l) => l.startsWith('stale:'));
  const updatedLine = channel.lines.find((l) => l.startsWith('updated:'));
  const latestLine = channel.lines.find((l) => l.startsWith('latest:'));
  const successMatch = successLine?.match(/(\d+)\/(\d+)/);
  const providerTried = extractProviderTriedEntries(channel.lines);
  // ADR-0421 — 'DATA_UNAVAILABLE' 신규 분기 (NEUTRAL 폐기 정합).
  const status: SourceHealth['status'] =
    channel.marker === 'OK' ? 'OK' :
    channel.marker === 'NEUTRAL' ? 'NEUTRAL' :
    channel.marker === 'DEGRADED' ? 'DEGRADED' :
    channel.marker === 'STALE' ? 'STALE' :
    channel.marker === 'DATA_UNAVAILABLE' ? 'DATA_UNAVAILABLE' :
    'MISSING';
  return {
    status,
    source: sourceFromLine(channel.lines),
    coverage: successMatch ? `${successMatch[1]}/${successMatch[2]}` : undefined,
    success: successMatch ? Number(successMatch[1]) : undefined,
    missing: missingLine ? Number(missingLine.match(/\d+/)?.[0] ?? Number.NaN) : undefined,
    stale: staleLine ? Number(staleLine.match(/\d+/)?.[0] ?? Number.NaN) : undefined,
    latest: latestLine?.replace(/^latest:\s*/, ''),
    updatedAt: updatedLine?.replace(/^updated:\s*/, ''),
    reason: channel.riskReason,
    providerTried: providerTried.length > 0 ? providerTried : undefined,
  };
}

function overallStatusFromChannels(channels: ChannelStatus[]): SupplyHealthSnapshot['summary']['overallStatus'] {
  const missing = channels.filter((c) => c.marker === 'MISSING').length;
  const degraded = channels.filter((c) => c.marker === 'DEGRADED').length;
  const stale = channels.filter((c) => c.marker === 'STALE').length;
  const zeroFilled = channels.some((c) => c.zeroSuspect && isZeroFilledSuspicious(c.zeroSuspect.count, c.zeroSuspect.total));
  const investor = channels.find((c) => c.key === 'investorFlow');
  const foreigner = channels.find((c) => c.key === 'foreignerRatioTrend');
  if (missing >= 3 || channels.every((c) => c.marker !== 'OK')) return 'BROKEN';
  if (zeroFilled || (investor?.marker === 'DEGRADED' && foreigner?.marker === 'DEGRADED')) return 'UNSAFE';
  if (degraded > 0 || stale > 0) return 'DEGRADED';
  if (channels.some((c) => c.marker === 'NEUTRAL')) return 'USABLE';
  return 'OK';
}

function snapshotFromChannels(channels: ChannelStatus[]): SupplyHealthSnapshot {
  const total = Math.max(1, channels.length);
  const ok = channels.filter((c) => c.marker === 'OK').length;
  const neutral = channels.filter((c) => c.marker === 'NEUTRAL').length;
  const degraded = channels.filter((c) => c.marker === 'DEGRADED').length;
  const missing = channels.filter((c) => c.marker === 'MISSING').length;
  const stale = channels.filter((c) => c.marker === 'STALE').length;
  const byKey = new Map(channels.map((c) => [c.key, sourceHealthFromChannel(c)]));
  const providerTried = [...new Set(channels.flatMap((c) => extractProviderTriedEntries(c.lines)).filter(Boolean))];
  const providerUsed = [...new Set([...byKey.values()].map((s) => s.source).filter((s) => s !== 'UNKNOWN'))];
  const providerFailed = [...new Set(channels.filter((c) => c.marker === 'MISSING' || c.marker === 'STALE').map((c) => sourceHealthFromChannel(c).source))];
  const zeroFilledSuspected = channels.some((c) => c.zeroSuspect && isZeroFilledSuspicious(c.zeroSuspect.count, c.zeroSuspect.total));
  return {
    summary: { ok, neutral, degraded, missing, stale, cacheStatus: stale > 0 ? 'stale' : 'fresh', overallStatus: overallStatusFromChannels(channels) },
    coverage: { totalSources: channels.length, okRatio: ok / total, degradedRatio: degraded / total, missingRatio: missing / total, minCriticalCoverage: ok / total },
    sources: {
      investorFlow: byKey.get('investorFlow'),
      programTrading: byKey.get('stockProgram'),
      marketProgramTrading: byKey.get('marketProgram'),
      passiveActive: byKey.get('fssPassiveActive'),
      shortBalance: byKey.get('shortSelling'),
      foreignerTrend: byKey.get('foreignerRatioTrend'),
      marginBalance: byKey.get('marginBalance'),
    },
    providerTried,
    providerFailed,
    providerUsed,
    criticalFlags: {
      investorFlowDegraded: byKey.get('investorFlow')?.status === 'DEGRADED' || byKey.get('investorFlow')?.status === 'STALE',
      programTradingMissing: byKey.get('stockProgram')?.status === 'MISSING',
      foreignerTrendDegraded: byKey.get('foreignerRatioTrend')?.status === 'DEGRADED' || byKey.get('foreignerRatioTrend')?.status === 'STALE',
      zeroFilledSuspected,
      offHoursMode: channels.some((c) => c.lines.some((l) => l.includes('OFF_HOURS') || l.includes('ACCEPTED_EMPTY'))),
    },
  };
}

async function collectSupplyHealthChannels(now: Date): Promise<{ channels: ChannelStatus[]; targetLine: string }> {
  const nowMs = now.getTime();
  const watchlist = loadWatchlist();
  const targets = selectTopWatchlist(TOP_N);
  const macro = loadMacroStateReadOnly();
  const kis = await loadKisOfficialSupplyPackForSupplyHealth(targets);
  return {
    channels: [
      await diagnoseInvestorFlow(targets, now, nowMs),
      diagnoseLoadedKisOfficialSupplyPack(kis),
      await diagnoseStockProgram(targets),
      await diagnoseMarketProgram(macro, nowMs),
      diagnoseFss(macro, nowMs, kis.pack),
      await diagnoseShort(macro, nowMs, kis.pack),
      diagnoseForeignerRatio(targets, nowMs, kis.pack),
      diagnoseMargin(macro, nowMs, kis.pack),
    ],
    targetLine: formatTargetLine(watchlist.length, targets.length),
  };
}

export async function buildSupplyHealthSnapshot(now: Date = new Date()): Promise<SupplyHealthSnapshot> {
  if (isKisOnlyRebuildMode()) {
    const report = await buildKisOnlyHealthReport({ now });
    const ok = [
      report.price.status === 'OK',
      report.investorFlow.status === 'OK' || report.investorFlow.status === 'PARTIAL',
      report.program.stockProgram.status === 'OK' || report.program.stockProgram.status === 'PARTIAL',
      report.program.marketProgram.status === 'OK',
      report.shortCredit.short === 'OK',
      report.shortCredit.loan === 'OK' || report.shortCredit.loan === 'FLAT',
      report.shortCredit.credit === 'OK' || report.shortCredit.credit === 'FLAT',
      report.sectorBasket.status === 'OK' || report.sectorBasket.status === 'PARTIAL',
    ].filter(Boolean).length;
    const total = 8;
    const missing = total - ok;
    return {
      summary: { ok, neutral: 0, degraded: 0, missing, stale: 0, cacheStatus: 'fresh', overallStatus: report.providerIssue ? 'BROKEN' : missing > 0 ? 'DEGRADED' : 'OK' },
      coverage: { totalSources: total, okRatio: ok / total, degradedRatio: 0, missingRatio: missing / total, minCriticalCoverage: ok / total },
      sources: {},
      providerTried: ['KIS_ONLY_REBUILD'],
      providerFailed: report.providerIssue ? ['KIS_API'] : [],
      providerUsed: ['KIS_API'],
      criticalFlags: {
        investorFlowDegraded: report.investorFlow.status !== 'OK',
        programTradingMissing: report.program.stockProgram.status === 'EMPTY' || report.program.stockProgram.status === 'ERROR',
        foreignerTrendDegraded: false,
        zeroFilledSuspected: false,
        offHoursMode: false,
      },
    };
  }
  const { channels } = await collectSupplyHealthChannels(now);
  return snapshotFromChannels(channels);
}

export async function buildSupplyHealthMessage(now: Date = new Date()): Promise<string> {
  const nowMs = now.getTime();
  const currentMode = isKisOnlyRebuildMode() ? 'KIS_ONLY_REBUILD' : 'LEGACY';
  if (cache && cache.mode === currentMode && nowMs - cache.builtAt < SUPPLY_HEALTH_CACHE_TTL_MS) {
    const ageSec = Math.max(0, Math.floor((nowMs - cache.builtAt) / 1000));
    return cache.message.replace('캐시: fresh', `캐시: ${ageSec}s`);
  }
  if (isKisOnlyRebuildMode()) {
    const report = await buildKisOnlyHealthReport({ now });
    const message = [
      'Current Data Mode: KIS_ONLY_REBUILD',
      'Primary Provider: KIS_API',
      'Legacy Providers: diagnostic-only',
      'Active source diagnosis: /kis_health',
      '',
      formatKisOnlyHealthReport(report),
      '',
      'Legacy Diagnostic Lane',
      'Legacy providers are disabled for current decisions in KIS_ONLY_REBUILD_MODE.',
      'Reconnect order: KIS raw/normalized → FreshDataStatus → SEMANTIC_NETBUY → InvestorFlowRouter → Gate/Shadow.',
      '캐시: fresh',
    ].join('\n');
    cache = { message, builtAt: nowMs, mode: currentMode };
    return message;
  }
  const { channels, targetLine } = await collectSupplyHealthChannels(now);
  const message = renderMessage(channels, targetLine, '캐시: fresh');
  cache = { message, builtAt: nowMs, mode: currentMode };
  return message;
}
export function __resetSupplyHealthCacheForTests(): void { cache = null; }

const supplyHealth: TelegramCommand = {
  name: '/supply_health', aliases: ['/sh', '/supply', '/investor_flow', '/flow_health'], category: 'SYS', visibility: 'ADMIN', riskLevel: 0,
  description: '수급 데이터 source/freshness/coverage/zero-filled 의심 read-only 진단', usage: '/supply_health',
  async execute({ reply }) {
    try { await reply(await buildSupplyHealthMessage()); } catch (err) { console.error('[supplyHealth.cmd] failed', err); await reply('🔴 Supply Health 진단 실패 — 서버 로그 확인 필요'); }
  },
};

commandRegistry.register(supplyHealth);
export default supplyHealth;
