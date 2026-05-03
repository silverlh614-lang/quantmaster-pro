// @responsibility LearningFreshnessGuard adapters for judgment-engine inputs

import { afterEach, describe, expect, it } from 'vitest';
import {
  applyFreshnessDecayToNeutralWeightedRecord,
  freshnessWeightFromMeta,
} from './learningFreshnessGuard.js';

const ENV_KEY = 'LEARNING_FRESHNESS_GUARD_ENABLED';

afterEach(() => {
  delete process.env[ENV_KEY];
});

describe('LearningFreshnessGuard judgment-engine adapters', () => {
  it('freshnessWeightFromMeta derives age from date', () => {
    process.env[ENV_KEY] = 'true';
    const weight = freshnessWeightFromMeta(
      { date: '2026-04-10' },
      undefined,
      new Date('2026-05-03T00:00:00Z'),
    );
    expect(weight).toBeCloseTo(0.3, 6);
  });

  it('condition weights decay toward neutral 1.0 instead of zero', () => {
    process.env[ENV_KEY] = 'true';
    const result = applyFreshnessDecayToNeutralWeightedRecord(
      { momentum: 1.8, per: 0.4 },
      { generatedAt: '2026-04-10T00:00:00Z' },
      undefined,
      new Date('2026-05-03T00:00:00Z'),
    );
    expect(result.momentum).toBeCloseTo(1 + 0.8 * 0.3, 6);
    expect(result.per).toBeCloseTo(1 - 0.6 * 0.3, 6);
  });
});
