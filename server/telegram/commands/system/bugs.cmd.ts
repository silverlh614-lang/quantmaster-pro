// @responsibility bugs.cmd 텔레그램 모듈 — /bugs 영속 BUG_LEDGER read-only 조회 (PR #669/#670 후속 P2-A).

import {
  loadBugLedger,
  sortBugsByPriority,
  summarizeBugLedger,
  type BugEntry,
} from '../../../persistence/bugLedgerRepo.js';
import { commandRegistry } from '../../commandRegistry.js';
import type { TelegramCommand } from '../_types.js';

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

const FILTER_KEYS = ['p0', 'p1', 'p2', 'p3', 'open', 'patched', 'verified', 'watching', 'closed', 'wontfix'] as const;
type FilterKey = typeof FILTER_KEYS[number];

export interface BugsArgs {
  filter?: FilterKey;
  limit: number;
}

const DEFAULT_LIMIT = 10;
const MAX_LIMIT = 30;

export function parseBugsArgs(args: string[]): BugsArgs {
  let filter: FilterKey | undefined;
  let limit = DEFAULT_LIMIT;
  for (const raw of args) {
    if (raw == null) continue;
    const tok = String(raw).trim().toLowerCase();
    if (!tok) continue;
    if ((FILTER_KEYS as readonly string[]).includes(tok)) {
      filter = tok as FilterKey;
      continue;
    }
    const n = Number(tok);
    if (Number.isFinite(n) && n > 0) {
      limit = Math.min(MAX_LIMIT, Math.max(1, Math.floor(n)));
    }
  }
  return { filter, limit };
}

function applyFilter(entries: BugEntry[], filter: FilterKey | undefined): BugEntry[] {
  if (!filter) return entries;
  const upper = filter.toUpperCase();
  if (upper.startsWith('P')) {
    return entries.filter((e) => e.severity === upper);
  }
  return entries.filter((e) => e.status === upper);
}

/**
 * /bugs 메시지 빌더 — 단위 테스트 가능 (TelegramCommand.execute 와 분리).
 */
export function formatBugsMessage(entries: BugEntry[], parsed: BugsArgs): string {
  const filtered = applyFilter(entries, parsed.filter);
  const sorted = sortBugsByPriority(filtered);
  const top = sorted.slice(0, parsed.limit);
  const summary = summarizeBugLedger(entries);

  if (entries.length === 0) {
    return [
      '🐛 <b>BUG Ledger</b>',
      '',
      '⚠️ BUG_LEDGER.md 에 등록된 결함 없음',
      '',
      '결함 발견 시 docs/ops/BUG_LEDGER.md 에 BUG-YYYY-MM-DD-NNN 형식으로 등록.',
    ].join('\n');
  }

  const lines: string[] = [];
  lines.push('🐛 <b>BUG Ledger</b>');
  lines.push('');
  lines.push(`📊 <b>요약</b>: 총 ${summary.total}건`);
  const statusOrder = ['OPEN', 'PATCHED', 'VERIFIED', 'WATCHING', 'CLOSED', 'WONTFIX'];
  const statusParts: string[] = [];
  for (const s of statusOrder) {
    const c = summary.byStatus[s] ?? 0;
    if (c > 0) statusParts.push(`${STATUS_EMOJI[s] ?? ''}${s}=${c}`);
  }
  if (statusParts.length > 0) {
    lines.push(`  • status: ${statusParts.join(' / ')}`);
  }
  const sevOrder = ['P0', 'P1', 'P2', 'P3'];
  const sevParts: string[] = [];
  for (const v of sevOrder) {
    const c = summary.bySeverity[v] ?? 0;
    if (c > 0) sevParts.push(`${SEVERITY_EMOJI[v] ?? ''}${v}=${c}`);
  }
  if (sevParts.length > 0) {
    lines.push(`  • severity: ${sevParts.join(' / ')}`);
  }
  lines.push('');

  if (parsed.filter) {
    lines.push(`🔍 <b>필터</b>: ${parsed.filter.toUpperCase()} → ${filtered.length}건`);
    lines.push('');
  }

  if (top.length === 0) {
    lines.push('해당 필터에 매칭되는 BUG 없음.');
    lines.push('');
    lines.push('사용법: /bugs [p0|p1|p2|p3|open|patched|verified|watching|closed] [N]');
    return lines.join('\n');
  }

  lines.push(`📌 <b>Top ${top.length}/${filtered.length}</b> (status > severity > 최신순):`);
  for (const e of top) {
    lines.push(formatBugLine(e));
  }
  if (filtered.length > top.length) {
    lines.push('');
    lines.push(`… 외 ${filtered.length - top.length}건 (전체는 docs/ops/BUG_LEDGER.md)`);
  }
  lines.push('');
  lines.push('사용법: /bugs [p0|p1|p2|p3|open|patched|verified|watching|closed] [N≤30]');
  return lines.join('\n');
}

function formatBugLine(e: BugEntry): string {
  const sev = SEVERITY_EMOJI[e.severity] ?? '❓';
  const stat = STATUS_EMOJI[e.status] ?? '❓';
  const id = `<code>${escapeHtml(e.id)}</code>`;
  const recur = e.recurrence_count > 0 ? ` ↻${e.recurrence_count}` : '';
  const area = e.area ? ` [${escapeHtml(e.area)}]` : '';
  const summary = e.summary ? ` — ${escapeHtml(truncate(e.summary, 80))}` : '';
  return `  ${sev}${stat} ${id}${area}${recur}${summary}`;
}

function truncate(s: string, n: number): string {
  if (s.length <= n) return s;
  return s.slice(0, n - 1) + '…';
}

const bugs: TelegramCommand = {
  name: '/bugs',
  aliases: ['/bug_ledger'],
  category: 'SYS',
  visibility: 'ADMIN',
  riskLevel: 0,
  description: 'BUG_LEDGER 영속 결함 조회 — status × severity 별 요약 + Top N 항목',
  usage: '/bugs [p0|p1|p2|p3|open|patched|verified|watching|closed] [N=10]',
  async execute({ args, reply }) {
    try {
      const parsed = parseBugsArgs(args);
      const entries = loadBugLedger();
      const msg = formatBugsMessage(entries, parsed);
      await reply(msg);
    } catch (e) {
      console.error('[TelegramBot] /bugs 실패:', e);
      await reply('❌ /bugs 조회 실패 — 서버 로그를 확인하세요.');
    }
  },
};

commandRegistry.register(bugs);

export default bugs;
