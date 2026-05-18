// @responsibility Operational warnings for exit engine policy failures.

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

function severityFor(
  code: string,
  explicit?: ExitOperationalWarnEvent['severity'],
): NonNullable<ExitOperationalWarnEvent['severity']> {
  if (explicit) return explicit;
  if (code.startsWith('P0_')) return 'P0';
  if (code.startsWith('P1_')) return 'P1';
  if (code.startsWith('P2_')) return 'P2';
  if (code.startsWith('P3_')) return 'P3';
  if (code.startsWith('P4_')) return 'P4';
  if (code.startsWith('P5_')) return 'P5';
  return 'P2';
}

function describeCause(cause: unknown): unknown {
  if (cause instanceof Error) {
    return {
      name: cause.name,
      message: cause.message,
      stack: cause.stack,
    };
  }
  return cause;
}

export function emitExitOperationalWarn(event: ExitOperationalWarnEvent): void {
  const severity = severityFor(event.code, event.severity);
  console.warn(`[${severity}][${event.code}] ${event.message}`, {
    severity,
    code: event.code,
    ...(event.context ? { context: event.context } : {}),
    ...(event.cause !== undefined ? { cause: describeCause(event.cause) } : {}),
  });
}
