// @responsibility BUG_LEDGER 월간 자동 요약 리포트 — 영속 read-only + 텔레그램 분석 채널 발송 (PR #669/#670/#671/#672/#673 후속 P2-B).

import {
  loadBugLedger,
  summarizeBugLedger,
  sortBugsByPriority,
  type BugEntry,
} from '../persistence/bugLedgerRepo.js';

const STATUS_EMOJI: Record<string, string> = {
  OPEN: '🔴',
  PATCHED: '🟡',
  VERIFIED: '🟢',
  WATCHING: '👁️',
  CLOSED: '✅',
  WONTFIX: '⛔',
};

const SEVERITY_EMOJI: Record<string, string> = {
  P0: '🛑',
  P1: '⚠️',
  P2: '🟠',
  P3: 'ℹ️',
};

const HTML_ESC: Record<string, string> = {
  '&': '&amp;',
  '<': '&lt;',
  '>': '&gt;',
};

function escapeHtml(s: string): string {
  return s.replace(/[&<>]/g, (c) => HTML_ESC[c] ?? c);
}

function truncate(s: string, n: number): string {
  if (s.length <= n) return s;
  return s.slice(0, n - 1) + '…';
}

const TOP_NEW_LIMIT = 5;
const TOP_RESOLVED_LIMIT = 5;
const TOP_RECURRENCE_LIMIT = 5;
const TOP_UNRESOLVED_P0_LIMIT = 5;
const RECENT_WINDOW_DAYS = 30;

const DAY_MS = 24 * 60 * 60 * 1000;

export interface BugLedgerMonthlySummary {
  total: number;
  byStatus: Record<string, number>;
  bySeverity: Record<string, number>;
  byArea: Record<string, number>;
  recentNew: BugEntry[];
  recentResolved: BugEntry[];
  recurring: BugEntry[];
  unresolvedP0: BugEntry[];
  windowDays: number;
  reportedAtKst: string;
}

function isWithinDays(dateStr: string, nowMs: number, days: number): boolean {
  if (!dateStr) return false;
  const t = Date.parse(`${dateStr}T00:00:00+09:00`);
  if (!Number.isFinite(t)) return false;
  return (nowMs - t) <= days * DAY_MS && (nowMs - t) >= 0;
}

function toKstDateString(nowMs: number): string {
  const utcDate = new Date(nowMs);
  const kstMs = utcDate.getTime() + 9 * 60 * 60 * 1000;
  return new Date(kstMs).toISOString().slice(0, 10);
}

/**
 * BUG 영속 entry 들을 30일 윈도우 + 우선순위 정렬해서 월간 요약을 계산한다.
 * 외부 호출 0건 — read-only.
 */
export function buildMonthlySummary(
  entries: BugEntry[],
  nowMs: number,
): BugLedgerMonthlySummary {
  const sortedAll = sortBugsByPriority(entries);
  const summary = summarizeBugLedger(entries);

  const recentNew = sortedAll
    .filter((e) => isWithinDays(e.discovered, nowMs, RECENT_WINDOW_DAYS))
    .slice(0, TOP_NEW_LIMIT);

  const recentResolved = entries
    .filter((e) => e.resolved && isWithinDays(e.resolved, nowMs, RECENT_WINDOW_DAYS))
    .sort((a, b) => (b.resolved ?? '').localeCompare(a.resolved ?? ''))
    .slice(0, TOP_RESOLVED_LIMIT);

  const recurring = entries
    .filter((e) => e.recurrence_count > 0)
    .sort((a, b) => b.recurrence_count - a.recurrence_count)
    .slice(0, TOP_RECURRENCE_LIMIT);

  const unresolvedP0 = sortedAll
    .filter((e) => e.severity === 'P0' && (e.status === 'OPEN' || e.status === 'PATCHED'))
    .slice(0, TOP_UNRESOLVED_P0_LIMIT);

  return {
    total: summary.total,
    byStatus: summary.byStatus,
    bySeverity: summary.bySeverity,
    byArea: summary.byArea,
    recentNew,
    recentResolved,
    recurring,
    unresolvedP0,
    windowDays: RECENT_WINDOW_DAYS,
    reportedAtKst: toKstDateString(nowMs),
  };
}

/**
 * 월간 요약 메시지 빌더 — 단위 테스트 가능 (cron job 과 분리).
 * 빈 ledger 시 안내 메시지 반환.
 */
export function formatMonthlySummaryMessage(s: BugLedgerMonthlySummary): string {
  if (s.total === 0) {
    return [
      '📅 <b>BUG_LEDGER 월간 요약</b>',
      `📆 ${s.reportedAtKst} KST 기준`,
      '',
      '✅ 등록된 결함 없음 — 깨끗한 한 달.',
    ].join('\n');
  }

  const lines: string[] = [];
  lines.push('📅 <b>BUG_LEDGER 월간 요약</b>');
  lines.push(`📆 ${s.reportedAtKst} KST 기준 (윈도우: 직전 ${s.windowDays}일)`);
  lines.push('');

  // 전체 분포
  lines.push(`📊 <b>총 ${s.total}건</b>`);
  const statusOrder = ['OPEN', 'PATCHED', 'VERIFIED', 'WATCHING', 'CLOSED', 'WONTFIX'];
  const statusParts: string[] = [];
  for (const st of statusOrder) {
    const c = s.byStatus[st] ?? 0;
    if (c > 0) statusParts.push(`${STATUS_EMOJI[st] ?? ''}${st}=${c}`);
  }
  if (statusParts.length > 0) lines.push(`  • status: ${statusParts.join(' / ')}`);

  const sevOrder = ['P0', 'P1', 'P2', 'P3'];
  const sevParts: string[] = [];
  for (const v of sevOrder) {
    const c = s.bySeverity[v] ?? 0;
    if (c > 0) sevParts.push(`${SEVERITY_EMOJI[v] ?? ''}${v}=${c}`);
  }
  if (sevParts.length > 0) lines.push(`  • severity: ${sevParts.join(' / ')}`);
  lines.push('');

  // 미해결 P0 강조
  if (s.unresolvedP0.length > 0) {
    lines.push(`🛑 <b>미해결 P0 (Top ${s.unresolvedP0.length})</b>`);
    for (const e of s.unresolvedP0) {
      lines.push(formatBugLine(e));
    }
    lines.push('');
  }

  // 30일 신규
  if (s.recentNew.length > 0) {
    lines.push(`🆕 <b>최근 ${s.windowDays}일 신규 (Top ${s.recentNew.length})</b>`);
    for (const e of s.recentNew) {
      lines.push(formatBugLine(e));
    }
    lines.push('');
  }

  // 30일 해결
  if (s.recentResolved.length > 0) {
    lines.push(`✅ <b>최근 ${s.windowDays}일 해결 (Top ${s.recentResolved.length})</b>`);
    for (const e of s.recentResolved) {
      lines.push(formatResolvedLine(e));
    }
    lines.push('');
  }

  // 재발
  if (s.recurring.length > 0) {
    lines.push(`↻ <b>재발 (Top ${s.recurring.length})</b>`);
    for (const e of s.recurring) {
      lines.push(`  ${SEVERITY_EMOJI[e.severity] ?? '❓'} <code>${escapeHtml(e.id)}</code> ↻${e.recurrence_count} — ${escapeHtml(truncate(e.summary, 60))}`);
    }
    lines.push('');
  }

  // 영역 분포
  const areaEntries = Object.entries(s.byArea).sort((a, b) => b[1] - a[1]).slice(0, 5);
  if (areaEntries.length > 0) {
    lines.push(`🗺️ <b>영역별 분포 (Top 5)</b>`);
    for (const [area, count] of areaEntries) {
      lines.push(`  • ${escapeHtml(area)}: ${count}건`);
    }
    lines.push('');
  }

  lines.push('운영자 액션: /bugs p0 (미해결 P0) / /bugs open (열린 결함)');
  return lines.join('\n');
}

function formatBugLine(e: BugEntry): string {
  const sev = SEVERITY_EMOJI[e.severity] ?? '❓';
  const stat = STATUS_EMOJI[e.status] ?? '❓';
  const id = `<code>${escapeHtml(e.id)}</code>`;
  const recur = e.recurrence_count > 0 ? ` ↻${e.recurrence_count}` : '';
  const area = e.area ? ` [${escapeHtml(e.area)}]` : '';
  const summary = e.summary ? ` — ${escapeHtml(truncate(e.summary, 60))}` : '';
  return `  ${sev}${stat} ${id}${area}${recur}${summary}`;
}

function formatResolvedLine(e: BugEntry): string {
  const sev = SEVERITY_EMOJI[e.severity] ?? '❓';
  const id = `<code>${escapeHtml(e.id)}</code>`;
  const date = e.resolved ?? '';
  const summary = e.summary ? ` — ${escapeHtml(truncate(e.summary, 60))}` : '';
  return `  ${sev} ${id} (resolved=${escapeHtml(date)})${summary}`;
}

export function isBugLedgerMonthlyReportDisabled(): boolean {
  return process.env.BUG_LEDGER_MONTHLY_REPORT_DISABLED === 'true';
}

export interface RunBugLedgerMonthlyReportResult {
  sent: boolean;
  reason?: 'DISABLED' | 'EMPTY' | 'OK';
  totalBugs: number;
}

/**
 * 월간 요약 진입점 — cron 호출자가 직접 사용.
 * sendTelegramAlert 는 호출자가 주입 (테스트 격리).
 */
export async function runBugLedgerMonthlyReport(
  sendAlert: (msg: string, opts: Record<string, unknown>) => Promise<unknown>,
  nowMs: number = Date.now(),
): Promise<RunBugLedgerMonthlyReportResult> {
  if (isBugLedgerMonthlyReportDisabled()) {
    return { sent: false, reason: 'DISABLED', totalBugs: 0 };
  }
  const entries = loadBugLedger();
  if (entries.length === 0) {
    return { sent: false, reason: 'EMPTY', totalBugs: 0 };
  }
  const summary = buildMonthlySummary(entries, nowMs);
  const message = formatMonthlySummaryMessage(summary);
  const dedupeKey = `bug-ledger-monthly:${summary.reportedAtKst.slice(0, 7)}`;
  await sendAlert(message, {
    priority: 'NORMAL',
    tier: 'T2_REPORT',
    category: 'bug_ledger_monthly',
    dedupeKey,
  }).catch((err) => {
    console.error('[BugLedgerMonthlyReport] 발송 실패:', err instanceof Error ? err.message : err);
  });
  return { sent: true, reason: 'OK', totalBugs: entries.length };
}
