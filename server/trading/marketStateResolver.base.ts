// @responsibility Market state resolver base policy derivation.
import type { RegimeLevel } from '../../src/types/core.js';
import { loadMacroState, type MacroState } from '../persistence/macroStateRepo.js';
import {
  getAutoTradePaused,
  getDataIntegrityBlocked,
  getEmergencyStop,
  getExecutionMode,
  getManualBlockNewBuy,
  getManualManageOnly,
} from '../state.js';
import { getRegimeDiagnostics, type RegimeDiagnostics } from './regimeBridge.js';
import { getJobMetrics } from '../scheduler/scheduleCatalog.js';
import { defaultWarnTtlSec, emitOperationalWarn } from '../observability/operationalWarn.js';

export type BiasLabel = 'BULL' | 'NEUTRAL' | 'BEAR';
export type MhsLabel = 'GREEN' | 'YELLOW' | 'RED';
export type RiskOverride =
  | 'NONE'
  | 'BLACK_SWAN'
  | 'CIRCUIT_BREAKER'
  | 'KOSPI_CRASH'
  | 'MANUAL_KILL_SWITCH';
export type EffectiveMarketRegime = RegimeLevel | 'R6_PANIC' | 'R6_CONFIRMATION_WAIT' | 'R6_RECOVERY_WATCH' | 'R5_STABILIZING' | 'R4_CAUTION' | 'R3_NORMAL';
export type MarketStateExecutionMode =
  | 'NORMAL'
  | 'DEGRADED'
  | 'SELL_ONLY'
  | 'SHADOW_ONLY'
  | 'OBSERVE_ONLY';
export type DisplaySeverity = 'OK' | 'CAUTION' | 'DEFENSE' | 'PANIC';
export type ShadowCandidateScanTrigger = 'SCHEDULED' | 'MANUAL' | 'R6_CONFIRMATION_WAIT' | 'BIAS_RECOVERY' | 'POST_CLOSE_OBSERVE' | 'DEGRADED_OBSERVE';

export interface MarketStateSnapshot {
  snapshotId: string;
  asOf: string;
  ttlSec: number;

  biasScore: number;
  biasLabel: BiasLabel;

  mhs: number;
  mhsLabel: MhsLabel;
  rawMhs: number;
  rawMhsLabel: MhsLabel;
  mhsDisplayLabel: MhsLabel | 'OVERRIDDEN_BY_R6';

  detectedRegime: RegimeLevel;
  rawTrend: string;
  riskOverride: RiskOverride;
  effectiveRegime: EffectiveMarketRegime;

  liveNewBuyAllowed: boolean;
  liveSellAllowed: boolean;
  positionManagementAllowed: boolean;
  shadowLearningAllowed: boolean;
  shadowScanAllowed: boolean;
  shadowPaperFillAllowed: boolean;
  executionMode: MarketStateExecutionMode;

  displayRegime: EffectiveMarketRegime;
  displaySeverity: DisplaySeverity;
  displayTitle: string;
  displayEmoji: string;
  displayLabel: string;
  reasonCodes: string[];

  stale: boolean;
  staleSources: string[];
  macroState: MacroStateStaleness;
  r6Latch?: {
    active: boolean;
    triggerType?: string;
    triggeredAt?: string;
    expiresAt?: string;
    severity?: number;
    decayLevel: number;
    decayBlockedReason?: string;
    releaseEligibleAt?: string;
    activeTriggers: string[];
    previousTriggers: string[];
  };
}

export type MacroStateFreshness = 'FRESH' | 'SOFT_STALE' | 'POST_CLOSE_VALID' | 'EOD_SNAPSHOT_VALID' | 'HARD_STALE' | 'MISSING';

export interface MacroStateStaleness {
  stale: boolean;
  freshness: MacroStateFreshness;
  lastUpdatedAt?: string;
  updatedAt?: string;
  ageSec?: number;
  ttlSec: number;
  softStaleSec: number;
  hardStaleSec: number;
  staleReason: string;
  lastRefreshAttemptAt?: string;
  lastRefreshSuccessAt?: string;
  lastRefreshError?: string;
  refreshJobEnabled?: boolean;
  refreshJobLastRunAt?: string;
  refreshBlockedReason?: string;
  providerUsed?: string;
  provider?: string;
  fallbackUsed?: boolean | string;
  writeSucceeded?: boolean;
  updatedAtChanged?: boolean;
  executionImpact: 'LIVE_BUY_BLOCKED_RECOVERY_WATCH_ALLOWED' | 'REGIME_RELEASE_BLOCKED_ONLY' | 'NONE';
  refreshJobStalled?: boolean;
}

export interface MarketStateNowContext {
  activePositions?: number;
  maxPositions?: number;
  lastSignalLabel?: string;
  shadowActivity?: ShadowActivitySnapshot;
}

export interface ShadowActivitySnapshot {
  scanAllowed: boolean;
  lastScanAt?: string;
  evaluatedCount: number;
  candidateCount: number;
  buySignalCount: number;
  sellCheckCount: number;
  paperFillCount: number;
  openShadowPositions: number;
  lastShadowSignalAt?: string;
  lastBlockReason?: string;
  candidateScanStatus?: 'RAN' | 'NOT_RUN' | 'SKIPPED';
  candidateScanTrigger?: ShadowCandidateScanTrigger;
  candidateSkipReason?: string;
  accumulatingCandidates?: number;
  r6CounterfactualEntries?: number;
  noShadowEntryReason?: string;
}


const DEFAULT_TTL_SEC = 300;

function emitMarketStateOperationalWarn(input: {
  code: string;
  message: string;
  dedupKey: string;
  executionImpact?: 'REGIME_DISPLAY_CONFLICT' | 'NONE';
  details?: Record<string, unknown>;
}): void {
  emitOperationalWarn({
    priority: 'P1',
    domain: 'REGIME',
    code: input.code,
    message: input.message,
    executionImpact: input.executionImpact ?? 'REGIME_DISPLAY_CONFLICT',
    mode: 'DEGRADED',
    dedupKey: input.dedupKey,
    ttlSec: defaultWarnTtlSec('P1'),
    details: input.details,
  });
}

function finiteNumber(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isFinite(value) ? value : undefined;
}

function readFiniteField(source: Record<string, unknown>, keys: string[]): number | undefined {
  for (const key of keys) {
    const value = finiteNumber(source[key]);
    if (value !== undefined) return value;
  }
  return undefined;
}

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

function round1(value: number): number {
  return Math.round(value * 10) / 10;
}

function resolveMhsLabel(mhs: number, macro: MacroState | null): MhsLabel {
  const regime = macro?.regime;
  if (regime === 'GREEN' || regime === 'YELLOW' || regime === 'RED') return regime;
  if (mhs >= 70) return 'GREEN';
  if (mhs >= 40) return 'YELLOW';
  return 'RED';
}

function resolveBiasScore(macro: MacroState | null): number {
  if (!macro) return 0;
  const record = macro as unknown as Record<string, unknown>;
  const explicit = readFiniteField(record, [
    'biasScore',
    'directionBiasScore',
    'preMarketBiasScore',
    'marketBiasScore',
    'globalBiasScore',
    'riskBiasScore',
    'bias',
  ]);
  if (explicit !== undefined) return round1(clamp(explicit, -100, 100));

  const kospiDay = finiteNumber(macro.kospiDayReturn) ?? 0;
  const kospi20d = finiteNumber(macro.kospi20dReturn) ?? 0;
  const spx20d = finiteNumber(macro.spx20dReturn) ?? 0;
  const foreign5d = finiteNumber(macro.foreignNetBuy5d) ?? 0;
  const vkospiDay = finiteNumber(macro.vkospiDayChange) ?? 0;
  const usdKrwDay = finiteNumber(macro.usdKrwDayChange) ?? 0;
  const dxy5d = finiteNumber(macro.dxy5dChange) ?? 0;
  const vix = finiteNumber(macro.vix) ?? 20;

  const derived =
    kospiDay * 12 +
    kospi20d * 2 +
    spx20d * 2 +
    clamp(foreign5d / 2500, -10, 10) -
    vkospiDay * 1.2 -
    usdKrwDay * 6 -
    dxy5d * 2 -
    Math.max(0, vix - 20) * 1.5;

  return round1(clamp(derived, -100, 100));
}

function resolveBiasLabel(score: number): BiasLabel {
  if (score <= -20) return 'BEAR';
  if (score >= 20) return 'BULL';
  return 'NEUTRAL';
}

function explicitRiskOverride(macro: MacroState | null): RiskOverride | undefined {
  if (!macro) return undefined;
  const value = (macro as unknown as Record<string, unknown>).riskOverride;
  if (
    value === 'BLACK_SWAN' ||
    value === 'CIRCUIT_BREAKER' ||
    value === 'KOSPI_CRASH' ||
    value === 'MANUAL_KILL_SWITCH' ||
    value === 'NONE'
  ) {
    return value;
  }
  return undefined;
}

function resolveRiskOverride(diagnostics: RegimeDiagnostics, macro: MacroState | null): RiskOverride {
  const explicit = explicitRiskOverride(macro);
  if (explicit && explicit !== 'NONE') return explicit;
  if (getEmergencyStop()) return 'MANUAL_KILL_SWITCH';
  if (getDataIntegrityBlocked()) return 'CIRCUIT_BREAKER';

  if (diagnostics.effectiveRegime === 'R6_DEFENSE' || diagnostics.rawRegime === 'R6_DEFENSE') {
    const triggers = diagnostics.activeR6Triggers;
    if (
      triggers.includes('KOSPI_INTRADAY_LOW_SHOCK') ||
      triggers.includes('KOSPI_CLOSE_SHOCK')
    ) {
      return 'KOSPI_CRASH';
    }
    return 'BLACK_SWAN';
  }

  return explicit ?? 'NONE';
}

function isR6ConfirmationWait(diagnostics: RegimeDiagnostics): boolean {
  return (
    diagnostics.activeR6Triggers.length === 0 &&
    diagnostics.r6TriggerBreakdown.triggerFreshness === 'FRESH' &&
    diagnostics.r6ShockLatch === true &&
    diagnostics.recoveryBlockedReason === 'WAITING_FOR_CLOSE_OR_NEXT_TRADING_DAY_CONFIRMATION'
  );
}

function resolveEffectiveRegime(
  diagnostics: RegimeDiagnostics,
  riskOverride: RiskOverride,
): EffectiveMarketRegime {
  if (isR6ConfirmationWait(diagnostics)) return 'R6_CONFIRMATION_WAIT';
  if (diagnostics.r6RecoveryStatus === 'STALE_DATA_BLOCKED') return 'R6_DEFENSE';
  if (diagnostics.transitionState.r6StateMachineState === 'R6_PANIC') return 'R6_PANIC';
  if (diagnostics.transitionState.r6StateMachineState === 'R6_RECOVERY_WATCH') return 'R6_RECOVERY_WATCH';
  if (diagnostics.transitionState.r6StateMachineState === 'R5_STABILIZING') return 'R5_STABILIZING';
  if (diagnostics.transitionState.r6StateMachineState === 'R4_CAUTION') return 'R4_CAUTION';
  if (diagnostics.transitionState.r6StateMachineState === 'R3_NORMAL') return 'R3_NORMAL';
  let effective: EffectiveMarketRegime = diagnostics.effectiveRegime;
  const recoveryActive =
    diagnostics.r6RecoveryStatus === 'COOLDOWN' ||
    diagnostics.r6RecoveryStatus === 'RECOVERY_CANDIDATE';
  if (recoveryActive && diagnostics.effectiveRegime !== 'R6_DEFENSE') {
    effective = 'R6_RECOVERY_WATCH';
  }

  const hardOverride =
    riskOverride === 'BLACK_SWAN' ||
    riskOverride === 'CIRCUIT_BREAKER' ||
    riskOverride === 'KOSPI_CRASH';
  if (hardOverride && !['R6_PANIC', 'R6_DEFENSE', 'R6_CONFIRMATION_WAIT', 'R6_RECOVERY_WATCH'].includes(effective)) {
    emitMarketStateOperationalWarn({
      code: 'P1_RISK_OVERRIDE_WITH_NON_R6',
      message: '[MARKET_STATE_CONFLICT] type=RISK_OVERRIDE_WITH_NON_R6 action=FORCE_R6_DEFENSE',
      dedupKey: `market-state:risk-override-non-r6:${riskOverride}:${effective}`,
      details: { riskOverride, effectiveRegime: effective },
    });
    effective = 'R6_DEFENSE';
  }

  return effective;
}

function resolveExecution(snapshot: {
  effectiveRegime: EffectiveMarketRegime;
  riskOverride: RiskOverride;
}): Pick<MarketStateSnapshot, 'liveNewBuyAllowed' | 'liveSellAllowed' | 'positionManagementAllowed' | 'shadowLearningAllowed' | 'shadowScanAllowed' | 'shadowPaperFillAllowed' | 'executionMode'> {
  const baseMode = getExecutionMode();
  const emergency = getEmergencyStop();
  const dataBlocked = getDataIntegrityBlocked();
  const paused = getAutoTradePaused();
  const manualBlock = getManualBlockNewBuy() || getManualManageOnly();
  const inR6 = snapshot.effectiveRegime === 'R6_PANIC' || snapshot.effectiveRegime === 'R6_DEFENSE' || snapshot.effectiveRegime === 'R6_CONFIRMATION_WAIT' || snapshot.effectiveRegime === 'R6_RECOVERY_WATCH' || snapshot.effectiveRegime === 'R5_STABILIZING';

  const liveSellAllowed = !emergency;
  const liveNewBuyAllowed =
    baseMode === 'LIVE' &&
    !emergency &&
    !dataBlocked &&
    !paused &&
    !manualBlock &&
    !inR6;

  let executionMode: MarketStateExecutionMode = 'NORMAL';
  if (emergency) executionMode = 'OBSERVE_ONLY';
  else if (inR6) executionMode = 'SELL_ONLY';
  else if (dataBlocked || paused || manualBlock) executionMode = 'DEGRADED';
  else if (baseMode === 'OFF') executionMode = 'SHADOW_ONLY';
  else executionMode = 'NORMAL';

  return {
    liveNewBuyAllowed,
    liveSellAllowed,
    positionManagementAllowed: liveSellAllowed,
    shadowLearningAllowed: true,
    shadowScanAllowed: true,
    shadowPaperFillAllowed: true,
    executionMode,
  };
}

function baseDisplaySeverity(
  effectiveRegime: EffectiveMarketRegime,
  riskOverride: RiskOverride,
  mhsLabel: MhsLabel,
): DisplaySeverity {
  if (riskOverride === 'MANUAL_KILL_SWITCH') return 'PANIC';
  if (effectiveRegime === 'R6_PANIC') return 'PANIC';
  if (effectiveRegime === 'R6_DEFENSE') return riskOverride === 'BLACK_SWAN' || riskOverride === 'KOSPI_CRASH' ? 'PANIC' : 'DEFENSE';
  if (effectiveRegime === 'R6_CONFIRMATION_WAIT') return 'DEFENSE';
  if (effectiveRegime === 'R6_RECOVERY_WATCH') return 'DEFENSE';
  if (effectiveRegime === 'R5_STABILIZING') return 'CAUTION';
  if (riskOverride !== 'NONE') return 'DEFENSE';
  if (mhsLabel === 'RED') return 'CAUTION';
  if (mhsLabel === 'YELLOW') return 'CAUTION';
  return 'OK';
}

function isR6DisplayOverride(snapshot: MarketStateSnapshot): boolean {
  return snapshot.riskOverride === 'BLACK_SWAN' ||
    snapshot.riskOverride === 'KOSPI_CRASH' ||
    snapshot.riskOverride === 'CIRCUIT_BREAKER' ||
    snapshot.effectiveRegime === 'R6_DEFENSE';
}

function applyConflictRules(snapshot: MarketStateSnapshot): MarketStateSnapshot {
  const reasonCodes = new Set(snapshot.reasonCodes);
  let displayRegime = snapshot.displayRegime;
  let displaySeverity = snapshot.displaySeverity;
  let liveNewBuyAllowed = snapshot.liveNewBuyAllowed;
  let mhsDisplayLabel = snapshot.mhsDisplayLabel;

  if (isR6DisplayOverride(snapshot)) {
    displayRegime = 'R6_DEFENSE';
    displaySeverity = 'PANIC';
    liveNewBuyAllowed = false;
    mhsDisplayLabel = 'OVERRIDDEN_BY_R6';
    reasonCodes.add('R6_DISPLAY_OVERRIDE');
  }

  if (snapshot.effectiveRegime === 'R6_DEFENSE' && displaySeverity === 'OK') {
    emitMarketStateOperationalWarn({
      code: 'P1_GREEN_WITH_R6_BLOCKED',
      message: '[MARKET_STATE_CONFLICT] type=GREEN_WITH_R6 action=FORCE_DEFENSE_DISPLAY',
      dedupKey: `market-state:green-with-r6:${snapshot.snapshotId}`,
      details: {
        snapshotId: snapshot.snapshotId,
        effectiveRegime: snapshot.effectiveRegime,
        displaySeverity,
      },
    });
    displaySeverity = 'DEFENSE';
    reasonCodes.add('GREEN_WITH_R6_FORCED_DEFENSE');
  }

  if (snapshot.riskOverride !== 'NONE' && snapshot.mhsLabel === 'GREEN') {
    const userVisibleSafe = (
      (snapshot.riskOverride === 'BLACK_SWAN' || snapshot.riskOverride === 'R6_DEFENSE') &&
      displayRegime === 'R6_DEFENSE' &&
      mhsDisplayLabel === 'OVERRIDDEN_BY_R6' &&
      liveNewBuyAllowed === false
    );
    emitMarketStateOperationalWarn({
      code: userVisibleSafe ? 'P1_MHS_BIAS_OVERRIDDEN_BY_R6' : 'P1_MHS_BIAS_CONFLICT',
      message: '[MHS_RISK_OVERRIDE_CONFLICT] action=RISK_OVERRIDE_PRIORITY',
      dedupKey: `market-state:mhs-risk-override:${snapshot.riskOverride}:${snapshot.mhs}`,
      details: {
        snapshotId: snapshot.snapshotId,
        rawMhs: snapshot.mhs,
        rawMhsLabel: snapshot.mhsLabel,
        mhsDisplayLabel,
        biasScore: snapshot.biasScore,
        biasLabel: snapshot.biasLabel,
        riskOverride: snapshot.riskOverride,
        detectedRegime: snapshot.detectedRegime,
        effectiveRegime: snapshot.effectiveRegime,
        displayRegime,
        displaySeverity,
        liveNewBuyAllowed,
        telegramDisplayRegime: displayRegime,
        correctionApplied: userVisibleSafe,
        userVisibleSafe,
        selectedDisplaySource: 'R6_OVERRIDE',
      },
    });
    reasonCodes.add('MHS_GREEN_BUT_RISK_OVERRIDE_PRIORITY');
  }

  if (snapshot.biasLabel === 'BEAR' && displaySeverity === 'OK') {
    reasonCodes.add('SHORT_TERM_BIAS_BEAR');
  }

  const { displayTitle, displayEmoji } = resolveDisplayChrome(
    displayRegime,
    displaySeverity,
  );
  const displayLabel = `${displayEmoji} ${displayTitle}`;

  return {
    ...snapshot,
    liveNewBuyAllowed,
    displayRegime,
    displaySeverity,
    displayTitle,
    displayEmoji,
    displayLabel,
    mhsDisplayLabel,
    reasonCodes: Array.from(reasonCodes),
  };
}

function resolveDisplayChrome(
  effectiveRegime: EffectiveMarketRegime,
  severity: DisplaySeverity,
): Pick<MarketStateSnapshot, 'displayTitle' | 'displayEmoji'> {
  if (effectiveRegime === 'R6_PANIC') return { displayTitle: 'R6_PANIC', displayEmoji: '🔴' };
  if (effectiveRegime === 'R6_DEFENSE') return { displayTitle: 'R6_DEFENSE', displayEmoji: '🔴' };
  if (effectiveRegime === 'R6_CONFIRMATION_WAIT') return { displayTitle: 'R6_CONFIRMATION_WAIT', displayEmoji: '🔴' };
  if (effectiveRegime === 'R6_RECOVERY_WATCH') return { displayTitle: 'R6_RECOVERY_WATCH', displayEmoji: '🟠' };
  if (effectiveRegime === 'R5_STABILIZING') return { displayTitle: 'R5_STABILIZING', displayEmoji: '🟡' };
  if (effectiveRegime === 'R4_CAUTION') return { displayTitle: 'R4_CAUTION', displayEmoji: '🟡' };
  if (effectiveRegime === 'R3_NORMAL') return { displayTitle: 'R3_NORMAL', displayEmoji: '🟢' };
  if (severity === 'PANIC') return { displayTitle: effectiveRegime, displayEmoji: '🔴' };
  if (severity === 'DEFENSE') return { displayTitle: effectiveRegime, displayEmoji: '🟠' };
  if (severity === 'CAUTION') return { displayTitle: effectiveRegime, displayEmoji: '🟡' };
  return { displayTitle: effectiveRegime, displayEmoji: '🟢' };
}

function buildReasonCodes(
  diagnostics: RegimeDiagnostics,
  riskOverride: RiskOverride,
  biasLabel: BiasLabel,
  mhsLabel: MhsLabel,
): string[] {
  const reasons = new Set<string>();
  if (riskOverride !== 'NONE') reasons.add(`${riskOverride}_OVERRIDE`);
  if (diagnostics.transitionReason) reasons.add(diagnostics.transitionReason);
  for (const trigger of diagnostics.activeR6Triggers) reasons.add(trigger);
  if (diagnostics.r6ShockLatch) reasons.add('R6_SHOCK_LATCH');
  if (diagnostics.recoveryBlockedReason) reasons.add(diagnostics.recoveryBlockedReason);
  if (biasLabel === 'BEAR') reasons.add('BIAS_BEAR');
  if (mhsLabel === 'GREEN' && biasLabel === 'BEAR') reasons.add('MHS_GREEN_BIAS_BEAR_DIVERGENCE');
  if (reasons.size === 0) reasons.add('NONE');
  return Array.from(reasons);
}

function resolveAsOf(macro: MacroState | null, now: Date): string {
  const parsed = macro?.updatedAt ? Date.parse(macro.updatedAt) : NaN;
  if (Number.isFinite(parsed)) return new Date(parsed).toISOString();
  return now.toISOString();
}

function resolveTtlSec(): number {
  const raw = Number(process.env.MACRO_STATE_TTL_SEC ?? process.env.MARKET_STATE_SNAPSHOT_TTL_SEC ?? DEFAULT_TTL_SEC);
  return Number.isFinite(raw) && raw > 0 ? Math.trunc(raw) : DEFAULT_TTL_SEC;
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

function readFallbackUsed(source: MacroState | null): boolean | string | undefined {
  const record = source as unknown as Record<string, unknown> | null;
  if (!record) return undefined;
  const direct = record.fallbackUsed;
  if (typeof direct === 'boolean' || typeof direct === 'string') return direct;
  const sectorFallback = source?.sectorEnergyQualityDiagnostic?.fallbackUsed;
  return sectorFallback && sectorFallback !== 'NONE' ? sectorFallback : false;
}


function resolveMacroRefreshJobLastRunAt(macro: MacroState | null): string | undefined {
  const explicit = readStringField(macro, ['refreshJobLastRunAt', 'macroRefreshJobLastRunAt']);
  if (explicit) return explicit;
  const candidates = [
    getJobMetrics('market_regime_refresh_intraday_ttl')?.lastSuccessAt,
    getJobMetrics('market_regime_refresh_close')?.lastSuccessAt,
    getJobMetrics('market_regime_refresh_morning')?.lastSuccessAt,
  ].filter((value): value is string => typeof value === 'string' && value.length > 0);
  return candidates.sort((a, b) => Date.parse(b) - Date.parse(a))[0];
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

function resolveSoftStaleSec(ttlSec: number): number {
  const raw = Number(process.env.R6_RECOVERY_SOFT_STALE_SEC ?? 900);
  return Number.isFinite(raw) && raw > 0 ? Math.max(ttlSec, Math.trunc(raw)) : Math.max(ttlSec, 900);
}

function kstDateKey(date: Date): string {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Seoul',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(date);
}

function kstMinutes(date: Date): number {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: 'Asia/Seoul',
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
  }).formatToParts(date);
  const hour = Number(parts.find((part) => part.type === 'hour')?.value);
  const minute = Number(parts.find((part) => part.type === 'minute')?.value);
  return Number.isFinite(hour) && Number.isFinite(minute) ? hour * 60 + minute : -1;
}

function isPostCloseSession(macro: MacroState | null, now: Date): boolean {
  const explicit = String((macro as unknown as Record<string, unknown> | null)?.marketSessionState ?? '').toUpperCase();
  if (['POST_CLOSE', 'AFTER_MARKET', 'AFTER_HOURS', 'CLOSING_AUCTION', 'CLOSED'].includes(explicit)) return true;
  return kstMinutes(now) >= 15 * 60 + 20;
}

function isSameKstDate(leftMs: number, right: Date): boolean {
  return kstDateKey(new Date(leftMs)) === kstDateKey(right);
}

function classifyMacroStateFreshness(
  ageSec: number | undefined,
  hasValidAsOf: boolean,
  ttlSec: number,
  macro: MacroState | null,
  asOfMs: number,
  now: Date,
): MacroStateFreshness {
  if (!hasValidAsOf) return 'MISSING';
  if ((ageSec ?? Number.POSITIVE_INFINITY) <= ttlSec) return 'FRESH';
  if ((ageSec ?? Number.POSITIVE_INFINITY) <= resolveSoftStaleSec(ttlSec)) return 'SOFT_STALE';
  if (macro && isPostCloseSession(macro, now) && isSameKstDate(asOfMs, now)) {
    return kstMinutes(now) >= 18 * 60 ? 'EOD_SNAPSHOT_VALID' : 'POST_CLOSE_VALID';
  }
  return 'HARD_STALE';
}

function resolveHardStaleSec(ttlSec: number): number {
  const raw = Number(process.env.R6_RECOVERY_HARD_STALE_SEC ?? resolveSoftStaleSec(ttlSec));
  return Number.isFinite(raw) && raw > 0 ? Math.max(ttlSec, Math.trunc(raw)) : resolveSoftStaleSec(ttlSec);
}


function isRefreshJobStalled(info: MacroStateStaleness, now: Date): boolean {
  if (info.freshness !== 'HARD_STALE') return false;
  const lastRunMs = info.refreshJobLastRunAt ? Date.parse(info.refreshJobLastRunAt) : NaN;
  if (!Number.isFinite(lastRunMs)) return true;
  return Math.floor((now.getTime() - lastRunMs) / 1000) > info.hardStaleSec;
}

function buildMacroStateStaleness(macro: MacroState | null, asOf: string, now: Date, ttlSec: number, diagnostics: RegimeDiagnostics): MacroStateStaleness {
  const asOfMs = Date.parse(asOf);
  const ageSec = Number.isFinite(asOfMs) ? Math.max(0, Math.floor((now.getTime() - asOfMs) / 1000)) : undefined;
  const freshness = classifyMacroStateFreshness(ageSec, Number.isFinite(asOfMs) && !!macro, ttlSec, macro, asOfMs, now);
  const softStaleSec = resolveSoftStaleSec(ttlSec);
  const hardStaleSec = resolveHardStaleSec(ttlSec);
  const stale = freshness !== 'FRESH' && freshness !== 'POST_CLOSE_VALID' && freshness !== 'EOD_SNAPSHOT_VALID' || diagnostics.sourceFreshness === 'HARD_STALE' || diagnostics.sourceFreshness === 'STALE' || diagnostics.sourceFreshness === 'MISSING';
  const staleReason = !macro ? 'MACRO_STATE_MISSING' : !Number.isFinite(asOfMs) ? 'LAST_UPDATED_AT_INVALID' : freshness !== 'FRESH' ? freshness : diagnostics.sourceFreshness !== 'FRESH' ? `REGIME_SOURCE_${diagnostics.sourceFreshness}` : 'NONE';
  const info: MacroStateStaleness = {
    stale,
    freshness,
    lastUpdatedAt: macro?.updatedAt,
    updatedAt: macro?.updatedAt,
    ageSec,
    ttlSec,
    softStaleSec,
    hardStaleSec,
    staleReason,
    lastRefreshAttemptAt: readStringField(macro, ['lastRefreshAttemptAt', 'macroLastRefreshAttemptAt']),
    lastRefreshSuccessAt: readStringField(macro, ['lastRefreshSuccessAt', 'macroLastRefreshSuccessAt']),
    lastRefreshError: readStringField(macro, ['lastRefreshError', 'macroLastRefreshError', 'refreshError']),
    refreshJobEnabled: (macro as unknown as Record<string, unknown> | null)?.refreshJobEnabled as boolean | undefined,
    refreshJobLastRunAt: resolveMacroRefreshJobLastRunAt(macro),
    refreshBlockedReason: readStringField(macro, ['refreshBlockedReason', 'macroRefreshBlockedReason']),
    providerUsed: readStringField(macro, ['providerUsed', 'provider', 'sourceProvider', 'source', 'refreshProvider']),
    provider: readStringField(macro, ['providerUsed', 'provider', 'sourceProvider', 'source', 'refreshProvider']),
    fallbackUsed: readFallbackUsed(macro),
    writeSucceeded: readBooleanField(macro, ['writeSucceeded', 'macroWriteSucceeded']),
    updatedAtChanged: readBooleanField(macro, ['updatedAtChanged', 'macroUpdatedAtChanged']),
    executionImpact: freshness === 'SOFT_STALE' ? 'LIVE_BUY_BLOCKED_RECOVERY_WATCH_ALLOWED' : stale || freshness === 'POST_CLOSE_VALID' || freshness === 'EOD_SNAPSHOT_VALID' ? 'REGIME_RELEASE_BLOCKED_ONLY' : 'NONE',
  };
  if (info.stale || info.freshness !== 'FRESH') {
    const baseDetails = {
      reason: 'providerIssue=true marketSignal=false',
      freshness: info.freshness,
      ageSec: info.ageSec ?? 'N/A',
      ttlSec: info.ttlSec,
      softStaleSec: info.softStaleSec,
      hardStaleSec: info.hardStaleSec,
      lastRefreshAttemptAt: info.lastRefreshAttemptAt ?? 'N/A',
      lastRefreshSuccessAt: info.lastRefreshSuccessAt ?? 'N/A',
      lastRefreshError: info.lastRefreshError ?? 'N/A',
      refreshJobEnabled: info.refreshJobEnabled ?? 'N/A',
      refreshJobLastRunAt: info.refreshJobLastRunAt ?? 'N/A',
      refreshBlockedReason: info.refreshBlockedReason ?? 'NONE',
      providerUsed: info.providerUsed ?? 'N/A',
      fallbackUsed: info.fallbackUsed ?? 'N/A',
      writeSucceeded: info.writeSucceeded ?? 'N/A',
      updatedAtChanged: info.updatedAtChanged ?? 'N/A',
      staleReason: info.staleReason,
      executionImpact: info.executionImpact,
      providerIssue: true,
      marketSignal: false,
    };
    emitMarketStateOperationalWarn({
      code: isRefreshJobStalled(info, now) ? 'P1_MACRO_REFRESH_JOB_STALLED' : 'P1_MACRO_STATE_STALE',
      message: '[MACRO_STATE_STALENESS] macro state is stale or not fresh',
      dedupKey: `macro-state-staleness:${info.freshness}:${info.staleReason}`,
      executionImpact: 'NONE',
      details: baseDetails,
    });

    const refreshJobLastRunMs = info.refreshJobLastRunAt ? Date.parse(info.refreshJobLastRunAt) : NaN;
    const refreshJobAgeSec = Number.isFinite(refreshJobLastRunMs)
      ? Math.max(0, Math.floor((now.getTime() - refreshJobLastRunMs) / 1000))
      : Number.POSITIVE_INFINITY;
    const refreshBlockedReason = info.refreshBlockedReason ?? 'NONE';
    const lastRefreshError = info.lastRefreshError ?? 'N/A';
    const noClearRefreshError = lastRefreshError === 'N/A' || lastRefreshError.trim() === '' || lastRefreshError === 'NONE';
    if (
      info.freshness === 'HARD_STALE' &&
      info.refreshJobEnabled === true &&
      refreshBlockedReason === 'NONE' &&
      noClearRefreshError &&
      refreshJobAgeSec > info.hardStaleSec
    ) {
      info.refreshJobStalled = true;
      emitMarketStateOperationalWarn({
        code: 'P1_MACRO_REFRESH_JOB_STALLED',
        message: 'macro refresh job has not run within hard stale threshold',
        dedupKey: `macro-refresh-job-stalled:${info.refreshJobLastRunAt ?? 'missing'}`,
        executionImpact: 'NONE',
        details: {
          ...baseDetails,
          reason: 'macro refresh job has not run within hard stale threshold',
          refreshJobAgeSec,
          refreshJobStalled: true,
          executionImpact: 'REGIME_RELEASE_BLOCKED_ONLY',
          providerIssue: true,
          marketSignal: false,
          shadowLearningAllowed: true,
        },
      });
    }
  }
  return info;
}

function resolveStaleness(macro: MacroState | null, asOf: string, now: Date, ttlSec: number, diagnostics: RegimeDiagnostics): { stale: boolean; staleSources: string[]; macroState: MacroStateStaleness } {
  const staleSources: string[] = [];
  const macroState = buildMacroStateStaleness(macro, asOf, now, ttlSec, diagnostics);
  if (macroState.stale) staleSources.push('macroState');
  if (diagnostics.sourceFreshness !== 'FRESH' && diagnostics.sourceFreshness !== 'POST_CLOSE_VALID' && diagnostics.sourceFreshness !== 'EOD_SNAPSHOT_VALID') staleSources.push(`regimeSource:${diagnostics.sourceFreshness}`);
  if (diagnostics.r6TriggerBreakdown.triggerFreshness !== 'FRESH' && diagnostics.r6TriggerBreakdown.triggerFreshness !== 'POST_CLOSE_VALID' && diagnostics.r6TriggerBreakdown.triggerFreshness !== 'EOD_SNAPSHOT_VALID') {
    staleSources.push(`r6Trigger:${diagnostics.r6TriggerBreakdown.triggerFreshness}`);
  }
  return { stale: staleSources.length > 0, staleSources, macroState };
}

function stableHash(input: string): string {
  let hash = 0;
  for (let i = 0; i < input.length; i++) {
    hash = (hash * 31 + input.charCodeAt(i)) >>> 0;
  }
  return hash.toString(36).padStart(6, '0');
}

function buildSnapshotId(parts: {
  asOf: string;
  mhs: number;
  biasScore: number;
  riskOverride: RiskOverride;
  detectedRegime: RegimeLevel;
  effectiveRegime: EffectiveMarketRegime;
}): string {
  const compactAsOf = parts.asOf.replace(/[-:.TZ]/g, '').slice(0, 14);
  const seed = [
    parts.asOf,
    parts.mhs.toFixed(1),
    parts.biasScore.toFixed(1),
    parts.riskOverride,
    parts.detectedRegime,
    parts.effectiveRegime,
  ].join('|');
  return `mkt_${compactAsOf}_${stableHash(seed)}`;
}

function logSnapshot(snapshot: MarketStateSnapshot): void {
  console.info(
    '[MARKET_STATE_SNAPSHOT] ' +
    `snapshotId=${snapshot.snapshotId} ` +
    `asOf=${snapshot.asOf} ` +
    `biasScore=${snapshot.biasScore.toFixed(1)} ` +
    `biasLabel=${snapshot.biasLabel} ` +
    `mhs=${snapshot.mhs.toFixed(0)} ` +
    `mhsLabel=${snapshot.mhsLabel} ` +
    `mhsDisplayLabel=${snapshot.mhsDisplayLabel} ` +
    `riskOverride=${snapshot.riskOverride} ` +
    `detectedRegime=${snapshot.detectedRegime} ` +
    `effectiveRegime=${snapshot.effectiveRegime} ` +
    `displayRegime=${snapshot.displayRegime} ` +
    `displaySeverity=${snapshot.displaySeverity} ` +
    `liveNewBuyAllowed=${snapshot.liveNewBuyAllowed} ` +
    `positionManagementAllowed=${snapshot.positionManagementAllowed} ` +
    `shadowLearningAllowed=${snapshot.shadowLearningAllowed} ` +
    `shadowScanAllowed=${snapshot.shadowScanAllowed} ` +
    `shadowPaperFillAllowed=${snapshot.shadowPaperFillAllowed} ` +
    `stale=${snapshot.stale} ` +
    `staleSources=${snapshot.staleSources.join(',') || 'none'} ` +
    `macroStateFreshness=${snapshot.macroState.freshness} ` +
    `macroStateStaleReason=${snapshot.macroState.staleReason} ` +
    `macroStateAgeSec=${snapshot.macroState.ageSec ?? 'N/A'}`,
  );
}

export function resolveMarketState(now: Date = new Date()): MarketStateSnapshot {
  const macro = loadMacroState();
  const diagnostics = getRegimeDiagnostics(macro, now);
  const ttlSec = resolveTtlSec();
  const asOf = resolveAsOf(macro, now);
  const mhs = finiteNumber(macro?.mhs) ?? 50;
  const mhsLabel = resolveMhsLabel(mhs, macro);
  const biasScore = resolveBiasScore(macro);
  const biasLabel = resolveBiasLabel(biasScore);
  const riskOverride = resolveRiskOverride(diagnostics, macro);
  let effectiveRegime = resolveEffectiveRegime(diagnostics, riskOverride);
  if (effectiveRegime === 'R6_RECOVERY_WATCH' && diagnostics.r6RecoveryStatus === 'RECOVERY_CANDIDATE' && mhs >= 65 && biasScore >= -20 && !diagnostics.r6ShockLatch) {
    effectiveRegime = 'R5_STABILIZING';
  }
  const detectedRegime = diagnostics.rawRegime;
  const rawTrend = readStringField(macro, ['regime', 'rawTrend', 'trend']) ?? detectedRegime;
  const snapshotId = buildSnapshotId({
    asOf,
    mhs,
    biasScore,
    riskOverride,
    detectedRegime,
    effectiveRegime,
  });
  const staleness = resolveStaleness(macro, asOf, now, ttlSec, diagnostics);
  const displaySeverity = baseDisplaySeverity(effectiveRegime, riskOverride, mhsLabel);
  const chrome = resolveDisplayChrome(effectiveRegime, displaySeverity);
  const execution = resolveExecution({ effectiveRegime, riskOverride });
  const snapshot = applyConflictRules({
    snapshotId,
    asOf,
    ttlSec,
    biasScore,
    biasLabel,
    mhs,
    mhsLabel,
    rawMhs: mhs,
    rawMhsLabel: mhsLabel,
    mhsDisplayLabel: mhsLabel,
    detectedRegime,
    rawTrend,
    riskOverride,
    effectiveRegime,
    ...execution,
    displayRegime: effectiveRegime,
    displaySeverity,
    ...chrome,
    displayLabel: `${chrome.displayEmoji} ${chrome.displayTitle}`,
    reasonCodes: buildReasonCodes(diagnostics, riskOverride, biasLabel, mhsLabel),
    ...staleness,
    r6Latch: diagnostics.r6ShockLatch || diagnostics.transitionState.r6ShockLatchDetail ? {
      active: diagnostics.r6ShockLatch,
      triggerType: diagnostics.transitionState.r6ShockLatchDetail?.triggerType ?? diagnostics.transitionState.r6ShockLatchReason,
      triggeredAt: diagnostics.transitionState.r6ShockLatchDetail?.triggeredAt ?? diagnostics.transitionState.latchTriggeredAt,
      expiresAt: diagnostics.transitionState.r6ShockLatchDetail?.expiresAt ?? diagnostics.transitionState.latchExpiresAt,
      severity: diagnostics.transitionState.r6ShockLatchDetail?.severity ?? diagnostics.transitionState.latchTriggerValue,
      decayLevel: diagnostics.transitionState.r6ShockLatchDetail?.decayLevel ?? diagnostics.transitionState.latchDecayPercent ?? 0,
      decayBlockedReason: resolveR6LatchDecayBlockedReason(diagnostics, staleness.macroState, now),
      releaseEligibleAt: diagnostics.transitionState.r6ShockLatchDetail?.releaseEligibleAt ?? diagnostics.transitionState.latchReleaseEligibleAt,
      activeTriggers: diagnostics.activeR6Triggers,
      previousTriggers: diagnostics.previousR6Triggers,
    } : undefined,
  });

  logSnapshot(snapshot);
  return snapshot;
}

export const RegimeResolver = {
  resolveMarketState,
};


function resolveR6LatchDecayBlockedReason(
  diagnostics: RegimeDiagnostics,
  macroState: MacroStateStaleness,
  now: Date,
): string | undefined {
  const transition = diagnostics.transitionState;
  const decay = transition.latchDecayPercent ?? diagnostics.transitionState.r6ShockLatchDetail?.decayLevel ?? 0;
  if (decay > 0 || !transition.r6ShockLatch) return undefined;
  if (macroState.freshness === 'HARD_STALE' || macroState.freshness === 'MISSING') return `MACRO_STATE_${macroState.freshness}`;
  if (diagnostics.activeR6Triggers.includes('KOSPI_INTRADAY_LOW_SHOCK')) return 'ADDITIONAL_LOW_RETEST';
  if (diagnostics.activeR6Triggers.length > 0) return 'ACTIVE_R6_TRIGGER_PRESENT';
  const releaseAt = transition.latchReleaseEligibleAt ? Date.parse(transition.latchReleaseEligibleAt) : NaN;
  if (Number.isFinite(releaseAt) && releaseAt > now.getTime()) return 'RELEASE_ELIGIBLE_NOT_REACHED';
  if (diagnostics.recoveryBlockedReason === 'R6_COOLDOWN_ACTIVE' || diagnostics.r6RecoveryStatus === 'COOLDOWN') return 'COOLDOWN_ACTIVE';
  return diagnostics.recoveryBlockedReason ?? 'RELEASE_ELIGIBLE_NOT_REACHED';
}

function summarizeReasonCodes(reasonCodes: string[]): string {
  const priority = [
    'R6_SHOCK_LATCH',
    'ACTIVE_R6_TRIGGER_PRESENT',
    'KOSPI_CLOSE_SHOCK',
    'KOSPI_INTRADAY_LOW_SHOCK',
    'BIAS_BEAR',
    'MHS_GREEN_BIAS_BEAR_DIVERGENCE',
    'STALE_DATA_BLOCKED',
  ];
  const labels: Record<string, string> = {
    R6_SHOCK_LATCH: 'KOSPI 급락 latch',
    ACTIVE_R6_TRIGGER_PRESENT: 'R6 trigger 활성',
    KOSPI_CLOSE_SHOCK: 'KOSPI 종가 급락',
    KOSPI_INTRADAY_LOW_SHOCK: 'KOSPI 장중 저점 충격',
    BIAS_BEAR: 'Bias 약세',
    MHS_GREEN_BIAS_BEAR_DIVERGENCE: 'MHS/Bias 괴리',
    STALE_DATA_BLOCKED: 'macroState stale',
  };
  const picked = priority.filter((code) => reasonCodes.includes(code)).slice(0, 3);
  const fallback = reasonCodes.filter((code) => code !== 'NONE').slice(0, 3 - picked.length);
  return [...picked, ...fallback].map((code) => labels[code] ?? code).join(', ') || '특이사항 없음';
}

function formatShadowActivityLine(activity: ShadowActivitySnapshot | undefined): string {
  if (!activity) return 'Shadow candidate scan: NOT_RUN\ntrigger: SCHEDULED\nlastCandidateScanAt: N/A\ncandidateEvaluated: 0\nbuyCandidates: 0\nskipReason: SCHEDULER_NOT_TRIGGERED';
  const inferredStatus = activity.candidateScanStatus ?? (activity.lastScanAt ? 'RAN' : activity.evaluatedCount > 0 ? 'RAN' : 'NOT_RUN');
  const trigger = activity.candidateScanTrigger ?? 'SCHEDULED';
  const last = activity.lastScanAt ? activity.lastScanAt : 'N/A';
  const skipReason = activity.candidateSkipReason ?? activity.lastBlockReason ?? (activity.evaluatedCount === 0 ? 'SCHEDULER_NOT_TRIGGERED' : undefined);
  return [
    `Shadow position management: ${activity.scanAllowed ? 'ON' : 'OFF'} / SELL 체크 ${activity.sellCheckCount}건`,
    `Shadow candidate scan: ${inferredStatus}`,
    `trigger: ${trigger}`,
    `lastCandidateScanAt: ${last}`,
    `candidateEvaluated: ${activity.evaluatedCount}`,
    ...(activity.accumulatingCandidates !== undefined ? [`accumulatingCandidates: ${activity.accumulatingCandidates}`] : []),
    `buyCandidates: ${activity.buySignalCount}`,
    ...(activity.r6CounterfactualEntries !== undefined ? [`r6CounterfactualEntries: ${activity.r6CounterfactualEntries}`] : []),
    ...(activity.noShadowEntryReason !== undefined ? [`noShadowEntryReason: ${activity.noShadowEntryReason}`] : []),
    ...(activity.evaluatedCount === 0 || inferredStatus !== 'RAN' ? [`skipReason: ${skipReason ?? 'SCHEDULER_NOT_TRIGGERED'}`] : []),
    `paperFillCount: ${activity.paperFillCount}`,
    `openShadowPositions: ${activity.openShadowPositions}`,
  ].join('\n');
}


function kstDateParts(iso: string): { dateKey: string; hour: string; minute: string } | undefined {
  const ms = Date.parse(iso);
  if (!Number.isFinite(ms)) return undefined;
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Seoul',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
  }).formatToParts(new Date(ms));
  const get = (type: string) => parts.find((part) => part.type === type)?.value;
  const year = get('year');
  const month = get('month');
  const day = get('day');
  const hour = get('hour');
  const minute = get('minute');
  if (!year || !month || !day || !hour || !minute) return undefined;
  return { dateKey: `${year}-${month}-${day}`, hour, minute };
}

function formatKstTime(iso: string | undefined, baseIso: string): string {
  if (!iso) return 'N/A';
  const parts = kstDateParts(iso);
  if (!parts) return iso;
  const base = kstDateParts(baseIso);
  const dayPrefix = base && parts.dateKey > base.dateKey ? 'next day ' : '';
  return `${dayPrefix}${parts.hour}:${parts.minute} KST`;
}

function formatTriggerList(triggers: string[] | undefined): string {
  return triggers && triggers.length > 0 ? triggers.join(',') : 'none';
}

function legacyOpsTitle(snapshot: MarketStateSnapshot): string {
  if (snapshot.riskOverride === 'MANUAL_KILL_SWITCH') return '🔴 STOP';
  if (snapshot.riskOverride === 'CIRCUIT_BREAKER') return '🔴 BLOCK';
  if (snapshot.effectiveRegime === 'R6_PANIC' || snapshot.effectiveRegime === 'R6_DEFENSE' || snapshot.effectiveRegime === 'R6_CONFIRMATION_WAIT' || snapshot.effectiveRegime === 'R6_RECOVERY_WATCH') return '🟡 HOLD';
  if (!snapshot.liveNewBuyAllowed && snapshot.executionMode === 'DEGRADED') return '🟡 PAUSE';
  return '🟢 OK';
}

export function formatMarketStateNow(
  snapshot: MarketStateSnapshot,
  context: MarketStateNowContext = {},
): string {
  const lines: string[] = [
    legacyOpsTitle(snapshot),
    `${snapshot.displayEmoji} ${snapshot.displayTitle}`,
    '',
    `MHS: ${snapshot.mhs.toFixed(0)} ${snapshot.mhsDisplayLabel} / Bias: ${snapshot.biasLabel} ${snapshot.biasScore.toFixed(1)}`,
    `MHS ${snapshot.mhs.toFixed(0)} | 활성 ${context.activePositions ?? 0}/${context.maxPositions ?? 'N/A'} | 마지막 신호 ${context.lastSignalLabel ?? 'N/A'}`,
    `Final action: ${snapshot.liveNewBuyAllowed ? 'BUY_ALLOWED' : 'HOLD / Live Buy Blocked'}`,
    `Raw trend: ${snapshot.mhsDisplayLabel === 'OVERRIDDEN_BY_R6' ? 'macro_green_overridden_by_R6_DEFENSE' : snapshot.rawTrend}`,
    `Effective state: ${snapshot.effectiveRegime}`,
    `Live buy: ${snapshot.liveNewBuyAllowed ? 'ALLOWED' : 'BLOCKED'}`,
    `Shadow: ${snapshot.shadowScanAllowed ? 'ON' : 'OFF'}`,
    `최종 판단: ${snapshot.riskOverride !== 'NONE' ? 'Risk Override 우선' : snapshot.effectiveRegime}`,
    `사유: ${summarizeReasonCodes(snapshot.reasonCodes)}`,
    `실거래 신규 매수: ${snapshot.liveNewBuyAllowed ? '허용' : '차단'}`,
    `기존 포지션 관리: ${snapshot.positionManagementAllowed ? '허용' : '차단'}`,
    `Shadow 학습: ${snapshot.shadowLearningAllowed ? 'ON' : 'OFF'}`,
    `Shadow policy: ${snapshot.shadowScanAllowed ? 'ON' : 'OFF'}`,
    `Shadow paper fill policy: ${snapshot.shadowPaperFillAllowed ? 'ON' : 'OFF'}`,
    '',
    ...(snapshot.r6Latch ? [
      ...(snapshot.effectiveRegime === 'R6_CONFIRMATION_WAIT' ? [
        '상태: 급락 shock 이후 종가/다음 거래일 확인 대기',
      ] : []),
      ...((snapshot.macroState.freshness === 'POST_CLOSE_VALID' || snapshot.macroState.freshness === 'EOD_SNAPSHOT_VALID') ? [
        '상태: 장후 snapshot 유효 / 다음 거래일 확인 대기',
      ] : []),
      ...(snapshot.macroState.freshness === 'HARD_STALE' ? [
        'MHS는 회복권이나 Macro snapshot이 HARD_STALE이라 R6 해제를 보류합니다.',
      ] : []),
      'R6 latch:',
      `activeR6Triggers: ${formatTriggerList(snapshot.r6Latch.activeTriggers)}`,
      `previousR6Triggers: ${formatTriggerList(snapshot.r6Latch.previousTriggers)}`,
      `trigger: ${snapshot.r6Latch.triggerType ?? 'N/A'}`,
      `decay: ${snapshot.r6Latch.decayLevel}%`,
      ...(snapshot.r6Latch.decayLevel === 0 ? [`decayBlockedReason: ${snapshot.r6Latch.decayBlockedReason ?? 'N/A'}`] : []),
      `releaseEligibleAt: ${formatKstTime(snapshot.r6Latch.releaseEligibleAt, snapshot.asOf)}`,
      `expiresAt: ${formatKstTime(snapshot.r6Latch.expiresAt, snapshot.asOf)}`,
      ...(snapshot.effectiveRegime === 'R6_CONFIRMATION_WAIT' ? [
        '다음 조건: 추가 저점 이탈 없음 + 종가 안정 + macro fresh',
      ] : []),
      '',
    ] : []),
    'Shadow:',
    formatShadowActivityLine(context.shadowActivity),
    'macroState:',
    `- freshness: ${snapshot.macroState.freshness}`,
    `- ageSec: ${snapshot.macroState.ageSec ?? 'N/A'}`,
    `- ttlSec: ${snapshot.macroState.ttlSec}`,
    `- softStaleSec: ${snapshot.macroState.softStaleSec}`,
    `- hardStaleSec: ${snapshot.macroState.hardStaleSec}`,
    `- updatedAt: ${snapshot.macroState.updatedAt ?? 'N/A'}`,
    `- lastRefreshAttemptAt: ${snapshot.macroState.lastRefreshAttemptAt ?? 'N/A'}`,
    `- lastRefreshSuccessAt: ${snapshot.macroState.lastRefreshSuccessAt ?? 'N/A'}`,
    `- lastRefreshError: ${snapshot.macroState.lastRefreshError ?? 'N/A'}`,
    `- refreshJobEnabled: ${snapshot.macroState.refreshJobEnabled ?? 'N/A'}`,
    `- refreshJobLastRunAt: ${snapshot.macroState.refreshJobLastRunAt ?? 'N/A'}`,
    `- refreshBlockedReason: ${snapshot.macroState.refreshBlockedReason ?? 'NONE'}`,
    `- providerUsed: ${snapshot.macroState.providerUsed ?? 'N/A'}`,
    `- fallbackUsed: ${snapshot.macroState.fallbackUsed ?? 'N/A'}`,
    `- writeSucceeded: ${snapshot.macroState.writeSucceeded ?? 'N/A'}`,
    `- updatedAtChanged: ${snapshot.macroState.updatedAtChanged ?? 'N/A'}`,
    ...(snapshot.macroState.freshness === 'HARD_STALE' ? [
      '⚠️ Macro snapshot HARD_STALE',
      `마지막 갱신: ${snapshot.macroState.updatedAt ?? 'N/A'}`,
      `경과: ${snapshot.macroState.ageSec ?? 'N/A'}초`,
      `MHS는 ${snapshot.mhs.toFixed(0)}으로 회복권이나 Macro snapshot이 오래되어 R6 해제는 보류됩니다.`,
      '분류: Provider freshness issue / Market bearish signal 아님',
      `executionImpact=${snapshot.macroState.executionImpact}`,
      `releaseBlockedReason=${snapshot.macroState.freshness === 'HARD_STALE' ? 'MACRO_HARD_STALE' : 'NONE'}`,
    ] : []),
  ];

  if (snapshot.macroState.lastRefreshError) lines.push(`macroState error: ${snapshot.macroState.lastRefreshError}`);
  return lines.join('\n');
}
