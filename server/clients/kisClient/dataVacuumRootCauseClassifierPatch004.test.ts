/**
 * Patch-KIS-TR-PRIORITY-BUDGET-AND-SAFE-DEGRADE-001 DataVacuum classifier 회귀.
 *
 * 사용자 §"반드시 테스트" #9 + #10 정합 — DATA_VACUUM 원인 4분류 세분화 + Telegram 발송 0.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  classifyDataVacuumRootCause,
  formatDataVacuumCompactLine,
  formatDataVacuumRootCauseLog,
  isDataVacuumClassifierDisabled,
} from './dataVacuumRootCauseClassifierPatch004.js';

const __dirname = dirname(fileURLToPath(import.meta.url));

describe('Patch-004 DataVacuum — ENV gate (ADR-0157)', () => {
  const originalEnv = { ...process.env };
  afterEach(() => {
    process.env = { ...originalEnv };
  });

  it('default false', () => {
    delete process.env.DATA_VACUUM_CLASSIFIER_PATCH_004_DISABLED;
    expect(isDataVacuumClassifierDisabled()).toBe(false);
  });

  it('정확 비교 — `true` 만 활성', () => {
    process.env.DATA_VACUUM_CLASSIFIER_PATCH_004_DISABLED = 'true';
    expect(isDataVacuumClassifierDisabled()).toBe(true);
    for (const v of ['1', 'TRUE', 'yes', 'false', '']) {
      process.env.DATA_VACUUM_CLASSIFIER_PATCH_004_DISABLED = v;
      expect(isDataVacuumClassifierDisabled()).toBe(false);
    }
  });
});

describe('Patch-004 DataVacuum 결정 트리 SSOT (사용자 §10 4분류)', () => {
  it('P3_SCAN_DIAGNOSTIC budget exceeded → non-blocking diagnostic suppression, no DATA_VACUUM', () => {
    const c = classifyDataVacuumRootCause({
      throttleLevel: 'SOFT',
      circuitState: 'SOFT_THROTTLED',
      hasRecent5xx: false,
      cacheAvailable: false,
      upstreamHydrationFailed: false,
      priority: 'P3_SCAN_DIAGNOSTIC',
      trId: 'FHKST01010100',
      budgetExceeded: true,
    });
    expect(c.rootCause).toBe('P3_DIAGNOSTIC_BUDGET_SUPPRESSED');
    expect(c.blocking).toBe(false);
    expect(c.dataVacuum).toBe(false);
    expect(c.executionImpact).toBe('NONE');
    expect(c.confidence).toBe('NOT_APPLICABLE');
  });

  it('P4_TELEMETRY_VERBOSE budget exceeded → non-blocking telemetry suppression, no confidence=MISSING propagation', () => {
    const c = classifyDataVacuumRootCause({
      throttleLevel: 'SOFT',
      circuitState: 'SOFT_THROTTLED',
      hasRecent5xx: false,
      cacheAvailable: false,
      upstreamHydrationFailed: false,
      priority: 'P4_TELEMETRY_VERBOSE',
      trId: 'FHKST01010100',
      budgetExceeded: true,
    });
    expect(c.rootCause).toBe('P4_TELEMETRY_SUPPRESSED');
    expect(c.blocking).toBe(false);
    expect(c.dataVacuum).toBe(false);
    expect(c.executionImpact).toBe('NONE');
    expect(c.confidence).toBe('NOT_APPLICABLE');
  });

  it('KIS_SHORT materialize skipped → 보조 레이어 실패만 표시하고 execution 차단 금지', () => {
    const c = classifyDataVacuumRootCause({
      throttleLevel: 'NONE',
      circuitState: 'CLOSED',
      hasRecent5xx: false,
      cacheAvailable: false,
      upstreamHydrationFailed: false,
      shortLayerMaterializeSkipped: true,
    });
    expect(c.rootCause).toBe('SHORT_LAYER_NOT_MATERIALIZED');
    expect(c.blocking).toBe(false);
    expect(c.marketSignal).toBe(false);
    expect(c.executionImpact).toBe('NONE');
    expect(c.useForExecution).toBe(false);
    expect(c.useForShadow).toBe(true);
  });

  it('upstream hydration 실패 → UPSTREAM_CANDIDATE_HYDRATION_FAILED + NEW_BUY_BLOCKED_ONLY', () => {
    const c = classifyDataVacuumRootCause({
      throttleLevel: 'NONE',
      circuitState: 'CLOSED',
      hasRecent5xx: false,
      cacheAvailable: true,
      upstreamHydrationFailed: true,
    });
    expect(c.rootCause).toBe('UPSTREAM_CANDIDATE_HYDRATION_FAILED');
    expect(c.executionImpact).toBe('NEW_BUY_BLOCKED_ONLY');
    expect(c.nextAction).toBe('CHECK_UPSTREAM_PROVIDER');
  });

  it('circuit OPEN + 5xx + cache 가용 → KIS_SERVER_ERROR_WITH_CACHE + DEGRADED', () => {
    const c = classifyDataVacuumRootCause({
      throttleLevel: 'NONE',
      circuitState: 'OPEN',
      hasRecent5xx: true,
      cacheAvailable: true,
      upstreamHydrationFailed: false,
    });
    expect(c.rootCause).toBe('KIS_SERVER_ERROR_WITH_CACHE');
    expect(c.fallbackProvider).toBe('CACHE');
    expect(c.confidence).toBe('DEGRADED');
    expect(c.executionImpact).toBe('NONE');
  });

  it('circuit OPEN + 5xx + cache 부재 → KIS_SERVER_ERROR_NO_CACHE + MISSING', () => {
    const c = classifyDataVacuumRootCause({
      throttleLevel: 'NONE',
      circuitState: 'OPEN',
      hasRecent5xx: true,
      cacheAvailable: false,
      upstreamHydrationFailed: false,
    });
    expect(c.rootCause).toBe('KIS_SERVER_ERROR_NO_CACHE');
    expect(c.fallbackProvider).toBe('NONE');
    expect(c.confidence).toBe('MISSING');
  });

  it('SOFT/HARD throttle + 5xx 없음 → KIS_TR_THROTTLED', () => {
    for (const t of ['SOFT', 'HARD'] as const) {
      const c = classifyDataVacuumRootCause({
        throttleLevel: t,
        circuitState: 'SOFT_THROTTLED',
        hasRecent5xx: false,
        cacheAvailable: true,
        upstreamHydrationFailed: false,
      });
      expect(c.rootCause).toBe('KIS_TR_THROTTLED');
      expect(c.nextAction).toBe('REDUCE_SCAN_DIAGNOSTIC_CALLS_AND_USE_BATCH_CACHE');
    }
  });

  it('UNCLASSIFIED fallback (정상 상태)', () => {
    const c = classifyDataVacuumRootCause({
      throttleLevel: 'NONE',
      circuitState: 'CLOSED',
      hasRecent5xx: false,
      cacheAvailable: true,
      upstreamHydrationFailed: false,
    });
    expect(c.rootCause).toBe('UNCLASSIFIED_EXECUTION_DATA_GAP');
    expect(c.executionImpact).toBe('NONE');
  });

  it('ENV DISABLED → UNCLASSIFIED_NON_BLOCKING_DIAGNOSTIC + executionImpact=NONE 안전 fallback', () => {
    const originalEnv = process.env.DATA_VACUUM_CLASSIFIER_PATCH_004_DISABLED;
    process.env.DATA_VACUUM_CLASSIFIER_PATCH_004_DISABLED = 'true';
    try {
      const c = classifyDataVacuumRootCause({
        throttleLevel: 'HARD',
        circuitState: 'OPEN',
        hasRecent5xx: true,
        cacheAvailable: false,
        upstreamHydrationFailed: true,
      });
      expect(c.rootCause).toBe('UNCLASSIFIED_NON_BLOCKING_DIAGNOSTIC');
      expect(c.executionImpact).toBe('NONE');
    } finally {
      if (originalEnv === undefined) delete process.env.DATA_VACUUM_CLASSIFIER_PATCH_004_DISABLED;
      else process.env.DATA_VACUUM_CLASSIFIER_PATCH_004_DISABLED = originalEnv;
    }
  });
});

describe('Patch-004 DataVacuum literal type 강제 (사용자 §8/9 절대 불변식)', () => {
  it('모든 분기에서 marketSignal=false', () => {
    const cases = [
      { throttleLevel: 'HARD' as const, circuitState: 'OPEN' as const, hasRecent5xx: true, cacheAvailable: false, upstreamHydrationFailed: false },
      { throttleLevel: 'SOFT' as const, circuitState: 'SOFT_THROTTLED' as const, hasRecent5xx: false, cacheAvailable: true, upstreamHydrationFailed: false },
      { throttleLevel: 'NONE' as const, circuitState: 'CLOSED' as const, hasRecent5xx: false, cacheAvailable: false, upstreamHydrationFailed: true },
    ];
    for (const input of cases) {
      const c = classifyDataVacuumRootCause(input);
      expect(c.marketSignal).toBe(false);
      expect(c.engineAlive).toBe(true);
      expect(c.shadowLearning).toBe(true);
    }
  });

  it('executionImpact 는 NONE 또는 NEW_BUY_BLOCKED_ONLY 만 (절대 invariant)', () => {
    const allowedValues = new Set(['NONE', 'NEW_BUY_BLOCKED_ONLY']);
    const matrix = [
      { throttleLevel: 'NONE' as const, circuitState: 'CLOSED' as const, hasRecent5xx: false, cacheAvailable: true },
      { throttleLevel: 'SOFT' as const, circuitState: 'SOFT_THROTTLED' as const, hasRecent5xx: false, cacheAvailable: false },
      { throttleLevel: 'HARD' as const, circuitState: 'OPEN' as const, hasRecent5xx: true, cacheAvailable: true },
    ];
    for (const input of matrix) {
      for (const upstreamFailed of [true, false]) {
        const c = classifyDataVacuumRootCause({ ...input, upstreamHydrationFailed: upstreamFailed });
        expect(allowedValues.has(c.executionImpact)).toBe(true);
      }
    }
  });
});

describe('Patch-004 DataVacuum 진단 로그 SSOT (사용자 §"기대 로그 예시" 정확 형식)', () => {
  it('formatDataVacuumRootCauseLog 8 필드 포함', () => {
    const c = classifyDataVacuumRootCause({
      throttleLevel: 'NONE',
      circuitState: 'OPEN',
      hasRecent5xx: true,
      cacheAvailable: false,
      upstreamHydrationFailed: false,
    });
    const log = formatDataVacuumRootCauseLog(c);
    expect(log).toContain('[DATA_VACUUM_ROOT_CAUSE]');
    expect(log).toContain('rootCause=KIS_SERVER_ERROR_NO_CACHE');
    expect(log).toContain('marketSignal=false');
    expect(log).toContain('executionImpact=NEW_BUY_BLOCKED_ONLY');
    expect(log).toContain('shadowLearning=true');
    expect(log).toContain('engineAlive=true');
    expect(log).toContain('fallbackProvider=NONE');
    expect(log).toContain('confidence=MISSING');
    expect(log).toContain('nextAction=WAIT_FOR_PROVIDER_RECOVERY');
  });

  it('compact line PATCH-RUNTIME 태그', () => {
    const c = classifyDataVacuumRootCause({
      throttleLevel: 'HARD',
      circuitState: 'SOFT_THROTTLED',
      hasRecent5xx: false,
      cacheAvailable: true,
      upstreamHydrationFailed: false,
    });
    const line = formatDataVacuumCompactLine(c);
    expect(line).toContain('[PATCH-RUNTIME] (Patch-004 DATA_VACUUM)');
    expect(line).toContain('rootCause=KIS_TR_THROTTLED');
    expect(line).toContain('marketSignal=false');
    expect(line).toContain('engineAlive=true');
    expect(line).toContain('shadowLearning=true');
  });
});

describe('Patch-004 DataVacuum 정적 grep 가드', () => {
  const ssotPath = resolve(__dirname, 'dataVacuumRootCauseClassifierPatch004.ts');
  let src = '';
  beforeEach(() => {
    src = readFileSync(ssotPath, 'utf-8');
  });

  it('KIS 주문 함수 5종 import 0건', () => {
    const forbidden = ['placeKisMarketOrder', 'placeKisSellOrder', 'placeKisStopLossOrder', 'placeKisTakeProfitOrder', 'cancelKisOrder'];
    for (const fn of forbidden) {
      expect(src).not.toMatch(new RegExp(`\\b${fn}\\b`));
    }
  });

  it('autoTradeEngine / orderExecutor / trancheExecutor import 0건', () => {
    expect(src).not.toMatch(/autoTradeEngine/);
    expect(src).not.toMatch(/orderExecutor/);
    expect(src).not.toMatch(/trancheExecutor/);
  });

  it('외부 fetch / axios import 0건 (순수 함수)', () => {
    expect(src).not.toMatch(/from\s+['"]axios['"]/);
    expect(src).not.toMatch(/from\s+['"]node-fetch['"]/);
    expect(src).not.toMatch(/\bfetch\s*\(/);
  });

  it('marketSignal: false literal 강제', () => {
    expect(src).toContain('marketSignal: false');
  });

  it('engineAlive: true / shadowLearning: true literal 강제', () => {
    expect(src).toContain('engineAlive: true');
    expect(src).toContain('shadowLearning: true');
  });

  it('ADR-0157 정확 비교', () => {
    expect(src).toMatch(/=== 'true'/);
  });

  it('Patch ID 추적 주석', () => {
    expect(src).toContain('KIS-TR-PRIORITY-BUDGET-AND-SAFE-DEGRADE-001');
  });
});

describe('Patch-004 http.ts wiring 정적 grep 가드', () => {
  const httpPath = resolve(__dirname, 'http.ts');
  let src = '';
  beforeEach(() => {
    src = readFileSync(httpPath, 'utf-8');
  });

  it('kisPriorityBudgetPatch004 import 의무', () => {
    expect(src).toContain('kisPriorityBudgetPatch004.js');
    expect(src).toContain('evaluatePriorityBudget');
    expect(src).toContain('mapPriorityV1ToV2');
    expect(src).toContain('recordPriorityBudgetCall');
    expect(src).toContain('recordPriorityCallTtl');
    expect(src).toContain('isPriorityCallDeduped');
  });

  it('dataVacuumRootCauseClassifierPatch004 import 의무', () => {
    expect(src).toContain('dataVacuumRootCauseClassifierPatch004.js');
    expect(src).toContain('classifyDataVacuumRootCause');
    expect(src).toContain('formatDataVacuumRootCauseLog');
  });

  it('budgetDecision check + DATA_VACUUM classifier 호출', () => {
    expect(src).toContain('evaluatePriorityBudget');
    expect(src).toContain('classifyDataVacuumRootCause');
  });

  it('Patch-004 추적 주석 명시', () => {
    expect(src).toContain('Patch-KIS-TR-PRIORITY-BUDGET-AND-SAFE-DEGRADE-001');
  });
});
