// @responsibility Compact KIS auth/token persistence warning helpers.

import { emitOperationalWarn } from '../../../observability/operationalWarn.js';

export function emitKisAuthPersistenceWarn(input: {
  operation: 'hydrate' | 'persist' | 'clear' | 'refresh';
  slot?: 'main' | 'realData';
  reason: string;
}): void {
  emitOperationalWarn({
    priority: 'P1',
    domain: 'PROVIDER',
    code: 'P1_KIS_AUTH_REFRESH_FAILED',
    message: 'KIS auth/token persistence degraded; memory token flow continues when possible.',
    executionImpact: 'PROVIDER_CORE_DEGRADED',
    dedupKey: `kis-auth:${input.operation}:${input.slot ?? 'all'}:${input.reason}`,
    ttlSec: 60,
    details: {
      reason: input.reason,
      operation: input.operation,
      slot: input.slot,
      providerIssue: true,
      marketSignal: false,
    },
  });
}
