// @responsibility Verify temporal correctness of empirical strategy evidence.
import { describe, expect, it } from 'vitest';
import { buildPaperStrategyEvidence, paperStrategyCohort } from './paperStrategyEvidence.js';
import { matureStrategySamples, strategyTestObservation } from './paperStrategyFixtures.js';

const cutoff = '2026-09-18T01:00:00Z';
const cohort = 'NEWS_ABSENT_ABOVE_MA20' as const;

describe('paper strategy evidence', () => {
  it('classifies joint news/trend cohorts with a bounded entry-time news window', () => {
    const observation = strategyTestObservation();
    observation.news = [{ id: 'news', headline: 'news', source: 'DART', observedAt: '2026-09-15T01:00:00Z' }];
    expect(paperStrategyCohort(observation, cutoff)).toBe('NEWS_RECENT_ABOVE_MA20');
    observation.news[0].observedAt = '2026-09-15T00:59:59Z';
    expect(paperStrategyCohort(observation, cutoff)).toBe(cohort);
    observation.news[0].observedAt = '2026-09-18T02:00:00Z';
    observation.aboveMa20 = false;
    expect(paperStrategyCohort(observation, cutoff)).toBe('NEWS_ABSENT_BELOW_MA20');
    observation.aboveMa20 = null;
    expect(paperStrategyCohort(observation, cutoff)).toBeNull();
  });

  it('selects D3 by net return per trading day on identical paired samples', () => {
    const result = buildPaperStrategyEvidence(matureStrategySamples(), cohort, cutoff);
    expect(result).toMatchObject({ sampleCount: 12, entryDateCount: 3, selectedHorizon: 3 });
    expect(result.horizons.map((item) => item.count)).toEqual([12, 12, 12]);
    expect(result.horizons.map((item) => item.meanDailyNetReturnPct)).toEqual([1, 3, 2]);
    expect(result.horizons.map((item) => item.winRatePct)).toEqual([100, 100, 100]);
  });

  it('ties favor shorter horizons and recomputes returns from each frozen cost model', () => {
    const samples = matureStrategySamples([3, 9, 15]);
    expect(buildPaperStrategyEvidence(samples, cohort, cutoff).selectedHorizon).toBe(1);
    for (const item of samples) item.costModel.buyFeeRate = 0.2;
    expect(buildPaperStrategyEvidence(samples, cohort, cutoff).horizons.every((item) => item.meanNetReturnPct! < 0)).toBe(true);
  });

  it('excludes immature, missing, future, malformed and intraday outcomes from every horizon', () => {
    const samples = matureStrategySamples();
    samples[0].outcomes = samples[0].outcomes.filter((item) => item.horizon !== 5);
    samples[1].outcomes[2].availableAt = cutoff;
    samples[2].outcomes[2].availableAt = '2026-09-19T01:00:00Z';
    samples[3].outcomes[2].availableAt = 'invalid';
    samples[4].outcomes[2].availableAt = `${samples[4].outcomes[2].tradingDate}T06:00:00Z`;
    samples[5].outcomes[1].tradingDate = '2026-09-17';
    samples[6].outcomes[0].exitPrice = Infinity;
    samples[7].outcomes.push({ ...samples[7].outcomes[0] });
    const result = buildPaperStrategyEvidence(samples, cohort, cutoff);
    expect(result.sampleCount).toBe(4);
    expect(result.horizons.map((item) => item.count)).toEqual([4, 4, 4]);
  });

  it('does not inflate sample count with repeated symbol/date rows or unrelated cohorts', () => {
    const samples = matureStrategySamples();
    const duplicates = samples.map((item) => ({ ...structuredClone(item), id: `${item.id}-duplicate` }));
    expect(buildPaperStrategyEvidence([...samples, ...duplicates], cohort, cutoff).sampleCount).toBe(12);
    expect(buildPaperStrategyEvidence(matureStrategySamples([1, 9, 10], true), cohort, cutoff).sampleCount).toBe(0);
    expect(buildPaperStrategyEvidence(samples, 'NEWS_RECENT_ABOVE_MA20', cutoff).sampleCount).toBe(0);
  });

  it('uses each historical entry-time cohort rather than aging all historical news against today', () => {
    const result = buildPaperStrategyEvidence(matureStrategySamples([1, 9, 10], true), 'NEWS_RECENT_ABOVE_MA20', cutoff);
    expect(result.sampleCount).toBe(12);
    expect(buildPaperStrategyEvidence(matureStrategySamples(), cohort, 'invalid').sampleCount).toBe(0);
  });

  it('rejects mismatched or future baseline entry observations before using their trends', () => {
    const samples = matureStrategySamples();
    samples[0].entryObservation.observedAt = '2026-09-18T01:00:00Z';
    samples[1].entryObservation.symbol = '999999';
    samples[2].entryObservation.price = 12345;
    samples[3].entryObservation.observedAt = 'invalid';
    samples[4].entryObservation.observedAt = '2026-09-01T01:00:00Z';
    expect(buildPaperStrategyEvidence(samples, cohort, cutoff).sampleCount).toBe(7);
  });
});
