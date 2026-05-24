import { describe, expect, it } from 'vitest';
import type { StockRecommendation } from '../services/stockService';
import type { SectorEnergyResult } from '../types/sectorEnergy';
import { toPublicReport } from './reportAdapter';

function stock(overrides: Partial<StockRecommendation> = {}): StockRecommendation {
  return {
    name: 'Example Shipbuilding',
    code: '123456',
    reason: '수급과 상대강도가 양호합니다.',
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
    relatedSectors: ['조선'],
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
    correlationGroup: '조선',
    aiConvictionScore: { totalScore: 75, factors: [], marketPhase: 'NEUTRAL', description: 'N/A' },
    riskFactors: ['추격 매수 주의'],
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
    semanticMapping: { theme: '조선', keywords: [], relevanceScore: 1, description: 'N/A' },
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
    { name: '조선', rawScore: 90, score: 88, returnContrib: 0, volumeContrib: 0, foreignContrib: 0, seasonalMultiplier: 1, energyScore: 88 },
    { name: '방산', rawScore: 84, score: 84, returnContrib: 0, volumeContrib: 0, foreignContrib: 0, seasonalMultiplier: 1, energyScore: 84 },
    { name: '2차전지', rawScore: 35, score: 35, returnContrib: 0, volumeContrib: 0, foreignContrib: 0, seasonalMultiplier: 1, energyScore: 35 },
  ],
  leadingSectors: [{ name: '조선', energyScore: 88, tier: 'LEADING', gate2Adjustment: -1, positionSizeLimit: 40 }],
  laggingSectors: [{ name: '2차전지', energyScore: 35, tier: 'LAGGING', gate2Adjustment: 0, positionSizeLimit: 0 }],
  neutralSectors: [],
  currentSeason: 'APR_MAY',
  calculatedAt: '2026-05-16T00:00:00.000Z',
  summary: '조선과 방산이 상대 강세입니다.',
} satisfies SectorEnergyResult;

describe('public report adapter', () => {
  it('builds sanitized public report cards and exports', () => {
    const report = toPublicReport({
      recommendations: [stock()],
      sectorEnergyResult,
      now: new Date('2026-05-16T00:00:00.000Z'),
    });

    expect(report.reportType).toBe('DAILY_FULL_REPORT');
    expect(report.blogTitle).toContain('QuantMaster Gate 리포트');
    expect(report.sourceSnapshotId).toBe('public-report-2026-05-16');
    expect(report.marketGate?.shadowLearningAllowed).toBe(true);
    expect(report.stockDecision?.finalDecision).toBe('BUY');
    expect(report.stockDecision?.displayDecision).toBe('BUY_CANDIDATE');
    expect(report.stockDecision?.sourceSnapshotId).toBe(report.sourceSnapshotId);
    expect(report.stockDecision?.dataConfidenceSummary.aiEstimatedIndicatorCount).toBe(1);
    expect(report.candidateSummary.buyCandidateCount).toBe(1);
    expect(report.dataConfidenceSummary.marketSignal).toBe(false);
    expect(report.markdownOutput).toContain('## 투자 유의');
    expect(report.markdownOutput).toContain('CONFIRMED_CANDIDATE');
    expect(report.markdownOutput).toContain('BUY_CANDIDATE');
    expect(report.telegramOutput.split('\n').length).toBeLessThanOrEqual(8);
    expect(report.telegramOutput).toContain('실행 모드');
    expect(report.telegramOutput).not.toContain('투자판단 참고용');
    expect(report.paidPayload).toBeUndefined();
    expect(report.privatePayload).toBeUndefined();
    expect(report.markdownOutput).not.toContain('9500');
    expect(report.markdownOutput).not.toContain('11000');
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
    expect(report.markdownOutput).not.toContain('targetPrice');
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
  });

  it('keeps confirmed candidate only when core data is calculated', () => {
    const report = toPublicReport({
      recommendations: [stock({ conditionSourceTiers: { cycleVerified: 'COMPUTED', momentumRanking: 'COMPUTED', roeType3: 'COMPUTED' } })],
      sectorEnergyResult,
      now: new Date('2026-05-16T00:00:00.000Z'),
    });

    expect(report.stockDecision?.finalDecision).toBe('CONFIRMED_BUY');
    expect(report.stockDecision?.displayDecision).toBe('CONFIRMED_CANDIDATE');
    expect(report.candidateSummary.confirmedCandidateCount).toBe(1);
  });
});
