// @responsibility R6 recovery transition guard unit coverage.
import { describe, expect, it, afterEach } from "vitest";
import type { MacroState } from "../persistence/macroStateRepo.js";
import { defaultRegimeTransitionState } from "../persistence/regimeTransitionStateRepo.js";
import { evaluateR6RecoveryTransition, getRawRegime } from "./regimeBridge.js";

function macro(overrides: Partial<MacroState> = {}): MacroState {
  return {
    mhs: 70,
    regime: "GREEN",
    updatedAt: "2026-05-17T00:00:00.000Z",
    vkospi: 18,
    vkospiDayChange: -5,
    usdKrwDayChange: 0.5,
    usdKrw20dChange: -1,
    kospiDayReturn: 0.5,
    kospi20dReturn: 2,
    kospiAbove20MA: true,
    kospiAbove60MA: false,
    foreignNetBuy5d: 1000,
    passiveActiveBoth: false,
    vkospi5dTrend: -4,
    spx20dReturn: 2,
    vix: 17,
    dxy5dChange: -1,
    shortSellingRatio: 5,
    ...overrides,
  };
}

afterEach(() => {
  delete process.env.R6_RECOVERY_COOLDOWN_MINUTES;
  delete process.env.R6_RECOVERY_REQUIRE_CONFIRMATIONS;
  delete process.env.R6_RECOVERY_MAX_IMMEDIATE_REGIME;
});

describe("R6 Recovery Transition Guard", () => {
  it("keeps raw/effective R6 while R6 trigger is active", () => {
    const now = new Date("2026-05-17T00:00:00.000Z");
    const r6Macro = macro({ vkospiDayChange: 31 });
    const rawRegime = getRawRegime(r6Macro);
    const state = evaluateR6RecoveryTransition(
      defaultRegimeTransitionState(now.toISOString()),
      r6Macro,
      rawRegime,
      now,
    );

    expect(rawRegime).toBe("R6_DEFENSE");
    expect(state.effectiveRegime).toBe("R6_DEFENSE");
    expect(state.r6RecoveryStatus).toBe("R6_PANIC");
  });

  it("marks KOSPI intraday low shock as active R6 trigger and latches it", () => {
    const now = new Date("2026-05-17T00:00:00.000Z");
    const shockMacro = macro({
      mhs: 70,
      vkospi: 18,
      vix: 19,
      kospiIntradayLowReturn: -7.64,
      kospiCloseReturn: -0.37,
      kospiDayReturn: -0.37,
    });
    const rawRegime = getRawRegime(shockMacro, now);
    const state = evaluateR6RecoveryTransition(
      defaultRegimeTransitionState(now.toISOString()),
      shockMacro,
      rawRegime,
      now,
    );

    expect(rawRegime).toBe("R6_DEFENSE");
    expect(state.r6TriggerBreakdown.activeR6Triggers).toContain(
      "KOSPI_INTRADAY_LOW_SHOCK",
    );
    expect(state.r6ShockLatch).toBe(true);
    expect(state.r6ShockLatchDetail?.expiresAt).toBe("2026-05-17T18:00:00.000Z");
    expect(state.r6ShockLatchDetail?.releaseEligibleAt).toBe("2026-05-17T03:00:00.000Z");
    expect(state.r6ShockLatchDetail?.decayLevel).toBe(0);
    expect(state.transitionReason).toBe(
      "RAW_R6_ACTIVE_BY_KOSPI_INTRADAY_LOW_SHOCK",
    );
  });

  it("does not increase recovery confirmations before close recovery evidence is eligible", () => {
    process.env.R6_RECOVERY_COOLDOWN_MINUTES = "0";
    const now = new Date("2026-05-17T00:00:00.000Z");
    const previous = {
      ...defaultRegimeTransitionState(now.toISOString()),
      currentRegime: "R6_DEFENSE" as const,
      rawRegime: "R6_DEFENSE" as const,
      effectiveRegime: "R6_DEFENSE" as const,
      r6RecoveryStatus: "IN_R6" as const,
      r6ShockLatch: true,
      r6ShockLatchReason: "KOSPI_INTRADAY_LOW_SHOCK" as const,
      sourceUpdatedAt: "2026-05-17T00:00:00.000Z",
    };
    const notClosedMacro = macro({
      updatedAt: "2026-05-17T00:01:00.000Z",
      kospiCloseReturn: -2.5,
      kospiDayReturn: -2.5,
      kospiIntradayLowReturn: -4,
    });
    const state = evaluateR6RecoveryTransition(
      previous,
      notClosedMacro,
      "R3_EARLY",
      new Date("2026-05-17T00:01:00.000Z"),
    );

    expect(state.effectiveRegime).toBe("R6_DEFENSE");
    expect(state.recoveryConfirmations).toBe(0);
    expect(state.recoveryBlockedReason).toBe(
      "WAITING_FOR_CLOSE_OR_NEXT_TRADING_DAY_CONFIRMATION",
    );
  });

  it("caps an immediate R6 exit to R5 during cooldown even if raw regime is R3", () => {
    process.env.R6_RECOVERY_COOLDOWN_MINUTES = "240";
    const now = new Date("2026-05-17T00:00:00.000Z");
    const previous = {
      ...defaultRegimeTransitionState(now.toISOString()),
      currentRegime: "R6_DEFENSE" as const,
      rawRegime: "R6_DEFENSE" as const,
      effectiveRegime: "R6_DEFENSE" as const,
      r6RecoveryStatus: "IN_R6" as const,
      enteredR6At: "2026-05-16T00:00:00.000Z",
    };
    const recoveredMacro = macro();
    const rawRegime = getRawRegime(recoveredMacro);
    const state = evaluateR6RecoveryTransition(
      previous,
      recoveredMacro,
      rawRegime,
      now,
    );

    expect(rawRegime).toBe("R3_EARLY");
    expect(state.effectiveRegime).toBe("R5_CAUTION");
    expect(state.r6RecoveryStatus).toBe("R6_RECOVERY_WATCH");
    expect(state.cooldownUntil).toBe("2026-05-17T04:00:00.000Z");
  });

  it("blocks R6 recovery when market data is stale", () => {
    process.env.R6_RECOVERY_COOLDOWN_MINUTES = "0";
    const now = new Date("2026-05-17T00:00:00.000Z");
    const previous = {
      ...defaultRegimeTransitionState(now.toISOString()),
      currentRegime: "R6_DEFENSE" as const,
      rawRegime: "R6_DEFENSE" as const,
      effectiveRegime: "R6_DEFENSE" as const,
      r6RecoveryStatus: "IN_R6" as const,
      previousR6Triggers: ["KOSPI_CLOSE_SHOCK" as const],
    };
    const staleMacro = macro({ updatedAt: "2026-05-15T00:00:00.000Z" });
    const state = evaluateR6RecoveryTransition(
      previous,
      staleMacro,
      getRawRegime(staleMacro),
      now,
    );

    expect(state.r6RecoveryStatus).toBe("STALE_DATA_BLOCKED");
    expect(state.effectiveRegime).toBe("R6_DEFENSE");
    expect(state.r6RecoveryEvidence.marketDataFreshnessOk).toBe(false);
  });


  it("transitions from R6_DEFENSE to R6_RECOVERY_WATCH after latch release eligibility", () => {
    process.env.R6_RECOVERY_COOLDOWN_MINUTES = "240";
    process.env.R6_RECOVERY_REQUIRE_CONFIRMATIONS = "2";
    const previous = {
      ...defaultRegimeTransitionState("2026-05-17T00:00:00.000Z"),
      currentRegime: "R6_DEFENSE" as const,
      rawRegime: "R6_DEFENSE" as const,
      effectiveRegime: "R6_DEFENSE" as const,
      r6RecoveryStatus: "R6_DEFENSE" as const,
      r6StateMachineState: "R6_DEFENSE" as const,
      r6ShockLatch: true,
      r6ShockLatchReason: "KOSPI_CLOSE_SHOCK" as const,
      latchTriggeredAt: "2026-05-17T00:00:00.000Z",
      latchExpiresAt: "2026-05-18T00:00:00.000Z",
      latchReleaseEligibleAt: "2026-05-17T06:00:00.000Z",
      latchDecayPercent: 40,
      sourceUpdatedAt: "2026-05-17T00:00:00.000Z",
    };
    const state = evaluateR6RecoveryTransition(
      previous,
      macro({ updatedAt: "2026-05-17T06:10:00.000Z", kospiCloseReturn: 0.2 }),
      "R3_EARLY",
      new Date("2026-05-17T06:10:00.000Z"),
    );

    expect(state.r6RecoveryStatus).toBe("R6_RECOVERY_WATCH");
    expect(state.r6StateMachineState).toBe("R6_RECOVERY_WATCH");
    expect(state.effectiveRegime).toBe("R5_CAUTION");
    expect(state.r6ShockLatch).toBe(true);
    expect(state.latchDecayPercent).toBeGreaterThanOrEqual(60);
  });

  it("requires consecutive confirmations before RECOVERED", () => {
    process.env.R6_RECOVERY_COOLDOWN_MINUTES = "0";
    process.env.R6_RECOVERY_REQUIRE_CONFIRMATIONS = "2";
    const now = new Date("2026-05-17T00:00:00.000Z");
    const previous = {
      ...defaultRegimeTransitionState(now.toISOString()),
      currentRegime: "R6_DEFENSE" as const,
      rawRegime: "R6_DEFENSE" as const,
      effectiveRegime: "R6_DEFENSE" as const,
      r6RecoveryStatus: "IN_R6" as const,
    };
    const first = evaluateR6RecoveryTransition(
      previous,
      macro(),
      "R3_EARLY",
      now,
    );
    const second = evaluateR6RecoveryTransition(
      first,
      macro({ updatedAt: "2026-05-17T00:01:00.000Z" }),
      "R3_EARLY",
      new Date("2026-05-17T00:01:00.000Z"),
    );

    expect(first.r6RecoveryStatus).not.toBe("RECOVERED");
    expect(first.effectiveRegime).toBe("R5_CAUTION");
    expect(second.r6RecoveryStatus).toBe("R5_STABILIZING");
    expect(second.r6StateMachineState).toBe("R5_STABILIZING");
    expect(second.effectiveRegime).toBe("R3_EARLY");
  });
});
