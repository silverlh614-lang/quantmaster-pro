/**
 * @responsibility yahooProbeRetry — query1→query2 재시도·다중 심볼·분류 회귀 테스트
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  shouldRetryYahooStatus,
  classifyMultiProbeResult,
  probeYahooWithRetry,
  probeMultipleSymbols,
  PROBE_SYMBOLS,
  RETRYABLE_STATUSES,
} from './yahooProbeRetry.js';
import {
  __setFetchImplForTests,
  __resetFetchImplForTests,
  __resetLogThrottleForTests,
} from './egressGuard.js';

beforeEach(() => {
  // 시장 게이트 우회 — fetch mock 이 항상 호출되도록.
  process.env.EGRESS_GUARD_DISABLED = 'true';
});

afterEach(() => {
  __resetFetchImplForTests();
  __resetLogThrottleForTests();
  delete process.env.EGRESS_GUARD_DISABLED;
});

function mockResponse(status: number): Response {
  return new Response(null, { status });
}

describe('shouldRetryYahooStatus — 재시도 결정 SSOT', () => {
  it('429 / 502 / 503 / 504 모두 retry 대상', () => {
    expect(shouldRetryYahooStatus(429)).toBe(true);
    expect(shouldRetryYahooStatus(502)).toBe(true);
    expect(shouldRetryYahooStatus(503)).toBe(true);
    expect(shouldRetryYahooStatus(504)).toBe(true);
  });

  it('200~299 retry 안 함', () => {
    expect(shouldRetryYahooStatus(200)).toBe(false);
    expect(shouldRetryYahooStatus(299)).toBe(false);
  });

  it('400 / 404 영구 오류 retry 안 함', () => {
    expect(shouldRetryYahooStatus(400)).toBe(false);
    expect(shouldRetryYahooStatus(404)).toBe(false);
    expect(shouldRetryYahooStatus(401)).toBe(false);
  });

  it('undefined (timeout/network) → retry', () => {
    expect(shouldRetryYahooStatus(undefined)).toBe(true);
  });

  it('500 (일반 5xx) — RETRYABLE_STATUSES 미포함 → retry 안 함 (의도)', () => {
    expect(shouldRetryYahooStatus(500)).toBe(false);
  });

  it('RETRYABLE_STATUSES SSOT 정확히 4개', () => {
    expect(RETRYABLE_STATUSES.size).toBe(4);
    expect(RETRYABLE_STATUSES.has(429)).toBe(true);
    expect(RETRYABLE_STATUSES.has(503)).toBe(true);
  });
});

describe('classifyMultiProbeResult — 분류 SSOT', () => {
  it('0/3 fail → OK', () => {
    expect(classifyMultiProbeResult(0, 3)).toBe('OK');
  });

  it('1/3 fail → DEGRADED', () => {
    expect(classifyMultiProbeResult(1, 3)).toBe('DEGRADED');
  });

  it('2/3 fail (정확히 임계) → DOWN', () => {
    expect(classifyMultiProbeResult(2, 3)).toBe('DOWN');
  });

  it('3/3 fail → DOWN', () => {
    expect(classifyMultiProbeResult(3, 3)).toBe('DOWN');
  });

  it('total=0 안전 fallback → OK', () => {
    expect(classifyMultiProbeResult(0, 0)).toBe('OK');
    expect(classifyMultiProbeResult(5, 0)).toBe('OK');
  });

  it('5/10 → DEGRADED (1/2 < 2/3)', () => {
    expect(classifyMultiProbeResult(5, 10)).toBe('DEGRADED');
  });

  it('7/10 → DOWN (7/10 ≥ 2/3)', () => {
    expect(classifyMultiProbeResult(7, 10)).toBe('DOWN');
  });
});

describe('probeYahooWithRetry — query1→query2 재시도', () => {
  it('query1 200 → 즉시 ok=true, host=query1, retried 미설정', async () => {
    const mock = vi.fn(async () => mockResponse(200));
    __setFetchImplForTests(mock as unknown as typeof globalThis.fetch);

    const r = await probeYahooWithRetry('000660.KS', { backoffMs: 0 });

    expect(r.ok).toBe(true);
    expect(r.status).toBe(200);
    expect(r.host).toBe('query1');
    expect(r.retried).toBeUndefined();
    expect(mock).toHaveBeenCalledTimes(1);
  });

  it('query1 503 → query2 200 재시도 후 ok=true, host=query2, retried=true', async () => {
    const calls: string[] = [];
    const mock = vi.fn(async (input: string) => {
      calls.push(input);
      return mockResponse(input.includes('query1') ? 503 : 200);
    });
    __setFetchImplForTests(mock as unknown as typeof globalThis.fetch);

    const r = await probeYahooWithRetry('000660.KS', { backoffMs: 0 });

    expect(r.ok).toBe(true);
    expect(r.host).toBe('query2');
    expect(r.retried).toBe(true);
    expect(mock).toHaveBeenCalledTimes(2);
    expect(calls[0]).toContain('query1');
    expect(calls[1]).toContain('query2');
  });

  it('query1 503 → query2 도 503 → ok=false, retried=true', async () => {
    const mock = vi.fn(async () => mockResponse(503));
    __setFetchImplForTests(mock as unknown as typeof globalThis.fetch);

    const r = await probeYahooWithRetry('000660.KS', { backoffMs: 0 });

    expect(r.ok).toBe(false);
    expect(r.status).toBe(503);
    expect(r.host).toBe('query2');
    expect(r.retried).toBe(true);
  });

  it('query1 404 영구 오류 → 재시도 안 함 (host=query1, retried 미설정)', async () => {
    const mock = vi.fn(async () => mockResponse(404));
    __setFetchImplForTests(mock as unknown as typeof globalThis.fetch);

    const r = await probeYahooWithRetry('000660.KS', { backoffMs: 0 });

    expect(r.ok).toBe(false);
    expect(r.status).toBe(404);
    expect(r.host).toBe('query1');
    expect(r.retried).toBeUndefined();
    expect(mock).toHaveBeenCalledTimes(1);
  });

  it('query1 timeout (network error) → query2 재시도 시도', async () => {
    const mock = vi.fn(async (input: string) => {
      if (input.includes('query1')) throw new Error('network error');
      return mockResponse(200);
    });
    __setFetchImplForTests(mock as unknown as typeof globalThis.fetch);

    const r = await probeYahooWithRetry('000660.KS', { backoffMs: 0 });

    expect(r.ok).toBe(true);
    expect(r.host).toBe('query2');
    expect(r.retried).toBe(true);
  });

  it('PROBE_SYMBOLS SSOT 3종목 정확', () => {
    expect(PROBE_SYMBOLS).toEqual(['000660.KS', '247540.KQ', 'EWY']);
  });
});

describe('probeMultipleSymbols — Promise.allSettled', () => {
  it('3종목 모두 200 → failCount=0, total=3', async () => {
    const mock = vi.fn(async () => mockResponse(200));
    __setFetchImplForTests(mock as unknown as typeof globalThis.fetch);

    const r = await probeMultipleSymbols(undefined, { backoffMs: 0 });

    expect(r.total).toBe(3);
    expect(r.failCount).toBe(0);
    expect(r.results.every((res) => res.ok)).toBe(true);
  });

  it('1종목만 503 → failCount=1, classify DEGRADED', async () => {
    const mock = vi.fn(async (input: string) => {
      if (input.includes('000660.KS')) return mockResponse(503);
      return mockResponse(200);
    });
    __setFetchImplForTests(mock as unknown as typeof globalThis.fetch);

    const r = await probeMultipleSymbols(undefined, { backoffMs: 0 });

    expect(r.failCount).toBe(1);
    expect(classifyMultiProbeResult(r.failCount, r.total)).toBe('DEGRADED');
  });

  it('3종목 모두 503 → failCount=3, classify DOWN', async () => {
    const mock = vi.fn(async () => mockResponse(503));
    __setFetchImplForTests(mock as unknown as typeof globalThis.fetch);

    const r = await probeMultipleSymbols(undefined, { backoffMs: 0 });

    expect(r.failCount).toBe(3);
    expect(classifyMultiProbeResult(r.failCount, r.total)).toBe('DOWN');
  });

  it('사용자 지정 symbols 사용', async () => {
    const mock = vi.fn(async () => mockResponse(200));
    __setFetchImplForTests(mock as unknown as typeof globalThis.fetch);

    const r = await probeMultipleSymbols(['005930.KS'], { backoffMs: 0 });

    expect(r.total).toBe(1);
    expect(r.results[0].symbol).toBe('005930.KS');
  });

  it('빈 배열 → 안전 fallback', async () => {
    const r = await probeMultipleSymbols([], { backoffMs: 0 });
    expect(r.total).toBe(0);
    expect(r.failCount).toBe(0);
  });
});
