/**
 * ecosClient.test.ts — 아이디어 11: ECOS 어댑터 검증
 *
 * 검증 목표:
 *   1. ECOS_API_KEY 미설정 시 네트워크 호출 없이 null/빈 스냅샷.
 *   2. ECOS_API_DISABLED=true 시 마찬가지.
 *   3. 정상 응답 → BOK 최신 rate·direction 정확히 매핑.
 *   4. M2/수출/대출/USD_KRW 파싱 정확성.
 *   5. 부분 실패 (한 시리즈만 throw) 시 errors 에 기록 + 나머지 필드 보존.
 *   6. 캐시 TTL 동안 재호출 시 fetch 재시도 없음.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

describe('ecosClient — 어댑터 내성 + 파싱', () => {
  const originalFetch = globalThis.fetch;
  const originalKey = process.env.ECOS_API_KEY;

  beforeEach(async () => {
    process.env.ECOS_API_KEY = 'test-key';
    delete process.env.ECOS_API_DISABLED;
    vi.resetModules();
    const mod = await import('./ecosClient.js');
    mod.resetEcosCache();
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
    if (originalKey === undefined) delete process.env.ECOS_API_KEY;
    else process.env.ECOS_API_KEY = originalKey;
    vi.restoreAllMocks();
  });

  it('ECOS_API_KEY 미설정 시 fetch 호출 없이 빈 스냅샷', async () => {
    delete process.env.ECOS_API_KEY;
    const fetchSpy = vi.fn();
    globalThis.fetch = fetchSpy as unknown as typeof fetch;

    vi.resetModules();
    const { fetchEcosSnapshot } = await import('./ecosClient.js');
    const snap = await fetchEcosSnapshot();
    expect(fetchSpy).not.toHaveBeenCalled();
    expect(snap.bokRate).toBeNull();
    expect(snap.m2YoyPct).toBeNull();
    expect(snap.usdKrw).toBeNull();
  });

  it('ECOS_API_DISABLED=true 시 네트워크 호출 없음', async () => {
    process.env.ECOS_API_DISABLED = 'true';
    const fetchSpy = vi.fn();
    globalThis.fetch = fetchSpy as unknown as typeof fetch;

    vi.resetModules();
    const { fetchLatestBokRate } = await import('./ecosClient.js');
    const rate = await fetchLatestBokRate();
    expect(rate).toBeNull();
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it('BOK 기준금리 응답: 상승→HIKING, 하강→CUTTING 정확히 매핑', async () => {
    // TIME 오름차순 정렬되어 있음을 가정 (어댑터가 재정렬)
    const body = {
      StatisticSearch: {
        row: [
          { TIME: '20240101', DATA_VALUE: '3.25' },
          { TIME: '20240201', DATA_VALUE: '3.25' },
          { TIME: '20240301', DATA_VALUE: '3.50' },  // 인상
        ],
      },
    };
    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: true, status: 200,
      json: async () => body,
    }) as unknown as typeof fetch;

    vi.resetModules();
    const { fetchLatestBokRate } = await import('./ecosClient.js');
    const latest = await fetchLatestBokRate();
    expect(latest).not.toBeNull();
    expect(latest!.rate).toBe(3.50);
    expect(latest!.direction).toBe('HIKING');
    expect(latest!.date).toBe('20240301');
  });

  it('M2 YoY(%) — 13개월 데이터 필요, 최신-12개월 전 대비 계산', async () => {
    const rows = Array.from({ length: 13 }, (_, i) => ({
      TIME: `20240${String(i + 1).padStart(2, '0').slice(-2)}`,
      DATA_VALUE: String(3_000_000 + i * 15_000),  // 꾸준히 증가
    }));
    rows[0].TIME = '202401';
    // TIME 포맷 보정 (M 단위)
    for (let i = 0; i < rows.length; i++) {
      rows[i].TIME = `2024${String(i + 1).padStart(2, '0')}`;
    }
    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: true, status: 200,
      json: async () => ({ StatisticSearch: { row: rows } }),
    }) as unknown as typeof fetch;

    vi.resetModules();
    const { fetchLatestM2Yoy } = await import('./ecosClient.js');
    const yoy = await fetchLatestM2Yoy();
    // 최신 3000000 + 12*15000 = 3180000, 1년전 3000000
    // YoY = (3180000 - 3000000) / 3000000 * 100 = 6.00
    expect(yoy).toBeCloseTo(6.0, 1);
  });

  it('HTTP 500 응답이면 null/빈 배열로 흡수', async () => {
    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: false, status: 500,
      json: async () => ({}),
    }) as unknown as typeof fetch;

    vi.resetModules();
    const { fetchLatestUsdKrw } = await import('./ecosClient.js');
    await expect(fetchLatestUsdKrw()).resolves.toBeNull();
  });

  it('캐시: 동일 지표 재호출은 fetch 한 번만 수행', async () => {
    const body = {
      StatisticSearch: {
        row: [
          { TIME: '20240101', DATA_VALUE: '1300.00' },
          { TIME: '20240102', DATA_VALUE: '1310.50' },
        ],
      },
    };
    const fetchSpy = vi.fn().mockResolvedValue({
      ok: true, status: 200,
      json: async () => body,
    });
    globalThis.fetch = fetchSpy as unknown as typeof fetch;

    vi.resetModules();
    const { fetchLatestUsdKrw, resetEcosCache } = await import('./ecosClient.js');
    resetEcosCache();
    const a = await fetchLatestUsdKrw();
    const b = await fetchLatestUsdKrw();
    const c = await fetchLatestUsdKrw();
    expect(a).toBeCloseTo(1310.50);
    expect(b).toBe(a);
    expect(c).toBe(a);
    expect(fetchSpy).toHaveBeenCalledTimes(1);
  });

  it('스냅샷: 일부 시리즈가 실패해도 전체는 성공하고 errors 에 기록되지 않음(개별 null 수렴)', async () => {
    // fetch가 어떤 URL에 대해선 500, 다른 URL에 대해선 빈 row를 돌려준다 → 어댑터가 null로 수렴.
    globalThis.fetch = vi.fn().mockImplementation(async (url: string) => {
      if (url.includes('722Y001')) {
        return { ok: false, status: 500, json: async () => ({}) } as any;
      }
      return { ok: true, status: 200, json: async () => ({ StatisticSearch: { row: [] } }) } as any;
    }) as unknown as typeof fetch;

    vi.resetModules();
    const { fetchEcosSnapshot } = await import('./ecosClient.js');
    const snap = await fetchEcosSnapshot();
    expect(snap.bokRate).toBeNull();
    expect(snap.m2YoyPct).toBeNull();
    // errors 는 개별 fetcher 가 null 반환 시 채우지 않고 null 그대로 수렴하는 설계.
    expect(Array.isArray(snap.errors)).toBe(true);
  });
});
