// @responsibility scanReadinessSummary — read-only first-scan readiness summary.
//
// This module does not run scanners, fetch providers, call KIS/KRX, or mutate state.
// It only summarizes already-available health, macro, watchlist, and last scan evidence.

import { collectHealthSnapshot } from '../health/diagnostics.js';
import { loadMacroState } from '../persistence/macroStateRepo.js';
import { loadWatchlist } from '../persistence/watchlistRepo.js';
import { getLastScanSummary } from '../trading/signalScanner/scanDiagnostics.js';

export interface ScanReadinessCheck {
  name: string;
  status: 'OK' | 'WARN' | 'BLOCK' | 'WAIT';
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

export function buildScanReadinessSummary(now = new Date()): ScanReadinessSummary {
  const health = collectHealthSnapshot();
  const macro = loadMacroState();
  const watchlist = loadWatchlist();
  const lastScan = getLastScanSummary();
  const macroAge = ageHours(macro?.updatedAt, now.getTime());
  const hasScanHistory = health.lastScanTs > 0 || Boolean(lastScan);

  const checks: ScanReadinessCheck[] = [
    {
      name: 'ScanHistory',
      status: hasScanHistory ? 'OK' : 'WAIT',
      detail: hasScanHistory ? `last=${new Date(health.lastScanTs).toISOString()}` : 'no scan history yet',
    },
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
      detail: health.volume.detail,
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
  if (macroAge !== null && macroAge > 8) nextActions.push('Macro stale → /refresh_macro');
  if (!hasScanHistory) nextActions.push('No scan yet → wait next scanner cycle or /scan_blockers');
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
    ...summary.checks.map((check) => `${statusIcon(check.status)} ${check.name}: <b>${check.status}</b> · ${check.detail}`),
    '',
    '<b>Next actions</b>',
    ...summary.nextActions.map((action) => `• ${action}`),
    '<i>read-only; no scanner run, no provider fetch.</i>',
  ].join('\n');
}
