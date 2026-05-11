// @responsibility P0-8 Gate2 near-miss attribution and preservation tests
import { describe, expect, it } from 'vitest';
import {
  accumulateGate2Attribution,
  buildGate2FreshAttribution,
  type Gate2BlockerBucket,
} from './gate2LeadershipAttribution.js';

function bucketsFrom(outputs: Parameters<typeof accumulateGate2Attribution>[1]): Gate2BlockerBucket[] {
  const acc = new Map<string, Gate2BlockerBucket>();
  accumulateGate2Attribution(acc, outputs);
  return Array.from(acc.values());
}

describe('P0-8 Gate2 condition attribution', () => {
  it('splits unavailable provider conditions from true failed and preserves watch/shadow', () => {
    const attribution = buildGate2FreshAttribution({
      buckets: bucketsFrom([
        { key: 'per', output: { score: 0, status: 'DATA_UNAVAILABLE', detail: 'per unavailable' } },
        { key: 'earnings_quality', output: { score: 0, status: 'DATA_UNAVAILABLE', detail: 'earnings unavailable' } },
        { key: 'supply_confluence', output: { score: 0, status: 'PROVIDER_DEGRADED', detail: 'provider degraded' } },
        { key: 'breakout_momentum', output: { score: 0, status: 'THRESHOLD_NOT_MET', detail: 'threshold=10 value=4' }, rawValue: 4, threshold: 10 },
      ]),
      candidates: 4,
      gate1Pass: 4,
      gate2Pass: 0,
      gate3Pass: 0,
      entries: 0,
      lastTriggerPass: 0,
    });

    expect(attribution.gate2UnavailableCount).toBe(3);
    expect(attribution.gate2TrueFailedCount).toBe(1);
    expect(attribution.gate2WatchPreservedCount).toBeGreaterThan(0);
    expect(attribution.gate2ShadowPreservedCount).toBeGreaterThan(0);
    expect(attribution.conditionGaps.filter((gap) => gap.status === 'UNAVAILABLE')).toHaveLength(3);
    expect(attribution.nearMissConditions).toEqual(['earnings_quality', 'per', 'supply_confluence']);
  });

  it('classifies breakout_momentum at 90% of threshold as PROBING near-miss with gap', () => {
    const attribution = buildGate2FreshAttribution({
      buckets: bucketsFrom([
        {
          key: 'breakout_momentum',
          output: { score: 0, status: 'THRESHOLD_NOT_MET', detail: 'value=9 threshold=10' },
          rawValue: 9,
          threshold: 10,
        },
      ]),
      candidates: 1,
      gate1Pass: 1,
      gate2Pass: 0,
      gate3Pass: 0,
      entries: 0,
      lastTriggerPass: 0,
    });

    const gap = attribution.conditionGaps.find((item) => item.code === 'breakout_momentum');
    expect(gap?.status).toBe('FAILED');
    expect(gap?.nearMiss).toBe(true);
    expect(gap?.nearMissBucket).toBe('PROBING');
    expect(gap?.gap).toBe(-1);
    expect(attribution.nearMissConditions).toContain('breakout_momentum');
  });

  it('keeps complete technical failure out of near-miss buckets', () => {
    const attribution = buildGate2FreshAttribution({
      buckets: bucketsFrom([
        { key: 'breakout_momentum', output: { score: 0, status: 'THRESHOLD_NOT_MET', detail: 'value=2 threshold=10' }, rawValue: 2, threshold: 10 },
      ]),
      candidates: 1,
      gate1Pass: 1,
      gate2Pass: 0,
      gate3Pass: 0,
      entries: 0,
      lastTriggerPass: 0,
    });

    expect(attribution.conditionGaps[0].nearMiss).toBeUndefined();
    expect(attribution.nearMissConditions).toEqual([]);
  });
});
