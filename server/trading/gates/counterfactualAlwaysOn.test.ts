import { beforeEach, describe, expect, it } from 'vitest';
import { resolveSimpleTradeDecision } from './simpleDecision.js';
import {
  __resetCounterfactualAlwaysOnSamplesForTests,
  loadCounterfactualAlwaysOnSamples,
  recordCounterfactualForDecision,
} from './counterfactualAlwaysOn.js';
import { calculateDiversityAdjustment } from '../candidateDiversityAdjustment.js';

function decision(input: Parameters<typeof resolveSimpleTradeDecision>[0]) {
  return resolveSimpleTradeDecision({
    snapshotId: 'scan_cf',
    symbol: '005930',
    executionScore: input.executionScore ?? input.finalScore,
    ...input,
  });
}

describe('Simplification Step 9 counterfactual always-on recording', () => {
  beforeEach(() => {
    __resetCounterfactualAlwaysOnSamplesForTests();
  });

  it('records BUY_ALLOWED as counterfactual sample', () => {
    const result = recordCounterfactualForDecision({
      decision: decision({ dataUsable: true, finalScore: 75 }),
    });

    expect(result.recorded).toBe(true);
    expect(result.sample.sampleType).toBe('BUY_ALLOWED_COUNTERFACTUAL');
    expect(result.sample.outcomeStatus).toBe('PENDING');
    expect(result.logs.join('\n')).toContain('[COUNTERFACTUAL_SAMPLE_RECORDED]');
  });

  it('records WATCH as counterfactual sample', () => {
    const result = recordCounterfactualForDecision({
      decision: decision({ dataUsable: true, finalScore: 64 }),
    });

    expect(result.sample.decision).toBe('WATCH');
    expect(result.sample.sampleType).toBe('WATCH_COUNTERFACTUAL');
  });

  it('records low score rejects as counterfactual samples', () => {
    const result = recordCounterfactualForDecision({
      decision: decision({ dataUsable: true, finalScore: 48 }),
    });

    expect(result.sample.decision).toBe('REJECT_LOW_SCORE');
    expect(result.sample.sampleType).toBe('LOW_SCORE_COUNTERFACTUAL');
  });

  it('records DATA_INCOMPLETE as data-gap counterfactual', () => {
    const result = recordCounterfactualForDecision({
      decision: decision({
        dataUsable: false,
        executionScore: 0,
        finalScore: 90,
      }),
      missingFields: ['quote'],
      providerHealth: 'QUOTE_MISSING',
      quoteStatus: 'MISSING',
      dataHealth: 'MISSING',
    });
    const logs = result.logs.join('\n');

    expect(result.sample.decision).toBe('NO_TRADE_DATA_INCOMPLETE');
    expect(result.sample.sampleType).toBe('DATA_GAP_COUNTERFACTUAL');
    expect(result.sample.missingFields).toEqual(['quote']);
    expect(logs).toContain('[DATA_GAP_COUNTERFACTUAL_RECORDED]');
  });

  it('records missing PriceSnapshot as price-gap counterfactual', () => {
    const result = recordCounterfactualForDecision({
      decision: decision({
        dataUsable: false,
        executionScore: 0,
        finalScore: 90,
      }),
      missingFields: ['priceSnapshot'],
      entryPrice: null,
    });

    expect(result.sample.decision).toBe('NO_TRADE_DATA_INCOMPLETE');
    expect(result.sample.sampleType).toBe('PRICE_GAP_COUNTERFACTUAL');
    expect(result.sample.entryPrice).toBeNull();
    expect(result.sample.missingFields).toEqual(['priceSnapshot']);
  });

  it('records SLOT_FULL as counterfactual instead of dropping the sample', () => {
    const result = recordCounterfactualForDecision({
      decision: decision({
        dataUsable: true,
        slotAvailable: false,
        finalScore: 82,
        maxPositions: 3,
        currentPositions: 3,
        remainingSlots: 0,
      }),
      maxGrossExposurePct: 20,
      perPositionPct: 6.67,
    });

    expect(result.sample.decision).toBe('WATCH_SLOT_FULL');
    expect(result.sample.sampleType).toBe('SLOT_FULL_COUNTERFACTUAL');
    expect(result.logs.join('\n')).toContain('[SLOT_FULL_COUNTERFACTUAL_RECORDED]');
    expect(result.sample.positionPolicy?.currentPositions).toBe(3);
  });

  it('records despite dedup duplicates', () => {
    const result = recordCounterfactualForDecision({
      decision: decision({ dataUsable: true, finalScore: 76 }),
      dedupDuplicate: true,
      dedupKey: 'dup:005930',
    });

    expect(result.recorded).toBe(true);
    expect(result.dedupDecisionImpact).toBe('NONE');
    expect(result.sample.learningLabels).toContain('DEDUP_OBSERVED');
    expect(result.logs.join('\n')).toContain('[COUNTERFACTUAL_RECORDED_DESPITE_DEDUP]');
  });

  it('records despite cooldown active', () => {
    const result = recordCounterfactualForDecision({
      decision: decision({ dataUsable: true, finalScore: 64 }),
      cooldownActive: true,
      cooldownKey: 'cooldown:005930',
    });

    expect(result.recorded).toBe(true);
    expect(result.cooldownDecisionImpact).toBe('NONE');
    expect(result.sample.learningLabels).toContain('COOLDOWN_OBSERVED');
    expect(result.logs.join('\n')).toContain('[COUNTERFACTUAL_RECORDED_DESPITE_COOLDOWN]');
  });

  it('records AI evidence for counterfactual while keeping execution impact NONE', () => {
    const result = recordCounterfactualForDecision({
      decision: decision({
        dataUsable: true,
        finalScore: 66,
        advisoryScore: 10,
        excludedAiScore: 10,
      }),
      aiEvidencePresent: true,
      aiEstimatedFeatureCount: 2,
    });

    expect(result.sample.aiEvidencePresent).toBe(true);
    expect(result.sample.excludedAiScore).toBe(10);
    expect(result.sample.learningLabels).toContain('AI_ESTIMATE_OBSERVED');
    expect(result.sample.learningLabels).toContain('AI_EXCLUDED_FROM_EXECUTION');
    expect(result.sample.aiExecutionImpact).toBe('NONE');
  });

  it('records even when Telegram notification was suppressed', () => {
    const result = recordCounterfactualForDecision({
      decision: decision({ dataUsable: true, finalScore: 75 }),
      notificationSuppressed: true,
    });

    expect(result.recorded).toBe(true);
    expect(result.notificationDecisionImpact).toBe('NONE');
    expect(result.learningImpact).toBe('NONE');
    expect(result.sample.learningLabels).toContain('TELEGRAM_SUPPRESSED_OBSERVED');
    expect(loadCounterfactualAlwaysOnSamples()).toHaveLength(1);
  });

  it('records repeated candidates with diversity adjustment evidence', () => {
    const diversity = calculateDiversityAdjustment({
      symbol: 'HL만도',
      history: {
        symbol: 'HL만도',
        tradingDate: '2026-05-21',
        lastSignalAt: '2026-05-21T09:00:00.000+09:00',
        lastBuyAllowedAt: '2026-05-21T09:05:00.000+09:00',
        seenCount1d: 3,
        seenCount3d: 5,
        seenCount7d: 7,
        signalCount1d: 1,
        signalCount3d: 2,
        signalCount7d: 3,
        sector: '자동차',
      },
      asOf: '2026-05-21T09:30:00.000+09:00',
    });
    const result = recordCounterfactualForDecision({
      decision: decision({
        dataUsable: true,
        executionScore: 74,
        diversityAdjustment: diversity.totalDiversityAdjustment,
        freshnessPenalty: diversity.freshnessPenalty,
        discoveryBonus: diversity.discoveryBonus,
        sectorDiversityAdjustment: diversity.sectorDiversityAdjustment,
        finalScore: 74,
      }),
      candidateExposureHistory: diversity.history,
      freshnessPenalty: diversity.freshnessPenalty,
      discoveryBonus: diversity.discoveryBonus,
      sectorDiversityAdjustment: diversity.sectorDiversityAdjustment,
      totalDiversityAdjustment: diversity.totalDiversityAdjustment,
    });

    expect(result.sample.candidateExposureHistory?.symbol).toBe('HL만도');
    expect(result.sample.freshnessPenalty).toBeLessThan(0);
    expect(result.sample.learningLabels).toContain('REPEATED_CANDIDATE_OBSERVED');
    expect(result.sample.learningLabels).toContain('FRESHNESS_PENALTY_APPLIED');
    expect(result.recorded).toBe(true);
  });

  it('keeps AI narrative-only discovery as data gap instead of BUY_ALLOWED', () => {
    const diversity = calculateDiversityAdjustment({
      symbol: '123456',
      history: null,
      asOf: '2026-05-21T09:30:00.000+09:00',
    });
    const result = recordCounterfactualForDecision({
      decision: decision({
        dataUsable: false,
        executionScore: 0,
        advisoryScore: 20,
        excludedAiScore: 20,
        diversityAdjustment: diversity.totalDiversityAdjustment,
        discoveryBonus: diversity.discoveryBonus,
        finalScore: 68,
      }),
      aiEvidencePresent: true,
      aiEstimatedFeatureCount: 1,
      missingFields: ['quote'],
      discoveryBonus: diversity.discoveryBonus,
      totalDiversityAdjustment: diversity.totalDiversityAdjustment,
    });

    expect(result.sample.decision).toBe('NO_TRADE_DATA_INCOMPLETE');
    expect(result.sample.sampleType).toBe('DATA_GAP_COUNTERFACTUAL');
    expect(result.sample.learningLabels).toContain('AI_ESTIMATE_OBSERVED');
    expect(result.sample.learningLabels).toContain('DISCOVERY_BONUS_APPLIED');
  });
});
