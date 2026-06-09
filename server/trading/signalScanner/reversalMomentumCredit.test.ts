// @responsibility ADR-0594 reversalMomentumCredit 순수 SSOT 진리표 — flag OFF / non-risk-on / T_min·T_cap 경계 / today 부재 / MAX_BONUS 상한 / ENV 오버라이드.
import { describe, expect, it, afterEach } from 'vitest';
import {
  computeReversalMomentumCredit,
  isGate1ReversalMomentumEnabled,
  gate1ReversalMomentumTMinPct,
  gate1ReversalMomentumTCapPct,
  gate1ReversalMomentumMaxBonus,
} from './reversalMomentumCredit.js';

afterEach(() => {
  delete process.env.GATE1_REVERSAL_MOMENTUM_ENABLED;
  delete process.env.GATE1_REVERSAL_MOMENTUM_T_MIN_PCT;
  delete process.env.GATE1_REVERSAL_MOMENTUM_T_CAP_PCT;
  delete process.env.GATE1_REVERSAL_MOMENTUM_MAX_BONUS;
});

const RISK_ON = 'R3_EARLY';

describe('ADR-0594 computeReversalMomentumCredit — gating', () => {
  it('flag OFF (default) → bonus 0 (byte-equivalent), reason DISABLED', () => {
    expect(isGate1ReversalMomentumEnabled()).toBe(false);
    const r = computeReversalMomentumCredit({ todayChangePercent: 7.45, regime: RISK_ON });
    expect(r.bonus).toBe(0);
    expect(r.applied).toBe(false);
    expect(r.reason).toBe('DISABLED');
  });

  it('flag ON + non-risk-on regime (R4_NEUTRAL) → bonus 0', () => {
    process.env.GATE1_REVERSAL_MOMENTUM_ENABLED = 'true';
    const r = computeReversalMomentumCredit({ todayChangePercent: 7.45, regime: 'R4_NEUTRAL' });
    expect(r.bonus).toBe(0);
    expect(r.applied).toBe(false);
    expect(r.reason).toContain('REGIME_NOT_RISK_ON');
  });

  it('flag ON + regime undefined → bonus 0', () => {
    process.env.GATE1_REVERSAL_MOMENTUM_ENABLED = 'true';
    const r = computeReversalMomentumCredit({ todayChangePercent: 7.45, regime: undefined });
    expect(r.bonus).toBe(0);
    expect(r.reason).toContain('REGIME_NOT_RISK_ON');
  });

  it.each(['R1_TURBO', 'R2_BULL', 'R3_EARLY'])(
    'flag ON + risk-on regime %s + changePercent in band → bonus > 0',
    (regime) => {
      process.env.GATE1_REVERSAL_MOMENTUM_ENABLED = 'true';
      const r = computeReversalMomentumCredit({ todayChangePercent: 7.45, regime });
      expect(r.bonus).toBeGreaterThan(0);
      expect(r.applied).toBe(true);
    },
  );
});

describe('ADR-0594 computeReversalMomentumCredit — today change input', () => {
  it('changePercent undefined → bonus 0 (보수, 불변식 #6 결손≠signal)', () => {
    process.env.GATE1_REVERSAL_MOMENTUM_ENABLED = 'true';
    const r = computeReversalMomentumCredit({ todayChangePercent: undefined, regime: RISK_ON });
    expect(r.bonus).toBe(0);
    expect(r.reason).toBe('TODAY_CHANGE_PERCENT_MISSING');
  });

  it('changePercent NaN/Infinity → bonus 0', () => {
    process.env.GATE1_REVERSAL_MOMENTUM_ENABLED = 'true';
    expect(computeReversalMomentumCredit({ todayChangePercent: NaN, regime: RISK_ON }).bonus).toBe(0);
    expect(computeReversalMomentumCredit({ todayChangePercent: Infinity, regime: RISK_ON }).bonus).toBe(0);
  });

  it('changePercent < T_min (3.0) → bonus 0 (noise floor)', () => {
    process.env.GATE1_REVERSAL_MOMENTUM_ENABLED = 'true';
    const r = computeReversalMomentumCredit({ todayChangePercent: 2.99, regime: RISK_ON });
    expect(r.bonus).toBe(0);
    expect(r.reason).toContain('BELOW_T_MIN');
  });

  it('changePercent === T_min (3.0) → bonus 0 (시작점, span 0 기여)', () => {
    process.env.GATE1_REVERSAL_MOMENTUM_ENABLED = 'true';
    const r = computeReversalMomentumCredit({ todayChangePercent: 3.0, regime: RISK_ON });
    expect(r.bonus).toBe(0);
  });

  it('negative changePercent (하락) → bonus 0', () => {
    process.env.GATE1_REVERSAL_MOMENTUM_ENABLED = 'true';
    const r = computeReversalMomentumCredit({ todayChangePercent: -5, regime: RISK_ON });
    expect(r.bonus).toBe(0);
  });
});

describe('ADR-0594 computeReversalMomentumCredit — linear band + cap', () => {
  it('T_min~T_cap 선형 가산: 중간점(7.5%)에서 ~MAX_BONUS/2', () => {
    process.env.GATE1_REVERSAL_MOMENTUM_ENABLED = 'true';
    // T_min=3, T_cap=12, MAX_BONUS=8 → midpoint c=7.5 → 8*(7.5-3)/9 = 4.0
    const r = computeReversalMomentumCredit({ todayChangePercent: 7.5, regime: RISK_ON });
    expect(r.bonus).toBeCloseTo(4.0, 5);
    expect(r.reason).toContain('LINEAR');
  });

  it('선형 단조 증가: 더 큰 changePercent → 더 큰 bonus', () => {
    process.env.GATE1_REVERSAL_MOMENTUM_ENABLED = 'true';
    const low = computeReversalMomentumCredit({ todayChangePercent: 5, regime: RISK_ON }).bonus;
    const high = computeReversalMomentumCredit({ todayChangePercent: 10, regime: RISK_ON }).bonus;
    expect(high).toBeGreaterThan(low);
  });

  it('changePercent === T_cap (12.0) → MAX_BONUS cap', () => {
    process.env.GATE1_REVERSAL_MOMENTUM_ENABLED = 'true';
    const r = computeReversalMomentumCredit({ todayChangePercent: 12.0, regime: RISK_ON });
    expect(r.bonus).toBe(8);
    expect(r.reason).toContain('CAP');
  });

  it('changePercent > T_cap (과급등 20%) → MAX_BONUS cap (역가산 아님)', () => {
    process.env.GATE1_REVERSAL_MOMENTUM_ENABLED = 'true';
    const r = computeReversalMomentumCredit({ todayChangePercent: 20, regime: RISK_ON });
    expect(r.bonus).toBe(8);
    expect(r.applied).toBe(true);
    expect(r.reason).toContain('CAP');
  });

  it('bonus 는 항상 0~MAX_BONUS 범위', () => {
    process.env.GATE1_REVERSAL_MOMENTUM_ENABLED = 'true';
    for (const c of [3, 4, 6, 8, 11.9, 12, 15, 50]) {
      const b = computeReversalMomentumCredit({ todayChangePercent: c, regime: RISK_ON }).bonus;
      expect(b).toBeGreaterThanOrEqual(0);
      expect(b).toBeLessThanOrEqual(8);
    }
  });
});

describe('ADR-0594 ENV overrides + helper guards', () => {
  it('defaults: T_min=3.0 / T_cap=12.0 / MAX_BONUS=8', () => {
    expect(gate1ReversalMomentumTMinPct()).toBe(3.0);
    expect(gate1ReversalMomentumTCapPct()).toBe(12.0);
    expect(gate1ReversalMomentumMaxBonus()).toBe(8);
  });

  it('ENV 오버라이드 반영', () => {
    process.env.GATE1_REVERSAL_MOMENTUM_T_MIN_PCT = '2';
    process.env.GATE1_REVERSAL_MOMENTUM_T_CAP_PCT = '10';
    process.env.GATE1_REVERSAL_MOMENTUM_MAX_BONUS = '6';
    expect(gate1ReversalMomentumTMinPct()).toBe(2);
    expect(gate1ReversalMomentumTCapPct()).toBe(10);
    expect(gate1ReversalMomentumMaxBonus()).toBe(6);
  });

  it('비유한/비양수 ENV → default 폴백 (유한성 가드)', () => {
    process.env.GATE1_REVERSAL_MOMENTUM_T_MIN_PCT = 'abc';
    process.env.GATE1_REVERSAL_MOMENTUM_T_CAP_PCT = '-5';
    process.env.GATE1_REVERSAL_MOMENTUM_MAX_BONUS = '0';
    expect(gate1ReversalMomentumTMinPct()).toBe(3.0);
    expect(gate1ReversalMomentumTCapPct()).toBe(12.0);
    expect(gate1ReversalMomentumMaxBonus()).toBe(8);
  });

  it('flag 정확 비교(=== true): 다른 truthy 문자열은 OFF', () => {
    process.env.GATE1_REVERSAL_MOMENTUM_ENABLED = '1';
    expect(isGate1ReversalMomentumEnabled()).toBe(false);
    process.env.GATE1_REVERSAL_MOMENTUM_ENABLED = 'TRUE';
    expect(isGate1ReversalMomentumEnabled()).toBe(false);
    process.env.GATE1_REVERSAL_MOMENTUM_ENABLED = 'true';
    expect(isGate1ReversalMomentumEnabled()).toBe(true);
  });
});
