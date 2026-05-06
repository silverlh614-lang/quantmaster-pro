/**
 * @responsibility check_bug_ledger.js 회귀 테스트 (PR #669 후속 P1 가드)
 *
 * 검증:
 *   - baseline EXIT=0 (현재 BUG_LEDGER 정합)
 *   - parseAreas: H3 추출 + 메타 키워드 필터
 *   - parseFrontmatter: YAML 단순 파서 (배열 / null / int / 문자열)
 *   - extractBugEntries: frontmatter 블록 + 본문 분리, 코드 펜스 안 `---` 제외
 *   - validateLedger: 13 카테고리 (BUG_ID / 중복 / 필수필드 / status / severity / area /
 *                                   recurrence / 날짜 / P0 섹션 / P0 키워드 / related_adrs / keywords)
 *   - checkFixesReferences: heading 매칭 차단, frontmatter id: 만 인정
 *   - runCli: --text / --json / 파일 부재 시나리오
 */

import { describe, it, expect, afterEach } from 'vitest';
import { execSync } from 'node:child_process';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { mkdtempSync, writeFileSync, rmSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { PassThrough } from 'node:stream';
import {
  parseAreas,
  parseFrontmatter,
  extractBugEntries,
  validateLedger,
  checkFixesReferences,
  runCli,
  BUG_ID_RE,
  VALID_STATUSES,
  VALID_SEVERITIES,
  REQUIRED_FRONTMATTER_KEYS,
  P0_REQUIRED_SECTIONS,
  P0_RISK_KEYWORDS,
  BUG_AREAS_FALLBACK,
} from './check_bug_ledger.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, '..');
const SCRIPT = join(__dirname, 'check_bug_ledger.js');

const tempDirs = [];
afterEach(() => {
  for (const d of tempDirs) {
    try { rmSync(d, { recursive: true, force: true }); } catch (_e) { /* ignore */ }
  }
  tempDirs.length = 0;
});

function makeTempLedger({ ledger, areas, template = '# template' }) {
  const dir = mkdtempSync(join(tmpdir(), 'bug-ledger-'));
  tempDirs.push(dir);
  const opsDir = join(dir, 'docs', 'ops');
  mkdirSync(opsDir, { recursive: true });
  if (ledger != null) writeFileSync(join(opsDir, 'BUG_LEDGER.md'), ledger, 'utf8');
  if (areas != null) writeFileSync(join(opsDir, 'BUG_AREAS.md'), areas, 'utf8');
  if (template != null) writeFileSync(join(opsDir, 'BUG_TEMPLATE.md'), template, 'utf8');
  return dir;
}

const VALID_FRONTMATTER = [
  'id: BUG-2026-01-01-001',
  'status: OPEN',
  'severity: P0',
  'area: Market Truth Layer',
  'discovered: 2026-01-01',
  'resolved: null',
  'related_adrs: [ADR-0412]',
  'related_bugs: []',
  'keywords: [holiday]',
  'recurrence_count: 0',
].join('\n');

const VALID_P0_BODY = [
  '## BUG-2026-01-01-001 — sample',
  '### 증상 (What)',
  '자금 손실 가능 시나리오.',
  '### 영향 (Impact)',
  '학습 데이터 오염 위험.',
  '### 재현 (Reproduction)',
  '재현 절차.',
  '### 근본 원인 (Root Cause)',
  '원인.',
  '### 기대 동작 (Expected)',
  '기대.',
  '### 해결 (Resolution)',
  '해결 방법.',
  '### 재발 감시 (Watch)',
  '60일.',
].join('\n');

const VALID_BUG_ENTRY = `---\n${VALID_FRONTMATTER}\n---\n\n${VALID_P0_BODY}\n`;

const VALID_AREAS = `# BUG AREAS

## 영역 정의

### Market Truth Layer
시장.

### Order Execution Layer
주문.

### Risk Layer
리스크.

### Learning Layer
학습.

### Persistence Layer
영속.

### Diagnostics Layer
진단.

### UI/UX Layer
UI.

### Infrastructure Layer
인프라.

## 영역 명명 규칙
규칙.
`;

// =====================================================
//   1. baseline — 현재 코드베이스 BUG_LEDGER 통과
// =====================================================

describe('check_bug_ledger.js — baseline', () => {
  it('현재 BUG_LEDGER.md 가 검증을 통과한다', () => {
    const out = execSync(`node ${SCRIPT}`, { cwd: ROOT, encoding: 'utf8' });
    expect(out).toContain('✅ BUG_LEDGER validation passed');
    expect(out).toMatch(/- bugs: \d+/);
    expect(out).toMatch(/- p0: \d+/);
  });

  it('--json 출력이 ok=true 를 반환한다', () => {
    const out = execSync(`node ${SCRIPT} --json`, { cwd: ROOT, encoding: 'utf8' });
    const data = JSON.parse(out);
    expect(data.ok).toBe(true);
    expect(data.errors).toEqual([]);
    expect(data.stats).toMatchObject({ bugs: expect.any(Number) });
  });
});

// =====================================================
//   2. SSOT 상수
// =====================================================

describe('SSOT 상수', () => {
  it('BUG_ID_RE 정확 매칭', () => {
    expect(BUG_ID_RE.test('BUG-2026-05-07-001')).toBe(true);
    expect(BUG_ID_RE.test('BUG-2026-5-7-1')).toBe(false);
    expect(BUG_ID_RE.test('BUG-26-05-07-001')).toBe(false);
    expect(BUG_ID_RE.test('BUG-2026-05-07-1')).toBe(false);
    expect(BUG_ID_RE.test('bug-2026-05-07-001')).toBe(false);
  });

  it('VALID_STATUSES 6값', () => {
    expect(VALID_STATUSES).toEqual(['OPEN', 'PATCHED', 'VERIFIED', 'WATCHING', 'CLOSED', 'WONTFIX']);
  });

  it('VALID_SEVERITIES 4값', () => {
    expect(VALID_SEVERITIES).toEqual(['P0', 'P1', 'P2', 'P3']);
  });

  it('REQUIRED_FRONTMATTER_KEYS 10개', () => {
    expect(REQUIRED_FRONTMATTER_KEYS).toHaveLength(10);
    expect(REQUIRED_FRONTMATTER_KEYS).toContain('id');
    expect(REQUIRED_FRONTMATTER_KEYS).toContain('recurrence_count');
  });

  it('P0_REQUIRED_SECTIONS 7개', () => {
    expect(P0_REQUIRED_SECTIONS).toHaveLength(7);
    expect(P0_REQUIRED_SECTIONS).toContain('근본 원인');
    expect(P0_REQUIRED_SECTIONS).toContain('재발 감시');
  });

  it('P0_RISK_KEYWORDS 사용자 명시 7개', () => {
    expect(P0_RISK_KEYWORDS).toHaveLength(7);
    expect(P0_RISK_KEYWORDS).toContain('자금 손실');
    expect(P0_RISK_KEYWORDS).toContain('가짜 STRONG_BUY');
    expect(P0_RISK_KEYWORDS).toContain('학습 데이터 오염');
  });

  it('BUG_AREAS_FALLBACK 사용자 명시 8개 영역', () => {
    expect(BUG_AREAS_FALLBACK).toHaveLength(8);
    expect(BUG_AREAS_FALLBACK).toContain('Market Truth Layer');
    expect(BUG_AREAS_FALLBACK).toContain('Order Execution Layer');
    expect(BUG_AREAS_FALLBACK).toContain('UI/UX Layer');
  });
});

// =====================================================
//   3. parseAreas
// =====================================================

describe('parseAreas', () => {
  it('H3 만 추출', () => {
    const src = `# h1\n## h2\n### Market Truth Layer\n### Risk Layer\n#### h4`;
    const areas = parseAreas(src);
    expect(areas.has('Market Truth Layer')).toBe(true);
    expect(areas.has('Risk Layer')).toBe(true);
    expect(areas.size).toBe(2);
  });

  it('메타 키워드 (규칙/기준/정의/원칙) 필터', () => {
    const src = `### 영역 명명 규칙\n### 영역 정의\n### Market Truth Layer\n### 분류 기준`;
    const areas = parseAreas(src);
    expect(areas.has('Market Truth Layer')).toBe(true);
    expect(areas.has('영역 명명 규칙')).toBe(false);
    expect(areas.has('영역 정의')).toBe(false);
    expect(areas.has('분류 기준')).toBe(false);
  });

  it('빈 입력 / null 안전', () => {
    expect(parseAreas('').size).toBe(0);
    expect(parseAreas(null).size).toBe(0);
    expect(parseAreas(undefined).size).toBe(0);
  });
});

// =====================================================
//   4. parseFrontmatter
// =====================================================

describe('parseFrontmatter', () => {
  it('단순 key:value 파싱', () => {
    const fm = parseFrontmatter('id: BUG-2026-01-01-001\nstatus: OPEN');
    expect(fm.id).toBe('BUG-2026-01-01-001');
    expect(fm.status).toBe('OPEN');
  });

  it('null 파싱', () => {
    const fm = parseFrontmatter('resolved: null');
    expect(fm.resolved).toBeNull();
  });

  it('빈 배열', () => {
    const fm = parseFrontmatter('related_adrs: []\nkeywords: []');
    expect(fm.related_adrs).toEqual([]);
    expect(fm.keywords).toEqual([]);
  });

  it('항목 있는 배열 (인용 부호 제거)', () => {
    const fm = parseFrontmatter('related_adrs: [ADR-0412, "ADR-0414"]');
    expect(fm.related_adrs).toEqual(['ADR-0412', 'ADR-0414']);
  });

  it('정수 파싱', () => {
    const fm = parseFrontmatter('recurrence_count: 0\nfoo: 42');
    expect(fm.recurrence_count).toBe(0);
    expect(fm.foo).toBe(42);
  });

  it('소수는 string 보존 (recurrence 검증에서 fail)', () => {
    const fm = parseFrontmatter('recurrence_count: 1.5');
    expect(typeof fm.recurrence_count).toBe('string');
  });
});

// =====================================================
//   5. extractBugEntries
// =====================================================

describe('extractBugEntries', () => {
  it('단일 BUG 항목 추출', () => {
    const entries = extractBugEntries(VALID_BUG_ENTRY);
    expect(entries).toHaveLength(1);
    expect(entries[0].frontmatter.id).toBe('BUG-2026-01-01-001');
    expect(entries[0].body).toContain('자금 손실');
  });

  it('frontmatter 표준 코드 펜스 안 `---` 제외', () => {
    const src = '# 표준\n```yaml\n---\nid: BUG-2026-01-01-001\n---\n```\n\n실제 항목 없음';
    const entries = extractBugEntries(src);
    expect(entries).toHaveLength(0);
  });

  it('다중 BUG 항목 분리', () => {
    const e1 = `---\nid: BUG-2026-01-01-001\nstatus: OPEN\nseverity: P0\narea: Market Truth Layer\ndiscovered: 2026-01-01\nresolved: null\nrelated_adrs: []\nrelated_bugs: []\nkeywords: []\nrecurrence_count: 0\n---\n\n${VALID_P0_BODY}\n`;
    const e2 = `---\nid: BUG-2026-01-02-001\nstatus: OPEN\nseverity: P1\narea: Risk Layer\ndiscovered: 2026-01-02\nresolved: null\nrelated_adrs: []\nrelated_bugs: []\nkeywords: []\nrecurrence_count: 0\n---\n\n## body2\n`;
    const entries = extractBugEntries(e1 + e2);
    expect(entries).toHaveLength(2);
    expect(entries[0].frontmatter.id).toBe('BUG-2026-01-01-001');
    expect(entries[1].frontmatter.id).toBe('BUG-2026-01-02-001');
  });

  it('id 가 BUG- 가 아닌 frontmatter 는 무시', () => {
    const src = '---\nid: NOT-A-BUG\nstatus: OPEN\n---';
    expect(extractBugEntries(src)).toHaveLength(0);
  });
});

// =====================================================
//   6. validateLedger — 13 카테고리
// =====================================================

describe('validateLedger', () => {
  function makeEntry(overrides = {}, bodyOverride = null) {
    const fields = {
      id: 'BUG-2026-01-01-001',
      status: 'OPEN',
      severity: 'P0',
      area: 'Market Truth Layer',
      discovered: '2026-01-01',
      resolved: 'null',
      related_adrs: '[]',
      related_bugs: '[]',
      keywords: '[]',
      recurrence_count: '0',
      ...overrides,
    };
    const fm = Object.entries(fields).map(([k, v]) => `${k}: ${v}`).join('\n');
    const body = bodyOverride !== null ? bodyOverride : VALID_P0_BODY;
    return `---\n${fm}\n---\n\n${body}\n`;
  }

  it('정상 엔트리는 errors=0', () => {
    const r = validateLedger({ ledgerSrc: makeEntry(), areasSrc: VALID_AREAS });
    expect(r.errors).toEqual([]);
    expect(r.stats.bugs).toBe(1);
    expect(r.stats.p0).toBe(1);
    expect(r.stats.open).toBe(1);
  });

  it('BUG_ID_INVALID — id 형식 위반', () => {
    const r = validateLedger({
      ledgerSrc: makeEntry({ id: 'BUG-2026-1-1-1' }),
      areasSrc: VALID_AREAS,
    });
    expect(r.errors.some((e) => e.code === 'BUG_ID_INVALID')).toBe(true);
  });

  it('BUG_ID_DUPLICATE — 중복 id', () => {
    const dup = makeEntry({ id: 'BUG-2026-01-01-001' }, '본문1\n자금 손실') +
                makeEntry({ id: 'BUG-2026-01-01-001' }, '본문2\n자금 손실');
    const r = validateLedger({ ledgerSrc: dup, areasSrc: VALID_AREAS });
    expect(r.errors.some((e) => e.code === 'BUG_ID_DUPLICATE')).toBe(true);
  });

  it('FRONTMATTER_MISSING_FIELD — recurrence_count 누락', () => {
    // 필드 자체를 빼는 형태로 직접 합성
    const fm = [
      'id: BUG-2026-01-01-001',
      'status: OPEN',
      'severity: P0',
      'area: Market Truth Layer',
      'discovered: 2026-01-01',
      'resolved: null',
      'related_adrs: []',
      'related_bugs: []',
      'keywords: []',
    ].join('\n');
    const src = `---\n${fm}\n---\n\n${VALID_P0_BODY}\n`;
    const r = validateLedger({ ledgerSrc: src, areasSrc: VALID_AREAS });
    expect(r.errors.some((e) => e.code === 'FRONTMATTER_MISSING_FIELD' && /recurrence_count/.test(e.message))).toBe(true);
  });

  it('STATUS_INVALID — 알 수 없는 status', () => {
    const r = validateLedger({
      ledgerSrc: makeEntry({ status: 'IN_PROGRESS' }),
      areasSrc: VALID_AREAS,
    });
    expect(r.errors.some((e) => e.code === 'STATUS_INVALID')).toBe(true);
  });

  it('SEVERITY_INVALID — 알 수 없는 severity', () => {
    const r = validateLedger({
      ledgerSrc: makeEntry({ severity: 'P9' }),
      areasSrc: VALID_AREAS,
    });
    expect(r.errors.some((e) => e.code === 'SEVERITY_INVALID')).toBe(true);
  });

  it('AREA_INVALID — BUG_AREAS.md 외 area', () => {
    const r = validateLedger({
      ledgerSrc: makeEntry({ area: 'Market Data Layer' }),
      areasSrc: VALID_AREAS,
    });
    expect(r.errors.some((e) => e.code === 'AREA_INVALID')).toBe(true);
  });

  it('AREA_INVALID — 대소문자/공백 변경 차단', () => {
    const r = validateLedger({
      ledgerSrc: makeEntry({ area: 'market truth layer' }),
      areasSrc: VALID_AREAS,
    });
    expect(r.errors.some((e) => e.code === 'AREA_INVALID')).toBe(true);
  });

  it('RECURRENCE_INVALID — 음수', () => {
    const r = validateLedger({
      ledgerSrc: makeEntry({ recurrence_count: '-1' }),
      areasSrc: VALID_AREAS,
    });
    expect(r.errors.some((e) => e.code === 'RECURRENCE_INVALID')).toBe(true);
  });

  it('RECURRENCE_INVALID — 소수', () => {
    const r = validateLedger({
      ledgerSrc: makeEntry({ recurrence_count: '1.5' }),
      areasSrc: VALID_AREAS,
    });
    expect(r.errors.some((e) => e.code === 'RECURRENCE_INVALID')).toBe(true);
  });

  it('RECURRENCE_INVALID — null', () => {
    const r = validateLedger({
      ledgerSrc: makeEntry({ recurrence_count: 'null' }),
      areasSrc: VALID_AREAS,
    });
    expect(r.errors.some((e) => e.code === 'RECURRENCE_INVALID')).toBe(true);
  });

  it('DATE_INVALID — discovered 잘못된 형식', () => {
    const r = validateLedger({
      ledgerSrc: makeEntry({ discovered: '2026/01/01' }),
      areasSrc: VALID_AREAS,
    });
    expect(r.errors.some((e) => e.code === 'DATE_INVALID')).toBe(true);
  });

  it('DATE_INVALID — resolved 가 잘못된 string', () => {
    const r = validateLedger({
      ledgerSrc: makeEntry({ resolved: 'TBD' }),
      areasSrc: VALID_AREAS,
    });
    expect(r.errors.some((e) => e.code === 'DATE_INVALID')).toBe(true);
  });

  it('DATE_INVALID 미발생 — resolved 가 정상 YYYY-MM-DD', () => {
    const r = validateLedger({
      ledgerSrc: makeEntry({ resolved: '2026-02-01' }),
      areasSrc: VALID_AREAS,
    });
    expect(r.errors.some((e) => e.code === 'DATE_INVALID')).toBe(false);
  });

  it('P0_SECTION_MISSING — 재발 감시 누락', () => {
    const incompleteBody = '### 증상\n자금 손실\n### 영향\n\n### 재현\n\n### 근본 원인\n\n### 기대 동작\n\n### 해결\n';
    const r = validateLedger({
      ledgerSrc: makeEntry({}, incompleteBody),
      areasSrc: VALID_AREAS,
    });
    expect(r.errors.some((e) => e.code === 'P0_SECTION_MISSING' && /재발 감시/.test(e.message))).toBe(true);
  });

  it('P0_RISK_KEYWORD_MISSING — 위험 키워드 0개', () => {
    const safeBody = [
      '### 증상', '단순 UI 깜빡임', '### 영향', '깜빡거림', '### 재현',
      '재현', '### 근본 원인', '원인', '### 기대 동작', '기대',
      '### 해결', '해결', '### 재발 감시', '60일',
    ].join('\n');
    const r = validateLedger({
      ledgerSrc: makeEntry({}, safeBody),
      areasSrc: VALID_AREAS,
    });
    expect(r.errors.some((e) => e.code === 'P0_RISK_KEYWORD_MISSING')).toBe(true);
  });

  it('P0_RISK_KEYWORD_MISSING 미발생 — 가짜 STRONG_BUY 포함', () => {
    const body = [
      '### 증상', '가짜 STRONG_BUY 발생', '### 영향', '오판정',
      '### 재현', '', '### 근본 원인', '', '### 기대 동작', '',
      '### 해결', '', '### 재발 감시', '',
    ].join('\n');
    const r = validateLedger({
      ledgerSrc: makeEntry({}, body),
      areasSrc: VALID_AREAS,
    });
    expect(r.errors.some((e) => e.code === 'P0_RISK_KEYWORD_MISSING')).toBe(false);
  });

  it('RELATED_ADRS_INVALID — 잘못된 형식', () => {
    const r = validateLedger({
      ledgerSrc: makeEntry({ related_adrs: '[ADR-412]' }),
      areasSrc: VALID_AREAS,
    });
    expect(r.errors.some((e) => e.code === 'RELATED_ADRS_INVALID')).toBe(true);
  });

  it('RELATED_ADRS — alias 형식 (ADR-0028a) 허용', () => {
    const r = validateLedger({
      ledgerSrc: makeEntry({ related_adrs: '[ADR-0028a, ADR-0412]' }),
      areasSrc: VALID_AREAS,
    });
    expect(r.errors.some((e) => e.code === 'RELATED_ADRS_INVALID')).toBe(false);
  });

  it('P1 항목은 P0 섹션 미강제', () => {
    const minimalBody = '## body\n간단한 진단 메시지';
    const r = validateLedger({
      ledgerSrc: makeEntry({ severity: 'P1' }, minimalBody),
      areasSrc: VALID_AREAS,
    });
    expect(r.errors.some((e) => e.code === 'P0_SECTION_MISSING')).toBe(false);
    expect(r.errors.some((e) => e.code === 'P0_RISK_KEYWORD_MISSING')).toBe(false);
    expect(r.stats.p0).toBe(0);
  });

  it('BUG_AREAS.md 부재 시 fallback 8 영역 사용', () => {
    const r = validateLedger({
      ledgerSrc: makeEntry({ area: 'Risk Layer' }),
      areasSrc: '',
    });
    expect(r.errors.some((e) => e.code === 'AREA_INVALID')).toBe(false);
  });

  it('통계 — open / watching 카운트', () => {
    const watching = makeEntry({ id: 'BUG-2026-01-01-002', status: 'WATCHING', severity: 'P1' }, 'body');
    const open = makeEntry({ id: 'BUG-2026-01-01-003', status: 'OPEN', severity: 'P1' }, 'body');
    const r = validateLedger({ ledgerSrc: watching + open, areasSrc: VALID_AREAS });
    expect(r.stats.open).toBe(1);
    expect(r.stats.watching).toBe(1);
    expect(r.stats.bugs).toBe(2);
  });
});

// =====================================================
//   7. checkFixesReferences
// =====================================================

describe('checkFixesReferences', () => {
  const ledgerWithBug = '---\nid: BUG-2026-05-07-001\nstatus: OPEN\n---\n\n본문';

  it('빈 텍스트 — referenced=0, errors=0', () => {
    const r = checkFixesReferences({ ledgerSrc: ledgerWithBug, text: '' });
    expect(r.errors).toEqual([]);
    expect(r.referenced).toEqual([]);
  });

  it('존재하는 BUG ID — 통과', () => {
    const r = checkFixesReferences({
      ledgerSrc: ledgerWithBug,
      text: 'Fixes BUG-2026-05-07-001',
    });
    expect(r.errors).toEqual([]);
    expect(r.referenced).toEqual(['BUG-2026-05-07-001']);
  });

  it('존재하지 않는 BUG ID — UNKNOWN_BUG_REFERENCE', () => {
    const r = checkFixesReferences({
      ledgerSrc: ledgerWithBug,
      text: 'Fixes BUG-2099-01-01-999',
    });
    expect(r.errors.some((e) => e.code === 'UNKNOWN_BUG_REFERENCE')).toBe(true);
    expect(r.referenced).toEqual(['BUG-2099-01-01-999']);
  });

  it('heading 만 있고 frontmatter id: 없으면 매칭 차단', () => {
    const headingOnly = '## BUG-2026-05-07-001 — heading\n본문';
    const r = checkFixesReferences({
      ledgerSrc: headingOnly,
      text: 'Fixes BUG-2026-05-07-001',
    });
    expect(r.errors.some((e) => e.code === 'UNKNOWN_BUG_REFERENCE')).toBe(true);
  });

  it('다중 BUG 참조', () => {
    const ledger = ledgerWithBug + '\n---\nid: BUG-2026-05-08-001\nstatus: OPEN\n---\n';
    const r = checkFixesReferences({
      ledgerSrc: ledger,
      text: 'Fixes BUG-2026-05-07-001 and Fixes BUG-2026-05-08-001',
    });
    expect(r.errors).toEqual([]);
    expect(r.referenced).toHaveLength(2);
  });
});

// =====================================================
//   8. runCli — 통합
// =====================================================

describe('runCli', () => {
  function captureCli(argv, rootDir) {
    const stdout = new PassThrough();
    const stderr = new PassThrough();
    const out = [];
    const err = [];
    stdout.on('data', (chunk) => out.push(chunk));
    stderr.on('data', (chunk) => err.push(chunk));
    const code = runCli({ argv, stdout, stderr, rootDir });
    return {
      code,
      stdout: Buffer.concat(out).toString('utf8'),
      stderr: Buffer.concat(err).toString('utf8'),
    };
  }

  it('--text 존재하는 BUG — exit 0', () => {
    const result = execSync(
      `node ${SCRIPT} --text "Fixes BUG-2026-05-07-001"`,
      { cwd: ROOT, encoding: 'utf8' }
    );
    expect(result).toContain('✅ BUG_LEDGER validation passed');
    expect(result).toMatch(/fixes references verified: 1/);
  });

  it('--text 존재하지 않는 BUG — exit 1', () => {
    let exit = 0;
    let stderrOut = '';
    try {
      execSync(`node ${SCRIPT} --text "Fixes BUG-2099-01-01-999"`,
        { cwd: ROOT, encoding: 'utf8', stdio: 'pipe' });
    } catch (err) {
      exit = err.status;
      stderrOut = err.stderr.toString();
    }
    expect(exit).toBe(1);
    expect(stderrOut).toContain('UNKNOWN_BUG_REFERENCE');
  });

  it('파일 부재 시 BUG_LEDGER_MISSING / BUG_AREAS_MISSING / BUG_TEMPLATE_MISSING', () => {
    const dir = mkdtempSync(join(tmpdir(), 'bug-empty-'));
    tempDirs.push(dir);
    const r = captureCli(['--json'], dir);
    expect(r.code).toBe(1);
    const data = JSON.parse(r.stdout);
    const codes = data.errors.map((e) => e.code);
    expect(codes).toContain('BUG_LEDGER_MISSING');
    expect(codes).toContain('BUG_AREAS_MISSING');
    expect(codes).toContain('BUG_TEMPLATE_MISSING');
  });

  it('--json 출력 형식 (성공)', () => {
    const out = execSync(`node ${SCRIPT} --json`, { cwd: ROOT, encoding: 'utf8' });
    const data = JSON.parse(out);
    expect(data).toHaveProperty('ok');
    expect(data).toHaveProperty('errors');
    expect(data).toHaveProperty('stats');
    expect(data).toHaveProperty('referenced');
  });

  it('temp 디렉토리에서 정상 BUG_LEDGER 생성 후 통과', () => {
    const dir = makeTempLedger({
      ledger: VALID_BUG_ENTRY,
      areas: VALID_AREAS,
    });
    const r = captureCli([], dir);
    expect(r.code).toBe(0);
    expect(r.stdout).toContain('✅ BUG_LEDGER validation passed');
  });

  it('--text 인자에 BUG 참조가 여러개 있을 때', () => {
    const dir = makeTempLedger({
      ledger: VALID_BUG_ENTRY +
        `---\nid: BUG-2026-01-02-001\nstatus: OPEN\nseverity: P1\narea: Risk Layer\ndiscovered: 2026-01-02\nresolved: null\nrelated_adrs: []\nrelated_bugs: []\nkeywords: []\nrecurrence_count: 0\n---\n\n## body2\n`,
      areas: VALID_AREAS,
    });
    const r = captureCli(['--text', 'Fixes BUG-2026-01-01-001 and BUG-2026-01-02-001'], dir);
    expect(r.code).toBe(0);
  });
});
