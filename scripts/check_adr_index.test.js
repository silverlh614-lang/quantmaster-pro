/**
 * @responsibility check_adr_index.js 회귀 테스트 (PR-Governance 후속 자동화 #1)
 *
 * 검증:
 *   - baseline EXIT=0 (현재 INDEX.md 정합)
 *   - scanAdrFiles: 정상/충돌/잘못된 파일명 분류
 *   - parseIndex: 4 섹션 파싱 (다음 발급 / 충돌 / 누락 / 전체 인덱스)
 *   - validate: 6 카테고리 (A~F) 각각 위반 시나리오
 *   - computeMaxAdrNumber + formatAdrNumber 헬퍼
 */

import { describe, it, expect, afterEach } from 'vitest';
import { execSync } from 'node:child_process';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import {
  scanAdrFiles,
  parseIndex,
  validate,
  computeMaxAdrNumber,
  formatAdrNumber,
  // PR-Diaspora (ADR-0159): 별칭 시스템 SSOT
  ALIAS_MAPPING,
  CONFLICT_NUMBERS,
  isAdrAliasStrictEnabled,
  validateAliasReferences,
  // ADR-0453: F_INVALID_FILENAME 화이트리스트 SSOT
  INVALID_FILENAME_WHITELIST,
} from './check_adr_index.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const ROOT = join(__dirname, '..');

function runLint(args = '') {
  try {
    const out = execSync(`node scripts/check_adr_index.js ${args}`.trim(), {
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

describe('check_adr_index — baseline', () => {
  it('현재 INDEX.md 정합 EXIT=0', () => {
    const result = runLint();
    expect(result.exitCode).toBe(0);
    expect(result.output).toContain('OK');
    expect(result.output).toContain('충돌 11그룹');
    expect(result.output).toContain('누락 10건');
  });

  it('--json 출력 violations 빈 배열', () => {
    const result = runLint('--json');
    expect(result.exitCode).toBe(0);
    const parsed = JSON.parse(result.output);
    expect(parsed.violations).toEqual([]);
    expect(parsed.summary.totalAdrFiles).toBeGreaterThan(140);
    expect(parsed.summary.uniqueNumbers).toBeGreaterThan(130);
    expect(parsed.summary.nextNumber).toMatch(/^\d{4}$/);
  });

  // ADR-0453: baseline 22 → 0 violations 회복 확인
  it('ADR-0453 baseline 22 → 0 violations 회복', () => {
    const result = runLint('--json');
    expect(result.exitCode).toBe(0);
    const parsed = JSON.parse(result.output);
    // F_INVALID_FILENAME / A_MISSING_INDEX_ENTRY / B_STALE_INDEX_ENTRY 모두 0건
    expect(parsed.violations).toEqual([]);
    expect(parsed.summary.violationCount).toBe(0);
  });

  // ADR-0453: commit-label only 카운트 진단 출력
  it('ADR-0453 commit-label only 카운트 정확', () => {
    const result = runLint('--json');
    expect(result.exitCode).toBe(0);
    const parsed = JSON.parse(result.output);
    // 20 stale entries + 0394 = 21건 (모두 마커 부착)
    expect(parsed.summary.commitLabelOnlyEntries).toBe(21);
  });

  // ADR-0453: OK 출력 포맷 — commit-label only 카운트 표시
  it('ADR-0453 OK 출력 포맷에 commit-label only 카운트 포함', () => {
    const result = runLint();
    expect(result.exitCode).toBe(0);
    expect(result.output).toMatch(/commit-label only \d+건/);
  });
});

describe('scanAdrFiles', () => {
  function makeTmpDir(files) {
    const dir = mkdtempSync(join(tmpdir(), 'adr-test-'));
    for (const name of files) {
      writeFileSync(join(dir, name), '# stub\n');
    }
    return dir;
  }

  it('정상 파일 단일 그룹화', () => {
    const dir = makeTmpDir(['0001-foo.md', '0002-bar-baz.md']);
    try {
      const { byNumber, invalidNames } = scanAdrFiles(dir);
      expect(byNumber.size).toBe(2);
      expect(byNumber.get('0001')).toEqual(['0001-foo.md']);
      expect(byNumber.get('0002')).toEqual(['0002-bar-baz.md']);
      expect(invalidNames).toEqual([]);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('동일 번호 충돌 그룹', () => {
    const dir = makeTmpDir(['0028-a.md', '0028-b.md', '0028-c.md']);
    try {
      const { byNumber } = scanAdrFiles(dir);
      expect(byNumber.get('0028')).toHaveLength(3);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('잘못된 파일명 invalidNames 분리', () => {
    const dir = makeTmpDir(['28-foo.md', '0028a-foo.md', 'foo.md', '0001-Bar.md']);
    try {
      const { byNumber, invalidNames } = scanAdrFiles(dir);
      // 0001-Bar.md 는 camelCase 허용 (relaxed regex)
      expect(byNumber.has('0001')).toBe(true);
      expect(invalidNames).toEqual(expect.arrayContaining(['28-foo.md', '0028a-foo.md', 'foo.md']));
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('INDEX.md / README.md 자동 제외', () => {
    const dir = makeTmpDir(['INDEX.md', 'README.md', '0001-foo.md']);
    try {
      const { byNumber, invalidNames } = scanAdrFiles(dir);
      expect(byNumber.size).toBe(1);
      expect(invalidNames).toEqual([]);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('비-md 파일 무시', () => {
    const dir = makeTmpDir(['0001-foo.md', '0002-bar.txt', 'random.json']);
    try {
      const { byNumber, invalidNames } = scanAdrFiles(dir);
      expect(byNumber.size).toBe(1);
      expect(invalidNames).toEqual([]);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});

describe('parseIndex', () => {
  it('§"다음 발급" 추출', () => {
    const src = `## 다음 발급\n\n**다음 ADR 번호: \`0148\`**\n`;
    const { nextNumber } = parseIndex(src);
    expect(nextNumber).toBe('0148');
  });

  it('§"다음 발급" 부재 시 null', () => {
    const src = `## 다른 섹션\n내용\n`;
    const { nextNumber } = parseIndex(src);
    expect(nextNumber).toBeNull();
  });

  it('§"알려진 충돌" 표 행 추출', () => {
    const src = [
      '## 알려진 충돌',
      '| 0028 | `0028-a.md` | 설명 | PR-1 | 비고 |',
      '| 0028 | `0028-b.md` | 설명 | PR-2 | 비고 |',
      '| 0029 | `0029-c.md` | 설명 | PR-3 | 비고 |',
    ].join('\n');
    const { conflicts } = parseIndex(src);
    expect(conflicts).toEqual([
      { number: '0028', file: '0028-a.md' },
      { number: '0028', file: '0028-b.md' },
      { number: '0029', file: '0029-c.md' },
    ]);
  });

  it('§"누락" 표 추출 + §"전체 인덱스" 누락 마커', () => {
    const src = [
      '## 누락 (Gap)',
      '| 0062 | rebase 충돌 |',
      '| 0143 | 누락 |',
      '## 전체 인덱스',
      '| 0001 | foo | refactor |',
      '| **0143** | *(누락)* | — |',
      '| 0144 | bar | data |',
    ].join('\n');
    const { gaps, mainIndex } = parseIndex(src);
    expect(gaps).toContain('0062');
    expect(gaps).toContain('0143');
    expect(mainIndex.get('0143').isGap).toBe(true);
    expect(mainIndex.get('0001').isGap).toBe(false);
    expect(mainIndex.get('0144').isGap).toBe(false);
  });

  it('§"전체 인덱스" 행 파싱 — 제목/도메인 분리', () => {
    const src = [
      '## 전체 인덱스',
      '| 0001 | signalScanner-decomposition | refactor |',
      '| 0028 | A / B / C | conflict ×3 |',
    ].join('\n');
    const { mainIndex } = parseIndex(src);
    expect(mainIndex.get('0001').title).toBe('signalScanner-decomposition');
    expect(mainIndex.get('0001').domain).toBe('refactor');
    expect(mainIndex.get('0028').domain).toBe('conflict ×3');
  });
});

describe('validate', () => {
  function build({
    files = [],
    invalidNames = [],
    nextNumber = null,
    indexed = [],
    conflicts = [],
    gaps = [],
  } = {}) {
    const byNumber = new Map();
    for (const name of files) {
      const m = name.match(/^(\d{4})-/);
      if (!m) continue;
      const num = m[1];
      if (!byNumber.has(num)) byNumber.set(num, []);
      byNumber.get(num).push(name);
    }
    const mainIndex = new Map();
    for (const e of indexed) {
      mainIndex.set(e.number, {
        title: e.title || 'stub',
        domain: e.domain || 'data',
        isGap: e.isGap || false,
      });
    }
    return {
      scan: { byNumber, invalidNames },
      parsed: { nextNumber, mainIndex, conflicts, gaps },
    };
  }

  it('A — 파일 존재 + 인덱스 미등재 시 위반', () => {
    const { scan, parsed } = build({
      files: ['0150-foo.md'],
      indexed: [],
      nextNumber: '0151',
    });
    const { violations } = validate(scan, parsed);
    const a = violations.filter((v) => v.category === 'A_MISSING_INDEX_ENTRY');
    expect(a.length).toBeGreaterThan(0);
  });

  it('A — 충돌 파일이 충돌 표 미등재 시 위반', () => {
    const { scan, parsed } = build({
      files: ['0028-a.md', '0028-b.md'],
      indexed: [{ number: '0028', title: 'conflict', domain: 'conflict ×2' }],
      conflicts: [{ number: '0028', file: '0028-a.md' }], // b 는 미등재
      nextNumber: '0029',
    });
    const { violations } = validate(scan, parsed);
    const a = violations.filter((v) => v.category === 'A_MISSING_CONFLICT_ENTRY');
    expect(a.length).toBe(1);
    expect(a[0].message).toContain('0028-b.md');
  });

  it('B — 인덱스 등재 + 파일 부재 시 위반 (stale entry)', () => {
    const { scan, parsed } = build({
      files: [],
      indexed: [{ number: '0001', title: 'stale' }],
      nextNumber: '0001',
    });
    const { violations } = validate(scan, parsed);
    const b = violations.filter((v) => v.category === 'B_STALE_INDEX_ENTRY');
    expect(b.length).toBe(1);
  });

  it('B — 누락 마커 등재는 stale 로 안 잡힘', () => {
    const { scan, parsed } = build({
      files: [],
      indexed: [{ number: '0143', title: '(누락)', isGap: true }],
      nextNumber: '0001',
    });
    const { violations } = validate(scan, parsed);
    const b = violations.filter((v) => v.category === 'B_STALE_INDEX_ENTRY');
    expect(b).toEqual([]);
  });

  it('C — 다음 발급 ≠ max+1 시 위반', () => {
    const { scan, parsed } = build({
      files: ['0001-a.md', '0002-b.md'],
      indexed: [
        { number: '0001', title: 'a' },
        { number: '0002', title: 'b' },
      ],
      nextNumber: '0010', // 기대 0003
    });
    const { violations } = validate(scan, parsed);
    const c = violations.filter((v) => v.category === 'C_NEXT_NUMBER_MISMATCH');
    expect(c.length).toBe(1);
    expect(c[0].message).toContain('0010');
    expect(c[0].message).toContain('0003');
  });

  it('C — 다음 발급 정상 시 위반 없음', () => {
    const { scan, parsed } = build({
      files: ['0001-a.md', '0002-b.md'],
      indexed: [
        { number: '0001', title: 'a' },
        { number: '0002', title: 'b' },
      ],
      nextNumber: '0003',
    });
    const { violations } = validate(scan, parsed);
    expect(violations.filter((v) => v.category.startsWith('C_'))).toEqual([]);
  });

  it('C — 다음 발급 섹션 부재 시 위반', () => {
    const { scan, parsed } = build({
      files: ['0001-a.md'],
      indexed: [{ number: '0001', title: 'a' }],
      nextNumber: null,
    });
    const { violations } = validate(scan, parsed);
    const c = violations.filter((v) => v.category === 'C_NEXT_NUMBER_MISSING');
    expect(c.length).toBe(1);
  });

  it('D — 누락 등재된 번호가 실제 파일 존재 시 위반 (false gap)', () => {
    const { scan, parsed } = build({
      files: ['0143-foo.md'],
      indexed: [{ number: '0143', title: 'foo' }],
      gaps: ['0143'],
      nextNumber: '0144',
    });
    const { violations } = validate(scan, parsed);
    const d = violations.filter((v) => v.category === 'D_FALSE_GAP');
    expect(d.length).toBe(1);
  });

  it('E — 충돌 표 entry 가 파일 시스템 부재 시 위반', () => {
    const { scan, parsed } = build({
      files: [],
      conflicts: [{ number: '0028', file: '0028-stale.md' }],
      nextNumber: '0001',
    });
    const { violations } = validate(scan, parsed);
    const e = violations.filter((v) => v.category === 'E_STALE_CONFLICT_ENTRY');
    expect(e.length).toBe(1);
  });

  it('F — 잘못된 파일명 위반', () => {
    const { scan, parsed } = build({
      files: [],
      invalidNames: ['28-foo.md', '0028a-bar.md'],
      nextNumber: '0001',
    });
    const { violations } = validate(scan, parsed);
    const f = violations.filter((v) => v.category === 'F_INVALID_FILENAME');
    expect(f.length).toBe(2);
  });

  it('정상 입력 (충돌 + 누락 등재 정합) 위반 0건', () => {
    const { scan, parsed } = build({
      files: ['0001-a.md', '0028-x.md', '0028-y.md', '0029-z.md'],
      indexed: [
        { number: '0001', title: 'a' },
        { number: '0028', title: 'x / y', domain: 'conflict ×2' },
        { number: '0029', title: 'z' },
        { number: '0143', title: '(누락)', isGap: true },
      ],
      conflicts: [
        { number: '0028', file: '0028-x.md' },
        { number: '0028', file: '0028-y.md' },
      ],
      gaps: ['0143'],
      nextNumber: '0030',
    });
    const { violations } = validate(scan, parsed);
    expect(violations).toEqual([]);
  });
});

describe('헬퍼', () => {
  it('computeMaxAdrNumber — 빈 입력 0', () => {
    expect(computeMaxAdrNumber(new Map())).toBe(0);
  });

  it('computeMaxAdrNumber — 최대값 반환', () => {
    const m = new Map([
      ['0001', ['a']],
      ['0050', ['b']],
      ['0010', ['c']],
    ]);
    expect(computeMaxAdrNumber(m)).toBe(50);
  });

  it('formatAdrNumber — 4자리 zero-pad', () => {
    expect(formatAdrNumber(1)).toBe('0001');
    expect(formatAdrNumber(50)).toBe('0050');
    expect(formatAdrNumber(148)).toBe('0148');
    expect(formatAdrNumber(1000)).toBe('1000');
  });
});

/* ───────── PR-Diaspora (ADR-0159) — 별칭 시스템 SSOT ───────── */

describe('ALIAS_MAPPING SSOT (ADR-0159)', () => {
  it('8 충돌 그룹 모두 등재', () => {
    const groups = Object.keys(ALIAS_MAPPING).sort();
    expect(groups).toEqual(['0028', '0029', '0030', '0031', '0032', '0067', '0068', '0124']);
  });

  it('17 충돌 ADR 별칭 모두 부여 (3+3+3+3+2+2+2+2)', () => {
    const totalCount = Object.values(ALIAS_MAPPING).reduce((sum, list) => sum + list.length, 0);
    expect(totalCount).toBe(20); // 0028×3 + 0029×3 + 0030×3 + 0031×3 + 0032×2 + 0067×2 + 0068×2 + 0124×2 = 20
  });

  it('각 별칭은 a/b/c suffix + 그룹 번호', () => {
    for (const [number, list] of Object.entries(ALIAS_MAPPING)) {
      list.forEach((entry, idx) => {
        const expectedSuffix = String.fromCharCode(97 + idx); // a, b, c
        expect(entry.alias).toBe(`${number}${expectedSuffix}`);
      });
    }
  });

  it('각 별칭 entry 는 alias/file/intent/pr 4 필드', () => {
    for (const list of Object.values(ALIAS_MAPPING)) {
      for (const entry of list) {
        expect(entry).toHaveProperty('alias');
        expect(entry).toHaveProperty('file');
        expect(entry).toHaveProperty('intent');
        expect(entry).toHaveProperty('pr');
      }
    }
  });

  it('파일 prefix 가 그룹 번호와 일치', () => {
    for (const [number, list] of Object.entries(ALIAS_MAPPING)) {
      for (const entry of list) {
        expect(entry.file.startsWith(`${number}-`)).toBe(true);
        expect(entry.file.endsWith('.md')).toBe(true);
      }
    }
  });

  it('ALIAS_MAPPING frozen — drift 차단', () => {
    expect(Object.isFrozen(ALIAS_MAPPING)).toBe(true);
    for (const list of Object.values(ALIAS_MAPPING)) {
      expect(Object.isFrozen(list)).toBe(true);
    }
  });

  it('CONFLICT_NUMBERS = ALIAS_MAPPING keys', () => {
    expect([...CONFLICT_NUMBERS].sort()).toEqual(Object.keys(ALIAS_MAPPING).sort());
  });

  it('실제 파일 시스템에 모든 alias 파일 존재', () => {
    const scan = scanAdrFiles(join(ROOT, 'docs', 'adr'));
    for (const list of Object.values(ALIAS_MAPPING)) {
      for (const entry of list) {
        const matchedFiles = scan.byNumber.get(entry.alias.slice(0, 4)) ?? [];
        expect(matchedFiles).toContain(entry.file);
      }
    }
  });
});

describe('isAdrAliasStrictEnabled', () => {
  const ORIG = process.env.ADR_ALIAS_STRICT;
  afterEach(() => {
    if (ORIG === undefined) delete process.env.ADR_ALIAS_STRICT;
    else process.env.ADR_ALIAS_STRICT = ORIG;
  });

  it('미설정 시 false (default OFF)', () => {
    delete process.env.ADR_ALIAS_STRICT;
    expect(isAdrAliasStrictEnabled()).toBe(false);
  });

  it('"true" 시 true', () => {
    process.env.ADR_ALIAS_STRICT = 'true';
    expect(isAdrAliasStrictEnabled()).toBe(true);
  });

  it('"1" 시 true', () => {
    process.env.ADR_ALIAS_STRICT = '1';
    expect(isAdrAliasStrictEnabled()).toBe(true);
  });

  it('"false" 시 false', () => {
    process.env.ADR_ALIAS_STRICT = 'false';
    expect(isAdrAliasStrictEnabled()).toBe(false);
  });
});

describe('validateAliasReferences', () => {
  it('빈 입력 위반 0건', () => {
    expect(validateAliasReferences('').violations).toEqual([]);
    expect(validateAliasReferences(null).violations).toEqual([]);
    expect(validateAliasReferences(undefined).violations).toEqual([]);
  });

  it('비충돌 ADR 인용 무시 (ADR-0085)', () => {
    const src = '본 PR 은 ADR-0085 후속 진행. ADR-0148 구조 정합.';
    expect(validateAliasReferences(src).violations).toEqual([]);
  });

  it('별칭 사용 (ADR-0028a) 위반 0건', () => {
    const src = '본 PR 은 ADR-0028a (exitEngine 분해) 후속.';
    expect(validateAliasReferences(src).violations).toEqual([]);
  });

  it('별칭 미사용 (ADR-0028) 위반 1건', () => {
    const src = '본 PR 은 ADR-0028 후속.';
    const result = validateAliasReferences(src);
    expect(result.violations).toHaveLength(1);
    expect(result.violations[0].number).toBe('0028');
    expect(result.violations[0].line).toBe(1);
  });

  it('다중 그룹 별칭 미사용 검출 (ADR-0028 + ADR-0124)', () => {
    const src = 'ADR-0028 + ADR-0124 결합';
    const result = validateAliasReferences(src);
    expect(result.violations).toHaveLength(2);
    const numbers = result.violations.map((v) => v.number).sort();
    expect(numbers).toEqual(['0028', '0124']);
  });

  it('한 줄에 별칭 사용 + 미사용 혼재', () => {
    const src = 'ADR-0028a 와 ADR-0029 둘 다 인용';
    const result = validateAliasReferences(src);
    expect(result.violations).toHaveLength(1);
    expect(result.violations[0].number).toBe('0029');
  });

  it('다중 라인 인용 line 번호 정확', () => {
    const src = ['', 'ADR-0028 line 2', '', 'ADR-0067 line 4'].join('\n');
    const result = validateAliasReferences(src);
    expect(result.violations).toHaveLength(2);
    expect(result.violations[0]).toMatchObject({ number: '0028', line: 2 });
    expect(result.violations[1]).toMatchObject({ number: '0067', line: 4 });
  });

  it('non-string 안전 fallback', () => {
    expect(validateAliasReferences(123).violations).toEqual([]);
    expect(validateAliasReferences({}).violations).toEqual([]);
  });

  it('영문자 후행 별칭은 매칭 안 함 (ADR-0028a, ADR-0028b)', () => {
    const src = 'ADR-0028a 와 ADR-0028b 와 ADR-0028c 모두 별칭 사용';
    expect(validateAliasReferences(src).violations).toEqual([]);
  });

  it('충돌 그룹 8 모두 검출 (alias 미사용)', () => {
    const src = 'ADR-0028 ADR-0029 ADR-0030 ADR-0031 ADR-0032 ADR-0067 ADR-0068 ADR-0124';
    const result = validateAliasReferences(src);
    expect(result.violations).toHaveLength(8);
  });

  it('ADR-0028e (알 수 없는 영문자) 별칭 처리 — 매칭 안 함 (negative lookahead)', () => {
    // 정책: 알 수 없는 영문자라도 후행 영문자가 있으면 별칭 의도 인정 (추가 검증은 별도)
    const src = 'ADR-0028e (typo) 인용';
    expect(validateAliasReferences(src).violations).toEqual([]);
  });
});

/* ───────── ADR-0453: ADR Index Baseline Retrofit (8 신규 케이스) ───────── */

describe('ADR-0453 INVALID_FILENAME_WHITELIST SSOT', () => {
  function makeTmpDir(files) {
    const dir = mkdtempSync(join(tmpdir(), 'adr-0453-'));
    for (const name of files) {
      writeFileSync(join(dir, name), '# stub\n');
    }
    return dir;
  }

  it('F_INVALID_FILENAME 화이트리스트 entry 통과 + byNumber 등재', () => {
    // 화이트리스트 entry: 0394-p1.5-execution-terminology-ssot.md
    const dir = makeTmpDir(['0394-p1.5-execution-terminology-ssot.md', '0001-foo.md']);
    try {
      const { byNumber, invalidNames } = scanAdrFiles(dir);
      // invalid 분류 제외
      expect(invalidNames).not.toContain('0394-p1.5-execution-terminology-ssot.md');
      // byNumber 에 등재 (INDEX 정합 검증 보존)
      expect(byNumber.has('0394')).toBe(true);
      expect(byNumber.get('0394')).toContain('0394-p1.5-execution-terminology-ssot.md');
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('화이트리스트 외 invalid filename 은 여전히 FAIL', () => {
    // 화이트리스트 외 비표준 파일명: 0500-test.with.dots.md
    const dir = makeTmpDir(['0500-test.with.dots.md', '0001-foo.md']);
    try {
      const { byNumber, invalidNames } = scanAdrFiles(dir);
      expect(invalidNames).toContain('0500-test.with.dots.md');
      // byNumber 에 등재 안 됨 (정상 분류 거부)
      expect(byNumber.has('0500')).toBe(false);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('INVALID_FILENAME_WHITELIST 는 Object.freeze + Set', () => {
    expect(INVALID_FILENAME_WHITELIST).toBeInstanceOf(Set);
    expect(INVALID_FILENAME_WHITELIST.has('0394-p1.5-execution-terminology-ssot.md')).toBe(true);
    // freeze 검증 — add() 호출 시 throw (strict mode) 또는 silent fail
    expect(Object.isFrozen(INVALID_FILENAME_WHITELIST)).toBe(true);
  });
});

describe('ADR-0453 B_STALE 마커 인식 (commit-label only / no file)', () => {
  it('(commit-label only, fast-iteration) 마커 entry stale 분류 제외', () => {
    const indexSrc = `# Index
## 다음 발급
**다음 ADR 번호: \`0010\`**

## 알려진 충돌

## 누락

## 전체 인덱스
| 번호 | 제목 | 도메인 |
|------|------|--------|
| 0001 | foo (commit-label only, fast-iteration) | trading |
| 0009 | bar | trading |
`;
    const parsed = parseIndex(indexSrc);
    const scan = { byNumber: new Map(), invalidNames: [] };
    // 0001 은 마커 보유 → stale 분류 제외
    // 0009 는 마커 없음 → stale 분류 (FAIL)
    const { violations } = validate(scan, parsed);
    const stale = violations.filter((v) => v.category === 'B_STALE_INDEX_ENTRY');
    expect(stale.map((v) => v.message)).toEqual(
      expect.arrayContaining([expect.stringContaining('0009')])
    );
    expect(stale.map((v) => v.message)).not.toEqual(
      expect.arrayContaining([expect.stringContaining('0001')])
    );
  });

  it('(no file) 마커도 동등 처리 — stale 분류 제외', () => {
    const indexSrc = `# Index
## 다음 발급
**다음 ADR 번호: \`0010\`**

## 알려진 충돌

## 누락

## 전체 인덱스
| 번호 | 제목 | 도메인 |
|------|------|--------|
| 0002 | baz (no file) | trading |
`;
    const parsed = parseIndex(indexSrc);
    const scan = { byNumber: new Map(), invalidNames: [] };
    const { violations } = validate(scan, parsed);
    const stale = violations.filter((v) => v.category === 'B_STALE_INDEX_ENTRY');
    expect(stale).toEqual([]);
  });

  it('마커 없는 stale entries 는 여전히 FAIL', () => {
    const indexSrc = `# Index
## 다음 발급
**다음 ADR 번호: \`0010\`**

## 알려진 충돌

## 누락

## 전체 인덱스
| 번호 | 제목 | 도메인 |
|------|------|--------|
| 0003 | no-marker | trading |
`;
    const parsed = parseIndex(indexSrc);
    const scan = { byNumber: new Map(), invalidNames: [] };
    const { violations } = validate(scan, parsed);
    expect(violations.some((v) => v.category === 'B_STALE_INDEX_ENTRY' && v.message.includes('0003'))).toBe(true);
  });

  it('parseIndex 가 commitLabelOnly 필드 정확히 설정', () => {
    const indexSrc = `# Index
## 다음 발급
**다음 ADR 번호: \`0010\`**

## 알려진 충돌

## 누락

## 전체 인덱스
| 번호 | 제목 | 도메인 |
|------|------|--------|
| 0001 | foo (commit-label only, fast-iteration) | trading |
| 0002 | baz (no file) | trading |
| 0003 | normal-entry | trading |
`;
    const parsed = parseIndex(indexSrc);
    expect(parsed.mainIndex.get('0001').commitLabelOnly).toBe(true);
    expect(parsed.mainIndex.get('0002').commitLabelOnly).toBe(true);
    expect(parsed.mainIndex.get('0003').commitLabelOnly).toBe(false);
  });
});
