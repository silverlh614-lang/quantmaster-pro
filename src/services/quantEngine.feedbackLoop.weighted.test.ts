/**
 * @responsibility ADR-0022 — feedbackLoopEngine 의 lossReason 가중평균 학습 회귀 가드
 *
 * Case A (UNCLASSIFIED) / Case B (STOP_TOO_TIGHT) / Case C (OVERHEATED_ENTRY)
 * 시나리오로 동일 60% 승률이라도 lossReason 분포에 따라 가중치 변화량이 달라짐을 검증.
 */
import { describe, it, expect, afterEach } from 'vitest';
import { evaluateFeedbackLoop, CALIBRATION_MIN_TRADES } from './quant/feedbackLoopEngine';
import type { TradeRecord, LossReason } from '../types/portfolio';
import type { ConditionId } from '../types/quant';

const ORIGINAL_ENV = process.env.LEARNING_LOSS_REASON_WEIGHTING_DISABLED;
afterEach(() => {
  if (ORIGINAL_ENV === undefined) {
    delete process.env.LEARNING_LOSS_REASON_WEIGHTING_DISABLED;
  } else {
    process.env.LEARNING_LOSS_REASON_WEIGHTING_DISABLED = ORIGINAL_ENV;
  }
});

function makeTrade(
  returnPct: number,
  conditionScore: number,
  conditionId: ConditionId = 25,
  lossReason?: LossReason,
): TradeRecord {
  const scores = {} as Record<ConditionId, number>;
  for (let i = 1; i <= 27; i++) scores[i as ConditionId] = 0;
  scores[conditionId] = conditionScore;
  return {
    id: `trade-${Math.random().toString(36).slice(2, 8)}`,
    stockCode: 'A005930',
    stockName: '삼성전자',
    sector: 'IT',
    buyDate: new Date().toISOString(),
    buyPrice: 70000,
    quantity: 10,
    positionSize: 10,
    systemSignal: 'BUY',
    recommendation: '절반 포지션',
    gate1Score: 5,
    gate2Score: 5,
    gate3Score: 5,
    finalScore: 150,
    conditionScores: scores,
    followedSystem: true,
    returnPct,
    status: 'CLOSED',
    schemaVersion: 2,
    ...(returnPct < 0 && lossReason ? { lossReason } : {}),
  };
}

describe('PR-E 회귀: lossReason 가중평균 학습', () => {
  it('Case A — 19 승 / 11 패 (lossReason 부재) → COMPUTED winRate 63.3% → +10%', () => {
    // 조건 25 (VCP, COMPUTED) 점수 8 + 19 승 (+5%) / 11 패 (-5%, lossReason 부재)
    // winRate > 0.60 엄격 비교라 18/30=60% 는 STABLE — 19/30=63.3% 로 UP 진입
    const wins = Array.from({ length: 19 }, () => makeTrade(5, 8));
    const losses = Array.from({ length: 11 }, () => makeTrade(-5, 8));
    const result = evaluateFeedbackLoop([...wins, ...losses], { 25: 1.0 });
    const cal = result.calibrations.find(c => c.conditionId === 25);
    expect(cal!.winRate).toBeCloseTo(19 / 30, 4);
    expect(cal!.weightedTradeCount).toBeCloseTo(30, 2); // 모두 1.0
    expect(cal!.rawTradeCount).toBe(30);
    expect(cal!.direction).toBe('UP');
    expect(cal!.newWeight).toBeCloseTo(1.10, 2);
  });

  it('Case B — 18 승 / 12 패 (전부 STOP_TOO_TIGHT) → weighted winRate ≈ 83%', () => {
    // 12 손실 모두 STOP_TOO_TIGHT (multiplier 0.3)
    // weighted_total = 18×1.0 + 12×0.3 = 18 + 3.6 = 21.6
    // weighted_wins = 18, winRate = 18/21.6 ≈ 0.833
    const wins = Array.from({ length: 18 }, () => makeTrade(5, 8));
    const losses = Array.from({ length: 12 }, () => makeTrade(-5, 8, 25, 'STOP_TOO_TIGHT'));
    const result = evaluateFeedbackLoop([...wins, ...losses], { 25: 1.0 });
    const cal = result.calibrations.find(c => c.conditionId === 25);
    expect(cal!.winRate).toBeCloseTo(18 / 21.6, 4);
    expect(cal!.weightedTradeCount).toBeCloseTo(21.6, 2);
    expect(cal!.rawTradeCount).toBe(30);
    expect(cal!.lossReasonBreakdown).toEqual({ STOP_TOO_TIGHT: 12 });
    expect(cal!.direction).toBe('UP'); // 같은 +UP 이지만 confidence 더 높음
    expect(cal!.newWeight).toBeCloseTo(1.10, 2);
  });

  it('Case C — 18 승 / 12 패 (전부 OVERHEATED_ENTRY) → weighted winRate = 50% → STABLE', () => {
    // 12 손실 모두 OVERHEATED_ENTRY (multiplier 1.5)
    // weighted_total = 18×1.0 + 12×1.5 = 18 + 18 = 36
    // weighted_wins = 18, winRate = 18/36 = 0.5
    const wins = Array.from({ length: 18 }, () => makeTrade(5, 8));
    const losses = Array.from({ length: 12 }, () => makeTrade(-5, 8, 25, 'OVERHEATED_ENTRY'));
    const result = evaluateFeedbackLoop([...wins, ...losses], { 25: 1.0 });
    const cal = result.calibrations.find(c => c.conditionId === 25);
    expect(cal!.winRate).toBeCloseTo(0.5, 4);
    expect(cal!.weightedTradeCount).toBeCloseTo(36, 2);
    expect(cal!.lossReasonBreakdown).toEqual({ OVERHEATED_ENTRY: 12 });
    expect(cal!.direction).toBe('STABLE'); // 50% boundary → 변경 없음
    expect(cal!.delta).toBe(0);
  });

  it('Case D — MACRO_SHOCK 손실 다수 → 거의 winRate 100% → +10%', () => {
    // 6 승 / 24 패 (전부 MACRO_SHOCK, multiplier 0.2)
    // weighted_total = 6 + 24×0.2 = 6 + 4.8 = 10.8
    // weighted_wins = 6, winRate = 6/10.8 ≈ 0.555
    // 60% 미달 → STABLE (시장 충격 무시되므로 손실이 학습에 거의 반영 안 됨)
    const wins = Array.from({ length: 6 }, () => makeTrade(5, 8));
    const losses = Array.from({ length: 24 }, () => makeTrade(-8, 8, 25, 'MACRO_SHOCK'));
    const result = evaluateFeedbackLoop([...wins, ...losses], { 25: 1.0 });
    const cal = result.calibrations.find(c => c.conditionId === 25);
    expect(cal!.winRate).toBeCloseTo(6 / 10.8, 4);
    expect(cal!.lossReasonBreakdown).toEqual({ MACRO_SHOCK: 24 });
    // ≈ 0.555 → 60% boundary 미달 + 40% 초과 → STABLE
    expect(cal!.direction).toBe('STABLE');
  });

  it('Case E — 환경변수 disable → 19/11 STOP_TOO_TIGHT 가 weighted 미적용 (raw 63.3%)', () => {
    process.env.LEARNING_LOSS_REASON_WEIGHTING_DISABLED = 'true';
    const wins = Array.from({ length: 19 }, () => makeTrade(5, 8));
    const losses = Array.from({ length: 11 }, () => makeTrade(-5, 8, 25, 'STOP_TOO_TIGHT'));
    const result = evaluateFeedbackLoop([...wins, ...losses], { 25: 1.0 });
    const cal = result.calibrations.find(c => c.conditionId === 25);
    expect(cal!.winRate).toBeCloseTo(19 / 30, 4); // raw 19/30 — multiplier 무력화
    expect(cal!.weightedTradeCount).toBeCloseTo(30, 2); // 모두 1.0
    expect(cal!.direction).toBe('UP');
  });

  it('Case F — 혼합 lossReason: STOP_TOO_TIGHT 6 + UNCLASSIFIED 6', () => {
    // weighted_total = 18 + 6×0.3 + 6×1.0 = 18 + 1.8 + 6 = 25.8
    // weighted_wins = 18, winRate = 18/25.8 ≈ 0.698
    const wins = Array.from({ length: 18 }, () => makeTrade(5, 8));
    const losses1 = Array.from({ length: 6 }, () => makeTrade(-5, 8, 25, 'STOP_TOO_TIGHT'));
    const losses2 = Array.from({ length: 6 }, () => makeTrade(-5, 8, 25, 'UNCLASSIFIED'));
    const result = evaluateFeedbackLoop([...wins, ...losses1, ...losses2], { 25: 1.0 });
    const cal = result.calibrations.find(c => c.conditionId === 25);
    expect(cal!.winRate).toBeCloseTo(18 / 25.8, 4);
    expect(cal!.lossReasonBreakdown).toEqual({ STOP_TOO_TIGHT: 6, UNCLASSIFIED: 6 });
    expect(cal!.direction).toBe('UP');
  });

  it('Case G — 모두 손실 + 전부 STOP_TOO_TIGHT → weighted winRate=0 → -10% DOWN (COMPUTED 25)', () => {
    const losses = Array.from({ length: CALIBRATION_MIN_TRADES }, () =>
      makeTrade(-5, 8, 25, 'STOP_TOO_TIGHT'),
    );
    const result = evaluateFeedbackLoop(losses, { 25: 1.0 });
    const cal = result.calibrations.find(c => c.conditionId === 25);
    expect(cal!.winRate).toBe(0);
    // 30 × 0.3 = 9 weighted total, 0 wins → 0% → DOWN -10% (COMPUTED 25)
    expect(cal!.weightedTradeCount).toBeCloseTo(9, 2);
    expect(cal!.direction).toBe('DOWN');
    expect(cal!.newWeight).toBeCloseTo(0.9, 2);
  });
});

describe('PR-E 0/0 안전 — 표본 부족시 fallback 안전성', () => {
  it('weightedTotal=0 케이스는 발생 안 함 (relevant.length >= 5 가 가드)', () => {
    // MIN_CONDITION_TRADES=5 미달이면 calibration 자체가 진입 안 함
    const trades = Array.from({ length: 4 }, () => makeTrade(-5, 8, 25, 'MACRO_SHOCK'));
    // filler 는 조건 25 점수 0 — relevant 필터에 안 잡힘
    const filler = Array.from({ length: 26 }, () => makeTrade(5, 0));
    const result = evaluateFeedbackLoop([...trades, ...filler]);
    const cal = result.calibrations.find(c => c.conditionId === 25);
    expect(cal).toBeUndefined();
  });
});
