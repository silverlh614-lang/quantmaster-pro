// @responsibility ADR-452c Gate Score Health visibility diagnostics 회귀 테스트
import { describe, expect, it } from 'vitest';
import {
  accumulateGateScoreHealth,
  buildGateScoreHealthSummary,
  createScanCounters,
  formatGateScoreHealthSection,
} from './scanDiagnostics.js';

describe('ADR-452c accumulateGateScoreHealth', () => {
  it('raw/available/normalized 평균을 계산한다', () => {
    const counters = createScanCounters();
    accumulateGateScoreHealth(counters, {
      rawScore: 4,
      availableMaxScore: 8,
      normalizedGateScore: 0.5,
    });
    accumulateGateScoreHealth(counters, {
      rawScore: 6,
      availableMaxScore: 10,
      normalizedGateScore: 0.7,
    });

    const summary = buildGateScoreHealthSummary(counters);
    expect(summary.samples).toBe(2);
    expect(summary.rawScoreAvg).toBe(5);
    expect(summary.availableMaxScoreAvg).toBe(9);
    expect(summary.normalizedGateScoreAvg).toBeCloseTo(0.6);
  });

  it('rawScore가 없으면 gateScore fallback으로 누적한다', () => {
    const counters = createScanCounters();
    accumulateGateScoreHealth(counters, {
      gateScore: 7,
      availableMaxScore: 10,
      normalizedGateScore: 0.7,
    });

    expect(buildGateScoreHealthSummary(counters).rawScoreAvg).toBe(7);
  });

  it('unavailable 조건 top count가 누적된다', () => {
    const counters = createScanCounters();
    accumulateGateScoreHealth(counters, {
      rawScore: 3,
      availableMaxScore: 5,
      normalizedGateScore: 0.6,
      unavailableConditions: ['supply_confluence', 'earnings_quality'],
    });
    accumulateGateScoreHealth(counters, {
      rawScore: 4,
      availableMaxScore: 6,
      normalizedGateScore: 0.67,
      unavailableConditions: ['supply_confluence'],
    });

    expect(buildGateScoreHealthSummary(counters).unavailableTop).toEqual([
      { condition: 'supply_confluence', count: 2 },
      { condition: 'earnings_quality', count: 1 },
    ]);
  });

  it('thresholdNotMet 조건 top count가 누적된다', () => {
    const counters = createScanCounters();
    accumulateGateScoreHealth(counters, {
      rawScore: 2,
      availableMaxScore: 8,
      normalizedGateScore: 0.25,
      thresholdNotMetConditions: ['volume_breakout', 'turtle_high'],
    });
    accumulateGateScoreHealth(counters, {
      rawScore: 3,
      availableMaxScore: 8,
      normalizedGateScore: 0.375,
      thresholdNotMetConditions: ['volume_breakout'],
    });

    expect(buildGateScoreHealthSummary(counters).thresholdNotMetTop).toEqual([
      { condition: 'volume_breakout', count: 2 },
      { condition: 'turtle_high', count: 1 },
    ]);
  });

  it('providerDegraded 조건 top count가 누적된다', () => {
    const counters = createScanCounters();
    accumulateGateScoreHealth(counters, {
      rawScore: 5,
      availableMaxScore: 9,
      normalizedGateScore: 0.56,
      providerDegradedConditions: ['investor_flow', 'sector_energy'],
    });
    accumulateGateScoreHealth(counters, {
      rawScore: 5,
      availableMaxScore: 9,
      normalizedGateScore: 0.56,
      providerDegradedConditions: ['investor_flow'],
    });

    expect(buildGateScoreHealthSummary(counters).providerDegradedTop).toEqual([
      { condition: 'investor_flow', count: 2 },
      { condition: 'sector_energy', count: 1 },
    ]);
  });
});

describe('ADR-452c buildGateScoreHealthSummary diagnosis', () => {
  it('NO_SAMPLES를 반환한다', () => {
    expect(buildGateScoreHealthSummary(createScanCounters())).toMatchObject({
      samples: 0,
      diagnosis: 'NO_SAMPLES',
      unavailableTop: [],
      thresholdNotMetTop: [],
      providerDegradedTop: [],
    });
  });

  it.each([
    [
      'DATA_UNAVAILABLE_DOMINANT',
      { unavailableConditions: ['supply_confluence', 'earnings_quality'] },
    ],
    [
      'THRESHOLD_NOT_MET_DOMINANT',
      { thresholdNotMetConditions: ['volume_breakout', 'turtle_high'] },
    ],
    [
      'PROVIDER_DEGRADED_DOMINANT',
      { providerDegradedConditions: ['investor_flow', 'sector_energy'] },
    ],
    [
      'MIXED',
      {
        unavailableConditions: ['supply_confluence'],
        thresholdNotMetConditions: ['volume_breakout'],
      },
    ],
  ] as const)('%s를 산출한다', (expected, conditionFields) => {
    const counters = createScanCounters();
    accumulateGateScoreHealth(counters, {
      rawScore: 4,
      availableMaxScore: 8,
      normalizedGateScore: 0.5,
      ...conditionFields,
    });

    expect(buildGateScoreHealthSummary(counters).diagnosis).toBe(expected);
  });
});

describe('ADR-452c formatGateScoreHealthSection', () => {
  it('normalized avg를 %로 표시한다', () => {
    const section = formatGateScoreHealthSection({
      samples: 2,
      rawScoreAvg: 4.8,
      availableMaxScoreAvg: 7.2,
      normalizedGateScoreAvg: 2 / 3,
      unavailableTop: [{ condition: 'supply_confluence', count: 12 }],
      thresholdNotMetTop: [{ condition: 'volume_breakout', count: 18 }],
      providerDegradedTop: [{ condition: 'investor_flow', count: 3 }],
      diagnosis: 'MIXED',
    });

    expect(section).toContain('📊 Gate Score Health (ADR-452)');
    expect(section).toContain('normalized avg: 66.7%');
    expect(section).toContain('supply_confluence×12');
    expect(section).toContain('volume_breakout×18');
    expect(section).toContain('investor_flow×3');
  });

  it('NO_SAMPLES일 때 null로 미렌더한다', () => {
    expect(
      formatGateScoreHealthSection(
        buildGateScoreHealthSummary(createScanCounters()),
      ),
    ).toBeNull();
  });
});
