// @responsibility /r6_forensic command — R6 trigger/latch/recovery forensic diagnostics.
import { loadMacroState } from '../../../persistence/macroStateRepo.js';
import { getRegimeDiagnostics } from '../../../trading/regimeBridge.js';
import { commandRegistry } from '../../commandRegistry.js';
import type { TelegramCommand } from '../_types.js';
import { formatEngineRuntimePolicy, resolveEngineRuntimePolicy } from '../../../runtime/engineRuntimePolicy.js';

function fmt(value: number | undefined): string { return value === undefined ? 'N/A' : value.toFixed(2); }

const r6Forensic: TelegramCommand = {
  name: '/r6_forensic', aliases: ['/r6f'], category: 'SYS', visibility: 'ADMIN', riskLevel: 0,
  description: 'R6 trigger/latch/recovery forensic diagnostics',
  async execute({ reply }) {
    const macro = loadMacroState();
    const diagnostics = getRegimeDiagnostics(macro);
    const state = diagnostics.transitionState;
    const b = diagnostics.r6TriggerBreakdown;
    const latchAgeMinutes = state.latchTriggeredAt ? Math.max(0, Math.floor((Date.now() - Date.parse(state.latchTriggeredAt)) / 60_000)) : 'N/A';
    const runtimePolicy = resolveEngineRuntimePolicy({
      engineMode: 'NORMAL',
      macroRegime: diagnostics.effectiveRegime,
      liveBuyGateAllowed: diagnostics.effectiveRegime !== 'R6_DEFENSE',
      reasonCodes: diagnostics.effectiveRegime === 'R6_DEFENSE' ? ['R6_DEFENSE'] : [],
    });
    await reply([
      '🧯 <b>[R6 Forensic]</b>', '━━━━━━━━━━━━━━━━',
      `r6Active=${diagnostics.effectiveRegime === 'R6_DEFENSE'}`,
      `rawRegime=${diagnostics.rawRegime}`, `effectiveRegime=${diagnostics.effectiveRegime}`,
      `r6RecoveryStatus=${diagnostics.r6RecoveryStatus}`,
      `activeR6Triggers=[${b.activeR6Triggers.join(',') || 'none'}]`,
      `previousR6Triggers=[${state.previousR6Triggers.join(',') || 'none'}]`,
      `kospiIntradayLowReturn=${fmt(b.kospiIntradayLowReturn)}`, `kospiCloseReturn=${fmt(b.kospiCloseReturn)}`,
      `vkospiDayChange=${fmt(b.vkospiDayChange)}`, `usdKrwDayChange=${fmt(b.usdKrwDayChange)}`,
      `mhsScore=${macro?.mhs ?? 'N/A'}`, `sourceFreshness=${diagnostics.sourceFreshness}`,
      `r6ShockLatch=${state.r6ShockLatch}`, `latchTriggeredAt=${state.latchTriggeredAt ?? 'N/A'}`,
      `latchTriggerValue=${state.latchTriggerValue ?? 'N/A'}`, `latchAgeMinutes=${latchAgeMinutes}`,
      `recoveryBlockedReason=${state.recoveryBlockedReason ?? 'N/A'}`,
      `recoveryEvidence=${state.r6RecoveryEvidence.reasons.join(', ')}`,
      `nextRecoveryCheckAt=${state.cooldownUntil ?? 'next fresh macro refresh'}`,
      `cooldownUntil=${state.cooldownUntil ?? 'N/A'}`,
      `confirmations=${state.recoveryConfirmations}/${state.r6RecoveryEvidence.requiredConfirmations}`,
      formatEngineRuntimePolicy(runtimePolicy),
    ].join('\\n'));
  },
};
commandRegistry.register(r6Forensic);
export default r6Forensic;
