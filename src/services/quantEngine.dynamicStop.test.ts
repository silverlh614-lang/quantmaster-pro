import { describe, expect, it } from 'vitest';
import { evaluateDynamicStop } from './quant/dynamicStopEngine';
import type { DynamicStopInput } from '../types/sell';

// ─── 헬퍼 ────────────────────────────────────────────────────────────────────

function input(overrides: Partial<DynamicStopInput> = {}): DynamicStopInput {
  return {
    entryPrice: 10000,
    atr14: 500,
    regime: 'RISK_ON',
    currentPrice: 10000,
    ...overrides,
  };
}

// ─── ATR 기반 손절가 계산 — 레짐별 배수 검증 ──────────────────────────────────

describe('evaluateDynamicStop — ATR 손절가 계산', () => {
  it('RISK_ON: stopPrice = entryPrice − ATR × 2.0', () => {
    const result = evaluateDynamicStop(input({ regime: 'RISK_ON' }));
    // 10000 − 500 × 2.0 = 9000
    expect(result.stopPrice).toBe(9000);
    expect(result.multiplier).toBe(2.0);
  });

  it('RISK_OFF: stopPrice = entryPrice − ATR × 1.5', () => {
    const result = evaluateDynamicStop(input({ regime: 'RISK_OFF' }));
    // 10000 − 500 × 1.5 = 9250
    expect(result.stopPrice).toBe(9250);
    expect(result.multiplier).toBe(1.5);
  });

  it('CRISIS: stopPrice = entryPrice − ATR × 1.0', () => {
    const result = evaluateDynamicStop(input({ regime: 'CRISIS' }));
    // 10000 − 500 × 1.0 = 9500
    expect(result.stopPrice).toBe(9500);
    expect(result.multiplier).toBe(1.0);
  });

  it('손절가는 최소 1원 (음수 방지)', () => {
    // atr14가 진입가보다 훨씬 크면 stopPrice가 음수가 될 수 있음
    const result = evaluateDynamicStop(input({ entryPrice: 1000, atr14: 2000, regime: 'CRISIS' }));
    expect(result.stopPrice).toBeGreaterThanOrEqual(1);
  });

  it('stopPct는 음수 (진입가 대비 손실)', () => {
    const result = evaluateDynamicStop(input({ regime: 'RISK_ON' }));
    expect(result.stopPct).toBeLessThan(0);
  });

  it('CRISIS 레짐은 RISK_ON 레짐보다 손절 비율이 타이트함 (절대값 작음)', () => {
    const riskOn  = evaluateDynamicStop(input({ regime: 'RISK_ON' }));
    const crisis  = evaluateDynamicStop(input({ regime: 'CRISIS' }));
    // CRISIS: -(500/10000)*100 = -5%, RISK_ON: -(1000/10000)*100 = -10%
    expect(Math.abs(crisis.stopPct)).toBeLessThan(Math.abs(riskOn.stopPct));
  });

  it('입력 레짐이 반환값에 그대로 포함됨', () => {
    const result = evaluateDynamicStop(input({ regime: 'RISK_OFF' }));
    expect(result.regime).toBe('RISK_OFF');
  });
});

// ─── 트레일링 스톱 — BEP 보호 (+5%) ─────────────────────────────────────────

describe('evaluateDynamicStop — 트레일링 스톱 (BEP 보호)', () => {
  it('수익률 0% → 트레일링 스톱 미활성', () => {
    const result = evaluateDynamicStop(input({ entryPrice: 10000, currentPrice: 10000 }));
    expect(result.trailingActive).toBe(false);
    expect(result.bepProtection).toBe(false);
  });

  it('수익률 +4.9% → 트레일링 스톱 미활성 (임계값 미달)', () => {
    const result = evaluateDynamicStop(input({ entryPrice: 10000, currentPrice: 10490 }));
    expect(result.trailingActive).toBe(false);
  });

  it('수익률 +5% 정확히 → BEP 보호 활성화', () => {
    const result = evaluateDynamicStop(input({ entryPrice: 10000, currentPrice: 10500 }));
    expect(result.trailingActive).toBe(true);
    expect(result.bepProtection).toBe(true);
    expect(result.profitLockIn).toBe(false);
    // trailingStopPrice = entryPrice (진입가로 이동)
    expect(result.trailingStopPrice).toBe(10000);
  });

  it('수익률 +7% → BEP 보호 활성 (아직 Lock-in 미달)', () => {
    const result = evaluateDynamicStop(input({ entryPrice: 10000, currentPrice: 10700 }));
    expect(result.trailingActive).toBe(true);
    expect(result.bepProtection).toBe(true);
    expect(result.profitLockIn).toBe(false);
    expect(result.trailingStopPrice).toBe(10000);
  });
});

// ─── 트레일링 스톱 — 수익 Lock-in (+10%) ────────────────────────────────────

describe('evaluateDynamicStop — 수익 Lock-in (+10%)', () => {
  it('수익률 +10% 정확히 → Lock-in 활성화', () => {
    const result = evaluateDynamicStop(input({ entryPrice: 10000, currentPrice: 11000 }));
    expect(result.trailingActive).toBe(true);
    expect(result.profitLockIn).toBe(true);
    expect(result.bepProtection).toBe(true);
    // trailingStopPrice = entryPrice × 1.03 (수익 +3% 락인)
    expect(result.trailingStopPrice).toBe(10300);
  });

  it('수익률 +20% → Lock-in 활성 (trailingStopPrice = entryPrice × 1.03)', () => {
    const result = evaluateDynamicStop(input({ entryPrice: 10000, currentPrice: 12000 }));
    expect(result.profitLockIn).toBe(true);
    expect(result.trailingStopPrice).toBe(10300);
  });

  it('trailingStopPct는 Lock-in 시 약 +3%', () => {
    const result = evaluateDynamicStop(input({ entryPrice: 10000, currentPrice: 11000 }));
    expect(result.trailingStopPct).toBeCloseTo(3.0, 1);
  });
});

// ─── 현재 수익률 계산 ─────────────────────────────────────────────────────────

describe('evaluateDynamicStop — 현재 수익률 계산', () => {
  it('현재가 = 진입가 → currentReturnPct = 0', () => {
    const result = evaluateDynamicStop(input({ entryPrice: 10000, currentPrice: 10000 }));
    expect(result.currentReturnPct).toBe(0);
  });

  it('현재가 +10% → currentReturnPct = 10', () => {
    const result = evaluateDynamicStop(input({ entryPrice: 10000, currentPrice: 11000 }));
    expect(result.currentReturnPct).toBeCloseTo(10, 1);
  });

  it('현재가 -5% → currentReturnPct = -5 (손실 중)', () => {
    const result = evaluateDynamicStop(input({ entryPrice: 10000, currentPrice: 9500 }));
    expect(result.currentReturnPct).toBeCloseTo(-5, 1);
  });
});

// ─── 행동 권고 메시지 ─────────────────────────────────────────────────────────

describe('evaluateDynamicStop — actionMessage', () => {
  it('평상 시 (수익 +5% 미만): 레짐·ATR·손절% 포함', () => {
    const result = evaluateDynamicStop(input({ regime: 'RISK_ON', currentPrice: 10000 }));
    expect(result.actionMessage).toContain('Risk-On');
    expect(result.actionMessage).toContain('2');
    expect(result.actionMessage).toContain('%');
  });

  it('BEP 보호 활성 시: 메시지에 "BEP" 포함', () => {
    const result = evaluateDynamicStop(input({ entryPrice: 10000, currentPrice: 10500 }));
    expect(result.actionMessage).toContain('BEP');
  });

  it('Lock-in 활성 시: 메시지에 "Lock-in" 포함', () => {
    const result = evaluateDynamicStop(input({ entryPrice: 10000, currentPrice: 11000 }));
    expect(result.actionMessage).toContain('Lock-in');
  });
});

// ─── 반환값 구조 완전성 검증 ──────────────────────────────────────────────────

describe('evaluateDynamicStop — 반환값 구조', () => {
  it('모든 필드가 정의됨 (undefined 없음)', () => {
    const result = evaluateDynamicStop(input());
    expect(result.stopPrice).toBeDefined();
    expect(result.multiplier).toBeDefined();
    expect(result.regime).toBeDefined();
    expect(result.stopPct).toBeDefined();
    expect(result.trailingActive).toBeDefined();
    expect(result.trailingStopPrice).toBeDefined();
    expect(result.trailingStopPct).toBeDefined();
    expect(result.bepProtection).toBeDefined();
    expect(result.profitLockIn).toBeDefined();
    expect(result.currentReturnPct).toBeDefined();
    expect(result.actionMessage).toBeDefined();
  });

  it('stopPrice는 양의 정수 (반올림)', () => {
    const result = evaluateDynamicStop(input({ entryPrice: 15300, atr14: 333, regime: 'RISK_ON' }));
    expect(result.stopPrice).toBe(Math.round(15300 - 333 * 2.0));
    expect(Number.isInteger(result.stopPrice)).toBe(true);
  });
});
