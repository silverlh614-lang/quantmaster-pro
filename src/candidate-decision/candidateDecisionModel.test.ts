import { describe, expect, it } from 'vitest';
import type { StockRecommendation } from '../services/stockService';
import { buildCandidateDecisionCardModel, buildCandidateDecisionSummary } from './candidateDecisionModel';

function stock(overrides: Partial<StockRecommendation> = {}): StockRecommendation {
  return {
    name: 'Example Candidate',
    code: '123456',
    type: 'STRONG_BUY',
    reason: 'Gate confluence is constructive.',
    currentPrice: 10000,
    targetPrice: 11200,
    stopLoss: 9500,
    confidenceScore: 82,
    dataSourceType: 'REALTIME',
    gateEvaluation: {
      gate1Passed: true,
      gate2Passed: true,
      gate3Passed: true,
      finalScore: 84,
      recommendation: 'STRONG_BUY',
      positionSize: 1,
      gate1: { score: 88, reason: 'Survival filter passed' },
      gate2: { score: 80, reason: 'Growth validation passed' },
      gate3: { score: 78, reason: 'Timing gate passed' },
    },
    checklist: {},
    patterns: ['VCP'],
    riskFactors: ['RRR watch'],
    supplyQuality: { active: true, passive: false },
    isLeadingSector: true,
    visualReport: { financial: 80, technical: 76, supply: 74, summary: 'Balanced confluence.' },
    relatedSectors: ['Shipbuilding'],
    technicalSignals: { rsi: 62 },
    conditionSourceTiers: {},
    ...overrides,
  } as StockRecommendation;
}

describe('candidate decision model', () => {
  it('compresses Gate 0/1/2/3 and keeps data trust visible', () => {
    const model = buildCandidateDecisionCardModel(stock(), {
      sourceSnapshotId: 'scan-eval-adr538',
      asOf: '2026-05-25T00:00:00.000Z',
      engineMode: 'NORMAL',
      marketGateStatus: 'GREEN',
    });

    expect(model.finalDecision).toBe('CONFIRMED_CANDIDATE');
    expect(model.gate0.status).toBe('PASS');
    expect(model.gate1.status).toBe('PASS');
    expect(model.gate2.status).toBe('PASS');
    expect(model.gate3.status).toBe('PASS');
    expect(model.sectorAlignment.sectorAlignment).toBe('LEADING_SECTOR');
    expect(model.dataConfidence.marketSignal).toBe(false);
    expect(model.liveExecutionAllowed).toBe(true);
    expect(model.shadowTrackingStatus).toBe('ON');
  });

  it('downgrades weak-sector candidates without stopping Shadow tracking', () => {
    const model = buildCandidateDecisionCardModel(stock({ relatedSectors: ['Battery'] }), {
      engineMode: 'NORMAL',
      marketGateStatus: 'GREEN',
      sectorRotation: {
        reportDate: '2026-05-25',
        sourceSnapshotId: 'scan-eval-adr539',
        asOf: '2026-05-25T00:00:00.000Z',
        sectors: [{
          sectorName: 'Battery',
          sectorScore: 38,
          relativeStrengthRank: 21,
          flowDirection: 'OUTFLOW',
          trendChange: 'DOWN',
          sectorGateStatus: 'ORANGE',
          reason: 'Weak sector energy.',
          representativeStocks: [],
          cautionFlags: [],
          dataConfidence: 'VERIFIED',
          alignment: 'WEAK_SECTOR',
        }],
        topSectors: [],
        weakSectors: [],
        summary: 'Weak sector sample',
      },
    });

    expect(model.finalDecision).toBe('WATCH');
    expect(model.sectorAlignment.sectorPenaltyApplied).toBe(true);
    expect(model.liveExecutionAllowed).toBe(false);
    expect(model.shadowTrackingStatus).toBe('ON');
  });

  it('separates SELL_ONLY live block from Shadow tracking', () => {
    const model = buildCandidateDecisionCardModel(stock(), {
      engineMode: 'SELL_ONLY',
      marketGateStatus: 'YELLOW',
    });

    expect(model.finalDecision).toBe('SELL_ONLY');
    expect(model.liveExecutionAllowed).toBe(false);
    expect(model.shadowTrackingStatus).toBe('ON');
    expect(model.executionImpact).toBe('LIVE_EXECUTION_BLOCKED');
    expect(model.blockedReasons.some((reason) => reason.includes('SELL_ONLY'))).toBe(true);
  });

  it('keeps provider issues out of marketSignal', () => {
    const model = buildCandidateDecisionCardModel(stock({ dataSourceType: 'STALE' }), {
      engineMode: 'NORMAL',
      marketGateStatus: 'YELLOW',
    });

    expect(model.finalDecision).toBe('DATA_INSUFFICIENT');
    expect(model.dataConfidence.providerIssue).toBe(true);
    expect(model.dataConfidence.marketSignal).toBe(false);
    expect(model.shadowTrackingStatus).toBe('BLOCKED_BUT_TRACKED');
  });

  it('counts Shadow tracking in candidate summaries', () => {
    const summary = buildCandidateDecisionSummary([
      stock(),
      stock({ code: '654321', dataSourceType: 'STALE' }),
    ], { marketGateStatus: 'GREEN' });

    expect(summary.totalCandidates).toBe(2);
    expect(summary.confirmedCandidateCount).toBe(1);
    expect(summary.dataInsufficientCount).toBe(1);
    expect(summary.shadowTrackingCount).toBe(2);
  });
});
