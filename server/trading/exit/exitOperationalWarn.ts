// @responsibility Operational warnings for exit engine policy failures.
import { emitLegacyOperationalWarn } from '../../observability/legacyOperationalWarnAdapter.js';
import type { ExecutionImpact } from '../../observability/executionImpact.js';

export type ExitP0WarnCode =
  | 'P0_LIVE_EXIT_BLOCKED'
  | 'P0_LIVE_EXIT_DEFERRED_NON_TRADING'
  | 'P0_R6_LIVE_EXIT_POLICY_FAILED'
  | 'P0_R6_SHADOW_FORCE_EXIT_BLOCKED'
  | 'P0_EXIT_SESSION_GUARD_FAILED'
  | 'P0_PENDING_EXIT_INTENT_FAILED';

export interface ExitOperationalWarnEvent {
  code: ExitP0WarnCode | string;
  message: string;
  severity?: 'P0' | 'P1' | 'P2' | 'P3' | 'P4' | 'P5';
  context?: Record<string, unknown>;
  cause?: unknown;
}

function impactForExitCode(code: string): ExecutionImpact {
  if (code === 'P0_R6_SHADOW_FORCE_EXIT_BLOCKED') return 'NONE';
  if (code.includes('DEFERRED_NON_TRADING')) return 'NONE';
  if (code.includes('LIVE_EXIT') || code.includes('PENDING_EXIT')) return 'LIVE_SELL_BLOCKED';
  if (code.includes('SELL_')) return 'LIVE_SELL_BLOCKED';
  return 'EXIT_MONITOR_DEGRADED';
}

export function emitExitOperationalWarn(event: ExitOperationalWarnEvent): void {
  emitLegacyOperationalWarn(event, {
    domain: 'EXIT',
    impactForCode: impactForExitCode,
  });
}
