import { describe, expect, it } from 'vitest';
import { regimeToStopRegime, buildStopLossPlan } from './entryEngine.js';

// ─── regimeToStopRegime 매핑 ─────────────────────────────────────────────────

describe('regimeToStopRegime', () => {
  it('R1_TURBO → RISK_ON', () => {
    expect(regimeToStopRegime('R1_TURBO')).toBe('RISK_ON');
  });

  it('R2_BULL → RISK_ON', () => {
    expect(regimeToStopRegime('R2_BULL')).toBe('RISK_ON');
  });

  it('R3_EARLY → RISK_OFF', () => {
    expect(regimeToStopRegime('R3_EARLY')).toBe('RISK_OFF');
  });

  it('R4_NEUTRAL → RISK_OFF', () => {
    expect(regimeToStopRegime('R4_NEUTRAL')).toBe('RISK_OFF');
  });

  it('R5_CAUTION → CRISIS', () => {
    expect(regimeToStopRegime('R5_CAUTION')).toBe('CRISIS');
  });

  it('R6_DEFENSE → CRISIS', () => {
    expect(regimeToStopRegime('R6_DEFENSE')).toBe('CRISIS');
  });

  it('undefined → RISK_OFF (기본값)', () => {
    expect(regimeToStopRegime(undefined)).toBe('RISK_OFF');
  });

  it('알 수 없는 레짐 → RISK_OFF (기본값)', () => {
    expect(regimeToStopRegime('UNKNOWN')).toBe('RISK_OFF');
  });
});

// ─── buildStopLossPlan — ATR 통합 검증 ──────────────────────────────────────

describe('buildStopLossPlan — ATR 통합', () => {
  it('ATR 미제공 시 기존 로직과 동일 (dynamicStopLoss = undefined)', () => {
    const plan = buildStopLossPlan({
      entryPrice: 10000,
      fixedStopLoss: 9000,     // 고정 손절 9000원
      regimeStopRate: -0.10,   // 레짐 손절 -10% → 9000원
    });
    expect(plan.initialStopLoss).toBe(9000);
    expect(plan.regimeStopLoss).toBe(9000);
    expect(plan.dynamicStopLoss).toBeUndefined();
    expect(plan.hardStopLoss).toBe(9000);
  });

  it('ATR 제공 시 동적 손절가 계산 (R2_BULL → ATR × 2.0)', () => {
    const plan = buildStopLossPlan({
      entryPrice: 50000,
      fixedStopLoss: 45000,    // 고정 손절 45000원 (-10%)
      regimeStopRate: -0.10,   // 레짐 손절 → 45000원
      atr14: 1500,             // ATR = 1500원
      regime: 'R2_BULL',       // → RISK_ON → 배수 2.0
    });
    // dynamicStopLoss = 50000 - 1500 × 2.0 = 47000
    expect(plan.dynamicStopLoss).toBe(47000);
    // hardStopLoss = max(45000, 45000, 47000) = 47000 (ATR이 가장 촘촘)
    expect(plan.hardStopLoss).toBe(47000);
  });

  it('ATR 동적 손절이 다른 손절보다 느슨하면 hardStopLoss에 영향 없음', () => {
    const plan = buildStopLossPlan({
      entryPrice: 50000,
      fixedStopLoss: 48000,    // 고정 손절 48000원 (-4%)
      regimeStopRate: -0.03,   // 레짐 손절 → 48500원
      atr14: 5000,             // ATR = 5000원 (높은 변동성)
      regime: 'R1_TURBO',      // → RISK_ON → 배수 2.0
    });
    // dynamicStopLoss = 50000 - 5000 × 2.0 = 40000 (매우 느슨)
    expect(plan.dynamicStopLoss).toBe(40000);
    // hardStopLoss = max(48000, 48500, 40000) = 48500 (레짐이 가장 촘촘)
    expect(plan.hardStopLoss).toBe(48500);
  });

  it('CRISIS 레짐에서 ATR 배수 1.0 → 타이트한 손절', () => {
    const plan = buildStopLossPlan({
      entryPrice: 30000,
      fixedStopLoss: 27000,    // 고정 손절 -10%
      regimeStopRate: -0.12,   // 레짐 손절 → 26400원
      atr14: 1000,             // ATR = 1000원
      regime: 'R5_CAUTION',    // → CRISIS → 배수 1.0
    });
    // dynamicStopLoss = 30000 - 1000 × 1.0 = 29000
    expect(plan.dynamicStopLoss).toBe(29000);
    // hardStopLoss = max(27000, 26400, 29000) = 29000
    expect(plan.hardStopLoss).toBe(29000);
  });

  it('atr14 = 0 이면 동적 손절 미적용', () => {
    const plan = buildStopLossPlan({
      entryPrice: 10000,
      fixedStopLoss: 9000,
      regimeStopRate: -0.10,
      atr14: 0,
      regime: 'R2_BULL',
    });
    expect(plan.dynamicStopLoss).toBeUndefined();
  });
});
