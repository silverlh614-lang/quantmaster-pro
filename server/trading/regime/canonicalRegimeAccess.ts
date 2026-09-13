// @responsibility Reject retired live regime API calls.
import type { RegimeLevel } from '../../../src/types/core.js';
import type { MacroState } from '../../persistence/macroStateRepo.js';

/** Old integrations must migrate; returning a neutral regime would silently restore legacy sizing and gates. */
export class RetiredRegimeError extends Error {
  readonly code = 'REGIME_RETIRED';
  constructor() {
    super('REGIME_RETIRED: live regime classification and regime-based policy have been removed.');
    this.name = 'RetiredRegimeError';
  }
}

export function resolveCanonicalRegimeLevel(_macroState: MacroState | null, _now?: Date): RegimeLevel {
  throw new RetiredRegimeError();
}

export function isCanonicalR6Defense(_macroState: MacroState | null, _now?: Date): boolean {
  throw new RetiredRegimeError();
}
