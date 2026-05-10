// @responsibility dataCompletenessSummary — read-only data readiness summary for operator diagnostics.
//
// This module does not fetch providers, mutate promotion state, or touch trading paths.
// It summarizes already-available health, macro, scan, watchlist, sector, and supply evidence.

import { collectHealthSnapshot } from '../health/diagnostics.js';
import { loadMacroState } from '../persistence/macroStateRepo.js';
import { loadWatchlist } from '../persistence/watchlistRepo.js';
import { getLastScanSummary } from '../trading/signalScanner/scanDiagnostics.js';

export type DataCompletenessStatus = 'OK' | 'PARTIAL' | 'STALE' | 'MISSING' | 'WAIT' | 'UNKNOWN';
export type DataCompletenessImpact = 'NONE' | 'SHADOW_OK' | 'LIVE_NOT_READY' | 'OBSERVE_ONLY';

export interface DataCompletenessItem {
  name: string;
  status: DataCompletenessStatus;
  updatedAt?: string;
  ageHours?: number | null;
  detail?: string;
  impact: DataCompletenessImpact;
}

export interface DataCompletenessSummary {
  verdict: 'OK' | 'PARTIAL' | 'DEGRADED' | 'NOT_READY';
  executionRecommendation: 'LIVE_READY' | 'SHADOW_OK' | 'OBSERVE_ONLY';
  generatedAt: string;
  items: DataCompletenessItem[];
  topIssues: string[];
  actionHints: string[];
  nextCommands: string[];
}

const MACRO_FRESH_MAX_HOURS = 8;

function ageHours(iso: string | undefined, nowMs: number): number | null {
  if (!iso) return null;
  const ts = Date.parse(iso);
  if (!Number.isFinite(ts)) return null;
  return Math.max(0, (nowMs - ts) / 3_600_000);
}

function formatKstShort(iso: string | undefined): string {
  if (!iso) return 'none';
  const ts = Date.parse(iso);
  if (!Number.isFinite(ts)) return 'invalid';
  return new Date(ts).toLocaleString('ko-KR', {
    timeZone: 'Asia/Seoul',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  });
}

function classifyMacroByAge(age: number | null, hasMacroPayload: boolean): DataCompletenessStatus {
  if (age === null) return hasMacroPayload ? 'STALE' : 'MISSING';
  if (age <= MACRO_FRESH_MAX_HOURS) return 'OK';
  return hasMacroPayload ? 'STALE' : 'MISSING';
}

function impactFromStatus(status: DataCompletenessStatus): DataCompletenessImpact {
  if (status === 'OK') return 'NONE';
  if (status === 'PARTIAL' || status === 'STALE' || status === 'UNKNOWN' || status === 'WAIT') return 'SHADOW_OK';
  return 'OBSERVE_ONLY';
}

function scanSummaryHas(summary: unknown, key: string): boolean {
  return Boolean(summary && typeof summary === 'object' && key in summary);
}

function fmtUsdKrw(value: unknown): string {
  const n = typeof value === 'number' ? value : Number(value);
  return Number.isFinite(n) ? n.toFixed(2) : 'n/a';
}

function fmtMhs(value: unknown): string {
  const n = typeof value === 'number' ? value : Number(value);
  return Number.isFinite(n) ? n.toFixed(0) : 'n/a';
}

function deriveSectorItem(summary: ReturnType<typeof getLastScanSummary>): DataCompletenessItem {
  if (!summary) {
    return { name: 'Sector', status: 'WAIT', detail: 'no scan summary yet', impact: 'SHADOW_OK' };
  }
  const quality = summary.sectorEnergyQuality;
  if (summary.sectorEnergyQualityDiagnostic) {
    const diagnostic = summary.sectorEnergyQualityDiagnostic as unknown as { leadershipConfidence?: string; operatorMessage?: string };
    const confidence = diagnostic.leadershipConfidence ?? 'UNKNOWN';
    const status: DataCompletenessStatus = confidence === 'HIGH' ? 'OK' : confidence === 'LOW' ? 'STALE' : 'PARTIAL';
    return {
      name: 'Sector',
      status,
      detail: diagnostic.operatorMessage ?? `leadershipConfidence=${confidence}`,
      impact: impactFromStatus(status),
    };
  }
  if (quality === 'OK') return { name: 'Sector', status: 'OK', detail: `quality=${quality}`, impact: 'NONE' };
  if (quality === 'PARTIAL' || quality === 'DEGRADED') return { name: 'Sector', status: 'PARTIAL', detail: `quality=${quality}`, impact: 'SHADOW_OK' };
  if (quality === 'STALE' || quality === 'FAILED') return { name: 'Sector', status: 'STALE', detail: `quality=${quality}`, impact: 'SHADOW_OK' };
  return { name: 'Sector', status: 'WAIT', detail: 'sector energy not observed', impact: 'SHADOW_OK' };
}

function deriveSupplyItem(summary: ReturnType<typeof getLastScanSummary>): DataCompletenessItem {
  if (!summary) {
    return { name: 'Supply', status: 'WAIT', detail: 'no scan summary yet', impact: 'SHADOW_OK' };
  }
  const providerStatus = summary.investorFlowProviderRouter?.status ?? summary.naverInvestorTrendAdr0481?.status;
  const hasFreshDataSupply = scanSummaryHas(summary, 'freshDataSupplyAdr0487');
  const hasSupplyFreshness = scanSummaryHas(summary, 'supplySourceFreshnessAdr0483');

  if (providerStatus === 'OK') return { name: 'Supply', status: 'OK', detail: 'investor flow provider OK', impact: 'NONE' };
  if (providerStatus === 'PROVIDER_ERROR') return { name: 'Supply', status: 'PARTIAL', detail: 'provider error isolated from market signal', impact: 'SHADOW_OK' };
  if (hasFreshDataSupply || hasSupplyFreshness) return { name: 'Supply', status: 'PARTIAL', detail: 'fresh data supply diagnostics available', impact: 'SHADOW_OK' };
  return { name: 'Supply', status: 'WAIT', detail: 'supply diagnostics not observed in last scan', impact: 'SHADOW_OK' };
}

function buildItems(nowMs: number): DataCompletenessItem[] {
  const health = collectHealthSnapshot();
  const macro = loadMacroState();
  const scanSummary = getLastScanSummary();
  const watchlist = loadWatchlist();

  const hasMacroPayload = Boolean(macro && (macro.usdKrw !== undefined || macro.regime || macro.mhs !== undefined));
  const macroAge = ageHours(macro?.updatedAt, nowMs);
  const macroStatus = classifyMacroByAge(macroAge, hasMacroPayload);
  const yahooStatus: DataCompletenessStatus =
    health.yahoo.status === 'OK' ? 'OK' :
    health.yahoo.status === 'STALE' ? 'STALE' :
    health.yahoo.status === 'DOWN' ? 'MISSING' :
    health.yahoo.detail === 'NO_SCAN_HISTORY' ? 'WAIT' :
    'PARTIAL';

  const kisStatus: DataCompletenessStatus = health.kisConfigured && health.kisTokenValid ? 'OK' : 'MISSING';
  const krxStatus: DataCompletenessStatus = health.krxTokenConfigured && health.krxTokenValid ? 'OK' : 'MISSING';
  const scanStatus: DataCompletenessStatus = health.lastScanTs > 0 ? 'OK' : 'WAIT';
  const watchlistStatus: DataCompletenessStatus = watchlist.length > 0 ? 'OK' : 'MISSING';

  const macroDetail = [
    `updated=${formatKstShort(macro?.updatedAt)}`,
    `age=${typeof macroAge === 'number' ? `${macroAge.toFixed(1)}h` : 'n/a'}`,
    `regime=${macro?.regime ?? 'UNKNOWN'}`,
    `MHS=${fmtMhs(macro?.mhs)}`,
    `usdKrw=${fmtUsdKrw(macro?.usdKrw)}`,
    `fresh<=${MACRO_FRESH_MAX_HOURS}h`,
  ].join(', ');

  return [
    {
      name: 'Macro',
      status: macroStatus,
      updatedAt: macro?.updatedAt,
      ageHours: macroAge,
      detail: macroDetail,
      impact: impactFromStatus(macroStatus),
    },
    {
      name: 'Yahoo',
      status: yahooStatus,
      detail: health.yahoo.detail === 'NO_SCAN_HISTORY' ? 'IDLE(no scan)' : `${health.yahoo.status}/${health.yahoo.detail}`,
      impact: impactFromStatus(yahooStatus),
    },
    {
      name: 'KIS',
      status: kisStatus,
      detail: health.kisConfigured ? `token ${health.kisTokenHours}h` : 'not configured',
      impact: kisStatus === 'OK' ? 'NONE' : 'LIVE_NOT_READY',
    },
    {
      name: 'KRX',
      status: krxStatus,
      detail: `${health.krxTokenConfigured ? 'configured' : 'not configured'} / ${health.krxTokenValid ? 'healthy' : 'unhealthy'}`,
      impact: krxStatus === 'OK' ? 'NONE' : 'SHADOW_OK',
    },
    {
      name: 'Watchlist',
      status: watchlistStatus,
      detail: `${watchlist.length} symbols`,
      impact: watchlistStatus === 'OK' ? 'NONE' : 'OBSERVE_ONLY',
    },
    {
      name: 'Scan',
      status: scanStatus,
      detail: health.lastScanTs > 0 ? `lastScan=${new Date(health.lastScanTs).toISOString()}` : 'WAIT(no scan)',
      impact: scanStatus === 'OK' ? 'NONE' : 'SHADOW_OK',
    },
    deriveSectorItem(scanSummary),
    deriveSupplyItem(scanSummary),
  ];
}

function deriveVerdict(items: DataCompletenessItem[]): DataCompletenessSummary['verdict'] {
  const missing = items.filter((item) => item.status === 'MISSING').length;
  const stale = items.filter((item) => item.status === 'STALE').length;
  const partial = items.filter((item) => item.status === 'PARTIAL' || item.status === 'UNKNOWN').length;
  if (missing >= 2) return 'NOT_READY';
  if (missing > 0 || stale >= 2) return 'DEGRADED';
  if (stale > 0 || partial > 0) return 'PARTIAL';
  return 'OK';
}

function deriveExecutionRecommendation(verdict: DataCompletenessSummary['verdict']): DataCompletenessSummary['executionRecommendation'] {
  if (verdict === 'OK') return 'LIVE_READY';
  if (verdict === 'PARTIAL' || verdict === 'DEGRADED') return 'SHADOW_OK';
  return 'OBSERVE_ONLY';
}

function buildTopIssues(items: DataCompletenessItem[]): string[] {
  return items
    .filter((item) => item.status !== 'OK' && item.status !== 'WAIT')
    .slice(0, 5)
    .map((item) => `${item.name}: ${item.status}${item.detail ? ` — ${item.detail}` : ''}`);
}

function buildActionHints(items: DataCompletenessItem[]): string[] {
  const hints: string[] = [];
  const byName = new Map(items.map((item) => [item.name, item]));
  const macro = byName.get('Macro');
  const scan = byName.get('Scan');
  const sector = byName.get('Sector');
  const supply = byName.get('Supply');
  const yahoo = byName.get('Yahoo');
  const kis = byName.get('KIS');

  if (macro?.status === 'STALE') hints.push(`Macro stale (${typeof macro.ageHours === 'number' ? `${macro.ageHours.toFixed(1)}h` : 'age n/a'}) → /refresh_macro`);
  if (macro?.status === 'MISSING') hints.push('Macro missing → /refresh_macro 후 /ops_status full 확인');
  if (yahoo?.status === 'WAIT') hints.push('Yahoo wait → 스캔 전 상태, 장애 아님');
  if (scan?.status === 'WAIT') hints.push('No scan yet → 다음 스캐너 주기 대기 또는 /scan_blockers');
  if (sector?.status === 'WAIT') hints.push('Sector wait → 첫 스캔 후 /sector_energy_diag 확인');
  if (supply?.status === 'WAIT') hints.push('Supply wait → 첫 스캔 후 /fresh_data_status 또는 /supply_health 확인');
  if (kis?.status === 'MISSING') hints.push('KIS missing → 토큰/환경변수 확인 후 /ops_status full');

  return hints.length > 0 ? hints.slice(0, 5) : ['No immediate action — observe next cycle'];
}

export function buildDataCompletenessSummary(now: Date = new Date()): DataCompletenessSummary {
  const items = buildItems(now.getTime());
  const verdict = deriveVerdict(items);
  return {
    verdict,
    executionRecommendation: deriveExecutionRecommendation(verdict),
    generatedAt: now.toISOString(),
    items,
    topIssues: buildTopIssues(items),
    actionHints: buildActionHints(items),
    nextCommands: ['/fresh_data_status', '/supply_health', '/sector_energy_diag', '/scan_blockers'],
  };
}

function formatItemLine(item: DataCompletenessItem, full: boolean): string {
  const age = full && typeof item.ageHours === 'number' ? ` · age ${item.ageHours.toFixed(1)}h` : '';
  const detail = item.detail ? ` · ${item.detail}` : '';
  return full
    ? `${item.name}: <b>${item.status}</b> · ${item.impact}${age}${detail}`
    : `${item.name}: <b>${item.status}</b>${detail}`;
}

export function formatDataCompletenessSummary(summary: DataCompletenessSummary, options: { full?: boolean } = {}): string {
  const full = options.full === true;
  const lines = [
    '📊 <b>DATA COMPLETENESS</b>',
    `Verdict: <b>${summary.verdict}</b>`,
    `Execution: <b>${summary.executionRecommendation}</b>`,
    '',
    ...summary.items.map((item) => formatItemLine(item, full)),
    '',
    '<b>Top issues</b>',
    ...(summary.topIssues.length > 0 ? summary.topIssues.map((issue) => `• ${issue}`) : ['• none']),
    '',
    '<b>Next actions</b>',
    ...summary.actionHints.map((hint) => `• ${hint}`),
    '',
    full ? `More: ${summary.nextCommands.join(', ')}` : '상세: /data_completeness full',
    '<i>read-only; no provider fetch, no data promotion.</i>',
  ];
  return lines.join('\n');
}
