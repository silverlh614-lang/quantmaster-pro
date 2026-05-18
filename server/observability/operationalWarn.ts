// @responsibility Unified operational warning emitter with priority impact dedup.

import type { OperationalWarnEmission, OperationalWarnPayload, WarnPriority } from './operationalWarnTypes.js';
import { shouldEmitWarn } from './warnDedupStore.js';
import { emitTelegramCriticalAlert } from './telegramCriticalAlertBridge.js';
import { recordOperationalWarnCount } from './warnSummaryReporter.js';

export function defaultWarnTtlSec(priority: WarnPriority): number {
  switch (priority) {
    case 'P0': return 30;
    case 'P1': return 60;
    case 'P2': return 300;
    case 'P3': return 600;
    case 'P4': return 1_800;
    case 'P5': return 3_600;
  }
}

function shouldPrintRuntime(priority: WarnPriority): boolean {
  if (priority === 'P3' || priority === 'P4' || priority === 'P5') return process.env.OPERATIONAL_WARN_DEBUG === 'true';
  return true;
}

function withPolicyDetails(payload: OperationalWarnPayload): OperationalWarnPayload {
  if (
    (payload.priority === 'P0' || payload.priority === 'P1') &&
    payload.executionImpact === 'NONE' &&
    payload.details?.reason === undefined
  ) {
    return {
      ...payload,
      details: {
        ...payload.details,
        reason: 'EXECUTION_IMPACT_NONE_REQUIRES_REASON',
      },
    };
  }
  return payload;
}

function formatWarnLine(payload: OperationalWarnPayload): string {
  const parts = [
    `[${payload.priority}][${payload.domain}][${payload.code}]`,
    `legacy=[${payload.priority}][${payload.code}]`,
    `executionImpact=${payload.executionImpact}`,
    payload.mode ? `mode=${payload.mode}` : undefined,
    payload.symbol ? `symbol=${payload.symbol}` : undefined,
    payload.regime ? `regime=${payload.regime}` : undefined,
    `dedupKey=${payload.dedupKey}`,
    `ttlSec=${payload.ttlSec}`,
    payload.message,
  ].filter((part): part is string => Boolean(part));
  return parts.join(' ');
}

export function emitOperationalWarn(input: OperationalWarnPayload): OperationalWarnEmission {
  const payload = withPolicyDetails({
    ...input,
    ttlSec: input.ttlSec || defaultWarnTtlSec(input.priority),
  });
  const dedup = shouldEmitWarn(payload.dedupKey, payload.ttlSec);
  if (!dedup.allowed) {
    return {
      payload,
      emitted: false,
      suppressed: true,
      suppressedCount: dedup.suppressedCount,
    };
  }

  recordOperationalWarnCount(payload.priority);
  if (shouldPrintRuntime(payload.priority)) {
    console.warn(formatWarnLine(payload), {
      priority: payload.priority,
      domain: payload.domain,
      code: payload.code,
      executionImpact: payload.executionImpact,
      mode: payload.mode,
      regime: payload.regime,
      symbol: payload.symbol,
      dedupKey: payload.dedupKey,
      ttlSec: payload.ttlSec,
      details: payload.details,
      correlationId: payload.correlationId,
    });
  }

  emitTelegramCriticalAlert(payload);

  return {
    payload,
    emitted: true,
    suppressed: false,
    suppressedCount: 0,
  };
}
