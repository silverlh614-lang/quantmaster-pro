/**
 * @responsibility yahooProbeRetry — query1→query2 재시도·다중 심볼·분류 회귀 테스트
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  shouldRetryYahooStatus,
  classifyMultiProbeResult,
  classifyProbeFailures,
  probeYahooWithRetry,
  probeMultipleSymbols,
  PROBE_SYMBOLS,
  RETRYABLE_STATUSES,
  type YahooProbeResult,
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

describe('egressGated 헤더 감지 (옵션 2 — 진단 메시지 분해)', () => {
  function gatedResponse(): Response {
    return new Response(null, {
      status: 503,
      headers: { 'X-Egress-Guard': 'market-closed' },
    });
  }

  it('503 + X-Egress-Guard 헤더 → egressGated=true (query2 까지 동일 헤더)', async () => {
    const mock = vi.fn(async () => gatedResponse());
    __setFetchImplForTests(mock as unknown as typeof globalThis.fetch);

    const r = await probeYahooWithRetry('000660.KS', { backoffMs: 0 });
    expect(r.ok).toBe(false);
    expect(r.status).toBe(503);
    expect(r.egressGated).toBe(true);
    expect(r.retried).toBe(true); // 503 retryable → query2 시도
  });

  it('503 + 헤더 없음 (진짜 Yahoo 503) → egressGated=false', async () => {
    const mock = vi.fn(async () => mockResponse(503));
    __setFetchImplForTests(mock as unknown as typeof globalThis.fetch);

    const r = await probeYahooWithRetry('000660.KS', { backoffMs: 0 });
    expect(r.ok).toBe(false);
    expect(r.status).toBe(503);
    expect(r.egressGated).toBe(false);
  });

  it('200 OK 응답 → egressGated 미설정 (성공 결과)', async () => {
    const mock = vi.fn(async () => mockResponse(200));
    __setFetchImplForTests(mock as unknown as typeof globalThis.fetch);

    const r = await probeYahooWithRetry('000660.KS', { backoffMs: 0 });
    expect(r.ok).toBe(true);
    expect(r.egressGated).toBeUndefined();
  });

  it('404 영구 오류 + 헤더 없음 → egressGated=false (재시도 안 함)', async () => {
    const mock = vi.fn(async () => mockResponse(404));
    __setFetchImplForTests(mock as unknown as typeof globalThis.fetch);

    const r = await probeYahooWithRetry('000660.KS', { backoffMs: 0 });
    expect(r.ok).toBe(false);
    expect(r.status).toBe(404);
    expect(r.egressGated).toBe(false);
    expect(r.retried).toBeUndefined();
  });

  it('timeout/network → egressGated 미설정 (status 자체 부재)', async () => {
    const mock = vi.fn(async () => {
      throw new Error('network error');
    });
    __setFetchImplForTests(mock as unknown as typeof globalThis.fetch);

    const r = await probeYahooWithRetry('000660.KS', { backoffMs: 0 });
    expect(r.ok).toBe(false);
    expect(r.status).toBeUndefined();
    expect(r.egressGated).toBeUndefined();
    expect(r.retried).toBe(true);
  });
});

describe('classifyProbeFailures — 실패 사유 분해 SSOT', () => {
  it('빈 입력 → 모두 0', () => {
    expect(classifyProbeFailures([])).toEqual({
      egressGatedCount: 0,
      realFailCount: 0,
      timeoutCount: 0,
    });
  });

  it('성공만 있을 때 → 모두 0 (ok 무시)', () => {
    const results: YahooProbeResult[] = [
      { ok: true, status: 200 },
      { ok: true, status: 200 },
    ];
    expect(classifyProbeFailures(results)).toEqual({
      egressGatedCount: 0,
      realFailCount: 0,
      timeoutCount: 0,
    });
  });

  it('egress-gated 3 / yahoo-5xx 0 / timeout 0', () => {
    const results: YahooProbeResult[] = [
      { ok: false, status: 503, egressGated: true },
      { ok: false, status: 503, egressGated: true },
      { ok: false, status: 503, egressGated: true },
    ];
    expect(classifyProbeFailures(results)).toEqual({
      egressGatedCount: 3,
      realFailCount: 0,
      timeoutCount: 0,
    });
  });

  it('혼재: egress 1 / yahoo-503 1 / timeout 1', () => {
    const results: YahooProbeResult[] = [
      { ok: false, status: 503, egressGated: true },
      { ok: false, status: 503, egressGated: false },
      { ok: false, error: 'network' },
    ];
    expect(classifyProbeFailures(results)).toEqual({
      egressGatedCount: 1,
      realFailCount: 1,
      timeoutCount: 1,
    });
  });

  it('진짜 Yahoo 5xx 만 (egressGated 미설정 false 분기 동등)', () => {
    const results: YahooProbeResult[] = [
      { ok: false, status: 502 },
      { ok: false, status: 504 },
    ];
    expect(classifyProbeFailures(results)).toEqual({
      egressGatedCount: 0,
      realFailCount: 2,
      timeoutCount: 0,
    });
  });

  it('성공 + 실패 혼재 — 성공은 카운트 무시', () => {
    const results: YahooProbeResult[] = [
      { ok: true, status: 200 },
      { ok: false, status: 503, egressGated: true },
      { ok: false, error: 'aborted' },
    ];
    expect(classifyProbeFailures(results)).toEqual({
      egressGatedCount: 1,
      realFailCount: 0,
      timeoutCount: 1,
    });
  });
});

describe('HISTORICAL intent — KR 장외 시간대 자기 차단 회귀 차단', () => {
  // EgressGuard 가 *실제로* 동작하도록 EGRESS_GUARD_DISABLED 해제. KR 토요일 정오로
  // 시각 mock — REALTIME 의도면 KRX/NYSE 모두 closed 라 차단되지만 HISTORICAL 의도는
  // 자연 통과해야 한다. fetchOnce 내부의 guardedFetch 호출 intent 인자가 누락되면
  // 본 테스트가 503 synthetic 으로 차단되어 fail.
  beforeEach(() => {
    delete process.env.EGRESS_GUARD_DISABLED;
    // 2026-04-26 (토요일) 정오 KST = UTC 03:00
    vi.setSystemTime(new Date('2026-04-26T03:00:00Z'));
  });

  afterEach(() => {
    vi.useRealTimers();
    process.env.EGRESS_GUARD_DISABLED = 'true';
  });

  it('KR 토요일 정오 — HISTORICAL intent 로 KRX 종목 EgressGuard 통과', async () => {
    const mock = vi.fn(async () => mockResponse(200));
    __setFetchImplForTests(mock as unknown as typeof globalThis.fetch);

    const r = await probeYahooWithRetry('000660.KS', { backoffMs: 0 });

    // 핵심: mock fetch 가 실제 호출되었다 = EgressGuard 가 자기 차단하지 않았다
    expect(mock).toHaveBeenCalled();
    expect(r.ok).toBe(true);
    expect(r.status).toBe(200);
    // egressGated false (헤더 없음)
    expect(r.egressGated).toBeUndefined();
  });

  it('KR 토요일 정오 — 3종목 다중 probe 모두 EgressGuard 통과', async () => {
    const mock = vi.fn(async () => mockResponse(200));
    __setFetchImplForTests(mock as unknown as typeof globalThis.fetch);

    const r = await probeMultipleSymbols(undefined, { backoffMs: 0 });

    expect(r.failCount).toBe(0);
    expect(r.total).toBe(3);
    // 3 종목 × 1회 호출 = 3 (재시도 없음, 200 즉시 성공)
    expect(mock).toHaveBeenCalledTimes(3);
  });
});
