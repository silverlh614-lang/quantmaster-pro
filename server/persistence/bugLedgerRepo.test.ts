/**
 * @responsibility bugLedgerRepo 회귀 테스트 (PR #669/#670 후속 P2-A)
 *
 * 검증:
 *   - loadBugLedger: 빈 / 정상 / 손상 fallback / 다중 entry / heading-only 차단
 *   - summarizeBugLedger: status/severity/area 카운트
 *   - sortBugsByPriority: status 우선 → severity → discovered desc
 *   - isValidStatus / isValidSeverity
 */

import { describe, it, expect, afterEach } from 'vitest';
import { mkdtempSync, writeFileSync, rmSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import {
  loadBugLedger,
  summarizeBugLedger,
  sortBugsByPriority,
  isValidStatus,
  isValidSeverity,
} from './bugLedgerRepo.js';

const tempDirs: string[] = [];
afterEach(() => {
  for (const d of tempDirs) {
    try { rmSync(d, { recursive: true, force: true }); } catch { /* ignore */ }
  }
  tempDirs.length = 0;
});

function makeRoot(ledger: string | null): string {
  const dir = mkdtempSync(join(tmpdir(), 'bug-ledger-repo-'));
  tempDirs.push(dir);
  const opsDir = join(dir, 'docs', 'ops');
  mkdirSync(opsDir, { recursive: true });
  if (ledger != null) {
    writeFileSync(join(opsDir, 'BUG_LEDGER.md'), ledger, 'utf8');
  }
  return dir;
}

const VALID_ENTRY = `---
id: BUG-2026-05-07-001
status: OPEN
severity: P0
area: Market Truth Layer
discovered: 2026-05-07
resolved: null
related_adrs: [ADR-0412, ADR-0414]
related_bugs: []
keywords: [holiday, base-date]
recurrence_count: 0
---

## BUG-2026-05-07-001 — 휴장일 기준일 혼합 위험

### 증상 (What)

휴장일과 장중 기준일이 모듈마다 다르게 계산될 수 있다.
`;

describe('bugLedgerRepo — loadBugLedger', () => {
  it('파일 부재 시 빈 배열', () => {
    const root = makeRoot(null);
    expect(loadBugLedger({ rootDir: root })).toEqual([]);
  });

  it('정상 1건 추출', () => {
    const root = makeRoot(VALID_ENTRY);
    const entries = loadBugLedger({ rootDir: root });
    expect(entries).toHaveLength(1);
    expect(entries[0].id).toBe('BUG-2026-05-07-001');
    expect(entries[0].status).toBe('OPEN');
    expect(entries[0].severity).toBe('P0');
    expect(entries[0].area).toBe('Market Truth Layer');
    expect(entries[0].related_adrs).toEqual(['ADR-0412', 'ADR-0414']);
    expect(entries[0].keywords).toEqual(['holiday', 'base-date']);
    expect(entries[0].recurrence_count).toBe(0);
    expect(entries[0].resolved).toBeNull();
    expect(entries[0].summary).toContain('휴장일');
  });

  it('손상 frontmatter (id 형식 위반) 시 entry 무시', () => {
    const bad = `---
id: NOT-A-BUG
status: OPEN
---
body`;
    const root = makeRoot(bad);
    expect(loadBugLedger({ rootDir: root })).toEqual([]);
  });

  it('heading 만 있고 frontmatter 부재 — entry 0건', () => {
    const headingOnly = '## BUG-2026-05-07-001 — heading\n본문';
    const root = makeRoot(headingOnly);
    expect(loadBugLedger({ rootDir: root })).toEqual([]);
  });

  it('다중 entry 추출', () => {
    const e2 = `---
id: BUG-2026-05-07-002
status: PATCHED
severity: P1
area: Risk Layer
discovered: 2026-05-07
resolved: 2026-05-08
related_adrs: []
related_bugs: []
keywords: []
recurrence_count: 0
---

## body2`;
    const root = makeRoot(VALID_ENTRY + '\n' + e2);
    const entries = loadBugLedger({ rootDir: root });
    expect(entries).toHaveLength(2);
    expect(entries[0].id).toBe('BUG-2026-05-07-001');
    expect(entries[1].id).toBe('BUG-2026-05-07-002');
    expect(entries[1].status).toBe('PATCHED');
    expect(entries[1].resolved).toBe('2026-05-08');
  });

  it('frontmatter 표준 코드 펜스 안 `---` 무시', () => {
    const src = '# 표준\n```yaml\n---\nid: BUG-2026-01-01-001\nstatus: OPEN\n---\n```\n\n실제 항목 없음';
    const root = makeRoot(src);
    expect(loadBugLedger({ rootDir: root })).toEqual([]);
  });

  it('recurrence_count 정수 파싱', () => {
    const e = `---
id: BUG-2026-05-07-003
status: WATCHING
severity: P2
area: Diagnostics Layer
discovered: 2026-05-01
resolved: 2026-05-05
related_adrs: []
related_bugs: []
keywords: []
recurrence_count: 3
---

## body`;
    const root = makeRoot(e);
    expect(loadBugLedger({ rootDir: root })[0].recurrence_count).toBe(3);
  });
});

describe('bugLedgerRepo — summarizeBugLedger', () => {
  it('빈 배열', () => {
    const s = summarizeBugLedger([]);
    expect(s.total).toBe(0);
    expect(s.byStatus).toEqual({});
    expect(s.bySeverity).toEqual({});
    expect(s.byArea).toEqual({});
  });

  it('status / severity / area 카운트', () => {
    const root = makeRoot(VALID_ENTRY);
    const entries = loadBugLedger({ rootDir: root });
    const s = summarizeBugLedger(entries);
    expect(s.total).toBe(1);
    expect(s.byStatus.OPEN).toBe(1);
    expect(s.bySeverity.P0).toBe(1);
    expect(s.byArea['Market Truth Layer']).toBe(1);
  });
});

describe('bugLedgerRepo — sortBugsByPriority', () => {
  function entry(id: string, status: string, severity: string, discovered: string) {
    return {
      id, status, severity, area: 'X', discovered, resolved: null,
      related_adrs: [], related_bugs: [], keywords: [], recurrence_count: 0,
      summary: '',
    };
  }

  it('status 우선 — OPEN < PATCHED < WATCHING < CLOSED', () => {
    const e1 = entry('BUG-2026-01-01-001', 'CLOSED', 'P0', '2026-01-01');
    const e2 = entry('BUG-2026-01-02-001', 'OPEN', 'P3', '2026-01-02');
    const e3 = entry('BUG-2026-01-03-001', 'WATCHING', 'P0', '2026-01-03');
    const sorted = sortBugsByPriority([e1, e2, e3]);
    expect(sorted.map((e) => e.id)).toEqual([
      'BUG-2026-01-02-001',  // OPEN P3
      'BUG-2026-01-03-001',  // WATCHING P0
      'BUG-2026-01-01-001',  // CLOSED P0
    ]);
  });

  it('status 같으면 severity 우선 — P0 < P3', () => {
    const e1 = entry('BUG-2026-01-01-001', 'OPEN', 'P3', '2026-01-01');
    const e2 = entry('BUG-2026-01-02-001', 'OPEN', 'P0', '2026-01-02');
    const sorted = sortBugsByPriority([e1, e2]);
    expect(sorted.map((e) => e.id)).toEqual([
      'BUG-2026-01-02-001',  // OPEN P0
      'BUG-2026-01-01-001',  // OPEN P3
    ]);
  });

  it('status / severity 같으면 discovered 내림차순 (최신 우선)', () => {
    const e1 = entry('BUG-2026-01-01-001', 'OPEN', 'P0', '2026-01-01');
    const e2 = entry('BUG-2026-01-02-001', 'OPEN', 'P0', '2026-01-02');
    const sorted = sortBugsByPriority([e1, e2]);
    expect(sorted.map((e) => e.id)).toEqual(['BUG-2026-01-02-001', 'BUG-2026-01-01-001']);
  });
});

describe('bugLedgerRepo — type guards', () => {
  it('isValidStatus', () => {
    expect(isValidStatus('OPEN')).toBe(true);
    expect(isValidStatus('PATCHED')).toBe(true);
    expect(isValidStatus('WATCHING')).toBe(true);
    expect(isValidStatus('CLOSED')).toBe(true);
    expect(isValidStatus('IN_PROGRESS')).toBe(false);
    expect(isValidStatus('open')).toBe(false);
  });

  it('isValidSeverity', () => {
    expect(isValidSeverity('P0')).toBe(true);
    expect(isValidSeverity('P3')).toBe(true);
    expect(isValidSeverity('P9')).toBe(false);
    expect(isValidSeverity('p0')).toBe(false);
  });
});
