// @responsibility ADR-0116 Gate3 ENV 완화 wiring 회귀 가드 (정적 + 동작)
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const TARGET_FILE = path.resolve(__dirname, '..', 'entryRevalidationStep.ts');

const ORIGINAL_ENV = process.env.EXECUTION_RELAXATION_ENABLED;

beforeEach(() => {
  delete process.env.EXECUTION_RELAXATION_ENABLED;
});

afterEach(() => {
  if (ORIGINAL_ENV === undefined) delete process.env.EXECUTION_RELAXATION_ENABLED;
  else process.env.EXECUTION_RELAXATION_ENABLED = ORIGINAL_ENV;
  vi.resetModules();
});

describe('ADR-0116 entryRevalidationStep — Gate3 ENV wiring 정적 가드', () => {
  it('isExecutionRelaxationEnabled import', () => {
    const src = fs.readFileSync(TARGET_FILE, 'utf-8');
    expect(src).toMatch(/import\s*\{\s*isExecutionRelaxationEnabled\s*\}\s*from\s*['"]\.\.\/failureClassifier\.js['"]/);
  });

  it('relaxedDelta 분기 사용', () => {
    const src = fs.readFileSync(TARGET_FILE, 'utf-8');
    expect(src).toMatch(/isExecutionRelaxationEnabled\(\)/);
    expect(src).toMatch(/relaxedDelta/);
  });

  it('Math.max(... , 5) 최소 보장', () => {
    const src = fs.readFileSync(TARGET_FILE, 'utf-8');
    expect(src).toMatch(/Math\.max\s*\(\s*minGateBase\s*-\s*relaxedDelta\s*,\s*5\s*\)/);
  });

  it('minGateScore 가 minGate (relaxed 적용 결과) 사용', () => {
    const src = fs.readFileSync(TARGET_FILE, 'utf-8');
    expect(src).toMatch(/minGateScore:\s*minGate/);
  });

  it('ADR-0116 주석 명문화', () => {
    const src = fs.readFileSync(TARGET_FILE, 'utf-8');
    expect(src).toMatch(/ADR-0116/);
  });
});

describe('ADR-0116 동작 시뮬 — minGate 산출 로직', () => {
  it('default OFF — minGate = base (Gate3 그대로)', async () => {
    const { isExecutionRelaxationEnabled } = await import('../../failureClassifier.js');
    expect(isExecutionRelaxationEnabled()).toBe(false);
    const minGateBase = 7;
    const relaxedDelta = isExecutionRelaxationEnabled() ? 1 : 0;
    const minGate = Math.max(minGateBase - relaxedDelta, 5);
    expect(minGate).toBe(7);
  });

  it('ENV ON — minGate = base - 1 (Gate3 7→6)', async () => {
    process.env.EXECUTION_RELAXATION_ENABLED = 'true';
    vi.resetModules();
    const { isExecutionRelaxationEnabled } = await import('../../failureClassifier.js');
    expect(isExecutionRelaxationEnabled()).toBe(true);
    const minGateBase = 7;
    const relaxedDelta = isExecutionRelaxationEnabled() ? 1 : 0;
    const minGate = Math.max(minGateBase - relaxedDelta, 5);
    expect(minGate).toBe(6);
  });

  it('ENV ON — base=6 → minGate=5 (최소 5 보장)', async () => {
    process.env.EXECUTION_RELAXATION_ENABLED = 'true';
    vi.resetModules();
    const { isExecutionRelaxationEnabled } = await import('../../failureClassifier.js');
    const minGateBase = 6;
    const relaxedDelta = isExecutionRelaxationEnabled() ? 1 : 0;
    const minGate = Math.max(minGateBase - relaxedDelta, 5);
    expect(minGate).toBe(5);
  });

  it('ENV ON — base=5 → minGate=5 (최소 5 보장 — 더 내려가지 않음)', async () => {
    process.env.EXECUTION_RELAXATION_ENABLED = 'true';
    vi.resetModules();
    const { isExecutionRelaxationEnabled } = await import('../../failureClassifier.js');
    const minGateBase = 5;
    const relaxedDelta = isExecutionRelaxationEnabled() ? 1 : 0;
    const minGate = Math.max(minGateBase - relaxedDelta, 5);
    expect(minGate).toBe(5);
  });

  it('ENV "false" 명시 → 기존 동작 (minGate=base)', async () => {
    process.env.EXECUTION_RELAXATION_ENABLED = 'false';
    vi.resetModules();
    const { isExecutionRelaxationEnabled } = await import('../../failureClassifier.js');
    expect(isExecutionRelaxationEnabled()).toBe(false);
    const minGateBase = 7;
    const relaxedDelta = isExecutionRelaxationEnabled() ? 1 : 0;
    expect(Math.max(minGateBase - relaxedDelta, 5)).toBe(7);
  });

  it('regime 별 base 값 차이 — 모두 -1 효과', async () => {
    process.env.EXECUTION_RELAXATION_ENABLED = 'true';
    vi.resetModules();
    const { isExecutionRelaxationEnabled } = await import('../../failureClassifier.js');
    const relaxedDelta = isExecutionRelaxationEnabled() ? 1 : 0;
    // R1_TURBO base 8, R2_BULL base 7, R3_EARLY base 7, R4_NEUTRAL base 6 등
    expect(Math.max(8 - relaxedDelta, 5)).toBe(7);
    expect(Math.max(7 - relaxedDelta, 5)).toBe(6);
    expect(Math.max(6 - relaxedDelta, 5)).toBe(5);
  });

  it('default — 모든 regime 기존 동작', async () => {
    const { isExecutionRelaxationEnabled } = await import('../../failureClassifier.js');
    const relaxedDelta = isExecutionRelaxationEnabled() ? 1 : 0;
    expect(Math.max(8 - relaxedDelta, 5)).toBe(8);
    expect(Math.max(7 - relaxedDelta, 5)).toBe(7);
    expect(Math.max(6 - relaxedDelta, 5)).toBe(6);
  });

  it('Math.max 최소 5 보장 — base가 음수/0 인 비정상 입력도 안전', async () => {
    process.env.EXECUTION_RELAXATION_ENABLED = 'true';
    vi.resetModules();
    const { isExecutionRelaxationEnabled } = await import('../../failureClassifier.js');
    const relaxedDelta = isExecutionRelaxationEnabled() ? 1 : 0;
    expect(Math.max(0 - relaxedDelta, 5)).toBe(5);
    expect(Math.max(-1 - relaxedDelta, 5)).toBe(5);
  });
});
