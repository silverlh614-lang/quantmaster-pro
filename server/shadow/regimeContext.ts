// @responsibility Regime context normalization for Shadow/counterfactual learning records.
import type { EngineMode } from '../runtime/engineRuntimePolicy.js';

export type RegimePhase =
  | 'R1_RECOVERY'
  | 'R2_EARLY'
  | 'R3_EXPANSION'
  | 'R4_NEUTRAL'
  | 'R5_CAUTION'
  | 'R6_DEFENSE'
  | 'SELL_ONLY'
  | 'HARD_BLOCK'
  | 'SHADOW_ONLY'
  | 'OBSERVE_ONLY'
  | 'MARKET_CLOSED'
  | 'UNKNOWN';

export type RegimeConfidence = 'VERIFIED' | 'DEGRADED' | 'STALE' | 'MISSING' | 'UNKNOWN';

export interface RegimeContextInput {
  rawRegime?: string;
  effectiveRegime?: string;
  regimePhase?: RegimePhase | string;
  regimeAtSignal?: RegimePhase | string;
  regimeAtEntry?: RegimePhase | string;
  regimeAtExit?: RegimePhase | string;
  regimeAtOutcome?: RegimePhase | string;
  r6Trigger?: string;
  engineMode?: EngineMode | string;
  marketSession?: string;
  marketSessionState?: string;
  sellOnlyActive?: boolean;
  hardBlockActive?: boolean;
  blockedReason?: string;
  sourceFreshness?: string;
  regimeConfidence?: RegimeConfidence | string;
}

export interface NormalizedRegimeContext {
  rawRegime: string;
  effectiveRegime: string;
  regimePhase: RegimePhase;
  regimeAtSignal: RegimePhase;
  regimeAtEntry?: RegimePhase;
  regimeAtExit?: RegimePhase;
  regimeAtOutcome?: RegimePhase;
  r6Trigger?: string;
  sellOnlyActive: boolean;
  hardBlockActive: boolean;
  sourceFreshness: string;
  regimeConfidence: RegimeConfidence;
}

const PHASES: ReadonlySet<string> = new Set<RegimePhase>([
  'R1_RECOVERY',
  'R2_EARLY',
  'R3_EXPANSION',
  'R4_NEUTRAL',
  'R5_CAUTION',
  'R6_DEFENSE',
  'SELL_ONLY',
  'HARD_BLOCK',
  'SHADOW_ONLY',
  'OBSERVE_ONLY',
  'MARKET_CLOSED',
  'UNKNOWN',
]);

const CONFIDENCES: ReadonlySet<string> = new Set<RegimeConfidence>([
  'VERIFIED',
  'DEGRADED',
  'STALE',
  'MISSING',
  'UNKNOWN',
]);

function upper(value: unknown): string {
  return typeof value === 'string' ? value.trim().toUpperCase() : '';
}

function normalizeConfidence(value: unknown, sourceFreshness?: string): RegimeConfidence {
  const v = upper(value);
  if (CONFIDENCES.has(v)) return v as RegimeConfidence;
  const freshness = upper(sourceFreshness);
  if (freshness === 'FRESH') return 'VERIFIED';
  if (freshness === 'STALE') return 'STALE';
  if (freshness === 'MISSING') return 'MISSING';
  return 'UNKNOWN';
}

function inferRegimeFromReason(reason: string): string {
  if (reason.includes('R6')) return 'R6_DEFENSE';
  if (reason.includes('R5')) return 'R5_CAUTION';
  if (reason.includes('R4')) return 'R4_NEUTRAL';
  if (reason.includes('R3')) return 'R3_EXPANSION';
  if (reason.includes('R2')) return 'R2_EARLY';
  if (reason.includes('R1')) return 'R1_RECOVERY';
  return '';
}

export function isRegimePhase(value: unknown): value is RegimePhase {
  return PHASES.has(upper(value));
}

export function deriveRegimePhase(input: RegimeContextInput = {}): RegimePhase {
  if (isRegimePhase(input.regimePhase)) return upper(input.regimePhase) as RegimePhase;

  const session = upper(input.marketSessionState ?? input.marketSession);
  if (session === 'NON_TRADING_DAY' || session === 'CLOSED' || session === 'MARKET_CLOSED') {
    return 'MARKET_CLOSED';
  }

  const engineMode = upper(input.engineMode);
  const reason = upper(input.blockedReason);
  if (input.sellOnlyActive === true || engineMode === 'SELL_ONLY' || reason.includes('SELL_ONLY')) return 'SELL_ONLY';
  if (engineMode === 'SHADOW_ONLY') return 'SHADOW_ONLY';
  if (engineMode === 'OBSERVE_ONLY') return 'OBSERVE_ONLY';

  const regime = upper(input.effectiveRegime ?? input.rawRegime) || inferRegimeFromReason(reason);
  if (regime.includes('R6')) return 'R6_DEFENSE';
  if (input.hardBlockActive === true || reason.includes('HARD_BLOCK')) return 'HARD_BLOCK';
  if (regime.includes('R5')) return 'R5_CAUTION';
  if (regime.includes('R4')) return 'R4_NEUTRAL';
  if (regime.includes('R3')) return 'R3_EXPANSION';
  if (regime.includes('R2')) return 'R2_EARLY';
  if (regime.includes('R1')) return 'R1_RECOVERY';
  return 'UNKNOWN';
}

export function normalizeRegimeContext(input: RegimeContextInput = {}): NormalizedRegimeContext {
  const reason = upper(input.blockedReason);
  const rawRegime = upper(input.rawRegime) || upper(input.effectiveRegime) || inferRegimeFromReason(reason) || 'UNKNOWN';
  const effectiveRegime = upper(input.effectiveRegime) || rawRegime;
  const regimePhase = deriveRegimePhase({ ...input, rawRegime, effectiveRegime });
  const sourceFreshness = upper(input.sourceFreshness) || 'UNKNOWN';
  return {
    rawRegime,
    effectiveRegime,
    regimePhase,
    regimeAtSignal: isRegimePhase(input.regimeAtSignal) ? upper(input.regimeAtSignal) as RegimePhase : regimePhase,
    ...(isRegimePhase(input.regimeAtEntry) ? { regimeAtEntry: upper(input.regimeAtEntry) as RegimePhase } : {}),
    ...(isRegimePhase(input.regimeAtExit) ? { regimeAtExit: upper(input.regimeAtExit) as RegimePhase } : {}),
    ...(isRegimePhase(input.regimeAtOutcome) ? { regimeAtOutcome: upper(input.regimeAtOutcome) as RegimePhase } : {}),
    ...(input.r6Trigger ? { r6Trigger: input.r6Trigger } : {}),
    sellOnlyActive: input.sellOnlyActive === true || regimePhase === 'SELL_ONLY',
    hardBlockActive: input.hardBlockActive === true || regimePhase === 'HARD_BLOCK',
    sourceFreshness,
    regimeConfidence: normalizeConfidence(input.regimeConfidence, sourceFreshness),
  };
}
