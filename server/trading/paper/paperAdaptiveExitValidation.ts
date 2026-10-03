// @responsibility Validate frozen observed exits with prospective research chronology.
import { z } from 'zod';
import type { PaperAdaptiveExitOutcome, PaperExitLearningState, PaperExitLearningStats, PaperExitProfile } from '../../../src/types/paperAdaptiveExit.js';
import type { PaperStrategyTrade } from '../../../src/types/paperStrategy.js';
import { PAPER_FEATURES, type PaperFeatureKey } from '../../../src/types/paperObservationFeatures.js';
import { PAPER_INVENTED_FEATURE_CUTS } from '../../../src/types/paperIndicatorFormula.js';
import { toKstDateKey } from '../../calendar/krxTradingCalendar.js';
import { calculatePaperReturn } from './paperAccounting.js';
import { EMPTY_EVIDENCE_DIGEST } from './paperStrategyEvidence.js';
import { PAPER_EXIT_LEARNING_RULES, PAPER_EXIT_PROFILES } from './paperAdaptiveExit.js';

const finite = z.number().finite(), count = finite.int().nonnegative();
const timestamp = z.string().datetime({ offset: true });
const date = z.string().regex(/^\d{4}-\d{2}-\d{2}$/).refine(value => Number.isFinite(Date.parse(`${value}T00:00:00Z`))
  && new Date(`${value}T00:00:00Z`).toISOString().slice(0, 10) === value);
const profileId = z.enum(['RESPONSIVE', 'BALANCED', 'PATIENT']);
const profile = z.object({ id: profileId, stopLossPct: finite.positive(), trailingArmPct: finite.positive(),
  trailingDrawdownPct: finite.positive(), signalFailureCount: count.positive(), signalFailureMinutes: finite.positive() });
const stats = z.object({ sampleCount: count, dateCount: count, tradeIdsDigest: z.string().regex(/^[0-9a-f]{64}$/),
  meanNetReturnPct: finite.nullable(), meanBaselineNetReturnPct: finite.nullable(), meanAdvantagePct: finite.nullable() });
export const paperAdaptiveExitPolicySchema = z.object({ version: z.literal('observed-exit-v1'),
  origin: z.enum(['EXPLORATION_DEFAULT', 'FORWARD_LEARNED']), selectedAt: timestamp, profile,
  evidence: z.object({ cutoffAt: timestamp, validationStartDate: date, training: stats, validation: stats }).nullable() });
export const paperAdaptiveExitOutcomeSchema = z.object({
  reason: z.enum(['ADAPTIVE_STOP_LOSS', 'ADAPTIVE_TRAILING_STOP', 'ADAPTIVE_SIGNAL_LOST', 'D5_BENCHMARK']),
  snapshotId: z.string().min(1), effectiveAt: timestamp, observedAt: timestamp, recordedAt: timestamp,
  price: finite.positive(), grossReturnPct: finite, netReturnPct: finite, netPnl: finite, peakNetReturnPct: finite,
  signalFailureCount: count, signalFailureStartedAt: timestamp.nullable() });
export const paperAdaptiveExitResearchSchema = z.object({ version: z.literal('observed-exit-research-v1'),
  startedAt: timestamp, watchUntilDate: date, watchUntilAt: timestamp, lastObservedAt: timestamp.nullable(),
  lastRecordedAt: timestamp.nullable(), quoteCount: count, peakNetReturnPct: finite,
  lastFeatureKey: z.string().min(1).nullable(), lastFeatureAsOf: timestamp.nullable(),
  signalFailureCount: count, signalFailureStartedAt: timestamp.nullable(),
  outcomes: z.object({ RESPONSIVE: paperAdaptiveExitOutcomeSchema.optional(), BALANCED: paperAdaptiveExitOutcomeSchema.optional(),
    PATIENT: paperAdaptiveExitOutcomeSchema.optional() }).strict(), baseline: paperAdaptiveExitOutcomeSchema.nullable(), completedAt: timestamp.nullable() });
export const paperExitLearningSchema = z.object({ version: z.literal('observed-exit-learning-v1'), evaluatedAt: timestamp,
  cutoffAt: timestamp, validationStartDate: date.nullable(), completedTradeCount: count, completedDateCount: count,
  candidates: z.array(z.object({ profile, training: stats, validation: stats })).length(3), selectedProfileId: profileId.nullable(),
  reason: z.enum(['INSUFFICIENT_TRAINING', 'INSUFFICIENT_VALIDATION', 'NO_TRAINING_EDGE', 'NO_VALIDATION_EDGE', 'FORWARD_VALIDATED']) });
export const paperObservedExitQuoteSchema = z.object({ source: z.string().min(1), price: finite.positive(), observedAt: timestamp,
  ruleValue: finite.nullable(), ruleMatches: z.boolean().nullable(), ruleConnected: z.boolean().nullable(), featureAsOf: timestamp.nullable() });
const ms = Date.parse;
const closeTo = (a: number, b: number) => Math.abs(a - b) <= 1e-8;
const sameTime = (a: string, b: string) => ms(a) === ms(b);
function fail(): never { throw new Error('PAPER_STRATEGY_INVALID: inconsistent observed exit research'); }
const validProfile = (value: PaperExitProfile) => PAPER_EXIT_PROFILES.some(item => item.id === value.id
  && item.stopLossPct === value.stopLossPct && item.trailingArmPct === value.trailingArmPct
  && item.trailingDrawdownPct === value.trailingDrawdownPct && item.signalFailureCount === value.signalFailureCount
  && item.signalFailureMinutes === value.signalFailureMinutes);
function validStats(value: PaperExitLearningStats): boolean {
  if (value.dateCount > value.sampleCount || (value.sampleCount === 0) !== (value.dateCount === 0)
    || (value.sampleCount === 0) !== (value.tradeIdsDigest === EMPTY_EVIDENCE_DIGEST)) return false;
  return value.sampleCount === 0 ? value.meanNetReturnPct === null && value.meanBaselineNetReturnPct === null && value.meanAdvantagePct === null
    : value.meanNetReturnPct !== null && value.meanBaselineNetReturnPct !== null && value.meanAdvantagePct !== null
      && closeTo(value.meanAdvantagePct, value.meanNetReturnPct - value.meanBaselineNetReturnPct);
}
const enough = (value: PaperExitLearningStats) => value.sampleCount >= PAPER_EXIT_LEARNING_RULES.minimumSamples
  && value.dateCount >= PAPER_EXIT_LEARNING_RULES.minimumDates;
const edge = (value: PaperExitLearningStats) => value.meanNetReturnPct !== null && value.meanNetReturnPct > 0
  && value.meanAdvantagePct !== null && value.meanAdvantagePct >= PAPER_EXIT_LEARNING_RULES.advantageMarginPct;
const midnight = (value: string) => new Date(`${toKstDateKey(value)}T00:00:00+09:00`).toISOString();
function intraday(observedAt: string, recordedAt: string): boolean {
  const day = toKstDateKey(observedAt), open = ms(`${day}T09:00:00+09:00`), close = ms(`${day}T15:30:00+09:00`);
  return toKstDateKey(recordedAt) === day && ms(observedAt) >= open && ms(observedAt) < close
    && ms(recordedAt) < close && ms(recordedAt) >= ms(observedAt) && ms(recordedAt) - ms(observedAt) <= 5 * 60_000;
}
function trigger(profile: PaperExitProfile, outcome: PaperAdaptiveExitOutcome): PaperAdaptiveExitOutcome['reason'] | null {
  if (outcome.netReturnPct <= -profile.stopLossPct) return 'ADAPTIVE_STOP_LOSS';
  if (outcome.peakNetReturnPct >= profile.trailingArmPct
    && outcome.peakNetReturnPct - outcome.netReturnPct >= profile.trailingDrawdownPct) return 'ADAPTIVE_TRAILING_STOP';
  if (outcome.signalFailureCount >= profile.signalFailureCount && outcome.signalFailureStartedAt
    && ms(outcome.recordedAt) - ms(outcome.signalFailureStartedAt) >= profile.signalFailureMinutes * 60_000) return 'ADAPTIVE_SIGNAL_LOST';
  return null;
}
function validOutcome(value: PaperAdaptiveExitOutcome, trade: PaperStrategyTrade, asOf: string, candidate?: PaperExitProfile): boolean {
  const research = trade.exitResearch!, result = calculatePaperReturn(trade.entryPrice, value.price, trade.costModel);
  if (ms(value.effectiveAt) <= ms(trade.entryAt) || ms(value.effectiveAt) > ms(value.observedAt)
    || ms(value.observedAt) > ms(value.recordedAt) || ms(value.recordedAt) > ms(asOf)
    || !closeTo(value.grossReturnPct, result.grossReturnPct) || !closeTo(value.netReturnPct, result.netReturnPct)
    || !closeTo(value.netPnl, result.netPnl) || value.peakNetReturnPct > research.peakNetReturnPct + 1e-8
    || value.signalFailureCount > research.quoteCount
    || (value.signalFailureCount === 0) !== (value.signalFailureStartedAt === null)
    || (value.signalFailureStartedAt !== null && (ms(value.signalFailureStartedAt) <= ms(trade.entryAt)
      || ms(value.signalFailureStartedAt) > ms(value.recordedAt)))) return false;
  if (value.reason === 'D5_BENCHMARK') return sameTime(value.effectiveAt, research.watchUntilAt)
    && value.signalFailureCount === 0 && value.signalFailureStartedAt === null
    && closeTo(value.peakNetReturnPct, calculatePaperReturn(trade.entryPrice, trade.entryPrice, trade.costModel).netReturnPct);
  return sameTime(value.effectiveAt, value.observedAt) && intraday(value.observedAt, value.recordedAt)
    && value.peakNetReturnPct >= value.netReturnPct && Boolean(candidate && trigger(candidate, value) === value.reason);
}

export function assertPaperExitLearning(value: PaperExitLearningState, asOf?: string): void {
  const parsed = paperExitLearningSchema.safeParse(value);
  if (!parsed.success) fail();
  const first = value.candidates[0];
  if (!sameTime(value.cutoffAt, midnight(value.evaluatedAt)) || ms(value.cutoffAt) > ms(value.evaluatedAt)
    || (asOf !== undefined && ms(value.evaluatedAt) > ms(asOf))
    || value.completedDateCount > value.completedTradeCount
    || value.completedDateCount > PAPER_EXIT_LEARNING_RULES.windowEntryDates
    || (value.completedDateCount === 0) !== (value.validationStartDate === null)
    || (value.validationStartDate !== null && ms(`${value.validationStartDate}T00:00:00+09:00`) >= ms(value.cutoffAt))
    || new Set(value.candidates.map(item => item.profile.id)).size !== 3
    || value.candidates.some(item => !validProfile(item.profile) || !validStats(item.training) || !validStats(item.validation)
      || item.training.sampleCount !== first.training.sampleCount || item.validation.sampleCount !== first.validation.sampleCount
      || item.training.dateCount !== first.training.dateCount || item.validation.dateCount !== first.validation.dateCount
      || item.training.tradeIdsDigest !== first.training.tradeIdsDigest || item.validation.tradeIdsDigest !== first.validation.tradeIdsDigest
      || item.training.meanBaselineNetReturnPct !== first.training.meanBaselineNetReturnPct
      || item.validation.meanBaselineNetReturnPct !== first.validation.meanBaselineNetReturnPct)
    || first.training.sampleCount + first.validation.sampleCount > value.completedTradeCount
    || first.training.dateCount + first.validation.dateCount > value.completedDateCount) fail();
  const selected = [...value.candidates].filter(item => enough(item.training) && edge(item.training))
    .sort((a, b) => b.training.meanAdvantagePct! - a.training.meanAdvantagePct! || a.profile.id.localeCompare(b.profile.id))[0];
  const reason = !enough(first.training) ? 'INSUFFICIENT_TRAINING' : !selected ? 'NO_TRAINING_EDGE'
    : !enough(selected.validation) ? 'INSUFFICIENT_VALIDATION' : !edge(selected.validation) ? 'NO_VALIDATION_EDGE' : 'FORWARD_VALIDATED';
  if (value.reason !== reason || value.selectedProfileId !== (reason === 'FORWARD_VALIDATED' ? selected!.profile.id : null)) fail();
}

export function assertPaperAdaptiveExit(trade: PaperStrategyTrade, asOf = trade.exit?.decisionAt ?? trade.entryAt): void {
  if (trade.policy.exitModel === 'SCHEDULED_CLOSE') {
    if (trade.exitPolicy || trade.exitResearch || trade.exit?.observedQuote || trade.exit?.observedTrigger) fail();
    return;
  }
  const policy = trade.exitPolicy, research = trade.exitResearch;
  if (trade.strategyVersion !== 'adaptive-features-v1' || !policy || !research
    || !paperAdaptiveExitPolicySchema.safeParse(policy).success || !paperAdaptiveExitResearchSchema.safeParse(research).success) fail();
  if (!validProfile(policy.profile) || ms(policy.selectedAt) > ms(trade.entryAt)
    || !sameTime(research.startedAt, trade.entryAt) || research.watchUntilDate < trade.scheduledExitDate
    || (trade.horizon === 5 && research.watchUntilDate !== trade.scheduledExitDate)
    || !sameTime(research.watchUntilAt, `${research.watchUntilDate}T15:30:00+09:00`)
    || ms(research.watchUntilAt) <= ms(trade.entryAt)) fail();
  const evidence = policy.evidence;
  if (policy.origin === 'EXPLORATION_DEFAULT' ? evidence !== null || policy.profile.id !== 'BALANCED'
    : !evidence || !sameTime(evidence.cutoffAt, midnight(evidence.cutoffAt)) || ms(evidence.cutoffAt) > ms(policy.selectedAt)
      || ms(`${evidence.validationStartDate}T00:00:00+09:00`) >= ms(evidence.cutoffAt)
      || !validStats(evidence.training) || !validStats(evidence.validation) || !enough(evidence.training)
      || !enough(evidence.validation) || !edge(evidence.training) || !edge(evidence.validation)) fail();
  const entryNet = calculatePaperReturn(trade.entryPrice, trade.entryPrice, trade.costModel).netReturnPct;
  if (research.peakNetReturnPct < entryNet || (research.quoteCount === 0) !== (research.lastObservedAt === null)
    || (research.quoteCount === 0 && !closeTo(research.peakNetReturnPct, entryNet))
    || (research.lastObservedAt !== null && (!research.lastRecordedAt || ms(research.lastObservedAt) <= ms(trade.entryAt)
      || ms(research.lastObservedAt) > ms(research.lastRecordedAt)))
    || (research.lastRecordedAt !== null && (ms(research.lastRecordedAt) <= ms(trade.entryAt) || ms(research.lastRecordedAt) > ms(asOf)))
    || (research.lastFeatureKey === null) !== (research.lastFeatureAsOf === null)
    || (research.lastFeatureAsOf !== null && (!research.lastRecordedAt || ms(research.lastFeatureAsOf) < ms(trade.entryAt)
      || ms(research.lastFeatureAsOf) > ms(research.lastRecordedAt)))
    || research.signalFailureCount > research.quoteCount
    || (research.signalFailureCount === 0) !== (research.signalFailureStartedAt === null)
    || (research.signalFailureStartedAt !== null && (!research.lastRecordedAt || ms(research.signalFailureStartedAt) <= ms(trade.entryAt)
      || ms(research.signalFailureStartedAt) > ms(research.lastRecordedAt)))
    || (research.baseline === null) !== (research.completedAt === null)) fail();
  for (const candidate of PAPER_EXIT_PROFILES) {
    const outcome = research.outcomes[candidate.id];
    if (!outcome) { if (research.baseline) fail(); continue; }
    if (!validOutcome(outcome, trade, asOf, candidate) || ms(outcome.effectiveAt) > ms(research.watchUntilAt)
      || !research.lastRecordedAt || ms(outcome.recordedAt) > ms(research.lastRecordedAt)
      || (outcome.reason === 'D5_BENCHMARK' && JSON.stringify(outcome) !== JSON.stringify(research.baseline))) fail();
  }
  if (research.baseline && (research.baseline.reason !== 'D5_BENCHMARK' || !validOutcome(research.baseline, trade, asOf)
    || !sameTime(research.completedAt!, research.baseline.recordedAt))) fail();
  const exit = trade.exit;
  if (!exit) return;
  const quote = exit.observedQuote, observedTrigger = exit.observedTrigger;
  if (exit.model !== 'ADAPTIVE_OBSERVED' || !quote || !observedTrigger
    || !paperObservedExitQuoteSchema.safeParse(quote).success || !paperAdaptiveExitOutcomeSchema.safeParse(observedTrigger).success
    || observedTrigger.reason === 'D5_BENCHMARK' || !validOutcome(observedTrigger, trade, asOf, policy.profile)
    || observedTrigger.reason !== exit.decision.reasonCode || observedTrigger.snapshotId !== exit.snapshotId
    || !sameTime(observedTrigger.effectiveAt, exit.effectiveAt) || !sameTime(observedTrigger.observedAt, exit.observedAt)
    || !sameTime(observedTrigger.recordedAt, exit.decisionAt) || observedTrigger.price !== exit.price
    || !closeTo(observedTrigger.netPnl, exit.netPnl) || !closeTo(observedTrigger.netReturnPct, exit.netReturnPct)
    || !closeTo(observedTrigger.grossReturnPct, exit.grossReturnPct) || quote.price !== exit.price
    || !sameTime(quote.observedAt, exit.observedAt) || (quote.ruleValue === null) !== (quote.ruleMatches === null)
    || (quote.ruleValue !== null && quote.featureAsOf === null)
    || (quote.featureAsOf !== null && (ms(quote.featureAsOf) > ms(exit.decisionAt)
      || toKstDateKey(quote.featureAsOf) !== toKstDateKey(exit.decisionAt)))
    || (observedTrigger.reason === 'ADAPTIVE_SIGNAL_LOST' && quote.ruleMatches !== false)) fail();
  const rule = (trade.entryDecision.adaptiveEvidence ?? trade.entryDecision.explorationEvidence)?.candidate.rule;
  if (!rule) {
    if (quote.ruleValue !== null || quote.ruleMatches !== null || quote.ruleConnected !== null || quote.featureAsOf !== null) fail();
  } else if (quote.ruleValue !== null) {
    const cuts: readonly number[] = rule.invention ? PAPER_INVENTED_FEATURE_CUTS : PAPER_FEATURES[rule.feature as PaperFeatureKey].cuts;
    if (quote.ruleMatches !== (cuts.filter(cut => quote.ruleValue! >= cut).length === rule.bucket)) fail();
  }
}
