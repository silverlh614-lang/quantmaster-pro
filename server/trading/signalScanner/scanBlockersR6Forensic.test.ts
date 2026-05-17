// @responsibility /scan_blockers R6 forensic macro gate output coverage.
import { describe, expect, it } from "vitest";
import { formatScanBlockersMessage } from "./scanDiagnostics.js";

describe("/scan_blockers R6 forensic macro gate fields", () => {
  it("shows raw/effective regime, R6 triggers, latch, and shadow/live flags", () => {
    const text = formatScanBlockersMessage({
      time: "09:31 KST",
      waitDistribution: {},
      macroGateState: {
        emergencyStop: false,
        autoTradeEnabled: true,
        regime: "R6_DEFENSE",
        kellyMultiplierFromRegime: 0,
        fomcPhase: "NONE",
        fomcKellyMultiplier: 1,
        finalKellyMultiplier: 0,
        vixGatingActive: false,
        bearDefenseMode: true,
        mhsBelow30: false,
        watchlistEmpty: false,
        sellOnlyMode: false,
        diagnosticLiveEntryBlocked: true,
        liveEntryBlockedReason: "R6_DEFENSE",
        macroRegimeRaw: "R6_DEFENSE",
        macroRegimeEffective: "R6_DEFENSE",
        r6RecoveryStatus: "IN_R6",
        activeR6Triggers: ["KOSPI_INTRADAY_LOW_SHOCK"],
        r6ShockLatch: true,
        recoveryBlockedReason: "ACTIVE_R6_TRIGGER_PRESENT",
        liveEntryAllowed: false,
        shadowLearningAllowed: true,
      },
    } as any);

    expect(text).toContain("raw/effective: R6_DEFENSE → R6_DEFENSE");
    expect(text).toContain("activeR6Triggers: [KOSPI_INTRADAY_LOW_SHOCK]");
    expect(text).toContain("r6ShockLatch: true");
    expect(text).toContain("liveEntryAllowed: false");
    expect(text).toContain("shadowLearningAllowed: true");
  });
});
