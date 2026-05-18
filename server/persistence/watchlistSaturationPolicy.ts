/**
 * @responsibility Watchlist 포화/용량 주의 알림 severity 분류 + cooldown 상태머신 SSOT
 *
 * Patch-WATCHLIST-SATURATION-COOLDOWN-001 — MOMENTUM watchlist 포화 알림 반복 발송 억제.
 *
 * 핵심:
 *  - 30~39 (alert~soft) → ADVISORY/용량 주의 (WARNING 아님, "포화" 표현 금지)
 *  - 40~49 (soft~hard)  → WARNING/Soft Cap 경고
 *  - 50+   (hard 이상)  → CRITICAL/Hard Cap 도달
 *  - runtime memory 기반 dedup — section 당 마지막 발송 상태 추적 (영속 schema 무변경)
 *  - cooldown(30분) + count delta(+5) + severity 상승 + soft/hard 최초 도달 + below-alert 재진입 bypass
 *
 * 불변식: executionImpact=NONE / marketSignal=false / providerIssue=false / dataVacuum=false /
 *         newBuyBlocked=false / kisImpact=NONE — 매매 차단·시장 신호로 절대 승격하지 않는다.
 *         메시지 빌더는 순수 함수 — getPrice/fetchCurrentPrice 등 신규 KIS 호출 0건.
 *         이 모듈은 워치리스트·Shadow 포지션 어느 store 도 mutate 하지 않는다 — severity 분류 +
 *         cooldown 상태머신(in-memory Map) + 메시지 빌더 only. 워치리스트 cleanup 은 후보(candidate)
 *         만 정리하며, OPEN Shadow 포지션의 종료·삭제·관리 중단과 무관하다.
 */
import type { WatchlistSection } from "./watchlistRepo.js";

export type WatchlistSaturationSeverity = "ADVISORY" | "WARNING" | "CRITICAL";

export type WatchlistSaturationAction =
  | "observe"
  | "cleanup_or_reduce_intake"
  | "hard_cap_protection";

export type WatchlistSaturationSuppressionReason =
  | "COOLDOWN_ACTIVE"
  | "ALERT_DISABLED"
  | "BELOW_ALERT";

export type WatchlistSaturationEmitReason =
  | "FIRST_ALERT"
  | "SEVERITY_ESCALATED"
  | "SOFT_CAP_FIRST_REACHED"
  | "HARD_CAP_FIRST_REACHED"
  | "REENTERED_AFTER_BELOW_ALERT"
  | "COUNT_DELTA_EXCEEDED"
  | "COOLDOWN_EXPIRED";

/** 기본 cooldown — 30분. ENV `WATCHLIST_SATURATION_COOLDOWN_MIN` 으로 override. */
export const WATCHLIST_SATURATION_COOLDOWN_MS = 30 * 60 * 1000;
/** cooldown 중에도 재발송을 허용하는 count 증가 임계. */
export const WATCHLIST_SATURATION_COUNT_DELTA = 5;

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
  autoCount: number;
  manualCount: number;
  dartCount: number;
  autoRatio: number;
  sourceDistribution: Record<"AUTO" | "MANUAL" | "DART", number>;
  severity: WatchlistSaturationSeverity;
  action: WatchlistSaturationAction;
  cleanupTriggered: boolean;
  cleanupEligible: boolean;
  /** hard cap 도달 시에만 true — watchlist intake(AUTO 편입) 제한, 매매엔진 장애 아님. */
  watchlistIntakeBlocked: boolean;
  // ── 매매 차단 승격 영구 차단 불변식 (literal) ──
  executionImpact: "NONE";
  marketSignal: false;
  kisImpact: "NONE";
  providerIssue: false;
  dataVacuum: false;
  newBuyBlocked: false;
}

export interface WatchlistSaturationEmissionDecision {
  shouldEmit: boolean;
  /** 발송 결정 시 — 발송 사유. */
  emitReason: WatchlistSaturationEmitReason | null;
  /** 억제 결정 시 — 억제 사유. */
  suppressionReason: WatchlistSaturationSuppressionReason | null;
  cooldownRemainingMs: number;
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
  /** 직전 발송 이후 count 가 alertCap 미만으로 내려간 적이 있으면 ISO 시각. */
  belowAlertObservedAt?: string;
}

const _saturationState = new Map<string, WatchlistSaturationState>();

function saturationDedupeKey(section: WatchlistSection): string {
  return `watchlist_saturation:${section}`;
}

function resolveCooldownMs(): number {
  const raw = process.env.WATCHLIST_SATURATION_COOLDOWN_MIN;
  if (raw === undefined || raw === "") return WATCHLIST_SATURATION_COOLDOWN_MS;
  const parsed = Number.parseInt(raw, 10);
  if (Number.isFinite(parsed) && parsed > 0) return parsed * 60 * 1000;
  return WATCHLIST_SATURATION_COOLDOWN_MS;
}

/** ENV `WATCHLIST_OVERFLOW_ALERT_DISABLED=true` 시 saturation 알림 완전 비활성 (기존 동작 복원). */
export function isWatchlistSaturationAlertDisabled(): boolean {
  return process.env.WATCHLIST_OVERFLOW_ALERT_DISABLED === "true";
}

/**
 * count → severity/action 분류 SSOT.
 * count < alertCap 이면 null (포화 우려 없음 — 알림 대상 아님).
 */
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
    // alertCap <= count < softCap — 용량 주의 (포화 아님). 강제 cleanup 없음.
    severity = "ADVISORY";
    action = "observe";
    cleanupTriggered = false;
    cleanupEligible = false;
    watchlistIntakeBlocked = false;
  }

  return {
    section,
    count,
    alertCap,
    softCap,
    hardCap,
    remainingToHard: Math.max(0, hardCap - count),
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
  };
}

/**
 * 분류 + cooldown 상태머신 단일 진입점.
 * count < alertCap 인 경우에도 호출 가능 — below-alert 관찰 기록 후 classification=null 반환.
 *
 * 발송 결정 후 호출자는 반드시 `recordWatchlistSaturationAlertSent(classification, now)` 호출.
 */
export function evaluateWatchlistSaturationAlert(
  input: WatchlistSaturationInput,
  now: Date = new Date(),
): {
  classification: WatchlistSaturationClassification | null;
  decision: WatchlistSaturationEmissionDecision;
} {
  const key = saturationDedupeKey(input.section);
  const prev = _saturationState.get(key);

  if (isWatchlistSaturationAlertDisabled()) {
    return {
      classification: classifyWatchlistSaturation(input),
      decision: {
        shouldEmit: false,
        emitReason: null,
        suppressionReason: "ALERT_DISABLED",
        cooldownRemainingMs: 0,
        lastCount: prev?.lastCount ?? null,
      },
    };
  }

  const classification = classifyWatchlistSaturation(input);

  // count < alertCap — below-alert 관찰 기록 (직전 발송 상태가 있을 때만).
  if (classification === null) {
    if (prev && prev.belowAlertObservedAt === undefined) {
      _saturationState.set(key, {
        ...prev,
        belowAlertObservedAt: now.toISOString(),
      });
    }
    return {
      classification: null,
      decision: {
        shouldEmit: false,
        emitReason: null,
        suppressionReason: "BELOW_ALERT",
        cooldownRemainingMs: 0,
        lastCount: prev?.lastCount ?? null,
      },
    };
  }

  const emit = (
    emitReason: WatchlistSaturationEmitReason,
  ): {
    classification: WatchlistSaturationClassification;
    decision: WatchlistSaturationEmissionDecision;
  } => ({
    classification,
    decision: {
      shouldEmit: true,
      emitReason,
      suppressionReason: null,
      cooldownRemainingMs: 0,
      lastCount: prev?.lastCount ?? null,
    },
  });

  // 1) 직전 발송 이력 없음 → 최초 발송.
  if (!prev) return emit("FIRST_ALERT");

  // 2) severity 상승 → cooldown 무시.
  if (SEVERITY_RANK[classification.severity] > SEVERITY_RANK[prev.severity]) {
    return emit("SEVERITY_ESCALATED");
  }

  // 3) soft cap 최초 도달 → cooldown 무시.
  if (classification.count >= input.softCap && !prev.lastSoftReached) {
    return emit("SOFT_CAP_FIRST_REACHED");
  }

  // 4) hard cap 최초 도달 → cooldown 무시.
  if (classification.count >= input.hardCap && !prev.lastHardReached) {
    return emit("HARD_CAP_FIRST_REACHED");
  }

  // 5) alertCap 미만으로 내려갔다가 다시 진입 → cooldown 무시.
  if (prev.belowAlertObservedAt !== undefined) {
    return emit("REENTERED_AFTER_BELOW_ALERT");
  }

  // 6) count 가 직전 발송 대비 +5 이상 증가 → cooldown 무시.
  if (classification.count - prev.lastCount >= WATCHLIST_SATURATION_COUNT_DELTA) {
    return emit("COUNT_DELTA_EXCEEDED");
  }

  // 7) cooldown 판정.
  const cooldownMs = resolveCooldownMs();
  const elapsed = now.getTime() - Date.parse(prev.lastSentAt);
  if (Number.isFinite(elapsed) && elapsed < cooldownMs) {
    return {
      classification,
      decision: {
        shouldEmit: false,
        emitReason: null,
        suppressionReason: "COOLDOWN_ACTIVE",
        cooldownRemainingMs: Math.max(0, cooldownMs - elapsed),
        lastCount: prev.lastCount,
      },
    };
  }

  // cooldown 만료 — 재발송 허용.
  return emit("COOLDOWN_EXPIRED");
}

/** 발송 직후 호출 — runtime 상태 갱신 (below-alert 관찰 플래그 초기화). */
export function recordWatchlistSaturationAlertSent(
  classification: WatchlistSaturationClassification,
  now: Date = new Date(),
): void {
  const key = saturationDedupeKey(classification.section);
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
}

function severityTitle(severity: WatchlistSaturationSeverity): string {
  switch (severity) {
    case "CRITICAL":
      return "🚨 <b>[Watchlist Hard Cap 도달]</b>";
    case "WARNING":
      return "⚠️ <b>[Watchlist Soft Cap 경고]</b>";
    case "ADVISORY":
    default:
      return "📊 <b>[Watchlist 용량 주의]</b>";
  }
}

/**
 * Telegram 메시지 빌더 — 순수 함수 (신규 KIS 호출 0건).
 * 30~39 구간은 "포화" 표현을 쓰지 않는다 (ADVISORY = 용량 주의).
 */
export function buildWatchlistSaturationMessage(
  c: WatchlistSaturationClassification,
): string {
  const sources = (["AUTO", "MANUAL", "DART"] as const)
    .filter((s) => c.sourceDistribution[s] > 0)
    .map((s) => `${s} ${c.sourceDistribution[s]}`)
    .join(" · ");

  const lines: string[] = [
    severityTitle(c.severity),
    `${c.section} 섹션: ${c.count}개 (alert ${c.alertCap} / soft ${c.softCap} / hard ${c.hardCap})`,
  ];
  if (sources) lines.push(`출처 분포: ${sources}`);
  lines.push(
    `severity: ${c.severity} · action: ${c.action} · cleanup: ${
      c.cleanupTriggered ? "발동 대상" : "미발동"
    }`,
  );
  lines.push(`잔여 슬롯: ${c.remainingToHard}개 (hard cap 까지)`);

  if (c.severity === "CRITICAL") {
    lines.push(
      `🚨 hard cap 도달 — 신규 AUTO 편입 차단 (watchlistIntakeBlocked=true)`,
    );
  } else if (c.severity === "WARNING") {
    lines.push(`⚡ soft cap 초과 — composite score 하위 능동 정리 대상`);
  } else if (c.autoRatio >= 0.8) {
    lines.push(
      `ℹ️ AUTO 비중 ${Math.round(c.autoRatio * 100)}% — autoPopulate 감속 권고 (강제 정리 없음)`,
    );
  } else {
    lines.push(`ℹ️ 용량 주의 — 능동 정리 미발동 (TTL 만료 자연 감소 관찰)`);
  }

  lines.push(
    `executionImpact=NONE · marketSignal=false · providerIssue=false · kisImpact=NONE`,
  );
  return lines.join("\n");
}

/** Railway 진단 로그 — 발송됨. */
export function formatWatchlistSaturationSentLog(
  c: WatchlistSaturationClassification,
  emitReason: WatchlistSaturationEmitReason,
): string {
  const hardLimitReached = c.count >= c.hardCap;
  const logName = c.newBuyBlocked
    ? 'WATCHLIST_ENTRY_BLOCKED'
    : c.watchlistIntakeBlocked
      ? 'WATCHLIST_INTAKE_BLOCKED'
      : 'WATCHLIST_SATURATION_ADVISORY';
  const action = c.newBuyBlocked
    ? 'block_new_entry'
    : c.watchlistIntakeBlocked
      ? 'block_watchlist_intake'
      : c.action;
  const executionImpact = c.newBuyBlocked ? 'NEW_BUY_BLOCKED_ONLY' : 'NONE';
  return (
    `[${logName}] section=${c.section} count=${c.count} ` +
    `severity=${c.severity} action=${action} reason=${emitReason} ` +
    `autoCount=${c.autoCount} manualCount=${c.manualCount} autoRatio=${c.autoRatio.toFixed(2)} ` +
    `softLimitApproaching=${c.count >= c.alertCap} hardLimitReached=${hardLimitReached} ` +
    `remainingToHard=${c.remainingToHard} cleanupTriggered=${c.cleanupTriggered} ` +
    `watchlistIntakeBlocked=${c.watchlistIntakeBlocked} ` +
    `liveEntryBlocked=${c.newBuyBlocked} executionImpact=${executionImpact} ` +
    `marketSignal=false providerIssue=false dataVacuum=false newBuyBlocked=${c.newBuyBlocked} kisImpact=NONE`
  );
}

/** Railway 진단 로그 — Telegram 발송 억제됨 (compact). */
export function formatWatchlistSaturationSuppressedLog(
  c: WatchlistSaturationClassification,
  decision: WatchlistSaturationEmissionDecision,
): string {
  return (
    `[WATCHLIST_SATURATION_ALERT_SUPPRESSED] section=${c.section} count=${c.count} ` +
    `severity=${c.severity} reason=${decision.suppressionReason ?? "UNKNOWN"} ` +
    `lastCount=${decision.lastCount ?? "N/A"} cooldownRemainingMs=${decision.cooldownRemainingMs} ` +
    `executionImpact=NONE marketSignal=false softLimitApproaching=${c.count >= c.alertCap} telegramSent=false`
  );
}


export function shouldSendWatchlistSaturationTelegram(c: WatchlistSaturationClassification): boolean {
  return c.count >= c.hardCap || c.cleanupTriggered === true;
}

/** Railway 진단 로그 — 현재 상태 (발송/억제 무관). */
export function formatWatchlistSaturationStatusLog(
  c: WatchlistSaturationClassification,
): string {
  return (
    `[WATCHLIST_SATURATION_STATUS] section=${c.section} count=${c.count} ` +
    `alertCap=${c.alertCap} softCap=${c.softCap} hardCap=${c.hardCap} ` +
    `severity=${c.severity} action=${c.action} autoCount=${c.autoCount} ` +
    `manualCount=${c.manualCount} autoRatio=${c.autoRatio.toFixed(2)} ` +
    `executionImpact=NONE marketSignal=false providerIssue=false dataVacuum=false kisImpact=NONE`
  );
}

/** 테스트 격리 — runtime 상태 초기화. */
export function __resetWatchlistSaturationStateForTests(): void {
  _saturationState.clear();
}
