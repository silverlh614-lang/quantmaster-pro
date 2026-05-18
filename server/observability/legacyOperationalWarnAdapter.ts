// @responsibility Adapter for legacy domain-specific warn wrappers.

import { defaultWarnTtlSec, emitOperationalWarn } from './operationalWarn.js';
import type { ExecutionImpact } from './executionImpact.js';
import type { WarnDomain, WarnMode, WarnPriority } from './operationalWarnTypes.js';

export interface LegacyOperationalWarnEvent {
  code: string;
  message: string;
  severity?: WarnPriority;
  context?: Record<string, unknown>;
  cause?: unknown;
}

export interface LegacyOperationalWarnAdapterOptions {
  domain: WarnDomain;
  impactForCode: (code: string, context?: Record<string, unknown>) => ExecutionImpact;
  defaultMode?: WarnMode;
}

function inferPriority(code: string, explicit?: WarnPriority): WarnPriority {
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

function stringField(context: Record<string, unknown> | undefined, keys: string[]): string | undefined {
  if (!context) return undefined;
  for (const key of keys) {
    const value = context[key];
    if (typeof value === 'string' && value.length > 0) return value;
  }
  return undefined;
}

function modeField(context: Record<string, unknown> | undefined, fallback?: WarnMode): WarnMode | undefined {
  const mode = stringField(context, ['mode', 'tradingMode', 'accountMode']);
  if (
    mode === 'LIVE' ||
    mode === 'SHADOW' ||
    mode === 'SHADOW_ONLY' ||
    mode === 'SELL_ONLY' ||
    mode === 'OBSERVE_ONLY' ||
    mode === 'NORMAL' ||
    mode === 'DEGRADED'
  ) {
    return mode;
  }
  return fallback;
}

function dedupKeyFor(event: LegacyOperationalWarnEvent, domain: WarnDomain): string {
  const explicit = stringField(event.context, ['dedupKey', 'dedup_key']);
  if (explicit) return explicit;
  const symbol = stringField(event.context, ['symbol', 'stockCode', 'code']);
  const mode = modeField(event.context);
  const contextHash = JSON.stringify(event.context ?? {});
  return `operational-warn:${domain}:${event.code}:${mode ?? 'NA'}:${symbol ?? 'GLOBAL'}:${event.message}:${contextHash}`;
}

export function emitLegacyOperationalWarn(
  event: LegacyOperationalWarnEvent,
  options: LegacyOperationalWarnAdapterOptions,
): void {
  const priority = inferPriority(event.code, event.severity);
  const details = {
    ...(event.context ? { context: event.context } : {}),
    ...(event.cause !== undefined ? { cause: describeCause(event.cause) } : {}),
  };
  emitOperationalWarn({
    priority,
    domain: options.domain,
    code: event.code,
    message: event.message,
    executionImpact: options.impactForCode(event.code, event.context),
    mode: modeField(event.context, options.defaultMode),
    regime: stringField(event.context, ['regime', 'currentRegime']),
    symbol: stringField(event.context, ['symbol', 'stockCode', 'code']),
    dedupKey: dedupKeyFor(event, options.domain),
    ttlSec: defaultWarnTtlSec(priority),
    details,
    correlationId: stringField(event.context, ['correlationId', 'orderIntentId', 'tradeId']),
  });
}
