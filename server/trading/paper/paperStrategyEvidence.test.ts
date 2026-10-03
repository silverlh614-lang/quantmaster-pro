// @responsibility Verify temporal correctness of empirical strategy evidence.
import { describe, expect, it } from 'vitest';
import { EMPTY_EVIDENCE_DIGEST, paperEvidenceDigest, paperStrategyCohort } from './paperStrategyEvidence.js';
import { strategyTestObservation } from './paperStrategyFixtures.js';

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

  it('fingerprints the same sample set independently of input order', () => {
    expect(paperEvidenceDigest(['b', 'a'])).toBe(paperEvidenceDigest(['a', 'b']));
    expect(paperEvidenceDigest(['a'])).not.toBe(paperEvidenceDigest(['b']));
    expect(paperEvidenceDigest([])).toBe(EMPTY_EVIDENCE_DIGEST);
  });
});
