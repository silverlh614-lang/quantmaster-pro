// @responsibility regimeBridge R6 recovery decay overlay.
import type { RegimeLevel } from '../../src/types/core.js';
import type { MacroState } from '../persistence/macroStateRepo.js';
import {
  saveRegimeTransitionState,
  type RegimeTransitionState,
  type R6TriggerBreakdown,
} from '../persistence/regimeTransitionStateRepo.js';
import * as base from './regimeBridge.base.js';
import type { RegimeDiagnostics } from './regimeBridge.base.js';

export * from './regimeBridge.base.js';

function finiteNumber(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isFinite(value) ? value : undefined;
}

function resolveRecoveryBiasScore(macroState: MacroState | null): number {
  if (!macroState) return -100;
  const record = macroState as unknown as Record<string, unknown>;
  for (const key of ['biasScore', 'directionBiasScore', 'preMarketBiasScore', 'marketBiasScore', 'globalBiasScore', 'riskBiasScore', 'bias']) {
    const value = record[key];
    if (typeof value === 'number' && Number.isFinite(value)) return Math.max(-100, Math.min(100, value));
  }
  const kospiDay = finiteNumber(macroState.kospiDayReturn) ?? 0;
  const kospi20d = finiteNumber(macroState.kospi20dReturn) ?? 0;
  const spx20d = finiteNumber(macroState.spx20dReturn) ?? 0;
  const foreign5d = finiteNumber(macroState.foreignNetBuy5d) ?? 0;
  const vkospiDay = finiteNumber(macroState.vkospiDayChange) ?? 0;
  const usdKrwDay = finiteNumber(macroState.usdKrwDayChange) ?? 0;
  const dxy5d = finiteNumber(macroState.dxy5dChange) ?? 0;
  const vix = finiteNumber(macroState.vix) ?? 20;
  const derived = kospiDay * 12 + kospi20d * 2 + spx20d * 2 + Math.max(-10, Math.min(10, foreign5d / 2500)) - vkospiDay * 1.2 - usdKrwDay * 6 - dxy5d * 2 - Math.max(0, vix - 20) * 1.5;
  return Math.round(Math.max(-100, Math.min(100, derived)) * 10) / 10;
}

function resolveR6RecoveryDecayFloor(state: RegimeTransitionState, macroState: MacroState | null, now: Date): number {
  const breakdown: R6TriggerBreakdown | undefined = state.r6TriggerBreakdown;
  const latchKnown = state.r6ShockLatch || !!state.r6ShockLatchDetail || !!state.latchExpiresAt;
  if (!latchKnown || !breakdown) return 0;
  const mhs = macroState?.mhs ?? 0;
  const biasScore = resolveRecoveryBiasScore(macroState);
  const recoveredFresh = breakdown.triggerFreshness === 'FRESH' && breakdown.activeR6Triggers.length === 0 && mhs >= 65 && biasScore >= 0;
  if (!recoveredFresh) return 0;
  const expiresAt = state.latchExpiresAt ? Date.parse(state.latchExpiresAt) : NaN;
  if (Number.isFinite(expiresAt) && expiresAt <= now.getTime()) return 100;
  const usOvernightBoost = (finiteNumber(macroState?.spxDayReturn) ?? 0) > 1.5 ? 10 : 0;
  const releaseAt = state.latchReleaseEligibleAt ? Date.parse(state.latchReleaseEligibleAt) : NaN;
  if (Number.isFinite(releaseAt) && releaseAt <= now.getTime()) return usOvernightBoost > 0 ? 70 : 60;
  const baseFloor = mhs >= 70 && biasScore >= 40 ? 40 : 30;
  return Math.min(100, baseFloor + usOvernightBoost);
}

function applyR6RecoveryDecayBoost(state: RegimeTransitionState, macroState: MacroState | null, now: Date): RegimeTransitionState {
  const floor = resolveR6RecoveryDecayFloor(state, macroState, now);
  if (floor <= 0) return state;
  const current = state.latchDecayPercent ?? state.r6ShockLatchDetail?.decayLevel ?? 0;
  const nextDecay = Math.min(100, Math.max(current, floor));
  if (nextDecay === current) return state;
  return {
    ...state,
    latchDecayPercent: nextDecay,
    r6ShockLatchDetail: state.r6ShockLatchDetail
      ? { ...state.r6ShockLatchDetail, decayLevel: nextDecay }
      : state.r6ShockLatchDetail,
  };
}

function persistBoostedDiagnostics(macroState: MacroState | null, now: Date = new Date()): RegimeDiagnostics {
  const diagnostics = base.getRegimeDiagnostics(macroState, now);
  const transitionState = applyR6RecoveryDecayBoost(diagnostics.transitionState, macroState, now);
  if (transitionState !== diagnostics.transitionState) saveRegimeTransitionState(transitionState);
  return {
    ...diagnostics,
    effectiveRegime: transitionState.effectiveRegime,
    r6RecoveryStatus: transitionState.r6RecoveryStatus,
    cooldownUntil: transitionState.cooldownUntil,
    transitionReason: transitionState.transitionReason,
    recoveryEvidence: transitionState.r6RecoveryEvidence,
    transitionState,
    r6TriggerBreakdown: transitionState.r6TriggerBreakdown,
    activeR6Triggers: transitionState.r6TriggerBreakdown.activeR6Triggers,
    previousR6Triggers: transitionState.previousR6Triggers,
    r6ShockLatch: transitionState.r6ShockLatch,
    recoveryBlockedReason: transitionState.recoveryBlockedReason,
  };
}

export function evaluateR6RecoveryTransition(
  previousState: RegimeTransitionState,
  macroState: MacroState | null,
  rawRegime: RegimeLevel,
  now: Date = new Date(),
  triggerBreakdown?: R6TriggerBreakdown,
): RegimeTransitionState {
  const state = base.evaluateR6RecoveryTransition(previousState, macroState, rawRegime, now, triggerBreakdown);
  return applyR6RecoveryDecayBoost(state, macroState, now);
}

export function getRegimeDiagnostics(macroState: MacroState | null, now: Date = new Date()): RegimeDiagnostics {
  return persistBoostedDiagnostics(macroState, now);
}

export function getLiveRegime(macroState: MacroState | null): RegimeLevel {
  return getRegimeDiagnostics(macroState).effectiveRegime;
}

export async function checkAndNotifyRegimeChange(macroState: MacroState | null): Promise<void> {
  await base.checkAndNotifyRegimeChange(macroState);
  persistBoostedDiagnostics(macroState);
}
