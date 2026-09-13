// @responsibility Close the retired live regime snapshot API while preserving historical snapshot types.
import type { MacroState } from '../../persistence/macroStateRepo.js';
import type { ResolvedRegimeSnapshot } from './effectiveRegimeSnapshot.js';
import { RetiredRegimeError } from './canonicalRegimeAccess.js';

export interface ResolveRegimeSnapshotOptions {
  macroState?: MacroState | null;
  now?: Date;
  emitWarnings?: boolean;
}

export function resolveRegimeSnapshot(_options: ResolveRegimeSnapshotOptions = {}): ResolvedRegimeSnapshot {
  throw new RetiredRegimeError();
}
