// @responsibility Regime resolved-sample transition state for diagnostic-only attribution recalculation.
import { deriveRegimePhase, type RegimePhase } from '../shadow/regimeContext.js';
import { loadCounterfactuals, type CounterfactualEntry } from './counterfactualShadow.js';
import { readJson, writeJson } from './learningStorage.js';

export const REGIME_RESOLVED_TRANSITION_STATE_FILE = 'regime_resolved_transition_state.json';

export interface RegimeResolvedTransitionState {
  lastResolvedAt?: string;
  lastResolvedCount: number;
  lastResolvedByRegime: Record<string, number>;
  attributionRecalcNeeded: boolean;
  lastAttributionRecalcAt?: string;
  lastRecalculatedRegimes?: string[];
  lastSkippedLowSampleRegimes?: string[];
  executionImpact: 'NONE';
  brokerOrdersCreated: 0;
  promotionAllowed: false;
  recommendationOnly: true;
}

export function emptyRegimeResolvedTransitionState(): RegimeResolvedTransitionState {
  return {
    lastResolvedCount: 0,
    lastResolvedByRegime: {},
    attributionRecalcNeeded: false,
    executionImpact: 'NONE',
    brokerOrdersCreated: 0,
    promotionAllowed: false,
    recommendationOnly: true,
  };
}

export function regimePhaseForCounterfactualEntry(entry: CounterfactualEntry): RegimePhase {
  const entryRegime = entry.entryRegime ?? entry.regimeAtEntry?.toString() ?? entry.regimeAtSignal?.toString();
  return entry.regimePhase ?? deriveRegimePhase({
    rawRegime: entryRegime ?? entry.rawRegime ?? entry.regime,
    effectiveRegime: entry.entryEffectiveState ?? entryRegime ?? entry.effectiveRegime ?? entry.regime,
    engineMode: entry.engineMode,
    marketSession: entry.marketSession,
    sellOnlyActive: entry.sellOnlyActive,
    hardBlockActive: entry.hardBlockActive,
    blockedReason: entry.blockedReason ?? entry.skipReason,
    sourceFreshness: entry.sourceFreshness,
    regimeConfidence: entry.regimeConfidence,
  });
}

export function loadRegimeResolvedTransitionState(): RegimeResolvedTransitionState {
  return {
    ...emptyRegimeResolvedTransitionState(),
    ...readJson<Partial<RegimeResolvedTransitionState>>(REGIME_RESOLVED_TRANSITION_STATE_FILE, {}),
  };
}

export function saveRegimeResolvedTransitionState(state: RegimeResolvedTransitionState): void {
  writeJson(REGIME_RESOLVED_TRANSITION_STATE_FILE, state);
}

export function recordRegimeResolvedTransition(
  now: Date,
  expectedResolvedCount: number,
  entries: CounterfactualEntry[] = loadCounterfactuals(),
): RegimeResolvedTransitionState {
  const resolvedAt = now.toISOString();
  const justResolved = entries.filter(
    (entry) => entry.outcomeStatus === 'LABELED' && entry.outcomeResolvedAt === resolvedAt,
  );
  const byRegime: Record<string, number> = {};
  for (const entry of justResolved) {
    const phase = regimePhaseForCounterfactualEntry(entry);
    byRegime[phase] = (byRegime[phase] ?? 0) + 1;
  }
  const resolvedCount = Object.values(byRegime).reduce((sum, count) => sum + count, 0);
  const state: RegimeResolvedTransitionState = {
    lastResolvedAt: resolvedCount > 0 ? resolvedAt : undefined,
    lastResolvedCount: resolvedCount || expectedResolvedCount,
    lastResolvedByRegime: byRegime,
    attributionRecalcNeeded: resolvedCount > 0,
    executionImpact: 'NONE',
    brokerOrdersCreated: 0,
    promotionAllowed: false,
    recommendationOnly: true,
  };
  if (resolvedCount > 0 || expectedResolvedCount > 0) saveRegimeResolvedTransitionState(state);
  return state;
}

export function markRegimeAttributionRecalcHandled(input: {
  now?: Date;
  recalculatedRegimes: string[];
  skippedLowSampleRegimes: string[];
}): RegimeResolvedTransitionState {
  const current = loadRegimeResolvedTransitionState();
  const next: RegimeResolvedTransitionState = {
    ...current,
    attributionRecalcNeeded: false,
    lastAttributionRecalcAt: (input.now ?? new Date()).toISOString(),
    lastRecalculatedRegimes: input.recalculatedRegimes,
    lastSkippedLowSampleRegimes: input.skippedLowSampleRegimes,
    executionImpact: 'NONE',
    brokerOrdersCreated: 0,
    promotionAllowed: false,
    recommendationOnly: true,
  };
  saveRegimeResolvedTransitionState(next);
  return next;
}
