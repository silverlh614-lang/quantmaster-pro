/**
 * @responsibility buildGateCardSummary 테스트 — ADR-0018 §4
 */
import { describe, it, expect } from 'vitest';
import { buildGateCardSummary } from './GateStatusCard';
import type { StockRecommendation } from '../../services/stockService';
import {
  GATE1_IDS, GATE2_IDS, GATE3_IDS,
  CONDITION_PASS_THRESHOLD,
} from '../../constants/gateConfig';
import { CONDITION_ID_TO_CHECKLIST_KEY } from '../../types/core';

const PASS = 7;
const FAIL = 3;

function makeStock(opts: {
  passG1?: number;
  passG2?: number;
  passG3?: number;
  gate0?: boolean;
}): StockRecommendation {
  const checklist: Record<string, number> = {};
  GATE1_IDS.forEach((id, i) => {
    const key = CONDITION_ID_TO_CHECKLIST_KEY[id];
    checklist[key] = i < (opts.passG1 ?? 0) ? PASS : FAIL;
  });
  GATE2_IDS.forEach((id, i) => {
    const key = CONDITION_ID_TO_CHECKLIST_KEY[id];
    checklist[key] = i < (opts.passG2 ?? 0) ? PASS : FAIL;
  });
  GATE3_IDS.forEach((id, i) => {
    const key = CONDITION_ID_TO_CHECKLIST_KEY[id];
    checklist[key] = i < (opts.passG3 ?? 0) ? PASS : FAIL;
  });
  return {
    code: 'X', name: 'X', currentPrice: 100, type: 'NEUTRAL',
    targetPrice: 110, stopLoss: 90,
    checklist: checklist as StockRecommendation['checklist'],
    visualReport: { financial: 0, technical: 0, supply: 0, summary: '' },
    historicalAnalogy: { stockName: '', period: '', similarity: 0, reason: '' },
    anomalyDetection: { type: 'NONE', score: 0, description: '' },
    semanticMapping: { theme: '', keywords: [], relevanceScore: 0, description: '' },
    gateEvaluation: opts.gate0 ? { gate1Passed: true, gate2Passed: false, gate3Passed: false, finalScore: 0, recommendation: '', positionSize: 0 } : undefined,
  } as unknown as StockRecommendation;
}

describe('buildGateCardSummary — ADR-0018 overallVerdict 5분기', () => {
  it('4 PASS (G0+G1+G2+G3) → STRONG_BUY', () => {
    const s = makeStock({ passG1: 5, passG2: 12, passG3: 10, gate0: true });
    const r = buildGateCardSummary(s);
    expect(r.gate0Passed).toBe(true);
    expect(r.gate1.verdict).toBe('PASS');
    expect(r.gate1.passed).toBe(5);
    expect(r.gate1.required).toBe(5);
    expect(r.gate2.verdict).toBe('PASS');
    expect(r.gate3.verdict).toBe('PASS');
    expect(r.overallVerdict).toBe('STRONG_BUY');
  });

  it('3 PASS (G1+G2+G3, gate0=false) → BUY', () => {
    const s = makeStock({ passG1: 5, passG2: 12, passG3: 10, gate0: false });
    const r = buildGateCardSummary(s);
    expect(r.gate0Passed).toBe(false);
    expect(r.overallVerdict).toBe('BUY');
  });

  it('2 PASS (G0+G1, G2/G3 부족) → HOLD', () => {
    const s = makeStock({ passG1: 5, passG2: 4, passG3: 3, gate0: true });
    const r = buildGateCardSummary(s);
    expect(r.gate2.verdict).toBe('FAIL');
    expect(r.gate3.verdict).toBe('FAIL');
    expect(r.overallVerdict).toBe('HOLD');
  });

  it('1 PASS (G1 만, gate0 부재) → CAUTION', () => {
    const s = makeStock({ passG1: 5, passG2: 4, passG3: 3, gate0: false });
    const r = buildGateCardSummary(s);
    expect(r.overallVerdict).toBe('CAUTION');
  });

  it('0 PASS (모두 FAIL) → AVOID', () => {
    const s = makeStock({ passG1: 0, passG2: 0, passG3: 0, gate0: false });
    const r = buildGateCardSummary(s);
    expect(r.gate0Passed).toBe(false);
    expect(r.gate1.verdict).toBe('FAIL');
    expect(r.gate2.verdict).toBe('FAIL');
    expect(r.gate3.verdict).toBe('FAIL');
    expect(r.overallVerdict).toBe('AVOID');
  });

  it('Gate 1 부분통과 (3/5) → FAIL 분류', () => {
    const s = makeStock({ passG1: 3, passG2: 0, passG3: 0, gate0: false });
    const r = buildGateCardSummary(s);
    expect(r.gate1.passed).toBe(3);
    expect(r.gate1.required).toBe(5);
    expect(r.gate1.verdict).toBe('FAIL');
  });

  it('Gate 2 정확히 9/12 (REQUIRED 도달) → PASS', () => {
    const s = makeStock({ passG1: 5, passG2: 9, passG3: 7, gate0: true });
    const r = buildGateCardSummary(s);
    expect(r.gate2.passed).toBe(9);
    expect(r.gate2.required).toBe(9);
    expect(r.gate2.verdict).toBe('PASS');
    expect(r.gate3.passed).toBe(7);
    expect(r.gate3.verdict).toBe('PASS');
    expect(r.overallVerdict).toBe('STRONG_BUY');
  });

  it('checklist 점수가 PASS_THRESHOLD 미만이면 미통과', () => {
    // GATE1_IDS 첫 항목만 명시적으로 4점 (FAIL) 부여
    const s = makeStock({ passG1: 0 });
    const checklist = s.checklist as Record<string, number>;
    const firstKey = CONDITION_ID_TO_CHECKLIST_KEY[GATE1_IDS[0]];
    checklist[firstKey] = CONDITION_PASS_THRESHOLD - 1; // 4
    const r = buildGateCardSummary(s);
    expect(r.gate1.passed).toBe(0);
  });

  it('gateEvaluation.gate1Passed 부재 + isPassed=true → gate0Passed alias 로 사용', () => {
    const s = makeStock({ passG1: 0 });
    // gate1Passed 미지정 (undefined) 상태에서 isPassed=true 만 제공
    s.gateEvaluation = {
      finalScore: 0, recommendation: '', positionSize: 0, isPassed: true,
    } as unknown as StockRecommendation['gateEvaluation'];
    const r = buildGateCardSummary(s);
    expect(r.gate0Passed).toBe(true);
  });

  it('gateEvaluation.gate1Passed=false 명시 → gate0Passed=false (isPassed alias 무시)', () => {
    const s = makeStock({ passG1: 0 });
    s.gateEvaluation = {
      gate1Passed: false, gate2Passed: false, gate3Passed: false,
      finalScore: 0, recommendation: '', positionSize: 0, isPassed: true,
    };
    const r = buildGateCardSummary(s);
    // gate1Passed=false 가 명시된 경우 그 값을 존중 (?? 가 nullish 시에만 fallback)
    expect(r.gate0Passed).toBe(false);
  });
});
