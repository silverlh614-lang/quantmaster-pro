// @responsibility ADR-452d Gate score candidate bucket diagnostics 회귀 테스트
import { describe, expect, it } from 'vitest';
import {
  classifyGateScoreCandidateBucket,
  type GateScoreCandidateBucket,
} from './gateScoreCandidateBucket.js';
import {
  accumulateGateScoreCandidateBucket,
  buildGateScoreCandidateBucketSummary,
  createScanCounters,
  formatGateScoreCandidateBucketSection,
} from './scanDiagnostics.js';

const normalThreshold = 5;

function classify(
  input: Partial<Parameters<typeof classifyGateScoreCandidateBucket>[0]>,
) {
  return classifyGateScoreCandidateBucket({
    gateScore: input.gateScore ?? input.rawScore ?? 0,
    normalThreshold,
    ...input,
  });
}

describe('ADR-452d classifyGateScoreCandidateBucket', () => {
  it('raw >= normalThreshold → EXECUTABLE', () => {
    expect(classify({ rawScore: 5, normalizedGateScore: 0.3 }).bucket).toBe(
      'EXECUTABLE',
    );
  });

  it('raw near normal + normalized >= 0.65 + unavailable exists → DATA_BLOCKED_NEAR_MISS', () => {
    expect(
      classify({
        rawScore: 4.6,
        normalizedGateScore: 0.66,
        unavailableConditions: ['supply_confluence'],
      }).bucket,
    ).toBe('DATA_BLOCKED_NEAR_MISS');
  });

  it('raw near normal but no unavailable → PROBING', () => {
    expect(classify({ rawScore: 4.6, normalizedGateScore: 0.66 }).bucket).toBe(
      'PROBING',
    );
  });

  it('normalized >= 0.60 → PROBING', () => {
    expect(classify({ rawScore: 3.5, normalizedGateScore: 0.61 }).bucket).toBe(
      'PROBING',
    );
  });

  it('normalized >= 0.45 → SHADOW_ONLY', () => {
    expect(classify({ rawScore: 3.5, normalizedGateScore: 0.45 }).bucket).toBe(
      'SHADOW_ONLY',
    );
  });

  it('below bands → REJECTED', () => {
    expect(classify({ rawScore: 3.5, normalizedGateScore: 0.44 }).bucket).toBe(
      'REJECTED',
    );
  });

  it('all bucket decisions have executionImpact: NONE', () => {
    const cases: Array<
      [GateScoreCandidateBucket, Parameters<typeof classify>[0]]
    > = [
      ['EXECUTABLE', { rawScore: 5 }],
      [
        'DATA_BLOCKED_NEAR_MISS',
        {
          rawScore: 4.6,
          normalizedGateScore: 0.66,
          unavailableConditions: ['supply_confluence'],
        },
      ],
      ['PROBING', { rawScore: 4.6, normalizedGateScore: 0.66 }],
      ['SHADOW_ONLY', { rawScore: 3.5, normalizedGateScore: 0.45 }],
      ['REJECTED', { rawScore: 3.5, normalizedGateScore: 0.44 }],
    ];

    for (const [bucket, input] of cases) {
      const decision = classify(input);
      expect(decision.bucket).toBe(bucket);
      expect(decision.executionImpact).toBe('NONE');
    }
  });
});

describe('ADR-452d scan diagnostics accumulation and formatting', () => {
  it('accumulate helper increments DATA_BLOCKED_NEAR_MISS and unavailable top counts', () => {
    const counters = createScanCounters();
    accumulateGateScoreCandidateBucket(
      counters,
      {
        gateScore: 4.6,
        rawScore: 4.6,
        normalizedGateScore: 0.66,
        unavailableConditions: ['supply_confluence', 'earnings_quality'],
      },
      normalThreshold,
    );
    accumulateGateScoreCandidateBucket(
      counters,
      {
        gateScore: 4.7,
        rawScore: 4.7,
        normalizedGateScore: 0.7,
        unavailableConditions: ['supply_confluence'],
      },
      normalThreshold,
    );

    const summary = buildGateScoreCandidateBucketSummary(counters);
    expect(summary.counts.DATA_BLOCKED_NEAR_MISS).toBe(2);
    expect(summary.dataBlockedNearMissTopUnavailable).toEqual([
      { condition: 'supply_confluence', count: 2 },
      { condition: 'earnings_quality', count: 1 },
    ]);
  });

  it('formatter hides section when no nearMiss/probing/shadowOnly', () => {
    expect(
      formatGateScoreCandidateBucketSection(
        buildGateScoreCandidateBucketSummary(createScanCounters()),
      ),
    ).toBeNull();
  });

  it('formatter prints executionImpact: NONE', () => {
    const counters = createScanCounters();
    accumulateGateScoreCandidateBucket(
      counters,
      {
        gateScore: 4.6,
        rawScore: 4.6,
        normalizedGateScore: 0.66,
        unavailableConditions: ['supply_confluence'],
      },
      normalThreshold,
    );
    accumulateGateScoreCandidateBucket(
      counters,
      {
        gateScore: 3.5,
        rawScore: 3.5,
        normalizedGateScore: 0.61,
        thresholdNotMetConditions: ['volume_breakout'],
      },
      normalThreshold,
    );

    const section = formatGateScoreCandidateBucketSection(
      buildGateScoreCandidateBucketSummary(counters),
    );

    expect(section).toContain('🟡 Gate Near-Miss Buckets (ADR-452d)');
    expect(section).toContain('executionImpact: NONE');
    expect(section).toContain('outcomeLedger: recorded 0, skipped 0 (ADR-454, 3/5/10d)');
    expect(section).toContain('DATA_BLOCKED_NEAR_MISS: 1');
    expect(section).toContain('PROBING: 1');
    expect(section).toContain('supply_confluence×1');
    expect(section).toContain('volume_breakout×1');
  });
});
