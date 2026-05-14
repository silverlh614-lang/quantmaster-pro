/**
 * Patch-KIS-CIRCUIT-OPEN-ENFORCEMENT-AND-DATA-EVAL-STATE-001 회귀 — circuit governor.
 *
 * 사용자 §"반드시 테스트" 10 시나리오 + 정적 grep 가드 + literal type 강제 정합.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  ENFORCEMENT_MATRIX,
  __resetKisCircuitGovernorStateForTests,
  evaluateCircuitEnforcement,
  formatKisCircuitEnforcementCompactLine,
  formatKisCircuitStateLog,
  formatKisReadyCandidateSkippedLog,
  isKisCircuitGovernorDisabled,
  mapTrCircuitStateToEnforcement,
  shouldEmitCircuitStateLog,
} from './kisCircuitStateGovernorPatch005.js';

const __dirname = dirname(fileURLToPath(import.meta.url));

describe('Patch-005 circuit governor — ENV gate (ADR-0157 정확 비교)', () => {
  const originalEnv = { ...process.env };
  beforeEach(() => {
    __resetKisCircuitGovernorStateForTests();
    delete process.env.KIS_CIRCUIT_GOVERNOR_PATCH_005_DISABLED;
  });
  afterEach(() => {
    process.env = { ...originalEnv };
  });

  it('default OFF', () => {
    expect(isKisCircuitGovernorDisabled()).toBe(false);
  });
  it('=== "true" 시 active', () => {
    process.env.KIS_CIRCUIT_GOVERNOR_PATCH_005_DISABLED = 'true';
    expect(isKisCircuitGovernorDisabled()).toBe(true);
  });
  it("'1' / 'TRUE' / 'yes' / 빈값 모두 default", () => {
    for (const v of ['1', 'TRUE', 'yes', '']) {
      process.env.KIS_CIRCUIT_GOVERNOR_PATCH_005_DISABLED = v;
      expect(isKisCircuitGovernorDisabled()).toBe(false);
    }
  });
});

describe('Patch-005 ENFORCEMENT_MATRIX — 4×5 매트릭스 SSOT', () => {
  it('CLOSED: 모든 priority 통과', () => {
    expect(ENFORCEMENT_MATRIX.CLOSED.P0_POSITION_EXIT).toBe('ALLOW');
    expect(ENFORCEMENT_MATRIX.CLOSED.P1_SHADOW_POSITION_MANAGEMENT).toBe('ALLOW');
    expect(ENFORCEMENT_MATRIX.CLOSED.P2_READY_CANDIDATE_CONFIRM).toBe('ALLOW_LIVE');
    expect(ENFORCEMENT_MATRIX.CLOSED.P3_SCAN_DIAGNOSTIC).toBe('ALLOW');
    expect(ENFORCEMENT_MATRIX.CLOSED.P4_TELEMETRY_VERBOSE).toBe('ALLOW');
  });

  it('SOFT_THROTTLED: P2 ALLOW_CACHE_ONLY + P3/P4 SUPPRESS', () => {
    expect(ENFORCEMENT_MATRIX.SOFT_THROTTLED.P0_POSITION_EXIT).toBe('ALLOW');
    expect(ENFORCEMENT_MATRIX.SOFT_THROTTLED.P1_SHADOW_POSITION_MANAGEMENT).toBe('ALLOW');
    expect(ENFORCEMENT_MATRIX.SOFT_THROTTLED.P2_READY_CANDIDATE_CONFIRM).toBe('ALLOW_CACHE_ONLY');
    expect(ENFORCEMENT_MATRIX.SOFT_THROTTLED.P3_SCAN_DIAGNOSTIC).toBe('SUPPRESS');
    expect(ENFORCEMENT_MATRIX.SOFT_THROTTLED.P4_TELEMETRY_VERBOSE).toBe('SUPPRESS');
  });

  it('OPEN: P2 SKIP_WITH_STALE_OR_BLOCK + P3/P4 SUPPRESS', () => {
    expect(ENFORCEMENT_MATRIX.OPEN.P0_POSITION_EXIT).toBe('ALLOW');
    expect(ENFORCEMENT_MATRIX.OPEN.P1_SHADOW_POSITION_MANAGEMENT).toBe('ALLOW');
    expect(ENFORCEMENT_MATRIX.OPEN.P2_READY_CANDIDATE_CONFIRM).toBe('SKIP_WITH_STALE_OR_BLOCK');
    expect(ENFORCEMENT_MATRIX.OPEN.P3_SCAN_DIAGNOSTIC).toBe('SUPPRESS');
    expect(ENFORCEMENT_MATRIX.OPEN.P4_TELEMETRY_VERBOSE).toBe('SUPPRESS');
  });

  it('HARD_OPEN: P0 ALLOW_LIMITED + P1 SKIP + P2~P4 차단', () => {
    expect(ENFORCEMENT_MATRIX.HARD_OPEN.P0_POSITION_EXIT).toBe('ALLOW_LIMITED');
    expect(ENFORCEMENT_MATRIX.HARD_OPEN.P1_SHADOW_POSITION_MANAGEMENT).toBe('SKIP');
    expect(ENFORCEMENT_MATRIX.HARD_OPEN.P2_READY_CANDIDATE_CONFIRM).toBe('SKIP_WITH_STALE_OR_BLOCK');
    expect(ENFORCEMENT_MATRIX.HARD_OPEN.P3_SCAN_DIAGNOSTIC).toBe('SUPPRESS');
    expect(ENFORCEMENT_MATRIX.HARD_OPEN.P4_TELEMETRY_VERBOSE).toBe('SUPPRESS');
  });

  it('Object.freeze drift 가드', () => {
    expect(() => {
      // @ts-expect-error — runtime freeze 검증
      ENFORCEMENT_MATRIX.CLOSED.P0_POSITION_EXIT = 'SKIP';
    }).toThrow();
  });
});

describe('Patch-005 mapTrCircuitStateToEnforcement — 5-state → 4-state SSOT', () => {
  it('CLOSED + NONE → CLOSED', () => {
    expect(mapTrCircuitStateToEnforcement('CLOSED', 'NONE')).toBe('CLOSED');
  });
  it('CLOSED_RECOVERED → CLOSED', () => {
    expect(mapTrCircuitStateToEnforcement('CLOSED_RECOVERED', 'NONE')).toBe('CLOSED');
  });
  it('SOFT_THROTTLED → SOFT_THROTTLED', () => {
    expect(mapTrCircuitStateToEnforcement('SOFT_THROTTLED', 'SOFT')).toBe('SOFT_THROTTLED');
  });
  it('HARD throttle → OPEN (격상)', () => {
    expect(mapTrCircuitStateToEnforcement('CLOSED', 'HARD')).toBe('OPEN');
  });
  it('CIRCUIT_OPEN level → OPEN', () => {
    expect(mapTrCircuitStateToEnforcement('CLOSED', 'CIRCUIT_OPEN')).toBe('OPEN');
  });
  it('OPEN → OPEN', () => {
    expect(mapTrCircuitStateToEnforcement('OPEN', 'NONE')).toBe('OPEN');
  });
  it('HALF_OPEN → OPEN (보수적)', () => {
    expect(mapTrCircuitStateToEnforcement('HALF_OPEN', 'NONE')).toBe('OPEN');
  });
  it('recent5xxBurst=true → HARD_OPEN', () => {
    expect(mapTrCircuitStateToEnforcement('CLOSED', 'NONE', { recent5xxBurst: true })).toBe('HARD_OPEN');
  });
  it('distinctOpenTrIds>=3 → HARD_OPEN', () => {
    expect(mapTrCircuitStateToEnforcement('OPEN', 'NONE', { distinctOpenTrIds: 3 })).toBe('HARD_OPEN');
    expect(mapTrCircuitStateToEnforcement('OPEN', 'NONE', { distinctOpenTrIds: 5 })).toBe('HARD_OPEN');
  });
  it('distinctOpenTrIds<3 → OPEN 그대로', () => {
    expect(mapTrCircuitStateToEnforcement('OPEN', 'NONE', { distinctOpenTrIds: 2 })).toBe('OPEN');
  });
});

describe('Patch-005 evaluateCircuitEnforcement — 사용자 §"반드시 테스트" 10 시나리오', () => {
  const originalEnv = { ...process.env };
  beforeEach(() => {
    __resetKisCircuitGovernorStateForTests();
    delete process.env.KIS_CIRCUIT_GOVERNOR_PATCH_005_DISABLED;
  });
  afterEach(() => {
    process.env = { ...originalEnv };
  });

  // 1. circuit open 상태에서 READY_CANDIDATE 가 deferred queue 에 쌓이지 않는가
  it('§1: OPEN + P2 → SKIP_WITH_STALE_OR_BLOCK + deferredQueued=false (literal)', () => {
    const d = evaluateCircuitEnforcement({
      trId: 'FHKST01010100',
      symbol: '005930',
      priority: 'P2_READY_CANDIDATE_CONFIRM',
      trCircuitState: 'OPEN',
      throttleLevel: 'CIRCUIT_OPEN',
      cacheAvailable: false,
    });
    expect(d.action).toBe('SKIP_WITH_STALE_OR_BLOCK');
    expect(d.deferredQueued).toBe(false);
    expect(d.allowed).toBe(false);
    expect(d.executionImpact).toBe('NEW_BUY_BLOCKED_ONLY');
    expect(d.blockingReason).toBe('CIRCUIT_OPEN_NEW_BUY_BLOCKED');
  });

  // 2. circuit open 상태에서 P2 신규 KIS live call 이 발생하지 않는가
  it('§2: OPEN + P2 → newKisCallsAllowed=false', () => {
    const d = evaluateCircuitEnforcement({
      trId: 'FHKST01010100',
      symbol: '005930',
      priority: 'P2_READY_CANDIDATE_CONFIRM',
      trCircuitState: 'OPEN',
      throttleLevel: 'NONE',
      cacheAvailable: false,
    });
    expect(d.newKisCallsAllowed).toBe(false);
  });

  // 3. P0 position exit 는 계속 허용되는가
  it('§3: 모든 state 에서 P0 → ALLOW or ALLOW_LIMITED (절대 보호)', () => {
    for (const state of ['CLOSED', 'SOFT_THROTTLED', 'OPEN'] as const) {
      const d = evaluateCircuitEnforcement({
        trId: 'TTTC0801U',
        symbol: '005930',
        priority: 'P0_POSITION_EXIT',
        trCircuitState: state,
        throttleLevel: 'NONE',
        cacheAvailable: false,
      });
      expect(d.allowed).toBe(true);
    }
    // HARD_OPEN 도 ALLOW_LIMITED 로 허용
    const d = evaluateCircuitEnforcement({
      trId: 'TTTC0801U',
      symbol: '005930',
      priority: 'P0_POSITION_EXIT',
      trCircuitState: 'OPEN',
      throttleLevel: 'NONE',
      cacheAvailable: false,
      recent5xxBurst: true,
    });
    expect(d.enforcementState).toBe('HARD_OPEN');
    expect(d.action).toBe('ALLOW_LIMITED');
    expect(d.allowed).toBe(true);
  });

  // 4. P1 shadow position management 는 계속 허용되는가
  it('§4: P1 → ALLOW in CLOSED/SOFT/OPEN, SKIP in HARD_OPEN', () => {
    const d1 = evaluateCircuitEnforcement({
      trId: 'TR_SHADOW',
      symbol: '005930',
      priority: 'P1_SHADOW_POSITION_MANAGEMENT',
      trCircuitState: 'OPEN',
      throttleLevel: 'NONE',
      cacheAvailable: false,
    });
    expect(d1.allowed).toBe(true);
    expect(d1.action).toBe('ALLOW');

    const d2 = evaluateCircuitEnforcement({
      trId: 'TR_SHADOW',
      symbol: '005930',
      priority: 'P1_SHADOW_POSITION_MANAGEMENT',
      trCircuitState: 'OPEN',
      throttleLevel: 'NONE',
      cacheAvailable: false,
      recent5xxBurst: true,
    });
    expect(d2.enforcementState).toBe('HARD_OPEN');
    expect(d2.action).toBe('SKIP');
    expect(d2.allowed).toBe(false);
    expect(d2.blockingReason).toBe('HARD_OPEN_GLOBAL_BLOCK');
  });

  // 5. P3/P4 는 SUPPRESS_DIAGNOSTIC_ONLY 로 유지되는가
  it('§5: P3/P4 → SUPPRESS in SOFT_THROTTLED/OPEN/HARD_OPEN', () => {
    for (const state of ['SOFT_THROTTLED', 'OPEN'] as const) {
      const d3 = evaluateCircuitEnforcement({
        trId: 'TR_DIAG',
        symbol: '005930',
        priority: 'P3_SCAN_DIAGNOSTIC',
        trCircuitState: state,
        throttleLevel: state === 'SOFT_THROTTLED' ? 'SOFT' : 'CIRCUIT_OPEN',
        cacheAvailable: false,
      });
      expect(d3.action).toBe('SUPPRESS');
      expect(d3.allowed).toBe(false);

      const d4 = evaluateCircuitEnforcement({
        trId: 'TR_TELEMETRY',
        symbol: '005930',
        priority: 'P4_TELEMETRY_VERBOSE',
        trCircuitState: state,
        throttleLevel: state === 'SOFT_THROTTLED' ? 'SOFT' : 'CIRCUIT_OPEN',
        cacheAvailable: false,
      });
      expect(d4.action).toBe('SUPPRESS');
    }
  });

  it('SOFT_THROTTLED + P2 + cache hit → ALLOW_CACHE_ONLY', () => {
    const d = evaluateCircuitEnforcement({
      trId: 'FHKST01010100',
      symbol: '005930',
      priority: 'P2_READY_CANDIDATE_CONFIRM',
      trCircuitState: 'SOFT_THROTTLED',
      throttleLevel: 'SOFT',
      cacheAvailable: true,
    });
    expect(d.action).toBe('ALLOW_CACHE_ONLY');
    expect(d.blockingReason).toBe('CIRCUIT_OPEN_CACHE_ONLY');
    expect(d.newKisCallsAllowed).toBe(false);
  });

  it('SOFT_THROTTLED + P2 + cache miss → SKIP_WITH_STALE_OR_BLOCK', () => {
    const d = evaluateCircuitEnforcement({
      trId: 'FHKST01010100',
      symbol: '005930',
      priority: 'P2_READY_CANDIDATE_CONFIRM',
      trCircuitState: 'SOFT_THROTTLED',
      throttleLevel: 'SOFT',
      cacheAvailable: false,
    });
    expect(d.action).toBe('SKIP_WITH_STALE_OR_BLOCK');
    expect(d.blockingReason).toBe('CIRCUIT_OPEN_NEW_BUY_BLOCKED');
  });

  it('ENV DISABLED → ALLOW (PR #965/#967 동작 복원)', () => {
    process.env.KIS_CIRCUIT_GOVERNOR_PATCH_005_DISABLED = 'true';
    const d = evaluateCircuitEnforcement({
      trId: 'FHKST01010100',
      symbol: '005930',
      priority: 'P2_READY_CANDIDATE_CONFIRM',
      trCircuitState: 'OPEN',
      throttleLevel: 'CIRCUIT_OPEN',
      cacheAvailable: false,
    });
    expect(d.allowed).toBe(true);
    expect(d.action).toBe('ALLOW');
    expect(d.enforcementState).toBe('CLOSED');
  });

  it('literal type contract — 모든 decision 에 invariant 필드 강제', () => {
    const d = evaluateCircuitEnforcement({
      trId: 'TR_X',
      symbol: '005930',
      priority: 'P2_READY_CANDIDATE_CONFIRM',
      trCircuitState: 'OPEN',
      throttleLevel: 'CIRCUIT_OPEN',
      cacheAvailable: false,
    });
    expect(d.marketSignal).toBe(false);
    expect(d.engineAlive).toBe(true);
    expect(d.shadowLearning).toBe(true);
    expect(d.deferredQueued).toBe(false);
  });
});

describe('Patch-005 formatKisCircuitStateLog — 사용자 §"기대 로그" 정확 형식', () => {
  it('OPEN state log 형식', () => {
    const d = evaluateCircuitEnforcement({
      trId: 'TR_X',
      symbol: '005930',
      priority: 'P2_READY_CANDIDATE_CONFIRM',
      trCircuitState: 'OPEN',
      throttleLevel: 'CIRCUIT_OPEN',
      cacheAvailable: false,
    });
    const log = formatKisCircuitStateLog(d);
    expect(log).toContain('[KIS_CIRCUIT_STATE]');
    expect(log).toContain('state=OPEN');
    expect(log).toContain('allowedPriorities=P0_POSITION_EXIT,P1_SHADOW_POSITION_MANAGEMENT');
    expect(log).toContain('blockedPriorities=P2_READY_CANDIDATE_CONFIRM,P3_SCAN_DIAGNOSTIC,P4_TELEMETRY_VERBOSE');
    expect(log).toContain('newKisCallsAllowed=false');
  });

  it('READY_CANDIDATE_SKIPPED 로그 형식', () => {
    const d = evaluateCircuitEnforcement({
      trId: 'TR_X',
      symbol: '005930',
      priority: 'P2_READY_CANDIDATE_CONFIRM',
      trCircuitState: 'OPEN',
      throttleLevel: 'CIRCUIT_OPEN',
      cacheAvailable: true,
    });
    const log = formatKisReadyCandidateSkippedLog(d);
    expect(log).toContain('[KIS_READY_CANDIDATE_SKIPPED]');
    expect(log).toContain('reason=CIRCUIT_OPEN_SKIP_WITH_STALE');
    expect(log).toContain('deferred=false');
    expect(log).toContain('queued=false');
    expect(log).toContain('executionImpact=NEW_BUY_BLOCKED_ONLY');
    expect(log).toContain('shadowLearning=true');
  });

  it('compact line 형식', () => {
    const line = formatKisCircuitEnforcementCompactLine('HARD_OPEN');
    expect(line).toContain('[PATCH-RUNTIME] (Patch-005)');
    expect(line).toContain('state=HARD_OPEN');
    expect(line).toContain('marketSignal=false');
    expect(line).toContain('executionImpact=NONE');
  });
});

describe('Patch-005 shouldEmitCircuitStateLog — state 전이 + 60s window throttle', () => {
  beforeEach(() => {
    __resetKisCircuitGovernorStateForTests();
  });

  it('첫 호출 → emit=true + stateChanged=true', () => {
    const r = shouldEmitCircuitStateLog('TR_X', 'OPEN', 1_000_000);
    expect(r.emit).toBe(true);
    expect(r.stateChanged).toBe(true);
  });

  it('동일 state 60s 내 후속 → emit=false', () => {
    shouldEmitCircuitStateLog('TR_X', 'OPEN', 1_000_000);
    const r = shouldEmitCircuitStateLog('TR_X', 'OPEN', 1_005_000);
    expect(r.emit).toBe(false);
    expect(r.suppressedSinceLast).toBe(1);
  });

  it('state 전이 → 즉시 emit (60s 무관)', () => {
    shouldEmitCircuitStateLog('TR_X', 'OPEN', 1_000_000);
    const r = shouldEmitCircuitStateLog('TR_X', 'HARD_OPEN', 1_010_000);
    expect(r.emit).toBe(true);
    expect(r.stateChanged).toBe(true);
  });

  it('60s 경과 후 동일 state → emit + suppressedCount', () => {
    shouldEmitCircuitStateLog('TR_X', 'OPEN', 1_000_000);
    shouldEmitCircuitStateLog('TR_X', 'OPEN', 1_010_000); // suppress 1
    shouldEmitCircuitStateLog('TR_X', 'OPEN', 1_020_000); // suppress 2
    const r = shouldEmitCircuitStateLog('TR_X', 'OPEN', 1_060_001);
    expect(r.emit).toBe(true);
    expect(r.suppressedSinceLast).toBe(2);
  });
});

describe('Patch-005 정적 grep 가드', () => {
  function loadSrc(rel: string): string {
    return readFileSync(resolve(__dirname, rel), 'utf8');
  }

  it('kisCircuitStateGovernorPatch005 — KIS 주문 함수 5종 import 0건', () => {
    const src = loadSrc('kisCircuitStateGovernorPatch005.ts');
    const codeOnly = src.replace(/\/\*[\s\S]*?\*\//g, '').split('\n').map((l) => l.replace(/\/\/.*$/, '')).join('\n');
    expect(codeOnly).not.toMatch(/\bplaceKisMarketOrder\b/);
    expect(codeOnly).not.toMatch(/\bplaceKisSellOrder\b/);
    expect(codeOnly).not.toMatch(/\bcancelKisOrder\b/);
    expect(codeOnly).not.toMatch(/\bplaceKisStopLossOrder\b/);
    expect(codeOnly).not.toMatch(/\bplaceKisTakeProfitOrder\b/);
  });

  it('kisCircuitStateGovernorPatch005 — autoTradeEngine / orderExecutor / trancheExecutor import 0건', () => {
    const src = loadSrc('kisCircuitStateGovernorPatch005.ts');
    expect(src).not.toMatch(/from\s+['"][^'"]*autoTradeEngine[^'"]*['"]/);
    expect(src).not.toMatch(/from\s+['"][^'"]*orderExecutor[^'"]*['"]/);
    expect(src).not.toMatch(/from\s+['"][^'"]*trancheExecutor[^'"]*['"]/);
  });

  it('kisCircuitStateGovernorPatch005 — fetch/axios/node-fetch import 0건', () => {
    const src = loadSrc('kisCircuitStateGovernorPatch005.ts');
    const codeOnly = src.replace(/\/\*[\s\S]*?\*\//g, '').split('\n').map((l) => l.replace(/\/\/.*$/, '')).join('\n');
    expect(codeOnly).not.toMatch(/from\s+['"]axios['"]/);
    expect(codeOnly).not.toMatch(/from\s+['"]node-fetch['"]/);
  });

  it('errorTaxonomy.ts KisTrCircuitStateName union 본체 무수정', () => {
    const src = loadSrc('errorTaxonomy.ts');
    expect(src).toContain("export type KisTrCircuitStateName = 'CLOSED' | 'SOFT_THROTTLED' | 'OPEN' | 'HALF_OPEN' | 'CLOSED_RECOVERED'");
  });

  it('http.ts — Patch-005 wiring import 의무', () => {
    const src = loadSrc('http.ts');
    expect(src).toContain('evaluateCircuitEnforcement');
    expect(src).toContain('formatKisCircuitStateLog');
    expect(src).toContain('formatKisReadyCandidateSkippedLog');
    expect(src).toContain('lookupKisTrResultCache');
    expect(src).toContain('storeKisTrResultCache');
  });

  it('http.ts — READY_CANDIDATE deferred queue 적재 차단 정합 (P2 SKIP_WITH_STALE_OR_BLOCK 경로)', () => {
    const src = loadSrc('http.ts');
    // Patch-005 enforcement 분기 안에서 SKIP_WITH_STALE_OR_BLOCK 분기 존재
    // (P2 OPEN/HARD_OPEN → deferred queue 적재 영구 금지, governor SSOT 의 deferredQueued: false literal 로 컴파일 타임 강제)
    expect(src).toContain('SKIP_WITH_STALE_OR_BLOCK');
    expect(src).toMatch(/deferred queue/);
  });
});
