// @responsibility /regime_transition_status output coverage.
import { describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ register: vi.fn() }));
vi.mock("../../commandRegistry.js", () => ({
  commandRegistry: { register: mocks.register },
}));
vi.mock("../../../persistence/macroStateRepo.js", () => ({
  loadMacroState: vi.fn().mockReturnValue({
    mhs: 70,
    regime: "GREEN",
    updatedAt: "2026-05-17T00:00:00.000Z",
  }),
}));
vi.mock("../../../trading/regimeBridge.js", () => ({
  getRegimeDiagnostics: vi.fn().mockReturnValue({
    sourceFreshness: "FRESH",
    transitionState: {
      previousRegime: "R6_DEFENSE",
      rawRegime: "R3_EARLY",
      effectiveRegime: "R5_CAUTION",
      enteredR6At: "2026-05-16T00:00:00.000Z",
      exitedR6At: "2026-05-17T00:00:00.000Z",
      r6RecoveryStatus: "COOLDOWN",
      cooldownUntil: "2026-05-17T04:00:00.000Z",
      recoveryConfirmations: 1,
      r6RecoveryEvidence: {
        requiredConfirmations: 2,
        reasons: ["R6_RECOVERY_EVIDENCE_OK"],
      },
      lastTransitionAt: "2026-05-17T00:00:00.000Z",
      transitionDirection: "RECOVERY",
      transitionReason: "R6 exited but recovery confirmation/cooldown required",
    },
  }),
}));

import command from "./regimeTransitionStatus.cmd.js";

describe("/regime_transition_status", () => {
  it("prints recovery status and cooldown with executionImpact NONE", async () => {
    const replies: string[] = [];
    await command.execute({
      reply: async (message: string) => {
        replies.push(message);
      },
    } as any);
    const text = replies.join("\n");

    expect(mocks.register).toHaveBeenCalled();
    expect(text).toContain("rawRegime=R3_EARLY");
    expect(text).toContain("effectiveRegime=R5_CAUTION");
    expect(text).toContain("r6RecoveryStatus=COOLDOWN");
    expect(text).toContain("cooldownUntil=2026-05-17T04:00:00.000Z");
    expect(text).toContain("executionImpact=NONE");
  });
});
