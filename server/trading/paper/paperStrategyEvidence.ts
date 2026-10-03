// @responsibility Share Shadow evidence primitives.
import { createHash } from 'node:crypto';
import type { PaperObservation } from '../../../src/types/paperExperiment.js';
import type { PaperStrategyCohort, PaperStrategyPolicy } from '../../../src/types/paperStrategy.js';

export const PAPER_NEWS_LOOKBACK_HOURS = 72;

/** Order-independent fingerprint of the sample set; storing every ID per decision grew the ledger quadratically. */
export function paperEvidenceDigest(ids: string[]): string {
  return createHash('sha256').update([...ids].sort().join('\n')).digest('hex');
}
export const EMPTY_EVIDENCE_DIGEST = paperEvidenceDigest([]);

export function paperStrategyCohort(
  observation: PaperObservation, asOf: string, policy: Pick<PaperStrategyPolicy, 'newsLookbackHours'> = { newsLookbackHours: PAPER_NEWS_LOOKBACK_HOURS },
): PaperStrategyCohort | null {
  if (observation.aboveMa20 !== true && observation.aboveMa20 !== false) return null;
  const cutoff = Date.parse(asOf);
  if (!Number.isFinite(cutoff)) return null;
  const recent = observation.news.some((item) => {
    const observed = Date.parse(item.observedAt);
    return observed <= cutoff && observed >= cutoff - policy.newsLookbackHours * 3_600_000;
  });
  return `${recent ? 'NEWS_RECENT' : 'NEWS_ABSENT'}_${observation.aboveMa20 ? 'ABOVE' : 'BELOW'}_MA20`;
}

export function scheduledPaperClose(tradingDate: string): string {
  return new Date(`${tradingDate}T15:30:00+09:00`).toISOString();
}
