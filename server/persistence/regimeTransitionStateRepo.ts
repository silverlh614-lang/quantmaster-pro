// @responsibility Persistent macro regime transition/recovery guard state repo.
import fs from "fs";
import type { RegimeLevel } from "../../src/types/core.js";
import { ensureDataDir, REGIME_TRANSITION_STATE_FILE } from "./paths.js";

export type R6RecoveryStatus =
  | "NONE"
  | "IN_R6"
  | "R6_PANIC"
  | "R6_DEFENSE"
  | "R6_RECOVERY_WATCH"
  | "R5_STABILIZING"
  | "RECOVERY_CANDIDATE"
  | "COOLDOWN"
  | "RECOVERED"
  | "STALE_DATA_BLOCKED";

export type R6TriggerReason =
  | 'KOSPI_INTRADAY_LOW_SHOCK'
  | 'KOSPI_CLOSE_SHOCK'
  | 'VKOSPI_DAY_SPIKE'
  | 'USDKRW_DAY_SHOCK'
  | 'CIRCUIT_BREAKER'
  | 'BLACK_SWAN'
  | 'MANUAL_KILL_SWITCH';

export interface R6ShockLatch {
  active: boolean;
  triggerType: R6TriggerReason;
  triggeredAt: string;
  expiresAt: string;
  severity: number;
  /** Percent-style recovery/decay progress: 0=armed, 100=fully expired/releasable. */
  decayLevel: number;
  releaseEligibleAt: string;
  lastExtensionReason?: string;
}

export type R6StateMachineState =
  | 'R3_NORMAL'
  | 'R4_CAUTION'
  | 'R5_STABILIZING'
  | 'R6_RECOVERY_WATCH'
  | 'R6_DEFENSE'
  | 'R6_PANIC';

export interface R6TriggerBreakdown {
  kospiDayReturn?: number;
  kospiCloseReturn?: number;
  kospiIntradayLowReturn?: number;
  kospiIntradayHighReturn?: number;
  vkospiDayChange?: number;
  usdKrwDayChange?: number;
  activeR6Triggers: R6TriggerReason[];
  staleR6Triggers: R6TriggerReason[];
  triggerSourceUpdatedAt?: string;
  triggerFreshness: 'FRESH' | 'STALE' | 'MISSING';
  staleCarryForward: boolean;
  staleBlockedRecovery: boolean;
}

export type RegimeTransitionDirection =
  | "NONE"
  | "UPGRADE"
  | "DOWNGRADE"
  | "RECOVERY"
  | "R6_ENTRY";

export interface R6RecoveryEvidence {
  vkospiDayChangeOk: boolean;
  usdKrwDayChangeOk: boolean;
  kospiDayReturnOk: boolean;
  mhsScoreOk: boolean;
  vkospiOk: boolean;
  marketDataFreshnessOk: boolean;
  confirmations: number;
  requiredConfirmations: number;
  reasons: string[];
  checkedAt: string;
}

export interface RegimeTransitionState {
  previousRegime: RegimeLevel | null;
  currentRegime: RegimeLevel;
  rawRegime: RegimeLevel;
  effectiveRegime: RegimeLevel;
  enteredR6At?: string;
  exitedR6At?: string;
  lastTransitionAt: string;
  transitionDirection: RegimeTransitionDirection;
  transitionReason: string;
  r6RecoveryStatus: R6RecoveryStatus;
  r6RecoveryEvidence: R6RecoveryEvidence;
  cooldownUntil?: string;
  sourceUpdatedAt?: string;
  recoveryConfirmations: number;
  r6TriggerBreakdown: R6TriggerBreakdown;
  previousR6Triggers: R6TriggerReason[];
  r6ShockLatch: boolean;
  r6ShockLatchDetail?: R6ShockLatch;
  r6StateMachineState?: R6StateMachineState;
  r6ShockLatchReason?: R6TriggerReason;
  latchTriggeredAt?: string;
  latchTriggerValue?: number;
  latchTriggerSource?: string;
  /** HOTFIX-5: R6 shock latch is time-bounded and decays instead of persisting forever. */
  latchExpiresAt?: string;
  latchDecayLevel?: 'NONE' | 'WATCH' | 'DECAYING' | 'EXPIRED';
  latchDecayPercent?: number;
  latchReleaseEligibleAt?: string;
  recoveryBlockedReason?: string;
}

export function emptyR6RecoveryEvidence(
  nowIso = new Date().toISOString(),
): R6RecoveryEvidence {
  return {
    vkospiDayChangeOk: false,
    usdKrwDayChangeOk: false,
    kospiDayReturnOk: false,
    mhsScoreOk: false,
    vkospiOk: false,
    marketDataFreshnessOk: false,
    confirmations: 0,
    requiredConfirmations: 2,
    reasons: ["NO_RECOVERY_EVALUATION"],
    checkedAt: nowIso,
  };
}

export function emptyR6TriggerBreakdown(): R6TriggerBreakdown {
  return { activeR6Triggers: [], staleR6Triggers: [], triggerFreshness: 'MISSING', staleCarryForward: false, staleBlockedRecovery: false };
}

export function defaultRegimeTransitionState(
  nowIso = new Date().toISOString(),
): RegimeTransitionState {
  return {
    previousRegime: null,
    currentRegime: "R4_NEUTRAL",
    rawRegime: "R4_NEUTRAL",
    effectiveRegime: "R4_NEUTRAL",
    lastTransitionAt: nowIso,
    transitionDirection: "NONE",
    transitionReason: "INITIALIZED_DEFAULT_STATE",
    r6RecoveryStatus: "NONE",
    r6RecoveryEvidence: emptyR6RecoveryEvidence(nowIso),
    sourceUpdatedAt: undefined,
    recoveryConfirmations: 0,
    r6TriggerBreakdown: emptyR6TriggerBreakdown(),
    previousR6Triggers: [],
    r6ShockLatch: false,
    r6StateMachineState: 'R4_CAUTION',
    latchDecayPercent: 0,
    recoveryBlockedReason: undefined,
  };
}

function isRegimeLevel(value: unknown): value is RegimeLevel {
  return (
    value === "R1_TURBO" ||
    value === "R2_BULL" ||
    value === "R3_EARLY" ||
    value === "R4_NEUTRAL" ||
    value === "R5_CAUTION" ||
    value === "R6_DEFENSE"
  );
}

function isR6TriggerReason(value: unknown): value is R6TriggerReason {
  return value === 'KOSPI_INTRADAY_LOW_SHOCK' ||
    value === 'KOSPI_CLOSE_SHOCK' ||
    value === 'VKOSPI_DAY_SPIKE' ||
    value === 'USDKRW_DAY_SHOCK' ||
    value === 'CIRCUIT_BREAKER' ||
    value === 'BLACK_SWAN' ||
    value === 'MANUAL_KILL_SWITCH';
}

function isR6StateMachineState(value: unknown): value is R6StateMachineState {
  return value === 'R3_NORMAL' || value === 'R4_CAUTION' || value === 'R5_STABILIZING' || value === 'R6_RECOVERY_WATCH' || value === 'R6_DEFENSE' || value === 'R6_PANIC';
}

function sanitizeR6ShockLatch(value: unknown): R6ShockLatch | undefined {
  if (!value || typeof value !== 'object') return undefined;
  const record = value as Partial<R6ShockLatch>;
  if (!isR6TriggerReason(record.triggerType)) return undefined;
  if (typeof record.triggeredAt !== 'string' || typeof record.expiresAt !== 'string' || typeof record.releaseEligibleAt !== 'string') return undefined;
  const severity = typeof record.severity === 'number' && Number.isFinite(record.severity) ? record.severity : 0;
  const decayLevel = typeof record.decayLevel === 'number' && Number.isFinite(record.decayLevel) ? Math.max(0, Math.min(100, record.decayLevel)) : 0;
  return {
    active: record.active === true,
    triggerType: record.triggerType,
    triggeredAt: record.triggeredAt,
    expiresAt: record.expiresAt,
    severity,
    decayLevel,
    releaseEligibleAt: record.releaseEligibleAt,
    lastExtensionReason: typeof record.lastExtensionReason === 'string' ? record.lastExtensionReason : undefined,
  };
}

function sanitizeState(value: unknown): RegimeTransitionState | null {
  if (!value || typeof value !== "object") return null;
  const record = value as Partial<RegimeTransitionState>;
  if (
    !isRegimeLevel(record.currentRegime) ||
    !isRegimeLevel(record.rawRegime) ||
    !isRegimeLevel(record.effectiveRegime)
  ) {
    return null;
  }
  const nowIso = new Date().toISOString();
  return {
    previousRegime: isRegimeLevel(record.previousRegime)
      ? record.previousRegime
      : null,
    currentRegime: record.currentRegime,
    rawRegime: record.rawRegime,
    effectiveRegime: record.effectiveRegime,
    enteredR6At:
      typeof record.enteredR6At === "string" ? record.enteredR6At : undefined,
    exitedR6At:
      typeof record.exitedR6At === "string" ? record.exitedR6At : undefined,
    lastTransitionAt:
      typeof record.lastTransitionAt === "string"
        ? record.lastTransitionAt
        : nowIso,
    transitionDirection: record.transitionDirection ?? "NONE",
    transitionReason:
      typeof record.transitionReason === "string"
        ? record.transitionReason
        : "LOADED_LEGACY_STATE",
    r6RecoveryStatus: record.r6RecoveryStatus ?? "NONE",
    r6RecoveryEvidence:
      record.r6RecoveryEvidence ?? emptyR6RecoveryEvidence(nowIso),
    cooldownUntil:
      typeof record.cooldownUntil === "string"
        ? record.cooldownUntil
        : undefined,
    sourceUpdatedAt:
      typeof record.sourceUpdatedAt === "string"
        ? record.sourceUpdatedAt
        : undefined,
    recoveryConfirmations:
      typeof record.recoveryConfirmations === "number"
        ? record.recoveryConfirmations
        : 0,
    r6TriggerBreakdown: record.r6TriggerBreakdown ?? emptyR6TriggerBreakdown(),
    previousR6Triggers: Array.isArray(record.previousR6Triggers)
      ? record.previousR6Triggers.filter((trigger): trigger is R6TriggerReason => isR6TriggerReason(trigger))
      : [],
    r6ShockLatch: record.r6ShockLatch === true,
    r6ShockLatchDetail: sanitizeR6ShockLatch(record.r6ShockLatchDetail),
    r6StateMachineState: isR6StateMachineState(record.r6StateMachineState) ? record.r6StateMachineState : undefined,
    r6ShockLatchReason: isR6TriggerReason(record.r6ShockLatchReason) ? record.r6ShockLatchReason : undefined,
    latchTriggeredAt: typeof record.latchTriggeredAt === "string" ? record.latchTriggeredAt : undefined,
    latchTriggerValue: typeof record.latchTriggerValue === "number" ? record.latchTriggerValue : undefined,
    latchTriggerSource: typeof record.latchTriggerSource === "string" ? record.latchTriggerSource : undefined,
    latchExpiresAt: typeof record.latchExpiresAt === "string" ? record.latchExpiresAt : undefined,
    latchDecayLevel: record.latchDecayLevel === 'WATCH' || record.latchDecayLevel === 'DECAYING' || record.latchDecayLevel === 'EXPIRED' ? record.latchDecayLevel : record.r6ShockLatch === true ? 'WATCH' : 'NONE',
    latchDecayPercent: typeof record.latchDecayPercent === 'number' && Number.isFinite(record.latchDecayPercent) ? Math.max(0, Math.min(100, record.latchDecayPercent)) : undefined,
    latchReleaseEligibleAt: typeof record.latchReleaseEligibleAt === "string" ? record.latchReleaseEligibleAt : undefined,
    recoveryBlockedReason: typeof record.recoveryBlockedReason === "string" ? record.recoveryBlockedReason : undefined,
  };
}

export function loadRegimeTransitionState(): RegimeTransitionState {
  ensureDataDir();
  if (!fs.existsSync(REGIME_TRANSITION_STATE_FILE))
    return defaultRegimeTransitionState();
  try {
    const parsed = JSON.parse(
      fs.readFileSync(REGIME_TRANSITION_STATE_FILE, "utf-8"),
    ) as unknown;
    return sanitizeState(parsed) ?? defaultRegimeTransitionState();
  } catch {
    return defaultRegimeTransitionState();
  }
}

export function saveRegimeTransitionState(state: RegimeTransitionState): void {
  ensureDataDir();
  fs.writeFileSync(
    REGIME_TRANSITION_STATE_FILE,
    JSON.stringify(state, null, 2),
  );
}

export function resetRegimeTransitionStateForTests(
  state: RegimeTransitionState = defaultRegimeTransitionState(),
): void {
  saveRegimeTransitionState(state);
}
