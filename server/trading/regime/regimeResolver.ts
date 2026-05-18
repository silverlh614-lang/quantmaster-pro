// @responsibility Single entrypoint for effective regime snapshot resolution.
import type { RegimeLevel } from '../../../src/types/core.js';
import { loadMacroState, type MacroState } from '../../persistence/macroStateRepo.js';
import { defaultWarnTtlSec, emitOperationalWarn } from '../../observability/operationalWarn.js';
import { resolveMarketState, type MarketStateExecutionMode, type MarketStateSnapshot } from '../marketStateResolver.js';
import { getRegimeDiagnostics } from '../regimeBridge.js';
import type {
  RegimeEngineMode,
  RegimeRiskOverride,
  RegimeSnapshot,
  ResolvedRegimeSnapshot,
} from './effectiveRegimeSnapshot.js';
import { classifyMacroDataHealth, summarizeMacroDataHealth } from './macroDataHealthRouter.js';
import { detectRegimeConflicts, emitRegimeConflictWarnings, emitRegimeDataHealthWarnings } from './regimeConflictDetector.js';

export interface ResolveRegimeSnapshotOptions {
  macroState?: MacroState | null;
  now?: Date;
  emitWarnings?: boolean;
}

function isR6Regime(value: string | undefined): boolean {
  return value === 'R6_DEFENSE' ||
    value === 'R6_PANIC' ||
    value === 'R6_CONFIRMATION_WAIT' ||
    value === 'R6_RECOVERY_WATCH';
}

function isR5Regime(value: string | undefined): boolean {
  return value === 'R5_STABILIZING' || value === 'R5_CAUTION';
}

function normalizeEngineMode(mode: MarketStateExecutionMode): RegimeEngineMode {
  return mode;
}

function resolveRiskOverride(marketState: MarketStateSnapshot, effectiveRegime: RegimeLevel): RegimeRiskOverride {
  if (isR6Regime(effectiveRegime) || isR6Regime(marketState.effectiveRegime)) return 'R6_DEFENSE';
  if (isR5Regime(marketState.effectiveRegime) || isR5Regime(effectiveRegime)) return 'R5_STABILIZING';
  if (marketState.executionMode === 'SELL_ONLY') return 'SELL_ONLY';
  if (marketState.executionMode === 'SHADOW_ONLY') return 'SHADOW_ONLY';
  return 'NONE';
}

function resolveDisplayRegime(input: {
  riskOverride: RegimeRiskOverride;
  marketState: MarketStateSnapshot;
  effectiveRegime: RegimeLevel;
}): string {
  if (input.riskOverride === 'R6_DEFENSE') return 'R6_DEFENSE';
  if (input.riskOverride === 'R5_STABILIZING') return 'R5_STABILIZING';
  if (input.riskOverride === 'SELL_ONLY') return 'SELL_ONLY';
  if (input.riskOverride === 'SHADOW_ONLY') return 'SHADOW_ONLY';
  if (isR6Regime(input.effectiveRegime) || isR6Regime(input.marketState.effectiveRegime)) return 'R6_DEFENSE';
  return input.marketState.displayTitle || input.effectiveRegime;
}

function emitSnapshotMissingWarn(cause: unknown): void {
  emitOperationalWarn({
    priority: 'P1',
    domain: 'REGIME',
    code: 'P1_REGIME_SNAPSHOT_MISSING',
    message: 'Regime snapshot resolution failed',
    executionImpact: 'REGIME_DISPLAY_CONFLICT',
    mode: 'DEGRADED',
    regime: 'UNKNOWN',
    dedupKey: 'regime-snapshot:missing',
    ttlSec: defaultWarnTtlSec('P1'),
    details: {
      reason: cause instanceof Error ? cause.message : String(cause),
      causeName: cause instanceof Error ? cause.name : undefined,
    },
  });
}

export function resolveRegimeSnapshot(options: ResolveRegimeSnapshotOptions = {}): ResolvedRegimeSnapshot {
  const now = options.now ?? new Date();
  const macroState = options.macroState !== undefined ? options.macroState : loadMacroState();

  try {
    const marketState = resolveMarketState(now);
    const diagnostics = getRegimeDiagnostics(macroState, now);
    const effectiveRegime = diagnostics.effectiveRegime;
    const riskOverride = resolveRiskOverride(marketState, effectiveRegime);
    const displayRegime = resolveDisplayRegime({ riskOverride, marketState, effectiveRegime });
    const dataHealth = classifyMacroDataHealth(macroState, now);
    const sourceHealth = summarizeMacroDataHealth(dataHealth);
    const stale = marketState.stale || sourceHealth === 'STALE' || sourceHealth === 'MISSING';

    const baseSnapshot: RegimeSnapshot = {
      snapshotId: marketState.snapshotId,
      asOf: marketState.asOf,
      ttlSec: marketState.ttlSec,
      detectedRegime: diagnostics.rawRegime,
      effectiveRegime,
      displayRegime,
      riskOverride,
      engineMode: normalizeEngineMode(marketState.executionMode),
      biasScore: Number.isFinite(marketState.biasScore) ? marketState.biasScore : null,
      mhs: Number.isFinite(marketState.mhs) ? marketState.mhs : null,
      dataHealth,
      sourceHealth,
      stale,
      providerIssue: sourceHealth !== 'VERIFIED',
      marketSignal: false,
      conflicts: [],
    };

    const snapshot: ResolvedRegimeSnapshot = {
      ...baseSnapshot,
      conflicts: detectRegimeConflicts(baseSnapshot),
      macroState,
      marketState,
      diagnostics,
    };

    if (options.emitWarnings !== false) {
      emitRegimeConflictWarnings(snapshot);
      emitRegimeDataHealthWarnings(snapshot);
    }

    return snapshot;
  } catch (cause) {
    if (options.emitWarnings !== false) emitSnapshotMissingWarn(cause);
    throw cause;
  }
}

export const RegimeResolver = {
  resolveRegimeSnapshot,
  resolve: resolveRegimeSnapshot,
};
