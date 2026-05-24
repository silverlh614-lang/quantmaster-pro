// @responsibility Normalize KIS core HTTP responses including provider failures.

import type { KisProviderHealthState } from './kisProviderHealth.js';
import { recordKisProviderFailure, recordKisProviderSuccess } from './kisProviderHealth.js';
import type { KisRequestPriority } from './kisRequestClassifier.js';
import { isDiagnosticKisPriority } from './kisRequestClassifier.js';
import { parseRetryAfterMs } from './kisRateLimitBackoff.js';

export type KisCoreResult<T> =
  | { kind: 'SUCCESS'; data: T; providerHealth: 'VERIFIED' }
  | { kind: 'AUTH_REFRESHED_RETRYING'; retryable: true }
  | { kind: 'RATE_LIMITED'; retryable: true; retryAfterMs?: number }
  | { kind: 'SERVER_ERROR_COOLDOWN'; retryable: true; cooldownMs: number }
  | { kind: 'CIRCUIT_OPEN'; retryable: false; providerHealth: 'COOLDOWN' }
  | { kind: 'EMPTY_RESPONSE'; retryable: boolean }
  | { kind: 'FAILED'; retryable: boolean; reason: string; diagnosticSuppressed?: boolean; providerIssue?: boolean; marketSignal?: false };

export interface NormalizeKisCoreInput<T> {
  priority: KisRequestPriority;
  status: number;
  ok: boolean;
  bodyText?: string;
  raw?: unknown;
  headers?: Headers | Record<string, string | undefined>;
  trId?: string;
  endpoint?: string;
  parse?: (raw: unknown) => T;
}

function cooldownMsForStatus(status: number): number {
  if (status === 429) return 1_000;
  if (status >= 500) return 60_000;
  return 0;
}

function providerHealthForStatus(status: number): KisProviderHealthState {
  if (status === 429) return 'COOLDOWN';
  if (status >= 500) return 'COOLDOWN';
  return 'DEGRADED';
}

export function normalizeKisCoreResult<T>(input: NormalizeKisCoreInput<T>): KisCoreResult<T> {
  const diagnosticSuppressed = isDiagnosticKisPriority(input.priority);

  if (input.status === 401) {
    if (!diagnosticSuppressed) {
      recordKisProviderFailure({
        priority: input.priority,
        status: input.status,
        reason: 'auth-refresh-required',
        providerHealth: 'DEGRADED',
        trId: input.trId,
      });
    }
    return { kind: 'AUTH_REFRESHED_RETRYING', retryable: true };
  }

  if (input.status === 429) {
    const retryAfterMs = parseRetryAfterMs(input.headers ?? {});
    if (!diagnosticSuppressed) {
      recordKisProviderFailure({
        priority: input.priority,
        status: input.status,
        reason: 'rate-limited',
        providerHealth: 'COOLDOWN',
        trId: input.trId,
      });
    }
    return { kind: 'RATE_LIMITED', retryable: true, ...(retryAfterMs !== undefined ? { retryAfterMs } : {}) };
  }

  if (input.status >= 500 && input.status < 600) {
    if (!diagnosticSuppressed) {
      recordKisProviderFailure({
        priority: input.priority,
        status: input.status,
        reason: 'server-error',
        providerHealth: 'COOLDOWN',
        trId: input.trId,
      });
    }
    return { kind: 'SERVER_ERROR_COOLDOWN', retryable: true, cooldownMs: cooldownMsForStatus(input.status) };
  }

  if (!input.ok) {
    if (!diagnosticSuppressed) {
      recordKisProviderFailure({
        priority: input.priority,
        status: input.status,
        reason: `http-${input.status}`,
        providerHealth: providerHealthForStatus(input.status),
        trId: input.trId,
      });
    }
    return {
      kind: 'FAILED',
      retryable: false,
      reason: `http-${input.status}`,
      diagnosticSuppressed,
      providerIssue: true,
      marketSignal: false,
    };
  }

  const raw = input.raw ?? (() => {
    const text = input.bodyText ?? '';
    if (!text.trim()) return undefined;
    try {
      return JSON.parse(text) as unknown;
    } catch {
      return Symbol.for('KIS_MALFORMED_JSON');
    }
  })();

  if (raw === undefined) {
    if (!diagnosticSuppressed) {
      recordKisProviderFailure({
        priority: input.priority,
        status: input.status,
        reason: 'empty-response',
        providerHealth: 'STALE',
        trId: input.trId,
      });
    }
    return { kind: 'EMPTY_RESPONSE', retryable: true };
  }
  if (raw === Symbol.for('KIS_MALFORMED_JSON')) {
    if (!diagnosticSuppressed) {
      recordKisProviderFailure({
        priority: input.priority,
        status: input.status,
        reason: 'malformed-response',
        providerHealth: 'DEGRADED',
        trId: input.trId,
      });
    }
    return {
      kind: 'FAILED',
      retryable: true,
      reason: 'malformed-response',
      diagnosticSuppressed,
      providerIssue: true,
      marketSignal: false,
    };
  }

  recordKisProviderSuccess(input.priority);
  const data = input.parse ? input.parse(raw) : raw as T;
  return { kind: 'SUCCESS', data, providerHealth: 'VERIFIED' };
}
