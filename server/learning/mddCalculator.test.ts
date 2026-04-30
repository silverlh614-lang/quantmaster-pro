/**
 * mddCalculator.test.ts — ADR-0129 MDD SSOT 회귀 테스트
 */
import { describe, it, expect, afterEach } from 'vitest';
import {
  computeMaxDrawdown,
  computeMaxDrawdownLegacyPositive,
  isMddLegacySignDisabled,
  MDD_SSOT_CONSTANTS,
  type MddMode,
} from './mddCalculator.js';

describe('ADR-0129 mddCalculator SSOT', () => {
  afterEach(() => {
    delete process.env.MDD_SSOT_MODE;
    delete process.env.MDD_SSOT_LEGACY_SIGN_DISABLED;
  });

  describe('computeMaxDrawdown — compound mode (default)', () => {
    it('빈 배열 → 0 반환', () => {
      expect(computeMaxDrawdown([])).toBe(0);
    });

    it('단일 양수 → 0 반환 (drawdown 측정 불가)', () => {
      expect(computeMaxDrawdown([+5])).toBe(0);
    });

    it('단일 음수 → 음수 반환 (peak=시작자본 1)', () => {
      // -10% → equity=0.9, peak=1, dd=(1-0.9)/1=0.10 → -10
      const result = computeMaxDrawdown([-10]);
      expect(result).toBeCloseTo(-10, 5);
    });

    it('단조 증가 → 0 (drawdown 없음)', () => {
      expect(computeMaxDrawdown([+5, +3, +2, +1])).toBe(0);
    });

    it('compound 누적 정확성: [+5, -10] → -10% drawdown', () => {
      // equity: 1 → 1.05 → 0.945 → peak=1.05 → dd=(1.05-0.945)/1.05 ≈ 0.10
      const result = computeMaxDrawdown([+5, -10]);
      expect(result).toBeCloseTo(-10, 1);
    });

    it('NEGATIVE 반환 — 부호 정합', () => {
      const result = computeMaxDrawdown([+5, -3, +2, -10, +1]);
      expect(result).toBeLessThan(0);
    });

    it('NaN/Infinity 입력 자동 0 치환', () => {
      const safe = computeMaxDrawdown([+5, NaN, -3, Infinity, -10]);
      const expected = computeMaxDrawdown([+5, 0, -3, 0, -10]);
      expect(safe).toBeCloseTo(expected, 5);
    });

    it('대형 손실 시나리오 — 사용자 보고 -17.80% 재현 가능', () => {
      // PF 2.01 + 승률 40% + 큰 음수 1개 패턴
      const returns = [+10, +8, -5, +12, +7, -25, +5, -3, +9, -2];
      const result = computeMaxDrawdown(returns);
      // peak 후 -25% 단일 손실로 큰 drawdown
      expect(result).toBeLessThan(-15);
    });
  });

  describe('computeMaxDrawdown — additive mode', () => {
    it('단순 가산 [+5, -3, +2, -10] → MDD = -11', () => {
      // cumulative: +5, +2, +4, -6 → peak=+5, dd: 0, -3, -1, -11
      const result = computeMaxDrawdown([+5, -3, +2, -10], 'additive');
      expect(result).toBe(-11);
    });

    it('단조 증가 → 0', () => {
      expect(computeMaxDrawdown([+5, +3, +2], 'additive')).toBe(0);
    });

    it('NaN 자동 0 치환', () => {
      expect(computeMaxDrawdown([+5, NaN, -10], 'additive')).toBe(-10);
    });
  });

  describe('ENV 우회', () => {
    it('MDD_SSOT_MODE=additive 시 default 모드 변경', () => {
      process.env.MDD_SSOT_MODE = 'additive';
      // [+5, -10] → additive=-10 vs compound≈-10 (둘 다 비슷하지만 수학 다름)
      const additive = computeMaxDrawdown([+5, -10]);
      const compound = computeMaxDrawdown([+5, -10], 'compound');
      expect(additive).toBe(-10); // peak=5, cumulative=-5, dd=-10
      expect(compound).toBeCloseTo(-10, 1); // (1.05-0.945)/1.05*100
    });

    it('MDD_SSOT_MODE 미설정 시 compound default', () => {
      delete process.env.MDD_SSOT_MODE;
      const result = computeMaxDrawdown([+10, -50]);
      // compound: equity 1→1.1→0.55, dd=(1.1-0.55)/1.1=0.5 → -50
      expect(result).toBeCloseTo(-50, 1);
    });

    it("MDD_SSOT_MODE=invalid 시 default (compound)", () => {
      process.env.MDD_SSOT_MODE = 'invalid';
      const result = computeMaxDrawdown([+10, -50]);
      expect(result).toBeCloseTo(-50, 1);
    });
  });

  describe('computeMaxDrawdownLegacyPositive — walkForwardFramework 호환', () => {
    it('NEGATIVE → POSITIVE 부호 반전', () => {
      const negative = computeMaxDrawdown([+5, -10]);
      const positive = computeMaxDrawdownLegacyPositive([+5, -10]);
      expect(negative).toBeLessThan(0);
      expect(positive).toBeGreaterThan(0);
      expect(positive).toBeCloseTo(-negative, 5);
    });

    it('빈 배열 → 0 (-0 정합)', () => {
      expect(Math.abs(computeMaxDrawdownLegacyPositive([]))).toBe(0);
    });

    it('drawdown 없음 → 0', () => {
      expect(computeMaxDrawdownLegacyPositive([+5, +3])).toBe(0);
    });
  });

  describe('isMddLegacySignDisabled', () => {
    it('미설정 시 false', () => {
      delete process.env.MDD_SSOT_LEGACY_SIGN_DISABLED;
      expect(isMddLegacySignDisabled()).toBe(false);
    });

    it('"true" 시 true', () => {
      process.env.MDD_SSOT_LEGACY_SIGN_DISABLED = 'true';
      expect(isMddLegacySignDisabled()).toBe(true);
    });

    it('"false" 명시 시 false', () => {
      process.env.MDD_SSOT_LEGACY_SIGN_DISABLED = 'false';
      expect(isMddLegacySignDisabled()).toBe(false);
    });

    it('알 수 없는 값 시 false (보수적)', () => {
      process.env.MDD_SSOT_LEGACY_SIGN_DISABLED = 'yes';
      expect(isMddLegacySignDisabled()).toBe(false);
    });
  });

  describe('상수 SSOT 정합', () => {
    it('DEFAULT_MODE 는 "compound"', () => {
      expect(MDD_SSOT_CONSTANTS.DEFAULT_MODE).toBe('compound');
    });

    it('MddMode 타입은 union "compound" | "additive"', () => {
      const compound: MddMode = 'compound';
      const additive: MddMode = 'additive';
      expect(compound).toBe('compound');
      expect(additive).toBe('additive');
    });
  });
});
