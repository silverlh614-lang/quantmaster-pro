import { describe, expect, it } from 'vitest';
import {
  calculateDiversityAdjustment,
  formatDiscoveryBonusAppliedLog,
  formatDiversityAdjustmentAppliedLog,
  formatRepeatedCandidatePenaltyAppliedLog,
  type CandidateExposureHistory,
} from './candidateDiversityAdjustment.js';
import { formatSimpleDecisionFinalLog, resolveSimpleTradeDecision } from './gates/simpleDecision.js';

const AS_OF = '2026-05-21T09:30:00.000+09:00';

function history(overrides: Partial<CandidateExposureHistory> = {}): CandidateExposureHistory {
  return {
    symbol: 'HL만도',
    tradingDate: '2026-05-21',
    seenCount1d: 0,
    seenCount3d: 0,
    seenCount7d: 0,
    signalCount1d: 0,
    signalCount3d: 0,
    signalCount7d: 0,
    sector: '자동차',
    ...overrides,
  };
}

describe('Simplification Step 12 candidate diversity adjustment', () => {
  it('penalizes a recently repeated candidate without blocking BUY_ALLOWED', () => {
    const diversity = calculateDiversityAdjustment({
      snapshotId: 'scan_div_a',
      symbol: 'HL만도',
      history: history({
        lastBuyAllowedAt: '2026-05-21T09:00:00.000+09:00',
      }),
      asOf: AS_OF,
    });
    const decision = resolveSimpleTradeDecision({
      snapshotId: 'scan_div_a',
      symbol: 'HL만도',
      dataUsable: true,
      riskRewardOk: true,
      slotAvailable: true,
      executionScore: 82,
      scoreAdjustment: -2,
      diversityAdjustment: diversity.totalDiversityAdjustment,
      freshnessPenalty: diversity.freshnessPenalty,
      discoveryBonus: diversity.discoveryBonus,
      sectorDiversityAdjustment: diversity.sectorDiversityAdjustment,
      finalScore: 82,
    });

    expect(diversity.freshnessPenalty).toBe(-5);
    expect(decision.finalScore).toBe(75);
    expect(decision.decision).toBe('BUY_ALLOWED');
    expect(decision.blockReasons).not.toContain('DUPLICATE_BLOCKED');
    expect(formatSimpleDecisionFinalLog(decision)).toContain('diversityAdjustment=-5');
  });

  it('can move a repeated candidate to WATCH through score only', () => {
    const diversity = calculateDiversityAdjustment({
      symbol: 'HL만도',
      history: history({ lastShadowFilledAt: '2026-05-21T09:10:00.000+09:00' }),
      asOf: AS_OF,
    });
    const decision = resolveSimpleTradeDecision({
      dataUsable: true,
      riskRewardOk: true,
      slotAvailable: true,
      executionScore: 74,
      scoreAdjustment: -2,
      diversityAdjustment: diversity.totalDiversityAdjustment,
      finalScore: 74,
    });

    expect(decision.finalScore).toBe(67);
    expect(decision.decision).toBe('WATCH');
    expect(decision.blockReasons).toEqual([]);
  });

  it('applies discovery bonus to a new candidate as score adjustment only', () => {
    const diversity = calculateDiversityAdjustment({
      snapshotId: 'scan_div_c',
      symbol: '123456',
      sector: '반도체',
      history: history({
        symbol: '123456',
        sector: '반도체',
        lastSeenAt: '2026-05-10T09:00:00.000+09:00',
        lastSignalAt: '2026-05-01T09:00:00.000+09:00',
      }),
      asOf: AS_OF,
    });
    const decision = resolveSimpleTradeDecision({
      dataUsable: true,
      riskRewardOk: true,
      slotAvailable: true,
      executionScore: 68,
      diversityAdjustment: diversity.totalDiversityAdjustment,
      discoveryBonus: diversity.discoveryBonus,
      finalScore: 68,
    });

    expect(diversity.discoveryBonus).toBe(5);
    expect(decision.finalScore).toBe(73);
    expect(decision.decision).toBe('BUY_ALLOWED');
  });

  it('keeps sector crowding as a penalty rather than a block', () => {
    const diversity = calculateDiversityAdjustment({
      symbol: '005380',
      sector: '자동차',
      history: history({ symbol: '005380' }),
      sectorExposure: {
        sector: '자동차',
        currentOpenPositions: 3,
        candidateCountToday: 5,
        grossExposurePct: 32,
      },
      asOf: AS_OF,
    });

    expect(diversity.sectorDiversityAdjustment).toBeLessThan(0);
    expect(diversity.riskTags).toContain('SECTOR_CONCENTRATION');
    expect(diversity.learningLabels).toContain('SECTOR_DIVERSITY_ADJUSTMENT_APPLIED');
  });

  it('emits Step 12 forensic logs with execution impact NONE', () => {
    const diversity = calculateDiversityAdjustment({
      snapshotId: 'scan_div_log',
      symbol: 'HL만도',
      history: history({
        lastSignalAt: '2026-05-21T09:00:00.000+09:00',
        lastBuyAllowedAt: '2026-05-21T09:05:00.000+09:00',
        seenCount1d: 3,
        seenCount3d: 5,
        seenCount7d: 8,
        signalCount1d: 1,
        signalCount3d: 2,
        signalCount7d: 4,
      }),
      asOf: AS_OF,
    });
    const discovery = calculateDiversityAdjustment({
      snapshotId: 'scan_discovery_log',
      symbol: '123456',
      history: null,
      asOf: AS_OF,
    });
    const logs = [
      formatDiversityAdjustmentAppliedLog(diversity),
      formatRepeatedCandidatePenaltyAppliedLog(diversity),
      formatDiscoveryBonusAppliedLog(discovery),
    ].join('\n');

    expect(logs).toContain('[DIVERSITY_ADJUSTMENT_APPLIED]');
    expect(logs).toContain('[REPEATED_CANDIDATE_PENALTY_APPLIED]');
    expect(logs).toContain('[DISCOVERY_BONUS_APPLIED]');
    expect(logs).toContain("newBehavior='SCORE_PENALTY_ONLY'");
    expect(logs).toContain("executionImpact='NONE'");
  });
});
