// @responsibility Priority-aware KIS HTTP result facade for new core callers.

import {
  classifyKisRequest,
  type KisHttpMethod,
  type KisRequestPriority,
} from './kisRequestClassifier.js';
import {
  isKisCoreCircuitOpen,
  recordKisCoreCircuitFailure,
  recordKisCoreCircuitSuccess,
} from './kisCircuitBreaker.js';
import { normalizeKisCoreResult, type KisCoreResult } from './kisCoreResultNormalizer.js';
import { recordKisProviderFailure } from './kisProviderHealth.js';
import type { KisApiPriority } from '../../kisRateLimiter.js';

export interface KisHttpClientInput<T> {
  method: KisHttpMethod;
  url: string;
  trId: string;
  apiPath: string;
  headers?: Record<string, string>;
  body?: unknown;
  kisApiPriority?: KisApiPriority;
  purpose?: string;
  requestPriority?: KisRequestPriority;
  idempotency?: 'safe' | 'unsafe';
  fetchImpl?: typeof fetch;
  parse?: (raw: unknown) => T;
}

export async function kisHttpClient<T = unknown>(input: KisHttpClientInput<T>): Promise<KisCoreResult<T>> {
  const classification = input.requestPriority
    ? {
        priority: input.requestPriority,
        diagnosticSuppressed: input.requestPriority === 'P3_SCAN_DIAGNOSTIC' || input.requestPriority === 'P4_TELEMETRY',
      }
    : classifyKisRequest({
        method: input.method,
        trId: input.trId,
        apiPath: input.apiPath,
        kisApiPriority: input.kisApiPriority,
        purpose: input.purpose,
        idempotency: input.idempotency,
      });
  const endpoint = `${input.method}:${input.trId}:${input.apiPath}`;

  if (isKisCoreCircuitOpen({ priority: classification.priority, endpoint, trId: input.trId })) {
    return { kind: 'CIRCUIT_OPEN', retryable: false, providerHealth: 'COOLDOWN' };
  }

  const fetchImpl = input.fetchImpl ?? fetch;
  try {
    const response = await fetchImpl(input.url, {
      method: input.method,
      headers: input.headers,
      ...(input.body !== undefined ? { body: JSON.stringify(input.body) } : {}),
    });
    const text = await response.text();
    const result = normalizeKisCoreResult<T>({
      priority: classification.priority,
      status: response.status,
      ok: response.ok,
      bodyText: text,
      headers: response.headers,
      trId: input.trId,
      endpoint,
      parse: input.parse,
    });
    if (result.kind === 'SUCCESS') {
      recordKisCoreCircuitSuccess({ priority: classification.priority, endpoint });
    } else if (
      result.kind === 'SERVER_ERROR_COOLDOWN' ||
      result.kind === 'RATE_LIMITED' ||
      result.kind === 'FAILED'
    ) {
      recordKisCoreCircuitFailure({
        priority: classification.priority,
        endpoint,
        reason: result.kind,
        trId: input.trId,
      });
    }
    return result;
  } catch (error) {
    const reason = error instanceof Error ? error.message : String(error);
    recordKisProviderFailure({
      priority: classification.priority,
      reason,
      providerHealth: 'DEGRADED',
      trId: input.trId,
    });
    recordKisCoreCircuitFailure({
      priority: classification.priority,
      endpoint,
      reason,
      trId: input.trId,
    });
    return {
      kind: 'FAILED',
      retryable: true,
      reason,
      diagnosticSuppressed: classification.diagnosticSuppressed,
      providerIssue: true,
      marketSignal: false,
    };
  }
}
