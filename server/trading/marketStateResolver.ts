// @responsibility Keep historical market-state formatting while rejecting retired live regime policy resolution.
import * as base from './marketStateResolver.base.js';
import { RetiredRegimeError } from './regime/canonicalRegimeAccess.js';
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

/** Live regime policy was removed; use paper experiment status for the current engine. */
export function resolveMarketState(_now: Date = new Date(), _options: BaseResolveMarketStateOptions = {}): MarketStateSnapshot {
  throw new RetiredRegimeError();
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
