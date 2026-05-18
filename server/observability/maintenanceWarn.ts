// @responsibility P3 maintenance warning suppression summary emitter.

import { emitOperationalWarn } from './operationalWarn.js';
import type { OperationalWarnEmission } from './operationalWarnTypes.js';
import { compactError } from './providerWarn.js';
import { recordP3WarnSummary } from './p3WarnSummary.js';

export type MaintenanceWarnSource =
  | 'SCHEDULER'
  | 'SCHEDULE_CATALOG'
  | 'POST_HOLIDAY_KICKSTART'
  | 'PROGRAM_AUTO_CAPTURE'
  | 'ADAPTIVE_SCAN_SCHEDULER'
  | 'HEALTH_DIAGNOSTICS'
  | 'CREDENTIAL_WATCHDOG'
  | 'ALERT_AUDIT'
  | 'REPORT_GENERATOR'
  | 'AUX_CACHE'
  | 'DEBUG_REPLAY'
  | 'KRX_MASTER_REPO'
  | 'SCRIPT'
  | 'DOC_ONLY';

export type P3WarnPayload = {
  priority: 'P3';
  domain: 'DIAGNOSTIC' | 'PROVIDER' | 'DATA';
  code: string;
  message: string;
  source: MaintenanceWarnSource;
  executionImpact: 'NONE';
  runtimeVisible?: boolean;
  debugOnly?: boolean;
  suppressed?: boolean;
  dedupKey: string;
  ttlSec: 600;
  details?: Record<string, unknown>;
};

export interface EmitMaintenanceWarnInput {
  domain?: P3WarnPayload['domain'];
  code: string;
  message: string;
  source: MaintenanceWarnSource;
  dedupKey: string;
  details?: Record<string, unknown>;
  error?: unknown;
  runtimeVisible?: boolean;
}

export function emitMaintenanceWarn(input: EmitMaintenanceWarnInput): OperationalWarnEmission {
  const payload: P3WarnPayload = {
    priority: 'P3',
    domain: input.domain ?? 'DIAGNOSTIC',
    code: input.code,
    message: input.message,
    source: input.source,
    executionImpact: 'NONE',
    runtimeVisible: input.runtimeVisible ?? process.env.OPERATIONAL_WARN_DEBUG === 'true',
    debugOnly: process.env.OPERATIONAL_WARN_DEBUG !== 'true',
    dedupKey: input.dedupKey,
    ttlSec: 600,
    details: {
      source: input.source,
      ...(input.details ?? {}),
      ...(input.error === undefined ? {} : { compactError: compactError(input.error) }),
    },
  };

  const emission = emitOperationalWarn(payload);
  if (emission.suppressed) {
    recordP3WarnSummary({ ...payload, suppressed: true }, emission.suppressedCount);
  }
  return emission;
}
