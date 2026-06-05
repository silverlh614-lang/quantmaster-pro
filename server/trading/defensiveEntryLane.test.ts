import { describe, it, expect } from 'vitest';
import {
  evaluateDefensiveEntryLane,
  isDefensiveEntryLaneEnabled,
  type DefensiveEntryInput,
  DEFENSE_KELLY_MULT,
  PANIC_KELLY_MULT,
} from './defensiveEntryLane.js';

// 적격 후보 기준선: 60일고점 10000 대비 현재가 7500(−25%), RSI 28, RS +3%(덜빠짐), 부채 80%, ROE 12%, 대형.
function passingInput(over: Partial<DefensiveEntryInput> = {}): DefensiveEntryInput {
  return {
    currentPrice: 7500,
    high60d: 10000,
    rsi14: 28,
    relativeReturn20d: 3,
    debtRatio: 80,
    roe: 12,
    marketCapTier: 'LARGE',
    regime: 'DEFENSE',
    ...over,
  };
}

describe('defensiveEntryLane (ADR-0575 Phase1)', () => {
  it('세 축 전부 충족 → qualifies + DEFENSE Kelly ×0.30', () => {
    const v = evaluateDefensiveEntryLane(passingInput());
    expect(v.qualifies).toBe(true);
    expect(v.criteria).toEqual({ quality: true, oversold: true, rsDefense: true });
    expect(v.reducedKellyMultiplier).toBe(DEFENSE_KELLY_MULT);
  });

  it('PANIC → 더 축소 Kelly ×0.15', () => {
    const v = evaluateDefensiveEntryLane(passingInput({ regime: 'PANIC' }));
    expect(v.qualifies).toBe(true);
    expect(v.reducedKellyMultiplier).toBe(PANIC_KELLY_MULT);
  });

  it('과매도 미달(고점 −15%만) → 탈락', () => {
    const v = evaluateDefensiveEntryLane(passingInput({ currentPrice: 8500 })); // −15%
    expect(v.criteria.oversold).toBe(false);
    expect(v.qualifies).toBe(false);
  });

  it('RSI 과매도 아님(40) → 탈락', () => {
    const v = evaluateDefensiveEntryLane(passingInput({ rsi14: 40 }));
    expect(v.criteria.oversold).toBe(false);
    expect(v.qualifies).toBe(false);
  });

  it('RS 방어 실패(시장보다 더 빠짐, −5%) → 탈락', () => {
    const v = evaluateDefensiveEntryLane(passingInput({ relativeReturn20d: -5 }));
    expect(v.criteria.rsDefense).toBe(false);
    expect(v.qualifies).toBe(false);
  });

  it('재무 미상(debtRatio/roe null) → 보수적 탈락', () => {
    const v = evaluateDefensiveEntryLane(passingInput({ debtRatio: null, roe: null }));
    expect(v.criteria.quality).toBe(false);
    expect(v.qualifies).toBe(false);
  });

  it('부채과다(200%)·적자(ROE −5) → quality 탈락', () => {
    expect(evaluateDefensiveEntryLane(passingInput({ debtRatio: 200 })).criteria.quality).toBe(false);
    expect(evaluateDefensiveEntryLane(passingInput({ roe: -5 })).criteria.quality).toBe(false);
  });

  it('시총 비대형(SMALL) → quality 탈락', () => {
    const v = evaluateDefensiveEntryLane(passingInput({ marketCapTier: 'SMALL' }));
    expect(v.criteria.quality).toBe(false);
  });

  it('시총 미상(null) → 재무로만 판단(통과 가능)', () => {
    const v = evaluateDefensiveEntryLane(passingInput({ marketCapTier: null }));
    expect(v.criteria.quality).toBe(true);
    expect(v.qualifies).toBe(true);
  });

  it('flag helper: DEFENSIVE_ENTRY_LANE_ENABLED default OFF', () => {
    const prev = process.env.DEFENSIVE_ENTRY_LANE_ENABLED;
    try {
      delete process.env.DEFENSIVE_ENTRY_LANE_ENABLED;
      expect(isDefensiveEntryLaneEnabled()).toBe(false);
      process.env.DEFENSIVE_ENTRY_LANE_ENABLED = 'true';
      expect(isDefensiveEntryLaneEnabled()).toBe(true);
      process.env.DEFENSIVE_ENTRY_LANE_ENABLED = 'false';
      expect(isDefensiveEntryLaneEnabled()).toBe(false);
    } finally {
      if (prev === undefined) delete process.env.DEFENSIVE_ENTRY_LANE_ENABLED;
      else process.env.DEFENSIVE_ENTRY_LANE_ENABLED = prev;
    }
  });
});
