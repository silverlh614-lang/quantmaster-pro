// @responsibility bugCandidates.cmd 텔레그램 모듈 — /bug_candidates BUG 후보 read-only 조회 + dismiss/review marker (PR #669~#674 후속 P3).
//
// 절대 규칙:
//   1. 자동 BUG_LEDGER 전사 0건 — `promote` 명령은 marker 만 변경, 운영자가 수동으로 BUG_LEDGER.md 전사.
//   2. KIS 주문 함수 import 금지.
//   3. read-only + status marker 변경만 (영속 candidate 데이터 자체는 변경 안 함).

import {
  loadBugCandidates,
  saveBugCandidates,
  updateCandidateStatus,
  findById,
  type BugCandidate,
  type BugCandidateStatus,
} from '../../../persistence/bugCandidatesRepo.js';
import { commandRegistry } from '../../commandRegistry.js';
import type { TelegramCommand } from '../_types.js';

const STATUS_EMOJI: Record<BugCandidateStatus, string> = {
  NEW: '🆕',
  REVIEWED: '👁️',
  DISMISSED: '⛔',
  PROMOTED: '⬆️',
};

const SEVERITY_EMOJI: Record<string, string> = {
  P0_CANDIDATE: '🛑',
  P1_CANDIDATE: '⚠️',
  P2_CANDIDATE: '🟠',
  P3_CANDIDATE: 'ℹ️',
};

const HTML_ESC: Record<string, string> = {
  '&': '&amp;',
  '<': '&lt;',
  '>': '&gt;',
};

function escapeHtml(s: string): string {
  return s.replace(/[&<>]/g, (c) => HTML_ESC[c] ?? c);
}

const VALID_FILTER_KEYS = ['new', 'reviewed', 'dismissed', 'promoted', 'p0', 'p1', 'p2', 'p3'] as const;
type FilterKey = typeof VALID_FILTER_KEYS[number];

const VALID_ACTIONS = ['list', 'review', 'dismiss', 'promote'] as const;
type Action = typeof VALID_ACTIONS[number];

export interface BugCandidatesArgs {
  action: Action;
  /** action='list' 일 때만 사용. */
  filter?: FilterKey;
  /** action='list' 일 때만 사용. */
  limit?: number;
  /** action='review|dismiss|promote' 일 때 후보 ID. */
  targetId?: string;
  /** review/dismiss/promote 메모. */
  note?: string;
}

const DEFAULT_LIMIT = 10;
const MAX_LIMIT = 30;

/** action 인자 + 옵션 파싱 — 단위 테스트 가능. */
export function parseBugCandidatesArgs(args: string[]): BugCandidatesArgs {
  if (args.length === 0) {
    return { action: 'list', limit: DEFAULT_LIMIT };
  }
  const first = String(args[0] ?? '').trim().toLowerCase();
  if ((VALID_ACTIONS as readonly string[]).includes(first)) {
    if (first === 'list') {
      return parseListArgs(args.slice(1));
    }
    // review / dismiss / promote
    const targetId = String(args[1] ?? '').trim();
    const note = args.slice(2).join(' ').trim() || undefined;
    return { action: first as Action, targetId, note };
  }
  // 첫 인자가 action 이 아니면 list 로 간주, 첫 인자부터 list 옵션 파싱
  return parseListArgs(args);
}

function parseListArgs(args: string[]): BugCandidatesArgs {
  let filter: FilterKey | undefined;
  let limit = DEFAULT_LIMIT;
  for (const raw of args) {
    if (raw == null) continue;
    const tok = String(raw).trim().toLowerCase();
    if (!tok) continue;
    if ((VALID_FILTER_KEYS as readonly string[]).includes(tok)) {
      filter = tok as FilterKey;
      continue;
    }
    const n = Number(tok);
    if (Number.isFinite(n) && n > 0) {
      limit = Math.min(MAX_LIMIT, Math.max(1, Math.floor(n)));
    }
  }
  return { action: 'list', filter, limit };
}

function applyFilter(candidates: BugCandidate[], filter: FilterKey | undefined): BugCandidate[] {
  if (!filter) return candidates;
  if (filter.startsWith('p')) {
    const upper = `${filter.toUpperCase()}_CANDIDATE`;
    return candidates.filter((c) => c.severity === upper);
  }
  const upperStatus = filter.toUpperCase() as BugCandidateStatus;
  return candidates.filter((c) => c.status === upperStatus);
}

const STATUS_RANK: Record<BugCandidateStatus, number> = {
  NEW: 0,
  REVIEWED: 1,
  PROMOTED: 2,
  DISMISSED: 3,
};

const SEVERITY_RANK: Record<string, number> = {
  P0_CANDIDATE: 0,
  P1_CANDIDATE: 1,
  P2_CANDIDATE: 2,
  P3_CANDIDATE: 3,
};

function sortByPriority(candidates: BugCandidate[]): BugCandidate[] {
  return [...candidates].sort((a, b) => {
    const sa = STATUS_RANK[a.status] ?? 99;
    const sb = STATUS_RANK[b.status] ?? 99;
    if (sa !== sb) return sa - sb;
    const va = SEVERITY_RANK[a.severity] ?? 99;
    const vb = SEVERITY_RANK[b.severity] ?? 99;
    if (va !== vb) return va - vb;
    return b.lastSeenAt.localeCompare(a.lastSeenAt);
  });
}

/**
 * list 결과 메시지 빌더 — 단위 테스트 가능.
 */
export function formatCandidatesListMessage(
  candidates: BugCandidate[],
  parsed: BugCandidatesArgs,
): string {
  if (candidates.length === 0) {
    return [
      '🐛 <b>BUG 후보 (P3)</b>',
      '',
      '✅ 등록된 후보 없음.',
      '',
      'ENV <code>BUG_CANDIDATE_DETECTOR_ENABLED=true</code> 활성화 + 매일 09:30 KST cron 실행 시 자동 검출.',
    ].join('\n');
  }

  const filtered = applyFilter(candidates, parsed.filter);
  const sorted = sortByPriority(filtered);
  const limit = parsed.limit ?? DEFAULT_LIMIT;
  const top = sorted.slice(0, limit);

  const lines: string[] = [];
  lines.push('🐛 <b>BUG 후보 (P3)</b>');
  lines.push('');
  const statusCounts = countStatuses(candidates);
  const statusOrder: BugCandidateStatus[] = ['NEW', 'REVIEWED', 'PROMOTED', 'DISMISSED'];
  const statusParts: string[] = [];
  for (const s of statusOrder) {
    const c = statusCounts[s] ?? 0;
    if (c > 0) statusParts.push(`${STATUS_EMOJI[s]}${s}=${c}`);
  }
  lines.push(`📊 총 ${candidates.length}건` + (statusParts.length ? ` — ${statusParts.join(' / ')}` : ''));

  if (parsed.filter) {
    lines.push(`🔍 필터: ${parsed.filter.toUpperCase()} → ${filtered.length}건`);
  }
  lines.push('');

  if (top.length === 0) {
    lines.push('해당 필터에 매칭되는 후보 없음.');
    return lines.join('\n');
  }

  lines.push(`📌 <b>Top ${top.length}/${filtered.length}</b> (status > severity > 최신순)`);
  for (const c of top) {
    lines.push(formatCandidateLine(c));
  }
  if (filtered.length > top.length) {
    lines.push('');
    lines.push(`… 외 ${filtered.length - top.length}건 (전체 영속: data/bug-candidates.json)`);
  }
  lines.push('');
  lines.push('명령:');
  lines.push('  • <code>/bug_candidates review &lt;id&gt; [메모]</code> — 검토 표기');
  lines.push('  • <code>/bug_candidates dismiss &lt;id&gt; [사유]</code> — 무시 처리');
  lines.push('  • <code>/bug_candidates promote &lt;id&gt;</code> — BUG_LEDGER 전사 의도 표기');
  lines.push('');
  lines.push('<i>※ promote 는 marker 만 — 운영자가 docs/ops/BUG_LEDGER.md 에 직접 전사 (자동 전사 영구 금지).</i>');
  return lines.join('\n');
}

function countStatuses(candidates: BugCandidate[]): Record<string, number> {
  const out: Record<string, number> = {};
  for (const c of candidates) {
    out[c.status] = (out[c.status] ?? 0) + 1;
  }
  return out;
}

function formatCandidateLine(c: BugCandidate): string {
  const stat = STATUS_EMOJI[c.status] ?? '❓';
  const sev = SEVERITY_EMOJI[c.severity] ?? '❓';
  const id = `<code>${escapeHtml(c.id)}</code>`;
  const cat = escapeHtml(c.category);
  const occ = `${c.occurrences}회`;
  return `  ${sev}${stat} ${id} [${cat}] ${occ}`;
}

const bugCandidates: TelegramCommand = {
  name: '/bug_candidates',
  aliases: ['/bugcands'],
  category: 'SYS',
  visibility: 'ADMIN',
  riskLevel: 0,
  description: 'CRITICAL 알림 패턴 기반 BUG 후보 조회 + review/dismiss/promote marker',
  usage: '/bug_candidates [list|review|dismiss|promote] [id|filter] [N|메모]',
  async execute({ args, reply }) {
    try {
      const parsed = parseBugCandidatesArgs(args);
      if (parsed.action === 'list') {
        const candidates = loadBugCandidates();
        await reply(formatCandidatesListMessage(candidates, parsed));
        return;
      }
      // review / dismiss / promote
      if (!parsed.targetId) {
        await reply(`사용법: /bug_candidates ${parsed.action} <id> [메모]`);
        return;
      }
      const candidates = loadBugCandidates();
      const target = findById(candidates, parsed.targetId);
      if (!target) {
        await reply(`❌ 후보 찾을 수 없음: <code>${escapeHtml(parsed.targetId)}</code>`);
        return;
      }
      const newStatus: BugCandidateStatus =
        parsed.action === 'review' ? 'REVIEWED'
        : parsed.action === 'dismiss' ? 'DISMISSED'
        : 'PROMOTED';
      const updated = updateCandidateStatus(candidates, parsed.targetId, newStatus, {
        now: new Date(),
        reviewedBy: 'telegram_operator',
        note: parsed.note,
      });
      saveBugCandidates(updated);
      const promoteHint = newStatus === 'PROMOTED'
        ? '\n\n⚠️ <b>운영자 수동 전사 의무</b>: <code>docs/ops/BUG_LEDGER.md</code> 에 정식 BUG ID 발급 + 항목 작성. 자동 전사는 영구 금지.'
        : '';
      await reply(
        `${STATUS_EMOJI[newStatus]} <code>${escapeHtml(parsed.targetId)}</code> → ${newStatus}` +
        (parsed.note ? `\n메모: ${escapeHtml(parsed.note)}` : '') +
        promoteHint,
      );
    } catch (e) {
      console.error('[TelegramBot] /bug_candidates 실패:', e);
      await reply('❌ /bug_candidates 실패 — 서버 로그를 확인하세요.');
    }
  },
};

commandRegistry.register(bugCandidates);

export default bugCandidates;
