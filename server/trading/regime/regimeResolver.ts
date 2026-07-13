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
  return mode === 'SELL_ONLY' ? 'NORMAL' : mode;
}

function resolveRiskOverride(marketState: MarketStateSnapshot, effectiveRegime: string): RegimeRiskOverride {
  if (isR5Regime(marketState.effectiveRegime) || isR5Regime(effectiveRegime)) return 'R5_STABILIZING';
  if (marketState.executionMode === 'SHADOW_ONLY') return 'SHADOW_ONLY';
  return 'NONE';
}

function resolveDisplayRegime(input: {
  riskOverride: RegimeRiskOverride;
  marketState: MarketStateSnapshot;
  effectiveRegime: string;
}): string {
  if (input.riskOverride === 'R5_STABILIZING') return 'R5_STABILIZING';
  if (input.riskOverride === 'SHADOW_ONLY') return 'SHADOW_ONLY';
  return input.marketState.displayTitle || input.effectiveRegime;
}

function sanitizeEffectiveRegime(value: string, fallback: string): string {
  if (!isR6Regime(value)) return value;
  return isR6Regime(fallback) ? 'R4_NEUTRAL' : fallback;
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
    const diagnostics = getRegimeDiagnostics(macroState, now);
    const marketState = resolveMarketState(now, { macroState, diagnostics });
    const effectiveRegime = sanitizeEffectiveRegime(marketState.effectiveRegime, diagnostics.rawRegime);
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
      providerIssue: marketState.macroState.freshness === 'HARD_STALE' || sourceHealth !== 'VERIFIED',
      marketSignal: false,
      displaySeverity: marketState.displaySeverity,
      displayLabel: marketState.displayLabel,
      mhsDisplayLabel: marketState.mhsDisplayLabel,
      ...(marketState.macroState.freshness === 'HARD_STALE' ? {
        macroReleaseBlockMessage: 'Macro snapshot is HARD_STALE; legacy R6 release remains observation-only.',
        macroReleaseBlockDetails: {
          ageSec: marketState.macroState.ageSec,
          lastRefreshAttemptAt: marketState.macroState.lastRefreshAttemptAt,
          refreshJobLastRunAt: marketState.macroState.refreshJobLastRunAt,
          executionImpact: 'REGIME_RELEASE_BLOCKED_ONLY' as const,
        },
      } : {}),
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
