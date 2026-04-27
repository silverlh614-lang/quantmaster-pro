// @responsibility tallyConsecutiveForeignFlowDays 회귀 테스트
import { describe, it, expect } from 'vitest';
import { tallyConsecutiveForeignFlowDays } from './marketDataRefresh.js';

function row(passiveNetBuy: number, activeNetBuy: number = 0) {
  return { passiveNetBuy, activeNetBuy };
}

describe('tallyConsecutiveForeignFlowDays', () => {
  describe('빈 입력', () => {
    it('빈 배열 → 0 (BUY)', () => {
      expect(tallyConsecutiveForeignFlowDays([], 'BUY')).toBe(0);
    });
    it('빈 배열 → 0 (SELL)', () => {
      expect(tallyConsecutiveForeignFlowDays([], 'SELL')).toBe(0);
    });
  });

  describe('BUY direction', () => {
    it('단일 양수 → 1', () => {
      expect(tallyConsecutiveForeignFlowDays([row(100)], 'BUY')).toBe(1);
    });
    it('연속 3일 양수 → 3', () => {
      expect(tallyConsecutiveForeignFlowDays([row(50), row(80), row(120)], 'BUY')).toBe(3);
    });
    it('직전 일이 음수 → 0 (직전부터 시작)', () => {
      expect(tallyConsecutiveForeignFlowDays([row(50), row(80), row(-30)], 'BUY')).toBe(0);
    });
    it('가운데 음수 → 끝부터 연속만 카운트', () => {
      // 끝부터 역순: +50 → +30 → -10 (break) → +20 (무시)
      expect(tallyConsecutiveForeignFlowDays([row(20), row(-10), row(30), row(50)], 'BUY')).toBe(2);
    });
    it('passive+active 합산 (passive 음수, active 양수, 합 양수)', () => {
      expect(tallyConsecutiveForeignFlowDays([row(-30, 50), row(-10, 30)], 'BUY')).toBe(2);
    });
    it('합이 정확히 0 → break (BUY 카운트 안 됨)', () => {
      expect(tallyConsecutiveForeignFlowDays([row(50), row(0)], 'BUY')).toBe(0);
    });
  });

  describe('SELL direction', () => {
    it('단일 음수 → 1', () => {
      expect(tallyConsecutiveForeignFlowDays([row(-100)], 'SELL')).toBe(1);
    });
    it('연속 5일 음수 → 5 (confluenceEngine 임계값)', () => {
      const records = [row(-30), row(-50), row(-20), row(-80), row(-40)];
      expect(tallyConsecutiveForeignFlowDays(records, 'SELL')).toBe(5);
    });
    it('직전 일이 양수 → 0', () => {
      expect(tallyConsecutiveForeignFlowDays([row(-50), row(-80), row(30)], 'SELL')).toBe(0);
    });
    it('가운데 양수 → 끝부터 연속만 카운트', () => {
      // 끝부터: -20 → -30 → +10 (break) → -50 (무시)
      expect(tallyConsecutiveForeignFlowDays([row(-50), row(10), row(-30), row(-20)], 'SELL')).toBe(2);
    });
    it('passive+active 합산 (passive 양수, active 음수, 합 음수)', () => {
      expect(tallyConsecutiveForeignFlowDays([row(30, -50), row(10, -30)], 'SELL')).toBe(2);
    });
    it('합이 정확히 0 → break (SELL 카운트 안 됨)', () => {
      expect(tallyConsecutiveForeignFlowDays([row(-50), row(0)], 'SELL')).toBe(0);
    });
  });

  describe('상호 배타성 (BUY 와 SELL 동시 ≥ 1 불가)', () => {
    it('직전 양수 → BUY ≥ 1, SELL = 0', () => {
      const records = [row(-50), row(-30), row(20)];
      expect(tallyConsecutiveForeignFlowDays(records, 'BUY')).toBe(1);
      expect(tallyConsecutiveForeignFlowDays(records, 'SELL')).toBe(0);
    });
    it('직전 음수 → SELL ≥ 1, BUY = 0', () => {
      const records = [row(50), row(30), row(-20)];
      expect(tallyConsecutiveForeignFlowDays(records, 'BUY')).toBe(0);
      expect(tallyConsecutiveForeignFlowDays(records, 'SELL')).toBe(1);
    });
  });
});
