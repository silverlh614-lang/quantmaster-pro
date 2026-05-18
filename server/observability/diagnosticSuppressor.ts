// @responsibility Dedicated P3 diagnostic warning suppressor with compact summaries.

import { emitMaintenanceWarn, type MaintenanceWarnSource } from './maintenanceWarn.js';
import type { OperationalWarnEmission } from './operationalWarnTypes.js';

export interface EmitDiagnosticSuppressedWarnInput {
  code?: string;
  message: string;
  source?: MaintenanceWarnSource;
  dedupKey: string;
  error?: unknown;
  details?: Record<string, unknown>;
}

export function emitDiagnosticSuppressedWarn(input: EmitDiagnosticSuppressedWarnInput): OperationalWarnEmission {
  return emitMaintenanceWarn({
    domain: 'DIAGNOSTIC',
    code: input.code ?? 'P3_DIAGNOSTIC_SUPPRESSED',
    message: input.message,
    source: input.source ?? 'HEALTH_DIAGNOSTICS',
    dedupKey: input.dedupKey,
    error: input.error,
    details: {
      diagnosticFailureIsolated: true,
      stackSuppressed: true,
      ...(input.details ?? {}),
    },
  });
}
