/**
 * @responsibility StockRecommendation.checklist 27 named field → ConditionId 점수 단방향 매핑
 *
 * ADR-0018 (PR-A): TradeRecordModal 이 evaluateStock() 재호출 없이 추천 시점에
 * 이미 계산된 27조건 점수를 무손실 변환하기 위한 adapter. CONDITION_SOURCE_MAP
 * 동봉으로 AI/COMPUTED 분류도 함께 전달.
 */
import type { ConditionId } from '../../types/core';
import type { StockRecommendation } from '../stock/types';
import { CONDITION_SOURCE_MAP } from './evolutionEngine';

type ChecklistKey = keyof StockRecommendation['checklist'];

/**
 * StockRecommendation.checklist 의 27 named field → ConditionId 매핑.
 *
 * ADR-0018 §2 — 매핑 테이블의 단일 SSOT. checklist 필드 순서가 27조건 ID 1~27 과
 * 의미상 일치하지만 명시적으로 ID 별 매핑을 적어 변경 시 drift 위험 차단.
 */
export const CHECKLIST_TO_CONDITION_ID: Record<ChecklistKey, ConditionId> = {
  cycleVerified: 1,
  momentumRanking: 2,
  roeType3: 3,
  supplyInflow: 4,
  riskOnEnvironment: 5,
  ichimokuBreakout: 6,
  mechanicalStop: 7,
  economicMoatVerified: 8,
  notPreviousLeader: 9,
  technicalGoldenCross: 10,
  volumeSurgeVerified: 11,
  institutionalBuying: 12,
  consensusTarget: 13,
  earningsSurprise: 14,
  performanceReality: 15,
  policyAlignment: 16,
  psychologicalObjectivity: 17,
  turtleBreakout: 18,
  fibonacciLevel: 19,
  elliottWaveVerified: 20,
  ocfQuality: 21,
  marginAcceleration: 22,
  interestCoverage: 23,
  relativeStrength: 24,
  vcpPattern: 25,
  divergenceCheck: 26,
  catalystAnalysis: 27,
};

/**
 * StockRecommendation.checklist 를 conditionScores 맵으로 변환한다.
 *
 * - 누락/undefined/NaN 필드는 0 fallback
 * - 음수는 0 으로 클램프 (학습 입력 위생)
 * - 값 범위 검증은 호출자 책임 (일반적으로 0~10)
 *
 * @param checklist StockRecommendation.checklist (필수 27 필드, 일부 undefined 허용)
 * @returns Record<ConditionId(1~27), number(≥0)>
 */
export function checklistToConditionScores(
  checklist: StockRecommendation['checklist'] | undefined,
): Record<ConditionId, number> {
  const result = {} as Record<ConditionId, number>;
  if (!checklist) {
    for (let i = 1; i <= 27; i++) {
      result[i as ConditionId] = 0;
    }
    return result;
  }
  for (const [key, conditionId] of Object.entries(CHECKLIST_TO_CONDITION_ID)) {
    const raw = (checklist as Record<string, unknown>)[key];
    const num = typeof raw === 'number' ? raw : Number(raw);
    result[conditionId as ConditionId] = Number.isFinite(num) && num > 0 ? num : 0;
  }
  return result;
}

/**
 * conditionScores 와 함께 사용할 source 맵을 반환한다.
 * 단순 wrapping 으로 호출자가 evolutionEngine 의 SSOT 임포트 경로를 의식하지
 * 않도록 한다. (PR-C 에서 source 별 학습 가중치 차등화의 입력이 됨)
 */
export function getConditionSources(): Record<ConditionId, 'COMPUTED' | 'AI'> {
  return { ...CONDITION_SOURCE_MAP };
}

/**
 * Gate 1/2/3 별 통과 조건 ID 목록.
 *
 * ADR-0018 §3 — TradeRecordModal 에서 evaluateStock() 재호출 없이 gate scores
 * 근사치를 계산하기 위한 매핑. evaluateStock 의 정확한 점수가 아니라 "5점 이상
 * 통과한 조건 수 × 5점" 으로 계산하므로 실제 EvaluationResult 와 다를 수 있다.
 */
export const GATE1_CONDITION_IDS: ConditionId[] = [1, 2, 3, 5, 7, 9];
export const GATE2_CONDITION_IDS: ConditionId[] = [4, 6, 8, 10, 11, 12, 13, 14, 15, 16, 21, 24];
export const GATE3_CONDITION_IDS: ConditionId[] = [17, 18, 19, 20, 22, 23, 25, 26, 27];

const PASS_THRESHOLD = 5;
const PASS_POINTS = 5;

/**
 * conditionScores 에서 Gate 별 근사 점수를 계산한다.
 * 각 Gate 의 통과 조건(점수 ≥ 5) 개수 × 5 = Gate 점수.
 *
 * @returns { g1, g2, g3, final } — final = g1 + g2 + g3
 */
export function approximateGateScores(
  scores: Record<ConditionId, number>,
): { g1: number; g2: number; g3: number; final: number } {
  const sumPassing = (ids: ConditionId[]) =>
    ids.reduce((s, id) => s + ((scores[id] ?? 0) >= PASS_THRESHOLD ? PASS_POINTS : 0), 0);
  const g1 = sumPassing(GATE1_CONDITION_IDS);
  const g2 = sumPassing(GATE2_CONDITION_IDS);
  const g3 = sumPassing(GATE3_CONDITION_IDS);
  return { g1, g2, g3, final: g1 + g2 + g3 };
}
