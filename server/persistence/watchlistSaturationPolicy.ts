/**
 * @responsibility Classify watchlist cap notifications for operator-facing Telegram noise control.
 *
 * Notification-only policy. This module must not query providers, mutate watchlists,
 * change gates, change execution permissions, or affect shadow/live trading.
 */
import type { WatchlistSection } from "./watchlistRepo.js";

export type WatchlistSaturationSeverity = "ADVISORY" | "WARNING" | "CRITICAL";
export type WatchlistCapStatus = "OBSERVE" | "SOFT_CAP" | "HARD_CAP";

export type WatchlistSaturationAction =
  | "observe"
  | "cleanup_or_reduce_intake"
  | "hard_cap_protection";

export type WatchlistSaturationSuppressionReason =
  | "COOLDOWN_ACTIVE"
  | "ALERT_DISABLED"
  | "BELOW_ALERT"
  | "OBSERVE_ONLY"
  | "SOFT_CAP_NOTIFICATION_SUPPRESSED"
  | "COUNT_BUCKET_ALREADY_SENT_TODAY";

export type WatchlistSaturationEmitReason =
  | "FIRST_ALERT"
  | "SEVERITY_ESCALATED"
  | "HARD_CAP_APPROACH"
  | "HARD_CAP_FIRST_REACHED"
  | "REENTERED_AFTER_BELOW_ALERT"
  | "COOLDOWN_EXPIRED";

export const WATCHLIST_SOFT_CAP_COOLDOWN_MS = 60 * 60 * 1000;
export const WATCHLIST_HARD_CAP_COOLDOWN_MS = 15 * 60 * 1000;
export const WATCHLIST_CLEANUP_FAILURE_COOLDOWN_MS = 30 * 60 * 1000;
/** Legacy export kept for older guards; soft cap noise now uses 60 minutes. */
export const WATCHLIST_SATURATION_COOLDOWN_MS = WATCHLIST_SOFT_CAP_COOLDOWN_MS;
export const WATCHLIST_SATURATION_COUNT_DELTA = 5;

const EVENT_TYPE = "WATCHLIST_SOFT_CAP";

const SEVERITY_RANK: Record<WatchlistSaturationSeverity, number> = {
  ADVISORY: 1,
  WARNING: 2,
  CRITICAL: 3,
};

export interface WatchlistSaturationInput {
  section: WatchlistSection;
  count: number;
  alertCap: number;
  softCap: number;
  hardCap: number;
  autoCount: number;
  manualCount: number;
  dartCount?: number;
}

export interface WatchlistSaturationClassification {
  section: WatchlistSection;
  count: number;
  alertCap: number;
  softCap: number;
  hardCap: number;
  remainingToHard: number;
  remainingSlots: number;
  countBucket: string;
  capStatus: WatchlistCapStatus;
  autoCount: number;
  manualCount: number;
  dartCount: number;
  autoRatio: number;
  sourceDistribution: Record<"AUTO" | "MANUAL" | "DART", number>;
  severity: WatchlistSaturationSeverity;
  action: WatchlistSaturationAction;
  cleanupTriggered: boolean;
  cleanupEligible: boolean;
  /** Only watchlist intake is affected at hard cap; trading execution remains unchanged. */
  watchlistIntakeBlocked: boolean;
  executionImpact: "NONE";
  marketSignal: false;
  kisImpact: "NONE";
  providerIssue: false;
  dataVacuum: false;
  newBuyBlocked: false;
  tradingLogicChanged: false;
  gateLogicChanged: false;
  orderLogicChanged: false;
  notificationOnly: true;
  watchlistDisplayOnly: true;
}

export interface WatchlistSaturationEmissionDecision {
  shouldEmit: boolean;
  emitReason: WatchlistSaturationEmitReason | null;
  suppressionReason: WatchlistSaturationSuppressionReason | null;
  cooldownRemainingMs: number;
  cooldownMs: number;
  dedupKey: string | null;
  countBucket: string | null;
  capStatus: WatchlistCapStatus | null;
  lastCount: number | null;
}

interface WatchlistSaturationState {
  section: WatchlistSection;
  severity: WatchlistSaturationSeverity;
  lastCount: number;
  lastSentAt: string;
  lastSoftReached: boolean;
  lastHardReached: boolean;
  autoCount: number;
  manualCount: number;
  belowAlertObservedAt?: string;
}

const _saturationState = new Map<string, WatchlistSaturationState>();
const _sentBucketKeysByTradeDate = new Map<string, Set<string>>();

function saturationStateKey(section: WatchlistSection): string {
  return `watchlist_saturation:${section}`;
}

function kstTradeDate(now: Date): string {
  return new Date(now.getTime() + 9 * 60 * 60 * 1000).toISOString().slice(0, 10);
}

function countBucket(input: Pick<WatchlistSaturationInput, "count" | "alertCap" | "softCap" | "hardCap">): string {
  if (input.count >= input.hardCap) return `${input.hardCap}+`;
  if (input.count >= input.softCap + 5) return `${input.softCap + 5}~${input.hardCap - 1}`;
  if (input.count >= input.softCap) return `${input.softCap}~${Math.min(input.hardCap - 1, input.softCap + 4)}`;
  return `${input.alertCap}~${input.softCap - 1}`;
}

function capStatusFor(severity: WatchlistSaturationSeverity): WatchlistCapStatus {
  if (severity === "CRITICAL") return "HARD_CAP";
  if (severity === "WARNING") return "SOFT_CAP";
  return "OBSERVE";
}

function resolveCooldownMs(classification: WatchlistSaturationClassification | null): number {
  const raw = process.env.WATCHLIST_SATURATION_COOLDOWN_MIN;
  if (raw !== undefined && raw !== "") {
    const parsed = Number.parseInt(raw, 10);
    if (Number.isFinite(parsed) && parsed > 0) return parsed * 60 * 1000;
  }
  if (classification?.capStatus === "HARD_CAP") return WATCHLIST_HARD_CAP_COOLDOWN_MS;
  return WATCHLIST_SOFT_CAP_COOLDOWN_MS;
}

function sameDayBucketKey(c: WatchlistSaturationClassification): string {
  return `${c.section}:${c.capStatus}:${c.countBucket}`;
}

function isWatchlistCapActionRequired(c: WatchlistSaturationClassification): boolean {
  return c.capStatus === "HARD_CAP" || c.remainingToHard <= 3 || c.watchlistIntakeBlocked;
}

function resolveImmediateEmitReason(
  c: WatchlistSaturationClassification,
  prev: WatchlistSaturationState | undefined,
): WatchlistSaturationEmitReason | null {
  if (c.capStatus === "HARD_CAP" && !prev?.lastHardReached) return "HARD_CAP_FIRST_REACHED";
  if (c.capStatus === "SOFT_CAP" && c.remainingToHard <= 3) return "HARD_CAP_APPROACH";
  if (!prev) return "FIRST_ALERT";
  if (SEVERITY_RANK[c.severity] > SEVERITY_RANK[prev.severity]) return "SEVERITY_ESCALATED";
  if (prev.belowAlertObservedAt !== undefined) return "REENTERED_AFTER_BELOW_ALERT";
  return null;
}

export function buildWatchlistSaturationDedupeKey(
  c: WatchlistSaturationClassification,
  now: Date = new Date(),
): string {
  return `${kstTradeDate(now)}:${EVENT_TYPE}:${c.section}:${c.capStatus}:${c.countBucket}`;
}

export function resolveWatchlistSaturationTelegramCooldownMs(c: WatchlistSaturationClassification): number {
  return resolveCooldownMs(c);
}

export function isWatchlistSaturationAlertDisabled(): boolean {
  return process.env.WATCHLIST_OVERFLOW_ALERT_DISABLED === "true";
}

export function classifyWatchlistSaturation(
  input: WatchlistSaturationInput,
): WatchlistSaturationClassification | null {
  const { section, count, alertCap, softCap, hardCap } = input;
  if (!Number.isFinite(count) || count < alertCap) return null;

  const autoCount = Math.max(0, Math.trunc(input.autoCount));
  const manualCount = Math.max(0, Math.trunc(input.manualCount));
  const dartCount = Math.max(0, Math.trunc(input.dartCount ?? 0));
  const totalSource = autoCount + manualCount + dartCount;
  const autoRatio = totalSource > 0 ? autoCount / totalSource : 0;

  let severity: WatchlistSaturationSeverity;
  let action: WatchlistSaturationAction;
  let cleanupTriggered: boolean;
  let cleanupEligible: boolean;
  let watchlistIntakeBlocked: boolean;

  if (count >= hardCap) {
    severity = "CRITICAL";
    action = "hard_cap_protection";
    cleanupTriggered = true;
    cleanupEligible = true;
    watchlistIntakeBlocked = true;
  } else if (count >= softCap) {
    severity = "WARNING";
    action = "cleanup_or_reduce_intake";
    cleanupTriggered = true;
    cleanupEligible = true;
    watchlistIntakeBlocked = false;
  } else {
    severity = "ADVISORY";
    action = "observe";
    cleanupTriggered = false;
    cleanupEligible = false;
    watchlistIntakeBlocked = false;
  }

  const capStatus = capStatusFor(severity);
  const remainingToHard = Math.max(0, hardCap - count);

  return {
    section,
    count,
    alertCap,
    softCap,
    hardCap,
    remainingToHard,
    remainingSlots: remainingToHard,
    countBucket: countBucket(input),
    capStatus,
    autoCount,
    manualCount,
    dartCount,
    autoRatio,
    sourceDistribution: { AUTO: autoCount, MANUAL: manualCount, DART: dartCount },
    severity,
    action,
    cleanupTriggered,
    cleanupEligible,
    watchlistIntakeBlocked,
    executionImpact: "NONE",
    marketSignal: false,
    kisImpact: "NONE",
    providerIssue: false,
    dataVacuum: false,
    newBuyBlocked: false,
    tradingLogicChanged: false,
    gateLogicChanged: false,
    orderLogicChanged: false,
    notificationOnly: true,
    watchlistDisplayOnly: true,
  };
}

export function evaluateWatchlistSaturationAlert(
  input: WatchlistSaturationInput,
  now: Date = new Date(),
): {
  classification: WatchlistSaturationClassification | null;
  decision: WatchlistSaturationEmissionDecision;
} {
  const key = saturationStateKey(input.section);
  const prev = _saturationState.get(key);
  const classification = classifyWatchlistSaturation(input);
  const cooldownMs = resolveCooldownMs(classification);
  const baseDecision = {
    cooldownMs,
    dedupKey: classification ? buildWatchlistSaturationDedupeKey(classification, now) : null,
    countBucket: classification?.countBucket ?? null,
    capStatus: classification?.capStatus ?? null,
    lastCount: prev?.lastCount ?? null,
  };

  const suppress = (
    suppressionReason: WatchlistSaturationSuppressionReason,
    cooldownRemainingMs = 0,
  ) => ({
    classification,
    decision: {
      shouldEmit: false,
      emitReason: null,
      suppressionReason,
      cooldownRemainingMs,
      ...baseDecision,
    },
  });

  if (isWatchlistSaturationAlertDisabled()) return suppress("ALERT_DISABLED");

  if (classification === null) {
    if (prev && prev.belowAlertObservedAt === undefined) {
      _saturationState.set(key, {
        ...prev,
        belowAlertObservedAt: now.toISOString(),
      });
    }
    return suppress("BELOW_ALERT");
  }

  if (classification.capStatus === "OBSERVE") return suppress("OBSERVE_ONLY");

  if (!isWatchlistCapActionRequired(classification)) return suppress("SOFT_CAP_NOTIFICATION_SUPPRESSED");

  const tradeDate = kstTradeDate(now);
  const sentBuckets = _sentBucketKeysByTradeDate.get(tradeDate);
  if (sentBuckets?.has(sameDayBucketKey(classification))) {
    return suppress("COUNT_BUCKET_ALREADY_SENT_TODAY");
  }

  const emit = (
    emitReason: WatchlistSaturationEmitReason,
  ) => ({
    classification,
    decision: {
      shouldEmit: true,
      emitReason,
      suppressionReason: null,
      cooldownRemainingMs: 0,
      ...baseDecision,
    },
  });

  const immediateEmitReason = resolveImmediateEmitReason(classification, prev);
  if (immediateEmitReason) return emit(immediateEmitReason);
  if (!prev) return emit("FIRST_ALERT");

  const elapsed = now.getTime() - Date.parse(prev.lastSentAt);
  if (Number.isFinite(elapsed) && elapsed < cooldownMs) {
    return suppress("COOLDOWN_ACTIVE", Math.max(0, cooldownMs - elapsed));
  }

  return emit("COOLDOWN_EXPIRED");
}

export function recordWatchlistSaturationAlertSent(
  classification: WatchlistSaturationClassification,
  now: Date = new Date(),
): void {
  const key = saturationStateKey(classification.section);
  _saturationState.set(key, {
    section: classification.section,
    severity: classification.severity,
    lastCount: classification.count,
    lastSentAt: now.toISOString(),
    lastSoftReached: classification.count >= classification.softCap,
    lastHardReached: classification.count >= classification.hardCap,
    autoCount: classification.autoCount,
    manualCount: classification.manualCount,
    belowAlertObservedAt: undefined,
  });

  const tradeDate = kstTradeDate(now);
  const current = _sentBucketKeysByTradeDate.get(tradeDate) ?? new Set<string>();
  current.add(sameDayBucketKey(classification));
  _sentBucketKeysByTradeDate.set(tradeDate, current);
}

function messageTitle(c: WatchlistSaturationClassification): string {
  if (c.capStatus === "HARD_CAP" || c.remainingToHard <= 3) return "⚠️ <b>[Watchlist 확인 필요]</b>";
  return "📋 <b>[Watchlist 상태]</b>";
}

export function buildWatchlistSaturationMessage(
  c: WatchlistSaturationClassification,
): string {
  const sources = (["AUTO", "MANUAL", "DART"] as const)
    .filter((s) => c.sourceDistribution[s] > 0)
    .map((s) => `${s} ${c.sourceDistribution[s]}`)
    .join(" / ");

  const lines: string[] = [
    messageTitle(c),
    `${c.section}: ${c.count}/${c.hardCap}`,
    `capStatus=${c.capStatus} countBucket=${c.countBucket}`,
  ];
  if (sources) lines.push(`sourceDistribution=${sources}`);

  if (c.capStatus === "HARD_CAP") {
    lines.push("상태: hard cap 도달 — 확인 필요");
    lines.push("신규 후보 유입 영향 가능");
    lines.push("조치 필요: 확인");
  } else if (c.remainingToHard <= 3) {
    lines.push("상태: hard cap 접근 — 확인 필요");
    lines.push("자동 정리 후보 부족 가능");
    lines.push("신규 후보 유입 영향 가능");
    lines.push("조치 필요: 확인");
  } else {
    lines.push("상태: soft cap 관찰 — 자동 관리 대상");
    lines.push("매매 영향: 없음");
    lines.push("조치 필요: 없음");
  }

  lines.push(
    `watchlistIntakeBlocked=${c.watchlistIntakeBlocked}`,
    "매매 영향: 없음",
    "executionImpact=NONE marketSignal=false providerIssue=false kisImpact=NONE",
    "tradingLogicChanged=false gateLogicChanged=false orderLogicChanged=false",
    "notificationOnly=true watchlistDisplayOnly=true",
  );
  return lines.join("\n");
}

export function formatWatchlistSaturationSentLog(
  c: WatchlistSaturationClassification,
  emitReason: WatchlistSaturationEmitReason,
): string {
  return (
    `[WATCHLIST_CAP_TELEGRAM_SENT] section=${c.section} capStatus=${c.capStatus} ` +
    `count=${c.count} alertLimit=${c.alertCap} softLimit=${c.softCap} hardLimit=${c.hardCap} ` +
    `countBucket=${c.countBucket} reason=${emitReason} telegramSent=true ` +
    `remainingSlots=${c.remainingSlots} watchlistIntakeBlocked=${c.watchlistIntakeBlocked} ` +
    `executionImpact=NONE marketSignal=false providerIssue=false kisImpact=NONE ` +
    `tradingLogicChanged=false gateLogicChanged=false orderLogicChanged=false ` +
    `notificationOnly=true watchlistDisplayOnly=true`
  );
}

export function formatWatchlistSaturationSuppressedLog(
  c: WatchlistSaturationClassification,
  decision: WatchlistSaturationEmissionDecision,
): string {
  if (c.capStatus === "SOFT_CAP" && decision.suppressionReason === "SOFT_CAP_NOTIFICATION_SUPPRESSED") {
    return (
      `[WATCHLIST_SOFT_CAP_OBSERVED] section=${c.section} count=${c.count} ` +
      `action=auto_cleanup_or_observe telegramSent=false ` +
      `reason=SOFT_CAP_NOTIFICATION_SUPPRESSED executionImpact=NONE marketSignal=false ` +
      `providerIssue=false kisImpact=NONE tradingLogicChanged=false gateLogicChanged=false ` +
      `orderLogicChanged=false notificationOnly=true watchlistDisplayOnly=true`
    );
  }

  return (
    `[WATCHLIST_CAP_TELEGRAM_SUPPRESSED] section=${c.section} dedupKey=${decision.dedupKey ?? "N/A"} ` +
    `cooldownRemainingMs=${decision.cooldownRemainingMs} reason=${decision.suppressionReason ?? "UNKNOWN"} ` +
    `capStatus=${c.capStatus} count=${c.count} countBucket=${c.countBucket} ` +
    `executionImpact=NONE marketSignal=false providerIssue=false kisImpact=NONE ` +
    `tradingLogicChanged=false gateLogicChanged=false orderLogicChanged=false ` +
    `notificationOnly=true watchlistDisplayOnly=true telegramSent=false`
  );
}

export function shouldSendWatchlistSaturationTelegram(c: WatchlistSaturationClassification): boolean {
  return c.capStatus === "HARD_CAP" || c.remainingToHard <= 3 || c.watchlistIntakeBlocked;
}

export function formatWatchlistSaturationStatusLog(
  c: WatchlistSaturationClassification,
): string {
  return (
    `[WATCHLIST_CAP_EVALUATED] section=${c.section} count=${c.count} ` +
    `alertLimit=${c.alertCap} softLimit=${c.softCap} hardLimit=${c.hardCap} ` +
    `capStatus=${c.capStatus} remainingSlots=${c.remainingSlots} ` +
    `severity=${c.severity} action=${c.action} autoCount=${c.autoCount} ` +
    `manualCount=${c.manualCount} autoRatio=${c.autoRatio.toFixed(2)} ` +
    `executionImpact=NONE marketSignal=false providerIssue=false kisImpact=NONE ` +
    `tradingLogicChanged=false gateLogicChanged=false orderLogicChanged=false ` +
    `notificationOnly=true watchlistDisplayOnly=true`
  );
}

export function __resetWatchlistSaturationStateForTests(): void {
  _saturationState.clear();
  _sentBucketKeysByTradeDate.clear();
}
