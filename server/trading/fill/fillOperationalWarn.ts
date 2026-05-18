export type FillP0WarnCode =
  | 'P0_FILL_QUERY_EMPTY'
  | 'P0_FILL_QUERY_FAILED'
  | 'P0_SELL_FILL_MONITOR_DEGRADED'
  | 'P0_SELL_REISSUE_FAILED'
  | 'P0_SELL_REISSUE_DUPLICATE_BLOCKED'
  | 'P0_PROVISIONAL_FILL_RECONCILE_FAILED';

export interface FillOperationalWarnEvent {
  code: FillP0WarnCode | string;
  message: string;
  severity?: 'P0' | 'P1' | 'P2' | 'P3' | 'P4' | 'P5';
  context?: Record<string, unknown>;
  cause?: unknown;
}

function severityFor(code: string, explicit?: FillOperationalWarnEvent['severity']): NonNullable<FillOperationalWarnEvent['severity']> {
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

export function emitOperationalWarn(event: FillOperationalWarnEvent): void {
  const severity = severityFor(event.code, event.severity);
  console.warn(`[${severity}][${event.code}] ${event.message}`, {
    severity,
    code: event.code,
    ...(event.context ? { context: event.context } : {}),
    ...(event.cause !== undefined ? { cause: describeCause(event.cause) } : {}),
  });
}
