// @responsibility Validate persisted outcome-based Shadow allocation evidence.
import { z } from 'zod';
import type { PaperAdaptiveRule } from '../../../src/types/paperAdaptive.js';
import { PAPER_AUTONOMY_POLICY, paperAutonomyRuleKey, type PaperAutonomyAllocation, type PaperAutonomyStats } from '../../../src/types/paperAutonomy.js';
import { PAPER_FEATURES, type PaperFeatureKey } from '../../../src/types/paperObservationFeatures.js';
import { PAPER_INVENTED_FEATURE_CUTS, PAPER_MAX_INVENTIONS } from '../../../src/types/paperIndicatorFormula.js';
import { toKstDateKey } from '../../calendar/krxTradingCalendar.js';
import { EMPTY_EVIDENCE_DIGEST } from './paperStrategyEvidence.js';

const finite = z.number().finite(), count = finite.int().nonnegative();
const timestamp = z.string().datetime({ offset: true });
const reason = z.enum(['EXPLORE', 'INCREASE', 'REDUCE', 'MAINTAIN']);
const weight = z.union([z.literal(1), z.literal(2), z.literal(3)]);
const unique = (values: string[]) => new Set(values).size === values.length;
function validRuleKey(value: string): boolean {
  const [identity, born, ...extra] = value.split(':born:');
  const match = /^(.*):(0|[1-9]\d*):D([135])$/.exec(identity);
  if (!match || extra.length) return false;
  const feature = match[1], bucket = Number(match[2]);
  if (Object.hasOwn(PAPER_FEATURES, feature)) return born === undefined && bucket <= PAPER_FEATURES[feature as PaperFeatureKey].cuts.length;
  if (!born || !timestamp.safeParse(born).success || bucket > PAPER_INVENTED_FEATURE_CUTS.length) return false;
  if (/^invented:program:[a-f0-9]{64}$/.test(feature)) return true;
  const [prefix, operation, left, right, ...rest] = feature.split(':');
  return prefix === 'invented' && ['mean', 'difference', 'product'].includes(operation) && !rest.length
    && Object.hasOwn(PAPER_FEATURES, left) && Object.hasOwn(PAPER_FEATURES, right) && left < right;
}
const ruleKey = z.string().max(240).refine(validRuleKey);
const stats = z.object({
  totalCount: count, closedCount: count, pendingCount: count, sampleCount: count, dateCount: count,
  meanNetReturnPct: finite.nullable(), meanDateNetReturnPct: finite.nullable(), standardErrorPct: finite.nonnegative().nullable(),
  tradeIdsDigest: z.string().regex(/^[a-f0-9]{64}$/),
}).strict().refine(value => value.totalCount === value.closedCount + value.pendingCount
  && value.sampleCount <= value.closedCount && value.dateCount <= value.sampleCount && value.dateCount <= PAPER_AUTONOMY_POLICY.windowEntryDates
  && (value.pendingCount > 0 || value.sampleCount === value.closedCount)
  && (value.totalCount === 0) === (value.tradeIdsDigest === EMPTY_EVIDENCE_DIGEST)
  && (value.closedCount === 0) === (value.meanNetReturnPct === null)
  && (value.sampleCount === 0) === (value.dateCount === 0)
  && (value.sampleCount === 0) === (value.meanDateNetReturnPct === null)
  && (value.dateCount < 2) === (value.standardErrorPct === null));

function expectedReason(value: PaperAutonomyStats): z.infer<typeof reason> {
  if (value.sampleCount < PAPER_AUTONOMY_POLICY.minimumSamples || value.dateCount < PAPER_AUTONOMY_POLICY.minimumEntryDates) return 'EXPLORE';
  const mean = value.meanDateNetReturnPct!, margin = PAPER_AUTONOMY_POLICY.standardErrors * value.standardErrorPct!;
  return mean - margin > 0 ? 'INCREASE' : mean + margin < 0 ? 'REDUCE' : 'MAINTAIN';
}
function validWeight(value: { reason: z.infer<typeof reason>; weight: number; stats: PaperAutonomyStats }): boolean {
  return value.reason === expectedReason(value.stats)
    && value.weight === (value.reason === 'INCREASE' ? 3 : value.reason === 'REDUCE' ? 1 : 2);
}
function validEvaluation(value: { cutoffAt: string; evaluatedAt: string }): boolean {
  const day = toKstDateKey(value.evaluatedAt);
  return Boolean(day) && value.cutoffAt === new Date(`${day}T00:00:00+09:00`).toISOString()
    && Date.parse(value.cutoffAt) <= Date.parse(value.evaluatedAt);
}
function bornBeforeEvaluation(key: string, evaluatedAt: string): boolean {
  const born = key.split(':born:')[1];
  return !born || Date.parse(born) <= Date.parse(evaluatedAt);
}
const entry = z.object({ ruleKey, lastSelectedAt: timestamp.nullable(), reason, weight, stats }).strict().refine(validWeight);
export const paperAutonomyStateSchema = z.object({
  version: z.literal('shadow-autonomy-v1'), evaluatedAt: timestamp, cutoffAt: timestamp,
  status: z.enum(['READY', 'FALLBACK']), entries: z.array(entry).max(Object.keys(PAPER_FEATURES).length + PAPER_MAX_INVENTIONS),
  selectedRuleKeys: z.array(ruleKey).max(2), fallbackReason: z.string().trim().min(1).max(300).optional(),
  selectionHistory: z.array(z.object({ ruleKey, selectedAt: timestamp }).strict()).max(256).optional(),
}).strict().refine(value => {
  if (!validEvaluation(value) || !unique(value.entries.map(item => item.ruleKey)) || !unique(value.selectedRuleKeys)) return false;
  if (value.status === 'FALLBACK') return Boolean(value.fallbackReason) && !value.entries.length
    && !value.selectedRuleKeys.length && value.selectionHistory === undefined;
  if (value.fallbackReason !== undefined || value.selectedRuleKeys.some(key => !value.entries.some(item => item.ruleKey === key))) return false;
  if (value.selectionHistory) {
    const history = new Map(value.selectionHistory.map(item => [item.ruleKey, item.selectedAt]));
    if (!unique(value.selectionHistory.map(item => item.ruleKey))
      || value.entries.some(item => item.lastSelectedAt !== (history.get(item.ruleKey) ?? null))
      || value.selectionHistory.some(item => !bornBeforeEvaluation(item.ruleKey, item.selectedAt)
        || (value.selectedRuleKeys.includes(item.ruleKey) ? item.selectedAt !== value.evaluatedAt
          : Date.parse(item.selectedAt) >= Date.parse(value.cutoffAt)))) return false;
  }
  return value.entries.every(item => bornBeforeEvaluation(item.ruleKey, value.evaluatedAt)
    && (value.selectedRuleKeys.includes(item.ruleKey) ? item.lastSelectedAt === value.evaluatedAt
      : item.lastSelectedAt === null || Date.parse(item.lastSelectedAt) < Date.parse(value.cutoffAt)));
});
const choice = z.object({ ruleKey, purpose: z.enum(['VALIDATED', 'EXPLORATION']), weight,
  reason: z.enum(['EXPLORE', 'INCREASE', 'REDUCE', 'MAINTAIN', 'FIXED_VALIDATED', 'FALLBACK']), stats: stats.optional(),
}).strict();
export const paperAutonomyAllocationSchema = z.object({
  version: z.literal('shadow-autonomy-v1'), evaluatedAt: timestamp, cutoffAt: timestamp,
  method: z.enum(['OUTCOME_WEIGHTED', 'LEGACY_FALLBACK']), selectedRuleKey: ruleKey, baselineRuleKey: ruleKey,
  choices: z.array(choice).min(1).max(5),
}).strict().refine(value => {
  if (!validEvaluation(value) || !unique(value.choices.map(item => item.ruleKey))
    || value.choices.filter(item => item.purpose === 'VALIDATED').length > 3
    || value.choices.filter(item => item.purpose === 'EXPLORATION').length > 2
    || ![value.selectedRuleKey, value.baselineRuleKey].every(key => value.choices.some(item => item.ruleKey === key))) return false;
  return value.choices.every(item => {
    if (!bornBeforeEvaluation(item.ruleKey, value.evaluatedAt)) return false;
    if (value.method === 'LEGACY_FALLBACK') return item.weight === 2 && item.reason === 'FALLBACK' && item.stats === undefined;
    if (item.purpose === 'VALIDATED') return item.weight === 2 && item.reason === 'FIXED_VALIDATED' && item.stats === undefined;
    return item.stats !== undefined && reason.safeParse(item.reason).success
      && validWeight({ reason: item.reason as z.infer<typeof reason>, weight: item.weight, stats: item.stats });
  });
});

/** Optional legacy absence is handled by the caller; present evidence must be valid. */
export function validPaperAutonomyAllocation(allocation: unknown, selectedRule: PaperAdaptiveRule,
  decisionAt: string, purpose: 'VALIDATED' | 'EXPLORATION'): allocation is PaperAutonomyAllocation {
  const parsed = paperAutonomyAllocationSchema.safeParse(allocation);
  if (!parsed.success || !timestamp.safeParse(decisionAt).success) return false;
  const value = parsed.data, selected = value.choices.find(item => item.ruleKey === value.selectedRuleKey);
  return value.selectedRuleKey === paperAutonomyRuleKey(selectedRule) && selected?.purpose === purpose
    && Date.parse(value.evaluatedAt) <= Date.parse(decisionAt)
    && toKstDateKey(value.evaluatedAt) === toKstDateKey(decisionAt);
}
