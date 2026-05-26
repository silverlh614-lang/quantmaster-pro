// @responsibility ADR-0531 Gate0 정본 레짐 decision-layer 단일 접근자. kill-switch만 ENV(default canonical-ON).
import type { RegimeLevel } from '../../../src/types/core.js';
import type { MacroState } from '../../persistence/macroStateRepo.js';
import { resolveRegimeSnapshot } from './regimeResolver.js';
import { getLiveRegime } from '../regimeBridge.js';

function canonicalDisabled(): boolean {
  return process.env.GATE0_CANONICAL_REGIME_DISABLED === 'true';
}

/** ADR-0531: Gate0 레짐 정본 소비 단일 통로. default canonical-ON, kill-switch 시 legacy 롤백. */
export function resolveCanonicalRegimeLevel(macroState: MacroState | null, now?: Date): RegimeLevel {
  if (canonicalDisabled()) return getLiveRegime(macroState);
  return resolveRegimeSnapshot({ macroState, now }).effectiveRegime as RegimeLevel;
}

/** ADR-0531: R6_DEFENSE 분기용. canonical riskOverride 또는 effectiveRegime 둘 다 본다(진짜 R6 보존). */
export function isCanonicalR6Defense(macroState: MacroState | null, now?: Date): boolean {
  if (canonicalDisabled()) return getLiveRegime(macroState) === 'R6_DEFENSE';
  const snap = resolveRegimeSnapshot({ macroState, now });
  return snap.riskOverride === 'R6_DEFENSE' || snap.effectiveRegime === 'R6_DEFENSE';
}
