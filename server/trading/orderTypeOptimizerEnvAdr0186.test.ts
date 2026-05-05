/**
 * @responsibility ADR-0186 (PR-A2-Wiring-1) ENV 우회 헬퍼 정합성 회귀.
 * `isOrderTypeOptimizerEnabled` (default OFF) ENV gate 분기 검증.
 */
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { isOrderTypeOptimizerEnabled } from './orderTypeOptimizer';

const ORIG_ENV = process.env.ORDER_TYPE_OPTIMIZER_ENABLED;

function clearAdrEnv(): void {
  delete process.env.ORDER_TYPE_OPTIMIZER_ENABLED;
}

function restoreAdrEnv(): void {
  if (ORIG_ENV === undefined) delete process.env.ORDER_TYPE_OPTIMIZER_ENABLED;
  else process.env.ORDER_TYPE_OPTIMIZER_ENABLED = ORIG_ENV;
}

describe('ADR-0186 (PR-A2-Wiring-1) ENV 헬퍼', () => {
  beforeEach(clearAdrEnv);
  afterEach(restoreAdrEnv);

  describe('isOrderTypeOptimizerEnabled (default OFF)', () => {
    it('미설정 시 false 반환 (default OFF — 회귀 위험 격리)', () => {
      expect(isOrderTypeOptimizerEnabled()).toBe(false);
    });

    it('"true" 정확 비교 시 true (의사결정 가시화 활성)', () => {
      process.env.ORDER_TYPE_OPTIMIZER_ENABLED = 'true';
      expect(isOrderTypeOptimizerEnabled()).toBe(true);
    });

    it('"1" / "TRUE" / "yes" 거부 (정확 비교 의무, ADR-0157 정합)', () => {
      process.env.ORDER_TYPE_OPTIMIZER_ENABLED = '1';
      expect(isOrderTypeOptimizerEnabled()).toBe(false);
      process.env.ORDER_TYPE_OPTIMIZER_ENABLED = 'TRUE';
      expect(isOrderTypeOptimizerEnabled()).toBe(false);
      process.env.ORDER_TYPE_OPTIMIZER_ENABLED = 'yes';
      expect(isOrderTypeOptimizerEnabled()).toBe(false);
    });

    it('"false" 명시 시 false', () => {
      process.env.ORDER_TYPE_OPTIMIZER_ENABLED = 'false';
      expect(isOrderTypeOptimizerEnabled()).toBe(false);
    });

    it('빈 문자열 시 false (default 보수)', () => {
      process.env.ORDER_TYPE_OPTIMIZER_ENABLED = '';
      expect(isOrderTypeOptimizerEnabled()).toBe(false);
    });
  });
});
