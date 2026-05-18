export type KisOrderP0WarnCode =
  | 'P0_KIS_BUY_ORDER_BLOCKED'
  | 'P0_KIS_SELL_ORDER_BLOCKED'
  | 'P0_KIS_ORDER_REJECTED'
  | 'P0_KIS_ORDER_FATAL'
  | 'P0_KIS_OCO_ORDER_FAILED'
  | 'P0_KIS_ORDER_RESULT_UNMAPPED';

export interface KisOrderOperationalWarnEvent {
  code: KisOrderP0WarnCode | string;
  message: string;
  severity?: 'P0' | 'P1' | 'P2' | 'P3';
  context?: Record<string, unknown>;
  cause?: unknown;
}

function severityFor(code: string, explicit?: KisOrderOperationalWarnEvent['severity']): NonNullable<KisOrderOperationalWarnEvent['severity']> {
  if (explicit) return explicit;
  if (code.startsWith('P0_')) return 'P0';
  if (code.startsWith('P1_')) return 'P1';
  if (code.startsWith('P2_')) return 'P2';
  return 'P3';
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

export function emitKisOrderOperationalWarn(event: KisOrderOperationalWarnEvent): void {
  const severity = severityFor(event.code, event.severity);
  console.warn(`[${severity}][${event.code}] ${event.message}`, {
    severity,
    code: event.code,
    ...(event.context ? { context: event.context } : {}),
    ...(event.cause !== undefined ? { cause: describeCause(event.cause) } : {}),
  });
}
