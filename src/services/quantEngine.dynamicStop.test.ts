import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { bepGlideStopPrice, evaluateDynamicStop } from './quant/dynamicStopEngine';
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

  it('수익률 +5% 정확히 → BEP 글라이드 활성화 (ADR-0079)', () => {
    // input default atr14=500, RISK_ON 시 bepGlide = 10000 − 0.5 × 500 = 9750
    const result = evaluateDynamicStop(input({ entryPrice: 10000, currentPrice: 10500 }));
    expect(result.trailingActive).toBe(true);
    expect(result.bepProtection).toBe(true);
    expect(result.profitLockIn).toBe(false);
    // ADR-0079: trailingStopPrice = entryPrice − 0.5 × atr14 (=9750), 진입가 직박 폐지
    expect(result.trailingStopPrice).toBe(9750);
  });

  it('수익률 +7% → BEP 글라이드 활성 (아직 Lock-in 미달, ADR-0079)', () => {
    const result = evaluateDynamicStop(input({ entryPrice: 10000, currentPrice: 10700 }));
    expect(result.trailingActive).toBe(true);
    expect(result.bepProtection).toBe(true);
    expect(result.profitLockIn).toBe(false);
    // atr14=500 글라이드 동일 — Lock-in 임계 +10% 미달이라 BEP 분기 유지
    expect(result.trailingStopPrice).toBe(9750);
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

// ─── ADR-0079: bepGlideStopPrice 단위 함수 ────────────────────────────────────

describe('bepGlideStopPrice — ATR-Buffered BEP Glide (ADR-0079)', () => {
  const originalDisabled = process.env.BEP_GLIDE_DISABLED;

  beforeEach(() => {
    delete process.env.BEP_GLIDE_DISABLED;
  });

  afterEach(() => {
    if (originalDisabled === undefined) {
      delete process.env.BEP_GLIDE_DISABLED;
    } else {
      process.env.BEP_GLIDE_DISABLED = originalDisabled;
    }
  });

  it('ATR > 0: 진입가 − 0.5 × ATR 글라이드 적용 (저 ATR)', () => {
    // 10000 − 0.5 × 300 = 9850 (ATR 300, 마진 1.5%)
    expect(bepGlideStopPrice(10000, 300)).toBe(9850);
  });

  it('ATR > 0: 진입가 − 0.5 × ATR 글라이드 적용 (중 ATR)', () => {
    // 10000 − 0.5 × 1000 = 9500 (ATR 1000, 마진 5%)
    expect(bepGlideStopPrice(10000, 1000)).toBe(9500);
  });

  it('ATR > 0: 진입가 − 0.5 × ATR 글라이드 적용 (고 ATR)', () => {
    // 10000 − 0.5 × 3000 = 8500 (ATR 3000, 마진 15%)
    expect(bepGlideStopPrice(10000, 3000)).toBe(8500);
  });

  it('ATR === 0: entryPrice fallback (기존 동작 회귀)', () => {
    expect(bepGlideStopPrice(10000, 0)).toBe(10000);
  });

  it('ATR === undefined: entryPrice fallback', () => {
    expect(bepGlideStopPrice(10000)).toBe(10000);
  });

  it('ATR === NaN: entryPrice fallback (안전 가드)', () => {
    expect(bepGlideStopPrice(10000, NaN)).toBe(10000);
  });

  it('ATR === Infinity: entryPrice fallback (안전 가드)', () => {
    expect(bepGlideStopPrice(10000, Infinity)).toBe(10000);
  });

  it('ATR === 음수: entryPrice fallback (안전 가드)', () => {
    expect(bepGlideStopPrice(10000, -500)).toBe(10000);
  });

  it('1원 floor — ATR 가 entryPrice 의 2배 초과 시 음수 방지', () => {
    // 1000 − 0.5 × 5000 = -1500 → 1원 floor
    expect(bepGlideStopPrice(1000, 5000)).toBe(1);
  });

  it('Math.round 반올림 — 0.5 × ATR 가 소수점인 경우', () => {
    // 10000 − 0.5 × 333 = 9833.5 → 9834
    expect(bepGlideStopPrice(10000, 333)).toBe(9834);
  });

  it('BEP_GLIDE_DISABLED=true env: ATR 무시하고 entryPrice (긴급 롤백)', () => {
    process.env.BEP_GLIDE_DISABLED = 'true';
    expect(bepGlideStopPrice(10000, 1000)).toBe(10000);
  });

  it('BEP_GLIDE_DISABLED=true env: ATR 0 일 때도 entryPrice', () => {
    process.env.BEP_GLIDE_DISABLED = 'true';
    expect(bepGlideStopPrice(10000, 0)).toBe(10000);
  });

  it('BEP_GLIDE_DISABLED=false (기본값): ATR 글라이드 정상 작동', () => {
    delete process.env.BEP_GLIDE_DISABLED;
    expect(bepGlideStopPrice(10000, 500)).toBe(9750);
  });
});

// ─── ADR-0079: evaluateDynamicStop BEP 분기 ATR 반영 통합 검증 ────────────────

describe('evaluateDynamicStop — ADR-0079 BEP Glide 통합', () => {
  const originalDisabled = process.env.BEP_GLIDE_DISABLED;

  beforeEach(() => {
    delete process.env.BEP_GLIDE_DISABLED;
  });

  afterEach(() => {
    if (originalDisabled === undefined) {
      delete process.env.BEP_GLIDE_DISABLED;
    } else {
      process.env.BEP_GLIDE_DISABLED = originalDisabled;
    }
  });

  it('+5% & ATR=1500 (고변동): trailingStopPrice = 9250 (-7.5% 마진)', () => {
    const result = evaluateDynamicStop(input({
      entryPrice: 10000,
      atr14: 1500,
      currentPrice: 10500,
    }));
    expect(result.trailingStopPrice).toBe(9250);
    expect(result.bepProtection).toBe(true);
  });

  it('+5% & ATR=300 (저변동): trailingStopPrice = 9850 (-1.5% 마진)', () => {
    const result = evaluateDynamicStop(input({
      entryPrice: 10000,
      atr14: 300,
      currentPrice: 10500,
    }));
    expect(result.trailingStopPrice).toBe(9850);
    expect(result.bepProtection).toBe(true);
  });

  it('+5% & ATR=0 (회귀 확인): trailingStopPrice = entryPrice (기존 동작)', () => {
    const result = evaluateDynamicStop(input({
      entryPrice: 10000,
      atr14: 0,
      currentPrice: 10500,
    }));
    expect(result.trailingStopPrice).toBe(10000);
    expect(result.bepProtection).toBe(true);
  });

  it('+5% & BEP_GLIDE_DISABLED=true: trailingStopPrice = entryPrice (롤백)', () => {
    process.env.BEP_GLIDE_DISABLED = 'true';
    const result = evaluateDynamicStop(input({
      entryPrice: 10000,
      atr14: 1500,
      currentPrice: 10500,
    }));
    expect(result.trailingStopPrice).toBe(10000);
    expect(result.bepProtection).toBe(true);
  });

  it('+10% Lock-in 분기 무영향: ATR 클라이트 적용 안 됨 (entryPrice × 1.03)', () => {
    // ADR-0079 scope: BEP 분기(+5%) 만 변경, Lock-in(+10%) 분기는 그대로
    const result = evaluateDynamicStop(input({
      entryPrice: 10000,
      atr14: 1500,  // 고 ATR 도 Lock-in 분기엔 영향 없어야 함
      currentPrice: 11000,
    }));
    expect(result.trailingStopPrice).toBe(10300);
    expect(result.profitLockIn).toBe(true);
  });

  it('+5% & ATR=500: actionMessage 가 "BEP 글라이드" 표기', () => {
    const result = evaluateDynamicStop(input({
      entryPrice: 10000,
      atr14: 500,
      currentPrice: 10500,
    }));
    expect(result.actionMessage).toContain('BEP 글라이드');
    expect(result.actionMessage).toContain('ATR');
  });

  it('+5% & ATR=0: actionMessage 가 기존 "BEP 보호" 표기 (회귀)', () => {
    const result = evaluateDynamicStop(input({
      entryPrice: 10000,
      atr14: 0,
      currentPrice: 10500,
    }));
    expect(result.actionMessage).toContain('BEP 보호');
    expect(result.actionMessage).toContain('원금 보호');
  });

  it('+5% & BEP_GLIDE_DISABLED=true: actionMessage 가 기존 "BEP 보호" 표기', () => {
    process.env.BEP_GLIDE_DISABLED = 'true';
    const result = evaluateDynamicStop(input({
      entryPrice: 10000,
      atr14: 500,
      currentPrice: 10500,
    }));
    expect(result.actionMessage).toContain('BEP 보호');
  });
});
