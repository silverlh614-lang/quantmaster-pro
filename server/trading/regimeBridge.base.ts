// @responsibility regimeBridge 매매 엔진 모듈
/**
 * regimeBridge.ts — MacroState → RegimeVariables 변환 + 라이브 레짐 판정
 *
 * 역할: 서버 측 MacroState(지속적으로 축적되는 거시 지표)를
 *       프론트엔드 classifyRegime()이 요구하는 RegimeVariables 7축으로 매핑.
 *
 * 효과: backtestPortfolio()와 라이브 signalScanner가 동일한 classifyRegime()를
 *       공유 → 검증한 것과 실행하는 것이 일치하는 시스템.
 *
 * 레짐 전환 알림: 레짐이 변경되면 즉시 Telegram으로 구조화된 알림 발송.
 */

import type { RegimeVariables, RegimeLevel } from '../../src/types/core.js';
import { classifyRegime, REGIME_CONFIGS } from '../../src/services/quant/regimeEngine.js';
import type { MacroState } from '../persistence/macroStateRepo.js';
import { sendTelegramAlert } from '../alerts/telegramClient.js';
import { channelRegimeChange } from '../alerts/channelPipeline.js';
import { renderPlaybook } from '../alerts/regimePlaybook.js';
import { resetConditionWeightsForRegime } from '../persistence/conditionWeightsRepo.js';
import { isForcedRegimeDowngradeActive } from '../learning/learningState.js';
import {
  emptyR6RecoveryEvidence,
  emptyR6TriggerBreakdown,
  loadRegimeTransitionState,
  saveRegimeTransitionState,
  type RegimeTransitionState,
  type R6RecoveryEvidence,
  type R6TriggerBreakdown,
  type R6TriggerReason,
  type R6ShockLatch,
  type R6StateMachineState,
} from '../persistence/regimeTransitionStateRepo.js';

// ── 레짐 전환 감지용 모듈 상태 ──────────────────────────────────────────────

let _previousRegime: RegimeLevel | null = null;
let _previousMhs: number | null = null;
let _previousVkospi: number | null = null;

/**
 * MacroState → RegimeVariables
 * 누락 필드는 보수적 중립값으로 fallback — 판정을 보수적 방향으로 편향.
 */
export function buildRegimeVars(macroState: MacroState): RegimeVariables {
  return {
    // ① 변동성
    vkospi:          macroState.vkospi          ?? 20,
    vkospiDayChange: macroState.vkospiDayChange  ?? 0,
    // vkospi5dTrend: 직접 값 없으면 vkospiRising boolean을 방향 힌트로 대용
    vkospi5dTrend:   macroState.vkospi5dTrend   ??
      (macroState.vkospiRising === false ? -1 : macroState.vkospiRising === true ? 1 : 0),

    // ② 거시 (MHS·환율)
    mhsScore:        macroState.mhs              ?? 50,
    usdKrw:          macroState.usdKrw           ?? 1300,
    usdKrw20dChange: macroState.usdKrw20dChange  ?? 0,
    usdKrwDayChange: macroState.usdKrwDayChange  ?? 0,

    // ③ 수급
    foreignNetBuy5d:  macroState.foreignNetBuy5d  ?? 0,
    passiveActiveBoth: macroState.passiveActiveBoth ?? false,

    // ④ 지수 기술적
    kospiAbove20MA:  macroState.kospiAbove20MA   ?? true,
    kospiAbove60MA:  macroState.kospiAbove60MA   ?? true,
    kospi20dReturn:  macroState.kospi20dReturn   ?? 0,
    kospiDayReturn:  macroState.kospiDayReturn   ?? 0,

    // ⑤ 사이클
    leadingSectorRS:  macroState.leadingSectorRS  ?? 50,
    sectorCycleStage: macroState.sectorCycleStage ?? 'MID',

    // ⑥ 신용·심리
    marginBalance5dChange: macroState.marginBalance5dChange ?? 0,
    shortSellingRatio:     macroState.shortSellingRatio     ?? 5,

    // ⑦ 글로벌
    spx20dReturn: macroState.spx20dReturn ?? 0,
    vix:          macroState.vix          ?? 20,
    dxy5dChange:  macroState.dxy5dChange  ?? 0,

    // ⑧ 레짐 승급 보조
    kospiAboveMA20Pct:        macroState.kospiAboveMA20Pct,
    foreignContinuousBuyDays: macroState.foreignContinuousBuyDays,
  };
}

/** 레짐 순서 (방어 → 공격) — 다운그레이드/업그레이드 판단용 */
export const REGIME_ORDER: RegimeLevel[] = [
  'R6_DEFENSE', 'R5_CAUTION', 'R4_NEUTRAL', 'R3_EARLY', 'R2_BULL', 'R1_TURBO',
];

/**
 * MacroState → RegimeLevel
 * macroState가 null이면 R4_NEUTRAL 반환 (신호 스캔 일시 중단 없음, 보수적 운용).
 *
 * 아이디어 7 (Phase 4): isForcedRegimeDowngradeActive() 활성 시 raw 분류 결과를
 * REGIME_ORDER 상 한 단계 방어쪽으로 이동(예: R2_BULL → R3_EARLY).
 */
export interface RegimeDiagnostics {
  rawRegime: RegimeLevel;
  effectiveRegime: RegimeLevel;
  r6RecoveryStatus: RegimeTransitionState['r6RecoveryStatus'];
  cooldownUntil?: string;
  transitionReason: string;
  recoveryEvidence: R6RecoveryEvidence;
  transitionState: RegimeTransitionState;
  sourceFreshness: 'FRESH' | 'SOFT_STALE' | 'POST_CLOSE_VALID' | 'EOD_SNAPSHOT_VALID' | 'HARD_STALE' | 'STALE' | 'MISSING';
  r6TriggerBreakdown: R6TriggerBreakdown;
  activeR6Triggers: R6TriggerReason[];
  previousR6Triggers: R6TriggerReason[];
  r6ShockLatch: boolean;
  recoveryBlockedReason?: string;
}

function envInt(name: string, fallback: number): number {
  const value = Number(process.env[name]);
  return Number.isFinite(value) && value >= 0 ? Math.trunc(value) : fallback;
}

function maxImmediateRecoveryRegime(): RegimeLevel {
  return process.env.R6_RECOVERY_MAX_IMMEDIATE_REGIME === 'R4_NEUTRAL' ? 'R4_NEUTRAL' : 'R5_CAUTION';
}

function capRecoveryRegime(rawRegime: RegimeLevel): RegimeLevel {
  const rawIdx = REGIME_ORDER.indexOf(rawRegime);
  const capIdx = REGIME_ORDER.indexOf(maxImmediateRecoveryRegime());
  return REGIME_ORDER[Math.min(rawIdx, capIdx)] ?? 'R5_CAUTION';
}

function applyForcedDowngrade(regime: RegimeLevel): RegimeLevel {
  if (!isForcedRegimeDowngradeActive()) return regime;
  const idx = REGIME_ORDER.indexOf(regime);
  if (idx <= 0) return regime; // 이미 R6_DEFENSE — 더 내려갈 곳 없음
  return REGIME_ORDER[idx - 1] ?? regime;
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

function isPostCloseSession(macroState: MacroState | null, now: Date): boolean {
  const explicit = String((macroState as unknown as Record<string, unknown> | null)?.marketSessionState ?? '').toUpperCase();
  if (['POST_CLOSE', 'AFTER_MARKET', 'AFTER_HOURS', 'CLOSING_AUCTION', 'CLOSED'].includes(explicit)) return true;
  const minutes = kstMinutes(now);
  return minutes >= 15 * 60 + 20;
}

function isSameKstDate(updatedAtMs: number, now: Date): boolean {
  return kstDateKey(new Date(updatedAtMs)) === kstDateKey(now);
}

function macroFreshnessFromUpdatedAt(macroState: MacroState | null, updatedAt: string | undefined, now: Date): RegimeDiagnostics['sourceFreshness'] {
  if (!updatedAt) return 'MISSING';
  const updatedAtMs = Date.parse(updatedAt);
  if (!Number.isFinite(updatedAtMs)) return 'MISSING';
  const ageSec = Math.max(0, Math.floor((now.getTime() - updatedAtMs) / 1000));
  const ttlSec = envInt('MACRO_STATE_TTL_SEC', envInt('MARKET_STATE_SNAPSHOT_TTL_SEC', 300));
  const softStaleSec = Math.max(ttlSec, envInt('R6_RECOVERY_SOFT_STALE_SEC', 900));
  if (ageSec <= ttlSec) return 'FRESH';
  if (ageSec <= softStaleSec) return 'SOFT_STALE';
  if (macroState && isPostCloseSession(macroState, now) && isSameKstDate(updatedAtMs, now)) {
    return kstMinutes(now) >= 18 * 60 ? 'EOD_SNAPSHOT_VALID' : 'POST_CLOSE_VALID';
  }
  return 'HARD_STALE';
}

function sourceFreshness(macroState: MacroState | null, now: Date): RegimeDiagnostics['sourceFreshness'] {
  return macroFreshnessFromUpdatedAt(macroState, macroState?.updatedAt, now);
}

function isFreshEnoughForRecoveryWatch(freshness: RegimeDiagnostics['sourceFreshness']): boolean {
  return freshness === 'FRESH' || freshness === 'SOFT_STALE';
}

function isHardStaleForRecovery(freshness: RegimeDiagnostics['sourceFreshness']): boolean {
  return freshness === 'HARD_STALE' || freshness === 'STALE' || freshness === 'MISSING';
}


function finiteNumber(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isFinite(value) ? value : undefined;
}

function resolveVkospiRecoveryThreshold(macroState: MacroState | null): number {
  const base = Math.max(28, Number(process.env.R6_VKOSPI_RECOVERY_THRESHOLD_BASE ?? '28'));
  if (process.env.R6_VKOSPI_DYNAMIC_THRESHOLD_ENABLED !== 'true') return base;

  const vkospiDayChange = finiteNumber(macroState?.vkospiDayChange);
  const isVkospiFallingToday = vkospiDayChange !== undefined && vkospiDayChange < 0;
  if (!isVkospiFallingToday) return base;

  const trend5d = finiteNumber(macroState?.vkospi5dTrend);
  const rising = macroState?.vkospiRising;
  const isVkospiTrendDown = (trend5d !== undefined && trend5d < 0) || rising === false;
  if (!isVkospiTrendDown) return base;

  const mhs = macroState?.mhs ?? 0;
  const relaxed = Math.max(base, Number(process.env.R6_VKOSPI_THRESHOLD_RELAXED ?? '40'));
  const highMhs = Math.max(relaxed, Number(process.env.R6_VKOSPI_THRESHOLD_HIGH_MHS ?? '45'));
  const threshold = mhs >= 65 ? highMhs : relaxed;

  console.info(
    `[R6_VKOSPI_DYNAMIC_THRESHOLD] ` +
      `vkospiDayChange=${vkospiDayChange?.toFixed(1)} ` +
      `vkospi5dTrend=${trend5d ?? 'N/A'} ` +
      `vkospiRising=${rising ?? 'N/A'} ` +
      `mhs=${mhs} ` +
      `threshold=${threshold} (base=${base}) ` +
      `executionImpact=NONE`,
  );

  return threshold;
}

function triggerFreshness(macroState: MacroState | null, now: Date): R6TriggerBreakdown['triggerFreshness'] {
  return macroFreshnessFromUpdatedAt(macroState, macroState?.kospiTriggerSourceUpdatedAt ?? macroState?.updatedAt, now);
}

function buildR6TriggerBreakdown(macroState: MacroState | null, now: Date, previousState?: RegimeTransitionState): R6TriggerBreakdown {
  if (!macroState) return emptyR6TriggerBreakdown();
  const freshness = triggerFreshness(macroState, now);
  const kospiDayReturn = finiteNumber(macroState.kospiDayReturn);
  const kospiCloseReturn = finiteNumber(macroState.kospiCloseReturn) ?? kospiDayReturn;
  const kospiIntradayLowReturn = finiteNumber(macroState.kospiIntradayLowReturn);
  const kospiIntradayHighReturn = finiteNumber(macroState.kospiIntradayHighReturn);
  const vkospiDayChange =
    finiteNumber(macroState.vkospiDayChange) ??
    finiteNumber(macroState.vkospiDayChangeComputed) ??
    (macroState.vkospi != null && macroState.vkospiPrevClose != null && macroState.vkospiPrevClose > 0
      ? ((macroState.vkospi - macroState.vkospiPrevClose) / macroState.vkospiPrevClose) * 100
      : undefined);
  if (vkospiDayChange !== undefined && macroState.vkospiDayChange == null) {
    console.info(
      `[R6_VKOSPI_DAYCHANGE_FALLBACK] computed=${vkospiDayChange.toFixed(2)}% source=${macroState.vkospiDayChangeComputed != null ? 'SERVER_COMPUTED' : 'PREV_CLOSE_RATIO'} executionImpact=NONE`,
    );
  }
  const usdKrwDayChange = finiteNumber(macroState.usdKrwDayChange);
  const detected: R6TriggerReason[] = [];
  if (kospiIntradayLowReturn !== undefined && kospiIntradayLowReturn <= -5) detected.push('KOSPI_INTRADAY_LOW_SHOCK');
  if (kospiCloseReturn !== undefined && kospiCloseReturn <= -5) detected.push('KOSPI_CLOSE_SHOCK');
  if (vkospiDayChange !== undefined && vkospiDayChange > 30) detected.push('VKOSPI_DAY_SPIKE');
  if (usdKrwDayChange !== undefined && Math.abs(usdKrwDayChange) > 3) detected.push('USDKRW_DAY_SHOCK');
  const activeR6Triggers = freshness === 'FRESH' ? detected : [];
  const staleR6Triggers = freshness === 'FRESH' ? [] : detected;
  return { kospiDayReturn, kospiCloseReturn, kospiIntradayLowReturn, kospiIntradayHighReturn, vkospiDayChange, usdKrwDayChange, activeR6Triggers, staleR6Triggers, triggerSourceUpdatedAt: macroState.kospiTriggerSourceUpdatedAt ?? macroState.updatedAt, triggerFreshness: freshness, staleCarryForward: freshness !== 'FRESH' && (detected.length > 0 || previousState?.r6ShockLatch === true), staleBlockedRecovery: isHardStaleForRecovery(freshness) };
}

function closeRecoveryEligible(breakdown: R6TriggerBreakdown, macroState: MacroState | null): boolean {
  const vkospiThreshold = resolveVkospiRecoveryThreshold(macroState);
  return (breakdown.kospiCloseReturn ?? Number.NEGATIVE_INFINITY) > -2 && (macroState?.vkospi ?? Number.POSITIVE_INFINITY) <= vkospiThreshold && (breakdown.vkospiDayChange ?? Number.POSITIVE_INFINITY) <= 15 && Math.abs(breakdown.usdKrwDayChange ?? Number.POSITIVE_INFINITY) <= 1.5 && (macroState?.mhs ?? 0) >= 40 && isFreshEnoughForRecoveryWatch(breakdown.triggerFreshness);
}


function addMs(now: Date, ms: number): string {
  return new Date(now.getTime() + ms).toISOString();
}

function resolveLatchTtlMs(trigger: R6TriggerReason | undefined, triggerValue?: number | null): number {
  const intradayMs = envInt('R6_INTRADAY_LOW_LATCH_TTL_HOURS', 18) * 3_600_000;
  if (trigger === 'KOSPI_INTRADAY_LOW_SHOCK') return intradayMs;
  if (trigger === 'KOSPI_CLOSE_SHOCK') {
    const absVal = Math.abs(triggerValue ?? 0);
    if (absVal < 6.0) return envInt('R6_CLOSE_SHOCK_LATCH_TTL_HOURS_MILD', 18) * 3_600_000;
    if (absVal < 8.0) return envInt('R6_CLOSE_SHOCK_LATCH_TTL_HOURS', 24) * 3_600_000;
    return envInt('R6_CLOSE_SHOCK_LATCH_TTL_HOURS_SEVERE', 36) * 3_600_000;
  }
  return envInt('R6_GENERIC_LATCH_TTL_HOURS', 24) * 3_600_000;
}

function resolveLatchReleaseEligibleMs(trigger: R6TriggerReason | undefined): number {
  if (trigger === 'KOSPI_INTRADAY_LOW_SHOCK') return envInt('R6_INTRADAY_LOW_RELEASE_ELIGIBLE_HOURS', 3) * 3_600_000;
  return envInt('R6_LATCH_RELEASE_ELIGIBLE_HOURS', 6) * 3_600_000;
}

function isLatchExpired(previousState: RegimeTransitionState, now: Date): boolean {
  if (!previousState.r6ShockLatch) return true;
  const expiresAt = previousState.latchExpiresAt ? Date.parse(previousState.latchExpiresAt) : NaN;
  return Number.isFinite(expiresAt) && expiresAt <= now.getTime();
}

function latchDecayLevel(previousState: RegimeTransitionState, closeEligible: boolean, now: Date): NonNullable<RegimeTransitionState['latchDecayLevel']> {
  if (!previousState.r6ShockLatch) return 'NONE';
  if (isLatchExpired(previousState, now)) return 'EXPIRED';
  const releaseAt = previousState.latchReleaseEligibleAt ? Date.parse(previousState.latchReleaseEligibleAt) : NaN;
  if (closeEligible && Number.isFinite(releaseAt) && releaseAt <= now.getTime()) return 'DECAYING';
  return 'WATCH';
}

function latchDecayPercent(
  previousState: RegimeTransitionState,
  closeEligible: boolean,
  now: Date,
  recoveryContext?: { triggerBreakdown: R6TriggerBreakdown; macroState: MacroState | null; biasScore: number },
): number {
  if (!previousState.r6ShockLatch) return 0;
  const triggeredAt = previousState.latchTriggeredAt ? Date.parse(previousState.latchTriggeredAt) : NaN;
  const expiresAt = previousState.latchExpiresAt ? Date.parse(previousState.latchExpiresAt) : NaN;
  let baseDecay: number;
  if (!Number.isFinite(triggeredAt) || !Number.isFinite(expiresAt) || expiresAt <= triggeredAt) {
    baseDecay = closeEligible ? 60 : 0;
  } else {
    const elapsed = Math.max(0, now.getTime() - triggeredAt);
    const ttl = Math.max(1, expiresAt - triggeredAt);
    const timeDecay = Math.round(Math.min(100, (elapsed / ttl) * 100));
    const releaseAt = previousState.latchReleaseEligibleAt ? Date.parse(previousState.latchReleaseEligibleAt) : NaN;
    const eligibilityBonus = closeEligible && Number.isFinite(releaseAt) && releaseAt <= now.getTime() ? 60 : 0;
    baseDecay = Math.min(100, Math.max(timeDecay, eligibilityBonus));
  }

  const contextualFloor = recoveryContext &&
    recoveryContext.triggerBreakdown.triggerFreshness === 'FRESH' &&
    (recoveryContext.macroState?.mhs ?? 0) >= 65 &&
    recoveryContext.biasScore >= 0 &&
    recoveryContext.triggerBreakdown.activeR6Triggers.length === 0
      ? closeEligible ? 60 : 30
      : 0;

  const strongReboundEnabled = process.env.R6_STRONG_REBOUND_DECAY_ENABLED === 'true';
  const strongReboundThreshold = Number(process.env.R6_STRONG_REBOUND_THRESHOLD_PCT ?? '3.0');
  const strongReboundFloor = Number(process.env.R6_STRONG_REBOUND_DECAY_FLOOR ?? '70');

  const strongReboundBoost = strongReboundEnabled &&
    recoveryContext !== undefined &&
    recoveryContext.triggerBreakdown.triggerFreshness === 'FRESH' &&
    recoveryContext.triggerBreakdown.activeR6Triggers.length === 0 &&
    (recoveryContext.macroState?.mhs ?? 0) >= 60 &&
    ((recoveryContext.macroState?.kospiDayReturn ?? 0) >= strongReboundThreshold ||
      (recoveryContext.triggerBreakdown.kospiIntradayHighReturn ?? 0) >= strongReboundThreshold)
      ? strongReboundFloor
      : 0;

  if (strongReboundBoost > 0) {
    console.info(
      `[R6_STRONG_REBOUND_DECAY_BOOST] ` +
      `kospiDayReturn=${recoveryContext?.macroState?.kospiDayReturn ?? 'N/A'} ` +
      `threshold=${strongReboundThreshold} ` +
      `decayBoostedTo=${strongReboundFloor} ` +
      `mhs=${recoveryContext?.macroState?.mhs ?? 'N/A'} ` +
      'executionImpact=NONE',
    );
  }

  return Math.max(previousState.latchDecayPercent ?? 0, baseDecay, contextualFloor, strongReboundBoost);
}

function buildR6ShockLatchDetail(args: {
  previousState: RegimeTransitionState;
  activeShockTrigger?: R6TriggerReason;
  now: Date;
  expiresAt?: string;
  releaseEligibleAt?: string;
  triggerBreakdown: R6TriggerBreakdown;
  decayPercent: number;
  active: boolean;
  lastExtensionReason?: string;
}): R6ShockLatch | undefined {
  const triggerType = args.activeShockTrigger ?? args.previousState.r6ShockLatchReason;
  const triggeredAt = args.activeShockTrigger ? args.now.toISOString() : args.previousState.latchTriggeredAt;
  const expiresAt = args.expiresAt ?? args.previousState.latchExpiresAt;
  const releaseEligibleAt = args.releaseEligibleAt ?? args.previousState.latchReleaseEligibleAt;
  if (!triggerType || !triggeredAt || !expiresAt || !releaseEligibleAt) return undefined;
  const severity = args.activeShockTrigger === 'KOSPI_CLOSE_SHOCK'
    ? Math.abs(args.triggerBreakdown.kospiCloseReturn ?? 0)
    : args.activeShockTrigger === 'KOSPI_INTRADAY_LOW_SHOCK'
      ? Math.abs(args.triggerBreakdown.kospiIntradayLowReturn ?? 0)
      : Math.abs(args.previousState.latchTriggerValue ?? 0);
  return {
    active: args.active,
    triggerType,
    triggeredAt,
    expiresAt,
    severity,
    decayLevel: args.decayPercent,
    releaseEligibleAt,
    lastExtensionReason: args.lastExtensionReason,
  };
}

function recoveryWatchEligible(evidence: R6RecoveryEvidence, previousState: RegimeTransitionState, now: Date, triggerFreshnessValue: R6TriggerBreakdown['triggerFreshness']): boolean {
  const releaseAt = previousState.latchReleaseEligibleAt ? Date.parse(previousState.latchReleaseEligibleAt) : NaN;
  return isFreshEnoughForRecoveryWatch(triggerFreshnessValue) &&
    evidence.mhsScoreOk &&
    evidence.kospiDayReturnOk &&
    evidence.vkospiDayChangeOk &&
    (!previousState.r6ShockLatch || (Number.isFinite(releaseAt) && releaseAt <= now.getTime()));
}

function resolveRecoveredStateMachine(rawRegime: RegimeLevel, macroState: MacroState | null): R6StateMachineState {
  const mhs = macroState?.mhs ?? 0;
  if (mhs >= 70 && (rawRegime === 'R1_TURBO' || rawRegime === 'R2_BULL' || rawRegime === 'R3_EARLY')) return 'R3_NORMAL';
  if (mhs >= 65) return 'R4_CAUTION';
  return 'R5_STABILIZING';
}


function resolveRecoveryBiasScore(macroState: MacroState | null): number {
  if (!macroState) return -100;
  const record = macroState as unknown as Record<string, unknown>;
  for (const key of ['biasScore', 'directionBiasScore', 'preMarketBiasScore', 'marketBiasScore', 'globalBiasScore', 'riskBiasScore', 'bias']) {
    const value = record[key];
    if (typeof value === 'number' && Number.isFinite(value)) return Math.max(-100, Math.min(100, value));
  }
  const kospiDay = finiteNumber(macroState.kospiDayReturn) ?? 0;
  const kospi20d = finiteNumber(macroState.kospi20dReturn) ?? 0;
  const spx20d = finiteNumber(macroState.spx20dReturn) ?? 0;
  const foreign5d = finiteNumber(macroState.foreignNetBuy5d) ?? 0;
  const vkospiDay = finiteNumber(macroState.vkospiDayChange) ?? 0;
  const usdKrwDay = finiteNumber(macroState.usdKrwDayChange) ?? 0;
  const dxy5d = finiteNumber(macroState.dxy5dChange) ?? 0;
  const vix = finiteNumber(macroState.vix) ?? 20;
  const derived = kospiDay * 12 + kospi20d * 2 + spx20d * 2 + Math.max(-10, Math.min(10, foreign5d / 2500)) - vkospiDay * 1.2 - usdKrwDay * 6 - dxy5d * 2 - Math.max(0, vix - 20) * 1.5;
  return Math.round(Math.max(-100, Math.min(100, derived)) * 10) / 10;
}

function reasonForActiveR6Trigger(trigger: R6TriggerReason | undefined): string {
  if (trigger === 'KOSPI_INTRADAY_LOW_SHOCK') return 'RAW_R6_ACTIVE_BY_KOSPI_INTRADAY_LOW_SHOCK';
  if (trigger === 'KOSPI_CLOSE_SHOCK') return 'RAW_R6_ACTIVE_BY_KOSPI_CLOSE_RETURN';
  if (trigger === 'VKOSPI_DAY_SPIKE') return 'RAW_R6_ACTIVE_BY_VKOSPI_DAY_CHANGE';
  if (trigger === 'USDKRW_DAY_SHOCK') return 'RAW_R6_ACTIVE_BY_USDKRW_DAY_CHANGE';
  if (trigger === 'CIRCUIT_BREAKER') return 'RAW_R6_ACTIVE_BY_CIRCUIT_BREAKER';
  if (trigger === 'BLACK_SWAN') return 'RAW_R6_ACTIVE_BY_BLACK_SWAN';
  if (trigger === 'MANUAL_KILL_SWITCH') return 'RAW_R6_ACTIVE_BY_MANUAL_KILL_SWITCH';
  return 'RAW_R6_DEFENSE_CONDITION_ACTIVE';
}

function recoveryBlockedReason(breakdown: R6TriggerBreakdown, previousState: RegimeTransitionState, macroState: MacroState | null, cooldownUntil?: string, now: Date = new Date()): string | undefined {
  if (isHardStaleForRecovery(breakdown.triggerFreshness)) return 'STALE_DATA_BLOCKED';
  if (breakdown.triggerFreshness === 'POST_CLOSE_VALID' || breakdown.triggerFreshness === 'EOD_SNAPSHOT_VALID') return 'WAITING_NEXT_TRADING_DAY_CONFIRMATION';
  if (breakdown.activeR6Triggers.length > 0) return 'ACTIVE_R6_TRIGGER_PRESENT';
  if (previousState.r6ShockLatch && !closeRecoveryEligible(breakdown, macroState)) return 'WAITING_FOR_CLOSE_OR_NEXT_TRADING_DAY_CONFIRMATION';
  if (cooldownUntil && Date.parse(cooldownUntil) > now.getTime()) return 'R6_COOLDOWN_ACTIVE';
  return undefined;
}

function buildR6RecoveryEvidence(
  macroState: MacroState | null,
  now: Date,
  requiredConfirmations: number,
  confirmations: number,
): R6RecoveryEvidence {
  const freshness = sourceFreshness(macroState, now);
  const vkospiThreshold = resolveVkospiRecoveryThreshold(macroState);
  const vkospiDayChange =
    macroState?.vkospiDayChange ??
    macroState?.vkospiDayChangeComputed ??
    (macroState?.vkospi != null && macroState?.vkospiPrevClose != null && macroState.vkospiPrevClose > 0
      ? ((macroState.vkospi - macroState.vkospiPrevClose) / macroState.vkospiPrevClose) * 100
      : Number.POSITIVE_INFINITY);
  const evidence: R6RecoveryEvidence = {
    vkospiDayChangeOk: vkospiDayChange <= 15,
    usdKrwDayChangeOk: Math.abs(macroState?.usdKrwDayChange ?? Number.POSITIVE_INFINITY) <= 1.5,
    kospiDayReturnOk: ((macroState?.kospiCloseReturn ?? macroState?.kospiDayReturn) ?? Number.NEGATIVE_INFINITY) > -2,
    mhsScoreOk: (macroState?.mhs ?? 0) >= 40,
    vkospiOk: (macroState?.vkospi ?? Number.POSITIVE_INFINITY) <= vkospiThreshold,
    vkospiThresholdApplied: vkospiThreshold,
    marketDataFreshnessOk: isFreshEnoughForRecoveryWatch(freshness),
    confirmations,
    requiredConfirmations,
    reasons: [],
    checkedAt: now.toISOString(),
  };
  if (!evidence.vkospiDayChangeOk) evidence.reasons.push('VKOSPI_DAY_CHANGE_NOT_STABLE');
  if (!evidence.usdKrwDayChangeOk) evidence.reasons.push('USD_KRW_DAY_CHANGE_NOT_STABLE');
  if (!evidence.kospiDayReturnOk) evidence.reasons.push('KOSPI_DAY_RETURN_NOT_STABLE');
  if (!evidence.mhsScoreOk) evidence.reasons.push('MHS_BELOW_RECOVERY_FLOOR');
  if (!evidence.vkospiOk) evidence.reasons.push(`VKOSPI_LEVEL_NOT_STABLE(current=${macroState?.vkospi?.toFixed(1) ?? 'N/A'},threshold=${vkospiThreshold})`);
  if (!evidence.marketDataFreshnessOk) evidence.reasons.push(`MARKET_DATA_${freshness}`);
  if (evidence.reasons.length === 0) evidence.reasons.push('R6_RECOVERY_EVIDENCE_OK');
  return evidence;
}

function evidenceComplete(evidence: R6RecoveryEvidence): boolean {
  return evidence.vkospiDayChangeOk && evidence.usdKrwDayChangeOk && evidence.kospiDayReturnOk && evidence.mhsScoreOk && evidence.vkospiOk && evidence.marketDataFreshnessOk;
}

function transitionDirection(previous: RegimeLevel | null, current: RegimeLevel): RegimeTransitionState['transitionDirection'] {
  if (!previous || previous === current) return 'NONE';
  const prevIdx = REGIME_ORDER.indexOf(previous);
  const currIdx = REGIME_ORDER.indexOf(current);
  if (previous === 'R6_DEFENSE' && current !== 'R6_DEFENSE') return 'RECOVERY';
  if (current === 'R6_DEFENSE') return 'R6_ENTRY';
  return currIdx < prevIdx ? 'DOWNGRADE' : 'UPGRADE';
}

export function evaluateR6RecoveryTransition(
  previousState: RegimeTransitionState,
  macroState: MacroState | null,
  rawRegime: RegimeLevel,
  now: Date = new Date(),
  triggerBreakdown: R6TriggerBreakdown = buildR6TriggerBreakdown(macroState, now, previousState),
): RegimeTransitionState {
  const nowIso = now.toISOString();
  const requiredConfirmations = envInt('R6_RECOVERY_REQUIRE_CONFIRMATIONS', 2);
  const cooldownMinutes = envInt('R6_RECOVERY_COOLDOWN_MINUTES', 240);
  const previouslyEffectiveR6 = previousState.effectiveRegime === 'R6_DEFENSE' || previousState.r6StateMachineState === 'R6_DEFENSE' || previousState.r6StateMachineState === 'R6_PANIC';
  const activeTriggers = triggerBreakdown.activeR6Triggers;
  const activeShockTrigger = activeTriggers.find((trigger) => trigger === 'KOSPI_INTRADAY_LOW_SHOCK' || trigger === 'KOSPI_CLOSE_SHOCK');
  const shockLatchTriggered = activeShockTrigger !== undefined;
  const closeEligible = closeRecoveryEligible(triggerBreakdown, macroState);
  const latchExpired = isLatchExpired(previousState, now);
  const biasScore = resolveRecoveryBiasScore(macroState);
  const decayPercent = latchDecayPercent(previousState, closeEligible, now, { triggerBreakdown, macroState, biasScore });
  const nearReleaseWindowMs = 10 * 60_000;
  const releaseAtMs = previousState.latchReleaseEligibleAt ? Date.parse(previousState.latchReleaseEligibleAt) : NaN;
  const releaseReachedOrNear = Number.isFinite(releaseAtMs) && releaseAtMs - now.getTime() <= nearReleaseWindowMs;
  const panicEasingEligible = previousState.r6StateMachineState === 'R6_PANIC' &&
    activeTriggers.length === 0 &&
    (macroState?.mhs ?? 0) >= 60 &&
    biasScore >= -50 &&
    isFreshEnoughForRecoveryWatch(triggerBreakdown.triggerFreshness) &&
    releaseReachedOrNear;
  const strongReboundExitEligible =
    process.env.R6_STRONG_REBOUND_DECAY_ENABLED === 'true' &&
    decayPercent >= 70 &&
    (macroState?.mhs ?? 0) >= 60 &&
    (macroState?.kospiDayReturn ?? 0) >= Number(process.env.R6_STRONG_REBOUND_THRESHOLD_PCT ?? '3.0') &&
    triggerBreakdown.activeR6Triggers.length === 0 &&
    triggerBreakdown.triggerFreshness === 'FRESH';
  const heldByShockLatch = previousState.r6ShockLatch && !latchExpired && activeTriggers.length === 0 && !panicEasingEligible && !strongReboundExitEligible && (!closeEligible || decayPercent < 60);

  if (rawRegime === 'R6_DEFENSE' || activeTriggers.length > 0 || heldByShockLatch) {
    const transitionReason = heldByShockLatch ? 'RAW_R6_HELD_BY_SHOCK_LATCH' : reasonForActiveR6Trigger(activeTriggers[0]);
    const triggerType = activeShockTrigger ?? previousState.r6ShockLatchReason;
    const shockTriggerValue = activeShockTrigger === 'KOSPI_CLOSE_SHOCK'
      ? triggerBreakdown.kospiCloseReturn
      : activeShockTrigger === 'KOSPI_INTRADAY_LOW_SHOCK'
        ? triggerBreakdown.kospiIntradayLowReturn
        : undefined;
    const expiresAt = shockLatchTriggered ? addMs(now, resolveLatchTtlMs(activeShockTrigger, shockTriggerValue)) : previousState.latchExpiresAt;
    const releaseEligibleAt = shockLatchTriggered ? addMs(now, resolveLatchReleaseEligibleMs(activeShockTrigger)) : previousState.latchReleaseEligibleAt;
    const nextDecayPercent = shockLatchTriggered ? 0 : decayPercent;
    const panic = activeTriggers.length > 0;
    const detail = buildR6ShockLatchDetail({
      previousState,
      activeShockTrigger,
      now,
      expiresAt,
      releaseEligibleAt,
      triggerBreakdown,
      decayPercent: nextDecayPercent,
      active: shockLatchTriggered || (previousState.r6ShockLatch && !latchExpired),
      lastExtensionReason: shockLatchTriggered ? 'ACTIVE_R6_TRIGGER_PRESENT' : heldByShockLatch ? 'R6_LATCH_TTL_UNDER_DECAY_THRESHOLD' : undefined,
    });
    console.info(
      '[REGIME_TRANSITION_EVALUATED] ' +
      `from=${previousState.r6StateMachineState ?? previousState.effectiveRegime} ` +
      `to=${panic ? 'R6_PANIC' : 'R6_DEFENSE'} ` +
      `mhs=${macroState?.mhs ?? 'N/A'} ` +
      `latchDecay=${nextDecayPercent} ` +
      `macroFreshness=${triggerBreakdown.triggerFreshness} ` +
      `lowRetest=${activeTriggers.includes('KOSPI_INTRADAY_LOW_SHOCK')} ` +
      'decision=R6_HELD',
    );
    return {
      ...previousState,
      previousRegime: previousState.effectiveRegime,
      currentRegime: 'R6_DEFENSE',
      rawRegime,
      effectiveRegime: 'R6_DEFENSE',
      enteredR6At: previousState.enteredR6At ?? nowIso,
      exitedR6At: undefined,
      lastTransitionAt: previousState.effectiveRegime === 'R6_DEFENSE' ? previousState.lastTransitionAt : nowIso,
      transitionDirection: transitionDirection(previousState.effectiveRegime, 'R6_DEFENSE'),
      transitionReason,
      r6RecoveryStatus: panic ? 'R6_PANIC' : 'R6_DEFENSE',
      r6RecoveryEvidence: { ...emptyR6RecoveryEvidence(nowIso), requiredConfirmations },
      cooldownUntil: undefined,
      sourceUpdatedAt: macroState?.updatedAt,
      recoveryConfirmations: 0,
      r6TriggerBreakdown: triggerBreakdown,
      previousR6Triggers: activeTriggers.length > 0 ? activeTriggers : previousState.previousR6Triggers,
      r6ShockLatch: detail?.active === true,
      r6ShockLatchDetail: detail,
      r6StateMachineState: panic ? 'R6_PANIC' : 'R6_DEFENSE',
      r6ShockLatchReason: triggerType,
      latchTriggeredAt: detail?.triggeredAt ?? previousState.latchTriggeredAt,
      latchTriggerValue: activeShockTrigger === 'KOSPI_CLOSE_SHOCK' ? triggerBreakdown.kospiCloseReturn : activeShockTrigger === 'KOSPI_INTRADAY_LOW_SHOCK' ? triggerBreakdown.kospiIntradayLowReturn : previousState.latchTriggerValue,
      latchTriggerSource: activeShockTrigger === 'KOSPI_CLOSE_SHOCK' ? 'macroState.kospiCloseReturn' : activeShockTrigger === 'KOSPI_INTRADAY_LOW_SHOCK' ? 'macroState.kospiIntradayLowReturn' : previousState.latchTriggerSource,
      latchExpiresAt: expiresAt,
      latchDecayLevel: shockLatchTriggered ? 'WATCH' : latchDecayLevel(previousState, closeEligible, now),
      latchDecayPercent: nextDecayPercent,
      latchReleaseEligibleAt: releaseEligibleAt,
      recoveryBlockedReason: heldByShockLatch && (triggerBreakdown.triggerFreshness === 'POST_CLOSE_VALID' || triggerBreakdown.triggerFreshness === 'EOD_SNAPSHOT_VALID') ? 'WAITING_NEXT_TRADING_DAY_CONFIRMATION' : heldByShockLatch && !closeEligible ? 'WAITING_FOR_CLOSE_OR_NEXT_TRADING_DAY_CONFIRMATION' : heldByShockLatch ? 'R6_LATCH_TTL_UNDER_DECAY_THRESHOLD' : 'ACTIVE_R6_TRIGGER_PRESENT',
    };
  }

  const recoveryCarryForwardAllowed = previousState.r6ShockLatch || previousState.previousR6Triggers.length > 0 || isFreshEnoughForRecoveryWatch(triggerBreakdown.triggerFreshness);
  const inRecoveryFlow = recoveryCarryForwardAllowed && (previouslyEffectiveR6 || previousState.r6RecoveryStatus === 'COOLDOWN' || previousState.r6RecoveryStatus === 'RECOVERY_CANDIDATE' || previousState.r6RecoveryStatus === 'STALE_DATA_BLOCKED' || previousState.r6RecoveryStatus === 'R6_RECOVERY_WATCH' || previousState.r6RecoveryStatus === 'R5_STABILIZING');
  if (inRecoveryFlow) {
    const sourceChanged = previousState.sourceUpdatedAt !== macroState?.updatedAt;
    const freshAndCloseEligible = isFreshEnoughForRecoveryWatch(triggerBreakdown.triggerFreshness) && closeEligible;
    const nextConfirmations = previouslyEffectiveR6 ? (freshAndCloseEligible ? 1 : 0) : (sourceChanged && freshAndCloseEligible ? previousState.recoveryConfirmations + 1 : previousState.recoveryConfirmations);
    const cooldownUntil = previousState.cooldownUntil ?? new Date(now.getTime() + cooldownMinutes * 60_000).toISOString();
    const evidence = buildR6RecoveryEvidence(macroState, now, requiredConfirmations, nextConfirmations);
    const recovered = evidenceComplete(evidence) && nextConfirmations >= requiredConfirmations && Date.parse(cooldownUntil) <= now.getTime();
    const blockedReason = recoveryBlockedReason(triggerBreakdown, previousState, macroState, cooldownUntil, now) ?? (nextConfirmations < requiredConfirmations ? 'R6_RECOVERY_CONFIRMATION_REQUIRED' : undefined);
    const nextDecayPercent = latchDecayPercent(previousState, closeEligible, now, { triggerBreakdown, macroState, biasScore });
    const latchStillActive = !recovered && previousState.r6ShockLatch && !isLatchExpired(previousState, now);
    const recoveryWatch = !recovered && recoveryWatchEligible(evidence, previousState, now, triggerBreakdown.triggerFreshness);
    const r6StateMachineState: R6StateMachineState = recovered ? (previousState.r6StateMachineState === 'R5_STABILIZING' ? resolveRecoveredStateMachine(rawRegime, macroState) : 'R5_STABILIZING') : recoveryWatch ? 'R6_RECOVERY_WATCH' : 'R6_DEFENSE';
    const effectiveRegime = recovered ? applyForcedDowngrade(rawRegime) : (recoveryWatch ? capRecoveryRegime(applyForcedDowngrade(rawRegime)) : 'R6_DEFENSE');
    const status = recovered ? (r6StateMachineState === 'R5_STABILIZING' ? 'R5_STABILIZING' : 'RECOVERED') : isHardStaleForRecovery(triggerBreakdown.triggerFreshness) ? 'STALE_DATA_BLOCKED' : recoveryWatch ? 'R6_RECOVERY_WATCH' : Date.parse(cooldownUntil) <= now.getTime() && evidenceComplete(evidence) ? 'RECOVERY_CANDIDATE' : 'COOLDOWN';
    const decision = r6StateMachineState === 'R6_RECOVERY_WATCH' ? 'TRANSITION_ALLOWED' : recovered ? 'RECOVERED' : 'TRANSITION_BLOCKED';
    if (previousState.latchDecayPercent !== undefined && nextDecayPercent > previousState.latchDecayPercent) {
      console.info(`[R6_LATCH_DECAYED] trigger=${previousState.r6ShockLatchReason ?? 'UNKNOWN'} previousDecay=${previousState.latchDecayPercent} newDecay=${nextDecayPercent} reason=NO_ADDITIONAL_LOW_BREAK`);
    }
    if (isHardStaleForRecovery(triggerBreakdown.triggerFreshness)) {
      console.warn(`[R6_RELEASE_BLOCKED] reason=MACRO_STATE_${triggerBreakdown.triggerFreshness} shadowLearningAllowed=true`);
    }
    if (r6StateMachineState === 'R6_RECOVERY_WATCH') {
      console.info('[RECOVERY_WATCH_ACTIVE] liveNewBuyAllowed=false shadowLearningAllowed=true shadowCandidateCollection=true');
    }
    console.info(
      '[REGIME_TRANSITION_EVALUATED] ' +
      `from=${previousState.r6StateMachineState ?? previousState.effectiveRegime} ` +
      `to=${r6StateMachineState} ` +
      `mhs=${macroState?.mhs ?? 'N/A'} ` +
      `latchDecay=${nextDecayPercent} ` +
      `macroFreshness=${triggerBreakdown.triggerFreshness} ` +
      `lowRetest=${activeTriggers.includes('KOSPI_INTRADAY_LOW_SHOCK')} ` +
      `decision=${decision}`,
    );
    const detail = buildR6ShockLatchDetail({ previousState, now, triggerBreakdown, decayPercent: recovered ? 100 : nextDecayPercent, active: latchStillActive });
    return {
      ...previousState,
      previousRegime: previousState.effectiveRegime,
      currentRegime: effectiveRegime,
      rawRegime,
      effectiveRegime,
      exitedR6At: previousState.exitedR6At ?? nowIso,
      lastTransitionAt: previousState.effectiveRegime === effectiveRegime && previousState.r6StateMachineState === r6StateMachineState ? previousState.lastTransitionAt : nowIso,
      transitionDirection: transitionDirection(previousState.effectiveRegime, effectiveRegime),
      transitionReason: recovered ? 'R6 state machine recovered; rawRegime restored as effectiveRegime' : isHardStaleForRecovery(triggerBreakdown.triggerFreshness) ? 'R6 release blocked by macroState hard stale; shadow remains allowed' : recoveryWatch ? 'R6_DEFENSE eased to R6_RECOVERY_WATCH by state machine' : 'R6 state machine waiting for recovery confirmations/cooldown',
      r6RecoveryStatus: status,
      r6RecoveryEvidence: evidence,
      cooldownUntil: recovered ? undefined : cooldownUntil,
      sourceUpdatedAt: macroState?.updatedAt,
      recoveryConfirmations: nextConfirmations,
      r6TriggerBreakdown: triggerBreakdown,
      previousR6Triggers: previousState.previousR6Triggers,
      r6ShockLatch: latchStillActive,
      r6ShockLatchDetail: recovered ? undefined : detail,
      r6StateMachineState,
      r6ShockLatchReason: recovered ? undefined : previousState.r6ShockLatchReason,
      latchTriggeredAt: recovered ? undefined : previousState.latchTriggeredAt,
      latchTriggerValue: recovered ? undefined : previousState.latchTriggerValue,
      latchTriggerSource: recovered ? undefined : previousState.latchTriggerSource,
      latchExpiresAt: recovered ? undefined : previousState.latchExpiresAt,
      latchDecayLevel: recovered ? 'NONE' : latchDecayLevel(previousState, closeEligible, now),
      latchDecayPercent: recovered ? 100 : nextDecayPercent,
      latchReleaseEligibleAt: recovered ? undefined : previousState.latchReleaseEligibleAt,
      recoveryBlockedReason: recovered ? undefined : blockedReason,
    };
  }

  const effectiveRegime = applyForcedDowngrade(rawRegime);
  const r6StateMachineState: R6StateMachineState = effectiveRegime === 'R5_CAUTION' ? 'R4_CAUTION' : 'R3_NORMAL';
  return { ...previousState, previousRegime: previousState.effectiveRegime, currentRegime: effectiveRegime, rawRegime, effectiveRegime, lastTransitionAt: previousState.effectiveRegime === effectiveRegime ? previousState.lastTransitionAt : nowIso, transitionDirection: transitionDirection(previousState.effectiveRegime, effectiveRegime), transitionReason: previousState.effectiveRegime === effectiveRegime ? 'RAW_REGIME_RECONFIRMED' : 'RAW_REGIME_RECLASSIFIED', r6RecoveryStatus: 'NONE', r6RecoveryEvidence: { ...emptyR6RecoveryEvidence(nowIso), requiredConfirmations }, cooldownUntil: undefined, sourceUpdatedAt: macroState?.updatedAt, recoveryConfirmations: 0, r6TriggerBreakdown: triggerBreakdown, previousR6Triggers: [], r6ShockLatch: false, r6ShockLatchDetail: undefined, r6StateMachineState, r6ShockLatchReason: undefined, latchTriggeredAt: undefined, latchTriggerValue: undefined, latchTriggerSource: undefined, latchExpiresAt: undefined, latchDecayLevel: 'NONE', latchDecayPercent: 0, latchReleaseEligibleAt: undefined, recoveryBlockedReason: undefined };
}

export function getRawRegime(macroState: MacroState | null, now: Date = new Date()): RegimeLevel {
  if ((macroState as unknown as { regime?: string } | null)?.regime === 'R6_DEFENSE') return 'R6_DEFENSE';
  const triggerBreakdown = buildR6TriggerBreakdown(macroState, now);
  if (triggerBreakdown.activeR6Triggers.length > 0) return 'R6_DEFENSE';
  return macroState ? classifyRegime(buildRegimeVars(macroState)) : 'R4_NEUTRAL';
}

export function getRegimeDiagnostics(macroState: MacroState | null, now: Date = new Date()): RegimeDiagnostics {
  const rawRegime = getRawRegime(macroState, now);
  const transitionState = evaluateR6RecoveryTransition(loadRegimeTransitionState(), macroState, rawRegime, now);
  saveRegimeTransitionState(transitionState);
  return {
    rawRegime,
    effectiveRegime: transitionState.effectiveRegime,
    r6RecoveryStatus: transitionState.r6RecoveryStatus,
    cooldownUntil: transitionState.cooldownUntil,
    transitionReason: transitionState.transitionReason,
    recoveryEvidence: transitionState.r6RecoveryEvidence,
    transitionState,
    sourceFreshness: sourceFreshness(macroState, now),
    r6TriggerBreakdown: transitionState.r6TriggerBreakdown,
    activeR6Triggers: transitionState.r6TriggerBreakdown.activeR6Triggers,
    previousR6Triggers: transitionState.previousR6Triggers,
    r6ShockLatch: transitionState.r6ShockLatch,
    recoveryBlockedReason: transitionState.recoveryBlockedReason,
  };
}

export function getLiveRegime(macroState: MacroState | null): RegimeLevel {
  return getRegimeDiagnostics(macroState).effectiveRegime;
}

// ── 레짐 전환 즉시 알림 ──────────────────────────────────────────────────────

/**
 * 레짐 전환 감지 + 즉시 Telegram 알림 발송.
 *
 * getLiveRegime() 호출 후 이 함수를 호출하면,
 * 이전 레짐과 비교하여 변경 시 구조화된 알림을 발송한다.
 *
 * 알림 내용:
 *  ① 전환 방향 (업그레이드/다운그레이드)
 *  ② MHS, VKOSPI 변화량
 *  ③ Kelly 배율, 최대 보유, 손절 기준 변경사항
 *  ④ 보유 포지션 점검 권고
 */
export async function checkAndNotifyRegimeChange(
  macroState: MacroState | null,
): Promise<void> {
  const diagnostics = getRegimeDiagnostics(macroState);
  const currentRegime = diagnostics.effectiveRegime;
  const persistedPrevious = diagnostics.transitionState.previousRegime;
  const currentMhs = macroState?.mhs ?? null;
  const currentVkospi = macroState?.vkospi ?? null;

  // 첫 호출/재시작: persistent state 를 이전 레짐 기준으로 복원한다.
  if (_previousRegime === null) {
    _previousRegime = persistedPrevious ?? currentRegime;
    _previousMhs = currentMhs;
    _previousVkospi = currentVkospi;
    if (_previousRegime === currentRegime) return;
  }

  // 레짐 변경 없으면 상태만 갱신
  if (_previousRegime === currentRegime) {
    _previousMhs = currentMhs;
    _previousVkospi = currentVkospi;
    return;
  }

  // ── 레짐 전환 감지! ──────────────────────────────────────────────────────
  const prevIdx = REGIME_ORDER.indexOf(_previousRegime);
  const currIdx = REGIME_ORDER.indexOf(currentRegime);
  const isDowngrade = currIdx < prevIdx;
  // 아이디어 2: 2단계 이상 급변 시 새 레짐의 학습 가중치 즉시 리셋.
  // 예: R2_BULL(idx=4) → R5_CAUTION(idx=1) → |diff|=3 → 리셋.
  const stepDelta = Math.abs(prevIdx - currIdx);
  const isAbruptShift = stepDelta >= 2;
  let resetNote = '';
  if (isAbruptShift) {
    const prevWeights = resetConditionWeightsForRegime(currentRegime);
    const movedKeys = prevWeights
      ? Object.entries(prevWeights)
          .filter(([, v]) => Math.abs(v - 1.0) > 0.05)
          .map(([k]) => k)
      : [];
    resetNote =
      `\n🧬 <b>가중치 자동 리셋</b>\n` +
      `• ${currentRegime} condition-weights 초기값 1.0 복원 (${stepDelta}단계 급변)\n` +
      (movedKeys.length > 0
        ? `• 리셋된 키: ${movedKeys.slice(0, 6).join(', ')}${movedKeys.length > 6 ? ` 외 ${movedKeys.length - 6}` : ''}\n`
        : '• 이전 저장 없음 — 신규 파일 생성\n') +
      `• 원칙: 직전 장세 주도주는 신장세 주도주가 아니다\n`;
    console.log(
      `[RegimeBridge] ${stepDelta}단계 급변(${_previousRegime}→${currentRegime}) — ${currentRegime} 가중치 리셋`,
    );
  }

  const prevCfg = REGIME_CONFIGS[_previousRegime];
  const currCfg = REGIME_CONFIGS[currentRegime];

  const dirEmoji = isDowngrade ? '🔴' : '🟢';
  const dirLabel = isDowngrade ? '방어 강화' : '공격 전환';

  // MHS/VKOSPI 변화량
  const mhsDelta = (currentMhs != null && _previousMhs != null)
    ? currentMhs - _previousMhs : null;
  const vkospiDelta = (currentVkospi != null && _previousVkospi != null)
    ? currentVkospi - _previousVkospi : null;

  let msg =
    `⚠️ <b>[레짐 전환]</b> ${_previousRegime} → ${currentRegime} ${dirEmoji}\n` +
    `━━━━━━━━━━━━━━━━\n`;

  // MHS / VKOSPI 변화
  if (mhsDelta !== null) {
    msg += `MHS: ${_previousMhs} → ${currentMhs} (${mhsDelta >= 0 ? '+' : ''}${mhsDelta}pt)\n`;
  }
  if (vkospiDelta !== null) {
    msg += `VKOSPI: ${_previousVkospi?.toFixed(1)} → ${currentVkospi?.toFixed(1)} ` +
           `(${vkospiDelta >= 0 ? '+' : ''}${vkospiDelta.toFixed(1)})\n`;
  }

  // 변경 사항
  msg += `\n<b>변경사항 (${dirLabel}):</b>\n`;
  msg += `• Kelly 배율: ×${prevCfg.kellyMultiplier} → ×${currCfg.kellyMultiplier} 자동 적용\n`;
  msg += `• 신규 진입 한도: ${prevCfg.maxPositions}개 → ${currCfg.maxPositions}개\n`;

  if (isDowngrade) {
    msg += `• 손절 기준: 강화 모드 전환\n`;
  } else {
    msg += `• 손절 기준: 완화 모드 전환\n`;
  }

  if (resetNote) {
    msg += resetNote;
  }

  msg += `━━━━━━━━━━━━━━━━\n`;

  if (isDowngrade) {
    msg += `📌 현재 보유 포지션 점검 권고`;
  } else {
    msg += `📌 신규 진입 기회 탐색 권고`;
  }

  // IDEA 5 — 레짐별 구체 행동 가이드 블록 주입
  msg += renderPlaybook(currentRegime);

  // Phase 4: 레짐 변화 차등화 — 나빠짐(downgrade) = T1 즉각 행동, 좋아짐(upgrade) = T2 리포트.
  // "긍정 변화는 조용히 기록, 부정 변화는 즉각 경보" (참뮌 스펙 #8).
  //
  // PR-4 B: dedupeKey 방향 분리. 공통 `regime-change-${regime}` 키는 같은 regime 에서
  // 짧은 간격 내 up↔down 교차 시 한 방향 알림을 dedupe 가 덮어써 운영자에게 도달하지
  // 못하는 사례가 있었다. 이제 up/down 이 서로 다른 키를 갖도록 분리한다.
  await sendTelegramAlert(msg, isDowngrade
    ? { priority: 'CRITICAL', tier: 'T1_ALARM',  dedupeKey: `regime-change-down-${currentRegime}`, category: 'regime_downgrade' }
    : { priority: 'HIGH',     tier: 'T2_REPORT', dedupeKey: `regime-change-up-${currentRegime}`,   category: 'regime_upgrade' },
  ).catch(console.error);

  // 채널: 레짐 변화 경보 (개인 메시지보다 간결하게)
  await channelRegimeChange(
    _previousRegime,
    currentRegime,
    currentMhs ?? 0,
    isDowngrade ? '방어 강화' : '공격 전환',
  ).catch(console.error);

  console.log(`[RegimeBridge] 레짐 전환 알림: ${_previousRegime} → ${currentRegime}`);

  // 상태 갱신
  _previousRegime = currentRegime;
  _previousMhs = currentMhs;
  _previousVkospi = currentVkospi;
}
