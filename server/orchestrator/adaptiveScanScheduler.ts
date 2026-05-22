// @responsibility adaptiveScanScheduler R6 recovery shadow scan overlay.
import { sendTelegramAlert } from '../alerts/telegramClient.js';
import { loadMacroState } from '../persistence/macroStateRepo.js';
import { getRegimeDiagnostics, type RegimeDiagnostics } from '../trading/regimeBridge.js';
import type { BiasLabel, ShadowCandidateScanTrigger } from '../trading/marketStateResolver.js';
import * as base from './adaptiveScanScheduler.base.js';

export * from './adaptiveScanScheduler.base.js';

const RECOVERY_SHADOW_SCAN_COOLDOWN_MS = 30 * 60_000;
let lastR6RecoveryScanKey: string | null = null;
let lastR6RecoveryCandidateScanAt = 0;

type R6RecoveryShadowScanState = 'R6_DEFENSE' | 'R6_CONFIRMATION_WAIT' | 'R6_RECOVERY_WATCH';

function finiteNumber(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isFinite(value) ? value : undefined;
}

function resolveSchedulerBiasScore(macroState: Record<string, unknown> | null | undefined): number {
  if (!macroState) return 0;
  for (const key of ['biasScore', 'directionBiasScore', 'preMarketBiasScore', 'marketBiasScore', 'globalBiasScore', 'riskBiasScore', 'bias']) {
    const explicit = finiteNumber(macroState[key]);
    if (explicit !== undefined) return Math.max(-100, Math.min(100, explicit));
  }
  return 0;
}

function resolveSchedulerBiasLabel(score: number): BiasLabel {
  if (score <= -20) return 'BEAR';
  if (score >= 20) return 'BULL';
  return 'NEUTRAL';
}

function isR6ConfirmationWaitDiagnostics(diagnostics: RegimeDiagnostics): boolean {
  return diagnostics.activeR6Triggers.length === 0 &&
    diagnostics.r6TriggerBreakdown.triggerFreshness === 'FRESH' &&
    diagnostics.r6ShockLatch === true &&
    diagnostics.recoveryBlockedReason === 'WAITING_FOR_CLOSE_OR_NEXT_TRADING_DAY_CONFIRMATION';
}

function resolveR6RecoveryShadowScanState(diagnostics: RegimeDiagnostics): R6RecoveryShadowScanState | undefined {
  if (isR6ConfirmationWaitDiagnostics(diagnostics)) return 'R6_CONFIRMATION_WAIT';
  const state = diagnostics.transitionState.r6StateMachineState;
  if (state === 'R6_RECOVERY_WATCH') return 'R6_RECOVERY_WATCH';
  if (state === 'R6_DEFENSE' || diagnostics.effectiveRegime === 'R6_DEFENSE') return 'R6_DEFENSE';
  return undefined;
}

function resolveR6RecoveryScanKey(diagnostics: RegimeDiagnostics, recoveryState: R6RecoveryShadowScanState): string {
  return [
    diagnostics.transitionState.latchTriggeredAt ??
      diagnostics.transitionState.r6ShockLatchDetail?.triggeredAt ??
      diagnostics.transitionState.latchReleaseEligibleAt ??
      diagnostics.transitionState.latchExpiresAt ??
      'R6_RECOVERY',
    recoveryState,
    'R6_RECOVERY_BIAS_CONFIRMATION',
  ].join(':');
}

function emitShadowCandidateScanTrigger(trigger: ShadowCandidateScanTrigger): void {
  const line = `[SHADOW_CANDIDATE_SCAN_TRIGGER] trigger=${trigger} executionImpact=NONE livePermission=GATE_DATA_ONLY realOrderPermission=GATE_DATA_ONLY rollback=R6_SELLONLY_DISABLED`;
  console.info(line);
  sendTelegramAlert(
    `<b>[Shadow candidate scan trigger]</b>\n` +
    `trigger: <code>${trigger}</code>\n` +
    `executionImpact: <code>NONE</code>\n` +
    `legacy R6/SELL_ONLY ignored; buy permission uses Gate/data quality only`,
    { priority: 'NORMAL', dedupeKey: `shadow_candidate_scan:${trigger}`, cooldownMs: RECOVERY_SHADOW_SCAN_COOLDOWN_MS },
  ).catch(console.error);
}

// Backward-compatible labels can still appear in historical summaries:
// emitShadowCandidateScanTrigger('R6_CONFIRMATION_WAIT')
// emitShadowCandidateScanTrigger('BIAS_RECOVERY')
function shouldTriggerRecoveryShadowScan(input: {
  diagnostics: RegimeDiagnostics;
  mhs: number;
  biasScore: number;
  now: number;
}): ShadowCandidateScanTrigger | undefined {
  const shadowLearningAllowed = true;
  const shadowScanAllowed = true;
  if (!shadowLearningAllowed || !shadowScanAllowed) return undefined;
  const postCloseValid = input.diagnostics.sourceFreshness === 'POST_CLOSE_VALID' || input.diagnostics.sourceFreshness === 'EOD_SNAPSHOT_VALID';
  const degradedObserve = input.diagnostics.sourceFreshness === 'SOFT_STALE';
  const macroFresh = input.diagnostics.sourceFreshness === 'FRESH' && input.diagnostics.r6TriggerBreakdown.triggerFreshness === 'FRESH';
  const noActiveR6 = input.diagnostics.activeR6Triggers.length === 0;
  const recoveryState = resolveR6RecoveryShadowScanState(input.diagnostics);
  const lastCandidateScanOld = lastR6RecoveryCandidateScanAt === 0 || input.now - lastR6RecoveryCandidateScanAt >= RECOVERY_SHADOW_SCAN_COOLDOWN_MS;
  if (!recoveryState || !noActiveR6 || !lastCandidateScanOld) return undefined;
  if (postCloseValid || degradedObserve) {
    const trigger: ShadowCandidateScanTrigger = postCloseValid ? 'POST_CLOSE_OBSERVE' : 'DEGRADED_OBSERVE';
    const key = [resolveR6RecoveryScanKey(input.diagnostics, recoveryState), trigger].join(':');
    if (lastR6RecoveryScanKey === key) return undefined;
    lastR6RecoveryScanKey = key;
    lastR6RecoveryCandidateScanAt = input.now;
    emitShadowCandidateScanTrigger(trigger);
    return trigger;
  }
  if (!macroFresh || input.mhs < 60 || input.biasScore < 0) return undefined;
  const key = resolveR6RecoveryScanKey(input.diagnostics, recoveryState);
  if (lastR6RecoveryScanKey === key) return undefined;
  lastR6RecoveryScanKey = key;
  lastR6RecoveryCandidateScanAt = input.now;
  emitShadowCandidateScanTrigger('R6_RECOVERY_BIAS_CONFIRMATION');
  return 'R6_RECOVERY_BIAS_CONFIRMATION';
}

export function decideScan(): base.ScanDecision {
  const now = Date.now();
  const macroState = loadMacroState();
  const diagnostics = getRegimeDiagnostics(macroState);
  const biasScore = resolveSchedulerBiasScore(macroState as Record<string, unknown> | null);
  const biasLabel = resolveSchedulerBiasLabel(biasScore);
  void biasLabel;
  const recoveryShadowTrigger = shouldTriggerRecoveryShadowScan({
    diagnostics,
    mhs: macroState?.mhs ?? 0,
    biasScore,
    now,
  });
  if (recoveryShadowTrigger) {
    return {
      shouldScan: true,
      intervalMinutes: 0,
      reason: `${recoveryShadowTrigger} - shadow candidate scan (executionImpact=NONE, legacy R6/SELL_ONLY ignored)`,
      priority: 'FULL',
      candidateScanTrigger: recoveryShadowTrigger,
    };
  }
  return base.decideScan();
}

export function resetScanState(): void {
  lastR6RecoveryScanKey = null;
  lastR6RecoveryCandidateScanAt = 0;
  base.resetScanState();
}
