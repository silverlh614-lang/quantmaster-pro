import { beforeEach, describe, expect, it, vi } from 'vitest';

import { classifyKisRequest } from './kisRequestClassifier.js';
import { normalizeKisCoreResult } from './kisCoreResultNormalizer.js';
import {
  __resetKisProviderHealthForTests,
  getKisProviderHealthSnapshot,
} from './kisProviderHealth.js';
import {
  __resetKisCoreCircuitBreakerForTests,
  isKisCoreCircuitOpen,
  recordKisCoreCircuitFailure,
} from './kisCircuitBreaker.js';
import { kisHttpClient } from './kisHttpClient.js';
import { clearWarnDedupStore } from '../../../observability/warnDedupStore.js';

describe('KIS core resilience layer', () => {
  beforeEach(() => {
    __resetKisProviderHealthForTests();
    __resetKisCoreCircuitBreakerForTests();
    clearWarnDedupStore();
    vi.restoreAllMocks();
    vi.spyOn(console, 'warn').mockImplementation(() => undefined);
  });

  it('classifies scan diagnostics as executionImpact NONE and marketSignal=false', () => {
    const result = classifyKisRequest({
      method: 'GET',
      trId: 'FHKST03010100',
      apiPath: '/uapi/domestic-stock/v1/quotations/inquire-daily-itemchartprice',
      kisApiPriority: 'LOW',
      purpose: 'P3_SCAN_DIAGNOSTIC',
    });

    expect(result).toEqual(expect.objectContaining({
      priority: 'P3_SCAN_DIAGNOSTIC',
      diagnosticSuppressed: true,
      executionImpact: 'NONE',
      marketSignal: false,
    }));
  });

  it('keeps P3 diagnostic provider failures out of core provider health warn flow', () => {
    const result = normalizeKisCoreResult({
      priority: 'P3_SCAN_DIAGNOSTIC',
      status: 500,
      ok: false,
      trId: 'FHKST03010100',
    });

    expect(result).toEqual(expect.objectContaining({
      kind: 'SERVER_ERROR_COOLDOWN',
      retryable: true,
    }));
    expect(getKisProviderHealthSnapshot()).toEqual([]);
    expect(console.warn).not.toHaveBeenCalled();
  });

  it('records P1 core failures with providerIssue=true and marketSignal=false', () => {
    const result = normalizeKisCoreResult({
      priority: 'P1_QUOTE_HYDRATION',
      status: 500,
      ok: false,
      trId: 'FHKST01010100',
    });

    expect(result.kind).toBe('SERVER_ERROR_COOLDOWN');
    expect(getKisProviderHealthSnapshot()).toEqual([
      expect.objectContaining({
        priority: 'P1_QUOTE_HYDRATION',
        status: 'COOLDOWN',
        providerIssue: true,
        marketSignal: false,
        diagnosticSuppressed: false,
      }),
    ]);
    expect(console.warn).toHaveBeenCalledWith(
      expect.stringContaining('[P1][PROVIDER][P1_KIS_SERVER_ERROR_COOLDOWN]'),
      expect.objectContaining({
        code: 'P1_KIS_SERVER_ERROR_COOLDOWN',
        executionImpact: 'PROVIDER_CORE_DEGRADED',
      }),
    );
  });

  it('records empty P1 core responses separately from market signals', () => {
    const result = normalizeKisCoreResult({
      priority: 'P1_CORE_MARKET_DATA',
      status: 200,
      ok: true,
      bodyText: '',
      trId: 'FHKST01010100',
    });

    expect(result).toEqual({ kind: 'EMPTY_RESPONSE', retryable: true });
    expect(getKisProviderHealthSnapshot()).toEqual([
      expect.objectContaining({
        priority: 'P1_CORE_MARKET_DATA',
        status: 'STALE',
        providerIssue: true,
        marketSignal: false,
      }),
    ]);
  });

  it('normalizes network exceptions as provider issues without market signals', async () => {
    const result = await kisHttpClient({
      method: 'GET',
      url: 'https://kis.invalid/test',
      trId: 'FHKST01010100',
      apiPath: '/uapi/domestic-stock/v1/quotations/inquire-price',
      requestPriority: 'P1_QUOTE_HYDRATION',
      fetchImpl: vi.fn().mockRejectedValue(new Error('network down')),
    });

    expect(result).toEqual(expect.objectContaining({
      kind: 'FAILED',
      retryable: true,
      providerIssue: true,
      marketSignal: false,
    }));
    expect(getKisProviderHealthSnapshot()).toEqual([
      expect.objectContaining({
        priority: 'P1_QUOTE_HYDRATION',
        status: 'DEGRADED',
        providerIssue: true,
        marketSignal: false,
      }),
    ]);
  });

  it('separates diagnostic and core circuit breaker budgets', () => {
    recordKisCoreCircuitFailure({
      priority: 'P3_SCAN_DIAGNOSTIC',
      endpoint: 'GET:FHKST03010100:/diagnostic',
      reason: 'diagnostic-500',
      status: 500,
      trId: 'FHKST03010100',
    });
    recordKisCoreCircuitFailure({
      priority: 'P3_SCAN_DIAGNOSTIC',
      endpoint: 'GET:FHKST03010100:/diagnostic',
      reason: 'diagnostic-500',
      status: 500,
      trId: 'FHKST03010100',
    });

    expect(isKisCoreCircuitOpen({
      priority: 'P1_CORE_MARKET_DATA',
      endpoint: 'GET:FHKST03010100:/diagnostic',
      trId: 'FHKST03010100',
    })).toBe(false);
    expect(isKisCoreCircuitOpen({
      priority: 'P3_SCAN_DIAGNOSTIC',
      endpoint: 'GET:FHKST03010100:/diagnostic',
      trId: 'FHKST03010100',
    })).toBe(true);
  });
});
