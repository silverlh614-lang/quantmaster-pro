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
export type EffectiveMarketRegime = RegimeLevel | 'R6_RECOVERY_WATCH';
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
  riskOverride: RiskOverride;
  effectiveRegime: EffectiveMarketRegime;

  liveNewBuyAllowed: boolean;
  liveSellAllowed: boolean;
  shadowLearningAllowed: boolean;
  executionMode: MarketStateExecutionMode;

  displaySeverity: DisplaySeverity;
  displayTitle: string;
  displayEmoji: string;
  reasonCodes: string[];

  stale: boolean;
  staleSources: string[];
}

export interface MarketStateNowContext {
  activePositions?: number;
  maxPositions?: number;
  lastSignalLabel?: string;
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
  let effective: EffectiveMarketRegime = diagnostics.effectiveRegime;
  const recoveryActive =
    diagnostics.r6RecoveryStatus === 'COOLDOWN' ||
    diagnostics.r6RecoveryStatus === 'RECOVERY_CANDIDATE' ||
    diagnostics.r6RecoveryStatus === 'STALE_DATA_BLOCKED';
  if (recoveryActive && diagnostics.effectiveRegime !== 'R6_DEFENSE') {
    effective = 'R6_RECOVERY_WATCH';
  }

  const hardOverride =
    riskOverride === 'BLACK_SWAN' ||
    riskOverride === 'CIRCUIT_BREAKER' ||
    riskOverride === 'KOSPI_CRASH';
  if (hardOverride && effective !== 'R6_DEFENSE' && effective !== 'R6_RECOVERY_WATCH') {
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
}): Pick<MarketStateSnapshot, 'liveNewBuyAllowed' | 'liveSellAllowed' | 'shadowLearningAllowed' | 'executionMode'> {
  const baseMode = getExecutionMode();
  const emergency = getEmergencyStop();
  const dataBlocked = getDataIntegrityBlocked();
  const paused = getAutoTradePaused();
  const manualBlock = getManualBlockNewBuy() || getManualManageOnly();
  const inR6 = snapshot.effectiveRegime === 'R6_DEFENSE' || snapshot.effectiveRegime === 'R6_RECOVERY_WATCH';

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
    shadowLearningAllowed: true,
    executionMode,
  };
}

function baseDisplaySeverity(
  effectiveRegime: EffectiveMarketRegime,
  riskOverride: RiskOverride,
  mhsLabel: MhsLabel,
): DisplaySeverity {
  if (riskOverride === 'MANUAL_KILL_SWITCH') return 'PANIC';
  if (effectiveRegime === 'R6_DEFENSE') return riskOverride === 'BLACK_SWAN' || riskOverride === 'KOSPI_CRASH' ? 'PANIC' : 'DEFENSE';
  if (effectiveRegime === 'R6_RECOVERY_WATCH') return 'DEFENSE';
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
  if (effectiveRegime === 'R6_DEFENSE') return { displayTitle: 'R6_DEFENSE', displayEmoji: '🔴' };
  if (effectiveRegime === 'R6_RECOVERY_WATCH') return { displayTitle: 'R6_RECOVERY_WATCH', displayEmoji: '🟠' };
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
  const raw = Number(process.env.MARKET_STATE_SNAPSHOT_TTL_SEC ?? DEFAULT_TTL_SEC);
  return Number.isFinite(raw) && raw > 0 ? Math.trunc(raw) : DEFAULT_TTL_SEC;
}

function resolveStaleness(asOf: string, now: Date, ttlSec: number, diagnostics: RegimeDiagnostics): { stale: boolean; staleSources: string[] } {
  const staleSources: string[] = [];
  const asOfMs = Date.parse(asOf);
  if (!Number.isFinite(asOfMs) || now.getTime() - asOfMs > ttlSec * 1000) staleSources.push('macroState');
  if (diagnostics.sourceFreshness !== 'FRESH') staleSources.push(`regimeSource:${diagnostics.sourceFreshness}`);
  if (diagnostics.r6TriggerBreakdown.triggerFreshness !== 'FRESH') {
    staleSources.push(`r6Trigger:${diagnostics.r6TriggerBreakdown.triggerFreshness}`);
  }
  return { stale: staleSources.length > 0, staleSources };
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
    `shadowLearningAllowed=${snapshot.shadowLearningAllowed} ` +
    `stale=${snapshot.stale} ` +
    `staleSources=${snapshot.staleSources.join(',') || 'none'}`,
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
  const effectiveRegime = resolveEffectiveRegime(diagnostics, riskOverride);
  const detectedRegime = diagnostics.rawRegime;
  const snapshotId = buildSnapshotId({
    asOf,
    mhs,
    biasScore,
    riskOverride,
    detectedRegime,
    effectiveRegime,
  });
  const staleness = resolveStaleness(asOf, now, ttlSec, diagnostics);
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
    riskOverride,
    effectiveRegime,
    ...execution,
    displaySeverity,
    ...chrome,
    reasonCodes: buildReasonCodes(diagnostics, riskOverride, biasLabel, mhsLabel),
    ...staleness,
  });

  logSnapshot(snapshot);
  return snapshot;
}

export const RegimeResolver = {
  resolveMarketState,
};

export function formatMarketStateNow(
  snapshot: MarketStateSnapshot,
  context: MarketStateNowContext = {},
): string {
  const lines: string[] = [
    `${snapshot.displayEmoji} ${snapshot.displayTitle}`,
    `snapshotId: ${snapshot.snapshotId}`,
    `asOf: ${snapshot.asOf}`,
    `MHS: ${snapshot.mhs.toFixed(0)} / ${snapshot.mhsLabel} | Bias: ${snapshot.biasLabel} ${snapshot.biasScore.toFixed(1)}`,
    `최종 레짐: ${snapshot.effectiveRegime} | 감지 레짐: ${snapshot.detectedRegime}`,
  ];

  if (snapshot.riskOverride !== 'NONE' && snapshot.mhsLabel === 'GREEN') {
    lines.push('해석: MHS는 양호하나 Risk Override 우선');
  } else if (snapshot.mhsLabel === 'GREEN' && snapshot.biasLabel === 'BEAR') {
    lines.push('해석: 건강도는 양호하나 단기 방향성은 약세');
  } else if (snapshot.biasLabel === 'BEAR') {
    lines.push('단기 방향성: BEAR');
  }

  lines.push(`사유: ${snapshot.reasonCodes.join(', ') || 'NONE'}`);
  lines.push(`실거래 신규 매수: ${snapshot.liveNewBuyAllowed ? '허용' : '차단'}`);
  lines.push(`기존 포지션 관리: ${snapshot.liveSellAllowed ? '허용' : '차단'}`);
  lines.push(`Shadow 학습: ${snapshot.shadowLearningAllowed ? 'ON' : 'OFF'}`);
  lines.push(`실행 모드: ${snapshot.executionMode}`);

  const activePositions = context.activePositions ?? 0;
  const maxPositions = context.maxPositions ?? Number(process.env.MAX_CONVICTION_POSITIONS ?? '8');
  const lastSignalLabel = context.lastSignalLabel ?? '없음';
  lines.push(`활성 ${activePositions}/${maxPositions} | 마지막 신호 ${lastSignalLabel}`);

  if (snapshot.stale) {
    lines.push(`데이터 stale: ${snapshot.staleSources.join(', ')}`);
  }

  return lines.join('\n');
}
