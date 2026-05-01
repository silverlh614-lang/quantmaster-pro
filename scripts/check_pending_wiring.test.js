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
  fileExistsAtRoot,
  isWildcardPath,
  isModulePlaceholder,
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

  it('PR-Governance-Followup-2 — module/modulePaths/reason 캡처', () => {
    const src = [
      '### A. 학습',
      '| A1 | 0030 모듈 | `server/x.ts` | INFRASTRUCTURE_ONLY | P2 | 차단 사유 / 다음 액션 |',
      '| A2 | 0031 emit | (정성 — 격상 불가) | DECIDED_NOT_WIRING | P3 | **ADR-0154 영구 정책** — 정성 항목 |',
      '| A3 | 0032 multi | `path/a.ts` 와 `path/b.ts` 둘 | PARTIAL | P1 | 사유 |',
    ].join('\n');
    const { entries } = parsePendingWiring(src);
    expect(entries).toHaveLength(3);
    expect(entries[0].module).toBe('`server/x.ts`');
    expect(entries[0].modulePaths).toEqual(['server/x.ts']);
    expect(entries[0].reason).toBe('차단 사유 / 다음 액션');
    expect(entries[1].modulePaths).toEqual([]);
    expect(entries[1].reason).toBe('**ADR-0154 영구 정책** — 정성 항목');
    expect(entries[2].modulePaths).toEqual(['path/a.ts', 'path/b.ts']);
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
  /**
   * PR-Governance-Followup-2: entry 시그니처 확장 — module/modulePaths/reason 옵셔널.
   * 기존 테스트 케이스 호환을 위해 default 값 부여 (모두 G 검증 통과 형태).
   */
  function makeEntry(overrides) {
    return {
      id: 'A1',
      adrRefs: [],
      module: '`server/path.ts`',
      modulePaths: ['server/path.ts'],
      status: 'PARTIAL',
      priority: 'P0',
      category: 'A',
      reason: '사유 / 다음 액션 명시',
      ...overrides,
    };
  }

  function build(entries, categories = ['A', 'B', 'C', 'D', 'E'], stats = null) {
    return {
      entries,
      categories: new Set(categories),
      stats,
    };
  }

  it('정상 입력 위반 0건', () => {
    const parsed = build([makeEntry({ adrRefs: ['0001'], status: 'INFRASTRUCTURE_ONLY' })]);
    const known = new Set(['0001']);
    const { violations } = validate(parsed, known);
    expect(violations).toEqual([]);
  });

  it('A — 무효 상태', () => {
    const parsed = build([makeEntry({ status: 'DEAD_CODE' })]);
    const { violations } = validate(parsed);
    const a = violations.filter((v) => v.category === 'A_INVALID_STATE');
    expect(a).toHaveLength(1);
  });

  it('B — 무효 우선순위', () => {
    const parsed = build([makeEntry({ priority: 'P9' })]);
    const { violations } = validate(parsed);
    const b = violations.filter((v) => v.category === 'B_INVALID_PRIORITY');
    expect(b).toHaveLength(1);
  });

  it('C — 알 수 없는 ADR 참조', () => {
    const parsed = build([makeEntry({ adrRefs: ['9999'] })]);
    const known = new Set(['0001', '0002']);
    const { violations } = validate(parsed, known);
    const c = violations.filter((v) => v.category === 'C_UNKNOWN_ADR_REF');
    expect(c).toHaveLength(1);
    expect(c[0].message).toContain('9999');
  });

  it('C — knownAdrNumbers 빈 set 시 검증 skip', () => {
    const parsed = build([makeEntry({ adrRefs: ['9999'] })]);
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
    const parsed = build([makeEntry({ priority: 'P2' })], ['A', 'B', 'C', 'D', 'E'], stats);
    const { violations } = validate(parsed);
    const e = violations.filter((v) => v.category === 'E_STATS_MISMATCH');
    expect(e.length).toBeGreaterThan(0);
    expect(e.some((v) => v.message.includes('total=99') && v.message.includes('실제 1'))).toBe(true);
  });

  it('E — 통계 mismatch (priority count)', () => {
    const stats = new Map([['A', { total: 1, p0: 1, p1: 0, p2: 0, p3: 0 }]]);
    const parsed = build([makeEntry({ priority: 'P2' })], ['A', 'B', 'C', 'D', 'E'], stats);
    const { violations } = validate(parsed);
    const e = violations.filter((v) => v.category === 'E_STATS_MISMATCH');
    expect(e.some((v) => v.message.includes('A.P0=1'))).toBe(true);
    expect(e.some((v) => v.message.includes('A.P2=0'))).toBe(true);
  });

  it('F — 잘못된 ID 형식', () => {
    const parsed = build([makeEntry({ id: 'AA1' }), makeEntry({ id: '1A' })]);
    const { violations } = validate(parsed);
    const f = violations.filter((v) => v.category === 'F_INVALID_ID');
    expect(f.length).toBe(2);
  });

  it('F — ID prefix 와 카테고리 불일치', () => {
    // B1 인데 A 섹션 안
    const parsed = build([makeEntry({ id: 'B1', category: 'A' })]);
    const { violations } = validate(parsed);
    const f = violations.filter((v) => v.category === 'F_CATEGORY_MISMATCH');
    expect(f).toHaveLength(1);
  });

  /* ───────── PR-Governance-Followup-2 — G 카테고리 ───────── */

  describe('G — 백로그 등재 vs 실제 wiring 정합성', () => {
    it('rootDir 미전달 시 G1 skip (단위 테스트 기본 동작)', () => {
      // 존재하지 않는 파일이지만 rootDir 미전달이라 검증 skip
      const parsed = build([
        makeEntry({ modulePaths: ['nonexistent/fake.ts'], module: '`nonexistent/fake.ts`' }),
      ]);
      const { violations } = validate(parsed);
      const g = violations.filter((v) => v.category === 'G_MODULE_FILE_MISSING');
      expect(g).toEqual([]);
    });

    it('G1 — 모듈 경로 파일 부재 검출', () => {
      const parsed = build([
        makeEntry({
          modulePaths: ['server/nonexistent/fake.ts'],
          module: '`server/nonexistent/fake.ts`',
        }),
      ]);
      const { violations } = validate(parsed, new Set(), { rootDir: ROOT });
      const g = violations.filter((v) => v.category === 'G_MODULE_FILE_MISSING');
      expect(g).toHaveLength(1);
      expect(g[0].message).toContain('server/nonexistent/fake.ts');
    });

    it('G1 — 실제 존재하는 파일 통과', () => {
      const parsed = build([
        makeEntry({
          modulePaths: ['scripts/check_pending_wiring.js'],
          module: '`scripts/check_pending_wiring.js`',
        }),
      ]);
      const { violations } = validate(parsed, new Set(), { rootDir: ROOT });
      const g = violations.filter((v) => v.category === 'G_MODULE_FILE_MISSING');
      expect(g).toEqual([]);
    });

    it('G1 — `(신규)` placeholder skip', () => {
      const parsed = build([
        makeEntry({
          modulePaths: [],
          module: '`server/foo.ts` (신규)',
        }),
      ]);
      const { violations } = validate(parsed, new Set(), { rootDir: ROOT });
      const g = violations.filter(
        (v) => v.category === 'G_MODULE_FILE_MISSING' || v.category === 'G_MODULE_FORMAT'
      );
      expect(g).toEqual([]);
    });

    it('G1 — `(정성 — 격상 불가)` placeholder skip', () => {
      const parsed = build([
        makeEntry({
          modulePaths: [],
          module: '(정성 — 격상 불가)',
          status: 'DECIDED_NOT_WIRING',
          priority: 'P3',
          reason: '**ADR-0154 영구 정책** — 정성 항목',
        }),
      ]);
      const { violations } = validate(parsed, new Set(), { rootDir: ROOT });
      const g = violations.filter(
        (v) => v.category === 'G_MODULE_FILE_MISSING' || v.category === 'G_MODULE_FORMAT'
      );
      expect(g).toEqual([]);
    });

    it('G1 — 와일드카드 glob 경로 skip', () => {
      const parsed = build([
        makeEntry({
          modulePaths: ['src/components/**/*.tsx'],
          module: '`src/components/**/*.tsx`',
        }),
      ]);
      const { violations } = validate(parsed, new Set(), { rootDir: ROOT });
      const g = violations.filter((v) => v.category === 'G_MODULE_FILE_MISSING');
      expect(g).toEqual([]);
    });

    it('G_MODULE_FORMAT — 백틱 안 경로 0건 + placeholder 도 아님', () => {
      const parsed = build([
        makeEntry({
          modulePaths: [],
          module: '서버 학습 모듈 — 경로 명시 안 됨',
        }),
      ]);
      const { violations } = validate(parsed, new Set(), { rootDir: ROOT });
      const g = violations.filter((v) => v.category === 'G_MODULE_FORMAT');
      expect(g).toHaveLength(1);
    });

    it('G2 — DECIDED_NOT_WIRING reason 에 PR 인용', () => {
      const parsed = build([
        makeEntry({
          status: 'DECIDED_NOT_WIRING',
          reason: '**PR-A3-Audit (2026-05-01) 결과 — 100% wired 확정**',
        }),
      ]);
      const { violations } = validate(parsed, new Set(), { rootDir: ROOT });
      const g = violations.filter((v) => v.category === 'G_DECIDED_NO_AUDIT_REF');
      expect(g).toEqual([]);
    });

    it('G2 — DECIDED_NOT_WIRING reason 에 ADR 인용 (정성 영구 항목)', () => {
      const parsed = build([
        makeEntry({
          status: 'DECIDED_NOT_WIRING',
          module: '(정성 — 격상 불가)',
          modulePaths: [],
          reason: '**ADR-0154 영구 정책** — 정성 항목',
        }),
      ]);
      const { violations } = validate(parsed, new Set(), { rootDir: ROOT });
      const g = violations.filter((v) => v.category === 'G_DECIDED_NO_AUDIT_REF');
      expect(g).toEqual([]);
    });

    it('G2 — DECIDED_NOT_WIRING reason 에 audit 인용 부재 시 차단', () => {
      const parsed = build([
        makeEntry({
          status: 'DECIDED_NOT_WIRING',
          reason: '결정됨 — 후속 wiring 안 함',
        }),
      ]);
      const { violations } = validate(parsed, new Set(), { rootDir: ROOT });
      const g = violations.filter((v) => v.category === 'G_DECIDED_NO_AUDIT_REF');
      expect(g).toHaveLength(1);
    });

    it('G2 — INFRASTRUCTURE_ONLY 는 G2 적용 안 함 (DECIDED_NOT_WIRING 만)', () => {
      const parsed = build([
        makeEntry({
          status: 'INFRASTRUCTURE_ONLY',
          reason: '단순 사유',
        }),
      ]);
      const { violations } = validate(parsed, new Set(), { rootDir: ROOT });
      const g = violations.filter((v) => v.category === 'G_DECIDED_NO_AUDIT_REF');
      expect(g).toEqual([]);
    });

    it('G3 — INFRASTRUCTURE_ONLY 빈 reason 차단', () => {
      const parsed = build([
        makeEntry({
          status: 'INFRASTRUCTURE_ONLY',
          reason: '',
        }),
      ]);
      const { violations } = validate(parsed, new Set(), { rootDir: ROOT });
      const g = violations.filter((v) => v.category === 'G_EMPTY_REASON');
      expect(g).toHaveLength(1);
    });

    it('G3 — PARTIAL 너무 짧은 reason (separator 만) 차단', () => {
      const parsed = build([
        makeEntry({
          status: 'PARTIAL',
          reason: '— —',
        }),
      ]);
      const { violations } = validate(parsed, new Set(), { rootDir: ROOT });
      const g = violations.filter((v) => v.category === 'G_EMPTY_REASON');
      expect(g).toHaveLength(1);
    });

    it('G3 — BLOCKED 정상 reason 통과', () => {
      const parsed = build([
        makeEntry({
          status: 'BLOCKED',
          reason: '운영자 ENV 활성화 + 1주 검증 후',
        }),
      ]);
      const { violations } = validate(parsed, new Set(), { rootDir: ROOT });
      const g = violations.filter((v) => v.category === 'G_EMPTY_REASON');
      expect(g).toEqual([]);
    });

    it('G3 — DECIDED_NOT_WIRING 은 G3 적용 안 함', () => {
      // DECIDED_NOT_WIRING 항목은 G2 만 적용 (audit 인용 의무), reason 길이 제약 없음
      const parsed = build([
        makeEntry({
          status: 'DECIDED_NOT_WIRING',
          reason: '완료',
        }),
      ]);
      const { violations } = validate(parsed, new Set(), { rootDir: ROOT });
      const g = violations.filter((v) => v.category === 'G_EMPTY_REASON');
      expect(g).toEqual([]);
    });
  });
});

/* ───────── PR-Governance-Followup-2 헬퍼 ───────── */

describe('헬퍼 함수 (G 카테고리)', () => {
  describe('fileExistsAtRoot', () => {
    it('존재하는 파일 true', () => {
      expect(fileExistsAtRoot(ROOT, 'scripts/check_pending_wiring.js')).toBe(true);
    });

    it('존재하는 디렉토리 true', () => {
      expect(fileExistsAtRoot(ROOT, 'server')).toBe(true);
    });

    it('부재 파일 false', () => {
      expect(fileExistsAtRoot(ROOT, 'nonexistent/fake.ts')).toBe(false);
    });

    it('와일드카드 false (skip 의도)', () => {
      expect(fileExistsAtRoot(ROOT, 'src/**/*.tsx')).toBe(false);
    });

    it('빈 문자열 false', () => {
      expect(fileExistsAtRoot(ROOT, '')).toBe(false);
    });

    it('null 안전 false', () => {
      expect(fileExistsAtRoot(ROOT, null)).toBe(false);
    });
  });

  describe('isWildcardPath', () => {
    it('* 검출', () => {
      expect(isWildcardPath('src/**/*.tsx')).toBe(true);
    });

    it('? 검출', () => {
      expect(isWildcardPath('file?.ts')).toBe(true);
    });

    it('일반 경로 false', () => {
      expect(isWildcardPath('src/foo.ts')).toBe(false);
    });

    it('빈/null 안전', () => {
      expect(isWildcardPath('')).toBe(false);
      expect(isWildcardPath(null)).toBe(false);
    });
  });

  describe('isModulePlaceholder', () => {
    it('(신규) 검출', () => {
      expect(isModulePlaceholder('`server/foo.ts` (신규)')).toBe(true);
    });

    it('(정성 — 격상 불가) 검출', () => {
      expect(isModulePlaceholder('(정성 — 격상 불가)')).toBe(true);
    });

    it('(예정) 검출', () => {
      expect(isModulePlaceholder('(예정 — 후속 PR)')).toBe(true);
    });

    it('일반 경로 false', () => {
      expect(isModulePlaceholder('`server/foo.ts`')).toBe(false);
    });

    it('빈/null 안전', () => {
      expect(isModulePlaceholder('')).toBe(false);
      expect(isModulePlaceholder(null)).toBe(false);
    });
  });
});
