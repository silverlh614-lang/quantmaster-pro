/**
 * @responsibility check_complexity 회귀 테스트 (ADR-0133)
 *
 * 본 lint script 가:
 *   1) 현재 baseline (perSymbolEvaluation.ts 1건) 통과 EXIT=0
 *   2) FIXTURE_DIR 의 1500+ 줄 신규 파일 발견 시 EXIT=1
 *   3) BASELINE_TECHNICAL_DEBT 등록 파일은 walk 모드에서 통과
 *   4) explicit 인자 모드는 BASELINE 무시 (강제 검사)
 *   5) src/* 의 1500+ 줄 신규 파일도 차단 (App.tsx 한정 회귀 차단)
 *   6) server/* 의 1500+ 줄 신규 파일도 차단 (server walk 회귀 차단)
 *   7) walk 모드 OK 메시지에 검사 파일 수 + baseline 건수 노출
 *   8) explicit 모드 jsxDepth/useEffects/imports 임계 강제 (App.tsx 검사 보존)
 *   9) 1499줄 (boundary) 통과 / 1500줄 (정확 임계) 통과 / 1501줄 fail
 */
import { describe, it, expect, afterEach } from 'vitest';
import { execSync } from 'child_process';
import { writeFileSync, mkdirSync, existsSync, rmSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const ROOT = join(__dirname, '..');
const FIXTURE_DIR = join(ROOT, 'server', '__complexity_fixtures__');
const SRC_FIXTURE_DIR = join(ROOT, 'src', '__complexity_fixtures__');

function runCheck(args = '') {
  try {
    const out = execSync(`node scripts/check_complexity.js ${args}`.trim(), {
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

function makeBigFile(path, lineCount) {
  // 정확히 lineCount 줄을 생성. trailing \n 추가하지 않음 — split('\n') 결과 정확히 lineCount.
  const lines = [];
  for (let i = 0; i < lineCount; i += 1) {
    lines.push(`export const filler${i} = ${i};`);
  }
  writeFileSync(path, lines.join('\n'));
}

afterEach(() => {
  if (existsSync(FIXTURE_DIR)) rmSync(FIXTURE_DIR, { recursive: true, force: true });
  if (existsSync(SRC_FIXTURE_DIR)) rmSync(SRC_FIXTURE_DIR, { recursive: true, force: true });
});

describe('check_complexity — ADR-0133 게이트 무결성', () => {
  it('현재 baseline (fixture 없을 때) 통과 EXIT=0 + 검사 파일 수 + baseline 건수 노출', () => {
    const result = runCheck();
    expect(result.exitCode).toBe(0);
    expect(result.output).toContain('[ACMA] OK');
    // ADR-0134 (PR-Refactor-2) 후 baseline 0건 — perSymbolEvaluation.ts 분해 완료로 카탈로그 비움.
    expect(result.output).toContain('baseline 0건 제외');
    // 검사 파일 수 노출 — 변동 가능하므로 패턴만 확인
    expect(result.output).toMatch(/\d+개 파일 검사/);
  });

  it('server/* 1500+ 줄 신규 파일 발견 시 EXIT=1 (server walk 회귀 차단)', () => {
    mkdirSync(FIXTURE_DIR, { recursive: true });
    makeBigFile(join(FIXTURE_DIR, 'serverGiant.ts'), 1501);
    const result = runCheck();
    expect(result.exitCode).toBe(1);
    expect(result.output).toContain('serverGiant.ts');
    expect(result.output).toContain('lines=1501/1500');
    expect(result.output).toContain('한계치 초과 — 커밋 차단');
  });

  it('src/* 1500+ 줄 신규 파일 발견 시 EXIT=1 (App.tsx 한정 회귀 차단)', () => {
    mkdirSync(SRC_FIXTURE_DIR, { recursive: true });
    makeBigFile(join(SRC_FIXTURE_DIR, 'srcGiant.ts'), 1501);
    const result = runCheck();
    expect(result.exitCode).toBe(1);
    expect(result.output).toContain('srcGiant.ts');
    expect(result.output).toContain('lines=1501');
  });

  it('1499줄 (boundary 미만) 통과 EXIT=0', () => {
    mkdirSync(FIXTURE_DIR, { recursive: true });
    makeBigFile(join(FIXTURE_DIR, 'boundary.ts'), 1499);
    const result = runCheck();
    expect(result.exitCode).toBe(0);
  });

  it('1500줄 정확 (한계 도달, 미초과) 통과 EXIT=0', () => {
    mkdirSync(FIXTURE_DIR, { recursive: true });
    makeBigFile(join(FIXTURE_DIR, 'exact.ts'), 1500);
    const result = runCheck();
    expect(result.exitCode).toBe(0);
  });

  it('explicit 인자 모드는 BASELINE 무시 (강제 검사) — fixture 1500+ 호출 시 EXIT=1', () => {
    // ADR-0134 후 BASELINE 카탈로그 비었으므로 fixture 로 검증
    mkdirSync(FIXTURE_DIR, { recursive: true });
    makeBigFile(join(FIXTURE_DIR, 'forced.ts'), 1501);
    const result = runCheck('server/__complexity_fixtures__/forced.ts');
    expect(result.exitCode).toBe(1);
    expect(result.output).toContain('forced.ts');
    expect(result.output).toMatch(/lines=1501/);
  });

  it('walk 모드 — perSymbolEvaluation.ts 가 barrel 로 축소되어 미차단 (lines=30)', () => {
    // ADR-0134: perSymbolEvaluation.ts 1617 → 30 LoC barrel 로 축소.
    // BASELINE 카탈로그 비었어도 30 LoC < 1500 한계 — 자연 통과.
    const result = runCheck();
    expect(result.exitCode).toBe(0);
    expect(result.output).not.toContain('perSymbolEvaluation.ts: lines=');
  });

  it('explicit 모드 jsxDepth 임계 초과 시 EXIT=1 (App.tsx 검사 보존)', () => {
    mkdirSync(SRC_FIXTURE_DIR, { recursive: true });
    // JSX 깊이 19 (한계 18) — 18 * 2 = 36 spaces indent
    const lines = ['import React from "react";', 'export const App = () => {', '  return ('];
    for (let i = 0; i < 19; i += 1) {
      lines.push(' '.repeat(4 + i * 2) + '<Foo>');
    }
    for (let i = 18; i >= 0; i -= 1) {
      lines.push(' '.repeat(4 + i * 2) + '</Foo>');
    }
    lines.push('  );', '};');
    writeFileSync(join(SRC_FIXTURE_DIR, 'deepJsx.tsx'), lines.join('\n') + '\n');
    const result = runCheck('src/__complexity_fixtures__/deepJsx.tsx');
    expect(result.exitCode).toBe(1);
    expect(result.output).toContain('deepJsx.tsx');
    expect(result.output).toMatch(/jsxDepth=\d+/);
  });

  it('explicit 모드 useEffects 임계 초과 시 EXIT=1 (App.tsx 검사 보존)', () => {
    mkdirSync(SRC_FIXTURE_DIR, { recursive: true });
    const lines = ['import { useEffect } from "react";', 'export const X = () => {'];
    // useEffects 11 (한계 10)
    for (let i = 0; i < 11; i += 1) {
      lines.push(`  useEffect(() => { console.log(${i}); }, []);`);
    }
    lines.push('  return null;', '};');
    writeFileSync(join(SRC_FIXTURE_DIR, 'manyEffects.tsx'), lines.join('\n') + '\n');
    const result = runCheck('src/__complexity_fixtures__/manyEffects.tsx');
    expect(result.exitCode).toBe(1);
    expect(result.output).toMatch(/useEffects=11/);
  });

  it('walk 모드는 .ts (non-tsx) 의 jsxDepth/useEffects/imports 임계 무시 — lines 만 강제', () => {
    mkdirSync(FIXTURE_DIR, { recursive: true });
    // imports 51 (한계 50) — server/*.ts 라 walk 모드에서 무시되어야
    const lines = [];
    for (let i = 0; i < 51; i += 1) {
      lines.push(`import { foo${i} } from './bar${i}';`);
    }
    lines.push('export const x = 1;');
    writeFileSync(join(FIXTURE_DIR, 'manyImports.ts'), lines.join('\n') + '\n');
    const result = runCheck();
    expect(result.exitCode).toBe(0); // server/*.ts 는 imports 검사 대상 아님
  });

  it('walk 모드는 .tsx 파일의 jsxDepth/useEffects/imports 임계 강제 (App.tsx 보존)', () => {
    mkdirSync(SRC_FIXTURE_DIR, { recursive: true });
    const lines = [];
    for (let i = 0; i < 51; i += 1) {
      lines.push(`import { foo${i} } from './bar${i}';`);
    }
    lines.push('export const X = () => null;');
    writeFileSync(join(SRC_FIXTURE_DIR, 'manyImports.tsx'), lines.join('\n') + '\n');
    const result = runCheck();
    expect(result.exitCode).toBe(1);
    expect(result.output).toContain('manyImports.tsx');
    expect(result.output).toMatch(/imports=51/);
  });

  it('BASELINE_TECHNICAL_DEBT 카탈로그 SSOT 정합 (현재 0건)', () => {
    // ADR-0134 (PR-Refactor-2) 후 카탈로그 비움 — 향후 신규 위반 발생 시 재등록.
    const src = execSync('cat scripts/check_complexity.js', { cwd: ROOT, encoding: 'utf-8' });
    expect(src).toContain('BASELINE_TECHNICAL_DEBT');
    expect(src).toContain('ADR-0133');
    // perSymbolEvaluation.ts 는 카탈로그 active 항목에서 제거됐어야 함 (주석 안 언급은 OK)
    expect(src).toMatch(/const BASELINE_TECHNICAL_DEBT = \[\s*(?:\/\/[^\n]*\n\s*)*\];/);
  });

  it('기존 ACMA 1500줄 한계 상수 보존 (LIMITS.lines = 1500)', () => {
    const src = execSync('cat scripts/check_complexity.js', { cwd: ROOT, encoding: 'utf-8' });
    expect(src).toMatch(/lines:\s*1500/);
  });
});
