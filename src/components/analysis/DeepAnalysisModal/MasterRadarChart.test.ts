// @responsibility MasterRadarChart 헬퍼 회귀 테스트 (cc 분해 검증)
import { describe, it, expect } from 'vitest';
import { getRadarData, getPassedConditionCount } from './MasterRadarChart';
import type { StockRecommendation } from '../../../services/stockService';

function buildStock(checklist: Partial<StockRecommendation['checklist']>): StockRecommendation {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return { code: 'X', name: 'X', checklist } as any;
}

describe('getRadarData', () => {
  it('5 카테고리 반환 (기본/기술/수급/시장/전략)', () => {
    const data = getRadarData(buildStock({}));
    expect(data).toHaveLength(5);
    expect(data.map((d) => d.subject)).toEqual([
      '기본적 분석',
      '기술적 분석',
      '수급 분석',
      '시장 주도력',
      '전략/심리',
    ]);
  });

  it('각 카테고리 fullMark=100', () => {
    const data = getRadarData(buildStock({}));
    expect(data.every((d) => d.fullMark === 100)).toBe(true);
  });

  it('빈 checklist 시 모든 카테고리 A=0', () => {
    const data = getRadarData(buildStock({}));
    expect(data.every((d) => d.A === 0)).toBe(true);
  });

  it('일부 통과 시 해당 카테고리만 비례 점수', () => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const data = getRadarData(buildStock({ roeType3: true } as any));
    const fundamental = data.find((d) => d.subject === '기본적 분석');
    // 7개 중 1개 통과 = round(100/7) = 14
    expect(fundamental?.A).toBe(14);
  });

  it('전체 true 라도 AI 추정 카테고리는 제외 — 실데이터 검증 tier 만 반영 ("전부 27/27" 부풀림 제거)', () => {
    const allTrue = {
      roeType3: true, earningsSurprise: true, performanceReality: true, ocfQuality: true,
      marginAcceleration: true, interestCoverage: true, economicMoatVerified: true,
      momentumRanking: true, ichimokuBreakout: true, technicalGoldenCross: true,
      volumeSurgeVerified: true, turtleBreakout: true, fibonacciLevel: true,
      elliottWaveVerified: true, vcpPattern: true, divergenceCheck: true,
      supplyInflow: true, institutionalBuying: true, consensusTarget: true,
      cycleVerified: true, riskOnEnvironment: true, notPreviousLeader: true,
      policyAlignment: true, mechanicalStop: true, psychologicalObjectivity: true,
      catalystAnalysis: true,
    };
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const data = getRadarData(buildStock(allTrue as any));
    const byName = Object.fromEntries(data.map((d) => [d.subject, d.A]));
    // conditionSourceTiers 부재 → 휴리스틱 tier. AI 추정 항목(시장 주도력 전부·엘리엇·심리·촉매)은 미검증 제외.
    expect(byName['기본적 분석']).toBe(100); // 7개 전부 API
    expect(byName['기술적 분석']).toBe(89);  // 9개 중 8 계산(엘리엇1 AI 제외)
    expect(byName['수급 분석']).toBe(100);   // 3개 전부 API
    expect(byName['시장 주도력']).toBe(0);   // 4개 전부 AI 추정 → 미검증
    expect(byName['전략/심리']).toBe(33);    // 3개 중 mechanicalStop(API) 1
    // 더 이상 모든 축이 100(전부 27/27)이 아님 — 실데이터 차별화
    expect(data.every((d) => d.A === 100)).toBe(false);
  });
});

describe('getPassedConditionCount', () => {
  it('빈 checklist 시 0', () => {
    expect(getPassedConditionCount(buildStock({}))).toBe(0);
  });

  it('checklist 부재 시 0', () => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    expect(getPassedConditionCount({ code: 'X' } as any)).toBe(0);
  });

  it('truthy 값만 카운트', () => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const stock = buildStock({ roeType3: true, earningsSurprise: false, ocfQuality: true } as any);
    expect(getPassedConditionCount(stock)).toBe(2);
  });
});
