// @responsibility stockAnalysisCanon(분석 표시 정본 SSOT) 단위 테스트
import { describe, it, expect } from 'vitest';
import { buildStockAnalysisCanon, conditionView } from './stockAnalysisCanon';
import type { StockRecommendation } from './types';

function stock(partial: Partial<StockRecommendation>): StockRecommendation {
  return { code: 'X', name: 'X', ...partial } as StockRecommendation;
}

describe('conditionView (3-상태)', () => {
  it('검증 tier + 충족 → VERIFIED_PASS (roeType3 은 API 그룹)', () => {
    expect(conditionView(stock({ checklist: { roeType3: true } as any }), 'roeType3').status).toBe('VERIFIED_PASS');
  });
  it('AI 추정 tier + 충족 → AI_PASS (cycleVerified 는 AI 그룹)', () => {
    expect(conditionView(stock({ checklist: { cycleVerified: true } as any }), 'cycleVerified').status).toBe('AI_PASS');
  });
  it('미충족 → FAIL', () => {
    expect(conditionView(stock({ checklist: { roeType3: 0 } as any }), 'roeType3').status).toBe('FAIL');
  });
  it('명시 conditionSourceTiers 가 휴리스틱보다 우선 (AI 항목도 API 로 격상되면 VERIFIED)', () => {
    const s = stock({ checklist: { cycleVerified: true } as any, conditionSourceTiers: { cycleVerified: 'API' } as any });
    expect(conditionView(s, 'cycleVerified').status).toBe('VERIFIED_PASS');
  });
});

describe('buildStockAnalysisCanon', () => {
  it('all-true 라도 레이더는 검증 카테고리만 차오름 ("전부 27/27" 제거)', () => {
    const allTrue: Record<string, boolean> = {};
    for (const k of ['roeType3','earningsSurprise','performanceReality','ocfQuality','marginAcceleration','interestCoverage','economicMoatVerified','momentumRanking','ichimokuBreakout','technicalGoldenCross','volumeSurgeVerified','turtleBreakout','fibonacciLevel','elliottWaveVerified','vcpPattern','divergenceCheck','supplyInflow','institutionalBuying','consensusTarget','cycleVerified','riskOnEnvironment','notPreviousLeader','policyAlignment','mechanicalStop','psychologicalObjectivity','catalystAnalysis']) allTrue[k] = true;
    const canon = buildStockAnalysisCanon(stock({ checklist: allTrue as any }));
    const byName = Object.fromEntries(canon.radar.map((r) => [r.subject, r.A]));
    expect(byName['시장 주도력']).toBe(0); // 전부 AI 추정
    expect(byName['기본적 분석']).toBe(100); // 전부 API
    expect(canon.radar.every((r) => r.A === 100)).toBe(false);
    expect(canon.verifiedPassCount).toBeLessThan(26); // 27/27 부풀림 아님
    expect(canon.metCount).toBeGreaterThan(canon.verifiedPassCount); // AI 충족 > 검증 충족
  });

  it('quantScore 는 gateEvaluation 없어도 fallback 으로 항상 산출 (검색 종목 final score 미표시 방지)', () => {
    const noGate = buildStockAnalysisCanon(stock({ aiConvictionScore: { totalScore: 80 } as any, confidenceScore: 65 }));
    expect(noGate.quantScore).toBe(65); // confidenceScore fallback
    expect(noGate.concordance).not.toBeNull();
    const noGateNoConf = buildStockAnalysisCanon(stock({ aiConvictionScore: { totalScore: 80 } as any }));
    expect(noGateNoConf.quantScore).toBe(80); // ai fallback
  });

  it('gateEvaluation.finalScore 있으면 그 정규화값 사용', () => {
    const withGate = buildStockAnalysisCanon(stock({
      aiConvictionScore: { totalScore: 80 } as any,
      gateEvaluation: { finalScore: 27 } as any, // 27 → normalizeGateFinalScore → 10 → normalized 100
    }));
    expect(withGate.quantScore).toBe(100);
  });
});
