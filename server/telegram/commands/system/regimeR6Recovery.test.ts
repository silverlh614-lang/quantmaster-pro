// @responsibility /regime R6 recovery output formatting coverage.
import { describe, expect, it, vi } from "vitest";

vi.mock("../../commandRegistry.js", () => ({
  commandRegistry: { register: vi.fn() },
}));

import { formatR6RecoveryLine } from "./regime.cmd.js";

describe("/regime R6 recovery display", () => {
  it("shows raw recovery status, cooldown, evidence, and reason fields", () => {
    const line = formatR6RecoveryLine({
      r6RecoveryStatus: "COOLDOWN",
      cooldownUntil: "2026-05-17T04:00:00.000Z",
      transitionReason: "R6 exited but recovery confirmation/cooldown required",
      recoveryEvidence: {
        confirmations: 1,
        requiredConfirmations: 2,
        reasons: ["R6_RECOVERY_EVIDENCE_OK"],
      },
    });

    expect(line).toContain("r6RecoveryStatus=COOLDOWN");
    expect(line).toContain("cooldownUntil=2026-05-17T04:00:00.000Z");
    expect(line).toContain("confirmations=1/2");
    expect(line).toContain("recoveryEvidence=R6_RECOVERY_EVIDENCE_OK");
    expect(line).toContain("transitionReason=R6 exited");
  });
});
