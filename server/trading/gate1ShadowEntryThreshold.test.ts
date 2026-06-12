// @responsibility ADR-0608 gate1ShadowEntryThreshold 회귀 테스트 — ENV OFF byte-equivalent + ENV ON SHADOW regime-aware + LIVE 무변경 + 라벨 정합 검증

import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  isGate1RegimeAwareShadowEntryEnabled,
  resolveEntryMinGateScore,
} from './gate1ShadowEntryThreshold.js';
import { getMinGateScore } from './entryEngine.js';
import {
  getEffectiveGateThreshold,
  clearRuntimeThresholdDelta,
} from './gateConfig.js';

const ENV_KEY = 'GATE1_REGIME_AWARE_SHADOW_ENTRY_ENABLED';

// 테스트 대상 레짐 — R3_EARLY(normal:4) 가 핵심(ADR-0608 [regime,legacy) 구간 예시).
const REGIMES = ['R1_TURBO', 'R2_BULL', 'R3_EARLY', 'R4_NEUTRAL', 'R5_CAUTION', 'R6_DEFENSE', undefined];

describe('gate1ShadowEntryThreshold — ADR-0608', () => {
  let savedEnv: string | undefined;

  beforeEach(() => {
    savedEnv = process.env[ENV_KEY];
    delete process.env[ENV_KEY];
    clearRuntimeThresholdDelta(); // 런타임 delta 격리 — getMinGateScore/getEffectiveGateThreshold 베이스라인 동기.
  });

  afterEach(() => {
    if (savedEnv === undefined) delete process.env[ENV_KEY];
    else process.env[ENV_KEY] = savedEnv;
    clearRuntimeThresholdDelta();
  });

  describe('isGate1RegimeAwareShadowEntryEnabled — 정확 비교 default OFF', () => {
    it('미설정 → false', () => {
      delete process.env[ENV_KEY];
      expect(isGate1RegimeAwareShadowEntryEnabled()).toBe(false);
    });
    it("'true' → true", () => {
      process.env[ENV_KEY] = 'true';
      expect(isGate1RegimeAwareShadowEntryEnabled()).toBe(true);
    });
    it.each(['false', 'TRUE', '1', 'yes', ''])('비정확 값 %s → false', (v) => {
      process.env[ENV_KEY] = v;
      expect(isGate1RegimeAwareShadowEntryEnabled()).toBe(false);
    });
  });

  // (1) ENV OFF → resolveEntryMinGateScore == getMinGateScore byte-equivalent (LIVE/SHADOW 모두).
  describe('(1) ENV OFF — byte-equivalent (LIVE/SHADOW 모두 getMinGateScore + LEGACY)', () => {
    it.each(REGIMES)('regime=%s LIVE — getMinGateScore 1:1 + LEGACY', (regime) => {
      delete process.env[ENV_KEY];
      const r = resolveEntryMinGateScore({ regime, isShadow: false });
      expect(r.minGateScore).toBe(getMinGateScore(regime));
      expect(r.entryThresholdMode).toBe('LEGACY');
    });
    it.each(REGIMES)('regime=%s SHADOW — ENV OFF 면 SHADOW 도 getMinGateScore 1:1 + LEGACY', (regime) => {
      delete process.env[ENV_KEY];
      const r = resolveEntryMinGateScore({ regime, isShadow: true });
      expect(r.minGateScore).toBe(getMinGateScore(regime));
      expect(r.entryThresholdMode).toBe('LEGACY');
    });
  });

  // (2) ENV ON + isShadow → getEffectiveGateThreshold + REGIME_AWARE_SHADOW (R3_EARLY=4).
  describe('(2) ENV ON + isShadow — regime-aware (getEffectiveGateThreshold + REGIME_AWARE_SHADOW)', () => {
    beforeEach(() => { process.env[ENV_KEY] = 'true'; });

    it.each(REGIMES)('regime=%s SHADOW — getEffectiveGateThreshold + REGIME_AWARE_SHADOW', (regime) => {
      const r = resolveEntryMinGateScore({ regime, isShadow: true });
      expect(r.minGateScore).toBe(getEffectiveGateThreshold(regime));
      expect(r.entryThresholdMode).toBe('REGIME_AWARE_SHADOW');
    });

    it('R3_EARLY SHADOW → minGateScore === 4 ([4,5) 종목이 minGate 통과 가능)', () => {
      const r = resolveEntryMinGateScore({ regime: 'R3_EARLY', isShadow: true });
      expect(r.minGateScore).toBe(4);
      // score 4 인 종목: 4 < 4 === false → evaluateEntryRevalidation 의 minGate 검사 통과.
      // R4_NEUTRAL(=5)였다면 4 < 5 === true → 탈락. regime-aware 가 진입을 확대.
      const r4 = resolveEntryMinGateScore({ regime: 'R4_NEUTRAL', isShadow: true });
      expect(r4.minGateScore).toBe(5);
      expect(r.minGateScore).toBeLessThan(r4.minGateScore);
    });
  });

  // (3) ENV ON + LIVE(!isShadow) → getMinGateScore 무변경 + LEGACY (ENV 무관 LIVE 보존).
  describe('(3) ENV ON + LIVE(!isShadow) — getMinGateScore 무변경 + LEGACY', () => {
    beforeEach(() => { process.env[ENV_KEY] = 'true'; });

    it.each(REGIMES)('regime=%s LIVE — ENV ON 이어도 getMinGateScore 1:1 + LEGACY', (regime) => {
      const r = resolveEntryMinGateScore({ regime, isShadow: false });
      expect(r.minGateScore).toBe(getMinGateScore(regime));
      expect(r.entryThresholdMode).toBe('LEGACY');
    });

    it('LIVE 결과는 ENV ON/OFF 토글에 불변 (byte-equivalent 분리 seam)', () => {
      delete process.env[ENV_KEY];
      const off = resolveEntryMinGateScore({ regime: 'R3_EARLY', isShadow: false });
      process.env[ENV_KEY] = 'true';
      const on = resolveEntryMinGateScore({ regime: 'R3_EARLY', isShadow: false });
      expect(on).toEqual(off);
    });
  });

  // (4) entryThresholdMode 라벨 스탬프 — REGIME_AWARE_SHADOW 진입만 라벨, 그 외 LEGACY.
  describe('(4) entryThresholdMode 라벨 정합 — REGIME_AWARE_SHADOW 진입만 격리 라벨', () => {
    it('REGIME_AWARE_SHADOW 는 ENV ON && isShadow 조합에서만 발생', () => {
      const matrix: Array<[boolean, boolean, 'LEGACY' | 'REGIME_AWARE_SHADOW']> = [
        [false, false, 'LEGACY'],          // ENV OFF + LIVE
        [false, true, 'LEGACY'],           // ENV OFF + SHADOW
        [true, false, 'LEGACY'],           // ENV ON  + LIVE
        [true, true, 'REGIME_AWARE_SHADOW'], // ENV ON  + SHADOW
      ];
      for (const [envOn, isShadow, expected] of matrix) {
        if (envOn) process.env[ENV_KEY] = 'true'; else delete process.env[ENV_KEY];
        expect(resolveEntryMinGateScore({ regime: 'R3_EARLY', isShadow }).entryThresholdMode).toBe(expected);
      }
    });
  });

  // (5) 후방호환 — regime 미전달 graceful (하류 R4_NEUTRAL fallback, 라벨 정상).
  describe('(5) 후방호환 — regime 부재 graceful', () => {
    it('ENV OFF + regime undefined → getMinGateScore(undefined) + LEGACY', () => {
      delete process.env[ENV_KEY];
      const r = resolveEntryMinGateScore({ regime: undefined, isShadow: true });
      expect(r.minGateScore).toBe(getMinGateScore(undefined));
      expect(r.entryThresholdMode).toBe('LEGACY');
    });
    it('ENV ON + SHADOW + regime undefined → getEffectiveGateThreshold(undefined)=R4_NEUTRAL(5) + REGIME_AWARE_SHADOW', () => {
      process.env[ENV_KEY] = 'true';
      const r = resolveEntryMinGateScore({ regime: undefined, isShadow: true });
      expect(r.minGateScore).toBe(getEffectiveGateThreshold(undefined));
      expect(r.minGateScore).toBe(5); // R4_NEUTRAL fallback
      expect(r.entryThresholdMode).toBe('REGIME_AWARE_SHADOW');
    });
  });
});
