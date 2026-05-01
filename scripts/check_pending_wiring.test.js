/**
 * @responsibility check_pending_wiring.js 회귀 테스트 (PR-Governance 후속 자동화 #2)
 *
 * 검증:
 *   - baseline EXIT=0 (현재 PENDING_WIRING.md 정합)
 *   - parsePendingWiring: 백로그 행 / 카테고리 / 통계 표 파싱
 *   - extractAllAdrNumbers: INDEX.md 등재 번호 set
 *   - validate: 6 카테고리 (A 상태 / B 우선순위 / C ADR 참조 / D 카테고리 누락 / E 통계 / F ID)
 */

import { describe, it, expect } from 'vitest';
import { execSync } from 'node:child_process';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  parsePendingWiring,
  extractAllAdrNumbers,
  validate,
  VALID_STATES,
  VALID_PRIORITIES,
  EXPECTED_CATEGORIES,
} from './check_pending_wiring.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const ROOT = join(__dirname, '..');

function runLint(args = '') {
  try {
    const out = execSync(`node scripts/check_pending_wiring.js ${args}`.trim(), {
      cwd: ROOT,
      encoding: 'utf-8',
      stdio: ['pipe', 'pipe', 'pipe'],
    });
    return { exitCode: 0, output: out };
  } catch (err) {
    return {
      exitCode: err.status ?? 1,
      output: (err.stdout?.toString() ?? '') + (err.stderr?.toString() ?? ''),
    };
  }
}

describe('check_pending_wiring — baseline', () => {
  it('현재 PENDING_WIRING.md 정합 EXIT=0', () => {
    const result = runLint();
    expect(result.exitCode).toBe(0);
    expect(result.output).toContain('OK');
    expect(result.output).toContain('5개 카테고리');
  });

  it('--json 출력 violations 빈 배열', () => {
    const result = runLint('--json');
    expect(result.exitCode).toBe(0);
    const parsed = JSON.parse(result.output);
    expect(parsed.violations).toEqual([]);
    expect(parsed.summary.entryCount).toBeGreaterThan(20);
    expect(parsed.summary.categoryCount).toBe(5);
    expect(parsed.summary.hasStats).toBe(true);
  });
});

describe('상수 SSOT', () => {
  it('VALID_STATES 4 분기', () => {
    expect(VALID_STATES.size).toBe(4);
    expect([...VALID_STATES]).toEqual(
      expect.arrayContaining(['INFRASTRUCTURE_ONLY', 'PARTIAL', 'BLOCKED', 'DECIDED_NOT_WIRING'])
    );
  });

  it('VALID_PRIORITIES 4 등급', () => {
    expect(VALID_PRIORITIES.size).toBe(4);
    expect([...VALID_PRIORITIES]).toEqual(expect.arrayContaining(['P0', 'P1', 'P2', 'P3']));
  });

  it('EXPECTED_CATEGORIES 5종', () => {
    expect(EXPECTED_CATEGORIES).toEqual(['A', 'B', 'C', 'D', 'E']);
  });
});

describe('parsePendingWiring', () => {
  it('카테고리 헤더 추출', () => {
    const src = [
      '### A. 학습',
      '### B. 매매',
      '### E. 영속',
    ].join('\n');
    const { categories } = parsePendingWiring(src);
    expect([...categories].sort()).toEqual(['A', 'B', 'E']);
  });

  it('백로그 행 파싱 — id/adrRefs/status/priority', () => {
    const src = [
      '### A. 학습',
      '| A1 | 0030 latentSignalScorer | `path/x.ts` | INFRASTRUCTURE_ONLY | P2 | 사유 |',
      '| A3 | 0006 emit + 0019 lifecycle | `path/y.ts` | PARTIAL | P0 | 사유 |',
    ].join('\n');
    const { entries } = parsePendingWiring(src);
    expect(entries).toHaveLength(2);
    expect(entries[0]).toMatchObject({
      id: 'A1',
      adrRefs: ['0030'],
      status: 'INFRASTRUCTURE_ONLY',
      priority: 'P2',
      category: 'A',
    });
    expect(entries[1].adrRefs).toEqual(['0006', '0019']);
  });

  it('통계 표 파싱', () => {
    const src = [
      '## 진행 통계',
      '',
      '| 카테고리 | 항목 수 | P0 | P1 | P2 | P3 |',
      '|----------|---------|----|----|----|----|',
      '| A. 학습 | 7 | 1 | 3 | 3 | 0 |',
      '| B. 매매 | 6 | 1 | 3 | 2 | 0 |',
      '| **합계** | **13** | **2** | **6** | **5** | **0** |',
    ].join('\n');
    const { stats } = parsePendingWiring(src);
    expect(stats).not.toBeNull();
    expect(stats.get('A')).toEqual({ total: 7, p0: 1, p1: 3, p2: 3, p3: 0 });
    expect(stats.get('B')).toEqual({ total: 6, p0: 1, p1: 3, p2: 2, p3: 0 });
  });

  it('통계 표 부재 시 stats null', () => {
    const src = '### A. 학습\n| A1 | 0001 | x | INFRASTRUCTURE_ONLY | P0 | 사유 |\n';
    const { stats } = parsePendingWiring(src);
    expect(stats).toBeNull();
  });

  it('통계 표 종료 후 다음 ## 헤더에서 빠짐', () => {
    const src = [
      '## 진행 통계',
      '| 카테고리 | 항목 수 | P0 | P1 | P2 | P3 |',
      '| A. 학습 | 7 | 1 | 3 | 3 | 0 |',
      '## 다른 섹션',
      '| C. 가짜 | 9 | 9 | 9 | 9 | 9 |',
    ].join('\n');
    const { stats } = parsePendingWiring(src);
    expect(stats.get('A')).toBeDefined();
    expect(stats.has('C')).toBe(false);
  });
});

describe('extractAllAdrNumbers', () => {
  it('§"전체 인덱스" 행 추출', () => {
    const src = [
      '## 전체 인덱스',
      '| 0001 | foo | refactor |',
      '| 0050 | bar | data |',
      '| **0143** | *(누락)* | — |',
    ].join('\n');
    const set = extractAllAdrNumbers(src);
    expect(set.has('0001')).toBe(true);
    expect(set.has('0050')).toBe(true);
    expect(set.has('0143')).toBe(true);
  });

  it('§"알려진 충돌" 도 포함', () => {
    const src = [
      '## 알려진 충돌',
      '| 0028 | `0028-a.md` | foo | PR-1 | 비고 |',
      '## 전체 인덱스',
      '| 0001 | bar | data |',
    ].join('\n');
    const set = extractAllAdrNumbers(src);
    expect(set.has('0028')).toBe(true);
    expect(set.has('0001')).toBe(true);
  });

  it('빈 입력 빈 set', () => {
    expect(extractAllAdrNumbers('').size).toBe(0);
  });
});

describe('validate', () => {
  function build(entries, categories = ['A', 'B', 'C', 'D', 'E'], stats = null) {
    return {
      entries,
      categories: new Set(categories),
      stats,
    };
  }

  it('정상 입력 위반 0건', () => {
    const parsed = build([
      { id: 'A1', adrRefs: ['0001'], status: 'INFRASTRUCTURE_ONLY', priority: 'P0', category: 'A' },
    ]);
    const known = new Set(['0001']);
    const { violations } = validate(parsed, known);
    expect(violations).toEqual([]);
  });

  it('A — 무효 상태', () => {
    const parsed = build([
      { id: 'A1', adrRefs: [], status: 'DEAD_CODE', priority: 'P0', category: 'A' },
    ]);
    const { violations } = validate(parsed);
    const a = violations.filter((v) => v.category === 'A_INVALID_STATE');
    expect(a).toHaveLength(1);
  });

  it('B — 무효 우선순위', () => {
    const parsed = build([
      { id: 'A1', adrRefs: [], status: 'PARTIAL', priority: 'P9', category: 'A' },
    ]);
    const { violations } = validate(parsed);
    const b = violations.filter((v) => v.category === 'B_INVALID_PRIORITY');
    expect(b).toHaveLength(1);
  });

  it('C — 알 수 없는 ADR 참조', () => {
    const parsed = build([
      { id: 'A1', adrRefs: ['9999'], status: 'PARTIAL', priority: 'P0', category: 'A' },
    ]);
    const known = new Set(['0001', '0002']);
    const { violations } = validate(parsed, known);
    const c = violations.filter((v) => v.category === 'C_UNKNOWN_ADR_REF');
    expect(c).toHaveLength(1);
    expect(c[0].message).toContain('9999');
  });

  it('C — knownAdrNumbers 빈 set 시 검증 skip', () => {
    const parsed = build([
      { id: 'A1', adrRefs: ['9999'], status: 'PARTIAL', priority: 'P0', category: 'A' },
    ]);
    const { violations } = validate(parsed, new Set());
    const c = violations.filter((v) => v.category === 'C_UNKNOWN_ADR_REF');
    expect(c).toEqual([]);
  });

  it('D — 카테고리 누락', () => {
    const parsed = build([], ['A', 'B']);
    const { violations } = validate(parsed);
    const d = violations.filter((v) => v.category === 'D_MISSING_CATEGORY');
    expect(d.length).toBe(3); // C, D, E 누락
  });

  it('E — 통계 mismatch (total)', () => {
    const stats = new Map([['A', { total: 99, p0: 0, p1: 0, p2: 0, p3: 0 }]]);
    const parsed = build(
      [{ id: 'A1', adrRefs: [], status: 'PARTIAL', priority: 'P2', category: 'A' }],
      ['A', 'B', 'C', 'D', 'E'],
      stats
    );
    const { violations } = validate(parsed);
    const e = violations.filter((v) => v.category === 'E_STATS_MISMATCH');
    expect(e.length).toBeGreaterThan(0);
    expect(e.some((v) => v.message.includes('total=99') && v.message.includes('실제 1'))).toBe(true);
  });

  it('E — 통계 mismatch (priority count)', () => {
    const stats = new Map([['A', { total: 1, p0: 1, p1: 0, p2: 0, p3: 0 }]]);
    const parsed = build(
      [{ id: 'A1', adrRefs: [], status: 'PARTIAL', priority: 'P2', category: 'A' }],
      ['A', 'B', 'C', 'D', 'E'],
      stats
    );
    const { violations } = validate(parsed);
    const e = violations.filter((v) => v.category === 'E_STATS_MISMATCH');
    expect(e.some((v) => v.message.includes('A.P0=1'))).toBe(true);
    expect(e.some((v) => v.message.includes('A.P2=0'))).toBe(true);
  });

  it('F — 잘못된 ID 형식', () => {
    const parsed = build([
      { id: 'AA1', adrRefs: [], status: 'PARTIAL', priority: 'P0', category: 'A' },
      { id: '1A', adrRefs: [], status: 'PARTIAL', priority: 'P0', category: 'A' },
    ]);
    const { violations } = validate(parsed);
    const f = violations.filter((v) => v.category === 'F_INVALID_ID');
    expect(f.length).toBe(2);
  });

  it('F — ID prefix 와 카테고리 불일치', () => {
    const parsed = build([
      { id: 'B1', adrRefs: [], status: 'PARTIAL', priority: 'P0', category: 'A' }, // B1 인데 A 섹션 안
    ]);
    const { violations } = validate(parsed);
    const f = violations.filter((v) => v.category === 'F_CATEGORY_MISMATCH');
    expect(f).toHaveLength(1);
  });
});
