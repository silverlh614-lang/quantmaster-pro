// @responsibility BUG_LEDGER.md 영속 read-only repo — frontmatter 파싱, status/severity 별 집계.

import { readFileSync, existsSync } from 'node:fs';
import { dirname, resolve, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const DEFAULT_ROOT = resolve(__dirname, '..', '..');
const DEFAULT_LEDGER_PATH = join(DEFAULT_ROOT, 'docs', 'ops', 'BUG_LEDGER.md');

export type BugStatus =
  | 'OPEN'
  | 'PATCHED'
  | 'VERIFIED'
  | 'WATCHING'
  | 'CLOSED'
  | 'WONTFIX';

export type BugSeverity = 'P0' | 'P1' | 'P2' | 'P3';

export interface BugEntry {
  id: string;
  status: BugStatus | string;
  severity: BugSeverity | string;
  area: string;
  discovered: string;
  resolved: string | null;
  related_adrs: string[];
  related_bugs: string[];
  keywords: string[];
  recurrence_count: number;
  /** ## H3 후 첫 줄 (heading 자체 제외) — 짧은 요약. */
  summary: string;
}

export interface LoadBugLedgerOptions {
  rootDir?: string;
  ledgerPath?: string;
}

const VALID_STATUSES: ReadonlySet<string> = new Set([
  'OPEN', 'PATCHED', 'VERIFIED', 'WATCHING', 'CLOSED', 'WONTFIX',
]);

const VALID_SEVERITIES: ReadonlySet<string> = new Set(['P0', 'P1', 'P2', 'P3']);

/**
 * BUG_LEDGER.md 안의 ---frontmatter--- 블록을 추출한다.
 * 코드 펜스 안 `---` 은 frontmatter 가 아니므로 제외.
 */
function extractFrontmatterBlocks(src: string): Array<{ block: string; afterIndex: number }> {
  const blocks: Array<{ block: string; afterIndex: number }> = [];
  if (typeof src !== 'string') return blocks;
  const lines = src.split('\n');
  let i = 0;
  let inFence = false;
  while (i < lines.length) {
    const line = lines[i];
    if (/^```/.test(line.trim())) {
      inFence = !inFence;
      i++;
      continue;
    }
    if (!inFence && line.trim() === '---') {
      let j = i + 1;
      while (j < lines.length && lines[j].trim() !== '---') j++;
      if (j >= lines.length) { i++; continue; }
      const block = lines.slice(i + 1, j).join('\n');
      if (/^\s*id\s*:\s*BUG-/m.test(block)) {
        // 본문 끝 — 다음 frontmatter `---` + `id:` 또는 EOF
        let bodyEnd = j + 1;
        let bodyFence = false;
        while (bodyEnd < lines.length) {
          const bl = lines[bodyEnd];
          if (/^```/.test(bl.trim())) { bodyFence = !bodyFence; bodyEnd++; continue; }
          if (!bodyFence && bl.trim() === '---' && bodyEnd + 1 < lines.length
              && /^\s*id\s*:/.test(lines[bodyEnd + 1])) {
            break;
          }
          bodyEnd++;
        }
        blocks.push({ block: block + '\n--BODY--\n' + lines.slice(j + 1, bodyEnd).join('\n'), afterIndex: bodyEnd });
        i = bodyEnd;
        continue;
      }
    }
    i++;
  }
  return blocks;
}

function parseFrontmatterValue(value: string): string | number | null | string[] {
  const v = value.trim();
  if (v === '' || v === '~') return null;
  if (v === 'null' || v === 'Null' || v === 'NULL') return null;
  if (v.startsWith('[') && v.endsWith(']')) {
    const inner = v.slice(1, -1).trim();
    if (!inner) return [];
    return inner.split(',').map((s) => s.trim().replace(/^['"]|['"]$/g, ''));
  }
  if (/^-?\d+$/.test(v)) return parseInt(v, 10);
  return v.replace(/^['"]|['"]$/g, '');
}

function parseEntry(combined: string): BugEntry | null {
  const [fmPart, body = ''] = combined.split('\n--BODY--\n');
  const fm: Record<string, unknown> = {};
  for (const raw of fmPart.split('\n')) {
    const line = raw.trim();
    if (!line) continue;
    const m = line.match(/^([a-z_][a-z0-9_]*)\s*:\s*(.*)$/i);
    if (!m) continue;
    fm[m[1]] = parseFrontmatterValue(m[2]);
  }
  if (typeof fm.id !== 'string' || !/^BUG-\d{4}-\d{2}-\d{2}-\d{3}$/.test(fm.id)) {
    return null;
  }

  // body 의 첫 본문 단락 — `## BUG-...` heading 다음 줄 또는 `### 증상 (What)` 다음 줄
  let summary = '';
  for (const raw of body.split('\n')) {
    const t = raw.trim();
    if (!t) continue;
    if (/^#{1,6}\s/.test(t)) continue;          // heading skip
    if (/^[*_]{2,}/.test(t)) continue;           // bold separator skip
    if (t.startsWith('<!--') || t.startsWith('-->')) continue;
    if (t === '---') continue;
    summary = t;
    break;
  }

  const recurrence = typeof fm.recurrence_count === 'number'
    ? fm.recurrence_count
    : 0;

  const relatedAdrs = Array.isArray(fm.related_adrs)
    ? (fm.related_adrs as unknown[]).filter((x): x is string => typeof x === 'string')
    : [];
  const relatedBugs = Array.isArray(fm.related_bugs)
    ? (fm.related_bugs as unknown[]).filter((x): x is string => typeof x === 'string')
    : [];
  const keywords = Array.isArray(fm.keywords)
    ? (fm.keywords as unknown[]).filter((x): x is string => typeof x === 'string')
    : [];

  return {
    id: fm.id,
    status: typeof fm.status === 'string' ? fm.status : 'UNKNOWN',
    severity: typeof fm.severity === 'string' ? fm.severity : 'UNKNOWN',
    area: typeof fm.area === 'string' ? fm.area : '',
    discovered: typeof fm.discovered === 'string' ? fm.discovered : '',
    resolved: typeof fm.resolved === 'string' ? fm.resolved : null,
    related_adrs: relatedAdrs,
    related_bugs: relatedBugs,
    keywords,
    recurrence_count: recurrence,
    summary,
  };
}

export function loadBugLedger(opts: LoadBugLedgerOptions = {}): BugEntry[] {
  const path = opts.ledgerPath
    ?? (opts.rootDir ? join(opts.rootDir, 'docs', 'ops', 'BUG_LEDGER.md') : DEFAULT_LEDGER_PATH);
  if (!existsSync(path)) return [];
  let src: string;
  try {
    src = readFileSync(path, 'utf8');
  } catch {
    return [];
  }
  const blocks = extractFrontmatterBlocks(src);
  const entries: BugEntry[] = [];
  for (const b of blocks) {
    const e = parseEntry(b.block);
    if (e) entries.push(e);
  }
  return entries;
}

export interface BugLedgerSummary {
  total: number;
  byStatus: Record<string, number>;
  bySeverity: Record<string, number>;
  byArea: Record<string, number>;
}

export function summarizeBugLedger(entries: BugEntry[]): BugLedgerSummary {
  const byStatus: Record<string, number> = {};
  const bySeverity: Record<string, number> = {};
  const byArea: Record<string, number> = {};
  for (const e of entries) {
    byStatus[e.status] = (byStatus[e.status] ?? 0) + 1;
    bySeverity[e.severity] = (bySeverity[e.severity] ?? 0) + 1;
    byArea[e.area] = (byArea[e.area] ?? 0) + 1;
  }
  return { total: entries.length, byStatus, bySeverity, byArea };
}

/**
 * 우선순위 정렬 SSOT — 운영자가 가장 시급한 BUG 를 먼저 본다.
 * - status 우선순위: OPEN > PATCHED > VERIFIED > WATCHING > CLOSED > WONTFIX > 기타
 * - severity 우선순위: P0 > P1 > P2 > P3 > 기타
 * - 같으면 discovered 내림차순 (최신 우선)
 */
const STATUS_RANK: Record<string, number> = {
  OPEN: 0, PATCHED: 1, VERIFIED: 2, WATCHING: 3, CLOSED: 4, WONTFIX: 5,
};
const SEVERITY_RANK: Record<string, number> = {
  P0: 0, P1: 1, P2: 2, P3: 3,
};

export function sortBugsByPriority(entries: BugEntry[]): BugEntry[] {
  return [...entries].sort((a, b) => {
    const sa = STATUS_RANK[a.status] ?? 99;
    const sb = STATUS_RANK[b.status] ?? 99;
    if (sa !== sb) return sa - sb;
    const va = SEVERITY_RANK[a.severity] ?? 99;
    const vb = SEVERITY_RANK[b.severity] ?? 99;
    if (va !== vb) return va - vb;
    if (a.discovered !== b.discovered) return b.discovered.localeCompare(a.discovered);
    return a.id.localeCompare(b.id);
  });
}

export function isValidStatus(s: string): s is BugStatus {
  return VALID_STATUSES.has(s);
}

export function isValidSeverity(s: string): s is BugSeverity {
  return VALID_SEVERITIES.has(s);
}
