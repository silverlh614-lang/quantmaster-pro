/**
 * @responsibility ADR-0018 e2e — adapter 변환된 conditionScores 가 feedbackLoop 학습에 진입함을 검증
 *
 * PR-A 의 핵심 회귀 가드: TradeRecordModal 이 garbage 입력을 보내던 버그를
 * adapter (checklistToConditionScores) 가 해소했는지를 end-to-end 로 확인한다.
 */
import { describe, it, expect } from 'vitest';
import { evaluateFeedbackLoop, CALIBRATION_MIN_TRADES } from './quant/feedbackLoopEngine';
import { checklistToConditionScores } from './quant/checklistToConditionScores';
import type { TradeRecord } from '../types/portfolio';
import type { ConditionId } from '../types/quant';
import type { StockRecommendation } from './stock/types';

function makeChecklist(
  overrides: Partial<StockRecommendation['checklist']>,
): StockRecommendation['checklist'] {
  const empty = {
    cycleVerified: 0, momentumRanking: 0, roeType3: 0, supplyInflow: 0,
    riskOnEnvironment: 0, ichimokuBreakout: 0, mechanicalStop: 0,
    economicMoatVerified: 0, notPreviousLeader: 0, technicalGoldenCross: 0,
    volumeSurgeVerified: 0, institutionalBuying: 0, consensusTarget: 0,
    earningsSurprise: 0, performanceReality: 0, policyAlignment: 0,
    psychologicalObjectivity: 0, turtleBreakout: 0, fibonacciLevel: 0,
    elliottWaveVerified: 0, ocfQuality: 0, marginAcceleration: 0,
    interestCoverage: 0, relativeStrength: 0, vcpPattern: 0,
    divergenceCheck: 0, catalystAnalysis: 0,
  };
  return { ...empty, ...overrides };
}

function makeTradeFromChecklist(
  returnPct: number,
  checklist: StockRecommendation['checklist'],
): TradeRecord {
  const conditionScores = checklistToConditionScores(checklist);
  return {
    id: `t-${Math.random().toString(36).slice(2, 8)}`,
    stockCode: 'A005930',
    stockName: '삼성전자',
    sector: 'IT',
    buyDate: new Date().toISOString(),
    buyPrice: 70000,
    quantity: 10,
    positionSize: 10,
    systemSignal: 'BUY',
    recommendation: '절반 포지션',
    gate1Score: 10,
    gate2Score: 15,
    gate3Score: 10,
    finalScore: 35,
    conditionScores,
    followedSystem: true,
    returnPct,
    status: 'CLOSED',
    schemaVersion: 2,
  };
}

describe('PR-A 회귀 가드: adapter → feedbackLoop e2e', () => {
  it('checklist 변환 후 conditionScores 로 학습이 진입한다 (이전엔 빈 객체로 영구 비활성)', () => {
    // 30거래 모두 cycleVerified(=조건 1) 점수 8, returnPct +5% (전부 승리)
    const trades = Array.from({ length: CALIBRATION_MIN_TRADES }, () =>
      makeTradeFromChecklist(5, makeChecklist({ cycleVerified: 8 })),
    );

    const result = evaluateFeedbackLoop(trades, { 1: 1.0 });

    expect(result.calibrationActive).toBe(true);
    expect(result.calibrations.length).toBeGreaterThan(0);

    // 조건 1 이 적어도 1개 거래에서 ≥5 통과 → 학습 대상에 포함
    const cal1 = result.calibrations.find(c => c.conditionId === 1);
    expect(cal1).toBeDefined();
    expect(cal1!.tradeCount).toBe(CALIBRATION_MIN_TRADES);
    expect(cal1!.winRate).toBe(1.0);
    expect(cal1!.direction).toBe('UP'); // 100% 승률 > 60% → 가중치 상향
  });

  it('빈 checklist (모두 0) 는 학습 진입 안 됨 — v1 garbage 데이터 자동 배제', () => {
    // 30거래 모두 빈 checklist → conditionScores 27 ID 모두 0
    const trades = Array.from({ length: CALIBRATION_MIN_TRADES }, () =>
      makeTradeFromChecklist(5, makeChecklist({})),
    );

    const result = evaluateFeedbackLoop(trades);

    // 활성은 되지만 조건별 통계가 부족 (≥5 점인 조건 0개) → calibrations[] 비어있음
    expect(result.calibrationActive).toBe(true);
    expect(result.calibrations).toHaveLength(0);
    expect(result.summary).toContain('조건별 데이터 부족');
  });

  it('일부 조건만 학습 진입 — 미통과 조건은 가중치 변경 없음', () => {
    // 조건 1, 2 에만 점수 부여, 나머지는 0
    const trades = Array.from({ length: CALIBRATION_MIN_TRADES }, () =>
      makeTradeFromChecklist(
        5,
        makeChecklist({ cycleVerified: 8, momentumRanking: 7 }),
      ),
    );

    const result = evaluateFeedbackLoop(trades);
    const ids = result.calibrations.map(c => c.conditionId);
    expect(ids).toContain(1 as ConditionId);
    expect(ids).toContain(2 as ConditionId);
    // 나머지 조건은 ≥5 통과 거래가 없어 학습 대상에서 자동 배제
    expect(ids).not.toContain(15 as ConditionId);
    expect(ids).not.toContain(27 as ConditionId);
  });
});
