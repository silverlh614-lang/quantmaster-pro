// @responsibility Evaluate prospective exit profiles against equal observed trade paths.
import type { PaperObservation, PaperSnapshot } from '../../../src/types/paperExperiment.js';
import { paperIndicatorFormulaOperands } from '../../../src/types/paperIndicatorFormula.js';
import type { PaperStrategyTrade } from '../../../src/types/paperStrategy.js';
import type { PaperFeatureKey } from '../../../src/types/paperObservationFeatures.js';
import type { PaperAdaptiveExitOutcome, PaperAdaptiveExitPolicy, PaperAdaptiveExitReason, PaperAdaptiveExitResearch,
  PaperExitLearningCandidate, PaperExitLearningState, PaperExitLearningStats, PaperExitProfile, PaperExitProfileId } from '../../../src/types/paperAdaptiveExit.js';
import { isKrxTradingDay, previousKrxTradingDay, toKstDateKey } from '../../calendar/krxTradingCalendar.js';
import { addBusinessDaysFromKstDate } from '../krxHolidays.js';
import { adaptiveFeatureValue, adaptiveRuleMatches } from './paperAdaptiveSelection.js';
import { calculatePaperReturn } from './paperAccounting.js';
import { paperEvidenceDigest, scheduledPaperClose } from './paperStrategyEvidence.js';
import { isPaperTradeQuoteAllowed } from './paperTradeMeasurements.js';

export const PAPER_EXIT_PROFILES: readonly Readonly<PaperExitProfile>[] = Object.freeze([
  Object.freeze({ id: 'RESPONSIVE' as const, stopLossPct: 3, trailingArmPct: 2, trailingDrawdownPct: 1, signalFailureCount: 2, signalFailureMinutes: 10 }),
  Object.freeze({ id: 'BALANCED' as const, stopLossPct: 5, trailingArmPct: 3, trailingDrawdownPct: 1.5, signalFailureCount: 3, signalFailureMinutes: 20 }),
  Object.freeze({ id: 'PATIENT' as const, stopLossPct: 7, trailingArmPct: 4, trailingDrawdownPct: 2.5, signalFailureCount: 4, signalFailureMinutes: 30 }),
]);
export const PAPER_EXIT_LEARNING_RULES = Object.freeze({ minimumSamples: 10, minimumDates: 3,
  advantageMarginPct: 0.1, trainingFraction: 0.7, windowEntryDates: 60 });
const MINUTE = 60_000;
const financial = new Set<PaperFeatureKey>(['revenueGrowth', 'operatingMargin', 'netMargin', 'roe', 'debtRatio',
  'currentRatio', 'operatingCashFlowSign', 'equityRatio']);
type ResearchTrade = PaperStrategyTrade & { exitPolicy?: PaperAdaptiveExitPolicy; exitResearch?: PaperAdaptiveExitResearch };

export function initializePaperExitResearch(trade: PaperStrategyTrade): PaperAdaptiveExitResearch {
  const watchUntilDate = addBusinessDaysFromKstDate(trade.tradingDate, 5);
  return { version: 'observed-exit-research-v1', startedAt: trade.entryAt, watchUntilDate,
    watchUntilAt: scheduledPaperClose(watchUntilDate), lastObservedAt: null, lastRecordedAt: null, quoteCount: 0,
    peakNetReturnPct: calculatePaperReturn(trade.entryPrice, trade.entryPrice, trade.costModel).netReturnPct,
    lastFeatureKey: null, lastFeatureAsOf: null, signalFailureCount: 0, signalFailureStartedAt: null,
    outcomes: {}, baseline: null, completedAt: null };
}

function featureIdentity(observation: PaperObservation, key: PaperFeatureKey): string | null {
  const features = observation.features!;
  if (key === 'per' || key === 'pbr') return `quote:${features.asOf}`;
  if (!financial.has(key)) return features.technicalDate === previousKrxTradingDay(new Date(features.asOf))
    ? `technical:${features.technicalDate}` : null;
  const facts = features.financials;
  const period = key === 'operatingCashFlowSign' || key === 'equityRatio' ? facts?.dart?.period
    : key === 'revenueGrowth' || key === 'operatingMargin' || key === 'netMargin' ? facts?.kis?.incomePeriod
      : key === 'debtRatio' || key === 'currentRatio' ? facts?.kis?.stabilityPeriod : facts?.kis?.period;
  return period ? `financial:${period}` : null;
}

function observeSignal(trade: PaperStrategyTrade, observation: PaperObservation, snapshot: PaperSnapshot, state: PaperAdaptiveExitResearch): void {
  const rule = (trade.entryDecision.adaptiveEvidence ?? trade.entryDecision.explorationEvidence)?.candidate.rule;
  const features = observation.features, featureAt = Date.parse(features?.asOf ?? '');
  const value = rule && features && featureAt >= Date.parse(trade.entryAt)
    && featureAt <= Date.parse(snapshot.asOf) && Date.parse(snapshot.asOf) - featureAt <= 5 * MINUTE
    ? adaptiveFeatureValue(observation, rule.feature, snapshot.asOf, rule.invention) : null;
  if (!rule || value === null) {
    state.signalFailureCount = 0; state.signalFailureStartedAt = null;
    return;
  }
  const dependencies = rule.invention ? paperIndicatorFormulaOperands(rule.invention.formula).map(operand => operand.feature) : [rule.feature as PaperFeatureKey];
  const identities = dependencies.map(key => featureIdentity(observation, key));
  if (identities.some(identity => identity === null)) {
    state.signalFailureCount = 0; state.signalFailureStartedAt = null;
    return;
  }
  if (adaptiveRuleMatches(observation, rule, snapshot.asOf)) {
    state.signalFailureCount = 0; state.signalFailureStartedAt = null;
  }
  const identity = identities.join('|');
  if (identity === state.lastFeatureKey || (state.lastFeatureAsOf && featureAt <= Date.parse(state.lastFeatureAsOf))) return;
  state.lastFeatureKey = identity; state.lastFeatureAsOf = features!.asOf;
  if (!adaptiveRuleMatches(observation, rule, snapshot.asOf)) {
    state.signalFailureCount += 1;
    state.signalFailureStartedAt ??= snapshot.asOf;
  }
}

function triggerReason(profile: PaperExitProfile, state: PaperAdaptiveExitResearch, netReturnPct: number, at: string, allowSignal = true): PaperAdaptiveExitReason | null {
  if (netReturnPct <= -profile.stopLossPct) return 'ADAPTIVE_STOP_LOSS';
  if (state.peakNetReturnPct >= profile.trailingArmPct
    && state.peakNetReturnPct - netReturnPct >= profile.trailingDrawdownPct) return 'ADAPTIVE_TRAILING_STOP';
  if (allowSignal && state.signalFailureCount >= profile.signalFailureCount && state.signalFailureStartedAt
    && Date.parse(at) - Date.parse(state.signalFailureStartedAt) >= profile.signalFailureMinutes * MINUTE) return 'ADAPTIVE_SIGNAL_LOST';
  return null;
}

function outcome(trade: PaperStrategyTrade, state: PaperAdaptiveExitResearch, snapshot: PaperSnapshot,
  reason: PaperAdaptiveExitOutcome['reason'], price: number, observedAt: string, effectiveAt = observedAt): PaperAdaptiveExitOutcome {
  const benchmark = reason === 'D5_BENCHMARK';
  return { reason, snapshotId: snapshot.id, effectiveAt, observedAt, recordedAt: snapshot.asOf, price,
    ...calculatePaperReturn(trade.entryPrice, price, trade.costModel),
    // Benchmark trigger fields are neutral; later observations cannot describe the earlier close.
    peakNetReturnPct: benchmark ? calculatePaperReturn(trade.entryPrice, trade.entryPrice, trade.costModel).netReturnPct : state.peakNetReturnPct,
    signalFailureCount: benchmark ? 0 : state.signalFailureCount,
    signalFailureStartedAt: benchmark ? null : state.signalFailureStartedAt };
}

/** The D5 close completes comparisons; it never requests a real trade exit. */
export function advancePaperExitResearch(trade: ResearchTrade, snapshot: PaperSnapshot, observation?: PaperObservation): {
  research: PaperAdaptiveExitResearch; trigger: PaperAdaptiveExitOutcome | null; quoteAccepted: boolean;
} {
  if (!trade.exitPolicy || !trade.exitResearch) throw new Error('Observed exits require entry-frozen policy and research state');
  const state = structuredClone(trade.exitResearch);
  const result = { research: state, trigger: null as PaperAdaptiveExitOutcome | null, quoteAccepted: false };
  const now = Date.parse(snapshot.asOf);
  if (!Number.isFinite(now) || toKstDateKey(snapshot.asOf) !== snapshot.tradingDate || now < Date.parse(trade.entryAt)
    || (state.lastRecordedAt && now <= Date.parse(state.lastRecordedAt)) || !observation || observation.symbol !== trade.symbol) return result;
  const beforeBenchmark = Date.parse(observation.observedAt) <= Date.parse(state.watchUntilAt);
  if ((trade.status === 'OPEN' || (!state.completedAt && beforeBenchmark))
    && isPaperTradeQuoteAllowed(trade, observation, snapshot)
    && (!state.lastObservedAt || Date.parse(observation.observedAt) > Date.parse(state.lastObservedAt))) {
    result.quoteAccepted = true;
    state.lastObservedAt = observation.observedAt; state.lastRecordedAt = snapshot.asOf; state.quoteCount += 1;
    const net = calculatePaperReturn(trade.entryPrice, observation.price!, trade.costModel).netReturnPct;
    state.peakNetReturnPct = Math.max(state.peakNetReturnPct, net);
    if (!snapshot.quoteOnly) observeSignal(trade, observation, snapshot, state);
    if (beforeBenchmark && !state.completedAt) for (const profile of PAPER_EXIT_PROFILES) {
      const reason = triggerReason(profile, state, net, snapshot.asOf, !snapshot.quoteOnly);
      if (!state.outcomes[profile.id] && reason) state.outcomes[profile.id] = outcome(trade, state, snapshot, reason, observation.price!, observation.observedAt);
    }
    const reason = trade.status === 'OPEN' ? triggerReason(trade.exitPolicy.profile, state, net, snapshot.asOf, !snapshot.quoteOnly) : null;
    if (reason) result.trigger = outcome(trade, state, snapshot, reason, observation.price!, observation.observedAt);
  }
  if (!state.baseline && now >= Date.parse(state.watchUntilAt)) {
    const close = observation.dailyCloses.filter(item => item.tradingDate === state.watchUntilDate
      && Number.isFinite(item.close) && item.close > 0 && Date.parse(item.availableAt) >= Date.parse(state.watchUntilAt)
      && Date.parse(item.availableAt) <= now).sort((a, b) => a.availableAt.localeCompare(b.availableAt))[0];
    if (close) {
      state.baseline = outcome(trade, state, snapshot, 'D5_BENCHMARK', close.close, close.availableAt, state.watchUntilAt);
      for (const profile of PAPER_EXIT_PROFILES) state.outcomes[profile.id] ??= structuredClone(state.baseline);
      state.completedAt = snapshot.asOf; state.lastRecordedAt = snapshot.asOf;
    }
  }
  return result;
}

interface CompleteTrade { trade: ResearchTrade; state: PaperAdaptiveExitResearch; knownAt: number }
function completeTrades(trades: readonly ResearchTrade[], cutoff: number): CompleteTrade[] {
  const seen = new Set<string>();
  return [...trades].sort((a, b) => a.entryAt.localeCompare(b.entryAt) || a.id.localeCompare(b.id)).flatMap(trade => {
    const state = trade.exitResearch, identity = `${trade.tradingDate}:${trade.symbol}`;
    if (!trade.exitPolicy || trade.exitPolicy.version !== 'observed-exit-v1' || !state || state.version !== 'observed-exit-research-v1'
      || state.startedAt !== trade.entryAt || !state.baseline || !state.completedAt || !(Date.parse(state.completedAt) < cutoff)
      || !(Date.parse(trade.entryAt) < cutoff) || !isKrxTradingDay(trade.tradingDate) || seen.has(identity)) return [];
    const values = [state.baseline, ...PAPER_EXIT_PROFILES.map(profile => state.outcomes[profile.id])];
    if (values.some(value => !value || !Number.isFinite(value.netReturnPct) || !(value.price > 0) || !Number.isFinite(value.price)
      || Math.abs(value.netReturnPct - calculatePaperReturn(trade.entryPrice, value.price, trade.costModel).netReturnPct) > 1e-8
      || !(Date.parse(value.recordedAt) < cutoff)
      || !(Date.parse(value.observedAt) <= Date.parse(value.recordedAt)) || !(Date.parse(value.effectiveAt) > Date.parse(trade.entryAt))
      || !(Date.parse(value.effectiveAt) <= Date.parse(state.watchUntilAt)))) return [];
    seen.add(identity);
    return [{ trade, state, knownAt: Math.max(Date.parse(state.completedAt), ...values.map(value => Date.parse(value!.recordedAt))) }];
  });
}

function stats(rows: CompleteTrade[], id: PaperExitProfileId): PaperExitLearningStats {
  const count = rows.length;
  const candidate = count ? rows.reduce((sum, row) => sum + row.state.outcomes[id]!.netReturnPct, 0) / count : null;
  const baseline = count ? rows.reduce((sum, row) => sum + row.state.baseline!.netReturnPct, 0) / count : null;
  return { sampleCount: count, dateCount: new Set(rows.map(row => row.trade.tradingDate)).size,
    tradeIdsDigest: paperEvidenceDigest(rows.map(row => row.trade.id)), meanNetReturnPct: candidate,
    meanBaselineNetReturnPct: baseline, meanAdvantagePct: candidate === null || baseline === null ? null : candidate - baseline };
}
function enough(value: PaperExitLearningStats): boolean {
  return value.sampleCount >= PAPER_EXIT_LEARNING_RULES.minimumSamples && value.dateCount >= PAPER_EXIT_LEARNING_RULES.minimumDates;
}
function edge(value: PaperExitLearningStats): boolean {
  return value.meanNetReturnPct !== null && value.meanNetReturnPct > 0
    && value.meanAdvantagePct !== null && value.meanAdvantagePct >= PAPER_EXIT_LEARNING_RULES.advantageMarginPct;
}

export function selectPaperExitLearning(trades: readonly ResearchTrade[], asOf: string): PaperExitLearningState {
  if (!Number.isFinite(Date.parse(asOf))) throw new Error('Exit research needs a valid evaluation time');
  const cutoffAt = new Date(`${toKstDateKey(asOf)}T00:00:00+09:00`).toISOString();
  let rows = completeTrades(trades, Date.parse(cutoffAt));
  const dates = [...new Set(rows.map(row => row.trade.tradingDate))].sort().slice(-PAPER_EXIT_LEARNING_RULES.windowEntryDates);
  const window = new Set(dates); rows = rows.filter(row => window.has(row.trade.tradingDate));
  const split = Math.floor(dates.length * PAPER_EXIT_LEARNING_RULES.trainingFraction);
  const validationStartDate = dates[split] ?? null;
  const validationAt = validationStartDate ? Date.parse(`${validationStartDate}T00:00:00+09:00`) : Infinity;
  const training = rows.filter(row => validationStartDate && row.trade.tradingDate < validationStartDate
    && row.knownAt < validationAt);
  const validation = rows.filter(row => validationStartDate && row.trade.tradingDate >= validationStartDate);
  const candidates: PaperExitLearningCandidate[] = PAPER_EXIT_PROFILES.map(profile => ({ profile: { ...profile },
    training: stats(training, profile.id), validation: stats(validation, profile.id) }));
  const selected = [...candidates].filter(item => enough(item.training) && edge(item.training))
    .sort((a, b) => b.training.meanAdvantagePct! - a.training.meanAdvantagePct! || a.profile.id.localeCompare(b.profile.id))[0];
  const reason: PaperExitLearningState['reason'] = !enough(candidates[0].training) ? 'INSUFFICIENT_TRAINING'
    : !selected ? 'NO_TRAINING_EDGE' : !enough(selected.validation) ? 'INSUFFICIENT_VALIDATION'
      : !edge(selected.validation) ? 'NO_VALIDATION_EDGE' : 'FORWARD_VALIDATED';
  return { version: 'observed-exit-learning-v1', evaluatedAt: asOf, cutoffAt, validationStartDate,
    completedTradeCount: rows.length, completedDateCount: dates.length, candidates,
    selectedProfileId: reason === 'FORWARD_VALIDATED' ? selected!.profile.id : null, reason };
}

export function freezePaperExitPolicy(learning: PaperExitLearningState, selectedAt: string): PaperAdaptiveExitPolicy {
  if (!(Date.parse(learning.evaluatedAt) <= Date.parse(selectedAt)) || !(Date.parse(learning.cutoffAt) <= Date.parse(selectedAt))) {
    throw new Error('An exit policy cannot use future learning evidence');
  }
  const selected = learning.reason === 'FORWARD_VALIDATED' && learning.validationStartDate
    ? learning.candidates.find(item => item.profile.id === learning.selectedProfileId
      && enough(item.training) && enough(item.validation) && edge(item.training) && edge(item.validation)) : undefined;
  return { version: 'observed-exit-v1', selectedAt, origin: selected ? 'FORWARD_LEARNED' : 'EXPLORATION_DEFAULT',
    profile: { ...(selected?.profile ?? PAPER_EXIT_PROFILES[1]) }, evidence: selected ? {
      cutoffAt: learning.cutoffAt, validationStartDate: learning.validationStartDate!,
      training: structuredClone(selected.training), validation: structuredClone(selected.validation),
    } : null };
}
