import { describe, expect, it } from 'vitest';
import {
  attachForwardReturn,
  buildForwardReturnSnapshot,
  buildGateAttribution,
  closeOutcomeLabel,
} from './outcomeClosure.js';
import { seed } from './outcomeSeedCreation.test.js';

describe('ADR-0522 gate attribution analyzer', () => {
  it('marks strong Gate2 axes as positive on WIN', () => {
    const s = seed({ gate2AxisScores: { SUPPLY_CONFLUENCE: 92, TECHNICAL_TREND: 72, FUNDAMENTAL_QUALITY: null } });
    const labeled = closeOutcomeLabel(attachForwardReturn(s, buildForwardReturnSnapshot({
      seed: s,
      horizon: '10D',
      asOf: '2026-06-03',
      closePrice: 11_600,
      highPrice: 11_800,
      lowPrice: 9_800,
    })));
    const attribution = buildGateAttribution(labeled);

    expect(attribution?.gate2Contribution.positiveAxes).toContain('SUPPLY_CONFLUENCE');
    expect(attribution?.gate2Contribution.missingAxes).toContain('FUNDAMENTAL_QUALITY');
    expect(attribution?.gate3Contribution.lastTriggerContribution).toBe('NEGATIVE');
  });

  it('marks block reason as over-block candidate on MISSED_WIN', () => {
    const labeled = {
      ...seed(),
      decisionType: 'LIVE_BLOCKED' as const,
      blockReasons: ['R6_DEFENSE_LIVE_BUY_BLOCKED'],
      outcomeStatus: 'LABELED' as const,
      outcomeLabel: 'MISSED_WIN' as const,
      finalLearningLabel: 'MISSED_WIN' as const,
    };
    const attribution = buildGateAttribution(labeled);

    expect(attribution?.policyContribution.blockOutcome).toBe('MISSED_WIN');
    expect(attribution?.policyContribution.blockReason).toBe('R6_DEFENSE_LIVE_BUY_BLOCKED');
  });

  it('excludes DATA_INSUFFICIENT from attribution', () => {
    const attribution = buildGateAttribution({
      ...seed(),
      outcomeStatus: 'DATA_INSUFFICIENT',
      outcomeLabel: 'DATA_INSUFFICIENT',
      finalLearningLabel: 'DATA_INSUFFICIENT',
    });

    expect(attribution).toBeNull();
  });
});
