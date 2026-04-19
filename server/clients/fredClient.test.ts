/**
 * fredClient.test.ts — 아이디어 11: FRED 어댑터 검증
 *
 * 검증 목표:
 *   1. FRED_API_KEY 미설정 시 네트워크 호출 없이 null.
 *   2. seriesId 이상 입력 (공백·특수문자) 즉시 null.
 *   3. 관측값 '.'(결측) 스킵 후 첫 유효값 파싱.
 *   4. HTTP 오류/네트워크 에러 → null 로 흡수 + throw 없음.
 *   5. 캐시 히트로 fetch 재호출 없음.
 *   6. 스냅샷: 5종 시리즈 병렬 수집, 일부 실패는 필드만 null.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

describe('fredClient — 어댑터 내성', () => {
  const originalFetch = globalThis.fetch;
  const originalKey = process.env.FRED_API_KEY;

  beforeEach(async () => {
    process.env.FRED_API_KEY = 'test-key';
    delete process.env.FRED_API_DISABLED;
    vi.resetModules();
    const mod = await import('./fredClient.js');
    mod.resetFredCache();
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
    if (originalKey === undefined) delete process.env.FRED_API_KEY;
    else process.env.FRED_API_KEY = originalKey;
    vi.restoreAllMocks();
  });

  it('FRED_API_KEY 미설정 → fetch 없이 null', async () => {
    delete process.env.FRED_API_KEY;
    const fetchSpy = vi.fn();
    globalThis.fetch = fetchSpy as unknown as typeof fetch;

    vi.resetModules();
    const { fetchFredLatest } = await import('./fredClient.js');
    const v = await fetchFredLatest('T10Y2Y');
    expect(v).toBeNull();
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it('seriesId 이상 입력은 즉시 null (인젝션 방지)', async () => {
    const fetchSpy = vi.fn();
    globalThis.fetch = fetchSpy as unknown as typeof fetch;

    vi.resetModules();
    const { fetchFredLatest } = await import('./fredClient.js');
    expect(await fetchFredLatest('')).toBeNull();
    expect(await fetchFredLatest('bad id')).toBeNull();
    expect(await fetchFredLatest('series;rm -rf')).toBeNull();
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it('.(결측) 을 건너뛰고 첫 유효 관측값 반환', async () => {
    const body = {
      observations: [
        { value: '.' },
        { value: '' },
        { value: '4.25' },
        { value: '4.20' },
      ],
    };
    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: true, status: 200,
      json: async () => body,
    }) as unknown as typeof fetch;

    vi.resetModules();
    const { fetchFredLatest } = await import('./fredClient.js');
    const v = await fetchFredLatest('SOFR');
    expect(v).toBeCloseTo(4.25);
  });

  it('HTTP 500이면 null 로 수렴', async () => {
    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: false, status: 500,
      json: async () => ({}),
    }) as unknown as typeof fetch;

    vi.resetModules();
    const { fetchFredLatest } = await import('./fredClient.js');
    await expect(fetchFredLatest('T10Y2Y')).resolves.toBeNull();
  });

  it('캐시: 재호출은 fetch 한 번만 사용', async () => {
    const fetchSpy = vi.fn().mockResolvedValue({
      ok: true, status: 200,
      json: async () => ({ observations: [{ value: '3.42' }] }),
    });
    globalThis.fetch = fetchSpy as unknown as typeof fetch;

    vi.resetModules();
    const { fetchFredLatest, resetFredCache } = await import('./fredClient.js');
    resetFredCache();
    const a = await fetchFredLatest('BAMLH0A0HYM2');
    const b = await fetchFredLatest('BAMLH0A0HYM2');
    expect(a).toBeCloseTo(3.42);
    expect(b).toBe(a);
    expect(fetchSpy).toHaveBeenCalledTimes(1);
  });

  it('스냅샷: 일부 시리즈 실패 시 해당 필드만 null', async () => {
    globalThis.fetch = vi.fn().mockImplementation(async (url: string) => {
      if (url.includes('T10Y2Y')) {
        return { ok: false, status: 500, json: async () => ({}) } as any;
      }
      return { ok: true, status: 200, json: async () => ({ observations: [{ value: '1.23' }] }) } as any;
    }) as unknown as typeof fetch;

    vi.resetModules();
    const { fetchFredSnapshot } = await import('./fredClient.js');
    const snap = await fetchFredSnapshot();
    expect(snap.yieldCurve10y2y).toBeNull();
    expect(snap.hySpreadPct).toBeCloseTo(1.23);
    expect(snap.sofrPct).toBeCloseTo(1.23);
    expect(snap.financialStress).toBeCloseTo(1.23);
    expect(snap.wtiCrude).toBeCloseTo(1.23);
  });
});
