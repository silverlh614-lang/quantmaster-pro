/**
 * @responsibility classifyDataQuality 휴리스틱 단위 테스트 — ADR-0018 §3 fallback
 */
import { describe, it, expect } from 'vitest';
import { classifyDataQuality } from './dataQualityClassifier';
import type { StockRecommendation } from '../services/stockService';

const PASS = 7;
const FAIL = 3;

function makeStock(opts: {
  computedKeys?: number;
  apiKeys?: number;
  aiKeys?: number;
  dataSourceType?: StockRecommendation['dataSourceType'];
} = {}): StockRecommendation {
  const c = opts.computedKeys ?? 0;
  const a = opts.apiKeys ?? 0;
  const ai = opts.aiKeys ?? 0;
  const computedKeyList = ['ichimokuBreakout', 'technicalGoldenCross', 'volumeSurgeVerified',
    'turtleBreakout', 'fibonacciLevel', 'vcpPattern', 'divergenceCheck', 'momentumRanking', 'relativeStrength'];
  const apiKeyList = ['roeType3', 'economicMoatVerified', 'institutionalBuying', 'consensusTarget',
    'earningsSurprise', 'performanceReality', 'ocfQuality', 'marginAcceleration', 'interestCoverage',
    'supplyInflow', 'mechanicalStop'];
  const aiKeyList = ['cycleVerified', 'riskOnEnvironment', 'notPreviousLeader', 'policyAlignment',
    'psychologicalObjectivity', 'elliottWaveVerified', 'catalystAnalysis'];

  const checklist: Record<string, number> = {};
  computedKeyList.forEach((k, i) => { checklist[k] = i < c ? PASS : FAIL; });
  apiKeyList.forEach((k, i) => { checklist[k] = i < a ? PASS : FAIL; });
  aiKeyList.forEach((k, i) => { checklist[k] = i < ai ? PASS : FAIL; });

  return {
    code: '005930', name: '삼성전자', currentPrice: 70000, type: 'NEUTRAL',
    targetPrice: 80000, stopLoss: 65000,
    checklist: checklist as StockRecommendation['checklist'],
    visualReport: { financial: 5, technical: 5, supply: 5, summary: '' },
    dataSourceType: opts.dataSourceType,
    historicalAnalogy: { stockName: '', period: '', similarity: 0, reason: '' },
    anomalyDetection: { type: 'NONE', score: 0, description: '' },
    semanticMapping: { theme: '', keywords: [], relevanceScore: 0, description: '' },
  } as unknown as StockRecommendation;
}

describe('classifyDataQuality — ADR-0018 §3 휴리스틱 fallback', () => {
  it('모든 항목 통과 + dataSourceType=REALTIME → computed=10, api=11, aiInferred=7, total=28', () => {
    const stock = makeStock({ computedKeys: 9, apiKeys: 11, aiKeys: 7, dataSourceType: 'REALTIME' });
    const r = classifyDataQuality(stock);
    expect(r.computed).toBe(10); // 9 + REALTIME 1
    expect(r.api).toBe(11);
    expect(r.aiInferred).toBe(7);
    expect(r.total).toBe(28);
    expect(r.sourceMetaAvailable).toBe(false);
  });

  it('모든 항목 통과 + dataSourceType=YAHOO → api +1', () => {
    const stock = makeStock({ computedKeys: 9, apiKeys: 11, aiKeys: 7, dataSourceType: 'YAHOO' });
    const r = classifyDataQuality(stock);
    expect(r.computed).toBe(9);
    expect(r.api).toBe(12); // 11 + YAHOO 1
    expect(r.aiInferred).toBe(7);
  });

  it('모든 항목 통과 + dataSourceType=AI → aiInferred +1', () => {
    const stock = makeStock({ computedKeys: 9, apiKeys: 11, aiKeys: 7, dataSourceType: 'AI' });
    const r = classifyDataQuality(stock);
    expect(r.aiInferred).toBe(8); // 7 + AI 1
  });

  it('dataSourceType 미지정 → aiInferred +1 (기본 STALE/AI 취급)', () => {
    const stock = makeStock({ computedKeys: 0, apiKeys: 0, aiKeys: 0 });
    const r = classifyDataQuality(stock);
    expect(r.computed).toBe(0);
    expect(r.api).toBe(0);
    expect(r.aiInferred).toBe(1);
    expect(r.total).toBe(1);
  });

  it('모두 falsy + 데이터 소스 STALE → total=1, tier=LOW', () => {
    const stock = makeStock({ computedKeys: 0, apiKeys: 0, aiKeys: 0, dataSourceType: 'STALE' });
    const r = classifyDataQuality(stock);
    expect(r.total).toBe(1);
    expect(r.tier).toBe('LOW');
  });

  it('computed 비율 ≥ 0.6 → tier=HIGH', () => {
    // computed 9 + REALTIME 1 = 10 / total 11 → 0.91 ≥ 0.6
    const stock = makeStock({ computedKeys: 9, apiKeys: 0, aiKeys: 1, dataSourceType: 'REALTIME' });
    const r = classifyDataQuality(stock);
    expect(r.computed).toBe(10);
    expect(r.total).toBe(11);
    expect(r.tier).toBe('HIGH');
  });

  it('computed 비율 0.3~0.6 → tier=MEDIUM', () => {
    // computed 4 / total 10 (api 5 + ai 0 + AI 출처 1) = 0.4
    const stock = makeStock({ computedKeys: 4, apiKeys: 5, aiKeys: 0, dataSourceType: 'AI' });
    const r = classifyDataQuality(stock);
    expect(r.computed).toBe(4);
    expect(r.api).toBe(5);
    expect(r.aiInferred).toBe(1);
    expect(r.total).toBe(10);
    expect(r.tier).toBe('MEDIUM');
  });

  it('computed 비율 < 0.3 → tier=LOW', () => {
    // computed 1 / total 8 = 0.125
    const stock = makeStock({ computedKeys: 1, apiKeys: 4, aiKeys: 3, dataSourceType: 'AI' });
    const r = classifyDataQuality(stock);
    expect(r.tier).toBe('LOW');
  });

  it('sourceMetaAvailable=false 모든 케이스에서 단언 (PR-A 단계)', () => {
    expect(classifyDataQuality(makeStock()).sourceMetaAvailable).toBe(false);
    expect(classifyDataQuality(makeStock({ computedKeys: 9 })).sourceMetaAvailable).toBe(false);
    expect(classifyDataQuality(makeStock({ dataSourceType: 'REALTIME' })).sourceMetaAvailable).toBe(false);
  });

  it('checklist 점수 < 5 인 항목은 통과 카운트 안 됨 (CONDITION_PASS_THRESHOLD)', () => {
    const stock = makeStock({ computedKeys: 5, apiKeys: 5, aiKeys: 0 });
    const r = classifyDataQuality(stock);
    // 5/9 = 통과, 4 는 FAIL=3 으로 미통과
    expect(r.computed).toBe(5);
    expect(r.api).toBe(5);
  });
});
