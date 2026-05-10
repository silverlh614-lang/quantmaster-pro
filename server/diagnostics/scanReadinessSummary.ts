// @responsibility scanReadinessSummary — read-only first-scan readiness summary.
//
// This module does not run scanners, fetch providers, call KIS/KRX, or mutate state.
// It only summarizes already-available health, macro, watchlist, scheduler, and last scan evidence.

import { collectHealthSnapshot } from '../health/diagnostics.js';
import { loadMacroState } from '../persistence/macroStateRepo.js';
import { loadWatchlist } from '../persistence/watchlistRepo.js';
import { getLastScanSummary } from '../trading/signalScanner/scanDiagnostics.js';
import { SCHEDULE_CATALOG, getJobMetrics, getLastRunByJob } from '../scheduler/scheduleCatalog.js';

export interface ScanReadinessCheck {
  name: string;
  status: 'OK' | 'WARN' | 'BLOCK' | 'WAIT';
  label?: string;
  detail: string;
}

export interface ScanReadinessSummary {
  verdict: 'READY' | 'PARTIAL' | 'WAITING' | 'BLOCKED';
  reason: string;
  checks: ScanReadinessCheck[];
  nextActions: string[];
}

function ageHours(iso: string | undefined, nowMs: number): number | null {
  if (!iso) return null;
  const ts = Date.parse(iso);
  if (!Number.isFinite(ts)) return null;
  return Math.max(0, (nowMs - ts) / 3_600_000);
}

function formatAge(age: number | null): string {
  return typeof age === 'number' ? `${age.toFixed(1)}h` : 'n/a';
}

function statusIcon(status: ScanReadinessCheck['status']): string {
  if (status === 'OK') return '🟢';
  if (status === 'WARN') return '🟡';
  if (status === 'WAIT') return '⚪';
  return '🔴';
}

function volumeClockDetail(ok: boolean, detail: unknown): string {
  if (typeof detail === 'string' && detail.trim()) return detail.trim();
  return ok ? 'entry window available' : 'outside entry window';
}

function macroLabel(age: number | null): string | undefined {
  if (age === null) return 'UNKNOWN';
  return age <= 8 ? undefined : 'STALE';
}

function displayStatus(check: ScanReadinessCheck): string {
  return check.label ?? check.status;
}

function formatKstHm(iso: string | undefined): string {
  if (!iso) return 'never';
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

function formatSchedulerLastLabel(lastFinishedAt: string | undefined, everRanCount: number): string {
  if (lastFinishedAt) return formatKstHm(lastFinishedAt);
  if (everRanCount > 0) return 'not in memory';
  return 'never';
}

function buildSchedulerCheck(): ScanReadinessCheck {
  const screenerJobs = SCHEDULE_CATALOG.filter((entry) => entry.group === 'screener' && entry.jobName);
  const tradingTick = SCHEDULE_CATALOG.find((entry) => entry.jobName === 'orchestrator_tick');
  const observedJobs = [...screenerJobs, ...(tradingTick ? [tradingTick] : [])];
  if (observedJobs.length === 0) {
    return { name: 'Scheduler', status: 'WARN', detail: 'no screener/orchestrator catalog entries' };
  }

  const registered = observedJobs.filter((entry) => entry.jobName && getJobMetrics(entry.jobName));
  const everRan = observedJobs.filter((entry) => {
    if (!entry.jobName) return false;
    const metrics = getJobMetrics(entry.jobName);
    return Boolean(metrics && metrics.runCount > 0);
  });
  const lastRuns = observedJobs
    .map((entry) => entry.jobName ? getLastRunByJob(entry.jobName) : undefined)
    .filter(Boolean)
    .sort((a, b) => String(b!.finishedAt).localeCompare(String(a!.finishedAt)));
  const last = lastRuns[0];
  const status: ScanReadinessCheck['status'] = registered.length === 0
    ? 'WAIT'
    : everRan.length === 0
      ? 'WAIT'
      : 'OK';
  const detail = [
    `catalog=${observedJobs.length}`,
    `metrics=${registered.length}`,
    `everRan=${everRan.length}`,
    `last=${formatSchedulerLastLabel(last?.finishedAt, everRan.length)}`,
  ].join(', ');
  return { name: 'Scheduler', status, detail };
}

function buildScanInvocationCheck(schedulerCheck: ScanReadinessCheck, hasScanHistory: boolean): ScanReadinessCheck {
  const orchestrator = SCHEDULE_CATALOG.find((entry) => entry.jobName === 'orchestrator_tick');
  const orchMetrics = getJobMetrics('orchestrator_tick');
  const orchLast = getLastRunByJob('orchestrator_tick');
  const hasOrchestratorPath = Boolean(orchestrator);
  const status: ScanReadinessCheck['status'] = hasScanHistory
    ? 'OK'
    : hasOrchestratorPath && schedulerCheck.status === 'OK'
      ? 'WAIT'
      : 'WARN';
  const detail = [
    'path=orchestrator_tick>tradingOrchestrator.tick>runAutoSignalScan',
    `orchRuns=${orchMetrics?.runCount ?? 0}`,
    `orchLast=${formatSchedulerLastLabel(orchLast?.finishedAt, orchMetrics?.runCount ?? 0)}`,
    hasScanHistory ? 'scan=recorded' : 'scan=not recorded',
  ].join(', ');
  return { name: 'ScanInvocation', status, detail };
}

export function buildScanReadinessSummary(now = new Date()): ScanReadinessSummary {
  const health = collectHealthSnapshot();
  const macro = loadMacroState();
  const watchlist = loadWatchlist();
  const lastScan = getLastScanSummary();
  const macroAge = ageHours(macro?.updatedAt, now.getTime());
  const hasScanHistory = health.lastScanTs > 0 || Boolean(lastScan);
  const schedulerCheck = buildSchedulerCheck();
  const invocationCheck = buildScanInvocationCheck(schedulerCheck, hasScanHistory);

  const checks: ScanReadinessCheck[] = [
    {
      name: 'ScanHistory',
      status: hasScanHistory ? 'OK' : 'WAIT',
      detail: hasScanHistory ? `last=${new Date(health.lastScanTs).toISOString()}` : 'no scan history yet',
    },
    schedulerCheck,
    invocationCheck,
    {
      name: 'Watchlist',
      status: watchlist.length > 0 ? 'OK' : 'BLOCK',
      detail: `${watchlist.length} symbols`,
    },
    {
      name: 'KIS',
      status: health.kisConfigured && health.kisTokenValid ? 'OK' : 'BLOCK',
      detail: health.kisConfigured ? `token ${health.kisTokenHours}h` : 'not configured',
    },
    {
      name: 'KRX',
      status: health.krxTokenConfigured && health.krxTokenValid ? 'OK' : 'WARN',
      detail: `${health.krxTokenConfigured ? 'configured' : 'not configured'} / ${health.krxTokenValid ? 'healthy' : 'unhealthy'}`,
    },
    {
      name: 'Macro',
      status: macroAge === null ? 'WARN' : macroAge <= 8 ? 'OK' : 'WARN',
      label: macroLabel(macroAge),
      detail: `age=${formatAge(macroAge)}, regime=${macro?.regime ?? 'UNKNOWN'}, MHS=${macro?.mhs ?? 'n/a'}`,
    },
    {
      name: 'Yahoo',
      status: health.yahoo.detail === 'NO_SCAN_HISTORY' ? 'WAIT' : health.yahoo.status === 'OK' ? 'OK' : 'WARN',
      detail: health.yahoo.detail === 'NO_SCAN_HISTORY' ? 'will evaluate after first scan' : `${health.yahoo.status}/${health.yahoo.detail}`,
    },
    {
      name: 'VolumeClock',
      status: health.volume.ok ? 'OK' : 'WAIT',
      detail: volumeClockDetail(health.volume.ok, health.volume.detail),
    },
  ];

  const hasBlock = checks.some((check) => check.status === 'BLOCK');
  const hasWait = checks.some((check) => check.status === 'WAIT');
  const hasWarn = checks.some((check) => check.status === 'WARN');
  const verdict: ScanReadinessSummary['verdict'] = hasBlock
    ? 'BLOCKED'
    : hasWait
      ? 'WAITING'
      : hasWarn
        ? 'PARTIAL'
        : 'READY';

  const reason = !hasScanHistory
    ? 'no scan history yet'
    : lastScan?.emptyScanReason
      ? `last empty reason: ${lastScan.emptyScanReason}`
      : verdict === 'READY'
        ? 'all core preconditions OK'
        : 'some preconditions are waiting or degraded';

  const nextActions: string[] = [];
  if (macroAge !== null && macroAge > 8) nextActions.push(`Macro stale (${macroAge.toFixed(1)}h) → /refresh_macro`);
  if (!hasScanHistory) nextActions.push('No scan yet → wait next scanner cycle or /scan_blockers');
  if (schedulerCheck.status !== 'OK') nextActions.push('Scheduler not observed yet → /cron_status or /scheduler');
  if (invocationCheck.status !== 'OK') nextActions.push('Invocation path pending → /cron_status then /scan_blockers');
  if (watchlist.length === 0) nextActions.push('Watchlist empty → rebuild/watchlist refresh needed');
  if (!health.kisConfigured || !health.kisTokenValid) nextActions.push('KIS not ready → /ops_status full');
  if (!health.volume.ok) nextActions.push('Volume clock closed → wait allowed scan window');
  if (nextActions.length === 0) nextActions.push('No immediate action — observe next scan cycle');

  return { verdict, reason, checks, nextActions: nextActions.slice(0, 5) };
}

export function formatScanReadinessSummary(summary: ScanReadinessSummary): string {
  return [
    '🟡 <b>SCAN READINESS</b>',
    `Verdict: <b>${summary.verdict}</b>`,
    `Reason: ${summary.reason}`,
    '',
    ...summary.checks.map((check) => `${statusIcon(check.status)} ${check.name}: <b>${displayStatus(check)}</b> · ${check.detail}`),
    '',
    '<b>Next actions</b>',
    ...summary.nextActions.map((action) => `• ${action}`),
    '<i>read-only; no scanner run, no provider fetch.</i>',
  ].join('\n');
}
