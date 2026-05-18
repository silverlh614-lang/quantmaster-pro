// @responsibility Compact diagnostic warning wrapper for scheduler probes.

import { emitOperationalWarn } from './operationalWarn.js';
import { recordP2WarnSummary } from './p2WarnSummary.js';
import { emitDiagnosticSuppressedWarn } from './diagnosticSuppressor.js';
import type { OperationalWarnEmission, WarnPriority } from './operationalWarnTypes.js';
import { compactError } from './providerWarn.js';

export interface DiagnosticWarnInput {
  code?: string;
  message: string;
  priority?: Extract<WarnPriority, 'P2' | 'P3'>;
  dedupKey?: string;
  error?: unknown;
  details?: Record<string, unknown>;
}

export function emitDiagnosticWarn(input: DiagnosticWarnInput): OperationalWarnEmission {
  const priority = input.priority ?? 'P2';
  if (priority === 'P3') {
    return emitDiagnosticSuppressedWarn({
      code: input.code ?? 'P3_DIAGNOSTIC_SUPPRESSED',
      message: input.message,
      dedupKey: input.dedupKey ?? `p3:diagnostic:${input.code ?? 'P3_DIAGNOSTIC_SUPPRESSED'}`,
      error: input.error,
      details: input.details,
    });
  }
  const code = input.code ?? (priority === 'P2' ? 'P2_SCHEDULER_DIAGNOSTIC_DEGRADED' : 'P3_DIAGNOSTIC_SUPPRESSED');
  const emission = emitOperationalWarn({
    priority,
    domain: 'DIAGNOSTIC',
    code,
    message: input.message,
    executionImpact: 'NONE',
    dedupKey: input.dedupKey ?? `${priority.toLowerCase()}:diagnostic:${code}`,
    ttlSec: priority === 'P2' ? 300 : 600,
    details: {
      ...input.details,
      compactError: compactError(input.error),
    },
  });
  recordP2WarnSummary(emission);
  return emission;
}
