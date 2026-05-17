// @responsibility /r6_forensic output coverage.
import { describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ register: vi.fn() }));
vi.mock("../../commandRegistry.js", () => ({
  commandRegistry: { register: mocks.register },
}));
vi.mock("../../../persistence/macroStateRepo.js", () => ({
  loadMacroState: vi
    .fn()
    .mockReturnValue({
      mhs: 70,
      regime: "GREEN",
      updatedAt: "2026-05-17T00:00:00.000Z",
    }),
}));
vi.mock("../../../trading/regimeBridge.js", () => ({
  getRegimeDiagnostics: vi.fn().mockReturnValue({
    rawRegime: "R6_DEFENSE",
    effectiveRegime: "R6_DEFENSE",
    r6RecoveryStatus: "IN_R6",
    sourceFreshness: "FRESH",
    r6TriggerBreakdown: {
      activeR6Triggers: ["KOSPI_INTRADAY_LOW_SHOCK"],
      staleR6Triggers: [],
      kospiIntradayLowReturn: -7.64,
      kospiCloseReturn: -0.37,
      vkospiDayChange: 0,
      usdKrwDayChange: 0,
      triggerFreshness: "FRESH",
      staleCarryForward: false,
      staleBlockedRecovery: false,
    },
    transitionState: {
      previousR6Triggers: ["KOSPI_INTRADAY_LOW_SHOCK"],
      r6ShockLatch: true,
      latchTriggeredAt: "2026-05-17T00:00:00.000Z",
      latchTriggerValue: -7.64,
      recoveryBlockedReason: "ACTIVE_R6_TRIGGER_PRESENT",
      cooldownUntil: undefined,
      recoveryConfirmations: 0,
      r6RecoveryEvidence: {
        requiredConfirmations: 2,
        reasons: ["NO_RECOVERY_EVALUATION"],
      },
    },
  }),
}));

import command from "./r6Forensic.cmd.js";

describe("/r6_forensic", () => {
  it("prints active triggers, latch, safety flags, and executionImpact", async () => {
    const replies: string[] = [];
    await command.execute({
      reply: async (message: string) => {
        replies.push(message);
      },
    } as any);
    const text = replies.join("\\n");

    expect(mocks.register).toHaveBeenCalled();
    expect(text).toContain("activeR6Triggers=[KOSPI_INTRADAY_LOW_SHOCK]");
    expect(text).toContain("r6ShockLatch=true");
    expect(text).toContain("recoveryBlockedReason=ACTIVE_R6_TRIGGER_PRESENT");
    expect(text).toContain("shadowLearningAllowed=true");
    expect(text).toContain("executionImpact=NONE");
  });
});
