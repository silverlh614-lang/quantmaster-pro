import { beforeEach, describe, expect, it } from 'vitest';
import { resolveSimpleTradeDecision } from './simpleDecision.js';
import {
  __resetCounterfactualAlwaysOnSamplesForTests,
  loadCounterfactualAlwaysOnSamples,
  recordCounterfactualForDecision,
} from './counterfactualAlwaysOn.js';

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
});
