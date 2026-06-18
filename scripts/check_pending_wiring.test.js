/**
 * @responsibility check_pending_wiring.js 회귀 테스트 (PR-Governance 후속 자동화 #2)
 *
 * 검증:
 *   - baseline EXIT=0 (현재 PENDING_WIRING.md 정합)
 *   - parsePendingWiring: 백로그 행 / 카테고리 / 통계 표 파싱
 *   - extractAllAdrNumbers: INDEX.md 등재 번호 set
 *   - validate: 6 카테고리 (A 상태 / B 우선순위 / C ADR 참조 / D 카테고리 누락 / E 통계 / F ID)
 */

import { describe, it, expect, afterEach } from 'vitest';
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
  // PR-Governance-3-SLA (ADR-0158): SLA 헬퍼
  SLA_DAYS,
  DEFAULT_GRACE_DAYS,
  isWiringSlaDisabled,
  getWiringSlaGraceDays,
  isValidEnteredAt,
  computeAgeDays,
  isSlaExempt,
  evaluateSla,
  // PR-Governance-StaleUserDecision: 사용자결정 부채 재검토 헬퍼
  DEFAULT_USER_DECISION_REVIEW_DAYS,
  getUserDecisionReviewDays,
  isUserDecisionReviewDisabled,
  isUserDecisionDebt,
  findLastReviewDate,
  evaluateUserDecisionStaleness,
} from './check_pending_wiring.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const ROOT = join(__dirname, '..');

function runLint(args = '', env = {}) {
  try {
    const out = execSync(`node scripts/check_pending_wiring.js ${args}`.trim(), {
      cwd: ROOT,
      encoding: 'utf-8',
      stdio: ['pipe', 'pipe', 'pipe'],
      env: { ...process.env, ...env },
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
  // SLA 임박(H) / 사용자결정 재검토(I) 는 informational WARN(EXIT=0)이며 날짜 경과로 변동.
  // baseline 구조 정합은 시간 의존 WARN 을 끈 상태로 결정적 검증한다.
  const NO_TIME_WARN_ENV = { WIRING_SLA_DISABLED: 'true', USER_DECISION_REVIEW_DISABLED: 'true' };

  it('현재 PENDING_WIRING.md 구조 정합 EXIT=0 (시간 의존 WARN 제외)', () => {
    const result = runLint('', NO_TIME_WARN_ENV);
    expect(result.exitCode).toBe(0);
    expect(result.output).toContain('OK');
    expect(result.output).toContain('5개 카테고리');
  });

  it('--json 구조 위반 0건 (시간 의존 WARN 제외)', () => {
    const result = runLint('--json', NO_TIME_WARN_ENV);
    expect(result.exitCode).toBe(0);
    const parsed = JSON.parse(result.output);
    expect(parsed.violations).toEqual([]);
    expect(parsed.summary.entryCount).toBeGreaterThan(20);
    expect(parsed.summary.categoryCount).toBe(5);
    expect(parsed.summary.hasStats).toBe(true);
  });

  it('실제 백로그 — H/I WARN 이 있어도 FAIL 0 · EXIT=0 (informational)', () => {
    const result = runLint('--json');
    expect(result.exitCode).toBe(0);
    const parsed = JSON.parse(result.output);
    expect(parsed.fails).toEqual([]); // SLA/사용자결정 WARN 은 fails 아님 → 빌드 무차단
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

  it('백로그 행 파싱 — id/adrRefs/status/priority (7 컬럼, ADR-0158)', () => {
    const src = [
      '### A. 학습',
      '| A1 | 0030 latentSignalScorer | `path/x.ts` | 2026-05-02 | INFRASTRUCTURE_ONLY | P2 | 사유 |',
      '| A3 | 0006 emit + 0019 lifecycle | `path/y.ts` | 2026-05-02 | PARTIAL | P0 | 사유 |',
    ].join('\n');
    const { entries } = parsePendingWiring(src);
    expect(entries).toHaveLength(2);
    expect(entries[0]).toMatchObject({
      id: 'A1',
      adrRefs: ['0030'],
      enteredAt: '2026-05-02',
      status: 'INFRASTRUCTURE_ONLY',
      priority: 'P2',
      category: 'A',
    });
    expect(entries[1].adrRefs).toEqual(['0006', '0019']);
    expect(entries[1].enteredAt).toBe('2026-05-02');
  });

  it('PR-Governance-Followup-2 — module/modulePaths/reason 캡처 (7 컬럼)', () => {
    const src = [
      '### A. 학습',
      '| A1 | 0030 모듈 | `server/x.ts` | 2026-05-02 | INFRASTRUCTURE_ONLY | P2 | 차단 사유 / 다음 액션 |',
      '| A2 | 0031 emit | (정성 — 격상 불가) | — | DECIDED_NOT_WIRING | P3 | **ADR-0154 영구 정책** — 정성 항목 |',
      '| A3 | 0032 multi | `path/a.ts` 와 `path/b.ts` 둘 | 2026-05-02 | PARTIAL | P1 | 사유 |',
    ].join('\n');
    const { entries } = parsePendingWiring(src);
    expect(entries).toHaveLength(3);
    expect(entries[0].module).toBe('`server/x.ts`');
    expect(entries[0].modulePaths).toEqual(['server/x.ts']);
    expect(entries[0].reason).toBe('차단 사유 / 다음 액션');
    expect(entries[0].enteredAt).toBe('2026-05-02');
    expect(entries[1].modulePaths).toEqual([]);
    expect(entries[1].enteredAt).toBe('—');
    expect(entries[1].reason).toBe('**ADR-0154 영구 정책** — 정성 항목');
    expect(entries[2].modulePaths).toEqual(['path/a.ts', 'path/b.ts']);
    expect(entries[2].enteredAt).toBe('2026-05-02');
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
   * PR-Governance-3-SLA: enteredAt 옵셔널 (default `—` = SLA 미적용 — 기존 케이스 H 검증 무관).
   * 기존 테스트 케이스 호환을 위해 default 값 부여 (모두 G/H 검증 통과 형태).
   */
  function makeEntry(overrides) {
    return {
      id: 'A1',
      adrRefs: [],
      module: '`server/path.ts`',
      modulePaths: ['server/path.ts'],
      enteredAt: '—',
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

  /* ───────── PR-Governance-3-SLA (ADR-0158) — H 카테고리 ───────── */

  describe('H — SLA 자동 만료', () => {
    const NOW = new Date('2026-05-02T00:00:00Z');

    it('H_SLA_OK — P1 30일 경과 (SLA=45) 위반 0건', () => {
      const parsed = build([
        makeEntry({
          enteredAt: '2026-04-02',
          status: 'INFRASTRUCTURE_ONLY',
          priority: 'P1',
        }),
      ]);
      const { violations } = validate(parsed, new Set(), { now: NOW });
      const h = violations.filter((v) => v.category.startsWith('H_'));
      expect(h).toEqual([]);
    });

    it('H_SLA_WARN — P0 25일 경과 (SLA=21, grace=14)', () => {
      const parsed = build([
        makeEntry({
          enteredAt: '2026-04-07',
          status: 'INFRASTRUCTURE_ONLY',
          priority: 'P0',
        }),
      ]);
      const { violations } = validate(parsed, new Set(), { now: NOW });
      const h = violations.filter((v) => v.category === 'H_SLA_WARN');
      expect(h).toHaveLength(1);
      expect(h[0].message).toContain('SLA 임박');
      expect(h[0].message).toContain('25일 경과');
    });

    it('H_SLA_FAIL — P0 50일 경과 (SLA+grace=35 초과)', () => {
      const parsed = build([
        makeEntry({
          enteredAt: '2026-03-13',
          status: 'INFRASTRUCTURE_ONLY',
          priority: 'P0',
        }),
      ]);
      const { violations } = validate(parsed, new Set(), { now: NOW });
      const h = violations.filter((v) => v.category === 'H_SLA_FAIL');
      expect(h).toHaveLength(1);
      expect(h[0].message).toContain('SLA 만료');
    });

    it('H — P3 면제 (SLA 미적용)', () => {
      const parsed = build([
        makeEntry({
          enteredAt: '2025-01-01', // 1년+ 경과
          status: 'INFRASTRUCTURE_ONLY',
          priority: 'P3',
        }),
      ]);
      const { violations } = validate(parsed, new Set(), { now: NOW });
      const h = violations.filter((v) => v.category.startsWith('H_'));
      expect(h).toEqual([]);
    });

    it('H — DECIDED_NOT_WIRING 면제 (SLA 미적용)', () => {
      const parsed = build([
        makeEntry({
          enteredAt: '2025-01-01',
          status: 'DECIDED_NOT_WIRING',
          priority: 'P0',
          reason: '**완료** — PR-X 머지',
        }),
      ]);
      const { violations } = validate(parsed, new Set(), { now: NOW });
      const h = violations.filter((v) => v.category.startsWith('H_'));
      expect(h).toEqual([]);
    });

    it('H — BLOCKED + 면제 사유 명시 (운영자 결정) 면제', () => {
      const parsed = build([
        makeEntry({
          enteredAt: '2025-01-01',
          status: 'BLOCKED',
          priority: 'P2',
          reason: '운영자 결정 + 1~2주 데이터 누적 후',
        }),
      ]);
      const { violations } = validate(parsed, new Set(), { now: NOW });
      const h = violations.filter((v) => v.category.startsWith('H_'));
      expect(h).toEqual([]);
    });

    it('H_SLA_FAIL — BLOCKED 면제 사유 부재 + SLA 초과', () => {
      const parsed = build([
        makeEntry({
          enteredAt: '2025-01-01',
          status: 'BLOCKED',
          priority: 'P2',
          reason: '잠시 보류',
        }),
      ]);
      const { violations } = validate(parsed, new Set(), { now: NOW });
      const h = violations.filter((v) => v.category === 'H_SLA_FAIL');
      expect(h).toHaveLength(1);
    });

    it('H_INVALID_ENTERED_AT — 잘못된 날짜 형식', () => {
      const parsed = build([
        makeEntry({
          enteredAt: '2026/04/07', // 슬래시 형식
          status: 'INFRASTRUCTURE_ONLY',
          priority: 'P0',
        }),
      ]);
      const { violations } = validate(parsed, new Set(), { now: NOW });
      const h = violations.filter((v) => v.category === 'H_INVALID_ENTERED_AT');
      expect(h).toHaveLength(1);
      expect(h[0].message).toContain('등재일 형식 오류');
    });

    it('H_INVALID_ENTERED_AT — 유효하지 않은 날짜 (2026-02-30)', () => {
      const parsed = build([
        makeEntry({
          enteredAt: '2026-02-30',
          priority: 'P1',
          status: 'INFRASTRUCTURE_ONLY',
        }),
      ]);
      const { violations } = validate(parsed, new Set(), { now: NOW });
      const h = violations.filter((v) => v.category === 'H_INVALID_ENTERED_AT');
      expect(h).toHaveLength(1);
    });

    it('H — `—` (em dash) 등재일은 SLA 미적용', () => {
      const parsed = build([
        makeEntry({
          enteredAt: '—',
          status: 'INFRASTRUCTURE_ONLY',
          priority: 'P0',
        }),
      ]);
      const { violations } = validate(parsed, new Set(), { now: NOW });
      const h = violations.filter((v) => v.category.startsWith('H_'));
      expect(h).toEqual([]);
    });

    it('H — slaDisabled=true 시 H1/H2 skip (H3 형식 검증은 그대로)', () => {
      const parsed = build([
        makeEntry({
          enteredAt: '2025-01-01', // SLA 한참 초과
          status: 'INFRASTRUCTURE_ONLY',
          priority: 'P0',
        }),
        makeEntry({
          id: 'A2',
          enteredAt: '2026/04/07', // 잘못된 형식
          status: 'INFRASTRUCTURE_ONLY',
          priority: 'P1',
        }),
      ]);
      const { violations } = validate(parsed, new Set(), { now: NOW, slaDisabled: true });
      const fail = violations.filter((v) => v.category === 'H_SLA_FAIL');
      const warn = violations.filter((v) => v.category === 'H_SLA_WARN');
      const invalid = violations.filter((v) => v.category === 'H_INVALID_ENTERED_AT');
      expect(fail).toEqual([]);
      expect(warn).toEqual([]);
      expect(invalid).toHaveLength(1); // H3 는 그대로 검증
    });

    it('H — graceDays=0 (즉시 FAIL)', () => {
      const parsed = build([
        makeEntry({
          enteredAt: '2026-04-07', // 25일 경과
          status: 'INFRASTRUCTURE_ONLY',
          priority: 'P0', // SLA=21, grace=0 → 25 > 21 → FAIL
        }),
      ]);
      const { violations } = validate(parsed, new Set(), { now: NOW, graceDays: 0 });
      const h = violations.filter((v) => v.category === 'H_SLA_FAIL');
      expect(h).toHaveLength(1);
    });

    it('H — graceDays=30 (확장 grace)', () => {
      const parsed = build([
        makeEntry({
          enteredAt: '2026-03-13', // 50일 경과
          status: 'INFRASTRUCTURE_ONLY',
          priority: 'P0', // SLA=21, grace=30 → 50 ≤ 51 → WARN (FAIL 아님)
        }),
      ]);
      const { violations } = validate(parsed, new Set(), { now: NOW, graceDays: 30 });
      const fail = violations.filter((v) => v.category === 'H_SLA_FAIL');
      const warn = violations.filter((v) => v.category === 'H_SLA_WARN');
      expect(fail).toEqual([]);
      expect(warn).toHaveLength(1);
    });

    it('H — P1 정확히 SLA 경계 (45일) OK', () => {
      const parsed = build([
        makeEntry({
          enteredAt: '2026-03-18', // 정확히 45일 (now=2026-05-02)
          status: 'INFRASTRUCTURE_ONLY',
          priority: 'P1',
        }),
      ]);
      const { violations } = validate(parsed, new Set(), { now: NOW });
      const h = violations.filter((v) => v.category.startsWith('H_'));
      expect(h).toEqual([]);
    });

    it('H — P1 SLA + 1일 (46일) WARN', () => {
      const parsed = build([
        makeEntry({
          enteredAt: '2026-03-17', // 46일
          status: 'INFRASTRUCTURE_ONLY',
          priority: 'P1',
        }),
      ]);
      const { violations } = validate(parsed, new Set(), { now: NOW });
      const h = violations.filter((v) => v.category === 'H_SLA_WARN');
      expect(h).toHaveLength(1);
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

/* ───────── PR-Governance-3-SLA 헬퍼 (ADR-0158) ───────── */

describe('SLA 헬퍼 (ADR-0158)', () => {
  describe('SLA_DAYS / DEFAULT_GRACE_DAYS 상수', () => {
    it('P0/P1/P2/P3 매트릭스', () => {
      expect(SLA_DAYS.P0).toBe(21);
      expect(SLA_DAYS.P1).toBe(45);
      expect(SLA_DAYS.P2).toBe(120);
      expect(SLA_DAYS.P3).toBeNull();
    });

    it('DEFAULT_GRACE_DAYS=14', () => {
      expect(DEFAULT_GRACE_DAYS).toBe(14);
    });

    it('SLA_DAYS frozen — drift 차단', () => {
      expect(Object.isFrozen(SLA_DAYS)).toBe(true);
    });
  });

  describe('isWiringSlaDisabled', () => {
    const ORIG = process.env.WIRING_SLA_DISABLED;
    afterEach(() => {
      if (ORIG === undefined) delete process.env.WIRING_SLA_DISABLED;
      else process.env.WIRING_SLA_DISABLED = ORIG;
    });

    it('미설정 시 false', () => {
      delete process.env.WIRING_SLA_DISABLED;
      expect(isWiringSlaDisabled()).toBe(false);
    });

    it('"true" 시 true', () => {
      process.env.WIRING_SLA_DISABLED = 'true';
      expect(isWiringSlaDisabled()).toBe(true);
    });

    it('"1" 시 true', () => {
      process.env.WIRING_SLA_DISABLED = '1';
      expect(isWiringSlaDisabled()).toBe(true);
    });

    it('"false" 시 false', () => {
      process.env.WIRING_SLA_DISABLED = 'false';
      expect(isWiringSlaDisabled()).toBe(false);
    });
  });

  describe('getWiringSlaGraceDays', () => {
    const ORIG = process.env.WIRING_SLA_GRACE_DAYS;
    afterEach(() => {
      if (ORIG === undefined) delete process.env.WIRING_SLA_GRACE_DAYS;
      else process.env.WIRING_SLA_GRACE_DAYS = ORIG;
    });

    it('미설정 시 default 14', () => {
      delete process.env.WIRING_SLA_GRACE_DAYS;
      expect(getWiringSlaGraceDays()).toBe(14);
    });

    it('"7" 적용', () => {
      process.env.WIRING_SLA_GRACE_DAYS = '7';
      expect(getWiringSlaGraceDays()).toBe(7);
    });

    it('"0" 적용 (즉시 FAIL)', () => {
      process.env.WIRING_SLA_GRACE_DAYS = '0';
      expect(getWiringSlaGraceDays()).toBe(0);
    });

    it('음수 시 default fallback', () => {
      process.env.WIRING_SLA_GRACE_DAYS = '-5';
      expect(getWiringSlaGraceDays()).toBe(14);
    });

    it('NaN 시 default fallback', () => {
      process.env.WIRING_SLA_GRACE_DAYS = 'abc';
      expect(getWiringSlaGraceDays()).toBe(14);
    });

    it('30 초과 시 default fallback', () => {
      process.env.WIRING_SLA_GRACE_DAYS = '60';
      expect(getWiringSlaGraceDays()).toBe(14);
    });
  });

  describe('isValidEnteredAt', () => {
    it('YYYY-MM-DD 정상', () => {
      expect(isValidEnteredAt('2026-05-02')).toBe(true);
    });

    it('— (em dash) 정상 (SLA 미적용 마커)', () => {
      expect(isValidEnteredAt('—')).toBe(true);
    });

    it('- (단일 hyphen) 정상', () => {
      expect(isValidEnteredAt('-')).toBe(true);
    });

    it('2026/05/02 (슬래시) 거부', () => {
      expect(isValidEnteredAt('2026/05/02')).toBe(false);
    });

    it('26-05-02 (2자리 연도) 거부', () => {
      expect(isValidEnteredAt('26-05-02')).toBe(false);
    });

    it('2026-5-2 (zero-pad 부재) 거부', () => {
      expect(isValidEnteredAt('2026-5-2')).toBe(false);
    });

    it('2026-02-30 (유효하지 않은 날짜) 거부', () => {
      expect(isValidEnteredAt('2026-02-30')).toBe(false);
    });

    it('빈 문자열 거부', () => {
      expect(isValidEnteredAt('')).toBe(false);
    });

    it('non-string 거부', () => {
      expect(isValidEnteredAt(null)).toBe(false);
      expect(isValidEnteredAt(undefined)).toBe(false);
      expect(isValidEnteredAt(20260502)).toBe(false);
    });
  });

  describe('computeAgeDays', () => {
    it('정확히 30일 경과', () => {
      expect(computeAgeDays('2026-04-02', new Date('2026-05-02T00:00:00Z'))).toBe(30);
    });

    it('동일 일자 0일', () => {
      expect(computeAgeDays('2026-05-02', new Date('2026-05-02T00:00:00Z'))).toBe(0);
    });

    it('미래 등재일 → 0 (clock skew 방어)', () => {
      expect(computeAgeDays('2026-06-01', new Date('2026-05-02T00:00:00Z'))).toBe(0);
    });

    it('— (em dash) → null (SLA 미적용)', () => {
      expect(computeAgeDays('—', new Date('2026-05-02T00:00:00Z'))).toBeNull();
    });

    it('잘못된 형식 → null', () => {
      expect(computeAgeDays('2026/05/02', new Date('2026-05-02T00:00:00Z'))).toBeNull();
    });
  });

  describe('isSlaExempt', () => {
    it('DECIDED_NOT_WIRING 면제', () => {
      expect(
        isSlaExempt({ status: 'DECIDED_NOT_WIRING', priority: 'P0', enteredAt: '2025-01-01', reason: '' })
      ).toBe(true);
    });

    it('P3 면제', () => {
      expect(
        isSlaExempt({ status: 'INFRASTRUCTURE_ONLY', priority: 'P3', enteredAt: '2025-01-01', reason: '' })
      ).toBe(true);
    });

    it('등재일 — 면제', () => {
      expect(
        isSlaExempt({ status: 'INFRASTRUCTURE_ONLY', priority: 'P0', enteredAt: '—', reason: '' })
      ).toBe(true);
    });

    it('BLOCKED + 운영자 결정 면제', () => {
      expect(
        isSlaExempt({
          status: 'BLOCKED',
          priority: 'P2',
          enteredAt: '2025-01-01',
          reason: '운영자 결정 + 1주 검증 후',
        })
      ).toBe(true);
    });

    it('BLOCKED + 외부 의존성 면제', () => {
      expect(
        isSlaExempt({
          status: 'BLOCKED',
          priority: 'P2',
          enteredAt: '2025-01-01',
          reason: '외부 API 인증 키 확보 후',
        })
      ).toBe(true);
    });

    it('BLOCKED + 데이터 누적 면제', () => {
      expect(
        isSlaExempt({
          status: 'BLOCKED',
          priority: 'P2',
          enteredAt: '2025-01-01',
          reason: '운영 데이터 누적 후',
        })
      ).toBe(true);
    });

    it('BLOCKED + ADR 정책 인용 면제', () => {
      expect(
        isSlaExempt({
          status: 'BLOCKED',
          priority: 'P2',
          enteredAt: '2025-01-01',
          reason: '**ADR-0145 정책** — 6개월 주기',
        })
      ).toBe(true);
    });

    it('BLOCKED + 면제 사유 부재 면제 안 됨', () => {
      expect(
        isSlaExempt({
          status: 'BLOCKED',
          priority: 'P2',
          enteredAt: '2025-01-01',
          reason: '잠시 보류',
        })
      ).toBe(false);
    });

    it('INFRASTRUCTURE_ONLY P0 면제 안 됨', () => {
      expect(
        isSlaExempt({
          status: 'INFRASTRUCTURE_ONLY',
          priority: 'P0',
          enteredAt: '2025-01-01',
          reason: 'wiring 후속',
        })
      ).toBe(false);
    });
  });

  describe('evaluateSla 통합', () => {
    const NOW = new Date('2026-05-02T00:00:00Z');

    it('정상 OK (ageDays ≤ SLA)', () => {
      expect(
        evaluateSla(
          {
            status: 'INFRASTRUCTURE_ONLY',
            priority: 'P1',
            enteredAt: '2026-04-02',
            reason: 'wiring 후속',
          },
          NOW,
          14
        )
      ).toBe('OK');
    });

    it('WARN (SLA < ageDays ≤ SLA + grace)', () => {
      expect(
        evaluateSla(
          {
            status: 'INFRASTRUCTURE_ONLY',
            priority: 'P0',
            enteredAt: '2026-04-07', // 25일
            reason: 'wiring 후속',
          },
          NOW,
          14
        )
      ).toBe('WARN');
    });

    it('FAIL (ageDays > SLA + grace)', () => {
      expect(
        evaluateSla(
          {
            status: 'INFRASTRUCTURE_ONLY',
            priority: 'P0',
            enteredAt: '2026-03-13', // 50일
            reason: 'wiring 후속',
          },
          NOW,
          14
        )
      ).toBe('FAIL');
    });

    it('EXEMPT (P3)', () => {
      expect(
        evaluateSla(
          {
            status: 'INFRASTRUCTURE_ONLY',
            priority: 'P3',
            enteredAt: '2025-01-01',
            reason: '',
          },
          NOW,
          14
        )
      ).toBe('EXEMPT');
    });

    it('INVALID_DATE (잘못된 형식)', () => {
      expect(
        evaluateSla(
          {
            status: 'INFRASTRUCTURE_ONLY',
            priority: 'P0',
            enteredAt: '2026/05/02',
            reason: '',
          },
          NOW,
          14
        )
      ).toBe('INVALID_DATE');
    });
  });
});

describe('I — 사용자결정 부채 재검토 (PR-Governance-StaleUserDecision)', () => {
  const NOW = new Date('2026-06-18T00:00:00Z');

  function build(entries) {
    return { entries, categories: new Set(['A', 'B', 'C', 'D', 'E']), stats: null };
  }
  function udEntry(overrides) {
    return {
      id: 'E8', adrRefs: [], module: '`server/x.ts`', modulePaths: ['server/x.ts'],
      enteredAt: '2026-01-01', status: 'BLOCKED', priority: 'P2', category: 'E',
      reason: '사용자 결정 — SL 이후 추천. 진단 가시화 부채.',
      ...overrides,
    };
  }

  it('상수/ENV — 기본 30일, 1~365 클램프', () => {
    expect(DEFAULT_USER_DECISION_REVIEW_DAYS).toBe(30);
    delete process.env.USER_DECISION_REVIEW_DAYS;
    expect(getUserDecisionReviewDays()).toBe(30);
    process.env.USER_DECISION_REVIEW_DAYS = '7';
    expect(getUserDecisionReviewDays()).toBe(7);
    process.env.USER_DECISION_REVIEW_DAYS = '9999';
    expect(getUserDecisionReviewDays()).toBe(30); // 범위 밖 → fallback
    delete process.env.USER_DECISION_REVIEW_DAYS;
  });

  it('isUserDecisionReviewDisabled — ENV true/1', () => {
    delete process.env.USER_DECISION_REVIEW_DISABLED;
    expect(isUserDecisionReviewDisabled()).toBe(false);
    process.env.USER_DECISION_REVIEW_DISABLED = 'true';
    expect(isUserDecisionReviewDisabled()).toBe(true);
    delete process.env.USER_DECISION_REVIEW_DISABLED;
  });

  it('isUserDecisionDebt — BLOCKED + 사용자결정 패턴만 true (운영자결정 제외)', () => {
    expect(isUserDecisionDebt({ status: 'BLOCKED', reason: '사용자 결정 대기 — SL 이후 추천' })).toBe(true);
    expect(isUserDecisionDebt({ status: 'BLOCKED', reason: 'SL 이후 추천 재검토' })).toBe(true);
    expect(isUserDecisionDebt({ status: 'BLOCKED', reason: '운영자 결정 + 데이터 누적 후' })).toBe(false);
    expect(isUserDecisionDebt({ status: 'INFRASTRUCTURE_ONLY', reason: '사용자 결정' })).toBe(false);
  });

  it('findLastReviewDate — 등재일 + reason 안 최신 날짜 중 최신', () => {
    expect(findLastReviewDate({ enteredAt: '2026-05-06', reason: '... 재노출 2026-06-18 ...' })).toBe('2026-06-18');
    expect(findLastReviewDate({ enteredAt: '2026-05-06', reason: '날짜 없음' })).toBe('2026-05-06');
    expect(findLastReviewDate({ enteredAt: '—', reason: '날짜 없음' })).toBe(null);
  });

  it('evaluateUserDecisionStaleness — 임계 초과 STALE', () => {
    const r = evaluateUserDecisionStaleness(udEntry(), NOW, 30);
    expect(r.status).toBe('STALE');
    expect(r.ageDays).toBeGreaterThan(30);
    expect(r.lastReview).toBe('2026-01-01');
  });

  it('evaluateUserDecisionStaleness — 최근 재노출 마커 시 OK (self-clearing)', () => {
    const r = evaluateUserDecisionStaleness(
      udEntry({ reason: '🔁 재노출 2026-06-18 — SL 이후 추천(사용자 결정).' }), NOW, 30);
    expect(r.status).toBe('OK');
    expect(r.lastReview).toBe('2026-06-18');
  });

  it('evaluateUserDecisionStaleness — 운영자결정은 NOT_APPLICABLE', () => {
    const r = evaluateUserDecisionStaleness(
      udEntry({ reason: '운영자 결정 + 데이터 누적' }), NOW, 30);
    expect(r.status).toBe('NOT_APPLICABLE');
  });

  it('validate — STALE 항목 I_USER_DECISION_STALE WARN 등재', () => {
    const { violations } = validate(build([udEntry()]), new Set(), { now: NOW, userDecisionReviewDays: 30 });
    const i = violations.filter((v) => v.category === 'I_USER_DECISION_STALE');
    expect(i).toHaveLength(1);
    expect(i[0].message).toContain('E8');
    expect(i[0].message).toContain('재노출');
  });

  it('validate — 재노출 마커 갱신 시 STALE 해소 (self-clearing)', () => {
    const fresh = udEntry({ reason: '🔁 재노출 2026-06-18 — SL 이후 추천(사용자 결정).' });
    const { violations } = validate(build([fresh]), new Set(), { now: NOW, userDecisionReviewDays: 30 });
    expect(violations.filter((v) => v.category === 'I_USER_DECISION_STALE')).toHaveLength(0);
  });

  it('validate — userDecisionReviewDisabled 시 skip', () => {
    const { violations } = validate(build([udEntry()]), new Set(),
      { now: NOW, userDecisionReviewDays: 30, userDecisionReviewDisabled: true });
    expect(violations.filter((v) => v.category === 'I_USER_DECISION_STALE')).toHaveLength(0);
  });

  it('validate — 운영자결정 BLOCKED 는 I 대상 아님', () => {
    const op = udEntry({ id: 'C5', category: 'C', reason: '운영자 결정 + 1~2주 데이터 누적 후' });
    const { violations } = validate(build([op]), new Set(), { now: NOW, userDecisionReviewDays: 30 });
    expect(violations.filter((v) => v.category === 'I_USER_DECISION_STALE')).toHaveLength(0);
  });
});
