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

export type BiasLabel = 'BULL' | 'NEUTRAL' | 'BEAR';
export type MhsLabel = 'GREEN' | 'YELLOW' | 'RED';
export type RiskOverride =
  | 'NONE'
  | 'BLACK_SWAN'
  | 'CIRCUIT_BREAKER'
  | 'KOSPI_CRASH'
  | 'MANUAL_KILL_SWITCH';
export type EffectiveMarketRegime = RegimeLevel | 'R6_PANIC' | 'R6_RECOVERY_WATCH' | 'R5_STABILIZING' | 'R4_CAUTION' | 'R3_NORMAL';
export type MarketStateExecutionMode =
  | 'NORMAL'
  | 'DEGRADED'
  | 'SELL_ONLY'
  | 'SHADOW_ONLY'
  | 'OBSERVE_ONLY';
export type DisplaySeverity = 'OK' | 'CAUTION' | 'DEFENSE' | 'PANIC';

export interface MarketStateSnapshot {
  snapshotId: string;
  asOf: string;
  ttlSec: number;

  biasScore: number;
  biasLabel: BiasLabel;

  mhs: number;
  mhsLabel: MhsLabel;

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

  displaySeverity: DisplaySeverity;
  displayTitle: string;
  displayEmoji: string;
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
    releaseEligibleAt?: string;
  };
}

export type MacroStateFreshness = 'FRESH' | 'SOFT_STALE' | 'HARD_STALE';

export interface MacroStateStaleness {
  stale: boolean;
  freshness: MacroStateFreshness;
  lastUpdatedAt?: string;
  ageSec?: number;
  ttlSec: number;
  staleReason: string;
  lastRefreshError?: string;
  provider?: string;
  fallbackUsed?: boolean | string;
  executionImpact: 'LIVE_BUY_BLOCKED_RECOVERY_WATCH_ALLOWED' | 'REGIME_RELEASE_BLOCKED_ONLY' | 'NONE';
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
}

const DEFAULT_TTL_SEC = 300;

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

function resolveEffectiveRegime(
  diagnostics: RegimeDiagnostics,
  riskOverride: RiskOverride,
): EffectiveMarketRegime {
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
  if (hardOverride && !['R6_PANIC', 'R6_DEFENSE', 'R6_RECOVERY_WATCH'].includes(effective)) {
    console.warn(
      '[MARKET_STATE_CONFLICT] type=RISK_OVERRIDE_WITH_NON_R6 ' +
      `riskOverride=${riskOverride} effectiveRegime=${effective} action=FORCE_R6_DEFENSE`,
    );
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
  const inR6 = snapshot.effectiveRegime === 'R6_PANIC' || snapshot.effectiveRegime === 'R6_DEFENSE' || snapshot.effectiveRegime === 'R6_RECOVERY_WATCH' || snapshot.effectiveRegime === 'R5_STABILIZING';

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
  if (effectiveRegime === 'R6_RECOVERY_WATCH') return 'DEFENSE';
  if (effectiveRegime === 'R5_STABILIZING') return 'CAUTION';
  if (riskOverride !== 'NONE') return 'DEFENSE';
  if (mhsLabel === 'RED') return 'CAUTION';
  if (mhsLabel === 'YELLOW') return 'CAUTION';
  return 'OK';
}

function applyConflictRules(snapshot: MarketStateSnapshot): MarketStateSnapshot {
  const reasonCodes = new Set(snapshot.reasonCodes);
  let displaySeverity = snapshot.displaySeverity;

  if (snapshot.effectiveRegime === 'R6_DEFENSE' && displaySeverity === 'OK') {
    console.warn(
      '[MARKET_STATE_CONFLICT] type=GREEN_WITH_R6 action=FORCE_DEFENSE_DISPLAY ' +
      `snapshotId=${snapshot.snapshotId}`,
    );
    displaySeverity = 'DEFENSE';
    reasonCodes.add('GREEN_WITH_R6_FORCED_DEFENSE');
  }

  if (snapshot.riskOverride !== 'NONE' && snapshot.mhsLabel === 'GREEN') {
    console.warn(
      '[MHS_RISK_OVERRIDE_CONFLICT] action=RISK_OVERRIDE_PRIORITY ' +
      `snapshotId=${snapshot.snapshotId} riskOverride=${snapshot.riskOverride} mhs=${snapshot.mhs}`,
    );
    reasonCodes.add('MHS_GREEN_BUT_RISK_OVERRIDE_PRIORITY');
  }

  if (snapshot.biasLabel === 'BEAR' && displaySeverity === 'OK') {
    reasonCodes.add('SHORT_TERM_BIAS_BEAR');
  }

  const { displayTitle, displayEmoji } = resolveDisplayChrome(
    snapshot.effectiveRegime,
    displaySeverity,
  );

  return {
    ...snapshot,
    displaySeverity,
    displayTitle,
    displayEmoji,
    reasonCodes: Array.from(reasonCodes),
  };
}

function resolveDisplayChrome(
  effectiveRegime: EffectiveMarketRegime,
  severity: DisplaySeverity,
): Pick<MarketStateSnapshot, 'displayTitle' | 'displayEmoji'> {
  if (effectiveRegime === 'R6_PANIC') return { displayTitle: 'R6_PANIC', displayEmoji: '🔴' };
  if (effectiveRegime === 'R6_DEFENSE') return { displayTitle: 'R6_DEFENSE', displayEmoji: '🔴' };
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

function resolveSoftStaleSec(ttlSec: number): number {
  const raw = Number(process.env.R6_RECOVERY_SOFT_STALE_SEC ?? 900);
  return Number.isFinite(raw) && raw > 0 ? Math.max(ttlSec, Math.trunc(raw)) : Math.max(ttlSec, 900);
}

function classifyMacroStateFreshness(ageSec: number | undefined, hasValidAsOf: boolean, ttlSec: number): MacroStateFreshness {
  if (!hasValidAsOf) return 'HARD_STALE';
  if ((ageSec ?? Number.POSITIVE_INFINITY) <= ttlSec) return 'FRESH';
  if ((ageSec ?? Number.POSITIVE_INFINITY) <= resolveSoftStaleSec(ttlSec)) return 'SOFT_STALE';
  return 'HARD_STALE';
}

function buildMacroStateStaleness(macro: MacroState | null, asOf: string, now: Date, ttlSec: number, diagnostics: RegimeDiagnostics): MacroStateStaleness {
  const asOfMs = Date.parse(asOf);
  const ageSec = Number.isFinite(asOfMs) ? Math.max(0, Math.floor((now.getTime() - asOfMs) / 1000)) : undefined;
  const freshness = classifyMacroStateFreshness(ageSec, Number.isFinite(asOfMs) && !!macro, ttlSec);
  const stale = freshness !== 'FRESH' || diagnostics.sourceFreshness === 'HARD_STALE' || diagnostics.sourceFreshness === 'STALE' || diagnostics.sourceFreshness === 'MISSING';
  const staleReason = !macro ? 'MACRO_STATE_MISSING' : !Number.isFinite(asOfMs) ? 'LAST_UPDATED_AT_INVALID' : freshness !== 'FRESH' ? freshness : diagnostics.sourceFreshness !== 'FRESH' ? `REGIME_SOURCE_${diagnostics.sourceFreshness}` : 'NONE';
  const info: MacroStateStaleness = {
    stale,
    freshness,
    lastUpdatedAt: macro?.updatedAt,
    ageSec,
    ttlSec,
    staleReason,
    lastRefreshError: readStringField(macro, ['lastRefreshError', 'macroLastRefreshError', 'refreshError']),
    provider: readStringField(macro, ['provider', 'sourceProvider', 'source', 'refreshProvider']),
    fallbackUsed: readFallbackUsed(macro),
    executionImpact: freshness === 'SOFT_STALE' ? 'LIVE_BUY_BLOCKED_RECOVERY_WATCH_ALLOWED' : stale ? 'REGIME_RELEASE_BLOCKED_ONLY' : 'NONE',
  };
  console.warn(
    '[MACRO_STATE_STALENESS] ' +
    `stale=${info.stale} ` +
    `ageSec=${info.ageSec ?? 'N/A'} ` +
    `ttlSec=${info.ttlSec} ` +
    `staleReason=${info.staleReason} ` +
    `lastRefreshError=${info.lastRefreshError ?? 'N/A'} ` +
    `executionImpact=${info.executionImpact}`,
  );
  return info;
}

function resolveStaleness(macro: MacroState | null, asOf: string, now: Date, ttlSec: number, diagnostics: RegimeDiagnostics): { stale: boolean; staleSources: string[]; macroState: MacroStateStaleness } {
  const staleSources: string[] = [];
  const macroState = buildMacroStateStaleness(macro, asOf, now, ttlSec, diagnostics);
  if (macroState.stale) staleSources.push('macroState');
  if (diagnostics.sourceFreshness !== 'FRESH') staleSources.push(`regimeSource:${diagnostics.sourceFreshness}`);
  if (diagnostics.r6TriggerBreakdown.triggerFreshness !== 'FRESH') {
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
    `riskOverride=${snapshot.riskOverride} ` +
    `detectedRegime=${snapshot.detectedRegime} ` +
    `effectiveRegime=${snapshot.effectiveRegime} ` +
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
    detectedRegime,
    rawTrend,
    riskOverride,
    effectiveRegime,
    ...execution,
    displaySeverity,
    ...chrome,
    reasonCodes: buildReasonCodes(diagnostics, riskOverride, biasLabel, mhsLabel),
    ...staleness,
    r6Latch: diagnostics.r6ShockLatch || diagnostics.transitionState.r6ShockLatchDetail ? {
      active: diagnostics.r6ShockLatch,
      triggerType: diagnostics.transitionState.r6ShockLatchDetail?.triggerType ?? diagnostics.transitionState.r6ShockLatchReason,
      triggeredAt: diagnostics.transitionState.r6ShockLatchDetail?.triggeredAt ?? diagnostics.transitionState.latchTriggeredAt,
      expiresAt: diagnostics.transitionState.r6ShockLatchDetail?.expiresAt ?? diagnostics.transitionState.latchExpiresAt,
      severity: diagnostics.transitionState.r6ShockLatchDetail?.severity ?? diagnostics.transitionState.latchTriggerValue,
      decayLevel: diagnostics.transitionState.r6ShockLatchDetail?.decayLevel ?? diagnostics.transitionState.latchDecayPercent ?? 0,
      releaseEligibleAt: diagnostics.transitionState.r6ShockLatchDetail?.releaseEligibleAt ?? diagnostics.transitionState.latchReleaseEligibleAt,
    } : undefined,
  });

  logSnapshot(snapshot);
  return snapshot;
}

export const RegimeResolver = {
  resolveMarketState,
};

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
  if (!activity) return 'Shadow scan: 활동량 N/A';
  const status = activity.scanAllowed ? '정상' : '차단';
  const last = activity.lastScanAt ? activity.lastScanAt : '미실행';
  return `Shadow scan: ${status} / 마지막 ${last} / 후보 평가 ${activity.evaluatedCount}건 / BUY 후보 ${activity.buySignalCount}건 / SELL 체크 ${activity.sellCheckCount}건 / 가상 체결 ${activity.paperFillCount}건 / 보유 ${activity.openShadowPositions}건`;
}

function legacyOpsTitle(snapshot: MarketStateSnapshot): string {
  if (snapshot.riskOverride === 'MANUAL_KILL_SWITCH') return '🔴 STOP';
  if (snapshot.riskOverride === 'CIRCUIT_BREAKER') return '🔴 BLOCK';
  if (snapshot.effectiveRegime === 'R6_PANIC' || snapshot.effectiveRegime === 'R6_DEFENSE' || snapshot.effectiveRegime === 'R6_RECOVERY_WATCH') return '🟡 HOLD';
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
    `MHS: ${snapshot.mhs.toFixed(0)} ${snapshot.mhsLabel} / Bias: ${snapshot.biasLabel} ${snapshot.biasScore.toFixed(1)}`,
    `MHS ${snapshot.mhs.toFixed(0)} | 활성 ${context.activePositions ?? 0}/${context.maxPositions ?? 'N/A'} | 마지막 신호 ${context.lastSignalLabel ?? 'N/A'}`,
    `Final action: ${snapshot.liveNewBuyAllowed ? 'BUY_ALLOWED' : 'HOLD / Live Buy Blocked'}`,
    `Raw trend: ${snapshot.rawTrend}`,
    `Effective state: ${snapshot.effectiveRegime}`,
    `Live buy: ${snapshot.liveNewBuyAllowed ? 'ALLOWED' : 'BLOCKED'}`,
    `Shadow: ${snapshot.shadowScanAllowed ? 'ON' : 'OFF'}`,
    `최종 판단: ${snapshot.riskOverride !== 'NONE' ? 'Risk Override 우선' : snapshot.effectiveRegime}`,
    `사유: ${summarizeReasonCodes(snapshot.reasonCodes)}`,
    `실거래 신규 매수: ${snapshot.liveNewBuyAllowed ? '허용' : '차단'}`,
    `기존 포지션 관리: ${snapshot.positionManagementAllowed ? '허용' : '차단'}`,
    `Shadow 학습: ${snapshot.shadowLearningAllowed ? 'ON' : 'OFF'}`,
    `Shadow scan: ${snapshot.shadowScanAllowed ? 'ON' : 'OFF'} / paper fill: ${snapshot.shadowPaperFillAllowed ? 'ON' : 'OFF'}`,
    '',
    ...(snapshot.r6Latch ? [
      'R6 latch:',
      `trigger: ${snapshot.r6Latch.triggerType ?? 'N/A'}`,
      `decay: ${snapshot.r6Latch.decayLevel}%`,
      `releaseEligibleAt: ${snapshot.r6Latch.releaseEligibleAt ?? 'N/A'}`,
      '',
    ] : []),
    'Shadow:',
    formatShadowActivityLine(context.shadowActivity),
    `데이터 상태: macroState ${snapshot.macroState.freshness} (ageSec=${snapshot.macroState.ageSec ?? 'N/A'}, ttlSec=${snapshot.macroState.ttlSec}, reason=${snapshot.macroState.staleReason})`,
  ];

  if (snapshot.macroState.lastRefreshError) lines.push(`macroState error: ${snapshot.macroState.lastRefreshError}`);
  return lines.join('\n');
}

