// @responsibility Validate persisted autonomous Shadow decisions.
import { z } from 'zod';
import { PAPER_FEATURES, PAPER_LEGACY_FEATURE_KEYS, type PaperFeatureKey, type PaperObservationFeatures } from '../../../src/types/paperObservationFeatures.js';
import type { PaperAdaptiveCandidate, PaperAdaptiveEvidence, PaperAdaptiveState, PaperAdaptiveStats, PaperExplorationEvidence, PaperIndicatorInvention } from '../../../src/types/paperAdaptive.js';
import { PAPER_INVENTED_FEATURE_CUTS, PAPER_MAX_INVENTIONS, PAPER_MAX_INVENTION_ATTEMPTS,
  paperIndicatorFormulaId, validPaperIndicatorFormula, type PaperIndicatorFormula, type PaperInventedFeatureId } from '../../../src/types/paperIndicatorFormula.js';
import type { PaperStrategyTrade } from '../../../src/types/paperStrategy.js';
import { adaptiveRuleId, adaptiveRuleMatches } from './paperAdaptiveSelection.js';
import { toKstDateKey } from '../../calendar/krxTradingCalendar.js';
import { EMPTY_EVIDENCE_DIGEST, paperEvidenceDigest } from './paperStrategyEvidence.js';

const finite = z.number().finite(), count = finite.int().nonnegative();
const timestamp = z.string().datetime({ offset: true });
const date = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);
const feature = z.enum(Object.keys(PAPER_FEATURES) as [PaperFeatureKey, ...PaperFeatureKey[]]);
const horizon = z.union([z.literal(1), z.literal(3), z.literal(5)]);
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
const inventedId = z.custom<PaperInventedFeatureId>(value => {
  if (typeof value !== 'string') return false;
  const [prefix, operation, left, right, ...extra] = value.split(':');
  return prefix === 'invented' && ['mean', 'difference', 'product'].includes(operation) && !extra.length
    && Object.hasOwn(PAPER_FEATURES, left) && Object.hasOwn(PAPER_FEATURES, right) && left < right;
});
const adaptiveFeature = z.union([feature, inventedId]);
const sufficientPositive = (value: PaperAdaptiveStats) => value.sampleCount >= 10 && value.dateCount >= 3
  && (value.meanNetReturnPct ?? 0) > 0 && (value.meanDailyExcessPct ?? 0) > 0;
const invention = z.object({ id: inventedId, formula: z.custom<PaperIndicatorFormula>(validPaperIndicatorFormula),
  createdAt: timestamp, discoveryCutoffAt: timestamp,
  rule: z.object({ bucket: count.max(PAPER_INVENTED_FEATURE_CUTS.length), horizon }), training: stats,
}).refine(value => value.id === paperIndicatorFormulaId(value.formula) && sufficientPositive(value.training)
  && value.discoveryCutoffAt === new Date(`${toKstDateKey(new Date(value.createdAt))}T00:00:00+09:00`).toISOString());
const rule = z.object({ feature: adaptiveFeature, bucket: count, horizon, invention: invention.optional() })
  .refine(value => value.invention
    ? value.feature === value.invention.id && value.bucket === value.invention.rule.bucket && value.horizon === value.invention.rule.horizon
    : Object.hasOwn(PAPER_FEATURES, value.feature) && value.bucket <= PAPER_FEATURES[value.feature as PaperFeatureKey].cuts.length);
const policy = z.object({ version: z.literal('adaptive-features-v1'), windowEntryDates: z.literal(60), trainingFraction: z.literal(0.7),
  maturityModel: z.literal('per-horizon-v1').optional(),
  minimumSamples: z.literal(10), minimumEntryDates: z.literal(3), activationMarginDailyPct: z.literal(0.05),
  replacementMarginDailyPct: z.literal(0.05), maxActiveRules: z.literal(3) });
const reason = z.enum(['MISSING_INPUT', 'INSUFFICIENT_TRAINING', 'INSUFFICIENT_VALIDATION', 'NO_TRAINING_EDGE', 'NO_VALIDATION_EDGE', 'ACTIVE', 'RANKED_OUT', 'FORWARD_OBSERVATION', 'DISCOVERY_RETIRED']);
function validCandidate(value: PaperAdaptiveCandidate): boolean {
  if (value.reason === 'DISCOVERY_RETIRED' || (value.reason === 'FORWARD_OBSERVATION' && !value.rule.invention)) return false;
  if (value.rule.invention && JSON.stringify(normalizedStats(value.training)) !== JSON.stringify(normalizedStats(value.rule.invention.training))) return false;
  if (value.training.experimentIds && value.validation.experimentIds) {
    const validationIds = new Set(value.validation.experimentIds);
    if (value.training.experimentIds.some(id => validationIds.has(id))) return false;
  }
  if (value.training.sampleCount && value.validation.sampleCount
    && statsDigest(value.training) === statsDigest(value.validation)) return false;
  return value.active === (value.reason === 'ACTIVE') && (!value.active || [value.training, value.validation].every(sufficientPositive));
}
const candidate = z.object({ rule, training: stats, validation: stats, active: z.boolean(), reason }).refine(validCandidate);
const explorationCandidate = candidate.refine(value => !value.active
  && ['MISSING_INPUT', 'INSUFFICIENT_TRAINING', 'INSUFFICIENT_VALIDATION', 'FORWARD_OBSERVATION'].includes(value.reason));
const trialId = z.string().max(240).regex(/^shadow-exploration-v1:\d{4}-\d{2}-\d{2}:[1-9]\d*:.+$/);
const exploration = z.object({ version: z.literal('shadow-exploration-v1'), sequence: count.positive(),
  rules: z.array(z.object({ id: trialId, registeredAt: timestamp, candidate: explorationCandidate })).max(2),
}).refine(value => new Set(value.rules.map(item => item.id)).size === value.rules.length
  && new Set(value.rules.map(item => adaptiveRuleId(item.candidate.rule))).size === value.rules.length);
export const adaptiveEvidenceSchema = z.object({ cutoffAt: timestamp, evaluatedAt: timestamp, validationStartDate: date,
  policy, candidate }).refine(value => value.candidate.active && Date.parse(value.cutoffAt) <= Date.parse(value.evaluatedAt)
    && value.validationStartDate < toKstDateKey(new Date(value.cutoffAt))
    && (!value.candidate.rule.invention || (Date.parse(value.candidate.rule.invention.createdAt) < Date.parse(value.cutoffAt)
      && value.validationStartDate > toKstDateKey(new Date(value.candidate.rule.invention.createdAt)))));
export const explorationEvidenceSchema = z.object({ cutoffAt: timestamp, evaluatedAt: timestamp,
  validationStartDate: date.nullable(), policy, candidate: explorationCandidate, trialId, registeredAt: timestamp,
}).refine(value => Date.parse(value.cutoffAt) <= Date.parse(value.evaluatedAt)
  && toKstDateKey(new Date(value.registeredAt)) === toKstDateKey(new Date(value.cutoffAt))
  && toKstDateKey(new Date(value.evaluatedAt)) === toKstDateKey(new Date(value.cutoffAt))
  && value.trialId === `shadow-exploration-v1:${toKstDateKey(new Date(value.registeredAt))}:${value.trialId.split(':')[2]}:${adaptiveRuleId(value.candidate.rule)}`
  && (!value.validationStartDate || value.validationStartDate < toKstDateKey(new Date(value.cutoffAt)))
  && (!value.candidate.rule.invention || Date.parse(value.candidate.rule.invention.createdAt) <= Date.parse(value.registeredAt)));
const discovery = z.object({ version: z.literal('indicator-discovery-v1'), round: count.positive(), roundStartedAt: timestamp,
  roundTrainingEndDate: date.nullable(), attemptedIds: z.array(inventedId).max(PAPER_MAX_INVENTION_ATTEMPTS),
  inventions: z.array(invention).max(PAPER_MAX_INVENTIONS),
}).refine(value => new Set(value.attemptedIds).size === value.attemptedIds.length
  && new Set(value.inventions.map(item => item.id)).size === value.inventions.length
  && (!value.roundTrainingEndDate || value.roundTrainingEndDate < toKstDateKey(new Date(value.roundStartedAt))));
const chance = finite.positive().max(100);
const placebo = z.object({ version: z.literal('symbol-permutation-v1'), permutations: count.positive(), passedCount: count,
  shuffledMeanPassedCount: finite.nonnegative(), shuffledHighPassedCount: count, chancePct: chance,
  rules: z.array(z.object({ feature: adaptiveFeature, bucket: count, horizon, chancePct: chance })) })
  .refine(value => value.rules.length === value.passedCount);
const horizonSamples = z.array(z.object({ horizon, matureSampleCount: count, matureDateCount: count,
  trainingSampleCount: count, trainingDateCount: count, validationSampleCount: count, validationDateCount: count,
}).refine(value => [
  [value.matureSampleCount, value.matureDateCount], [value.trainingSampleCount, value.trainingDateCount],
  [value.validationSampleCount, value.validationDateCount],
].every(([samples, dates]) => dates <= samples && (samples === 0) === (dates === 0))
  && value.trainingSampleCount + value.validationSampleCount <= value.matureSampleCount
  && value.trainingDateCount + value.validationDateCount <= value.matureDateCount))
  .length(3).refine(value => new Set(value.map(item => item.horizon)).size === 3);
export const adaptiveStateSchema = z.object({ policy, tradingDate: date, evaluatedAt: timestamp, cutoffAt: timestamp,
  windowStartDate: date.nullable(), validationStartDate: date.nullable(), matureSampleCount: count, matureDateCount: count,
  horizonSamples: horizonSamples.optional(),
  candidates: z.array(candidate).min(PAPER_LEGACY_FEATURE_KEYS.length).max(Object.keys(PAPER_FEATURES).length + PAPER_MAX_INVENTIONS),
  discovery: discovery.optional(),
  exploration: exploration.optional(),
  placebo: placebo.optional(),
  changes: z.array(z.object({ at: timestamp, feature: adaptiveFeature, from: rule.nullable(), to: rule.nullable(), reason })).max(100),
}).refine((value: PaperAdaptiveState) => {
  const baseFeatures = value.candidates.filter(item => !item.rule.invention).map(item => item.rule.feature);
  const catalog = baseFeatures.length === PAPER_LEGACY_FEATURE_KEYS.length ? PAPER_LEGACY_FEATURE_KEYS : Object.keys(PAPER_FEATURES);
  const expected = [...catalog, ...(value.discovery?.inventions.map(item => item.id) ?? [])];
  if (value.cutoffAt !== new Date(`${value.tradingDate}T00:00:00+09:00`).toISOString()
    || toKstDateKey(new Date(value.evaluatedAt)) !== value.tradingDate
    || value.candidates.length !== expected.length || new Set(value.candidates.map(item => item.rule.feature)).size !== expected.length
    || expected.some(key => !value.candidates.some(item => item.rule.feature === key))
    || value.candidates.filter(item => item.active).length > value.policy.maxActiveRules
    || value.matureDateCount > value.policy.windowEntryDates || value.matureDateCount > value.matureSampleCount
    || value.horizonSamples?.some(item => item.matureSampleCount > value.matureSampleCount || item.matureDateCount > value.matureDateCount)) return false;
  if ((value.matureSampleCount === 0) !== (value.windowStartDate === null && value.validationStartDate === null)) return false;
  if (value.windowStartDate && value.validationStartDate && !(value.windowStartDate <= value.validationStartDate && value.validationStartDate < value.tradingDate)) return false;
  if (value.discovery && (Date.parse(value.discovery.roundStartedAt) > Date.parse(value.evaluatedAt)
    || value.discovery.inventions.some(item => Date.parse(item.createdAt) > Date.parse(value.evaluatedAt)))) return false;
  if (value.exploration?.rules.some(item => toKstDateKey(new Date(item.registeredAt)) !== value.tradingDate
    || item.id !== `shadow-exploration-v1:${value.tradingDate}:${value.exploration!.sequence}:${adaptiveRuleId(item.candidate.rule)}`
    || (item.candidate.rule.invention && (Date.parse(item.candidate.rule.invention.createdAt) > Date.parse(item.registeredAt)
      || !value.discovery?.inventions.some(saved => JSON.stringify(normalizedInvention(saved)) === JSON.stringify(normalizedInvention(item.candidate.rule.invention!))))))) return false;
  for (const item of value.candidates) if (item.rule.invention) {
    const saved = value.discovery?.inventions.find(entry => entry.id === item.rule.feature);
    if (!saved || JSON.stringify(normalizedInvention(saved)) !== JSON.stringify(normalizedInvention(item.rule.invention))
      || (item.validation.sampleCount > 0 && !(Date.parse(item.rule.invention.createdAt) < Date.parse(value.cutoffAt)))) return false;
  }
  return value.changes.every((change, index) => Date.parse(change.at) <= Date.parse(value.evaluatedAt)
    && (!index || Date.parse(value.changes[index - 1].at) <= Date.parse(change.at))
    && (change.from !== null || change.to !== null)
    && [change.from, change.to].every(item => !item?.invention || Date.parse(item.invention.createdAt) <= Date.parse(change.at))
    && (!change.from || change.from.feature === change.feature) && (!change.to || change.to.feature === change.feature)
    && (!change.from || !change.to || adaptiveRuleId(change.from) !== adaptiveRuleId(change.to)));
});
const featureSnapshot = z.object({ version: z.literal('observation-features-v1'), asOf: timestamp,
  technicalDate: date.nullable(), values: z.partialRecord(feature, finite.nullable())
    .refine(values => PAPER_LEGACY_FEATURE_KEYS.every(key => Object.hasOwn(values, key))), financials: z.unknown() });
export const adaptiveObservationSchema = z.custom<PaperObservationFeatures>(value => featureSnapshot.safeParse(value).success);

export function validAdaptiveEntry(trade: PaperStrategyTrade): boolean {
  const evidence = trade.entryDecision.adaptiveEvidence;
  return Boolean(evidence && !trade.entryDecision.explorationEvidence && trade.entryDecision.evidence === null && trade.entryDecision.cohort === null
    && trade.entryDecision.reasonCode === 'ADAPTIVE_FEATURE_SELECTED'
    && trade.policy.version === trade.strategyVersion && trade.policy.horizonSelection === 'FORWARD_VALIDATED_FEATURE'
    && trade.policy.minimumSamples === evidence.policy.minimumSamples && trade.policy.minimumEntryDates === evidence.policy.minimumEntryDates
    && evidence.candidate.rule.horizon === trade.horizon
    && evidence.cutoffAt === new Date(`${trade.tradingDate}T00:00:00+09:00`).toISOString()
    && Date.parse(evidence.evaluatedAt) <= Date.parse(trade.entryAt)
    && toKstDateKey(new Date(evidence.evaluatedAt)) === trade.tradingDate
    && adaptiveRuleMatches(trade.entryObservation, evidence.candidate.rule, trade.entryAt));
}
export function validExplorationEntry(trade: PaperStrategyTrade): boolean {
  const evidence = trade.entryDecision.explorationEvidence;
  return Boolean(evidence && !trade.entryDecision.adaptiveEvidence && trade.entryDecision.evidence === null && trade.entryDecision.cohort === null
    && trade.entryDecision.reasonCode === 'ADAPTIVE_EXPLORATION_SELECTED'
    && trade.policy.version === trade.strategyVersion && trade.policy.horizonSelection === 'FORWARD_VALIDATED_FEATURE'
    && trade.policy.minimumSamples === evidence.policy.minimumSamples && trade.policy.minimumEntryDates === evidence.policy.minimumEntryDates
    && evidence.candidate.rule.horizon === trade.horizon
    && evidence.cutoffAt === new Date(`${trade.tradingDate}T00:00:00+09:00`).toISOString()
    && Date.parse(evidence.evaluatedAt) <= Date.parse(trade.entryAt)
    && Date.parse(evidence.registeredAt) < Date.parse(trade.entryObservation.observedAt)
    && trade.entryObservation.features && Date.parse(evidence.registeredAt) < Date.parse(trade.entryObservation.features.asOf)
    && toKstDateKey(new Date(evidence.registeredAt)) === trade.tradingDate
    && adaptiveRuleMatches(trade.entryObservation, evidence.candidate.rule, trade.entryAt));
}
function normalizedEvidence(value: PaperAdaptiveEvidence | PaperExplorationEvidence) {
  return { ...value, candidate: { ...value.candidate,
    rule: { ...value.candidate.rule, ...(value.candidate.rule.invention ? { invention: normalizedInvention(value.candidate.rule.invention) } : {}) },
    training: normalizedStats(value.candidate.training), validation: normalizedStats(value.candidate.validation) } };
}
export function sameAdaptiveEvidence(left: PaperAdaptiveEvidence | undefined, right: PaperAdaptiveEvidence | undefined): boolean {
  return Boolean(left && right && JSON.stringify(normalizedEvidence(left)) === JSON.stringify(normalizedEvidence(right)));
}
export function sameExplorationEvidence(left: PaperExplorationEvidence | undefined, right: PaperExplorationEvidence | undefined): boolean {
  return Boolean(left && right && JSON.stringify(normalizedEvidence(left)) === JSON.stringify(normalizedEvidence(right)));
}

function normalizedInvention(value: PaperIndicatorInvention) {
  return { ...value, training: normalizedStats(value.training) };
}

function statsDigest(value: PaperAdaptiveStats): string | undefined {
  return value.experimentIdsDigest ?? (value.experimentIds && paperEvidenceDigest(value.experimentIds));
}
function normalizedStats(value: PaperAdaptiveStats) {
  return { sampleCount: value.sampleCount, dateCount: value.dateCount, symbolCount: value.symbolCount,
    experimentIdsDigest: statsDigest(value), meanNetReturnPct: value.meanNetReturnPct, meanDailyExcessPct: value.meanDailyExcessPct };
}
