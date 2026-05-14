/**
 * Patch-KIS-CIRCUIT-OPEN-ENFORCEMENT-AND-DATA-EVAL-STATE-001 회귀 — DART 4-state SSOT.
 *
 * 사용자 §9 정합:
 *   - DART_REALTIME / DART_STALE / DART_NOT_EVALUATED / DART_PROVIDER_UNAVAILABLE
 *   - marketSignal=false / executionImpact='NONE'|'NEW_BUY_BLOCKED_ONLY' literal 강제
 *   - sample=0 → DART_NOT_EVALUATED + nullRate=null (사용자 §9 "0.0% 표기 영구 금지")
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  classifyDartEvaluation,
  formatDartEvaluationCompactLine,
  formatDartEvaluationStateLog,
  isDartEvaluationStateDisabled,
} from './dartEvaluationStatePatch005.js';

const __dirname = dirname(fileURLToPath(import.meta.url));

describe('Patch-005 DART state — ENV gate (ADR-0157 정확 비교)', () => {
  const originalEnv = { ...process.env };
  beforeEach(() => {
    delete process.env.DART_EVALUATION_STATE_PATCH_005_DISABLED;
  });
  afterEach(() => {
    process.env = { ...originalEnv };
  });

  it('default OFF', () => {
    expect(isDartEvaluationStateDisabled()).toBe(false);
  });
  it('=== "true" 시 active', () => {
    process.env.DART_EVALUATION_STATE_PATCH_005_DISABLED = 'true';
    expect(isDartEvaluationStateDisabled()).toBe(true);
  });
  it("'1' / 'TRUE' / 'yes' / 빈값 모두 default", () => {
    for (const v of ['1', 'TRUE', 'yes', '']) {
      process.env.DART_EVALUATION_STATE_PATCH_005_DISABLED = v;
      expect(isDartEvaluationStateDisabled()).toBe(false);
    }
  });
});

describe('Patch-005 classifyDartEvaluation — 결정 트리 SSOT (사용자 §9 정합)', () => {
  const originalEnv = { ...process.env };
  beforeEach(() => {
    delete process.env.DART_EVALUATION_STATE_PATCH_005_DISABLED;
  });
  afterEach(() => {
    process.env = { ...originalEnv };
  });

  it('1. ENV DISABLED → DART_NOT_EVALUATED + reason ENV_DISABLED + nullRate=null', () => {
    process.env.DART_EVALUATION_STATE_PATCH_005_DISABLED = 'true';
    const s = classifyDartEvaluation({
      sample: 10,
      nullCount: 0,
    });
    expect(s.status).toBe('DART_NOT_EVALUATED');
    expect(s.nullRate).toBeNull();
    expect(s.reason).toBe('ENV_DISABLED');
    expect(s.marketSignal).toBe(false);
    expect(s.executionImpact).toBe('NONE');
  });

  it('2. sample=0 → DART_NOT_EVALUATED + nullRate=null (사용자 §9 "0.0% 표기 영구 금지")', () => {
    const s = classifyDartEvaluation({ sample: 0, nullCount: 0 });
    expect(s.status).toBe('DART_NOT_EVALUATED');
    expect(s.nullRate).toBeNull();
    expect(s.reason).toBe('NO_READY_CANDIDATE_AFTER_MTAS');
    expect(s.marketSignal).toBe(false);
    expect(s.executionImpact).toBe('NEW_BUY_BLOCKED_ONLY');
    expect(s.providerIssue).toBe(false);
  });

  it('2-b. sample=0 + mtasEvaluatedReadyCount>0 → reason=NO_DART_SAMPLE', () => {
    const s = classifyDartEvaluation({
      sample: 0,
      nullCount: 0,
      mtasEvaluatedReadyCount: 5,
    });
    expect(s.status).toBe('DART_NOT_EVALUATED');
    expect(s.nullRate).toBeNull();
    expect(s.reason).toBe('NO_DART_SAMPLE');
  });

  it('2-c. sample<0 / NaN / Infinity → sample=0 강제 + DART_NOT_EVALUATED', () => {
    for (const bad of [-1, NaN, Infinity]) {
      const s = classifyDartEvaluation({ sample: bad, nullCount: 0 });
      expect(s.status).toBe('DART_NOT_EVALUATED');
      expect(s.sample).toBe(0);
      expect(s.nullRate).toBeNull();
    }
  });

  it('3. providerUnavailable=true + sample>0 → DART_PROVIDER_UNAVAILABLE', () => {
    const s = classifyDartEvaluation({
      sample: 10,
      nullCount: 10,
      providerUnavailable: true,
    });
    expect(s.status).toBe('DART_PROVIDER_UNAVAILABLE');
    expect(s.nullRate).toBe(1.0);
    expect(s.reason).toBe('DART_PROVIDER_ERROR');
    expect(s.providerIssue).toBe(true);
    expect(s.marketSignal).toBe(false);
    expect(s.executionImpact).toBe('NEW_BUY_BLOCKED_ONLY');
  });

  it('4. cacheUsedCount=sample → DART_STALE + executionImpact=NEW_BUY_BLOCKED_ONLY', () => {
    const s = classifyDartEvaluation({
      sample: 10,
      nullCount: 0,
      cacheUsedCount: 10,
    });
    expect(s.status).toBe('DART_STALE');
    expect(s.nullRate).toBe(0);
    expect(s.reason).toBe('ALL_CACHE_FALLBACK');
    expect(s.providerIssue).toBe(false);
    expect(s.marketSignal).toBe(false);
    expect(s.executionImpact).toBe('NEW_BUY_BLOCKED_ONLY');
  });

  it('5. 그 외 → DART_REALTIME + executionImpact=NONE', () => {
    const s = classifyDartEvaluation({ sample: 10, nullCount: 3 });
    expect(s.status).toBe('DART_REALTIME');
    expect(s.nullRate).toBeCloseTo(0.3);
    expect(s.reason).toBe('ALL_LIVE_SUCCESS');
    expect(s.providerIssue).toBe(false);
    expect(s.marketSignal).toBe(false);
    expect(s.executionImpact).toBe('NONE');
  });
});

describe('Patch-005 DART — literal type 강제 (사용자 명시 절대 불변식)', () => {
  it('marketSignal === false 모든 status', () => {
    const inputs = [
      { sample: 0, nullCount: 0 },
      { sample: 10, nullCount: 10, providerUnavailable: true },
      { sample: 10, nullCount: 0, cacheUsedCount: 10 },
      { sample: 10, nullCount: 5 },
    ];
    for (const input of inputs) {
      const s = classifyDartEvaluation(input);
      expect(s.marketSignal).toBe(false);
    }
  });

  it('executionImpact ∈ {NONE, NEW_BUY_BLOCKED_ONLY} 만', () => {
    const inputs = [
      { sample: 0, nullCount: 0 },
      { sample: 10, nullCount: 10, providerUnavailable: true },
      { sample: 10, nullCount: 0, cacheUsedCount: 10 },
      { sample: 10, nullCount: 5 },
    ];
    for (const input of inputs) {
      const s = classifyDartEvaluation(input);
      expect(['NONE', 'NEW_BUY_BLOCKED_ONLY']).toContain(s.executionImpact);
    }
  });
});

describe('Patch-005 사용자 §9 핵심 시나리오 — sample=0 → N/A', () => {
  it('sample=0 일 때 nullRate=null + format 시 "N/A"', () => {
    const s = classifyDartEvaluation({ sample: 0, nullCount: 0 });
    expect(s.nullRate).toBeNull();
    const log = formatDartEvaluationStateLog(s);
    expect(log).toContain('nullRate=N/A');
    expect(log).not.toContain('nullRate=0.0%');
  });

  it('"DART D0 일 때 0.0% 표시 영구 금지" — 사용자 §"금지" 직접 인용', () => {
    const s = classifyDartEvaluation({ sample: 0, nullCount: 0 });
    const log = formatDartEvaluationStateLog(s);
    // nullRate=0.0% 절대 등장 금지
    expect(log).not.toMatch(/nullRate=0\.0%/);
    // nullRate=N/A 의무
    expect(log).toMatch(/nullRate=N\/A/);
  });
});

describe('Patch-005 formatDartEvaluationStateLog — 사용자 §"기대 로그" 정확 형식', () => {
  it('[DART_EVALUATION_STATE] 헤더 + 필수 필드', () => {
    const s = classifyDartEvaluation({ sample: 0, nullCount: 0 });
    const log = formatDartEvaluationStateLog(s);
    expect(log).toContain('[DART_EVALUATION_STATE]');
    expect(log).toContain('status=DART_NOT_EVALUATED');
    expect(log).toContain('sample=0');
    expect(log).toContain('nullRate=N/A');
    expect(log).toContain('reason=NO_READY_CANDIDATE_AFTER_MTAS');
  });

  it('DART_REALTIME 정상 표기 — nullRate 0~100% 형식', () => {
    const s = classifyDartEvaluation({ sample: 10, nullCount: 2 });
    const log = formatDartEvaluationStateLog(s);
    expect(log).toContain('status=DART_REALTIME');
    expect(log).toContain('nullRate=20.0%');
  });
});

describe('Patch-005 formatDartEvaluationCompactLine — /scan_blockers runtime', () => {
  it('PATCH-RUNTIME 태그 + 핵심 필드', () => {
    const s = classifyDartEvaluation({ sample: 10, nullCount: 3 });
    const line = formatDartEvaluationCompactLine(s);
    expect(line).toContain('[PATCH-RUNTIME]');
    expect(line).toContain('Patch-005 DART');
    expect(line).toContain('status=DART_REALTIME');
    expect(line).toContain('executionImpact=NONE');
  });

  it('sample=0 compact line — nullRate=N/A 명시', () => {
    const s = classifyDartEvaluation({ sample: 0, nullCount: 0 });
    const line = formatDartEvaluationCompactLine(s);
    expect(line).toContain('nullRate=N/A');
  });
});

describe('Patch-005 DART — 정적 grep 가드', () => {
  const sourcePath = resolve(__dirname, 'dartEvaluationStatePatch005.ts');
  const source = readFileSync(sourcePath, 'utf8');
  const code = source
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/\/\/[^\n]*/g, '');

  it('KIS 주문 함수 5종 import 0건', () => {
    expect(code).not.toMatch(/placeKisMarketOrder/);
    expect(code).not.toMatch(/placeKisSellOrder/);
    expect(code).not.toMatch(/placeKisStopLossOrder/);
    expect(code).not.toMatch(/placeKisTakeProfitOrder/);
    expect(code).not.toMatch(/cancelKisOrder/);
  });
  it('autoTradeEngine / orderExecutor / trancheExecutor import 0건', () => {
    expect(code).not.toMatch(/autoTradeEngine/);
    expect(code).not.toMatch(/orderExecutor/);
    expect(code).not.toMatch(/trancheExecutor/);
  });
  it('외부 fetch / axios / node-fetch import 0건', () => {
    expect(code).not.toMatch(/from ['"]axios['"]/);
    expect(code).not.toMatch(/from ['"]node-fetch['"]/);
    expect(code).not.toMatch(/\bfetch\(/);
  });
  it('ENV === \'true\' 정확 비교 (ADR-0157)', () => {
    expect(code).toMatch(/=== 'true'/);
    expect(code).not.toMatch(/!== 'false'/);
  });
  it('marketSignal: false literal SSOT', () => {
    expect(code).toMatch(/marketSignal: false/);
  });
  it('4-value status union 정합', () => {
    expect(code).toMatch(/DART_REALTIME/);
    expect(code).toMatch(/DART_STALE/);
    expect(code).toMatch(/DART_NOT_EVALUATED/);
    expect(code).toMatch(/DART_PROVIDER_UNAVAILABLE/);
  });
  it('nullRate: number | null 강제 (사용자 §9 "sample=0 → N/A literal 강제")', () => {
    expect(code).toMatch(/nullRate: number \| null/);
  });
  it('Patch ID 추적 주석', () => {
    expect(source).toMatch(/Patch ID: KIS-CIRCUIT-OPEN-ENFORCEMENT-AND-DATA-EVAL-STATE-001/);
  });
});
