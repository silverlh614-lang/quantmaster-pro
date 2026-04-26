/**
 * @responsibility classifyDataQuality 메타 우선 모드 테스트 — ADR-0019 PR-B
 */
import { describe, it, expect } from 'vitest';
import { classifyDataQuality } from './dataQualityClassifier';
import type { StockRecommendation } from '../services/stockService';

const PASS = 7;

const ALL_KEYS_27 = [
  'cycleVerified', 'momentumRanking', 'roeType3', 'supplyInflow', 'riskOnEnvironment',
  'ichimokuBreakout', 'mechanicalStop', 'economicMoatVerified', 'notPreviousLeader',
  'technicalGoldenCross', 'volumeSurgeVerified', 'institutionalBuying', 'consensusTarget',
  'earningsSurprise', 'performanceReality', 'policyAlignment', 'psychologicalObjectivity',
  'turtleBreakout', 'fibonacciLevel', 'elliottWaveVerified', 'ocfQuality',
  'marginAcceleration', 'interestCoverage', 'relativeStrength', 'vcpPattern',
  'divergenceCheck', 'catalystAnalysis',
] as const;

function makeStock(opts: {
  meta?: Record<string, 'COMPUTED' | 'API' | 'AI_INFERRED'>;
  fullPass?: boolean;
  dataSourceType?: StockRecommendation['dataSourceType'];
}): StockRecommendation {
  const checklist: Record<string, number> = {};
  for (const k of ALL_KEYS_27) checklist[k] = opts.fullPass ? PASS : 0;
  return {
    code: 'X', name: 'X', currentPrice: 100, type: 'NEUTRAL',
    targetPrice: 110, stopLoss: 90,
    checklist: checklist as StockRecommendation['checklist'],
    visualReport: { financial: 0, technical: 0, supply: 0, summary: '' },
    historicalAnalogy: { stockName: '', period: '', similarity: 0, reason: '' },
    anomalyDetection: { type: 'NONE', score: 0, description: '' },
    semanticMapping: { theme: '', keywords: [], relevanceScore: 0, description: '' },
    dataSourceType: opts.dataSourceType,
    conditionSourceTiers: opts.meta as StockRecommendation['conditionSourceTiers'],
  } as unknown as StockRecommendation;
}

describe('classifyDataQuality — ADR-0019 메타 우선 모드', () => {
  it('전체 27키 메타 + 모두 통과 → sourceMetaAvailable=true 격상', () => {
    const meta: Record<string, 'COMPUTED' | 'API' | 'AI_INFERRED'> = {};
    for (const k of ALL_KEYS_27) meta[k] = 'COMPUTED';
    const stock = makeStock({ meta, fullPass: true, dataSourceType: 'REALTIME' });
    const r = classifyDataQuality(stock);
    expect(r.sourceMetaAvailable).toBe(true);
    expect(r.computed).toBe(28); // 27 키 + REALTIME 1
    expect(r.api).toBe(0);
    expect(r.aiInferred).toBe(0);
    expect(r.tier).toBe('HIGH');
  });

  it('부분 메타 (10키) → sourceMetaAvailable=false (메타 + 휴리스틱 mix)', () => {
    const meta: Record<string, 'COMPUTED' | 'API' | 'AI_INFERRED'> = {
      vcpPattern: 'COMPUTED',
      roeType3: 'API',
      ocfQuality: 'API',
      // 나머지 24키는 메타 없음
    };
    const stock = makeStock({ meta, fullPass: true, dataSourceType: 'REALTIME' });
    const r = classifyDataQuality(stock);
    expect(r.sourceMetaAvailable).toBe(false); // 부분 메타이므로 false
    // 메타 있는 항목은 메타 기준, 나머지는 휴리스틱 fallback
    // vcpPattern=COMPUTED, roeType3=API, ocfQuality=API → 메타 적용
    // 나머지 24키 + REALTIME 은 휴리스틱
  });

  it('메타 = 모든 키 AI_INFERRED + 모두 통과 → computed=1 (REALTIME만), tier=LOW', () => {
    const meta: Record<string, 'COMPUTED' | 'API' | 'AI_INFERRED'> = {};
    for (const k of ALL_KEYS_27) meta[k] = 'AI_INFERRED';
    const stock = makeStock({ meta, fullPass: true, dataSourceType: 'REALTIME' });
    const r = classifyDataQuality(stock);
    expect(r.sourceMetaAvailable).toBe(true);
    expect(r.computed).toBe(1); // REALTIME 가격 출처만
    expect(r.aiInferred).toBe(27);
    expect(r.tier).toBe('LOW'); // 1/28 = 0.036
  });

  it('메타 = 절반 COMPUTED + 절반 AI_INFERRED → MEDIUM tier', () => {
    const meta: Record<string, 'COMPUTED' | 'API' | 'AI_INFERRED'> = {};
    for (let i = 0; i < ALL_KEYS_27.length; i++) {
      meta[ALL_KEYS_27[i]] = i < 13 ? 'COMPUTED' : 'AI_INFERRED';
    }
    const stock = makeStock({ meta, fullPass: true, dataSourceType: 'AI' });
    const r = classifyDataQuality(stock);
    expect(r.sourceMetaAvailable).toBe(true);
    expect(r.computed).toBe(13);
    expect(r.aiInferred).toBe(15); // 14 AI 키 + AI 가격 출처 1
    // 13/28 = 0.46 → MEDIUM
    expect(r.tier).toBe('MEDIUM');
  });

  it('메타 부재 (PR-A fallback) → sourceMetaAvailable=false + 휴리스틱 분류', () => {
    const stock = makeStock({ fullPass: true, dataSourceType: 'REALTIME' });
    const r = classifyDataQuality(stock);
    expect(r.sourceMetaAvailable).toBe(false);
  });

  it('메타 = COMPUTED + 점수 < THRESHOLD → 미통과 항목은 카운트 안 됨', () => {
    const meta: Record<string, 'COMPUTED' | 'API' | 'AI_INFERRED'> = {};
    for (const k of ALL_KEYS_27) meta[k] = 'COMPUTED';
    // fullPass=false → 모든 checklist 점수 0 → 통과 0건
    const stock = makeStock({ meta, fullPass: false, dataSourceType: 'STALE' });
    const r = classifyDataQuality(stock);
    expect(r.sourceMetaAvailable).toBe(true);
    expect(r.computed).toBe(0);
    expect(r.aiInferred).toBe(1); // STALE 가격 출처만
    expect(r.total).toBe(1);
    expect(r.tier).toBe('LOW');
  });

  it('메타 = 1키만 + fullPass=true → sourceMetaAvailable=false (전체 27 미커버)', () => {
    const meta: Record<string, 'COMPUTED' | 'API' | 'AI_INFERRED'> = {
      vcpPattern: 'COMPUTED',
    };
    const stock = makeStock({ meta, fullPass: true });
    const r = classifyDataQuality(stock);
    expect(r.sourceMetaAvailable).toBe(false);
  });
});
