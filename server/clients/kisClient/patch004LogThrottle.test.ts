/**
 * Patch-004 Hotfix — Railway 로그 도배 차단 throttle SSOT 회귀.
 *
 * 사용자 5/14 운영 보고 직접 차단 — `realDataKisGet` 매 호출마다 `[KIS_PRIORITY_BUDGET]` +
 * `[DATA_VACUUM_ROOT_CAUSE]` 2 console.warn 라인이 throttle/circuit 활성 시 분당 수백 라인
 * 폭주하던 결함을 (trId, reason) / rootCause 별 60s window throttle 로 차단.
 *
 * 패턴: Patch-001 (`realDataNoiseStore`) 60s NOISE_SUMMARY_LOG_INTERVAL_MS 정합.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  __resetKisPriorityBudgetStateForTests,
  buildPriorityBudgetLogThrottleKey,
  evaluatePriorityBudget,
  formatKisPriorityBudgetLog,
  formatKisPriorityBudgetLogThrottled,
  isPriorityBudgetLogThrottleDisabled,
  shouldEmitPriorityBudgetLog,
  shouldEmitTtlDedupLog,
} from './kisPriorityBudgetPatch004.js';
import {
  __resetDataVacuumLogThrottleStateForTests,
  classifyDataVacuumRootCause,
  formatDataVacuumRootCauseLog,
  formatDataVacuumRootCauseLogThrottled,
  isDataVacuumLogThrottleDisabled,
  shouldEmitDataVacuumLog,
} from './dataVacuumRootCauseClassifierPatch004.js';

const __dirname = dirname(fileURLToPath(import.meta.url));

describe('Patch-004 log throttle — KIS priority budget (kisPriorityBudgetPatch004.ts)', () => {
  const originalEnv = { ...process.env };
  beforeEach(() => {
    __resetKisPriorityBudgetStateForTests();
    delete process.env.KIS_PRIORITY_BUDGET_LOG_THROTTLE_DISABLED;
  });
  afterEach(() => {
    process.env = { ...originalEnv };
  });

  describe('ENV gate (ADR-0157 정확 비교)', () => {
    it('default OFF — 미설정 시 throttle 활성', () => {
      expect(isPriorityBudgetLogThrottleDisabled()).toBe(false);
    });
    it('=== "true" 시 throttle 비활성 (legacy 복원)', () => {
      process.env.KIS_PRIORITY_BUDGET_LOG_THROTTLE_DISABLED = 'true';
      expect(isPriorityBudgetLogThrottleDisabled()).toBe(true);
    });
    it("'1' / 'TRUE' / 'yes' / 빈값 모두 default 동작 (ADR-0157)", () => {
      for (const v of ['1', 'TRUE', 'yes', 'Yes', '']) {
        process.env.KIS_PRIORITY_BUDGET_LOG_THROTTLE_DISABLED = v;
        expect(isPriorityBudgetLogThrottleDisabled()).toBe(false);
      }
    });
  });

  describe('buildPriorityBudgetLogThrottleKey SSOT', () => {
    it('(trId, reason) 정확 매핑', () => {
      expect(buildPriorityBudgetLogThrottleKey('FHKST01010100', 'BUDGET_EXCEEDED')).toBe('FHKST01010100:BUDGET_EXCEEDED');
      expect(buildPriorityBudgetLogThrottleKey('FHPST01710000', 'TR_CIRCUIT_OPEN_OR_THROTTLED')).toBe(
        'FHPST01710000:TR_CIRCUIT_OPEN_OR_THROTTLED',
      );
    });
  });

  describe('shouldEmitPriorityBudgetLog — 60s window', () => {
    it('첫 호출 → emit=true + suppressedSinceLast=0', () => {
      const r = shouldEmitPriorityBudgetLog('FHKST01010100', 'BUDGET_EXCEEDED', 1_000_000);
      expect(r.emit).toBe(true);
      expect(r.suppressedSinceLast).toBe(0);
      expect(r.windowMs).toBe(60_000);
    });

    it('60s 윈도우 내 후속 호출 → emit=false + suppressedSinceLast 누적', () => {
      const t0 = 2_000_000;
      shouldEmitPriorityBudgetLog('FHKST01010100', 'BUDGET_EXCEEDED', t0);
      const r1 = shouldEmitPriorityBudgetLog('FHKST01010100', 'BUDGET_EXCEEDED', t0 + 10_000);
      const r2 = shouldEmitPriorityBudgetLog('FHKST01010100', 'BUDGET_EXCEEDED', t0 + 20_000);
      const r3 = shouldEmitPriorityBudgetLog('FHKST01010100', 'BUDGET_EXCEEDED', t0 + 30_000);
      expect(r1.emit).toBe(false);
      expect(r1.suppressedSinceLast).toBe(1);
      expect(r2.emit).toBe(false);
      expect(r2.suppressedSinceLast).toBe(2);
      expect(r3.emit).toBe(false);
      expect(r3.suppressedSinceLast).toBe(3);
    });

    it('60s 경과 후 첫 호출 → emit=true + suppressedSinceLast=누적 카운트', () => {
      const t0 = 3_000_000;
      shouldEmitPriorityBudgetLog('FHKST01010100', 'BUDGET_EXCEEDED', t0);
      shouldEmitPriorityBudgetLog('FHKST01010100', 'BUDGET_EXCEEDED', t0 + 5_000);
      shouldEmitPriorityBudgetLog('FHKST01010100', 'BUDGET_EXCEEDED', t0 + 10_000);
      // 60s 경과
      const r = shouldEmitPriorityBudgetLog('FHKST01010100', 'BUDGET_EXCEEDED', t0 + 60_001);
      expect(r.emit).toBe(true);
      expect(r.suppressedSinceLast).toBe(2);
    });

    it('60s 경과 후 emit 카운터 리셋 — 다음 후속 호출 suppress=1 부터', () => {
      const t0 = 4_000_000;
      shouldEmitPriorityBudgetLog('FHKST01010100', 'BUDGET_EXCEEDED', t0);
      shouldEmitPriorityBudgetLog('FHKST01010100', 'BUDGET_EXCEEDED', t0 + 5_000);
      shouldEmitPriorityBudgetLog('FHKST01010100', 'BUDGET_EXCEEDED', t0 + 60_001); // emit
      const r = shouldEmitPriorityBudgetLog('FHKST01010100', 'BUDGET_EXCEEDED', t0 + 60_002);
      expect(r.emit).toBe(false);
      expect(r.suppressedSinceLast).toBe(1);
    });

    it('(trId, reason) 다른 키는 독립 throttle', () => {
      const t0 = 5_000_000;
      const r1 = shouldEmitPriorityBudgetLog('FHKST01010100', 'BUDGET_EXCEEDED', t0);
      const r2 = shouldEmitPriorityBudgetLog('FHKST01010100', 'TTL_DEDUP_DUPLICATE', t0);
      const r3 = shouldEmitPriorityBudgetLog('FHPST01710000', 'BUDGET_EXCEEDED', t0);
      expect(r1.emit).toBe(true);
      expect(r2.emit).toBe(true);
      expect(r3.emit).toBe(true);
    });

    it('ENV DISABLED 시 항상 emit=true + suppressed=0', () => {
      process.env.KIS_PRIORITY_BUDGET_LOG_THROTTLE_DISABLED = 'true';
      const t0 = 6_000_000;
      const r1 = shouldEmitPriorityBudgetLog('FHKST01010100', 'BUDGET_EXCEEDED', t0);
      const r2 = shouldEmitPriorityBudgetLog('FHKST01010100', 'BUDGET_EXCEEDED', t0 + 1_000);
      const r3 = shouldEmitPriorityBudgetLog('FHKST01010100', 'BUDGET_EXCEEDED', t0 + 2_000);
      expect(r1.emit).toBe(true);
      expect(r2.emit).toBe(true);
      expect(r3.emit).toBe(true);
      expect(r1.suppressedSinceLast).toBe(0);
      expect(r2.suppressedSinceLast).toBe(0);
      expect(r3.suppressedSinceLast).toBe(0);
    });
  });

  describe('formatKisPriorityBudgetLogThrottled — suppress 시 null 반환', () => {
    it('첫 호출 → format 문자열 + suppressedSinceLast=0 (suffix 없음)', () => {
      // TR_CIRCUIT_OPEN_OR_THROTTLED 시뮬 — circuit OPEN + HARD throttle 시 P3 deferred
      const denied = evaluatePriorityBudget({
        trId: 'FHKST01010100',
        symbol: 'KOSPI:005930',
        priority: 'P3_SCAN_DIAGNOSTIC',
        throttleLevel: 'HARD',
        circuitState: 'OPEN',
        sameSecondCalls: 10,
        sameMinuteCalls: 100,
        cacheAvailable: false,
        nowMs: 7_000_000,
      });
      expect(denied.allowed).toBe(false);
      const log = formatKisPriorityBudgetLogThrottled(denied, 7_000_000);
      expect(log).not.toBeNull();
      expect(log!).toContain('[KIS_PRIORITY_BUDGET]');
      expect(log!).toContain(`reason=${denied.reason}`);
      expect(log!).not.toContain('suppressedCount=');
    });

    it('60s 윈도우 내 후속 호출 → null 반환 (suppress)', () => {
      const t0 = 8_000_000;
      const denied = evaluatePriorityBudget({
        trId: 'FHKST01010100',
        symbol: 'KOSPI:005930',
        priority: 'P3_SCAN_DIAGNOSTIC',
        throttleLevel: 'HARD',
        circuitState: 'OPEN',
        sameSecondCalls: 10,
        sameMinuteCalls: 100,
        cacheAvailable: false,
        nowMs: t0,
      });
      expect(formatKisPriorityBudgetLogThrottled(denied, t0)).not.toBeNull();
      expect(formatKisPriorityBudgetLogThrottled(denied, t0 + 1_000)).toBeNull();
      expect(formatKisPriorityBudgetLogThrottled(denied, t0 + 10_000)).toBeNull();
      expect(formatKisPriorityBudgetLogThrottled(denied, t0 + 30_000)).toBeNull();
    });

    it('60s 경과 후 → emit + suppressedCount suffix 부착', () => {
      const t0 = 9_000_000;
      const denied = evaluatePriorityBudget({
        trId: 'FHKST01010100',
        symbol: 'KOSPI:005930',
        priority: 'P3_SCAN_DIAGNOSTIC',
        throttleLevel: 'HARD',
        circuitState: 'OPEN',
        sameSecondCalls: 10,
        sameMinuteCalls: 100,
        cacheAvailable: false,
        nowMs: t0,
      });
      formatKisPriorityBudgetLogThrottled(denied, t0); // emit
      formatKisPriorityBudgetLogThrottled(denied, t0 + 1_000); // suppress 1
      formatKisPriorityBudgetLogThrottled(denied, t0 + 2_000); // suppress 2
      const log = formatKisPriorityBudgetLogThrottled(denied, t0 + 60_001);
      expect(log).not.toBeNull();
      expect(log!).toContain('[KIS_PRIORITY_BUDGET]');
      expect(log!).toContain('suppressedSinceLastMs=60000');
      expect(log!).toContain('suppressedCount=2');
    });

    it('base format 그대로 보존 (formatKisPriorityBudgetLog 결과 + suffix 만 추가)', () => {
      const t0 = 10_000_000;
      const denied = evaluatePriorityBudget({
        trId: 'FHKST01010100',
        symbol: 'KOSPI:005930',
        priority: 'P3_SCAN_DIAGNOSTIC',
        throttleLevel: 'HARD',
        circuitState: 'OPEN',
        sameSecondCalls: 10,
        sameMinuteCalls: 100,
        cacheAvailable: false,
        nowMs: t0,
      });
      const baseLog = formatKisPriorityBudgetLog(denied);
      const throttled = formatKisPriorityBudgetLogThrottled(denied, t0);
      expect(throttled).toBe(baseLog);
    });
  });

  describe('shouldEmitTtlDedupLog — TTL_DEDUP_DUPLICATE 분기 전용', () => {
    it('첫 호출 → emit=true', () => {
      const r = shouldEmitTtlDedupLog('FHKST01010100', 11_000_000);
      expect(r.emit).toBe(true);
    });
    it('60s 내 후속 → emit=false + suppress 누적', () => {
      const t0 = 12_000_000;
      shouldEmitTtlDedupLog('FHKST01010100', t0);
      const r = shouldEmitTtlDedupLog('FHKST01010100', t0 + 1_000);
      expect(r.emit).toBe(false);
      expect(r.suppressedSinceLast).toBe(1);
    });
    it('shouldEmitPriorityBudgetLog(trId, "TTL_DEDUP_DUPLICATE") 와 동등 키', () => {
      const t0 = 13_000_000;
      // 한 함수로 emit, 다른 함수에서도 같은 key 라 suppress
      shouldEmitTtlDedupLog('FHKST01010100', t0);
      const r = shouldEmitPriorityBudgetLog('FHKST01010100', 'TTL_DEDUP_DUPLICATE', t0 + 5_000);
      expect(r.emit).toBe(false);
      expect(r.suppressedSinceLast).toBe(1);
    });
  });

  describe('정적 grep 가드 — http.ts wiring 정합', () => {
    function loadHttp(): string {
      return readFileSync(resolve(__dirname, 'http.ts'), 'utf8');
    }
    it('formatKisPriorityBudgetLog 직접 호출 0건 (throttled 위임 의무)', () => {
      const src = loadHttp();
      // throttled 버전만 사용 — base format 직접 console.warn 호출 영구 차단
      const baseMatches = src.match(/console\.(warn|info|log|error)\([^)]*formatKisPriorityBudgetLog\(/g);
      expect(baseMatches).toBeNull();
    });
    it('formatDataVacuumRootCauseLog 직접 호출 0건 (throttled 위임 의무)', () => {
      const src = loadHttp();
      const baseMatches = src.match(/console\.(warn|info|log|error)\([^)]*formatDataVacuumRootCauseLog\(/g);
      expect(baseMatches).toBeNull();
    });
    it('formatKisPriorityBudgetLogThrottled 호출 최소 1건', () => {
      const src = loadHttp();
      expect(src).toContain('formatKisPriorityBudgetLogThrottled');
    });
    it('formatDataVacuumRootCauseLogThrottled 호출 최소 1건', () => {
      const src = loadHttp();
      expect(src).toContain('formatDataVacuumRootCauseLogThrottled');
    });
    it('shouldEmitTtlDedupLog TTL_DEDUP_DUPLICATE 분기 wiring', () => {
      const src = loadHttp();
      expect(src).toContain('shouldEmitTtlDedupLog');
    });
  });
});

describe('Patch-004 log throttle — DATA_VACUUM root cause (dataVacuumRootCauseClassifierPatch004.ts)', () => {
  const originalEnv = { ...process.env };
  beforeEach(() => {
    __resetDataVacuumLogThrottleStateForTests();
    delete process.env.DATA_VACUUM_LOG_THROTTLE_DISABLED;
  });
  afterEach(() => {
    process.env = { ...originalEnv };
  });

  describe('ENV gate (ADR-0157 정확 비교)', () => {
    it('default OFF — throttle 활성', () => {
      expect(isDataVacuumLogThrottleDisabled()).toBe(false);
    });
    it('=== "true" 시 throttle 비활성', () => {
      process.env.DATA_VACUUM_LOG_THROTTLE_DISABLED = 'true';
      expect(isDataVacuumLogThrottleDisabled()).toBe(true);
    });
    it("'1' / 'TRUE' / 'yes' / 빈값 모두 default 동작", () => {
      for (const v of ['1', 'TRUE', 'yes', '']) {
        process.env.DATA_VACUUM_LOG_THROTTLE_DISABLED = v;
        expect(isDataVacuumLogThrottleDisabled()).toBe(false);
      }
    });
  });

  describe('shouldEmitDataVacuumLog — rootCause+priority+trId 별 60s window', () => {
    it('첫 호출 → emit=true', () => {
      const r = shouldEmitDataVacuumLog('KIS_TR_THROTTLED', 1_000_000);
      expect(r.emit).toBe(true);
      expect(r.suppressedSinceLast).toBe(0);
      expect(r.windowMs).toBe(60_000);
    });
    it('60s 내 후속 → emit=false + 카운트', () => {
      const t0 = 2_000_000;
      shouldEmitDataVacuumLog('KIS_TR_THROTTLED', t0);
      const r1 = shouldEmitDataVacuumLog('KIS_TR_THROTTLED', t0 + 5_000);
      const r2 = shouldEmitDataVacuumLog('KIS_TR_THROTTLED', t0 + 10_000);
      expect(r1.emit).toBe(false);
      expect(r1.suppressedSinceLast).toBe(1);
      expect(r2.emit).toBe(false);
      expect(r2.suppressedSinceLast).toBe(2);
    });
    it('60s 경과 후 → emit=true + suppressedSinceLast=누적', () => {
      const t0 = 3_000_000;
      shouldEmitDataVacuumLog('KIS_TR_THROTTLED', t0);
      shouldEmitDataVacuumLog('KIS_TR_THROTTLED', t0 + 5_000);
      const r = shouldEmitDataVacuumLog('KIS_TR_THROTTLED', t0 + 60_001);
      expect(r.emit).toBe(true);
      expect(r.suppressedSinceLast).toBe(1);
    });
    it('rootCause 다른 키는 독립', () => {
      const t0 = 4_000_000;
      const r1 = shouldEmitDataVacuumLog('KIS_TR_THROTTLED', t0);
      const r2 = shouldEmitDataVacuumLog('KIS_SERVER_ERROR_WITH_CACHE', t0);
      const r3 = shouldEmitDataVacuumLog('UPSTREAM_CANDIDATE_HYDRATION_FAILED', t0);
      expect(r1.emit).toBe(true);
      expect(r2.emit).toBe(true);
      expect(r3.emit).toBe(true);
    });

    it('rootCause 같아도 priority+trId 가 다르면 독립', () => {
      const t0 = 4_500_000;
      const r1 = shouldEmitDataVacuumLog('KIS_SERVER_ERROR_NO_CACHE', t0, 'P2_READY_CANDIDATE_CONFIRM', 'TR-A');
      const r2 = shouldEmitDataVacuumLog('KIS_SERVER_ERROR_NO_CACHE', t0 + 1_000, 'P2_READY_CANDIDATE_CONFIRM', 'TR-A');
      const r3 = shouldEmitDataVacuumLog('KIS_SERVER_ERROR_NO_CACHE', t0 + 1_000, 'P2_READY_CANDIDATE_CONFIRM', 'TR-B');
      const r4 = shouldEmitDataVacuumLog('KIS_SERVER_ERROR_NO_CACHE', t0 + 1_000, 'P1_SHADOW_POSITION_MANAGEMENT', 'TR-A');
      expect(r1.emit).toBe(true);
      expect(r2.emit).toBe(false);
      expect(r3.emit).toBe(true);
      expect(r4.emit).toBe(true);
    });
    it('ENV DISABLED 시 항상 emit=true', () => {
      process.env.DATA_VACUUM_LOG_THROTTLE_DISABLED = 'true';
      const t0 = 5_000_000;
      const r1 = shouldEmitDataVacuumLog('KIS_TR_THROTTLED', t0);
      const r2 = shouldEmitDataVacuumLog('KIS_TR_THROTTLED', t0 + 1_000);
      const r3 = shouldEmitDataVacuumLog('KIS_TR_THROTTLED', t0 + 2_000);
      expect(r1.emit).toBe(true);
      expect(r2.emit).toBe(true);
      expect(r3.emit).toBe(true);
    });
  });

  describe('formatDataVacuumRootCauseLogThrottled — suppress 시 null', () => {
    function makeClassification() {
      return classifyDataVacuumRootCause(
        {
          throttleLevel: 'HARD',
          circuitState: 'OPEN',
          hasRecent5xx: false,
          cacheAvailable: false,
          upstreamHydrationFailed: false,
        },
        1_000_000,
      );
    }
    it('첫 호출 → format 문자열 + suffix 없음', () => {
      const c = makeClassification();
      const log = formatDataVacuumRootCauseLogThrottled(c, 1_000_000);
      expect(log).not.toBeNull();
      expect(log!).toContain('[DATA_VACUUM_ROOT_CAUSE]');
      expect(log!).toContain(`rootCause=${c.rootCause}`);
      expect(log!).not.toContain('suppressedCount=');
    });
    it('60s 내 후속 → null', () => {
      const c = makeClassification();
      formatDataVacuumRootCauseLogThrottled(c, 1_000_000);
      expect(formatDataVacuumRootCauseLogThrottled(c, 1_001_000)).toBeNull();
      expect(formatDataVacuumRootCauseLogThrottled(c, 1_010_000)).toBeNull();
    });
    it('60s 경과 후 → emit + suppressedCount suffix', () => {
      const c = makeClassification();
      formatDataVacuumRootCauseLogThrottled(c, 1_000_000); // emit
      formatDataVacuumRootCauseLogThrottled(c, 1_001_000); // suppress 1
      formatDataVacuumRootCauseLogThrottled(c, 1_002_000); // suppress 2
      formatDataVacuumRootCauseLogThrottled(c, 1_003_000); // suppress 3
      const log = formatDataVacuumRootCauseLogThrottled(c, 1_060_001);
      expect(log).not.toBeNull();
      expect(log!).toContain('suppressedSinceLastMs=60000');
      expect(log!).toContain('suppressedCount=3');
    });
    it('base format 그대로 보존', () => {
      const c = makeClassification();
      const base = formatDataVacuumRootCauseLog(c);
      const throttled = formatDataVacuumRootCauseLogThrottled(c, 1_000_000);
      expect(throttled).toBe(base);
    });
  });
});

describe('Patch-004 throttle hotfix — 정적 안전 invariants', () => {
  function loadHttp(): string {
    return readFileSync(resolve(__dirname, 'http.ts'), 'utf8');
  }

  it('http.ts 가 KIS 주문 함수 5종 import 0건 (절대 규칙 #2/#3/#4)', () => {
    const src = loadHttp();
    // 주석 strip 후 코드 본체 검사
    const codeOnly = src
      .replace(/\/\*[\s\S]*?\*\//g, '')
      .split('\n')
      .map((line) => line.replace(/\/\/.*$/, ''))
      .join('\n');
    expect(codeOnly).not.toMatch(/\bplaceKisMarketOrder\b/);
    expect(codeOnly).not.toMatch(/\bplaceKisSellOrder\b/);
    expect(codeOnly).not.toMatch(/\bcancelKisOrder\b/);
    expect(codeOnly).not.toMatch(/\bplaceKisStopLossOrder\b/);
    expect(codeOnly).not.toMatch(/\bplaceKisTakeProfitOrder\b/);
  });

  it('http.ts 가 autoTradeEngine / orderExecutor / trancheExecutor import 0건', () => {
    const src = loadHttp();
    const codeOnly = src
      .replace(/\/\*[\s\S]*?\*\//g, '')
      .split('\n')
      .map((line) => line.replace(/\/\/.*$/, ''))
      .join('\n');
    expect(codeOnly).not.toMatch(/from\s+['"][^'"]*autoTradeEngine[^'"]*['"]/);
    expect(codeOnly).not.toMatch(/from\s+['"][^'"]*orderExecutor[^'"]*['"]/);
    expect(codeOnly).not.toMatch(/from\s+['"][^'"]*trancheExecutor[^'"]*['"]/);
  });

  it('Patch-004 throttle hotfix 추적 주석 명시', () => {
    const src = loadHttp();
    expect(src).toContain('Patch-004 throttle hotfix');
  });
});
