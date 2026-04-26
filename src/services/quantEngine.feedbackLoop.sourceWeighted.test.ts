/**
 * @responsibility ADR-0020 — feedbackLoop 의 AI/COMPUTED 차등 학습 회귀 가드
 */
import { describe, it, expect, afterEach } from 'vitest';
import { evaluateFeedbackLoop, CALIBRATION_MIN_TRADES } from './quant/feedbackLoopEngine';
import type { TradeRecord } from '../types/portfolio';
import type { ConditionId } from '../types/quant';

const ORIGINAL_ENV = process.env.LEARNING_SOURCE_WEIGHTING_DISABLED;
afterEach(() => {
  if (ORIGINAL_ENV === undefined) {
    delete process.env.LEARNING_SOURCE_WEIGHTING_DISABLED;
  } else {
    process.env.LEARNING_SOURCE_WEIGHTING_DISABLED = ORIGINAL_ENV;
  }
});

function makeTrade(
  returnPct: number,
  conditionScores: Partial<Record<ConditionId, number>> = {},
): TradeRecord {
  const scores = {} as Record<ConditionId, number>;
  for (let i = 1; i <= 27; i++) scores[i as ConditionId] = conditionScores[i as ConditionId] ?? 0;
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
  };
}

describe('PR-C 회귀: AI 조건은 COMPUTED 의 40% 만 학습 반영', () => {
  it('COMPUTED 조건 (25=VCP) 100% 승률 → +10% (1.0 → 1.10)', () => {
    // 30거래 모두 VCP 점수 8, 모두 승리
    const trades = Array.from({ length: CALIBRATION_MIN_TRADES }, () =>
      makeTrade(5, { 25: 8 }),
    );
    const result = evaluateFeedbackLoop(trades, { 25: 1.0 });
    const cal = result.calibrations.find(c => c.conditionId === 25);
    expect(cal).toBeDefined();
    expect(cal!.source).toBe('COMPUTED');
    expect(cal!.sourceMultiplier).toBe(1.0);
    expect(cal!.direction).toBe('UP');
    expect(cal!.newWeight).toBeCloseTo(1.10, 2);
    expect(cal!.delta).toBeCloseTo(0.10, 2);
  });

  it('AI 조건 (1=주도주 사이클) 100% 승률 → +4% (1.0 → 1.04)', () => {
    const trades = Array.from({ length: CALIBRATION_MIN_TRADES }, () =>
      makeTrade(5, { 1: 8 }),
    );
    const result = evaluateFeedbackLoop(trades, { 1: 1.0 });
    const cal = result.calibrations.find(c => c.conditionId === 1);
    expect(cal).toBeDefined();
    expect(cal!.source).toBe('AI');
    expect(cal!.sourceMultiplier).toBe(0.4);
    expect(cal!.direction).toBe('UP');
    expect(cal!.newWeight).toBeCloseTo(1.04, 2);
    expect(cal!.delta).toBeCloseTo(0.04, 2);
  });

  it('AI 조건 0% 승률 → -4% (1.0 → 0.96)', () => {
    const trades = Array.from({ length: CALIBRATION_MIN_TRADES }, () =>
      makeTrade(-5, { 1: 8 }),
    );
    const result = evaluateFeedbackLoop(trades, { 1: 1.0 });
    const cal = result.calibrations.find(c => c.conditionId === 1);
    expect(cal!.direction).toBe('DOWN');
    expect(cal!.newWeight).toBeCloseTo(0.96, 2);
  });

  it('COMPUTED 조건 0% 승률 → -10% (1.0 → 0.90)', () => {
    const trades = Array.from({ length: CALIBRATION_MIN_TRADES }, () =>
      makeTrade(-5, { 25: 8 }),
    );
    const result = evaluateFeedbackLoop(trades, { 25: 1.0 });
    const cal = result.calibrations.find(c => c.conditionId === 25);
    expect(cal!.direction).toBe('DOWN');
    expect(cal!.newWeight).toBeCloseTo(0.90, 2);
  });

  it('LEARNING_SOURCE_WEIGHTING_DISABLED=true 면 AI 도 ±10% (롤백 동작)', () => {
    process.env.LEARNING_SOURCE_WEIGHTING_DISABLED = 'true';
    const trades = Array.from({ length: CALIBRATION_MIN_TRADES }, () =>
      makeTrade(5, { 1: 8 }),
    );
    const result = evaluateFeedbackLoop(trades, { 1: 1.0 });
    const cal = result.calibrations.find(c => c.conditionId === 1);
    expect(cal!.sourceMultiplier).toBe(1.0); // 차등 미적용
    expect(cal!.newWeight).toBeCloseTo(1.10, 2);
  });

  it('승률 50% (boundary) → 변화 없음, source 와 무관', () => {
    const wins = Array.from({ length: 15 }, () => makeTrade(5, { 1: 8 }));
    const losses = Array.from({ length: 15 }, () => makeTrade(-5, { 1: 8 }));
    const result = evaluateFeedbackLoop([...wins, ...losses], { 1: 1.0 });
    const cal = result.calibrations.find(c => c.conditionId === 1);
    expect(cal!.direction).toBe('STABLE');
    expect(cal!.newWeight).toBe(1.0);
    expect(cal!.delta).toBe(0);
  });

  it('가중치 clamp 0.5~1.5 그대로 유지 (AI 조건 누적 보정)', () => {
    // AI 조건 prevWeight 0.55 + 100% 승률 → +0.04 → 0.59 (1.5 clamp 무관)
    const trades = Array.from({ length: CALIBRATION_MIN_TRADES }, () =>
      makeTrade(5, { 1: 8 }),
    );
    const result = evaluateFeedbackLoop(trades, { 1: 0.55 });
    const cal = result.calibrations.find(c => c.conditionId === 1);
    expect(cal!.newWeight).toBeCloseTo(0.59, 2);

    // AI 0% 승률에서 prev=0.55 → -0.04 → 0.51 (0.5 clamp 무관)
    const lossTrades = Array.from({ length: CALIBRATION_MIN_TRADES }, () =>
      makeTrade(-5, { 1: 8 }),
    );
    const lossResult = evaluateFeedbackLoop(lossTrades, { 1: 0.55 });
    const lossCal = lossResult.calibrations.find(c => c.conditionId === 1);
    expect(lossCal!.newWeight).toBeCloseTo(0.51, 2);

    // 0.5 clamp boundary — AI 0% 승률에서 prev=0.52 → 0.52-0.04=0.48 → clamp 0.5
    const clampResult = evaluateFeedbackLoop(lossTrades, { 1: 0.52 });
    const clampCal = clampResult.calibrations.find(c => c.conditionId === 1);
    expect(clampCal!.newWeight).toBeCloseTo(0.50, 2); // clamp 적용
  });

  it('trade.conditionSources override — AI 조건이라도 trade-level COMPUTED 면 ±10%', () => {
    const trades = Array.from({ length: CALIBRATION_MIN_TRADES }, () => {
      const t = makeTrade(5, { 1: 8 });
      // 1번 조건을 COMPUTED 로 강제 (실제 SSOT 는 AI)
      t.conditionSources = {} as Record<ConditionId, 'COMPUTED' | 'AI'>;
      t.conditionSources![1] = 'COMPUTED';
      return t;
    });
    const result = evaluateFeedbackLoop(trades, { 1: 1.0 });
    const cal = result.calibrations.find(c => c.conditionId === 1);
    expect(cal!.source).toBe('COMPUTED'); // override 적용
    expect(cal!.sourceMultiplier).toBe(1.0);
    expect(cal!.newWeight).toBeCloseTo(1.10, 2);
  });

  it('conditionSources 부재 (v1 레코드) → 글로벌 SOURCE_MAP fallback 정상', () => {
    const trades = Array.from({ length: CALIBRATION_MIN_TRADES }, () => {
      const t = makeTrade(5, { 1: 8 });
      delete t.conditionSources; // v1 시뮬레이션
      return t;
    });
    const result = evaluateFeedbackLoop(trades, { 1: 1.0 });
    const cal = result.calibrations.find(c => c.conditionId === 1);
    expect(cal!.source).toBe('AI');           // SSOT fallback
    expect(cal!.sourceMultiplier).toBe(0.4);
    expect(cal!.newWeight).toBeCloseTo(1.04, 2);
  });
});
