export type OperationalWarnSeverity = 'P0' | 'P1' | 'P2' | 'P3' | 'P4' | 'P5';

export type BuyP0WarnCode =
  | 'P0_BUY_SIGNAL_STUCK'
  | 'P0_SHADOW_EXECUTION_STUCK'
  | 'P0_LIVE_EXECUTION_STUCK'
  | 'P0_BUY_STATUS_WRITE_FAILED'
  | 'P0_SHADOW_POSITION_OPEN_FAILED'
  | 'P0_BUY_APPROVAL_POLICY_VIOLATION';

export interface OperationalWarnEvent {
  code: BuyP0WarnCode | string;
  message: string;
  severity?: OperationalWarnSeverity;
  context?: Record<string, unknown>;
  cause?: unknown;
}

export type OperationalWarnEmitter = (event: OperationalWarnEvent) => void;

function inferSeverity(code: string, explicit?: OperationalWarnSeverity): OperationalWarnSeverity {
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

export function emitOperationalWarn(event: OperationalWarnEvent): void {
  const severity = inferSeverity(event.code, event.severity);
  const payload = {
    severity,
    code: event.code,
    ...(event.context ? { context: event.context } : {}),
    ...(event.cause !== undefined ? { cause: describeCause(event.cause) } : {}),
  };
  console.warn(`[${severity}][${event.code}] ${event.message}`, payload);
}
