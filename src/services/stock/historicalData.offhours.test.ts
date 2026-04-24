/**
 * @responsibility historicalData.fetchHistoricalData 의 204 OFFHOURS 식별 회귀
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { fetchHistoricalData } from './historicalData';

describe('fetchHistoricalData — 204 OFFHOURS handling (PR-31)', () => {
  const originalFetch = global.fetch;

  beforeEach(() => {
    vi.resetAllMocks();
  });

  afterEach(() => {
    global.fetch = originalFetch;
  });

  it('204 응답은 OFFHOURS sentinel 로 분류되며 X-Market-Next-Open 을 노출', async () => {
    const headers = new Headers({ 'X-Market-Next-Open': '2026-04-27T00:00:00.000Z' });
    const fetchSpy = vi.fn().mockResolvedValue(
      new Response(null, { status: 204, headers }),
    );
    global.fetch = fetchSpy as any;

    const result = await fetchHistoricalData('005930', '1y', '1d', { withMeta: true });
    expect(result.data).toBeNull();
    expect(result.meta.reason).toBe('OFFHOURS');
    expect(result.meta.nextOpenAt).toBe('2026-04-27T00:00:00.000Z');
  });

  it('OFFHOURS 응답은 다른 시장(.KS → .KQ) retry 없이 즉시 종료', async () => {
    const fetchSpy = vi.fn().mockResolvedValue(
      new Response(null, { status: 204 }),
    );
    global.fetch = fetchSpy as any;

    await fetchHistoricalData('005930', '1y', '1d', { withMeta: true });
    // 6자리 코드는 .KS 우선이지만 OFFHOURS 시 .KQ 로 fallback 하지 않음
    expect(fetchSpy).toHaveBeenCalledTimes(1);
  });

  it('정상 200 응답은 data 필드를 반환', async () => {
    const body = { chart: { result: [{ timestamp: [1, 2, 3] }] } };
    const fetchSpy = vi.fn().mockResolvedValue(
      new Response(JSON.stringify(body), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      }),
    );
    global.fetch = fetchSpy as any;

    const result = await fetchHistoricalData('005930', '1y', '1d', { withMeta: true });
    expect(result.data).toEqual({ timestamp: [1, 2, 3] });
    expect(result.meta.reason).toBeUndefined();
  });

  it('legacy signature(withMeta 미지정) 는 data 만 반환 — 호환성 유지', async () => {
    const body = { chart: { result: [{ timestamp: [42] }] } };
    const fetchSpy = vi.fn().mockResolvedValue(
      new Response(JSON.stringify(body), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      }),
    );
    global.fetch = fetchSpy as any;

    const data = await fetchHistoricalData('005930');
    expect(data).toEqual({ timestamp: [42] });
  });

  it('legacy signature 에서 OFFHOURS 는 null 반환', async () => {
    const fetchSpy = vi.fn().mockResolvedValue(
      new Response(null, { status: 204 }),
    );
    global.fetch = fetchSpy as any;

    const data = await fetchHistoricalData('005930');
    expect(data).toBeNull();
  });
});
