// @responsibility Validate persisted autonomous Shadow decisions.
import { z } from 'zod';
import { PAPER_FEATURES, type PaperFeatureKey, type PaperObservationFeatures } from '../../../src/types/paperObservationFeatures.js';
import type { PaperAdaptiveCandidate, PaperAdaptiveEvidence, PaperAdaptiveState, PaperAdaptiveStats } from '../../../src/types/paperAdaptive.js';
import type { PaperStrategyTrade } from '../../../src/types/paperStrategy.js';
import { adaptiveRuleId, adaptiveRuleMatches } from './paperAdaptiveSelection.js';
import { toKstDateKey } from '../../calendar/krxTradingCalendar.js';
import { EMPTY_EVIDENCE_DIGEST, paperEvidenceDigest } from './paperStrategyEvidence.js';

const finite = z.number().finite(), count = finite.int().nonnegative();
const timestamp = z.string().datetime({ offset: true });
const date = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);
const feature = z.enum(Object.keys(PAPER_FEATURES) as [PaperFeatureKey, ...PaperFeatureKey[]]);
const rule = z.object({ feature, bucket: count, horizon: z.union([z.literal(1), z.literal(3), z.literal(5)]) })
  .refine(value => value.bucket <= PAPER_FEATURES[value.feature].cuts.length);
const stats = z.object({ sampleCount: count, dateCount: count, symbolCount: count,
  experimentIds: z.array(z.string().refine(value => value.trim().length > 0)).optional(),
  experimentIdsDigest: z.string().regex(/^[0-9a-f]{64}$/).optional(),
  meanNetReturnPct: finite.nullable(), meanDailyExcessPct: finite.nullable() }).refine(value => {
  const n = value.sampleCount, ids = value.experimentIds, digest = value.experimentIdsDigest;
  if (!ids && !digest) return false;
  if (ids && (ids.length !== n || new Set(ids).size !== n || (digest && digest !== paperEvidenceDigest(ids)))) return false;
  if (digest && (n === 0) !== (digest === EMPTY_EVIDENCE_DIGEST)) return false;
  return value.dateCount <= n && value.symbolCount <= n
    && (n ? value.dateCount > 0 && value.symbolCount > 0 && value.meanNetReturnPct !== null && value.meanDailyExcessPct !== null
      : value.dateCount === 0 && value.symbolCount === 0 && value.meanNetReturnPct === null && value.meanDailyExcessPct === null);
});
const policy = z.object({ version: z.literal('adaptive-features-v1'), windowEntryDates: z.literal(60), trainingFraction: z.literal(0.7),
  minimumSamples: z.literal(10), minimumEntryDates: z.literal(3), activationMarginDailyPct: z.literal(0.05),
  replacementMarginDailyPct: z.literal(0.05), maxActiveRules: z.literal(3) });
const reason = z.enum(['MISSING_INPUT', 'INSUFFICIENT_TRAINING', 'INSUFFICIENT_VALIDATION', 'NO_TRAINING_EDGE', 'NO_VALIDATION_EDGE', 'ACTIVE', 'RANKED_OUT']);
function validCandidate(value: PaperAdaptiveCandidate): boolean {
  if (value.training.experimentIds && value.validation.experimentIds) {
    const validationIds = new Set(value.validation.experimentIds);
    if (value.training.experimentIds.some(id => validationIds.has(id))) return false;
  }
  if (value.training.sampleCount && value.validation.sampleCount
    && statsDigest(value.training) === statsDigest(value.validation)) return false;
  return value.active === (value.reason === 'ACTIVE') && (!value.active || [value.training, value.validation].every(item =>
    item.sampleCount >= 10 && item.dateCount >= 3 && (item.meanNetReturnPct ?? 0) > 0 && (item.meanDailyExcessPct ?? 0) > 0));
}
const candidate = z.object({ rule, training: stats, validation: stats, active: z.boolean(), reason }).refine(validCandidate);
export const adaptiveEvidenceSchema = z.object({ cutoffAt: timestamp, evaluatedAt: timestamp, validationStartDate: date,
  policy, candidate }).refine(value => value.candidate.active && Date.parse(value.cutoffAt) <= Date.parse(value.evaluatedAt)
    && value.validationStartDate < toKstDateKey(new Date(value.cutoffAt)));
export const adaptiveStateSchema = z.object({ policy, tradingDate: date, evaluatedAt: timestamp, cutoffAt: timestamp,
  windowStartDate: date.nullable(), validationStartDate: date.nullable(), matureSampleCount: count, matureDateCount: count,
  candidates: z.array(candidate).length(Object.keys(PAPER_FEATURES).length),
  changes: z.array(z.object({ at: timestamp, feature, from: rule.nullable(), to: rule.nullable(), reason })).max(100),
}).refine((value: PaperAdaptiveState) => {
  if (value.cutoffAt !== new Date(`${value.tradingDate}T00:00:00+09:00`).toISOString()
    || toKstDateKey(new Date(value.evaluatedAt)) !== value.tradingDate
    || new Set(value.candidates.map(item => item.rule.feature)).size !== Object.keys(PAPER_FEATURES).length
    || value.candidates.filter(item => item.active).length > value.policy.maxActiveRules
    || value.matureDateCount > value.policy.windowEntryDates || value.matureDateCount > value.matureSampleCount) return false;
  if ((value.matureSampleCount === 0) !== (value.windowStartDate === null && value.validationStartDate === null)) return false;
  if (value.windowStartDate && value.validationStartDate && !(value.windowStartDate <= value.validationStartDate && value.validationStartDate < value.tradingDate)) return false;
  return value.changes.every((change, index) => Date.parse(change.at) <= Date.parse(value.evaluatedAt)
    && (!index || Date.parse(value.changes[index - 1].at) <= Date.parse(change.at))
    && (change.from !== null || change.to !== null)
    && (!change.from || change.from.feature === change.feature) && (!change.to || change.to.feature === change.feature)
    && (!change.from || !change.to || adaptiveRuleId(change.from) !== adaptiveRuleId(change.to)));
});
const featureSnapshot = z.object({ version: z.literal('observation-features-v1'), asOf: timestamp,
  technicalDate: date.nullable(), values: z.record(feature, finite.nullable()), financials: z.unknown() });
export const adaptiveObservationSchema = z.custom<PaperObservationFeatures>(value => featureSnapshot.safeParse(value).success);

export function validAdaptiveEntry(trade: PaperStrategyTrade): boolean {
  const evidence = trade.entryDecision.adaptiveEvidence;
  return Boolean(evidence && trade.entryDecision.evidence === null && trade.entryDecision.cohort === null
    && trade.entryDecision.reasonCode === 'ADAPTIVE_FEATURE_SELECTED'
    && trade.policy.version === trade.strategyVersion && trade.policy.horizonSelection === 'FORWARD_VALIDATED_FEATURE'
    && trade.policy.minimumSamples === evidence.policy.minimumSamples && trade.policy.minimumEntryDates === evidence.policy.minimumEntryDates
    && evidence.candidate.rule.horizon === trade.horizon
    && evidence.cutoffAt === new Date(`${trade.tradingDate}T00:00:00+09:00`).toISOString()
    && Date.parse(evidence.evaluatedAt) <= Date.parse(trade.entryAt)
    && toKstDateKey(new Date(evidence.evaluatedAt)) === trade.tradingDate
    && adaptiveRuleMatches(trade.entryObservation, evidence.candidate.rule, trade.entryAt));
}
export function sameAdaptiveEvidence(left: PaperAdaptiveEvidence | undefined, right: PaperAdaptiveEvidence | undefined): boolean {
  const normalized = (value: PaperAdaptiveEvidence) => ({ ...value, candidate: { ...value.candidate,
    training: normalizedStats(value.candidate.training), validation: normalizedStats(value.candidate.validation) } });
  return Boolean(left && right && JSON.stringify(normalized(left)) === JSON.stringify(normalized(right)));
}

function statsDigest(value: PaperAdaptiveStats): string | undefined {
  return value.experimentIdsDigest ?? (value.experimentIds && paperEvidenceDigest(value.experimentIds));
}
function normalizedStats(value: PaperAdaptiveStats) {
  return { sampleCount: value.sampleCount, dateCount: value.dateCount, symbolCount: value.symbolCount,
    experimentIdsDigest: statsDigest(value), meanNetReturnPct: value.meanNetReturnPct, meanDailyExcessPct: value.meanDailyExcessPct };
}
