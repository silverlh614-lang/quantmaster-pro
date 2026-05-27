// @responsibility Validate watchlist cap notification noise policy with trading-safety invariants.

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
  shouldSendWatchlistSaturationTelegram,
  buildWatchlistSaturationDedupeKey,
  resolveWatchlistSaturationTelegramCooldownMs,
  __resetWatchlistSaturationStateForTests,
  type WatchlistSaturationInput,
} from "./watchlistSaturationPolicy.js";

const BASE_NOW = new Date("2026-05-14T00:00:00.000Z");

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

describe("classifyWatchlistSaturation", () => {
  it("returns null below alert cap", () => {
    expect(classifyWatchlistSaturation(input(29))).toBeNull();
    expect(classifyWatchlistSaturation(input(0))).toBeNull();
  });

  it("classifies alert-to-soft as OBSERVE without cleanup", () => {
    const c = classifyWatchlistSaturation(input(35))!;
    expect(c.severity).toBe("ADVISORY");
    expect(c.capStatus).toBe("OBSERVE");
    expect(c.action).toBe("observe");
    expect(c.cleanupTriggered).toBe(false);
    expect(c.cleanupEligible).toBe(false);
    expect(c.watchlistIntakeBlocked).toBe(false);
    expect(c.countBucket).toBe("30~39");
  });

  it("classifies soft-to-hard as SOFT_CAP auto-management", () => {
    const c = classifyWatchlistSaturation(input(45))!;
    expect(c.severity).toBe("WARNING");
    expect(c.capStatus).toBe("SOFT_CAP");
    expect(c.action).toBe("cleanup_or_reduce_intake");
    expect(c.cleanupTriggered).toBe(true);
    expect(c.cleanupEligible).toBe(true);
    expect(c.watchlistIntakeBlocked).toBe(false);
    expect(c.countBucket).toBe("45~49");
  });

  it("classifies hard cap as HARD_CAP with watchlist intake blocked only", () => {
    const c = classifyWatchlistSaturation(input(52))!;
    expect(c.severity).toBe("CRITICAL");
    expect(c.capStatus).toBe("HARD_CAP");
    expect(c.action).toBe("hard_cap_protection");
    expect(c.watchlistIntakeBlocked).toBe(true);
    expect(c.remainingToHard).toBe(0);
    expect(c.countBucket).toBe("50+");
  });

  it("keeps trading safety fields immutable across statuses", () => {
    for (const count of [35, 45, 55]) {
      const c = classifyWatchlistSaturation(input(count))!;
      expect(c.executionImpact).toBe("NONE");
      expect(c.marketSignal).toBe(false);
      expect(c.kisImpact).toBe("NONE");
      expect(c.providerIssue).toBe(false);
      expect(c.dataVacuum).toBe(false);
      expect(c.newBuyBlocked).toBe(false);
      expect(c.tradingLogicChanged).toBe(false);
      expect(c.gateLogicChanged).toBe(false);
      expect(c.orderLogicChanged).toBe(false);
      expect(c.notificationOnly).toBe(true);
      expect(c.watchlistDisplayOnly).toBe(true);
    }
  });

  it("calculates source distribution without provider calls", () => {
    const c = classifyWatchlistSaturation(
      input(40, { autoCount: 32, manualCount: 6, dartCount: 2 }),
    )!;
    expect(c.autoRatio).toBeCloseTo(0.8, 5);
    expect(c.sourceDistribution).toEqual({ AUTO: 32, MANUAL: 6, DART: 2 });
  });
});

describe("evaluateWatchlistSaturationAlert", () => {
  it("suppresses OBSERVE range as log-only", () => {
    const { classification, decision } = evaluateWatchlistSaturationAlert(input(35), BASE_NOW);
    expect(classification?.capStatus).toBe("OBSERVE");
    expect(decision.shouldEmit).toBe(false);
    expect(decision.suppressionReason).toBe("OBSERVE_ONLY");
    expect(shouldSendWatchlistSaturationTelegram(classification!)).toBe(false);
  });

  it("suppresses simple soft cap reach without Telegram", () => {
    const { classification, decision } = evaluateWatchlistSaturationAlert(input(40), BASE_NOW);
    expect(classification?.capStatus).toBe("SOFT_CAP");
    expect(decision.shouldEmit).toBe(false);
    expect(decision.suppressionReason).toBe("SOFT_CAP_NOTIFICATION_SUPPRESSED");
    expect(shouldSendWatchlistSaturationTelegram(classification!)).toBe(false);
  });

  it("allows hard-cap approach when remaining slots are <= 3", () => {
    const { classification, decision } = evaluateWatchlistSaturationAlert(input(47), BASE_NOW);
    expect(classification?.capStatus).toBe("SOFT_CAP");
    expect(classification?.remainingToHard).toBe(3);
    expect(decision.shouldEmit).toBe(true);
    expect(decision.emitReason).toBe("HARD_CAP_APPROACH");
    expect(decision.dedupKey).toBe("2026-05-14:WATCHLIST_SOFT_CAP:MOMENTUM:SOFT_CAP:45~49");
    expect(shouldSendWatchlistSaturationTelegram(classification!)).toBe(true);
  });

  it("suppresses the same section/status/count bucket again on the same day", () => {
    const first = evaluateWatchlistSaturationAlert(input(47), BASE_NOW);
    recordWatchlistSaturationAlertSent(first.classification!, BASE_NOW);
    const later = new Date(BASE_NOW.getTime() + 61 * 60 * 1000);
    const { decision } = evaluateWatchlistSaturationAlert(input(48), later);
    expect(decision.shouldEmit).toBe(false);
    expect(decision.suppressionReason).toBe("COUNT_BUCKET_ALREADY_SENT_TODAY");
  });

  it("allows hard cap with 15 minute default cooldown metadata", () => {
    const { classification, decision } = evaluateWatchlistSaturationAlert(input(50), BASE_NOW);
    expect(classification?.capStatus).toBe("HARD_CAP");
    expect(decision.shouldEmit).toBe(true);
    expect(decision.emitReason).toBe("HARD_CAP_FIRST_REACHED");
    expect(decision.cooldownMs).toBe(15 * 60 * 1000);
    expect(resolveWatchlistSaturationTelegramCooldownMs(classification!)).toBe(15 * 60 * 1000);
  });

  it("supports ENV cooldown override", () => {
    process.env.WATCHLIST_SATURATION_COOLDOWN_MIN = "60";
    const { classification, decision } = evaluateWatchlistSaturationAlert(input(50), BASE_NOW);
    expect(classification?.capStatus).toBe("HARD_CAP");
    expect(decision.cooldownMs).toBe(60 * 60 * 1000);
  });

  it("supports global alert disable", () => {
    process.env.WATCHLIST_OVERFLOW_ALERT_DISABLED = "true";
    expect(isWatchlistSaturationAlertDisabled()).toBe(true);
    const { decision } = evaluateWatchlistSaturationAlert(input(55), BASE_NOW);
    expect(decision.shouldEmit).toBe(false);
    expect(decision.suppressionReason).toBe("ALERT_DISABLED");
  });

  it("returns BELOW_ALERT below the alert cap", () => {
    const { classification, decision } = evaluateWatchlistSaturationAlert(input(20), BASE_NOW);
    expect(classification).toBeNull();
    expect(decision.shouldEmit).toBe(false);
    expect(decision.suppressionReason).toBe("BELOW_ALERT");
  });
});

describe("message and log formatting", () => {
  it("builds hard-cap approach message without soft-cap warning language", () => {
    const c = classifyWatchlistSaturation(input(47))!;
    const msg = buildWatchlistSaturationMessage(c);
    expect(msg).toContain("[Watchlist 확인 필요]");
    expect(msg).not.toContain("Soft Cap \uACBD\uACE0");
    expect(msg).not.toContain("경고");
    expect(msg).toContain("상태: hard cap 접근 — 확인 필요");
    expect(msg).toContain("조치 필요: 확인");
    expect(msg).toContain("watchlistIntakeBlocked=false");
    expect(msg).toContain("executionImpact=NONE");
    expect(msg).toContain("notificationOnly=true");
  });

  it("builds hard-cap message with intake-only impact", () => {
    const msg = buildWatchlistSaturationMessage(classifyWatchlistSaturation(input(52))!);
    expect(msg).toContain("[Watchlist 확인 필요]");
    expect(msg).toContain("상태: hard cap 도달 — 확인 필요");
    expect(msg).toContain("watchlistIntakeBlocked=true");
    expect(msg).toContain("tradingLogicChanged=false");
  });

  it("formats cap evaluated log", () => {
    const log = formatWatchlistSaturationStatusLog(classifyWatchlistSaturation(input(35))!);
    expect(log).toContain("[WATCHLIST_CAP_EVALUATED]");
    expect(log).toContain("alertLimit=30");
    expect(log).toContain("softLimit=40");
    expect(log).toContain("hardLimit=50");
    expect(log).toContain("capStatus=OBSERVE");
  });

  it("formats soft cap observed log", () => {
    const { classification, decision } = evaluateWatchlistSaturationAlert(input(40), BASE_NOW);
    const log = formatWatchlistSaturationSuppressedLog(classification!, decision);
    expect(log).toContain("[WATCHLIST_SOFT_CAP_OBSERVED]");
    expect(log).toContain("telegramSent=false");
    expect(log).toContain("reason=SOFT_CAP_NOTIFICATION_SUPPRESSED");
    expect(log).toContain("executionImpact=NONE");
  });

  it("formats suppressed dedup log", () => {
    const first = evaluateWatchlistSaturationAlert(input(47), BASE_NOW);
    recordWatchlistSaturationAlertSent(first.classification!, BASE_NOW);
    const { classification, decision } = evaluateWatchlistSaturationAlert(
      input(48),
      new Date(BASE_NOW.getTime() + 61 * 60 * 1000),
    );
    const log = formatWatchlistSaturationSuppressedLog(classification!, decision);
    expect(log).toContain("[WATCHLIST_CAP_TELEGRAM_SUPPRESSED]");
    expect(log).toContain("COUNT_BUCKET_ALREADY_SENT_TODAY");
    expect(log).toContain("telegramSent=false");
  });

  it("formats sent log", () => {
    const log = formatWatchlistSaturationSentLog(classifyWatchlistSaturation(input(50))!, "HARD_CAP_FIRST_REACHED");
    expect(log).toContain("[WATCHLIST_CAP_TELEGRAM_SENT]");
    expect(log).toContain("telegramSent=true");
    expect(log).toContain("capStatus=HARD_CAP");
    expect(log).toContain("orderLogicChanged=false");
  });

  it("builds deterministic dedup key", () => {
    const key = buildWatchlistSaturationDedupeKey(classifyWatchlistSaturation(input(47))!, BASE_NOW);
    expect(key).toBe("2026-05-14:WATCHLIST_SOFT_CAP:MOMENTUM:SOFT_CAP:45~49");
  });
});

function stripComments(src: string): string {
  return src.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/.*$/gm, "");
}

describe("static safety", () => {
  it("does not import KIS or Shadow position modules", () => {
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
