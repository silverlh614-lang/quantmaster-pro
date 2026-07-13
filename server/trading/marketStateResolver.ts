// @responsibility marketStateResolver R6 recovery display overlay.
import { loadMacroState, type MacroState } from '../persistence/macroStateRepo.js';
import { getRegimeDiagnostics, type RegimeDiagnostics } from './regimeBridge.js';
import * as base from './marketStateResolver.base.js';
import type {
  MarketStateSnapshot as BaseMarketStateSnapshot,
  MarketStateNowContext as BaseMarketStateNowContext,
  MacroStateStaleness as BaseMacroStateStaleness,
  ResolveMarketStateOptions as BaseResolveMarketStateOptions,
  ShadowActivitySnapshot as BaseShadowActivitySnapshot,
} from './marketStateResolver.base.js';

export * from './marketStateResolver.base.js';

export type ShadowCandidateScanTrigger = 'SCHEDULED' | 'MANUAL' | 'R6_CONFIRMATION_WAIT' | 'BIAS_RECOVERY' | 'R6_RECOVERY_BIAS_CONFIRMATION' | 'POST_CLOSE_OBSERVE' | 'DEGRADED_OBSERVE';
type MacroRefreshResult = 'SUCCESS_UPDATED' | 'SUCCESS_NO_CHANGE' | 'FAILED' | 'SKIPPED';

interface MacroStateStaleness extends BaseMacroStateStaleness {
  refreshResult?: MacroRefreshResult;
}

export interface ShadowActivitySnapshot extends Omit<BaseShadowActivitySnapshot, 'candidateScanTrigger'> {
  candidateScanTrigger?: ShadowCandidateScanTrigger;
}

export interface MarketStateNowContext extends Omit<BaseMarketStateNowContext, 'shadowActivity'> {
  shadowActivity?: ShadowActivitySnapshot;
}

export interface MarketStateSnapshot extends Omit<BaseMarketStateSnapshot, 'macroState' | 'r6Latch'> {
  macroState: MacroStateStaleness;
  r6Latch?: NonNullable<BaseMarketStateSnapshot['r6Latch']> & {
    decayBoostEligible?: boolean;
  };
}

function readStringField(source: MacroState | null, keys: string[]): string | undefined {
  const record = source as unknown as Record<string, unknown> | null;
  if (!record) return undefined;
  for (const key of keys) {
    const value = record[key];
    if (typeof value === 'string' && value.trim()) return value;
  }
  return undefined;
}

function readBooleanField(source: MacroState | null, keys: string[]): boolean | undefined {
  const record = source as unknown as Record<string, unknown> | null;
  if (!record) return undefined;
  for (const key of keys) {
    const value = record[key];
    if (typeof value === 'boolean') return value;
  }
  return undefined;
}

function isNoRefreshError(value: string | undefined): boolean {
  return !value || value === 'N/A' || value === 'NONE';
}

function resolveMacroRefreshResult(macro: MacroState | null): MacroRefreshResult {
  const explicit = readStringField(macro, ['refreshResult', 'macroRefreshResult']);
  if (explicit === 'SUCCESS_UPDATED' || explicit === 'SUCCESS_NO_CHANGE' || explicit === 'FAILED' || explicit === 'SKIPPED') return explicit;
  const lastRefreshError = readStringField(macro, ['lastRefreshError', 'macroLastRefreshError', 'refreshError']);
  const refreshBlockedReason = readStringField(macro, ['refreshBlockedReason', 'macroRefreshBlockedReason']);
  const updatedAtChanged = readBooleanField(macro, ['updatedAtChanged', 'macroUpdatedAtChanged']);
  const writeSucceeded = readBooleanField(macro, ['writeSucceeded', 'macroWriteSucceeded']);
  const lastRefreshAttemptAt = readStringField(macro, ['lastRefreshAttemptAt', 'macroLastRefreshAttemptAt']);
  const lastRefreshSuccessAt = readStringField(macro, ['lastRefreshSuccessAt', 'macroLastRefreshSuccessAt']);
  if (!isNoRefreshError(lastRefreshError)) return 'FAILED';
  if (refreshBlockedReason && refreshBlockedReason !== 'NONE') return 'SKIPPED';
  if (updatedAtChanged === false && writeSucceeded !== false && (lastRefreshAttemptAt || lastRefreshSuccessAt)) return 'SUCCESS_NO_CHANGE';
  if (updatedAtChanged === true || lastRefreshSuccessAt) return 'SUCCESS_UPDATED';
  return 'SKIPPED';
}

function resolveR6LatchDecayBoostEligible(
  diagnostics: RegimeDiagnostics,
  macroState: MacroStateStaleness,
  mhs: number,
  biasScore: number,
): boolean {
  return macroState.freshness === 'FRESH' && diagnostics.activeR6Triggers.length === 0 && mhs >= 65 && biasScore >= 0;
}

function resolveR6LatchDecayBlockedReason(
  diagnostics: RegimeDiagnostics,
  macroState: MacroStateStaleness,
  now: Date,
  recovery: { mhs: number; biasScore: number },
): string | undefined {
  const transition = diagnostics.transitionState;
  const decay = transition.latchDecayPercent ?? transition.r6ShockLatchDetail?.decayLevel ?? 0;
  if (!transition.r6ShockLatch) return undefined;
  if (macroState.freshness === 'POST_CLOSE_VALID' || macroState.freshness === 'EOD_SNAPSHOT_VALID') return 'WAITING_NEXT_TRADING_DAY_CONFIRMATION';
  if (macroState.freshness === 'HARD_STALE' || macroState.freshness === 'MISSING') return 'MACRO_STATE_STALE';
  if (diagnostics.activeR6Triggers.includes('KOSPI_INTRADAY_LOW_SHOCK')) return 'ADDITIONAL_LOW_RETEST';
  if (diagnostics.activeR6Triggers.length > 0) return 'ACTIVE_R6_TRIGGER_PRESENT';
  if (recovery.mhs < 65) return 'MHS_NOT_RECOVERED';
  if (recovery.biasScore < 0) return 'BIAS_NOT_RECOVERED';
  const releaseAt = transition.latchReleaseEligibleAt ? Date.parse(transition.latchReleaseEligibleAt) : NaN;
  if (Number.isFinite(releaseAt) && releaseAt > now.getTime()) return 'WAITING_FOR_RELEASE_ELIGIBLE_AT';
  if (diagnostics.recoveryBlockedReason === 'WAITING_NEXT_TRADING_DAY_CONFIRMATION') return 'WAITING_NEXT_TRADING_DAY_CONFIRMATION';
  if (diagnostics.recoveryBlockedReason === 'WAITING_FOR_CLOSE_OR_NEXT_TRADING_DAY_CONFIRMATION') return 'WAITING_FOR_CLOSE_CONFIRMATION';
  if (diagnostics.recoveryBlockedReason === 'R6_COOLDOWN_ACTIVE' || diagnostics.r6RecoveryStatus === 'COOLDOWN') return 'R6_COOLDOWN_ACTIVE';
  if (decay < 60) return diagnostics.recoveryBlockedReason ?? 'WAITING_FOR_CLOSE_CONFIRMATION';
  return undefined;
}

function enrichSnapshot(snapshot: BaseMarketStateSnapshot, macro: MacroState | null, diagnostics: RegimeDiagnostics, now: Date): MarketStateSnapshot {
  const enriched = snapshot as MarketStateSnapshot;
  enriched.macroState = {
    ...snapshot.macroState,
    refreshResult: resolveMacroRefreshResult(macro),
  };
  if (enriched.r6Latch) {
    const decayBoostEligible = resolveR6LatchDecayBoostEligible(diagnostics, enriched.macroState, enriched.mhs, enriched.biasScore);
    enriched.r6Latch = {
      ...enriched.r6Latch,
      decayBoostEligible,
      decayBlockedReason: resolveR6LatchDecayBlockedReason(diagnostics, enriched.macroState, now, {
        mhs: enriched.mhs,
        biasScore: enriched.biasScore,
      }),
    };
  }
  return enriched;
}

export function resolveMarketState(now: Date = new Date(), options: BaseResolveMarketStateOptions = {}): MarketStateSnapshot {
  const macro = options.macroState !== undefined ? options.macroState : loadMacroState();
  const diagnostics = options.diagnostics ?? getRegimeDiagnostics(macro, now);
  const snapshot = base.resolveMarketState(now, { macroState: macro, diagnostics });
  return enrichSnapshot(snapshot, macro, diagnostics, now);
}

function insertAfter(lines: string[], predicate: (line: string) => boolean, newLine: string): void {
  if (lines.includes(newLine)) return;
  const index = lines.findIndex(predicate);
  if (index >= 0) lines.splice(index + 1, 0, newLine);
}

export function formatMarketStateNow(snapshot: MarketStateSnapshot, context: MarketStateNowContext = {}): string {
  const text = base.formatMarketStateNow(snapshot as BaseMarketStateSnapshot, context as BaseMarketStateNowContext);
  const lines = text.split('\n');
  const decayIndex = lines.findIndex((line) => line.startsWith('decay: '));
  if (decayIndex >= 0 && snapshot.r6Latch?.decayBoostEligible && !lines.includes('decayBoostEligible: true')) {
    lines.splice(decayIndex + 1, 0, 'decayBoostEligible: true');
  }
  const reasonLine = snapshot.r6Latch?.decayBlockedReason ? `decayBlockedReason: ${snapshot.r6Latch.decayBlockedReason}` : undefined;
  if (decayIndex >= 0 && reasonLine && !lines.some((line) => line.startsWith('decayBlockedReason: '))) {
    const boostIndex = lines.indexOf('decayBoostEligible: true');
    lines.splice((boostIndex >= 0 ? boostIndex : decayIndex) + 1, 0, reasonLine);
  }
  insertAfter(lines, (line) => line.startsWith('- lastRefreshError: '), `- refreshResult: ${snapshot.macroState.refreshResult ?? 'SKIPPED'}`);
  return lines.join('\n');
}

export const RegimeResolver = {
  resolveMarketState,
};
