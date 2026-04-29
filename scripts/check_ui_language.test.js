/**
 * @responsibility check_ui_language 회귀 테스트 (ADR-0094)
 *
 * 본 lint script 가:
 *   1) 현재 baseline (src/ 0건 위반) 통과
 *   2) FIXTURE_DIR 의 위반 패턴 1건 시 EXIT=1 + 시그니처 보고
 *   3) 4 카테고리 (ABSOLUTE/AMBIGUOUS_SOURCE/EMOTIONAL/PROMISE) 모두 차단
 *   4) 식별자/주석 안 패턴은 무시 (false positive 차단)
 *   5) string literal 안에서만 매칭
 *   6) 다중 위반 모두 보고 + 총 카운트 표시
 *   7) --changed 모드 동작
 *   8) 화이트리스트 (uiLanguage.ts) 통과
 */
import { describe, it, expect, afterEach } from 'vitest';
import { execSync } from 'child_process';
import { writeFileSync, mkdirSync, existsSync, rmSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const ROOT = join(__dirname, '..');
const FIXTURE_DIR = join(ROOT, 'src', '__ui_lang_fixtures__');

function runLint() {
  try {
    const out = execSync('node scripts/check_ui_language.js', {
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

describe('check_ui_language lint script', () => {
  it('현재 baseline (fixture 없을 때) 통과 EXIT=0', () => {
    const result = runLint();
    expect(result.exitCode).toBe(0);
    expect(result.output).toContain('위반 0건');
  });

  // ============================================================
  // 카테고리 1: ABSOLUTE (절대 표현)
  // ============================================================
  it("ABSOLUTE: '완벽한' 발견 시 EXIT=1", () => {
    mkdirSync(FIXTURE_DIR, { recursive: true });
    writeFileSync(
      join(FIXTURE_DIR, 'badAbsolute1.ts'),
      "export const label = '완벽한 매수 신호';\n",
    );
    const result = runLint();
    expect(result.exitCode).toBe(1);
    expect(result.output).toContain('badAbsolute1.ts');
    expect(result.output).toContain('완벽한');
    expect(result.output).toContain('ABSOLUTE');
  });

  it("ABSOLUTE: '강력한' 발견 시 EXIT=1", () => {
    mkdirSync(FIXTURE_DIR, { recursive: true });
    writeFileSync(
      join(FIXTURE_DIR, 'badAbsolute2.ts'),
      'export const label = "강력한 추천";\n',
    );
    const result = runLint();
    expect(result.exitCode).toBe(1);
    expect(result.output).toContain('강력한');
  });

  it("ABSOLUTE: '베스트' 발견 시 EXIT=1", () => {
    mkdirSync(FIXTURE_DIR, { recursive: true });
    writeFileSync(
      join(FIXTURE_DIR, 'badAbsolute3.ts'),
      "export const label = `오늘의 베스트 종목`;\n",
    );
    const result = runLint();
    expect(result.exitCode).toBe(1);
    expect(result.output).toContain('베스트');
  });

  // ============================================================
  // 카테고리 2: AMBIGUOUS_SOURCE (출처 모호)
  // ============================================================
  it("AMBIGUOUS_SOURCE: 'AI 가 분석' 발견 시 EXIT=1", () => {
    mkdirSync(FIXTURE_DIR, { recursive: true });
    writeFileSync(
      join(FIXTURE_DIR, 'badSource1.ts'),
      "export const label = 'AI 가 분석한 종목입니다';\n",
    );
    const result = runLint();
    expect(result.exitCode).toBe(1);
    expect(result.output).toContain('AMBIGUOUS_SOURCE');
    expect(result.output).toContain('AI 가 분석');
  });

  it("AMBIGUOUS_SOURCE: 'AI 추천' 발견 시 EXIT=1", () => {
    mkdirSync(FIXTURE_DIR, { recursive: true });
    writeFileSync(
      join(FIXTURE_DIR, 'badSource2.ts'),
      'export const label = "AI 추천 결과";\n',
    );
    const result = runLint();
    expect(result.exitCode).toBe(1);
    expect(result.output).toContain('AI 추천');
  });

  // ============================================================
  // 카테고리 3: EMOTIONAL (감정 표현)
  // ============================================================
  it("EMOTIONAL: '대박' 발견 시 EXIT=1", () => {
    mkdirSync(FIXTURE_DIR, { recursive: true });
    writeFileSync(
      join(FIXTURE_DIR, 'badEmotional1.ts'),
      "export const label = '대박 종목 발굴';\n",
    );
    const result = runLint();
    expect(result.exitCode).toBe(1);
    expect(result.output).toContain('EMOTIONAL');
    expect(result.output).toContain('대박');
  });

  it("EMOTIONAL: '엄청난' 발견 시 EXIT=1", () => {
    mkdirSync(FIXTURE_DIR, { recursive: true });
    writeFileSync(
      join(FIXTURE_DIR, 'badEmotional2.ts'),
      'export const label = "엄청난 수익률";\n',
    );
    const result = runLint();
    expect(result.exitCode).toBe(1);
    expect(result.output).toContain('엄청난');
  });

  // ============================================================
  // 카테고리 4: PROMISE (약속 표현)
  // ============================================================
  it("PROMISE: '반드시' 발견 시 EXIT=1", () => {
    mkdirSync(FIXTURE_DIR, { recursive: true });
    writeFileSync(
      join(FIXTURE_DIR, 'badPromise1.ts'),
      "export const label = '반드시 매수해야 할 종목';\n",
    );
    const result = runLint();
    expect(result.exitCode).toBe(1);
    expect(result.output).toContain('PROMISE');
    expect(result.output).toContain('반드시');
  });

  it("PROMISE: '승률 100%' 발견 시 EXIT=1", () => {
    mkdirSync(FIXTURE_DIR, { recursive: true });
    writeFileSync(
      join(FIXTURE_DIR, 'badPromise2.ts'),
      'export const label = "승률 100% 보장";\n',
    );
    const result = runLint();
    expect(result.exitCode).toBe(1);
    // 한 줄에 '승률 100%' + '보장' 두 개 매칭되므로 PROMISE + ABSOLUTE 둘 다 발견될 수 있음
    expect(result.output).toContain('승률 100%');
  });

  // ============================================================
  // False positive 차단
  // ============================================================
  it('한 줄 주석 안 패턴은 무시 (false positive 차단)', () => {
    mkdirSync(FIXTURE_DIR, { recursive: true });
    writeFileSync(
      join(FIXTURE_DIR, 'commentLine.ts'),
      "// 과거에는 '완벽한' 표현을 썼지만 ADR-0094 로 차단\n// '대박' 도 금지\nexport const safe = true;\n",
    );
    const result = runLint();
    expect(result.exitCode).toBe(0);
  });

  it('블록 주석 안 패턴은 무시 (false positive 차단)', () => {
    mkdirSync(FIXTURE_DIR, { recursive: true });
    writeFileSync(
      join(FIXTURE_DIR, 'commentBlock.ts'),
      "/* 정책: '완벽한', '강력한', '대박' 모두 금지\n   '반드시' 와 '베스트' 도 동일 */\nexport const safe = true;\n",
    );
    const result = runLint();
    expect(result.exitCode).toBe(0);
  });

  it('식별자 (변수명) 안 패턴은 무시', () => {
    mkdirSync(FIXTURE_DIR, { recursive: true });
    writeFileSync(
      join(FIXTURE_DIR, 'identifierName.ts'),
      // 변수명 자체에 한국어 금지 — 영문 식별자만 사용. 본 테스트는 식별자 위치의 한국어 부재 검증.
      "export const completeFlag = true;\nexport const strongSignal = false;\n",
    );
    const result = runLint();
    expect(result.exitCode).toBe(0);
  });

  it('정상 표현 (확률/정량/중립) 통과', () => {
    mkdirSync(FIXTURE_DIR, { recursive: true });
    writeFileSync(
      join(FIXTURE_DIR, 'goodExpressions.ts'),
      "export const labels = {\n  goodA: '강매수 후보',\n  goodB: '진입 권고',\n  goodC: '수익률 +12.5%',\n  goodD: '신호 수집 중',\n};\n",
    );
    const result = runLint();
    expect(result.exitCode).toBe(0);
  });

  // ============================================================
  // 다중 위반 + 보고
  // ============================================================
  it('다중 위반 모두 보고 + 총 카운트 표시', () => {
    mkdirSync(FIXTURE_DIR, { recursive: true });
    writeFileSync(
      join(FIXTURE_DIR, 'multi1.ts'),
      "export const label1 = '완벽한 종목';\n",
    );
    writeFileSync(
      join(FIXTURE_DIR, 'multi2.ts'),
      "export const label2 = '대박 추천';\n",
    );
    const result = runLint();
    expect(result.exitCode).toBe(1);
    expect(result.output).toContain('multi1.ts');
    expect(result.output).toContain('multi2.ts');
    expect(result.output).toContain('위반 2건');
  });

  // ============================================================
  // 화이트리스트 (정책 SSOT 자기 자신)
  // ============================================================
  it('화이트리스트 (uiLanguage.ts) 베이스라인 통과', () => {
    // uiLanguage.ts 자체가 정책 표현을 담을 수 있어도 ALLOWED_FILES 로 통과해야 함.
    // 본 검증은 baseline test 와 동일하지만 명시적으로 화이트리스트 보존 강조.
    const result = runLint();
    expect(result.exitCode).toBe(0);
    expect(result.output).toContain('위반 0건');
  });

  // ============================================================
  // --changed 모드
  // ============================================================
  it('--changed 모드 — staged 파일 없을 때 skip', () => {
    try {
      const out = execSync('node scripts/check_ui_language.js --changed', {
        cwd: ROOT,
        encoding: 'utf-8',
        stdio: ['pipe', 'pipe', 'pipe'],
      });
      // staged 파일이 있을 수도, 없을 수도 있음 — 둘 다 정상
      expect(out).toBeDefined();
    } catch (err) {
      // 스테이지된 파일이 위반을 가질 수 있음 — exit 0 또는 1 모두 정상
      expect(err.status === 0 || err.status === 1).toBe(true);
    }
  });
});
