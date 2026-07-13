// @responsibility ADR-0523 display-only contradiction guard before Telegram rendering.

import type { SnapshotBundle } from './snapshotBundle.js';

interface DisplayContradiction {
  reason: string;
  severity: 'WARN' | 'ERROR';
  renderBlocked: boolean;
}

export interface DisplayContradictionResult {
  displayConflictDetected: boolean;
  displayConflictReason: string;
  displayRenderBlocked: boolean;
  conflicts: DisplayContradiction[];
}

export function checkDisplayContradictions(bundle: SnapshotBundle): DisplayContradictionResult {
  const conflicts: DisplayContradiction[] = [];
  const regime = bundle.effectiveRegime.toUpperCase();
  const session = bundle.marketSession.toUpperCase();
  const mode = bundle.engineMode.toUpperCase();
  const execution = bundle.execution;
  const provider = bundle.providerHealth;

  if (regime === 'R6_DEFENSE' && ['GREEN', 'OK'].includes(String((bundle as unknown as Record<string, unknown>).nowStatus ?? '').toUpperCase())) {
    conflicts.push({ reason: 'R6_DEFENSE_DISPLAYED_AS_GREEN', severity: 'ERROR', renderBlocked: true });
  }
  if (session === 'HOLIDAY' && (execution?.liveBuyAllowed ?? 0) > 0) {
    conflicts.push({ reason: 'HOLIDAY_LIVE_BUY_ALLOWED', severity: 'ERROR', renderBlocked: true });
  }
  if (mode === 'OBSERVE_ONLY' && execution?.brokerOrderAllowed === true) {
    conflicts.push({ reason: 'OBSERVE_ONLY_BROKER_ORDER_ALLOWED', severity: 'ERROR', renderBlocked: true });
  }
  if (provider?.providerIssue === true && provider.marketSignal === true) {
    conflicts.push({ reason: 'PROVIDER_ISSUE_CONVERTED_TO_MARKET_SIGNAL', severity: 'ERROR', renderBlocked: true });
  }
  if ((bundle.gate3?.ready ?? 0) > 0 && !execution) {
    conflicts.push({ reason: 'GATE3_ENTRY_READY_EXECUTION_SUMMARY_MISSING', severity: 'WARN', renderBlocked: false });
  }
  if (!bundle.shadowLearning) {
    conflicts.push({ reason: 'SHADOW_LEARNING_FALSE', severity: 'ERROR', renderBlocked: true });
  }

  const displayRenderBlocked = conflicts.some(conflict => conflict.renderBlocked);
  return {
    displayConflictDetected: conflicts.length > 0,
    displayConflictReason: conflicts.map(conflict => conflict.reason).join('|') || 'none',
    displayRenderBlocked,
    conflicts,
  };
}

export function formatDisplayConflict(result: DisplayContradictionResult): string {
  if (!result.displayConflictDetected) return '';
  return [
    'DISPLAY_CONFLICT_DETECTED',
    `reason=${result.displayConflictReason}`,
    `displayRenderBlocked=${String(result.displayRenderBlocked)}`,
  ].join('\n');
}
