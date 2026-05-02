/**
 * positionSizingEngine.test.ts
 *
 * 2차 고도화 프롬프트의 12개 테스트 케이스를 검증한다.
 * 실행: npx vitest run server/trading/sizing/positionSizingEngine.test.ts
 */

import { describe, expect, it } from 'vitest';
import { computeFinalPosition } from './positionSizingEngine.js';
import { getLossStreakMultiplier, recordLoss } from './coolingOffEngine.js';
import type { PositionSizingInput } from './positionSizingEngine.js';
import type { LossStreakState } from './coolingOffEngine.js';

// ─── 기본 입력 팩토리 ────────────────────────────────────────────────────────

const defaultLossStreak: LossStreakState = {
  consecutiveLosses: 0,
  lastLossDate: null,
  coolOffUntil: null,
};

const normalInput: Omit<PositionSizingInput, 'accountEquity' | 'peakEquity' | 'signalGrade' | 'stopLossPct'> = {
  regimeMultiplier: 1.0,
  confidenceMultiplier: 1.0,
  rrrMultiplier: 1.0,
  correlationMultiplier: 1.0,
  lossStreakState: defaultLossStreak,
  avgDailyVolume20d: 50_000_000_000,   // 500억
  marketCap: 5_000_000_000_000,        // 5조
  isAdminStock: false,
  isInvestmentWarning: false,
  currentSectorWeight: 0.05,
  maxSectorWeight: 0.30,
  isNormalRegime: true,
  rrrAbove2_5: true,
  enemyChecklistPassed: true,
  highDataReliability: true,
  gate1AllPassed: true,
  notInDowntrend: true,
};

function makeInput(
  equity: number,
  grade: PositionSizingInput['signalGrade'],
  stopLoss = 0.08,
  overrides: Partial<PositionSizingInput> = {},
): PositionSizingInput {
  return {
    ...normalInput,
    accountEquity: equity,
    peakEquity: equity * 1.0, // 고점 = 현재 (드로우다운 없음)
    signalGrade: grade,
    stopLossPct: stopLoss,
    ...overrides,
  };
}

// ─── 테스트 케이스 ───────────────────────────────────────────────────────────

describe('포지션 사이징 엔진 — 2차 고도화 12개 테스트 케이스', () => {

  // TC1: 계좌 300만 원, CONFIRMED_STRONG_BUY, 정상 레짐, 손절폭 7%
  it('TC1: MICRO 300만 / CONFIRMED_STRONG_BUY / 손절 7% → 비중 25~30%, 손실 ≤2.0%', () => {
    const result = computeFinalPosition(makeInput(3_000_000, 'CONFIRMED_STRONG_BUY', 0.07));
    const pct = result.finalPositionPct;
    expect(result.blocked).toBe(false);
    expect(pct).toBeGreaterThanOrEqual(0.25);
    expect(pct).toBeLessThanOrEqual(0.30);
    expect(result.expectedStopLossDamagePct).toBeLessThanOrEqual(0.020);
  });

  // TC2: 계좌 800만 원, STRONG_BUY, 정상 레짐, 손절폭 8%
  it('TC2: SMALL 800만 / STRONG_BUY / 손절 8% → 비중 15~20%, 손실 ≤1.7%', () => {
    const result = computeFinalPosition(makeInput(8_000_000, 'STRONG_BUY', 0.08));
    const pct = result.finalPositionPct;
    expect(result.blocked).toBe(false);
    expect(pct).toBeGreaterThanOrEqual(0.14);
    expect(pct).toBeLessThanOrEqual(0.20);
    expect(result.expectedStopLossDamagePct).toBeLessThanOrEqual(0.017);
  });

  // TC3: 계좌 1,500만 원, STRONG_BUY, 정상 레짐
  it('TC3: GROWTH 1500만 / STRONG_BUY → 비중 10~15%', () => {
    const result = computeFinalPosition(makeInput(15_000_000, 'STRONG_BUY'));
    const pct = result.finalPositionPct;
    expect(result.blocked).toBe(false);
    expect(pct).toBeGreaterThanOrEqual(0.09);
    expect(pct).toBeLessThanOrEqual(0.15);
  });

  // TC4: 계좌 5,000만 원, STRONG_BUY, 정상 레짐
  it('TC4: BALANCED 5000만 / STRONG_BUY → 비중 8~12%', () => {
    const result = computeFinalPosition(makeInput(50_000_000, 'STRONG_BUY'));
    const pct = result.finalPositionPct;
    expect(result.blocked).toBe(false);
    expect(pct).toBeGreaterThanOrEqual(0.08);
    expect(pct).toBeLessThanOrEqual(0.12);
  });

  // TC5: 계좌 1억 원, STRONG_BUY, 정상 레짐
  it('TC5: DEFENSIVE 1억 / STRONG_BUY → 비중 5~8%', () => {
    const result = computeFinalPosition(makeInput(100_000_000, 'STRONG_BUY'));
    const pct = result.finalPositionPct;
    expect(result.blocked).toBe(false);
    expect(pct).toBeGreaterThanOrEqual(0.04);
    expect(pct).toBeLessThanOrEqual(0.08);
  });

  // TC6: 계좌 3억 원, CONFIRMED_STRONG_BUY, 정상 레짐
  it('TC6: CAPITAL_PRESERVATION 3억 / CONFIRMED_STRONG_BUY → 비중 6~8%', () => {
    const result = computeFinalPosition(makeInput(300_000_000, 'CONFIRMED_STRONG_BUY'));
    const pct = result.finalPositionPct;
    expect(result.blocked).toBe(false);
    expect(pct).toBeGreaterThanOrEqual(0.05);
    expect(pct).toBeLessThanOrEqual(0.08);
  });

  // TC7: 계좌 300만 원, 3연속 손절
  it('TC7: MICRO 300만 / 3연속 손절 → 포지션 40% 축소 (multiplier ≤0.6)', () => {
    let streakState = defaultLossStreak;
    streakState = recordLoss(streakState);
    streakState = recordLoss(streakState);
    streakState = recordLoss(streakState);

    const result = computeFinalPosition(
      makeInput(3_000_000, 'CONFIRMED_STRONG_BUY', 0.07, { lossStreakState: streakState }),
    );
    expect(result.lossStreakMultiplier).toBeLessThanOrEqual(0.6);
    expect(result.blocked).toBe(false);
  });

  // TC8: 계좌 300만 원, 5연속 손절 → 신규 매수 차단
  it('TC8: MICRO 300만 / 5연속 손절 → 신규 매수 차단', () => {
    let streakState = defaultLossStreak;
    for (let i = 0; i < 5; i++) {
      streakState = recordLoss(streakState);
    }
    const result = computeFinalPosition(
      makeInput(3_000_000, 'CONFIRMED_STRONG_BUY', 0.07, { lossStreakState: streakState }),
    );
    expect(result.blocked).toBe(true);
    expect(result.finalPosition).toBe(0);
  });

  // TC9: 계좌 3억 원, 유동성 사용률 1% 초과
  it('TC9: CAPITAL_PRESERVATION / 유동성 사용률 과다 → 감액 적용', () => {
    const equity = 300_000_000;
    // 기본 비중 7% = 2,100만 원 / 거래대금 5억 → 사용률 4.2% (임계값 0.5% 초과)
    const result = computeFinalPosition(
      makeInput(equity, 'CONFIRMED_STRONG_BUY', 0.07, {
        avgDailyVolume20d: 500_000_000, // 5억 (매우 낮음)
      }),
    );
    expect(result.liquidityMultiplier).toBeLessThan(1.0);
  });

  // TC10: 계좌 800만 원, RRR < 2.0 → 진입 금지 (rrrMultiplier = 0)
  it('TC10: SMALL 800만 / RRR < 2.0 (rrrMultiplier=0) → finalPosition=0', () => {
    const result = computeFinalPosition(
      makeInput(8_000_000, 'STRONG_BUY', 0.08, { rrrMultiplier: 0 }),
    );
    // rrrMultiplier=0이면 signalBasedPosition=0, finalPosition=0
    expect(result.finalPosition).toBe(0);
  });

  // TC11: 계좌 800만 원, CRISIS 레짐 → 진입 금지 (regimeMultiplier = 0)
  it('TC11: SMALL 800만 / CRISIS 레짐 (regimeMultiplier=0) → finalPosition=0', () => {
    const result = computeFinalPosition(
      makeInput(8_000_000, 'STRONG_BUY', 0.08, { regimeMultiplier: 0 }),
    );
    expect(result.finalPosition).toBe(0);
  });

  // TC12: getLossStreakMultiplier 직접 검증
  it('TC12: 5연속 손절 상태 → getLossStreakMultiplier blocked=true', () => {
    let state = defaultLossStreak;
    for (let i = 0; i < 5; i++) {
      state = recordLoss(state);
    }
    const result = getLossStreakMultiplier(state);
    expect(result.blocked).toBe(true);
    expect(result.multiplier).toBe(0);
  });

});

describe('계좌 규모별 티어 경계 검증', () => {
  it('499만 원 → MICRO 티어', () => {
    const result = computeFinalPosition(makeInput(4_990_000, 'BUY'));
    expect(result.tier.name).toBe('MICRO');
  });

  it('500만 원 → SMALL 티어', () => {
    const result = computeFinalPosition(makeInput(5_000_000, 'BUY'));
    expect(result.tier.name).toBe('SMALL');
  });

  it('1,000만 원 → GROWTH 티어', () => {
    const result = computeFinalPosition(makeInput(10_000_000, 'BUY'));
    expect(result.tier.name).toBe('GROWTH');
  });

  it('3,000만 원 → BALANCED 티어', () => {
    const result = computeFinalPosition(makeInput(30_000_000, 'BUY'));
    expect(result.tier.name).toBe('BALANCED');
  });

  it('1억 원 → DEFENSIVE 티어', () => {
    const result = computeFinalPosition(makeInput(100_000_000, 'BUY'));
    expect(result.tier.name).toBe('DEFENSIVE');
  });

  it('3억 원 → CAPITAL_PRESERVATION 티어', () => {
    const result = computeFinalPosition(makeInput(300_000_000, 'BUY'));
    expect(result.tier.name).toBe('CAPITAL_PRESERVATION');
  });
});

describe('섹터 감쇄 함수 경계값 검증', () => {
  it('섹터 노출 15% (경고 구간 이하) → 감액 없음', () => {
    const result = computeFinalPosition(
      makeInput(50_000_000, 'STRONG_BUY', 0.08, { currentSectorWeight: 0.15 }),
    );
    expect(result.sectorExposureMultiplier).toBe(1.0);
  });

  it('섹터 노출 30% 이상 → 차단', () => {
    const result = computeFinalPosition(
      makeInput(50_000_000, 'STRONG_BUY', 0.08, { currentSectorWeight: 0.30 }),
    );
    expect(result.blocked).toBe(true);
  });
});
