/**
 * Patch-KIS-CIRCUIT-OPEN-ENFORCEMENT-AND-DATA-EVAL-STATE-001 회귀 — MTAS 5-state SSOT.
 *
 * 사용자 §7~§8 정합:
 *   - MTAS_REALTIME / MTAS_STALE_DEGRADED / MTAS_PARTIAL /
 *     MTAS_NOT_EVALUATED / MTAS_PROVIDER_UNAVAILABLE
 *   - marketSignal=false / executionImpact='NONE'|'NEW_BUY_BLOCKED_ONLY' literal 강제
 *   - sample=0 → MTAS_NOT_EVALUATED + failRate=null (N/A 표기 의무)
 *   - 실패율 100% 단순 표기 영구 금지
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  classifyMtasEvaluation,
  formatMtasEvaluationCompactLine,
  formatMtasEvaluationStateLog,
  isMtasEvaluationStateDisabled,
} from './mtasEvaluationStatePatch005.js';

const __dirname = dirname(fileURLToPath(import.meta.url));

describe('Patch-005 MTAS state — ENV gate (ADR-0157 정확 비교)', () => {
  const originalEnv = { ...process.env };
  beforeEach(() => {
    delete process.env.MTAS_EVALUATION_STATE_PATCH_005_DISABLED;
  });
  afterEach(() => {
    process.env = { ...originalEnv };
  });

  it('default OFF', () => {
    expect(isMtasEvaluationStateDisabled()).toBe(false);
  });
  it('=== "true" 시 active', () => {
    process.env.MTAS_EVALUATION_STATE_PATCH_005_DISABLED = 'true';
    expect(isMtasEvaluationStateDisabled()).toBe(true);
  });
  it("'1' / 'TRUE' / 'yes' / 빈값 모두 default", () => {
    for (const v of ['1', 'TRUE', 'yes', '']) {
      process.env.MTAS_EVALUATION_STATE_PATCH_005_DISABLED = v;
      expect(isMtasEvaluationStateDisabled()).toBe(false);
    }
  });
});

describe('Patch-005 classifyMtasEvaluation — 결정 트리 SSOT (사용자 §"MTAS 정책")', () => {
  const originalEnv = { ...process.env };
  beforeEach(() => {
    delete process.env.MTAS_EVALUATION_STATE_PATCH_005_DISABLED;
  });
  afterEach(() => {
    process.env = { ...originalEnv };
  });

  it('1. ENV DISABLED → MTAS_NOT_EVALUATED + reason ENV_DISABLED', () => {
    process.env.MTAS_EVALUATION_STATE_PATCH_005_DISABLED = 'true';
    const s = classifyMtasEvaluation({
      sample: 10,
      successCount: 8,
      failCount: 2,
    });
    expect(s.status).toBe('MTAS_NOT_EVALUATED');
    expect(s.failRate).toBeNull();
    expect(s.reason).toBe('ENV_DISABLED');
    expect(s.marketSignal).toBe(false);
    expect(s.executionImpact).toBe('NONE');
  });

  it('2. sample=0 → MTAS_NOT_EVALUATED + failRate=null + NO_READY_CANDIDATE', () => {
    const s = classifyMtasEvaluation({
      sample: 0,
      successCount: 0,
      failCount: 0,
    });
    expect(s.status).toBe('MTAS_NOT_EVALUATED');
    expect(s.failRate).toBeNull();
    expect(s.reason).toBe('NO_READY_CANDIDATE');
    expect(s.marketSignal).toBe(false);
    expect(s.executionImpact).toBe('NEW_BUY_BLOCKED_ONLY');
    expect(s.providerIssue).toBe(false);
  });

  it('2-b. sample=0 + providerUnavailable=true → reason=KIS_CIRCUIT_OPEN', () => {
    const s = classifyMtasEvaluation({
      sample: 0,
      successCount: 0,
      failCount: 0,
      providerUnavailable: true,
    });
    expect(s.status).toBe('MTAS_NOT_EVALUATED');
    expect(s.failRate).toBeNull();
    expect(s.reason).toBe('KIS_CIRCUIT_OPEN');
  });

  it('2-c. sample<0 / NaN / Infinity → sample=0 강제 + MTAS_NOT_EVALUATED', () => {
    for (const bad of [-1, NaN, Infinity]) {
      const s = classifyMtasEvaluation({
        sample: bad,
        successCount: 0,
        failCount: 0,
      });
      expect(s.status).toBe('MTAS_NOT_EVALUATED');
      expect(s.sample).toBe(0);
      expect(s.failRate).toBeNull();
    }
  });

  it('3. providerUnavailable=true + sample>0 → MTAS_PROVIDER_UNAVAILABLE + executionImpact=NEW_BUY_BLOCKED_ONLY', () => {
    const s = classifyMtasEvaluation({
      sample: 10,
      successCount: 0,
      failCount: 10,
      providerUnavailable: true,
    });
    expect(s.status).toBe('MTAS_PROVIDER_UNAVAILABLE');
    expect(s.failRate).toBe(1.0);
    expect(s.reason).toBe('KIS_CIRCUIT_OPEN_OR_HARD_OPEN');
    expect(s.providerIssue).toBe(true);
    expect(s.marketSignal).toBe(false);
    expect(s.executionImpact).toBe('NEW_BUY_BLOCKED_ONLY');
  });

  it('4. failCount=sample + success=0 + providerUnavailable=false → MTAS_PROVIDER_UNAVAILABLE (사용자 §"실패 100% 결함 차단")', () => {
    const s = classifyMtasEvaluation({
      sample: 10,
      successCount: 0,
      failCount: 10,
      providerUnavailable: false,
    });
    expect(s.status).toBe('MTAS_PROVIDER_UNAVAILABLE');
    expect(s.failRate).toBe(1.0);
    expect(s.reason).toBe('ALL_FAIL_TREATED_AS_PROVIDER_ISSUE');
    expect(s.providerIssue).toBe(true);
    expect(s.marketSignal).toBe(false);
    expect(s.executionImpact).toBe('NEW_BUY_BLOCKED_ONLY');
  });

  it('5. cacheUsedCount=sample + sample>0 → MTAS_STALE_DEGRADED + executionImpact=NEW_BUY_BLOCKED_ONLY', () => {
    const s = classifyMtasEvaluation({
      sample: 10,
      successCount: 10,
      failCount: 0,
      cacheUsedCount: 10,
    });
    expect(s.status).toBe('MTAS_STALE_DEGRADED');
    expect(s.failRate).toBe(0);
    expect(s.reason).toBe('ALL_CACHE_FALLBACK');
    expect(s.providerIssue).toBe(false);
    expect(s.marketSignal).toBe(false);
    expect(s.executionImpact).toBe('NEW_BUY_BLOCKED_ONLY');
  });

  it('6. success>0 + failCount>0 → MTAS_PARTIAL + executionImpact=NEW_BUY_BLOCKED_ONLY', () => {
    const s = classifyMtasEvaluation({
      sample: 10,
      successCount: 7,
      failCount: 3,
    });
    expect(s.status).toBe('MTAS_PARTIAL');
    expect(s.failRate).toBeCloseTo(0.3);
    expect(s.reason).toBe('MIXED_SUCCESS_AND_FAILURE');
    expect(s.providerIssue).toBe(false);
    expect(s.marketSignal).toBe(false);
    expect(s.executionImpact).toBe('NEW_BUY_BLOCKED_ONLY');
  });

  it('7. successCount=sample → MTAS_REALTIME + executionImpact=NONE', () => {
    const s = classifyMtasEvaluation({
      sample: 10,
      successCount: 10,
      failCount: 0,
    });
    expect(s.status).toBe('MTAS_REALTIME');
    expect(s.failRate).toBe(0);
    expect(s.reason).toBe('ALL_LIVE_SUCCESS');
    expect(s.providerIssue).toBe(false);
    expect(s.marketSignal).toBe(false);
    expect(s.executionImpact).toBe('NONE');
  });
});

describe('Patch-005 MTAS — literal type 강제 (사용자 명시 절대 불변식)', () => {
  it('marketSignal === false 모든 status', () => {
    const inputs = [
      { sample: 0, successCount: 0, failCount: 0 },
      { sample: 10, successCount: 0, failCount: 10, providerUnavailable: true },
      { sample: 10, successCount: 0, failCount: 10 },
      { sample: 10, successCount: 10, failCount: 0, cacheUsedCount: 10 },
      { sample: 10, successCount: 5, failCount: 5 },
      { sample: 10, successCount: 10, failCount: 0 },
    ];
    for (const input of inputs) {
      const s = classifyMtasEvaluation(input);
      expect(s.marketSignal).toBe(false);
    }
  });

  it('executionImpact ∈ {NONE, NEW_BUY_BLOCKED_ONLY} 만', () => {
    const inputs = [
      { sample: 0, successCount: 0, failCount: 0 },
      { sample: 10, successCount: 0, failCount: 10, providerUnavailable: true },
      { sample: 10, successCount: 0, failCount: 10 },
      { sample: 10, successCount: 10, failCount: 0, cacheUsedCount: 10 },
      { sample: 10, successCount: 5, failCount: 5 },
      { sample: 10, successCount: 10, failCount: 0 },
    ];
    for (const input of inputs) {
      const s = classifyMtasEvaluation(input);
      expect(['NONE', 'NEW_BUY_BLOCKED_ONLY']).toContain(s.executionImpact);
    }
  });
});

describe('Patch-005 formatMtasEvaluationStateLog — 사용자 §"기대 로그" 정확 형식', () => {
  it('[MTAS_EVALUATION_STATE] 헤더 + 필수 필드', () => {
    const s = classifyMtasEvaluation({
      sample: 0,
      successCount: 0,
      failCount: 0,
    });
    const log = formatMtasEvaluationStateLog(s);
    expect(log).toContain('[MTAS_EVALUATION_STATE]');
    expect(log).toContain('status=MTAS_NOT_EVALUATED');
    expect(log).toContain('reason=NO_READY_CANDIDATE');
    expect(log).toContain('sample=0');
    expect(log).toContain('failRate=N/A');
    expect(log).toContain('marketSignal=false');
    expect(log).toContain('executionImpact=NEW_BUY_BLOCKED_ONLY');
  });

  it('실패율 100% sample>0 → failRate=100.0% 표기 + provider issue 표시', () => {
    const s = classifyMtasEvaluation({
      sample: 10,
      successCount: 0,
      failCount: 10,
    });
    const log = formatMtasEvaluationStateLog(s);
    expect(log).toContain('status=MTAS_PROVIDER_UNAVAILABLE');
    expect(log).toContain('failRate=100.0%');
  });
});

describe('Patch-005 formatMtasEvaluationCompactLine — /scan_blockers runtime', () => {
  it('PATCH-RUNTIME 태그 + 핵심 필드', () => {
    const s = classifyMtasEvaluation({
      sample: 10,
      successCount: 5,
      failCount: 5,
    });
    const line = formatMtasEvaluationCompactLine(s);
    expect(line).toContain('[PATCH-RUNTIME]');
    expect(line).toContain('Patch-005 MTAS');
    expect(line).toContain('status=MTAS_PARTIAL');
    expect(line).toContain('sample=10');
    expect(line).toContain('executionImpact=NEW_BUY_BLOCKED_ONLY');
  });
});

describe('Patch-005 MTAS — 정적 grep 가드', () => {
  const sourcePath = resolve(__dirname, 'mtasEvaluationStatePatch005.ts');
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
  it('5-value status union 정합', () => {
    expect(code).toMatch(/MTAS_REALTIME/);
    expect(code).toMatch(/MTAS_STALE_DEGRADED/);
    expect(code).toMatch(/MTAS_PARTIAL/);
    expect(code).toMatch(/MTAS_NOT_EVALUATED/);
    expect(code).toMatch(/MTAS_PROVIDER_UNAVAILABLE/);
  });
  it('failRate: number | null 강제 (사용자 §"sample=0 시 N/A")', () => {
    expect(code).toMatch(/failRate: number \| null/);
  });
  it('Patch ID 추적 주석', () => {
    expect(source).toMatch(/Patch ID: KIS-CIRCUIT-OPEN-ENFORCEMENT-AND-DATA-EVAL-STATE-001/);
  });
});
