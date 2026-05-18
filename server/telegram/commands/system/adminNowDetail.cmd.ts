// @responsibility Admin NOW detail/debug command — full reasonCodes and market-state diagnostics.
import { loadMacroState } from '../../../persistence/macroStateRepo.js';
import { getRegimeDiagnostics } from '../../../trading/regimeBridge.js';
import { RegimeResolver } from '../../../trading/marketStateResolver.js';
import { commandRegistry } from '../../commandRegistry.js';
import type { TelegramCommand } from '../_types.js';

function fmt(value: unknown): string {
  if (value === undefined || value === null || value === '') return 'N/A';
  if (typeof value === 'number') return Number.isFinite(value) ? value.toFixed(2) : 'N/A';
  return String(value);
}

export function formatAdminNowDetail(now: Date = new Date()): string {
  const macro = loadMacroState();
  const snapshot = RegimeResolver.resolveMarketState(now);
  const diagnostics = getRegimeDiagnostics(macro, now);
  const latch = diagnostics.transitionState;
  return [
    '🛠️ <b>[admin_now_detail]</b>',
    `snapshotId=${snapshot.snapshotId}`,
    `effectiveRegime=${snapshot.effectiveRegime} detectedRegime=${snapshot.detectedRegime} riskOverride=${snapshot.riskOverride}`,
    `liveNewBuyAllowed=${snapshot.liveNewBuyAllowed} liveSellAllowed=${snapshot.liveSellAllowed} positionManagementAllowed=${snapshot.positionManagementAllowed} shadowLearningAllowed=${snapshot.shadowLearningAllowed} shadowScanAllowed=${snapshot.shadowScanAllowed} shadowPaperFillAllowed=${snapshot.shadowPaperFillAllowed} executionMode=${snapshot.executionMode}`,
    `reasonCodes=${snapshot.reasonCodes.join(', ') || 'NONE'}`,
    '',
    '<b>macroState</b>',
    `stale=${snapshot.macroState.stale} freshness=${snapshot.macroState.freshness}`,
    `lastUpdatedAt=${fmt(snapshot.macroState.lastUpdatedAt)}`,
    `ageSec=${fmt(snapshot.macroState.ageSec)} ttlSec=${snapshot.macroState.ttlSec} softStaleSec=${snapshot.macroState.softStaleSec} hardStaleSec=${snapshot.macroState.hardStaleSec}`,
    `staleReason=${snapshot.macroState.staleReason}`,
    `lastRefreshAttemptAt=${fmt(snapshot.macroState.lastRefreshAttemptAt)}`,
    `lastRefreshSuccessAt=${fmt(snapshot.macroState.lastRefreshSuccessAt)}`,
    `lastRefreshError=${fmt(snapshot.macroState.lastRefreshError)}`,
    `refreshJobEnabled=${fmt(snapshot.macroState.refreshJobEnabled)} refreshBlockedReason=${fmt(snapshot.macroState.refreshBlockedReason)}`,
    `providerUsed=${fmt(snapshot.macroState.providerUsed)} fallbackUsed=${fmt(snapshot.macroState.fallbackUsed)}`,
    `executionImpact=${snapshot.macroState.executionImpact}`,
    '',
    '<b>R6 latch</b>',
    `r6RecoveryStatus=${diagnostics.r6RecoveryStatus} stateMachine=${fmt(diagnostics.transitionState.r6StateMachineState)} recoveryBlockedReason=${fmt(diagnostics.recoveryBlockedReason)}`,
    `r6ShockLatch=${diagnostics.r6ShockLatch} triggerType=${fmt(latch.r6ShockLatchReason)}`,
    `triggeredAt=${fmt(latch.latchTriggeredAt)} severity=${fmt(latch.latchTriggerValue)}`,
    `expiresAt=${fmt(latch.latchExpiresAt)} decayLevel=${fmt(latch.latchDecayLevel)} decayPercent=${fmt(latch.latchDecayPercent)} decayBlockedReason=${fmt(snapshot.r6Latch?.decayBlockedReason)} releaseEligibleAt=${fmt(latch.latchReleaseEligibleAt)}`,
    `activeR6Triggers=${diagnostics.activeR6Triggers.join(',') || 'none'}`,
    `previousR6Triggers=${diagnostics.previousR6Triggers.join(',') || 'none'}`,
    `transitionReason=${diagnostics.transitionReason}`,
  ].join('\n');
}

const adminNowDetail: TelegramCommand = {
  name: '/admin_now_detail',
  aliases: ['/debug_regime', '/debug_market_state'],
  category: 'SYS',
  visibility: 'ADMIN',
  riskLevel: 0,
  description: 'NOW 상세 진단 (전체 reasonCodes/macroState/R6 latch)',
  async execute({ reply }) {
    await reply(formatAdminNowDetail());
  },
};

commandRegistry.register(adminNowDetail);

export default adminNowDetail;
