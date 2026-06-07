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

  it('ADR-0582: 본질-AI 항목(촉매·심리·엘리엇)은 verifiability=AI_INTRINSIC', () => {
    expect(conditionView(stock({ checklist: { catalystAnalysis: true } as any }), 'catalystAnalysis').verifiability).toBe('AI_INTRINSIC');
    expect(conditionView(stock({ checklist: { psychologicalObjectivity: true } as any }), 'psychologicalObjectivity').verifiability).toBe('AI_INTRINSIC');
    expect(conditionView(stock({ checklist: { elliottWaveVerified: true } as any }), 'elliottWaveVerified').verifiability).toBe('AI_INTRINSIC');
    expect(conditionView(stock({ checklist: { roeType3: true } as any }), 'roeType3').verifiability).toBe('VERIFIABLE');
  });
});

describe('buildStockAnalysisCanon', () => {
  it('all-true 라도 레이더는 검증 카테고리만 차오름 ("전부 27/27" 제거)', () => {
    const allTrue: Record<string, boolean> = {};
    for (const k of ['roeType3','earningsSurprise','performanceReality','ocfQuality','marginAcceleration','interestCoverage','economicMoatVerified','momentumRanking','ichimokuBreakout','technicalGoldenCross','volumeSurgeVerified','turtleBreakout','fibonacciLevel','elliottWaveVerified','vcpPattern','divergenceCheck','supplyInflow','institutionalBuying','consensusTarget','cycleVerified','riskOnEnvironment','notPreviousLeader','policyAlignment','mechanicalStop','psychologicalObjectivity','catalystAnalysis']) allTrue[k] = true;
    const canon = buildStockAnalysisCanon(stock({ checklist: allTrue as any }));
    const byName = Object.fromEntries(canon.radar.map((r) => [r.subject, r.A]));
    // 가중: 검증=1·AI=0.5. 시장 주도력(전부 AI)=50, 기본적(전부 API 검증)=100.
    expect(byName['시장 주도력']).toBe(50);
    expect(byName['기본적 분석']).toBe(100);
    expect(canon.radar.every((r) => r.A === 100)).toBe(false); // 전부 100(27/27) 아님
    expect(canon.radar.every((r) => r.A === 0)).toBe(false);    // 전부 0(빈 레이더)도 아님
    expect(canon.verifiedPassCount).toBeLessThan(26);
    expect(canon.metCount).toBeGreaterThan(canon.verifiedPassCount);
  });

  it('quantScore 는 gateEvaluation 없어도 fallback 으로 항상 산출 (검색 종목 final score 미표시 방지)', () => {
    const noGate = buildStockAnalysisCanon(stock({ aiConvictionScore: { totalScore: 80 } as any, confidenceScore: 65 }));
    expect(noGate.quantScore).toBe(65); // confidenceScore fallback
    expect(noGate.concordance).not.toBeNull();
    const noGateNoConf = buildStockAnalysisCanon(stock({ aiConvictionScore: { totalScore: 80 } as any }));
    expect(noGateNoConf.quantScore).toBe(80); // ai fallback
  });

  it('concordance 는 quantScore(게이트) 가 아닌 weightedScore(최종 표시) 와 AI 점수를 비교', () => {
    // aiScore 95, confidenceScore 90(=quantScore) 이지만 weightedScore 는 AI_PASS 1건 → 50.
    // 합치도가 quantScore 기준이면 격차 5(EXCELLENT), weightedScore 기준이면 격차 45(POOR).
    const canon = buildStockAnalysisCanon(stock({
      aiConvictionScore: { totalScore: 95 } as any,
      confidenceScore: 90,
      checklist: { cycleVerified: true } as any, // AI_PASS → weightedScore 50
    }));
    expect(canon.weightedScore).toBe(50);
    expect(canon.quantScore).toBe(90);
    expect(canon.concordance.quantScore).toBe(50); // 비교 대상 = weightedScore (최종 표시값)
    expect(canon.concordance.gap).toBe(45);
    expect(canon.concordance.tier).toBe('POOR');
  });

  it('ADR-0582: 본질-AI 는 분모에서 제외 — weightedScore 는 검증가능 항목 기준', () => {
    // 검증가능 1건(roeType3, API=검증) + 본질-AI 1건(catalystAnalysis, 충족).
    // 분모 제외 안 하면 (1 + 0.5)/2×100=75. 제외하면 검증가능 1건만 → 100.
    const s = stock({
      checklist: { roeType3: true, catalystAnalysis: true } as any,
      conditionSourceTiers: { roeType3: 'API' } as any,
    });
    const canon = buildStockAnalysisCanon(s);
    expect(canon.evaluableCount).toBe(1);          // roeType3 만 검증가능
    expect(canon.intrinsicAiCount).toBe(1);        // catalystAnalysis 분리
    expect(canon.intrinsicAiMetCount).toBe(1);
    expect(canon.weightedScore).toBe(100);         // 검증가능 1/1 검증 → 100 (정성 페널티 제거)
  });

  it('gateEvaluation.finalScore 있으면 그 정규화값 사용', () => {
    const withGate = buildStockAnalysisCanon(stock({
      aiConvictionScore: { totalScore: 80 } as any,
      gateEvaluation: { finalScore: 27 } as any, // 27 → normalizeGateFinalScore → 10 → normalized 100
    }));
    expect(withGate.quantScore).toBe(100);
  });
});
