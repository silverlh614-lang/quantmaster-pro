import { describe, expect, it } from 'vitest';
import type { StockRecommendation } from '../services/stockService';
import type { SectorEnergyResult } from '../types/sectorEnergy';
import {
  createPublicReportSnapshot,
  deletePublicReportSnapshot,
  listPublicReportSnapshots,
  savePublicReportSnapshot,
  toPublicReport,
} from './reportAdapter';

function stock(overrides: Partial<StockRecommendation> = {}): StockRecommendation {
  return {
    name: 'Example Shipbuilding',
    code: '123456',
    reason: 'Sector flow and gate alignment are constructive.',
    type: 'STRONG_BUY',
    patterns: ['VCP'],
    hotness: 80,
    roeType: 'TYPE_3',
    isLeadingSector: true,
    momentumRank: 1,
    supplyQuality: { passive: false, active: true },
    peakPrice: 12000,
    currentPrice: 10000,
    isPreviousLeader: false,
    ichimokuStatus: 'ABOVE_CLOUD',
    relatedSectors: ['Shipbuilding'],
    valuation: { per: 10, pbr: 1, epsGrowth: 20, debtRatio: 80 },
    technicalSignals: {
      maAlignment: 'BULLISH',
      rsi: 61,
      macdStatus: 'GOLDEN_CROSS',
      bollingerStatus: 'NEUTRAL',
      stochasticStatus: 'NEUTRAL',
      volumeSurge: true,
      disparity20: 4,
      macdHistogram: 1,
      bbWidth: 12,
      stochRsi: 55,
    },
    economicMoat: { type: 'NONE', description: 'N/A' },
    scores: { value: 70, momentum: 80 },
    marketSentiment: { iri: 60, vkospi: 15 },
    confidenceScore: 78,
    marketCap: 1000000000000,
    marketCapCategory: 'LARGE',
    correlationGroup: 'Shipbuilding',
    aiConvictionScore: { totalScore: 75, factors: [], marketPhase: 'NEUTRAL', description: 'N/A' },
    riskFactors: ['Chasing risk requires timing confirmation.'],
    targetPrice: 11000,
    stopLoss: 9500,
    entryPrice: 10000,
    checklist: {
      cycleVerified: 1,
      momentumRanking: 1,
      roeType3: 1,
      supplyInflow: 1,
      riskOnEnvironment: 1,
      ichimokuBreakout: 1,
      mechanicalStop: 1,
      economicMoatVerified: 1,
      notPreviousLeader: 1,
      technicalGoldenCross: 1,
      volumeSurgeVerified: 1,
      institutionalBuying: 1,
      consensusTarget: 1,
      earningsSurprise: 1,
      performanceReality: 1,
      policyAlignment: 1,
      psychologicalObjectivity: 1,
      turtleBreakout: 1,
      fibonacciLevel: 1,
      elliottWaveVerified: 1,
      ocfQuality: 1,
      marginAcceleration: 1,
      interestCoverage: 1,
      relativeStrength: 1,
      vcpPattern: 1,
      divergenceCheck: 1,
      catalystAnalysis: 1,
    },
    visualReport: { financial: 80, technical: 75, supply: 70, summary: 'N/A' },
    historicalAnalogy: { stockName: 'N/A', period: 'N/A', similarity: 0, reason: 'N/A' },
    anomalyDetection: { type: 'NONE', score: 0, description: 'N/A' },
    semanticMapping: { theme: 'Shipbuilding', keywords: [], relevanceScore: 1, description: 'N/A' },
    gateEvaluation: {
      gate1Passed: true,
      gate2Passed: true,
      gate3Passed: true,
      finalScore: 82,
      recommendation: 'STRONG_BUY',
      positionSize: 1,
    },
    conditionSourceTiers: {
      cycleVerified: 'COMPUTED',
      momentumRanking: 'COMPUTED',
      roeType3: 'AI_INFERRED',
    },
    ...overrides,
  };
}

const sectorEnergyResult = {
  scores: [
    { name: 'Shipbuilding', rawScore: 90, score: 88, returnContrib: 0, volumeContrib: 0, foreignContrib: 0, seasonalMultiplier: 1, energyScore: 88 },
    { name: 'Defense', rawScore: 84, score: 84, returnContrib: 0, volumeContrib: 0, foreignContrib: 0, seasonalMultiplier: 1, energyScore: 84 },
    { name: 'Battery', rawScore: 35, score: 35, returnContrib: 0, volumeContrib: 0, foreignContrib: 0, seasonalMultiplier: 1, energyScore: 35 },
  ],
  leadingSectors: [{ name: 'Shipbuilding', energyScore: 88, tier: 'LEADING', gate2Adjustment: -1, positionSizeLimit: 40 }],
  laggingSectors: [{ name: 'Battery', energyScore: 35, tier: 'LAGGING', gate2Adjustment: 0, positionSizeLimit: 0 }],
  neutralSectors: [],
  currentSeason: 'APR_MAY',
  calculatedAt: '2026-05-16T00:00:00.000Z',
  summary: 'Shipbuilding and defense show leading relative strength.',
} satisfies SectorEnergyResult;

function memoryStorage() {
  const store = new Map<string, string>();
  return {
    getItem: (key: string) => store.get(key) ?? null,
    setItem: (key: string, value: string) => store.set(key, value),
  };
}

// 27개 조건 전부 COMPUTED 출처 — "core data is calculated" 시나리오용 (aiEstimated=0 보장).
const ALL_COMPUTED_TIERS: StockRecommendation['conditionSourceTiers'] = Object.fromEntries(
  ([
    'cycleVerified', 'momentumRanking', 'roeType3', 'supplyInflow', 'riskOnEnvironment',
    'ichimokuBreakout', 'mechanicalStop', 'economicMoatVerified', 'notPreviousLeader',
    'technicalGoldenCross', 'volumeSurgeVerified', 'institutionalBuying', 'consensusTarget',
    'earningsSurprise', 'performanceReality', 'policyAlignment', 'psychologicalObjectivity',
    'turtleBreakout', 'fibonacciLevel', 'elliottWaveVerified', 'ocfQuality', 'marginAcceleration',
    'interestCoverage', 'relativeStrength', 'vcpPattern', 'divergenceCheck', 'catalystAnalysis',
  ] as const).map((k) => [k, 'COMPUTED' as const]),
) as StockRecommendation['conditionSourceTiers'];

describe('public report adapter', () => {
  it('builds sanitized public report cards and exports', () => {
    const report = toPublicReport({
      recommendations: [stock()],
      sectorEnergyResult,
      now: new Date('2026-05-16T00:00:00.000Z'),
    });

    expect(report.reportType).toBe('DAILY_FULL_REPORT');
    expect(report.blogTitle).toContain('2026.05.16');
    expect(report.blogTitle).toContain('QuantMaster');
    expect(report.oneLineSummary).toContain('시장 Gate');
    expect(report.sourceSnapshotId).toBe('public-report-2026-05-16');
    expect(report.marketGate?.shadowLearningAllowed).toBe(true);
    expect(report.marketGate?.sourceSnapshotId).toBe(report.sourceSnapshotId);
    expect(report.marketGate?.executionImpact).toBe('LIVE_EXECUTION_ALLOWED');
    expect(report.stockDecision?.finalDecision).toBe('BUY_CANDIDATE');
    expect(report.stockDecision?.sectorAlignment.sectorAlignment).toBe('LEADING_SECTOR');
    expect(report.stockDecision?.displayDecision).toBe('BUY_CANDIDATE');
    expect(report.stockDecision?.sourceSnapshotId).toBe(report.sourceSnapshotId);
    // checklist 27항목이 정규화(이진 1→pass)로 실제 통과 → conditionSourceTiers 미지정 24항목은
    // 휴리스틱 분류, 그중 AI_INFERRED 6 + 메타 roeType3(AI_INFERRED) 1 + 가격출처(dataSourceType
    // 미설정→ai) 1 = 8. (직전엔 1<5 미통과로 아무 항목도 카운트 안 돼 가격출처 1만 잡히던 버그)
    expect(report.stockDecision?.dataConfidenceSummary.aiEstimatedIndicatorCount).toBe(8);
    expect(report.candidateSummary.buyCandidateCount).toBe(1);
    expect(report.dataConfidenceSummary.marketSignal).toBe(false);
    expect(report.blogMarkdown).toContain('## 투자 유의');
    expect(report.blogMarkdown).toContain('## 2. 시장 Gate');
    expect(report.blogMarkdown).toContain('## 3. 섹터 로테이션');
    expect(report.blogMarkdown).toContain('Macro Health Score');
    expect(report.blogMarkdown).toContain('섹터 정렬');
    expect(report.blogHtml).toContain('<h2>2. 시장 Gate</h2>');
    expect(report.blogTags.length).toBeGreaterThanOrEqual(10);
    expect(report.blogTags.length).toBeLessThanOrEqual(15);
    expect(report.blogTags).not.toContain(['#추천', '주'].join(''));
    expect(report.telegramSummary.split('\n').length).toBeLessThanOrEqual(9);
    expect(report.telegramSummary).toContain('시장 Gate:');
    expect(report.telegramOutput).toBe(report.telegramSummary);
    expect(report.markdownOutput).toBe(report.blogMarkdown);
    expect(report.paidPayload).toBeUndefined();
    expect(report.privatePayload).toBeUndefined();
    expect(report.blogMarkdown).not.toContain('9500');
    expect(report.blogMarkdown).not.toContain('11000');
    expect(report.blogHtml).not.toContain('targetPrice');
  });

  it('separates paid payload from public output', () => {
    const report = toPublicReport({
      recommendations: [stock()],
      sectorEnergyResult,
      visibility: 'PAID',
      now: new Date('2026-05-16T00:00:00.000Z'),
    });

    expect(report.paidPayload).toBeDefined();
    expect(JSON.stringify(report.paidPayload)).toContain('targetPrice');
    expect(report.blogMarkdown).not.toContain('targetPrice');
  });

  it('keeps reports available in SELL_ONLY mode', () => {
    const report = toPublicReport({
      recommendations: [stock()],
      engineMode: 'SELL_ONLY',
      sectorEnergyResult,
      now: new Date('2026-05-16T00:00:00.000Z'),
    });

    expect(report.marketGate?.engineMode).toBe('SELL_ONLY');
    expect(report.marketGate?.shadowLearningAllowed).toBe(true);
    expect(report.stockDecision?.finalDecision).toBe('SELL_ONLY');
    expect(report.stockDecision?.displayDecision).toBe('SELL_ONLY');
    expect(report.candidateSummary.sellOnlyCount).toBe(1);
    expect(report.blogMarkdown).toContain('Shadow 추적');
  });

  it('does not treat stale provider status as a market signal', () => {
    const report = toPublicReport({
      recommendations: [stock({ dataSourceType: 'STALE' })],
      now: new Date('2026-05-16T00:00:00.000Z'),
    });

    expect(report.stockDecision?.dataConfidenceSummary.providerIssue).toBe(true);
    expect(report.stockDecision?.dataConfidenceSummary.overall).toBe('STALE');
    expect(report.stockDecision?.finalDecision).toBe('DATA_INSUFFICIENT');
    expect(report.dataConfidenceSummary.providerIssue).toBe(true);
    expect(report.dataConfidenceSummary.marketSignal).toBe(false);
    expect(report.blogMarkdown).toContain('Provider Issue');
    expect(report.blogMarkdown).toContain('Market Signal');
  });

  it('keeps confirmed candidate only when core data is calculated', () => {
    const report = toPublicReport({
      recommendations: [stock({ dataSourceType: 'REALTIME', conditionSourceTiers: ALL_COMPUTED_TIERS })],
      sectorEnergyResult,
      marketContext: {
        kospi: { index: 3000, change: 20, changePercent: 0.7, status: 'BULLISH', analysis: 'risk-on' },
        kosdaq: { index: 900, change: 10, changePercent: 1.1, status: 'BULLISH', analysis: 'risk-on' },
        iri: 90,
      },
      now: new Date('2026-05-16T00:00:00.000Z'),
    });

    expect(report.stockDecision?.finalDecision).toBe('CONFIRMED_CANDIDATE');
    expect(report.stockDecision?.displayDecision).toBe('CONFIRMED_CANDIDATE');
    expect(report.candidateSummary.confirmedCandidateCount).toBe(1);
  });

  it('creates, saves, lists, and deletes public report snapshots', () => {
    const storage = memoryStorage();
    const report = toPublicReport({
      recommendations: [stock()],
      sectorEnergyResult,
      now: new Date('2026-05-16T00:00:00.000Z'),
    });

    const snapshot = createPublicReportSnapshot(report);
    expect(snapshot.generatedBy).toBe('PUBLIC_REPORT_MODE');
    expect(snapshot.blogHtml).toContain('<h1>');
    expect(snapshot.representativeCandidates).toHaveLength(1);

    savePublicReportSnapshot(report, storage);
    expect(listPublicReportSnapshots(storage)).toHaveLength(1);
    savePublicReportSnapshot(report, storage);
    expect(listPublicReportSnapshots(storage)).toHaveLength(1);

    deletePublicReportSnapshot(report.reportId, storage);
    expect(listPublicReportSnapshots(storage)).toHaveLength(0);
  });
});
