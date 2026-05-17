// @responsibility Persistent macro regime transition/recovery guard state repo.
import fs from "fs";
import type { RegimeLevel } from "../../src/types/core.js";
import { ensureDataDir, REGIME_TRANSITION_STATE_FILE } from "./paths.js";

export type R6RecoveryStatus =
  | "NONE"
  | "IN_R6"
  | "RECOVERY_CANDIDATE"
  | "COOLDOWN"
  | "RECOVERED"
  | "STALE_DATA_BLOCKED";

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
