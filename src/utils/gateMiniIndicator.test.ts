/**
 * @responsibility evaluateGateMini + classifyGateState 회귀 (ADR-0049 PR-Z7)
 */
import { describe, it, expect } from 'vitest';
import {
  evaluateGateMini,
  classifyGateState,
  type GateDotState,
} from './gateMiniIndicator';
import type { StockRecommendation } from '../services/stockService';
import { GATE1_IDS, GATE2_IDS, GATE3_IDS } from '../constants/gateConfig';
import { CONDITION_ID_TO_CHECKLIST_KEY } from '../types/core';

function emptyChecklist(): StockRecommendation['checklist'] {
  // 27 키 모두 0 으로 초기화
  return {
    cycleVerified: 0, momentumRanking: 0, roeType3: 0, supplyInflow: 0, riskOnEnvironment: 0,
    ichimokuBreakout: 0, mechanicalStop: 0, economicMoatVerified: 0, notPreviousLeader: 0,
    technicalGoldenCross: 0, volumeSurgeVerified: 0, institutionalBuying: 0, consensusTarget: 0,
    earningsSurprise: 0, performanceReality: 0, policyAlignment: 0, psychologicalObjectivity: 0,
    turtleBreakout: 0, fibonacciLevel: 0, elliottWaveVerified: 0, ocfQuality: 0,
    marginAcceleration: 0, interestCoverage: 0, relativeStrength: 0, vcpPattern: 0,
    divergenceCheck: 0, catalystAnalysis: 0,
  };
}

function makeStock(overrides: Partial<StockRecommendation> = {}): StockRecommendation {
  return {
    code: '005930',
    name: '삼성전자',
    type: 'BUY',
    confidence: '8/10',
    reasons: [],
    riskFactor: '',
    actionPlan: '',
    entryPrice: 70_000,
    targetPrice: 77_000,
    stopLoss: 66_500,
    confidenceScore: 80,
    relatedSectors: [],
    relatedNews: [],
    isLeading: false,
    sectorMomentum: 50,
    relativeStrength: 50,
    capitalScore: 50,
    institutionScore: 50,
    techScore: 50,
    aiSentimentScore: 50,
    chartFitScore: 50,
    riskScore: 50,
    fundamentalScore: 50,
    impactScore: 50,
    catalystScore: 50,
    sectorScore: 50,
    overallTier: 'A',
    isLastTrigger: false,
    momentumTrigger: false,
    economicMoat: false,
    cycleStage: 'EARLY',
    relatedThemes: [],
    catalysts: [],
    riskFlags: [],
    checklist: emptyChecklist(),
    visualReport: { financial: 50, technical: 50, supply: 50, summary: '' },
    ...overrides,
  } as unknown as StockRecommendation;
}

/** 지정된 condition id 들에 score=8 부여 (PASS 기준 충족). */
function setScores(checklist: StockRecommendation['checklist'], ids: readonly number[], score: number): void {
  for (const id of ids) {
    const key = CONDITION_ID_TO_CHECKLIST_KEY[id];
    if (key) {
      (checklist as unknown as Record<string, number>)[key] = score;
    }
  }
}

describe('classifyGateState — ADR-0049 §3.2', () => {
  it('passedRatio ≥ 0.5 → PASS (경계값 포함)', () => {
    expect(classifyGateState(3, 6)).toBe<GateDotState>('PASS');   // 0.5
    expect(classifyGateState(5, 5)).toBe('PASS');                  // 1.0
  });

  it('0.3 ≤ passedRatio < 0.5 → PARTIAL (경계값 포함)', () => {
    expect(classifyGateState(3, 10)).toBe('PARTIAL');             // 0.3
    expect(classifyGateState(2, 5)).toBe('PARTIAL');               // 0.4
  });

  it('0 < passedRatio < 0.3 → FAIL', () => {
    expect(classifyGateState(2, 10)).toBe('FAIL');                 // 0.2
    expect(classifyGateState(1, 5)).toBe('FAIL');                  // 0.2
  });

  it('passedCount = 0 + total > 0 → FAIL', () => {
    expect(classifyGateState(0, 5)).toBe('FAIL');
  });

  it('totalCount = 0 → NA', () => {
    expect(classifyGateState(0, 0)).toBe('NA');
    expect(classifyGateState(3, 0)).toBe('NA');
  });

  it('NaN/Infinity → NA (안전 fallback)', () => {
    expect(classifyGateState(NaN, 5)).toBe('NA');
    expect(classifyGateState(3, NaN)).toBe('NA');
    expect(classifyGateState(Infinity, 5)).toBe('NA');
    expect(classifyGateState(-1, 5)).toBe('NA');
  });
});

describe('evaluateGateMini — ADR-0049 4-Gate 평가', () => {
  it('빈 checklist + gateEvaluation 부재 → 모두 NA', () => {
    const stock = makeStock();
    const summary = evaluateGateMini(stock);
    expect(summary.gates).toHaveLength(4);
    // Gate 0 NA (gateEvaluation 부재)
    expect(summary.gates[0].state).toBe('NA');
    // Gate 1/2/3 — checklist 모두 0 → passedCount=0, totalCount>0 → FAIL
    expect(summary.gates[1].state).toBe('FAIL');
    expect(summary.gates[2].state).toBe('FAIL');
    expect(summary.gates[3].state).toBe('FAIL');
    expect(summary.passCount).toBe(0);
  });

  it('gates 순서 항상 [Gate 0, Gate 1, Gate 2, Gate 3]', () => {
    const stock = makeStock();
    const summary = evaluateGateMini(stock);
    expect(summary.gates.map((g) => g.id)).toEqual([0, 1, 2, 3]);
    expect(summary.gates.map((g) => g.label)).toEqual(['Gate 0', 'Gate 1', 'Gate 2', 'Gate 3']);
  });

  it('Gate 0 — gate1Passed=true → PASS (1/1)', () => {
    const stock = makeStock({ gateEvaluation: { gate1Passed: true } as never });
    const summary = evaluateGateMini(stock);
    expect(summary.gates[0].state).toBe('PASS');
    expect(summary.gates[0].passedCount).toBe(1);
    expect(summary.gates[0].totalCount).toBe(1);
  });

  it('Gate 0 — isPassed=false fallback → FAIL (0/1)', () => {
    const stock = makeStock({ gateEvaluation: { isPassed: false } as never });
    const summary = evaluateGateMini(stock);
    expect(summary.gates[0].state).toBe('FAIL');
    expect(summary.gates[0].passedCount).toBe(0);
  });

  it('Gate 1 — GATE1_IDS 모두 score 8 → PASS (5/5)', () => {
    const checklist = emptyChecklist();
    setScores(checklist, GATE1_IDS, 8);
    const stock = makeStock({ checklist });
    const summary = evaluateGateMini(stock);
    expect(summary.gates[1].state).toBe('PASS');
    expect(summary.gates[1].passedCount).toBe(GATE1_IDS.length);
  });

  it('Gate 2/3 — score 4 (임계 5 미만) → FAIL', () => {
    const checklist = emptyChecklist();
    setScores(checklist, GATE2_IDS, 4);
    setScores(checklist, GATE3_IDS, 4);
    const stock = makeStock({ checklist });
    const summary = evaluateGateMini(stock);
    expect(summary.gates[2].passedCount).toBe(0);
    expect(summary.gates[3].passedCount).toBe(0);
    expect(summary.gates[2].state).toBe('FAIL');
  });

  it('전체 통과 — 4 gate 모두 PASS → passCount=4', () => {
    const checklist = emptyChecklist();
    setScores(checklist, GATE1_IDS, 8);
    setScores(checklist, GATE2_IDS, 8);
    setScores(checklist, GATE3_IDS, 8);
    const stock = makeStock({
      gateEvaluation: { gate1Passed: true } as never,
      checklist,
    });
    const summary = evaluateGateMini(stock);
    expect(summary.passCount).toBe(4);
    expect(summary.gates.every((g) => g.state === 'PASS')).toBe(true);
  });

  it('부분 통과 — Gate 1 만 PASS, 나머지 FAIL → passCount=1', () => {
    const checklist = emptyChecklist();
    setScores(checklist, GATE1_IDS, 8);
    const stock = makeStock({ checklist });
    const summary = evaluateGateMini(stock);
    expect(summary.gates[1].state).toBe('PASS');
    expect(summary.gates[2].state).toBe('FAIL');
    expect(summary.passCount).toBe(1);
  });

  it('NaN score 안전 fallback — 무효 점수 무시', () => {
    const checklist = emptyChecklist();
    // Gate 1 의 일부에 NaN 부여 (Number.isFinite false)
    (checklist as unknown as Record<string, number>).cycleVerified = NaN;
    (checklist as unknown as Record<string, number>).riskOnEnvironment = 8;  // 1개만 PASS
    const stock = makeStock({ checklist });
    const summary = evaluateGateMini(stock);
    expect(summary.gates[1].passedCount).toBe(1);  // 5개 중 1개 통과
    expect(summary.gates[1].state).toBe('FAIL');    // 1/5 = 0.2 → FAIL
  });

  it('PARTIAL tier — Gate 2 절반 통과 (6/12 = 0.5) → PASS', () => {
    const checklist = emptyChecklist();
    setScores(checklist, GATE2_IDS.slice(0, 6), 8);
    const stock = makeStock({ checklist });
    const summary = evaluateGateMini(stock);
    expect(summary.gates[2].state).toBe('PASS');   // 6/12 = 0.5 PASS
  });
});
