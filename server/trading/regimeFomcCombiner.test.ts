/**
 * @responsibility regimeFomcCombiner (ADR-0076 옵션 C) Regime+FOMC Kelly 결합 SSOT 단위 테스트
 */

import { describe, it, expect, afterEach } from 'vitest';
import {
  combineRegimeAndFomcKelly,
  describeRegimeFomcCombination,
} from './regimeFomcCombiner.js';

describe('combineRegimeAndFomcKelly (ADR-0076 옵션 C)', () => {
  const originalEnv = process.env.FOMC_REGIME_OVERRIDE_DISABLED;
  afterEach(() => {
    if (originalEnv === undefined) delete process.env.FOMC_REGIME_OVERRIDE_DISABLED;
    else process.env.FOMC_REGIME_OVERRIDE_DISABLED = originalEnv;
  });

  // ── R6_DEFENSE 절대 우선 ──────────────────────────────────────────────
  describe('R6_OVERRIDE: R6_DEFENSE 시 0 강제 (FOMC 무관)', () => {
    it('FOMC NORMAL + R6_DEFENSE → 0 (R6_OVERRIDE)', () => {
      const r = combineRegimeAndFomcKelly(0, 1.0, 'NORMAL', 'R6_DEFENSE');
      expect(r.value).toBe(0);
      expect(r.source).toBe('R6_OVERRIDE');
    });

    it('FOMC PRE_1 (0.75) + R6_DEFENSE → 0 (R6 우선, FOMC 0.75 무시)', () => {
      const r = combineRegimeAndFomcKelly(0, 0.75, 'PRE_1', 'R6_DEFENSE');
      expect(r.value).toBe(0);
      expect(r.source).toBe('R6_OVERRIDE');
    });

    it('FOMC POST_1 (1.30) + R6_DEFENSE → 0 (R6 우선, 부스트 무시)', () => {
      const r = combineRegimeAndFomcKelly(0, 1.30, 'POST_1', 'R6_DEFENSE');
      expect(r.value).toBe(0);
      expect(r.source).toBe('R6_OVERRIDE');
    });

    it('R6_DEFENSE 진단 메시지에 "매수 차단" 포함', () => {
      const r = combineRegimeAndFomcKelly(0, 0.75, 'PRE_1', 'R6_DEFENSE');
      expect(r.reason).toContain('R6_DEFENSE');
      expect(r.reason).toContain('매수 차단');
    });
  });

  // ── FOMC NORMAL: regime 만 ────────────────────────────────────────────
  describe('REGIME: FOMC NORMAL 시 regimeKelly 만', () => {
    it('FOMC NORMAL + R2_BULL (0.8) → 0.8', () => {
      const r = combineRegimeAndFomcKelly(0.8, 1.0, 'NORMAL', 'R2_BULL');
      expect(r.value).toBe(0.8);
      expect(r.source).toBe('REGIME');
    });

    it('FOMC NORMAL + R5_CAUTION (0.3) → 0.3', () => {
      const r = combineRegimeAndFomcKelly(0.3, 1.0, 'NORMAL', 'R5_CAUTION');
      expect(r.value).toBe(0.3);
      expect(r.source).toBe('REGIME');
    });

    it('FOMC NORMAL + R1_TURBO (1.0) → 1.0', () => {
      const r = combineRegimeAndFomcKelly(1.0, 1.0, 'NORMAL', 'R1_TURBO');
      expect(r.value).toBe(1.0);
      expect(r.source).toBe('REGIME');
    });

    it('REGIME 진단 메시지에 "FOMC 비활성" 포함', () => {
      const r = combineRegimeAndFomcKelly(0.8, 1.0, 'NORMAL', 'R2_BULL');
      expect(r.reason).toContain('R2_BULL');
      expect(r.reason).toContain('FOMC 비활성');
    });
  });

  // ── FOMC 활성: FOMC 우선 (regime 무시) ───────────────────────────────
  describe('FOMC: FOMC 활성 시 fomcKelly 만 (regime 무시)', () => {
    it('FOMC PRE_3 (0.75) + R2_BULL (0.8) → 0.75 (FOMC 우선, R2 무시) — 사용자 시나리오', () => {
      const r = combineRegimeAndFomcKelly(0.8, 0.75, 'PRE_3', 'R2_BULL');
      expect(r.value).toBe(0.75);
      expect(r.source).toBe('FOMC');
      // 기존 곱셈은 0.6 — 사용자 의도와 다름. 새 결합은 0.75 (75% 사이즈 정확히 적용)
    });

    it('FOMC PRE_2 (0.75) + R2_BULL (0.8) → 0.75 (v4 균일 적용)', () => {
      const r = combineRegimeAndFomcKelly(0.8, 0.75, 'PRE_2', 'R2_BULL');
      expect(r.value).toBe(0.75);
      expect(r.source).toBe('FOMC');
    });

    it('FOMC PRE_1 (0.75) + R5_CAUTION (0.3) → 0.75 (FOMC 우선, R5 무시)', () => {
      const r = combineRegimeAndFomcKelly(0.3, 0.75, 'PRE_1', 'R5_CAUTION');
      expect(r.value).toBe(0.75);
      expect(r.source).toBe('FOMC');
    });

    it('FOMC DAY (0) + R2_BULL (0.8) → 0 (FOMC DAY 차단)', () => {
      const r = combineRegimeAndFomcKelly(0.8, 0, 'DAY', 'R2_BULL');
      expect(r.value).toBe(0);
      expect(r.source).toBe('FOMC');
    });

    it('FOMC POST_1 (1.30) + R2_BULL (0.8) → 1.30 (FOMC 부스트, R2 무시)', () => {
      const r = combineRegimeAndFomcKelly(0.8, 1.30, 'POST_1', 'R2_BULL');
      expect(r.value).toBe(1.30);
      expect(r.source).toBe('FOMC');
    });

    it('FOMC POST_1 (1.30) + R5_CAUTION (0.3) → 1.30 (FOMC 부스트, R5 무시 — 운영자 인지 필요)', () => {
      const r = combineRegimeAndFomcKelly(0.3, 1.30, 'POST_1', 'R5_CAUTION');
      expect(r.value).toBe(1.30);
      expect(r.source).toBe('FOMC');
    });

    it('FOMC POST_2 (1.15) + R3_EARLY (0.7) → 1.15 (FOMC 부스트)', () => {
      const r = combineRegimeAndFomcKelly(0.7, 1.15, 'POST_2', 'R3_EARLY');
      expect(r.value).toBe(1.15);
      expect(r.source).toBe('FOMC');
    });

    it('FOMC 진단 메시지에 "FOMC <phase>" + "<regime> 무시" 포함', () => {
      const r = combineRegimeAndFomcKelly(0.8, 0.75, 'PRE_1', 'R2_BULL');
      expect(r.reason).toContain('FOMC PRE_1');
      expect(r.reason).toContain('우선');
      expect(r.reason).toContain('R2_BULL');
      expect(r.reason).toContain('무시');
    });
  });

  // ── ENV 롤백 (LEGACY 곱셈 복원) ──────────────────────────────────────
  describe('LEGACY_PRODUCT: FOMC_REGIME_OVERRIDE_DISABLED=true 시 기존 곱셈 패턴', () => {
    it('FOMC PRE_1 (0.75) + R2_BULL (0.8) → 0.6 (곱셈 복원)', () => {
      process.env.FOMC_REGIME_OVERRIDE_DISABLED = 'true';
      const r = combineRegimeAndFomcKelly(0.8, 0.75, 'PRE_1', 'R2_BULL');
      expect(r.value).toBeCloseTo(0.6, 5);
      expect(r.source).toBe('LEGACY_PRODUCT');
    });

    it('FOMC NORMAL + R2_BULL (0.8) → 0.8 (FOMC=1 곱셈도 항등원)', () => {
      process.env.FOMC_REGIME_OVERRIDE_DISABLED = 'true';
      const r = combineRegimeAndFomcKelly(0.8, 1.0, 'NORMAL', 'R2_BULL');
      expect(r.value).toBe(0.8);
      expect(r.source).toBe('LEGACY_PRODUCT');
    });

    it('FOMC POST_1 (1.30) + R2_BULL (0.8) → 1.04 (LEGACY 곱셈 — 옵션 C 와 다름)', () => {
      process.env.FOMC_REGIME_OVERRIDE_DISABLED = 'true';
      const r = combineRegimeAndFomcKelly(0.8, 1.30, 'POST_1', 'R2_BULL');
      expect(r.value).toBeCloseTo(1.04, 5);
      expect(r.source).toBe('LEGACY_PRODUCT');
    });

    it('LEGACY 진단 메시지 — "LEGACY 곱셈" 라벨', () => {
      process.env.FOMC_REGIME_OVERRIDE_DISABLED = 'true';
      const r = combineRegimeAndFomcKelly(0.8, 0.75, 'PRE_1', 'R2_BULL');
      expect(r.reason).toContain('LEGACY 곱셈');
    });

    it('=false → 정상 옵션 C 동작 (env 명시 false)', () => {
      process.env.FOMC_REGIME_OVERRIDE_DISABLED = 'false';
      const r = combineRegimeAndFomcKelly(0.8, 0.75, 'PRE_1', 'R2_BULL');
      expect(r.value).toBe(0.75);
      expect(r.source).toBe('FOMC');
    });
  });

  // ── 사용자 운영 시나리오 매트릭스 (PR 본문 표) ───────────────────────
  describe('운영 시나리오 매트릭스 (사용자 검증)', () => {
    const cases: Array<{
      name: string;
      regimeKelly: number;
      fomcKelly: number;
      phase: 'NORMAL' | 'PRE_3' | 'PRE_2' | 'PRE_1' | 'DAY' | 'POST_1' | 'POST_2';
      regime: 'R1_TURBO' | 'R2_BULL' | 'R3_EARLY' | 'R4_NEUTRAL' | 'R5_CAUTION' | 'R6_DEFENSE';
      expectedValue: number;
      expectedSource: string;
    }> = [
      // 사용자 PR 본문 시나리오 검증
      { name: 'PRE_3 + R2_BULL', regimeKelly: 0.8, fomcKelly: 0.75, phase: 'PRE_3', regime: 'R2_BULL', expectedValue: 0.75, expectedSource: 'FOMC' },
      { name: 'PRE_2 + R2_BULL', regimeKelly: 0.8, fomcKelly: 0.75, phase: 'PRE_2', regime: 'R2_BULL', expectedValue: 0.75, expectedSource: 'FOMC' },
      { name: 'PRE_1 + R2_BULL', regimeKelly: 0.8, fomcKelly: 0.75, phase: 'PRE_1', regime: 'R2_BULL', expectedValue: 0.75, expectedSource: 'FOMC' },
      { name: 'PRE_1 + R5_CAUTION', regimeKelly: 0.3, fomcKelly: 0.75, phase: 'PRE_1', regime: 'R5_CAUTION', expectedValue: 0.75, expectedSource: 'FOMC' },
      { name: 'DAY + R2_BULL', regimeKelly: 0.8, fomcKelly: 0, phase: 'DAY', regime: 'R2_BULL', expectedValue: 0, expectedSource: 'FOMC' },
      { name: 'POST_1 + R2_BULL', regimeKelly: 0.8, fomcKelly: 1.30, phase: 'POST_1', regime: 'R2_BULL', expectedValue: 1.30, expectedSource: 'FOMC' },
      { name: 'POST_1 + R5_CAUTION', regimeKelly: 0.3, fomcKelly: 1.30, phase: 'POST_1', regime: 'R5_CAUTION', expectedValue: 1.30, expectedSource: 'FOMC' },
      { name: 'PRE_1 + R6_DEFENSE', regimeKelly: 0, fomcKelly: 0.75, phase: 'PRE_1', regime: 'R6_DEFENSE', expectedValue: 0, expectedSource: 'R6_OVERRIDE' },
      { name: 'NORMAL + R2_BULL', regimeKelly: 0.8, fomcKelly: 1.0, phase: 'NORMAL', regime: 'R2_BULL', expectedValue: 0.8, expectedSource: 'REGIME' },
    ];

    for (const c of cases) {
      it(`${c.name} → ${c.expectedValue} (${c.expectedSource})`, () => {
        const r = combineRegimeAndFomcKelly(c.regimeKelly, c.fomcKelly, c.phase, c.regime);
        expect(r.value).toBeCloseTo(c.expectedValue, 5);
        expect(r.source).toBe(c.expectedSource);
      });
    }
  });
});

describe('describeRegimeFomcCombination — 진단 메시지 포맷', () => {
  it('FOMC 활성 라인 형식', () => {
    const r = combineRegimeAndFomcKelly(0.8, 0.75, 'PRE_1', 'R2_BULL');
    const desc = describeRegimeFomcCombination(r);
    expect(desc).toContain('[Kelly 결합]');
    expect(desc).toContain('FOMC PRE_1');
    expect(desc).toContain('×0.75');
    expect(desc).toContain('→ ×0.75');
  });

  it('REGIME 라인 형식', () => {
    const r = combineRegimeAndFomcKelly(0.8, 1.0, 'NORMAL', 'R2_BULL');
    const desc = describeRegimeFomcCombination(r);
    expect(desc).toContain('R2_BULL');
    expect(desc).toContain('FOMC 비활성');
    expect(desc).toContain('→ ×0.80');
  });

  it('R6_OVERRIDE 라인 형식', () => {
    const r = combineRegimeAndFomcKelly(0, 0.75, 'PRE_1', 'R6_DEFENSE');
    const desc = describeRegimeFomcCombination(r);
    expect(desc).toContain('R6_DEFENSE');
    expect(desc).toContain('매수 차단');
    expect(desc).toContain('→ ×0.00');
  });
});
