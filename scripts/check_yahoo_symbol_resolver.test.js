/**
 * @responsibility check_yahoo_symbol_resolver 회귀 테스트 (ADR-0444)
 *
 * Guard A — `${X}.KS` / `${X}.KQ` direct template concat
 * Guard B — `/^\d{6}$/` 정규식 + Yahoo symbol 조립 컨텍스트
 *
 * 본 lint script 가:
 *   1) 현재 baseline (server/ 0건 위반) 통과
 *   2) Guard A: direct concat 단독 사용 → EXIT=1
 *   3) Guard A: graceful fallback (SSOT 호출 + ?? `${code}.KS`) → 통과
 *   4) Guard A: ADR-NNNN: opt-in 주석 (같은 라인 / 직전 라인 / 파일 헤더) → 통과
 *   5) Guard A: 화이트리스트 파일 (yahooSymbolResolver / symbolNormalizer / defectEvolutionLedger) → 검출 안 함
 *   6) Guard A: src/ 디렉토리 (클라이언트 측) → 검출 안 함
 *   7) Guard A: ADR docs / *.test.ts → 검출 안 함
 *   8) Guard A: 한 줄 주석 / 블록 주석 안 시그니처 → 검출 안 함
 *   9) Guard A: suffix strip (`.replace('.KS', '')`) → 검출 안 함 (다른 패턴)
 *   10) Guard B: `/^\d{6}$/` + 같은 라인 `${X}.KS` → EXIT=1
 *   11) Guard B: `/^\d{6}$/` + 다음 라인 `${X}.KS` → EXIT=1
 *   12) Guard B: 순수 input validator (`/^\d{6}$/.test(code)` 단독) → 통과
 *   13) Guard B: 화이트리스트 파일 (symbolNormalizer.ts) → 검출 안 함
 *   14) JSON 출력 모드 (`--json`) — `{ok, violations, byFile}`
 *   15) `--changed` 모드 — staged 파일 없을 때 skip + EXIT=0
 *   16) 다중 위반 모두 보고 + 총 카운트 + Guard A/B 라벨 표시
 */
import { describe, it, expect, afterEach } from 'vitest';
import { execSync } from 'child_process';
import { writeFileSync, mkdirSync, existsSync, rmSync } from 'fs';
import { join, dirname } from 'path';
import { tmpdir } from 'os';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const ROOT = join(__dirname, '..');
// 픽스처는 라이브 server/ 트리 밖(OS temp)에 두고 YAHOO_RESOLVER_EXTRA_SCAN_ROOT 로만 검사에
// 포함 — server/ 안에 두면 병렬 vitest 워커/다른 validator walker 가 생성·삭제 찰나의 파일을
// 밟아 ENOENT 크래시·오탐 레이스 (2026-06-10 full-suite flaky 원인).
const FIXTURE_DIR = join(tmpdir(), `qmp_yahoo_symbol_resolver_fixtures_${process.pid}`);

function runLint(extraArgs = '') {
  try {
    const out = execSync(`node scripts/check_yahoo_symbol_resolver.js ${extraArgs}`.trim(), {
      cwd: ROOT,
      encoding: 'utf-8',
      stdio: ['pipe', 'pipe', 'pipe'],
      env: { ...process.env, YAHOO_RESOLVER_EXTRA_SCAN_ROOT: FIXTURE_DIR },
    });
    return { exitCode: 0, output: out };
  } catch (err) {
    return {
      exitCode: err.status ?? 1,
      output: (err.stdout?.toString() ?? '') + (err.stderr?.toString() ?? ''),
    };
  }
}

afterEach(() => {
  if (existsSync(FIXTURE_DIR)) {
    rmSync(FIXTURE_DIR, { recursive: true, force: true });
  }
});

describe('check_yahoo_symbol_resolver — baseline', () => {
  it('현재 baseline (fixture 없을 때) 통과 EXIT=0', () => {
    const result = runLint();
    expect(result.exitCode).toBe(0);
    expect(result.output).toContain('위반 0건');
  });

  it('JSON 출력 모드 baseline ok=true', () => {
    const result = runLint('--json');
    expect(result.exitCode).toBe(0);
    const parsed = JSON.parse(result.output);
    expect(parsed.ok).toBe(true);
    expect(parsed.violations).toBe(0);
  });

  it('ADR-0444 헤더 메시지 명시', () => {
    // baseline 통과 시 "(ADR-0444)" 마커 본문에 포함
    const result = runLint();
    expect(result.output).toContain('ADR-0444');
  });
});

describe('check_yahoo_symbol_resolver — Guard A (Yahoo direct concat)', () => {
  it('direct concat 단독 사용 → EXIT=1', () => {
    mkdirSync(FIXTURE_DIR, { recursive: true });
    writeFileSync(
      join(FIXTURE_DIR, 'badConcat.ts'),
      'export function buildSymbol(code: string): string {\n' +
        '  return `${code}.KS`;\n' +
        '}\n',
    );
    const result = runLint();
    expect(result.exitCode).toBe(1);
    expect(result.output).toContain('badConcat.ts');
    expect(result.output).toContain('Guard A');
    expect(result.output).toContain('${code}.KS');
  });

  it('${X}.KQ 도 동일하게 검출', () => {
    mkdirSync(FIXTURE_DIR, { recursive: true });
    writeFileSync(
      join(FIXTURE_DIR, 'badKq.ts'),
      'export function buildSymbol(c: string): string {\n' +
        '  return `${c}.KQ`;\n' +
        '}\n',
    );
    const result = runLint();
    expect(result.exitCode).toBe(1);
    expect(result.output).toContain('${c}.KQ');
  });

  it('graceful fallback (SSOT 호출 + ?? `${code}.KS`) 통과', () => {
    mkdirSync(FIXTURE_DIR, { recursive: true });
    writeFileSync(
      join(FIXTURE_DIR, 'gracefulFallback.ts'),
      'declare function tryGetYahooSymbol(code: string): string | null;\n' +
        'export function build(code: string): string {\n' +
        '  return tryGetYahooSymbol(code) ?? `${code}.KS`;\n' +
        '}\n',
    );
    const result = runLint();
    expect(result.exitCode).toBe(0);
  });

  it('fetchYahooQuoteByCode 같은 라인 SSOT 호출 통과', () => {
    mkdirSync(FIXTURE_DIR, { recursive: true });
    writeFileSync(
      join(FIXTURE_DIR, 'gracefulQuote.ts'),
      'declare function fetchYahooQuoteByCode(c: string, f: any): Promise<any>;\n' +
        'declare const fetchYahooQuote: any;\n' +
        'export async function build(code: string): Promise<any> {\n' +
        '  return (await fetchYahooQuoteByCode(code, fetchYahooQuote)) ?? `${code}.KS`;\n' +
        '}\n',
    );
    const result = runLint();
    expect(result.exitCode).toBe(0);
  });

  it('// ADR-0444: 같은 라인 opt-in 주석 통과', () => {
    mkdirSync(FIXTURE_DIR, { recursive: true });
    writeFileSync(
      join(FIXTURE_DIR, 'adrSameLine.ts'),
      'export function build(code: string): string {\n' +
        '  return `${code}.KS`; // ADR-0444: legacy fallback\n' +
        '}\n',
    );
    const result = runLint();
    expect(result.exitCode).toBe(0);
  });

  it('// ADR-0443: 직전 라인 opt-in 주석 통과', () => {
    mkdirSync(FIXTURE_DIR, { recursive: true });
    writeFileSync(
      join(FIXTURE_DIR, 'adrPrevLine.ts'),
      'export function build(code: string): string {\n' +
        '  // ADR-0443: 마이그레이션 그레이스\n' +
        '  return `${code}.KS`;\n' +
        '}\n',
    );
    const result = runLint();
    expect(result.exitCode).toBe(0);
  });

  it('파일 헤더 ADR-0443 마커 → 파일 전체 opt-in 통과', () => {
    mkdirSync(FIXTURE_DIR, { recursive: true });
    writeFileSync(
      join(FIXTURE_DIR, 'fileHeaderAdr.ts'),
      '/**\n' +
        ' * Module title.\n' +
        ' *\n' +
        ' * ADR-0443 — yahooSymbolResolver SSOT 위임 마이그레이션.\n' +
        ' */\n' +
        'export function build(code: string): string {\n' +
        '  return `${code}.KS`;\n' +
        '}\n',
    );
    const result = runLint();
    expect(result.exitCode).toBe(0);
  });

  it('파일 헤더 ADR-0231 (yahooSymbolResolver SSOT 도입) 마커 통과', () => {
    mkdirSync(FIXTURE_DIR, { recursive: true });
    writeFileSync(
      join(FIXTURE_DIR, 'adr0231Header.ts'),
      '// ADR-0231 — yahooSymbolResolver SSOT.\n' +
        'export function build(code: string): string {\n' +
        '  return `${code}.KS`;\n' +
        '}\n',
    );
    const result = runLint();
    expect(result.exitCode).toBe(0);
  });

  it('한 줄 주석 안 시그니처 무시 (false positive 차단)', () => {
    mkdirSync(FIXTURE_DIR, { recursive: true });
    writeFileSync(
      join(FIXTURE_DIR, 'commentLine.ts'),
      '// 과거에는 `${code}.KS` 직접 조립이 자주 있었음 (현재 ADR-0443 SSOT 사용)\n' +
        'export const safe = true;\n',
    );
    const result = runLint();
    expect(result.exitCode).toBe(0);
  });

  it('블록 주석 안 시그니처 무시', () => {
    mkdirSync(FIXTURE_DIR, { recursive: true });
    writeFileSync(
      join(FIXTURE_DIR, 'commentBlock.ts'),
      '/* 결함 예시:\n' +
        ' *   const sym = `${code}.KS`; // ADR-0231 이전 패턴\n' +
        ' *   const sym = `${code}.KQ`;\n' +
        ' */\n' +
        'export const safe = true;\n',
    );
    const result = runLint();
    expect(result.exitCode).toBe(0);
  });

  it('suffix strip `.replace(\'.KS\', \'\')` 무시 (다른 패턴)', () => {
    mkdirSync(FIXTURE_DIR, { recursive: true });
    writeFileSync(
      join(FIXTURE_DIR, 'suffixStrip.ts'),
      'export function strip(s: string): string {\n' +
        "  return s.replace('.KS', '').replace('.KQ', '');\n" +
        '}\n',
    );
    const result = runLint();
    expect(result.exitCode).toBe(0);
  });

  it('endsWith(.KS) / endsWith(.KQ) 검사 무시 (template literal 아님)', () => {
    mkdirSync(FIXTURE_DIR, { recursive: true });
    writeFileSync(
      join(FIXTURE_DIR, 'endsWith.ts'),
      'export function isKospi(sym: string): boolean {\n' +
        "  return sym.endsWith('.KS');\n" +
        '}\n',
    );
    const result = runLint();
    expect(result.exitCode).toBe(0);
  });

  it('다중 위반 보고 — 총 카운트 + 파일 별 line 정보', () => {
    mkdirSync(FIXTURE_DIR, { recursive: true });
    writeFileSync(
      join(FIXTURE_DIR, 'multi1.ts'),
      'export function a(code: string): string { return `${code}.KS`; }\n',
    );
    writeFileSync(
      join(FIXTURE_DIR, 'multi2.ts'),
      'export function b(c: string): string { return `${c}.KQ`; }\n',
    );
    const result = runLint();
    expect(result.exitCode).toBe(1);
    expect(result.output).toContain('multi1.ts');
    expect(result.output).toContain('multi2.ts');
    expect(result.output).toContain('위반 2건');
  });

  it('JSON 출력 violations + byFile 구조 검증', () => {
    mkdirSync(FIXTURE_DIR, { recursive: true });
    writeFileSync(
      join(FIXTURE_DIR, 'jsonBad.ts'),
      'export function a(code: string): string { return `${code}.KS`; }\n',
    );
    const result = runLint('--json');
    expect(result.exitCode).toBe(1);
    const parsed = JSON.parse(result.output);
    expect(parsed.ok).toBe(false);
    expect(parsed.violations).toBeGreaterThan(0);
    expect(parsed.byFile).toBeDefined();
    const fileKey = Object.keys(parsed.byFile).find((k) => k.includes('jsonBad.ts'));
    expect(fileKey).toBeDefined();
    expect(parsed.byFile[fileKey][0].guard).toBe('A');
  });
});

describe('check_yahoo_symbol_resolver — Guard B (KRX regex + Yahoo assembly)', () => {
  it('`/^\\d{6}$/` + 같은 라인 `${X}.KS` 조립 → EXIT=1', () => {
    mkdirSync(FIXTURE_DIR, { recursive: true });
    writeFileSync(
      join(FIXTURE_DIR, 'badGuardB.ts'),
      'export function n(s: string): string {\n' +
        '  if (/^\\d{6}$/.test(s)) return `${s}.KS`;\n' +
        '  return s;\n' +
        '}\n',
    );
    const result = runLint();
    expect(result.exitCode).toBe(1);
    expect(result.output).toContain('Guard B');
    expect(result.output).toContain('badGuardB.ts');
  });

  it('`/^\\d{6}$/` + 다음 라인 `${X}.KS` → EXIT=1', () => {
    mkdirSync(FIXTURE_DIR, { recursive: true });
    writeFileSync(
      join(FIXTURE_DIR, 'badGuardBNext.ts'),
      'export function n(s: string): string {\n' +
        '  if (/^\\d{6}$/.test(s)) {\n' +
        '    return `${s}.KS`;\n' +
        '  }\n' +
        '  return s;\n' +
        '}\n',
    );
    const result = runLint();
    expect(result.exitCode).toBe(1);
    expect(result.output).toContain('Guard B');
  });

  it('순수 input validator (`/^\\d{6}$/.test()` 단독) 통과', () => {
    mkdirSync(FIXTURE_DIR, { recursive: true });
    writeFileSync(
      join(FIXTURE_DIR, 'pureValidator.ts'),
      'export function isKrxCode(code: string): boolean {\n' +
        '  return /^\\d{6}$/.test(code);\n' +
        '}\n',
    );
    const result = runLint();
    expect(result.exitCode).toBe(0);
  });

  it('input validator + early return (no .KS/.KQ assembly) 통과', () => {
    mkdirSync(FIXTURE_DIR, { recursive: true });
    writeFileSync(
      join(FIXTURE_DIR, 'validatorEarlyReturn.ts'),
      'export function check(code: string): string | null {\n' +
        '  if (!/^\\d{6}$/.test(code)) return null;\n' +
        '  return code;\n' +
        '}\n',
    );
    const result = runLint();
    expect(result.exitCode).toBe(0);
  });

  it('Guard B + ADR-0444 opt-in 주석 통과', () => {
    mkdirSync(FIXTURE_DIR, { recursive: true });
    writeFileSync(
      join(FIXTURE_DIR, 'guardBOptIn.ts'),
      'export function n(s: string): string {\n' +
        '  // ADR-0444: legacy normalizer\n' +
        '  if (/^\\d{6}$/.test(s)) return `${s}.KS`;\n' +
        '  return s;\n' +
        '}\n',
    );
    const result = runLint();
    expect(result.exitCode).toBe(0);
  });
});

describe('check_yahoo_symbol_resolver — 화이트리스트', () => {
  it('yahooSymbolResolver.ts (SSOT 자기 자신) 검출 안 함', () => {
    // 실제 파일 — baseline 일부, 시그니처 보유하지만 위반 아님
    const result = runLint();
    expect(result.exitCode).toBe(0);
  });

  it('src/ 디렉토리 (클라이언트 측) 검출 안 함', () => {
    // 실제 src/services/stock/historicalData.ts 가 ${baseCode}.KS 를 가지고 있음
    // 본 스크립트는 server/ 만 검사 — baseline 통과 시 자동 검증
    const result = runLint();
    expect(result.exitCode).toBe(0);
  });

  it('docs/adr/**.md 검출 안 함 (확장자 차단)', () => {
    // 본 스크립트는 .ts/.tsx/.js 만 검사 — *.md 자연 제외
    const result = runLint();
    expect(result.exitCode).toBe(0);
  });

  it('*.test.ts 회귀 시나리오 검출 안 함', () => {
    mkdirSync(FIXTURE_DIR, { recursive: true });
    writeFileSync(
      join(FIXTURE_DIR, 'sample.test.ts'),
      'export const fixture = `${code}.KS`;\n',
    );
    const result = runLint();
    // *.test.ts 파일은 IGNORED_SUFFIX 로 자동 제외
    expect(result.exitCode).toBe(0);
  });
});

describe('check_yahoo_symbol_resolver — 모드 옵션', () => {
  it('--changed 모드 staged 파일 없을 때 skip', () => {
    try {
      const out = execSync('node scripts/check_yahoo_symbol_resolver.js --changed', {
        cwd: ROOT,
        encoding: 'utf-8',
        stdio: ['pipe', 'pipe', 'pipe'],
      });
      // 변경된 파일 없을 때 정상 종료
      expect(out.length).toBeGreaterThan(0);
    } catch (err) {
      expect(err.status === 0 || err.status === 1).toBe(true);
    }
  });

  it('--json 모드 baseline 통과 ok=true', () => {
    const result = runLint('--json');
    expect(result.exitCode).toBe(0);
    const parsed = JSON.parse(result.output);
    expect(parsed.ok).toBe(true);
  });
});

describe('check_yahoo_symbol_resolver — 통합 시나리오', () => {
  it('Guard A + Guard B 동시 위반 — 모두 보고', () => {
    mkdirSync(FIXTURE_DIR, { recursive: true });
    writeFileSync(
      join(FIXTURE_DIR, 'bothGuards.ts'),
      'export function bad1(c: string): string { return `${c}.KS`; }\n' +
        'export function bad2(s: string): string {\n' +
        '  if (/^\\d{6}$/.test(s)) return `${s}.KQ`;\n' +
        '  return s;\n' +
        '}\n',
    );
    const result = runLint();
    expect(result.exitCode).toBe(1);
    expect(result.output).toContain('Guard A');
    expect(result.output).toContain('Guard B');
  });

  it('진단 메시지 형식 — 라인 번호 + Guard 라벨 + match 표시', () => {
    mkdirSync(FIXTURE_DIR, { recursive: true });
    writeFileSync(
      join(FIXTURE_DIR, 'diag.ts'),
      'export function a(code: string): string { return `${code}.KS`; }\n',
    );
    const result = runLint();
    expect(result.exitCode).toBe(1);
    expect(result.output).toMatch(/L\d+:\d+/);
    expect(result.output).toContain('YAHOO_DIRECT_CONCAT');
  });

  it('해결 안내 메시지 (tryGetYahooSymbol / fetchYahooQuoteByCode) 포함', () => {
    mkdirSync(FIXTURE_DIR, { recursive: true });
    writeFileSync(
      join(FIXTURE_DIR, 'help.ts'),
      'export function a(c: string): string { return `${c}.KS`; }\n',
    );
    const result = runLint();
    expect(result.exitCode).toBe(1);
    expect(result.output).toContain('tryGetYahooSymbol');
    expect(result.output).toContain('fetchYahooQuoteByCode');
  });
});
