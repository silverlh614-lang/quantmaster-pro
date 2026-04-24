/**
 * @responsibility Naver Finance negative cache 회귀 — 4xx 응답 5분 차단 + 5xx 미차단
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import {
  fetchNaverStockSnapshot,
  resetNaverNegativeCache,
} from './naverFinanceClient';

describe('naverFinanceClient — negative cache (PR-31)', () => {
  const originalFetch = global.fetch;

  beforeEach(() => {
    resetNaverNegativeCache();
    vi.resetAllMocks();
  });

  afterEach(() => {
    global.fetch = originalFetch;
  });

  it('첫 4xx 응답 후 동일 코드는 outbound 호출하지 않는다', async () => {
    const fetchSpy = vi.fn().mockResolvedValue(
      new Response('', { status: 409 }),
    );
    global.fetch = fetchSpy as any;

    const first = await fetchNaverStockSnapshot('091990');
    const second = await fetchNaverStockSnapshot('091990');

    expect(first).toBeNull();
    expect(second).toBeNull();
    // 두 번째 호출은 negative cache 차단 — outbound 1회만 발생
    expect(fetchSpy).toHaveBeenCalledTimes(1);
  });

  it('5xx 는 transient 로 간주하여 negative cache 미적용', async () => {
    const fetchSpy = vi.fn().mockResolvedValue(
      new Response('', { status: 503 }),
    );
    global.fetch = fetchSpy as any;

    const first = await fetchNaverStockSnapshot('005930');
    const second = await fetchNaverStockSnapshot('005930');

    expect(first).toBeNull();
    expect(second).toBeNull();
    // 5xx 는 캐시 없이 매번 outbound 시도 — 일시 장애 회복 시 즉시 정상화
    expect(fetchSpy).toHaveBeenCalledTimes(2);
  });

  it('서로 다른 코드는 독립적으로 캐시', async () => {
    const fetchSpy = vi
      .fn()
      .mockResolvedValueOnce(new Response('', { status: 409 }))
      .mockResolvedValueOnce(new Response('', { status: 404 }));
    global.fetch = fetchSpy as any;

    await fetchNaverStockSnapshot('091990');
    await fetchNaverStockSnapshot('999999');

    expect(fetchSpy).toHaveBeenCalledTimes(2);
  });

  it('잘못된 코드 형식은 outbound 없이 즉시 null', async () => {
    const fetchSpy = vi.fn();
    global.fetch = fetchSpy as any;

    expect(await fetchNaverStockSnapshot('abc')).toBeNull();
    expect(await fetchNaverStockSnapshot('1234')).toBeNull();
    expect(fetchSpy).not.toHaveBeenCalled();
  });
});
