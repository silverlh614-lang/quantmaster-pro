/**
 * @responsibility checklistToConditionScores adapter 회귀 테스트 (ADR-0018 PR-A)
 */
import { describe, it, expect } from 'vitest';
import {
  checklistToConditionScores,
  CHECKLIST_TO_CONDITION_ID,
  approximateGateScores,
  getConditionSources,
  GATE1_CONDITION_IDS,
  GATE2_CONDITION_IDS,
  GATE3_CONDITION_IDS,
} from './checklistToConditionScores';
import type { StockRecommendation } from '../stock/types';
import type { ConditionId } from '../../types/core';

function makeChecklist(
  overrides: Partial<StockRecommendation['checklist']> = {},
): StockRecommendation['checklist'] {
  // 27 필드 모두 0 으로 초기화 후 overrides 적용
  const base = Object.fromEntries(
    Object.keys(CHECKLIST_TO_CONDITION_ID).map(k => [k, 0]),
  ) as StockRecommendation['checklist'];
  return { ...base, ...overrides };
}

describe('CHECKLIST_TO_CONDITION_ID — 매핑 무결성', () => {
  it('27개 ConditionId(1~27) 모두 1회만 매핑된다', () => {
    const ids = Object.values(CHECKLIST_TO_CONDITION_ID);
    expect(ids).toHaveLength(27);
    expect(new Set(ids).size).toBe(27);
    for (let i = 1; i <= 27; i++) {
      expect(ids).toContain(i as ConditionId);
    }
  });
});

describe('checklistToConditionScores', () => {
  it('27개 필드를 ConditionId 점수로 변환한다', () => {
    const checklist = makeChecklist({
      cycleVerified: 8,
      momentumRanking: 9,
      catalystAnalysis: 10,
    });
    const scores = checklistToConditionScores(checklist);
    expect(scores[1]).toBe(8);   // cycleVerified
    expect(scores[2]).toBe(9);   // momentumRanking
    expect(scores[27]).toBe(10); // catalystAnalysis
    // 나머지 24개는 0
    expect(scores[3]).toBe(0);
    expect(scores[26]).toBe(0);
  });

  it('undefined / NaN / 음수 필드는 0 fallback 한다', () => {
    const partial = {
      cycleVerified: undefined,
      momentumRanking: NaN,
      roeType3: -3,
      supplyInflow: 7,
    } as unknown as StockRecommendation['checklist'];
    const scores = checklistToConditionScores(partial);
    expect(scores[1]).toBe(0); // undefined
    expect(scores[2]).toBe(0); // NaN
    expect(scores[3]).toBe(0); // 음수
    expect(scores[4]).toBe(7); // 정상값 보존
  });

  it('checklist 자체가 undefined 면 27 ID 모두 0', () => {
    const scores = checklistToConditionScores(undefined);
    for (let i = 1; i <= 27; i++) {
      expect(scores[i as ConditionId]).toBe(0);
    }
  });

  it('빈 객체 checklist 도 27 ID 모두 0 으로 안전 변환', () => {
    const scores = checklistToConditionScores({} as StockRecommendation['checklist']);
    expect(Object.keys(scores)).toHaveLength(27);
    expect(scores[15]).toBe(0);
  });
});

describe('getConditionSources', () => {
  it('27 ID 모두 COMPUTED 또는 AI 분류를 반환한다', () => {
    const sources = getConditionSources();
    for (let i = 1; i <= 27; i++) {
      expect(['COMPUTED', 'AI']).toContain(sources[i as ConditionId]);
    }
  });

  it('각 호출은 독립 인스턴스 — mutate 가 SSOT 를 오염하지 않는다', () => {
    const a = getConditionSources();
    a[1] = 'AI'; // mutate
    const b = getConditionSources();
    // SSOT 가 AI 로 되었더라도 b 는 새 사본이므로 mutate 가 전파 안 됨
    expect(b).not.toBe(a);
  });
});

describe('approximateGateScores', () => {
  it('Gate ID 분배가 27개 모두 커버 + 중복 없음', () => {
    const all = [...GATE1_CONDITION_IDS, ...GATE2_CONDITION_IDS, ...GATE3_CONDITION_IDS];
    expect(all).toHaveLength(27);
    expect(new Set(all).size).toBe(27);
  });

  it('5점 이상 통과 조건 × 5점 으로 Gate score 합산', () => {
    const scores = {} as Record<ConditionId, number>;
    for (let i = 1; i <= 27; i++) scores[i as ConditionId] = 0;
    // Gate 1 (1,2,3,5,7,9) 중 1, 2 만 통과 → g1 = 10
    scores[1] = 5;
    scores[2] = 8;
    scores[3] = 4; // 미통과
    // Gate 2 (4,6,8,10,11,12,13,14,15,16,21,24) 중 4, 11, 24 통과 → g2 = 15
    scores[4] = 6;
    scores[11] = 9;
    scores[24] = 7;
    // Gate 3 (17,18,19,20,22,23,25,26,27) 중 25, 27 통과 → g3 = 10
    scores[25] = 5;
    scores[27] = 10;

    const gate = approximateGateScores(scores);
    expect(gate.g1).toBe(10);
    expect(gate.g2).toBe(15);
    expect(gate.g3).toBe(10);
    expect(gate.final).toBe(35);
  });

  it('전 조건 0 이면 모든 Gate 점수 0', () => {
    const scores = {} as Record<ConditionId, number>;
    for (let i = 1; i <= 27; i++) scores[i as ConditionId] = 0;
    const gate = approximateGateScores(scores);
    expect(gate).toEqual({ g1: 0, g2: 0, g3: 0, final: 0 });
  });

  it('전 조건 만점(10) 이면 final = 27 × 5 = 135', () => {
    const scores = {} as Record<ConditionId, number>;
    for (let i = 1; i <= 27; i++) scores[i as ConditionId] = 10;
    const gate = approximateGateScores(scores);
    expect(gate.final).toBe(135);
    expect(gate.g1).toBe(GATE1_CONDITION_IDS.length * 5);
    expect(gate.g2).toBe(GATE2_CONDITION_IDS.length * 5);
    expect(gate.g3).toBe(GATE3_CONDITION_IDS.length * 5);
  });
});
