// @responsibility Watchlist 포화 severity 분류 + cooldown 상태머신 회귀 테스트 (Patch-WATCHLIST-SATURATION-COOLDOWN-001)
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { readFileSync } from "fs";
import { fileURLToPath } from "url";
import {
  classifyWatchlistSaturation,
  evaluateWatchlistSaturationAlert,
  recordWatchlistSaturationAlertSent,
  buildWatchlistSaturationMessage,
  formatWatchlistSaturationSentLog,
  formatWatchlistSaturationSuppressedLog,
  formatWatchlistSaturationStatusLog,
  isWatchlistSaturationAlertDisabled,
  __resetWatchlistSaturationStateForTests,
  type WatchlistSaturationInput,
} from "./watchlistSaturationPolicy.js";

const BASE_NOW = new Date("2026-05-14T00:00:00.000Z");

/** alert 30 / soft 40 / hard 50 — Patch 스펙 표준 예시. */
function input(
  count: number,
  overrides: Partial<WatchlistSaturationInput> = {},
): WatchlistSaturationInput {
  return {
    section: "MOMENTUM",
    count,
    alertCap: 30,
    softCap: 40,
    hardCap: 50,
    autoCount: count,
    manualCount: 0,
    dartCount: 0,
    ...overrides,
  };
}

const ENV_KEYS = [
  "WATCHLIST_OVERFLOW_ALERT_DISABLED",
  "WATCHLIST_SATURATION_COOLDOWN_MIN",
] as const;
const origEnv: Record<string, string | undefined> = {};

beforeEach(() => {
  for (const k of ENV_KEYS) {
    origEnv[k] = process.env[k];
    delete process.env[k];
  }
  __resetWatchlistSaturationStateForTests();
});
afterEach(() => {
  for (const k of ENV_KEYS) {
    if (origEnv[k] === undefined) delete process.env[k];
    else process.env[k] = origEnv[k];
  }
  __resetWatchlistSaturationStateForTests();
});

// ── A. severity 분류 ────────────────────────────────────────────────────────
describe("A. classifyWatchlistSaturation — severity 분류", () => {
  it("count < alertCap → null (포화 우려 없음)", () => {
    expect(classifyWatchlistSaturation(input(29))).toBeNull();
    expect(classifyWatchlistSaturation(input(0))).toBeNull();
  });

  it("30~39 (alert~soft) → ADVISORY / observe / 강제 cleanup 없음", () => {
    const c = classifyWatchlistSaturation(input(35))!;
    expect(c.severity).toBe("ADVISORY");
    expect(c.action).toBe("observe");
    expect(c.cleanupTriggered).toBe(false);
    expect(c.cleanupEligible).toBe(false);
    expect(c.watchlistIntakeBlocked).toBe(false);
    expect(c.remainingToHard).toBe(15);
  });

  it("40~49 (soft~hard) → WARNING / cleanup_or_reduce_intake / cleanupEligible", () => {
    const c = classifyWatchlistSaturation(input(45))!;
    expect(c.severity).toBe("WARNING");
    expect(c.action).toBe("cleanup_or_reduce_intake");
    expect(c.cleanupTriggered).toBe(true);
    expect(c.cleanupEligible).toBe(true);
    expect(c.watchlistIntakeBlocked).toBe(false);
  });

  it("50+ (hard 이상) → CRITICAL / hard_cap_protection / watchlistIntakeBlocked", () => {
    const c = classifyWatchlistSaturation(input(52))!;
    expect(c.severity).toBe("CRITICAL");
    expect(c.action).toBe("hard_cap_protection");
    expect(c.cleanupTriggered).toBe(true);
    expect(c.watchlistIntakeBlocked).toBe(true);
    expect(c.remainingToHard).toBe(0);
  });

  it("boundary — count===alertCap → ADVISORY, count===softCap → WARNING, count===hardCap → CRITICAL", () => {
    expect(classifyWatchlistSaturation(input(30))!.severity).toBe("ADVISORY");
    expect(classifyWatchlistSaturation(input(40))!.severity).toBe("WARNING");
    expect(classifyWatchlistSaturation(input(50))!.severity).toBe("CRITICAL");
  });
});

// ── B. 매매 차단 승격 영구 차단 불변식 ──────────────────────────────────────
describe("B. 불변식 — 매매 차단·시장 신호로 절대 승격 안 함", () => {
  it("모든 severity 의 classification 이 executionImpact=NONE / marketSignal=false / providerIssue=false / dataVacuum=false / newBuyBlocked=false / kisImpact=NONE", () => {
    for (const count of [35, 45, 55]) {
      const c = classifyWatchlistSaturation(input(count))!;
      expect(c.executionImpact).toBe("NONE");
      expect(c.marketSignal).toBe(false);
      expect(c.kisImpact).toBe("NONE");
      expect(c.providerIssue).toBe(false);
      expect(c.dataVacuum).toBe(false);
      expect(c.newBuyBlocked).toBe(false);
    }
  });

  it("CRITICAL 도 watchlistIntakeBlocked=true 일 뿐 newBuyBlocked=false / executionImpact=NONE", () => {
    const c = classifyWatchlistSaturation(input(60))!;
    expect(c.watchlistIntakeBlocked).toBe(true);
    expect(c.newBuyBlocked).toBe(false);
    expect(c.executionImpact).toBe("NONE");
  });
});

// ── C. autoRatio / sourceDistribution ───────────────────────────────────────
describe("C. autoRatio / sourceDistribution 집계", () => {
  it("autoRatio = autoCount / (auto+manual+dart)", () => {
    const c = classifyWatchlistSaturation(
      input(40, { autoCount: 32, manualCount: 6, dartCount: 2 }),
    )!;
    expect(c.autoRatio).toBeCloseTo(0.8, 5);
    expect(c.sourceDistribution).toEqual({ AUTO: 32, MANUAL: 6, DART: 2 });
  });

  it("source 0건 → autoRatio 0 (division-by-zero 안전)", () => {
    const c = classifyWatchlistSaturation(
      input(30, { autoCount: 0, manualCount: 0, dartCount: 0 }),
    )!;
    expect(c.autoRatio).toBe(0);
  });
});

// ── D. cooldown 상태머신 ────────────────────────────────────────────────────
describe("D. evaluateWatchlistSaturationAlert — cooldown 상태머신", () => {
  it("최초 호출 → shouldEmit=true / FIRST_ALERT", () => {
    const { decision } = evaluateWatchlistSaturationAlert(input(35), BASE_NOW);
    expect(decision.shouldEmit).toBe(true);
    expect(decision.emitReason).toBe("FIRST_ALERT");
  });

  it("cooldown 내 동일 severity·count → shouldEmit=false / COOLDOWN_ACTIVE", () => {
    const first = evaluateWatchlistSaturationAlert(input(35), BASE_NOW);
    recordWatchlistSaturationAlertSent(first.classification!, BASE_NOW);
    const fiveMinLater = new Date(BASE_NOW.getTime() + 5 * 60 * 1000);
    const { decision } = evaluateWatchlistSaturationAlert(input(35), fiveMinLater);
    expect(decision.shouldEmit).toBe(false);
    expect(decision.suppressionReason).toBe("COOLDOWN_ACTIVE");
    expect(decision.cooldownRemainingMs).toBeGreaterThan(0);
  });

  it("severity 상승 (ADVISORY→WARNING) → cooldown 무시 / SEVERITY_ESCALATED", () => {
    const first = evaluateWatchlistSaturationAlert(input(35), BASE_NOW);
    recordWatchlistSaturationAlertSent(first.classification!, BASE_NOW);
    const oneMinLater = new Date(BASE_NOW.getTime() + 60 * 1000);
    const { decision } = evaluateWatchlistSaturationAlert(input(42), oneMinLater);
    expect(decision.shouldEmit).toBe(true);
    expect(decision.emitReason).toBe("SEVERITY_ESCALATED");
  });

  it("soft cap 최초 도달 → cooldown 무시 / SOFT_CAP_FIRST_REACHED", () => {
    // 최초 발송이 soft cap 이면 FIRST_ALERT — soft 미만 발송 후 soft 진입 케이스로 검증
    const first = evaluateWatchlistSaturationAlert(input(38), BASE_NOW);
    recordWatchlistSaturationAlertSent(first.classification!, BASE_NOW);
    const oneMinLater = new Date(BASE_NOW.getTime() + 60 * 1000);
    const { decision } = evaluateWatchlistSaturationAlert(input(40), oneMinLater);
    expect(decision.shouldEmit).toBe(true);
    // severity 도 동시에 상승 — SEVERITY_ESCALATED 또는 SOFT_CAP_FIRST_REACHED 둘 다 발송 사유로 유효
    expect(["SEVERITY_ESCALATED", "SOFT_CAP_FIRST_REACHED"]).toContain(
      decision.emitReason,
    );
  });

  it("count delta +5 이상 → cooldown 무시 / COUNT_DELTA_EXCEEDED", () => {
    const first = evaluateWatchlistSaturationAlert(input(31), BASE_NOW);
    recordWatchlistSaturationAlertSent(first.classification!, BASE_NOW);
    const oneMinLater = new Date(BASE_NOW.getTime() + 60 * 1000);
    const { decision } = evaluateWatchlistSaturationAlert(input(36), oneMinLater);
    expect(decision.shouldEmit).toBe(true);
    expect(decision.emitReason).toBe("COUNT_DELTA_EXCEEDED");
  });

  it("count delta +4 (임계 미만) → cooldown 유지 / COOLDOWN_ACTIVE", () => {
    const first = evaluateWatchlistSaturationAlert(input(31), BASE_NOW);
    recordWatchlistSaturationAlertSent(first.classification!, BASE_NOW);
    const oneMinLater = new Date(BASE_NOW.getTime() + 60 * 1000);
    const { decision } = evaluateWatchlistSaturationAlert(input(34), oneMinLater);
    expect(decision.shouldEmit).toBe(false);
    expect(decision.suppressionReason).toBe("COOLDOWN_ACTIVE");
  });

  it("alertCap 미만 재진입 후 다시 alert → cooldown 무시 / REENTERED_AFTER_BELOW_ALERT", () => {
    const first = evaluateWatchlistSaturationAlert(input(35), BASE_NOW);
    recordWatchlistSaturationAlertSent(first.classification!, BASE_NOW);
    // count 가 alertCap 미만으로 하락 — below-alert 관찰 기록
    const t1 = new Date(BASE_NOW.getTime() + 60 * 1000);
    const below = evaluateWatchlistSaturationAlert(input(25), t1);
    expect(below.classification).toBeNull();
    expect(below.decision.suppressionReason).toBe("BELOW_ALERT");
    // 다시 alert 진입 (cooldown 내) → REENTERED
    const t2 = new Date(BASE_NOW.getTime() + 2 * 60 * 1000);
    const { decision } = evaluateWatchlistSaturationAlert(input(33), t2);
    expect(decision.shouldEmit).toBe(true);
    expect(decision.emitReason).toBe("REENTERED_AFTER_BELOW_ALERT");
  });

  it("cooldown 만료 후 → shouldEmit=true / COOLDOWN_EXPIRED", () => {
    const first = evaluateWatchlistSaturationAlert(input(35), BASE_NOW);
    recordWatchlistSaturationAlertSent(first.classification!, BASE_NOW);
    const after31min = new Date(BASE_NOW.getTime() + 31 * 60 * 1000);
    const { decision } = evaluateWatchlistSaturationAlert(input(36), after31min);
    expect(decision.shouldEmit).toBe(true);
    expect(decision.emitReason).toBe("COOLDOWN_EXPIRED");
  });

  it("ENV WATCHLIST_OVERFLOW_ALERT_DISABLED=true → shouldEmit=false / ALERT_DISABLED", () => {
    process.env.WATCHLIST_OVERFLOW_ALERT_DISABLED = "true";
    expect(isWatchlistSaturationAlertDisabled()).toBe(true);
    const { decision } = evaluateWatchlistSaturationAlert(input(55), BASE_NOW);
    expect(decision.shouldEmit).toBe(false);
    expect(decision.suppressionReason).toBe("ALERT_DISABLED");
  });

  it("ENV WATCHLIST_SATURATION_COOLDOWN_MIN override — 60분 설정 시 31분 후에도 cooldown 유지", () => {
    process.env.WATCHLIST_SATURATION_COOLDOWN_MIN = "60";
    const first = evaluateWatchlistSaturationAlert(input(35), BASE_NOW);
    recordWatchlistSaturationAlertSent(first.classification!, BASE_NOW);
    const after31min = new Date(BASE_NOW.getTime() + 31 * 60 * 1000);
    const { decision } = evaluateWatchlistSaturationAlert(input(36), after31min);
    expect(decision.shouldEmit).toBe(false);
    expect(decision.suppressionReason).toBe("COOLDOWN_ACTIVE");
  });

  it("count < alertCap → classification=null / BELOW_ALERT (직전 발송 이력 없어도 안전)", () => {
    const { classification, decision } = evaluateWatchlistSaturationAlert(
      input(20),
      BASE_NOW,
    );
    expect(classification).toBeNull();
    expect(decision.shouldEmit).toBe(false);
    expect(decision.suppressionReason).toBe("BELOW_ALERT");
  });
});

// ── E. 메시지 빌더 ──────────────────────────────────────────────────────────
describe("E. buildWatchlistSaturationMessage — severity 별 메시지", () => {
  it("ADVISORY → '용량 주의' 표기, '포화' 표현 없음", () => {
    const msg = buildWatchlistSaturationMessage(classifyWatchlistSaturation(input(35))!);
    expect(msg).toContain("용량 주의");
    expect(msg).not.toContain("포화");
    expect(msg).not.toContain("Soft Cap");
    expect(msg).not.toContain("Hard Cap");
  });

  it("WARNING → 'Soft Cap 경고' 표기", () => {
    const msg = buildWatchlistSaturationMessage(classifyWatchlistSaturation(input(45))!);
    expect(msg).toContain("Soft Cap 경고");
  });

  it("CRITICAL → 'Hard Cap 도달' + watchlistIntakeBlocked=true 안내", () => {
    const msg = buildWatchlistSaturationMessage(classifyWatchlistSaturation(input(52))!);
    expect(msg).toContain("Hard Cap 도달");
    expect(msg).toContain("watchlistIntakeBlocked=true");
  });

  it("모든 메시지에 executionImpact=NONE / marketSignal=false / providerIssue=false / kisImpact=NONE 라인 포함", () => {
    for (const count of [35, 45, 55]) {
      const msg = buildWatchlistSaturationMessage(classifyWatchlistSaturation(input(count))!);
      expect(msg).toContain("executionImpact=NONE");
      expect(msg).toContain("marketSignal=false");
      expect(msg).toContain("providerIssue=false");
      expect(msg).toContain("kisImpact=NONE");
    }
  });

  it("출처 분포 라인 — AUTO/MANUAL/DART > 0 인 것만 표기", () => {
    const msg = buildWatchlistSaturationMessage(
      classifyWatchlistSaturation(
        input(40, { autoCount: 32, manualCount: 8, dartCount: 0 }),
      )!,
    );
    expect(msg).toContain("AUTO 32");
    expect(msg).toContain("MANUAL 8");
    expect(msg).not.toContain("DART 0");
  });

  it("ADVISORY + AUTO 비중 0.8 이상 → autoPopulate 감속 권고 (강제 정리 없음)", () => {
    const msg = buildWatchlistSaturationMessage(
      classifyWatchlistSaturation(
        input(35, { autoCount: 35, manualCount: 0, dartCount: 0 }),
      )!,
    );
    expect(msg).toContain("autoPopulate 감속 권고");
    expect(msg).toContain("강제 정리 없음");
  });
});

// ── F. 진단 로그 ────────────────────────────────────────────────────────────
describe("F. 진단 로그 — sent / suppressed / status", () => {
  it("formatWatchlistSaturationSentLog → [WATCHLIST_SATURATION_ALERT_SENT] + 불변식 표기", () => {
    const log = formatWatchlistSaturationSentLog(
      classifyWatchlistSaturation(input(45))!,
      "COOLDOWN_EXPIRED",
    );
    expect(log).toContain("[WATCHLIST_SATURATION_ALERT_SENT]");
    expect(log).toContain("section=MOMENTUM");
    expect(log).toContain("severity=WARNING");
    expect(log).toContain("reason=COOLDOWN_EXPIRED");
    expect(log).toContain("executionImpact=NONE");
    expect(log).toContain("marketSignal=false");
    expect(log).toContain("dataVacuum=false");
    expect(log).toContain("newBuyBlocked=false");
  });

  it("formatWatchlistSaturationSuppressedLog → [WATCHLIST_SATURATION_ALERT_SUPPRESSED] + suppressionReason", () => {
    const first = evaluateWatchlistSaturationAlert(input(35), BASE_NOW);
    recordWatchlistSaturationAlertSent(first.classification!, BASE_NOW);
    const fiveMinLater = new Date(BASE_NOW.getTime() + 5 * 60 * 1000);
    const { classification, decision } = evaluateWatchlistSaturationAlert(
      input(35),
      fiveMinLater,
    );
    const log = formatWatchlistSaturationSuppressedLog(classification!, decision);
    expect(log).toContain("[WATCHLIST_SATURATION_ALERT_SUPPRESSED]");
    expect(log).toContain("reason=COOLDOWN_ACTIVE");
    expect(log).toContain("executionImpact=NONE");
  });

  it("formatWatchlistSaturationStatusLog → [WATCHLIST_SATURATION_STATUS] + caps 표기", () => {
    const log = formatWatchlistSaturationStatusLog(
      classifyWatchlistSaturation(input(35))!,
    );
    expect(log).toContain("[WATCHLIST_SATURATION_STATUS]");
    expect(log).toContain("alertCap=30");
    expect(log).toContain("softCap=40");
    expect(log).toContain("hardCap=50");
  });
});

// ── H. 정적 가드 — 신규 KIS/Shadow 호출 0건 ─────────────────────────────────
/** 주석(블록/라인) 제거 후 코드 본문만 검사 — 헤더 docstring 의 산문 매칭 차단. */
function stripComments(src: string): string {
  return src.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/.*$/gm, "");
}

describe("H. 정적 가드 — KIS/Shadow 의존 0건", () => {
  it("watchlistSaturationPolicy.ts 는 KIS client / Shadow 포지션 모듈을 import·호출하지 않는다", () => {
    const code = stripComments(
      readFileSync(
        fileURLToPath(new URL("./watchlistSaturationPolicy.ts", import.meta.url)),
        "utf-8",
      ),
    );
    expect(code).not.toMatch(/from\s+["'].*kisClient/);
    expect(code).not.toMatch(/from\s+["'].*shadowTradeRepo/);
    expect(code).not.toMatch(/from\s+["'].*shadowPositionLifecycle/);
    expect(code).not.toMatch(/\bgetPrice\s*\(|\bfetchCurrentPrice\s*\(|\bplaceKis\w*\s*\(/);
  });
});
