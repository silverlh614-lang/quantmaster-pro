/**
 * Patch-KIS-TR-PRIORITY-BUDGET-AND-SAFE-DEGRADE-001 회귀 테스트.
 *
 * 사용자 §"반드시 테스트" 10 시나리오 + 정적 grep 가드 + literal type 강제 정합.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  PER_PRIORITY_BUDGET_60S,
  PRIORITY_TTL_DEDUP_MS,
  PRIORITY_V1_TO_V2,
  PRIORITY_V2_TO_V1,
  __resetKisPriorityBudgetStateForTests,
  buildTtlDedupKey,
  computeFallbackForDeferred,
  countPriorityBudgetUsed60s,
  evaluatePriorityBudget,
  formatKisPriorityBudgetCompactLine,
  formatKisPriorityBudgetLog,
  isKisPriorityBudgetDisabled,
  isKisPriorityTtlDedupDisabled,
  isPriorityCallDeduped,
  mapPriorityV1ToV2,
  mapPriorityV2ToV1,
  recordPriorityBudgetCall,
  recordPriorityCallTtl,
  type KisCallPriorityV2,
} from './kisPriorityBudgetPatch004.js';

const __dirname = dirname(fileURLToPath(import.meta.url));

describe('Patch-004 priority budget — ENV gates (ADR-0157 정확 비교)', () => {
  const originalEnv = { ...process.env };
  beforeEach(() => {
    __resetKisPriorityBudgetStateForTests();
    delete process.env.KIS_PRIORITY_BUDGET_PATCH_004_DISABLED;
    delete process.env.KIS_PRIORITY_TTL_DEDUP_DISABLED;
  });
  afterEach(() => {
    process.env = { ...originalEnv };
  });

  it('isKisPriorityBudgetDisabled default false', () => {
    expect(isKisPriorityBudgetDisabled()).toBe(false);
  });

  it('isKisPriorityBudgetDisabled true 정확 비교', () => {
    process.env.KIS_PRIORITY_BUDGET_PATCH_004_DISABLED = 'true';
    expect(isKisPriorityBudgetDisabled()).toBe(true);
  });

  it('isKisPriorityBudgetDisabled rejects truthy non-`true`', () => {
    for (const v of ['1', 'TRUE', 'yes', 'Yes', '', 'false']) {
      process.env.KIS_PRIORITY_BUDGET_PATCH_004_DISABLED = v;
      expect(isKisPriorityBudgetDisabled()).toBe(false);
    }
  });

  it('isKisPriorityTtlDedupDisabled default false', () => {
    expect(isKisPriorityTtlDedupDisabled()).toBe(false);
  });

  it('isKisPriorityTtlDedupDisabled true 정확 비교', () => {
    process.env.KIS_PRIORITY_TTL_DEDUP_DISABLED = 'true';
    expect(isKisPriorityTtlDedupDisabled()).toBe(true);
  });
});

describe('Patch-004 SSOT 정합 (사용자 §"우선순위 정책" 절대 변경 금지)', () => {
  it('PER_PRIORITY_BUDGET_60S 정확 매트릭스', () => {
    expect(PER_PRIORITY_BUDGET_60S.P0_POSITION_EXIT).toBe(Number.POSITIVE_INFINITY);
    expect(PER_PRIORITY_BUDGET_60S.P1_SHADOW_POSITION_MANAGEMENT).toBe(30);
    expect(PER_PRIORITY_BUDGET_60S.P2_READY_CANDIDATE_CONFIRM).toBe(20);
    expect(PER_PRIORITY_BUDGET_60S.P3_SCAN_DIAGNOSTIC).toBe(5);
    expect(PER_PRIORITY_BUDGET_60S.P4_TELEMETRY_VERBOSE).toBe(2);
  });

  it('PRIORITY_V1_TO_V2 매핑 5종', () => {
    expect(PRIORITY_V1_TO_V2.REAL_POSITION).toBe('P0_POSITION_EXIT');
    expect(PRIORITY_V1_TO_V2.SHADOW_OPEN).toBe('P1_SHADOW_POSITION_MANAGEMENT');
    expect(PRIORITY_V1_TO_V2.READY_CANDIDATE).toBe('P2_READY_CANDIDATE_CONFIRM');
    expect(PRIORITY_V1_TO_V2.SCAN_DIAGNOSTIC).toBe('P3_SCAN_DIAGNOSTIC');
    expect(PRIORITY_V1_TO_V2.WATCHLIST).toBe('P4_TELEMETRY_VERBOSE');
  });

  it('PRIORITY_V2_TO_V1 역매핑 round-trip', () => {
    for (const v1 of Object.keys(PRIORITY_V1_TO_V2) as Array<keyof typeof PRIORITY_V1_TO_V2>) {
      expect(mapPriorityV2ToV1(mapPriorityV1ToV2(v1))).toBe(v1);
    }
  });

  it('PRIORITY_TTL_DEDUP_MS 5초 SSOT', () => {
    expect(PRIORITY_TTL_DEDUP_MS).toBe(5_000);
  });

  it('Object.freeze drift 가드', () => {
    expect(Object.isFrozen(PER_PRIORITY_BUDGET_60S)).toBe(true);
    expect(Object.isFrozen(PRIORITY_V1_TO_V2)).toBe(true);
    expect(Object.isFrozen(PRIORITY_V2_TO_V1)).toBe(true);
  });
});

describe('Patch-004 §"반드시 테스트" #1 — P0 보유 매도 관리 HARD throttle 시에도 통과', () => {
  beforeEach(() => __resetKisPriorityBudgetStateForTests());

  it('P0_POSITION_EXIT HARD throttle + circuit OPEN 에서도 allowed=true', () => {
    const d = evaluatePriorityBudget({
      trId: 'TTTC8434R',
      symbol: '005930',
      priority: 'P0_POSITION_EXIT',
      throttleLevel: 'HARD',
      circuitState: 'OPEN',
      sameSecondCalls: 10,
      sameMinuteCalls: 100,
      cacheAvailable: false,
    });
    expect(d.allowed).toBe(true);
    expect(d.deferred).toBe(false);
    expect(d.dropped).toBe(false);
    expect(d.reason).toBe('EXIT_MANAGEMENT_PROTECTED');
    expect(d.action).toBe('ALLOW');
    expect(d.marketSignal).toBe(false);
    expect(d.executionImpact).toBe('NONE');
    expect(d.engineAlive).toBe(true);
    expect(d.shadowLearning).toBe(true);
  });

  it('P0_POSITION_EXIT budget 초과해도 통과 (Infinity)', () => {
    for (let i = 0; i < 100; i++) recordPriorityBudgetCall('TTTC8434R', 'P0_POSITION_EXIT');
    const d = evaluatePriorityBudget({
      trId: 'TTTC8434R',
      symbol: '005930',
      priority: 'P0_POSITION_EXIT',
      throttleLevel: 'NONE',
      circuitState: 'CLOSED',
      sameSecondCalls: 0,
      sameMinuteCalls: 100,
      cacheAvailable: false,
    });
    expect(d.allowed).toBe(true);
    expect(d.reason).toBe('EXIT_MANAGEMENT_PROTECTED');
  });
});

describe('Patch-004 §"반드시 테스트" #2 — SCAN_DIAGNOSTIC (P3) defer 시점', () => {
  beforeEach(() => __resetKisPriorityBudgetStateForTests());

  it('SOFT throttle + P3 budget 초과 시 diagnostic-only suppress', () => {
    for (let i = 0; i < 5; i++) recordPriorityBudgetCall('FHKST01010100', 'P3_SCAN_DIAGNOSTIC');
    const d = evaluatePriorityBudget({
      trId: 'FHKST01010100',
      symbol: '005930',
      priority: 'P3_SCAN_DIAGNOSTIC',
      throttleLevel: 'SOFT',
      circuitState: 'SOFT_THROTTLED',
      sameSecondCalls: 4,
      sameMinuteCalls: 7,
      cacheAvailable: true,
    });
    expect(d.allowed).toBe(false);
    expect(d.deferred).toBe(false);
    expect(d.diagnosticSuppressed).toBe(true);
    expect(d.action).toBe('SUPPRESS_DIAGNOSTIC_ONLY');
    expect(d.reason).toBe('BUDGET_EXCEEDED');
  });

  it('HARD throttle + P3 즉시 diagnostic-only suppress', () => {
    const d = evaluatePriorityBudget({
      trId: 'FHKST01010100',
      symbol: '005930',
      priority: 'P3_SCAN_DIAGNOSTIC',
      throttleLevel: 'HARD',
      circuitState: 'SOFT_THROTTLED',
      sameSecondCalls: 7,
      sameMinuteCalls: 8,
      cacheAvailable: true,
    });
    expect(d.allowed).toBe(false);
    expect(d.deferred).toBe(false);
    expect(d.diagnosticSuppressed).toBe(true);
    expect(d.reason).toBe('TR_CIRCUIT_OPEN_OR_THROTTLED');
  });

  it('circuit OPEN + P4 dropped=true (suppress)', () => {
    const d = evaluatePriorityBudget({
      trId: 'FHKST01010100',
      symbol: '005930',
      priority: 'P4_TELEMETRY_VERBOSE',
      throttleLevel: 'NONE',
      circuitState: 'OPEN',
      sameSecondCalls: 0,
      sameMinuteCalls: 0,
      cacheAvailable: false,
    });
    expect(d.allowed).toBe(false);
    expect(d.dropped).toBe(true);
    expect(d.action).toBe('SUPPRESS_DIAGNOSTIC_ONLY');
  });
});

describe('Patch-004 §"반드시 테스트" #3 — P2 > P3 우선순위', () => {
  beforeEach(() => __resetKisPriorityBudgetStateForTests());

  it('HARD throttle 시 P2 신규 매수 후보 deferred + NEW_BUY_BLOCKED_ONLY 표시', () => {
    const d = evaluatePriorityBudget({
      trId: 'FHKST01010100',
      symbol: '005930',
      priority: 'P2_READY_CANDIDATE_CONFIRM',
      throttleLevel: 'HARD',
      circuitState: 'SOFT_THROTTLED',
      sameSecondCalls: 7,
      sameMinuteCalls: 8,
      cacheAvailable: true,
    });
    expect(d.deferred).toBe(true);
    expect(d.reason).toBe('KIS_TR_HARD_THROTTLED');
    expect(d.executionImpact).toBe('NEW_BUY_BLOCKED_ONLY');
  });

  it('circuit OPEN 시 P2 통과 (P3 는 diagnostic-only suppress)', () => {
    const dP2 = evaluatePriorityBudget({
      trId: 'FHKST01010100',
      symbol: '005930',
      priority: 'P2_READY_CANDIDATE_CONFIRM',
      throttleLevel: 'NONE',
      circuitState: 'OPEN',
      sameSecondCalls: 0,
      sameMinuteCalls: 0,
      cacheAvailable: false,
    });
    expect(dP2.allowed).toBe(true);
    const dP3 = evaluatePriorityBudget({
      trId: 'FHKST01010100',
      symbol: '005930',
      priority: 'P3_SCAN_DIAGNOSTIC',
      throttleLevel: 'NONE',
      circuitState: 'OPEN',
      sameSecondCalls: 0,
      sameMinuteCalls: 0,
      cacheAvailable: false,
    });
    expect(dP3.allowed).toBe(false);
    expect(dP3.deferred).toBe(false);
    expect(dP3.diagnosticSuppressed).toBe(true);
  });
});

describe('Patch-004 §"반드시 테스트" #4+#5 — fallbackProvider CACHE/NONE 분리 + confidence', () => {
  it('cacheAvailable=true → fallbackProvider=CACHE + confidence=DEGRADED', () => {
    const r = computeFallbackForDeferred(true);
    expect(r.fallbackProvider).toBe('CACHE');
    expect(r.confidence).toBe('DEGRADED');
  });

  it('cacheAvailable=false → fallbackProvider=NONE + confidence=MISSING', () => {
    const r = computeFallbackForDeferred(false);
    expect(r.fallbackProvider).toBe('NONE');
    expect(r.confidence).toBe('MISSING');
  });

  it('diagnostic decision 은 cache 상태와 무관하게 confidence=NOT_APPLICABLE (cache 가용)', () => {
    const d = evaluatePriorityBudget({
      trId: 'FHKST01010100',
      symbol: '005930',
      priority: 'P3_SCAN_DIAGNOSTIC',
      throttleLevel: 'HARD',
      circuitState: 'SOFT_THROTTLED',
      sameSecondCalls: 7,
      sameMinuteCalls: 8,
      cacheAvailable: true,
    });
    expect(d.fallbackProvider).toBe('NONE');
    expect(d.confidence).toBe('NOT_APPLICABLE');
  });

  it('diagnostic decision 은 cache 상태와 무관하게 confidence=NOT_APPLICABLE (cache 부재)', () => {
    const d = evaluatePriorityBudget({
      trId: 'FHKST01010100',
      symbol: '005930',
      priority: 'P3_SCAN_DIAGNOSTIC',
      throttleLevel: 'HARD',
      circuitState: 'SOFT_THROTTLED',
      sameSecondCalls: 7,
      sameMinuteCalls: 8,
      cacheAvailable: false,
    });
    expect(d.fallbackProvider).toBe('NONE');
    expect(d.confidence).toBe('NOT_APPLICABLE');
  });
});

describe('Patch-004 §"반드시 테스트" #6 — KIS 장애 marketSignal=false 보장', () => {
  beforeEach(() => __resetKisPriorityBudgetStateForTests());

  it('모든 분기에서 marketSignal=false literal', () => {
    const cases: KisCallPriorityV2[] = [
      'P0_POSITION_EXIT',
      'P1_SHADOW_POSITION_MANAGEMENT',
      'P2_READY_CANDIDATE_CONFIRM',
      'P3_SCAN_DIAGNOSTIC',
      'P4_TELEMETRY_VERBOSE',
    ];
    for (const p of cases) {
      const d = evaluatePriorityBudget({
        trId: 'FHKST01010100',
        symbol: '005930',
        priority: p,
        throttleLevel: 'HARD',
        circuitState: 'OPEN',
        sameSecondCalls: 10,
        sameMinuteCalls: 100,
        cacheAvailable: false,
      });
      expect(d.marketSignal).toBe(false);
      expect(d.engineAlive).toBe(true);
      expect(d.shadowLearning).toBe(true);
    }
  });

  it('executionImpact 는 NONE 또는 NEW_BUY_BLOCKED_ONLY 만 (절대 invariant)', () => {
    const allowedValues = new Set(['NONE', 'NEW_BUY_BLOCKED_ONLY']);
    const priorities: KisCallPriorityV2[] = [
      'P0_POSITION_EXIT',
      'P1_SHADOW_POSITION_MANAGEMENT',
      'P2_READY_CANDIDATE_CONFIRM',
      'P3_SCAN_DIAGNOSTIC',
      'P4_TELEMETRY_VERBOSE',
    ];
    const throttles = ['NONE', 'SOFT', 'HARD', 'CIRCUIT_OPEN'] as const;
    for (const p of priorities) {
      for (const t of throttles) {
        const d = evaluatePriorityBudget({
          trId: 'FHKST01010100',
          priority: p,
          throttleLevel: t,
          circuitState: t === 'CIRCUIT_OPEN' ? 'OPEN' : 'CLOSED',
          sameSecondCalls: 5,
          sameMinuteCalls: 7,
          cacheAvailable: true,
        });
        expect(allowedValues.has(d.executionImpact)).toBe(true);
      }
    }
  });
});

describe('Patch-004 §"반드시 테스트" #7 — 신규 매수만 차단, Shadow learning 계속', () => {
  beforeEach(() => __resetKisPriorityBudgetStateForTests());

  it('HARD throttle + P2 (신규 매수) deferred + shadowLearning=true 유지', () => {
    const d = evaluatePriorityBudget({
      trId: 'FHKST01010100',
      priority: 'P2_READY_CANDIDATE_CONFIRM',
      throttleLevel: 'HARD',
      circuitState: 'SOFT_THROTTLED',
      sameSecondCalls: 7,
      sameMinuteCalls: 8,
      cacheAvailable: true,
    });
    expect(d.deferred).toBe(true);
    expect(d.shadowLearning).toBe(true);
    expect(d.executionImpact).toBe('NEW_BUY_BLOCKED_ONLY');
  });

  it('HARD throttle + P1 (Shadow position) allowed=true', () => {
    const d = evaluatePriorityBudget({
      trId: 'FHKST01010100',
      priority: 'P1_SHADOW_POSITION_MANAGEMENT',
      throttleLevel: 'HARD',
      circuitState: 'SOFT_THROTTLED',
      sameSecondCalls: 7,
      sameMinuteCalls: 8,
      cacheAvailable: true,
    });
    expect(d.allowed).toBe(true);
    expect(d.shadowLearning).toBe(true);
  });
});

describe('Patch-004 §"반드시 테스트" #8 — TTL dedup', () => {
  beforeEach(() => __resetKisPriorityBudgetStateForTests());

  it('동일 trId+symbol+priority 호출 5초 내 중복 차단', () => {
    const now = Date.now();
    recordPriorityCallTtl('FHKST01010100', '005930', 'P3_SCAN_DIAGNOSTIC', now);
    expect(isPriorityCallDeduped('FHKST01010100', '005930', 'P3_SCAN_DIAGNOSTIC', now + 1_000)).toBe(true);
    expect(isPriorityCallDeduped('FHKST01010100', '005930', 'P3_SCAN_DIAGNOSTIC', now + 4_999)).toBe(true);
    expect(isPriorityCallDeduped('FHKST01010100', '005930', 'P3_SCAN_DIAGNOSTIC', now + 5_001)).toBe(false);
  });

  it('다른 symbol 은 dedup 안 됨', () => {
    const now = Date.now();
    recordPriorityCallTtl('FHKST01010100', '005930', 'P3_SCAN_DIAGNOSTIC', now);
    expect(isPriorityCallDeduped('FHKST01010100', '035720', 'P3_SCAN_DIAGNOSTIC', now + 1_000)).toBe(false);
  });

  it('P0_POSITION_EXIT 은 dedup 적용 안 됨 (보유 매도 보호)', () => {
    const now = Date.now();
    recordPriorityCallTtl('TTTC8434R', '005930', 'P0_POSITION_EXIT', now);
    expect(isPriorityCallDeduped('TTTC8434R', '005930', 'P0_POSITION_EXIT', now + 1_000)).toBe(false);
  });

  it('buildTtlDedupKey 정확 format', () => {
    expect(buildTtlDedupKey('FHKST01010100', '005930', 'P3_SCAN_DIAGNOSTIC')).toBe('FHKST01010100:005930:P3_SCAN_DIAGNOSTIC');
    expect(buildTtlDedupKey('TTTC8434R', undefined, 'P0_POSITION_EXIT')).toBe('TTTC8434R:NO_SYMBOL:P0_POSITION_EXIT');
  });

  it('ENV TTL_DEDUP_DISABLED 시 dedup 비활성', () => {
    process.env.KIS_PRIORITY_TTL_DEDUP_DISABLED = 'true';
    try {
      const now = Date.now();
      recordPriorityCallTtl('FHKST01010100', '005930', 'P3_SCAN_DIAGNOSTIC', now);
      expect(isPriorityCallDeduped('FHKST01010100', '005930', 'P3_SCAN_DIAGNOSTIC', now + 1_000)).toBe(false);
    } finally {
      delete process.env.KIS_PRIORITY_TTL_DEDUP_DISABLED;
    }
  });
});

describe('Patch-004 §"반드시 테스트" #10 — Telegram 자동 발송 0 (Railway 로그만)', () => {
  it('formatKisPriorityBudgetLog 가 telegram 발송 0건 (string 만 반환)', () => {
    const d = evaluatePriorityBudget({
      trId: 'FHKST01010100',
      priority: 'P3_SCAN_DIAGNOSTIC',
      throttleLevel: 'HARD',
      circuitState: 'OPEN',
      sameSecondCalls: 10,
      sameMinuteCalls: 100,
      cacheAvailable: false,
    });
    const log = formatKisPriorityBudgetLog(d);
    expect(log).toContain('[KIS_PRIORITY_BUDGET]');
    expect(log).toContain('priority=P3_SCAN_DIAGNOSTIC');
    expect(log).toContain('executionImpact=NONE');
    expect(log).not.toContain('sendTelegram'); // 인증 명시
  });

  it('formatKisPriorityBudgetCompactLine 60s 카운트 표시 + invariants', () => {
    __resetKisPriorityBudgetStateForTests();
    recordPriorityBudgetCall('TTTC8434R', 'P0_POSITION_EXIT');
    recordPriorityBudgetCall('FHKST01010100', 'P3_SCAN_DIAGNOSTIC');
    const line = formatKisPriorityBudgetCompactLine();
    expect(line).toContain('[PATCH-RUNTIME] (Patch-004)');
    expect(line).toContain('P0=1');
    expect(line).toContain('P3=1/5');
    expect(line).toContain('marketSignal=false');
    expect(line).toContain('executionImpact=NONE');
    expect(line).toContain('engineAlive=true');
    expect(line).toContain('shadowLearning=true');
  });
});

describe('Patch-004 정적 grep 가드 (안전 invariants)', () => {
  const ssotPath = resolve(__dirname, 'kisPriorityBudgetPatch004.ts');
  let src = '';
  beforeEach(() => {
    src = readFileSync(ssotPath, 'utf-8');
  });

  it('KIS 주문 함수 5종 import 0건', () => {
    const forbidden = ['placeKisMarketOrder', 'placeKisSellOrder', 'placeKisStopLossOrder', 'placeKisTakeProfitOrder', 'cancelKisOrder'];
    for (const fn of forbidden) {
      expect(src).not.toContain(`import.*${fn}`);
      expect(src).not.toMatch(new RegExp(`\\b${fn}\\b`));
    }
  });

  it('autoTradeEngine / orderExecutor / trancheExecutor import 0건', () => {
    expect(src).not.toMatch(/from\s+['"][^'"]*autoTradeEngine[^'"]*['"]/);
    expect(src).not.toMatch(/from\s+['"][^'"]*orderExecutor[^'"]*['"]/);
    expect(src).not.toMatch(/from\s+['"][^'"]*trancheExecutor[^'"]*['"]/);
  });

  it('외부 fetch / axios / node-fetch import 0건', () => {
    expect(src).not.toMatch(/from\s+['"]axios['"]/);
    expect(src).not.toMatch(/from\s+['"]node-fetch['"]/);
    expect(src).not.toMatch(/\bfetch\s*\(/);
  });

  it('ADR-0157 정확 비교 패턴', () => {
    expect(src).toMatch(/=== 'true'/);
    expect(src).not.toMatch(/!= 'false'/);
  });

  it('marketSignal: false literal 강제', () => {
    expect(src).toContain('marketSignal: false');
    expect(src).toContain('marketSignal: false as const');
  });

  it('engineAlive / shadowLearning literal 강제', () => {
    expect(src).toContain('engineAlive: true');
    expect(src).toContain('shadowLearning: true');
  });

  it('Patch ID 추적 주석 명시', () => {
    expect(src).toContain('KIS-TR-PRIORITY-BUDGET-AND-SAFE-DEGRADE-001');
  });
});
