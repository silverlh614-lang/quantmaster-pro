// @responsibility /regime_transition_status command — persistent R6 recovery transition state diagnostics.
import { loadMacroState } from "../../../persistence/macroStateRepo.js";
import { getRegimeDiagnostics } from "../../../trading/regimeBridge.js";
import { commandRegistry } from "../../commandRegistry.js";
import type { TelegramCommand } from "../_types.js";

const regimeTransitionStatus: TelegramCommand = {
  name: "/regime_transition_status",
  aliases: ["/rts"],
  category: "SYS",
  visibility: "ADMIN",
  riskLevel: 0,
  description: "R6 recovery/cooldown persistent transition state diagnostics",
  async execute({ reply }) {
    const macro = loadMacroState();
    const diagnostics = getRegimeDiagnostics(macro);
    const state = diagnostics.transitionState;
    await reply(
      `🧭 <b>[Regime Transition Status]</b>
` +
        `━━━━━━━━━━━━━━━━
` +
        `previousRegime=${state.previousRegime ?? "N/A"}
` +
        `rawRegime=${state.rawRegime}
` +
        `effectiveRegime=${state.effectiveRegime}
` +
        `enteredR6At=${state.enteredR6At ?? "N/A"}
` +
        `exitedR6At=${state.exitedR6At ?? "N/A"}
` +
        `r6RecoveryStatus=${state.r6RecoveryStatus}
` +
        `cooldownUntil=${state.cooldownUntil ?? "N/A"}
` +
        `confirmations=${state.recoveryConfirmations}/${state.r6RecoveryEvidence.requiredConfirmations}
` +
        `recoveryEvidence=${state.r6RecoveryEvidence.reasons.join(", ")}
` +
        `lastTransitionAt=${state.lastTransitionAt}
` +
        `lastTransitionDirection=${state.transitionDirection}
` +
        `nextAllowedUpgradeAt=${state.cooldownUntil ?? "now"}
` +
        `sourceFreshness=${diagnostics.sourceFreshness}
` +
        `transitionReason=${state.transitionReason}
` +
        `executionImpact=NONE`,
    );
  },
};

commandRegistry.register(regimeTransitionStatus);

export default regimeTransitionStatus;
