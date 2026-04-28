/**
 * @responsibility check_yahoo_range 회귀 테스트 (ADR-0082)
 *
 * 본 lint script 가:
 *   1) 현재 baseline (server/ 0건 위반) 통과
 *   2) FIXTURE_DIR 의 위반 패턴 1건 시 EXIT=1 + 시그니처 보고
 *   3) 화이트리스트 외 파일에서 'range=2y' / '5y' / '10y' / 'max' / 'ytd' 차단
 *   4) 화이트리스트 외 파일에서 문자열 리터럴 '2y' / '5y' / '10y' 차단
 *   5) 한 줄 주석 안 패턴은 무시 (false positive 차단)
 *   6) 블록 주석 안 패턴은 무시 (false positive 차단)
 *   7) 다중 위반 모두 보고 + 총 카운트 표시
 */
import { describe, it, expect, afterEach } from 'vitest';
import { execSync } from 'child_process';
import { writeFileSync, mkdirSync, existsSync, rmSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const ROOT = join(__dirname, '..');
const FIXTURE_DIR = join(ROOT, 'server', 'trading', '__yahoo_range_fixtures__');

function runLint() {
  try {
    const out = execSync('node scripts/check_yahoo_range.js', {
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

afterEach(() => {
  if (existsSync(FIXTURE_DIR)) {
    rmSync(FIXTURE_DIR, { recursive: true, force: true });
  }
});

describe('check_yahoo_range lint script', () => {
  it('현재 baseline (fixture 없을 때) 통과 EXIT=0', () => {
    const result = runLint();
    expect(result.exitCode).toBe(0);
    expect(result.output).toContain('위반 0건');
  });

  it("URL 쿼리 'range=2y' 발견 시 EXIT=1", () => {
    mkdirSync(FIXTURE_DIR, { recursive: true });
    writeFileSync(
      join(FIXTURE_DIR, 'badQuery.ts'),
      "export const url = `https://query1.finance.yahoo.com/v8/finance/chart/AAPL?range=2y&interval=1d`;\n",
    );
    const result = runLint();
    expect(result.exitCode).toBe(1);
    expect(result.output).toContain('badQuery.ts');
    expect(result.output).toContain('range=2y');
    expect(result.output).toContain('URL_QUERY');
  });

  it("URL 쿼리 'range=5y' 발견 시 EXIT=1", () => {
    mkdirSync(FIXTURE_DIR, { recursive: true });
    writeFileSync(
      join(FIXTURE_DIR, 'badRange5y.ts'),
      "export const url = 'https://q.yahoo.com/?range=5y&interval=1d';\n",
    );
    const result = runLint();
    expect(result.exitCode).toBe(1);
    expect(result.output).toContain('range=5y');
  });

  it("URL 쿼리 'range=max' 발견 시 EXIT=1", () => {
    mkdirSync(FIXTURE_DIR, { recursive: true });
    writeFileSync(
      join(FIXTURE_DIR, 'badRangeMax.ts'),
      "export const url = 'https://q.yahoo.com/?range=max';\n",
    );
    const result = runLint();
    expect(result.exitCode).toBe(1);
    expect(result.output).toContain('range=max');
  });

  it("URL 쿼리 'range=ytd' 발견 시 EXIT=1", () => {
    mkdirSync(FIXTURE_DIR, { recursive: true });
    writeFileSync(
      join(FIXTURE_DIR, 'badRangeYtd.ts'),
      "export const url = 'https://q.yahoo.com/?range=ytd';\n",
    );
    const result = runLint();
    expect(result.exitCode).toBe(1);
    expect(result.output).toContain('range=ytd');
  });

  it("문자열 리터럴 '2y' 발견 시 EXIT=1", () => {
    mkdirSync(FIXTURE_DIR, { recursive: true });
    writeFileSync(
      join(FIXTURE_DIR, 'badLiteral2y.ts'),
      "const range = '2y';\nexport { range };\n",
    );
    const result = runLint();
    expect(result.exitCode).toBe(1);
    expect(result.output).toContain('STRING_LITERAL');
    expect(result.output).toContain("'2y'");
  });

  it("문자열 리터럴 \"5y\" 발견 시 EXIT=1", () => {
    mkdirSync(FIXTURE_DIR, { recursive: true });
    writeFileSync(
      join(FIXTURE_DIR, 'badLiteral5y.ts'),
      'const range = "5y";\nexport { range };\n',
    );
    const result = runLint();
    expect(result.exitCode).toBe(1);
    expect(result.output).toContain('STRING_LITERAL');
  });

  it('한 줄 주석 안 패턴은 무시 (false positive 차단)', () => {
    mkdirSync(FIXTURE_DIR, { recursive: true });
    writeFileSync(
      join(FIXTURE_DIR, 'commentLine.ts'),
      "// 과거에는 range=2y 였지만 ADR-0082 로 차단\n// 또는 '2y' 문자열도 정책 위반\nexport const safe = true;\n",
    );
    const result = runLint();
    expect(result.exitCode).toBe(0);
  });

  it('블록 주석 안 패턴은 무시 (false positive 차단)', () => {
    mkdirSync(FIXTURE_DIR, { recursive: true });
    writeFileSync(
      join(FIXTURE_DIR, 'commentBlock.ts'),
      "/* 정책 변경 전: range=2y\n   변경 후: range=1y. \"2y\" 도 차단. */\nexport const safe = true;\n",
    );
    const result = runLint();
    expect(result.exitCode).toBe(0);
  });

  it('다중 위반 모두 보고 + 총 카운트 표시', () => {
    mkdirSync(FIXTURE_DIR, { recursive: true });
    writeFileSync(
      join(FIXTURE_DIR, 'multi1.ts'),
      "export const url = 'https://q.yahoo.com/?range=2y';\n",
    );
    writeFileSync(
      join(FIXTURE_DIR, 'multi2.ts'),
      "const range = '5y';\nexport { range };\n",
    );
    const result = runLint();
    expect(result.exitCode).toBe(1);
    expect(result.output).toContain('multi1.ts');
    expect(result.output).toContain('multi2.ts');
    expect(result.output).toContain('위반 2건');
  });

  it('허용 range (1y / 6mo / 3mo) 통과', () => {
    mkdirSync(FIXTURE_DIR, { recursive: true });
    writeFileSync(
      join(FIXTURE_DIR, 'allowed.ts'),
      "export const urls = [\n  'https://q.yahoo.com/?range=1y',\n  'https://q.yahoo.com/?range=6mo',\n  'https://q.yahoo.com/?range=3mo',\n];\n",
    );
    const result = runLint();
    expect(result.exitCode).toBe(0);
  });

  it('--changed 모드 — staged 파일 없을 때 skip', () => {
    try {
      const out = execSync('node scripts/check_yahoo_range.js --changed', {
        cwd: ROOT,
        encoding: 'utf-8',
        stdio: ['pipe', 'pipe', 'pipe'],
      });
      expect(out).toContain('--changed');
    } catch (err) {
      // 스테이지된 파일이 있을 수 있음 — 정상 동작
      expect(err.status === 0 || err.status === 1).toBe(true);
    }
  });
});
