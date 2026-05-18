// @responsibility Shared effective regime snapshot contract.
import type { MacroState } from '../../persistence/macroStateRepo.js';
import type { MarketStateSnapshot } from '../marketStateResolver.js';
import type { RegimeDiagnostics } from '../regimeBridge.js';

export type RegimeDataHealth = 'VERIFIED' | 'DEGRADED' | 'STALE' | 'MISSING';

export type RegimeRiskOverride =
  | 'NONE'
  | 'R6_DEFENSE'
  | 'R5_STABILIZING'
  | 'SELL_ONLY'
  | 'SHADOW_ONLY';

export type RegimeEngineMode =
  | 'NORMAL'
  | 'DEGRADED'
  | 'SELL_ONLY'
  | 'SHADOW_ONLY'
  | 'OBSERVE_ONLY';

export type RegimeConflictCode =
  | 'GREEN_WITH_R6'
  | 'RISK_OVERRIDE_WITH_NON_R6'
  | 'MHS_BIAS_CONFLICT'
  | 'DISPLAY_REGIME_CONFLICT';

export interface RegimeSnapshot {
  snapshotId: string;
  asOf: string;
  ttlSec: number;
  detectedRegime: string;
  effectiveRegime: string;
  displayRegime: string;
  riskOverride: RegimeRiskOverride;
  engineMode: RegimeEngineMode;
  biasScore: number | null;
  mhs: number | null;
  dataHealth: Record<string, RegimeDataHealth>;
  sourceHealth: RegimeDataHealth;
  stale: boolean;
  providerIssue: boolean;
  marketSignal: boolean;
  macroFreshness?: string;
  macroAgeSec?: number;
  macroLastRefreshAttemptAt?: string;
  macroRefreshJobLastRunAt?: string;
  regimeReleaseAllowed?: boolean;
  regimeReleaseBlockedReason?: string;
  executionImpact?: string;
  staleSources?: string[];
  rawMhsLabel?: string;
  rawBiasLabel?: string;
  selectedDisplaySource?: string;
  correctionApplied?: boolean;
  userVisibleSafe?: boolean;
  conflicts: RegimeConflictCode[];
}

export interface ResolvedRegimeSnapshot extends RegimeSnapshot {
  macroState: MacroState | null;
  marketState: MarketStateSnapshot;
  diagnostics: RegimeDiagnostics;
}
