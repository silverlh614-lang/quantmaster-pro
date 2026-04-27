/**
 * @responsibility marketOverviewCache SWR 회귀 (ADR-0063 PR-β)
 *
 * SWR 4분기 (캐시 부재 / FRESH / STALE / EXPIRED) + inflight coalescing + fetchFn 실패 처리.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import {
  __resetForTests,
  FRESH_TTL_MS,
  getCacheState,
  getOrFetchAiResponse,
  HARD_EXPIRY_MS,
  STALE_TTL_MS,
} from './marketOverviewCache';

describe('marketOverviewCache — SWR 정책 SSOT', () => {
  beforeEach(() => {
    __resetForTests();
  });
  afterEach(() => {
    __resetForTests();
  });

  it('TTL 상수 정합 — FRESH < STALE < HARD_EXPIRY', () => {
    expect(FRESH_TTL_MS).toBe(60_000);
    expect(STALE_TTL_MS).toBe(5 * 60_000);
    expect(HARD_EXPIRY_MS).toBe(30 * 60_000);
    expect(FRESH_TTL_MS).toBeLessThan(STALE_TTL_MS);
    expect(STALE_TTL_MS).toBeLessThan(HARD_EXPIRY_MS);
  });

  it('캐시 부재 — 강제 fetch + 결과 캐시 + isStale=false', async () => {
    const fetchFn = vi.fn().mockResolvedValue({ summary: 'first call' });
    const out = await getOrFetchAiResponse(fetchFn);
    expect(out.raw).toEqual({ summary: 'first call' });
    expect(out.isStale).toBe(false);
    expect(fetchFn).toHaveBeenCalledTimes(1);
  });

  it('FRESH 윈도우 (age < 60초) — 캐시 hit, fetch 안 함', async () => {
    const fetchFn = vi.fn().mockResolvedValue({ summary: 'cached' });
    const t0 = 1_000_000;
    await getOrFetchAiResponse(fetchFn, t0);
    expect(fetchFn).toHaveBeenCalledTimes(1);

    const out = await getOrFetchAiResponse(fetchFn, t0 + 30_000);
    expect(out.raw).toEqual({ summary: 'cached' });
    expect(out.isStale).toBe(false);
    expect(fetchFn).toHaveBeenCalledTimes(1); // 추가 호출 없음
  });

  it('FRESH 경계값 (age = 59,999ms) — 여전히 fresh', async () => {
    const fetchFn = vi.fn().mockResolvedValue({ summary: 'edge fresh' });
    const t0 = 1_000_000;
    await getOrFetchAiResponse(fetchFn, t0);
    const out = await getOrFetchAiResponse(fetchFn, t0 + 59_999);
    expect(out.isStale).toBe(false);
    expect(fetchFn).toHaveBeenCalledTimes(1);
  });

  it('STALE 윈도우 (60초 ≤ age < 5분) — stale 반환 + 백그라운드 refresh', async () => {
    let callCount = 0;
    const fetchFn = vi.fn().mockImplementation(async () => {
      callCount += 1;
      return { summary: `call ${callCount}` };
    });
    const t0 = 1_000_000;
    await getOrFetchAiResponse(fetchFn, t0);
    expect(fetchFn).toHaveBeenCalledTimes(1);

    // 2분 경과 — stale 윈도우
    const out = await getOrFetchAiResponse(fetchFn, t0 + 2 * 60_000);
    expect(out.raw).toEqual({ summary: 'call 1' }); // stale 반환
    expect(out.isStale).toBe(true);

    // 백그라운드 refresh 가 끝나길 기다림
    await new Promise(resolve => setTimeout(resolve, 10));
    expect(fetchFn).toHaveBeenCalledTimes(2); // 백그라운드 fetch 발생
  });

  it('STALE 백그라운드 refresh 진행 중 동시 호출 — coalescing', async () => {
    let resolveFetch!: (raw: Record<string, unknown>) => void;
    const fetchFn = vi.fn().mockImplementation(() => new Promise<Record<string, unknown>>(r => { resolveFetch = r; }));

    const t0 = 1_000_000;
    // 첫 fetch 시작 + 즉시 resolve
    const firstPromise = getOrFetchAiResponse(fetchFn, t0);
    resolveFetch({ summary: 'initial' });
    await firstPromise;
    expect(fetchFn).toHaveBeenCalledTimes(1);

    // 2분 경과 — stale 진입, refresh 시작 (resolve 안 됨)
    const out1 = await getOrFetchAiResponse(fetchFn, t0 + 2 * 60_000);
    expect(out1.isStale).toBe(true);
    expect(fetchFn).toHaveBeenCalledTimes(2);

    // refresh 진행 중 동시 호출 — 추가 fetch 호출 안 됨 (background 1건만)
    const out2 = await getOrFetchAiResponse(fetchFn, t0 + 2 * 60_000 + 1000);
    expect(out2.isStale).toBe(true);
    expect(fetchFn).toHaveBeenCalledTimes(2); // 동일 — coalescing 작동

    resolveFetch({ summary: 'refreshed' });
  });

  it('EXPIRED (age >= 5분) — hard fetch await + 새 결과 반환', async () => {
    let callCount = 0;
    const fetchFn = vi.fn().mockImplementation(async () => {
      callCount += 1;
      return { summary: `call ${callCount}` };
    });
    const t0 = 1_000_000;
    await getOrFetchAiResponse(fetchFn, t0);

    // 6분 경과 — hard expiry
    const out = await getOrFetchAiResponse(fetchFn, t0 + 6 * 60_000);
    expect(out.raw).toEqual({ summary: 'call 2' });
    expect(out.isStale).toBe(false);
    expect(fetchFn).toHaveBeenCalledTimes(2);
  });

  it('STALE 경계값 (age = 5분) — hard fetch (STALE_TTL_MS 미만이 fresh)', async () => {
    let callCount = 0;
    const fetchFn = vi.fn().mockImplementation(async () => {
      callCount += 1;
      return { summary: `call ${callCount}` };
    });
    const t0 = 1_000_000;
    await getOrFetchAiResponse(fetchFn, t0);

    // 정확히 5분 = STALE_TTL_MS → hard fetch
    const out = await getOrFetchAiResponse(fetchFn, t0 + STALE_TTL_MS);
    expect(out.raw).toEqual({ summary: 'call 2' });
    expect(out.isStale).toBe(false);
  });

  it('fetchFn 실패 시 — 첫 호출 (캐시 부재) 은 throw', async () => {
    const fetchFn = vi.fn().mockRejectedValue(new Error('Gemini 503'));
    await expect(getOrFetchAiResponse(fetchFn)).rejects.toThrow('Gemini 503');
    expect(fetchFn).toHaveBeenCalledTimes(1);
  });

  it('fetchFn 실패 — STALE 윈도우 백그라운드 refresh 실패 시 stale 그대로 반환 (사용자 영향 없음)', async () => {
    const fetchFn = vi.fn()
      .mockResolvedValueOnce({ summary: 'initial' })
      .mockRejectedValue(new Error('Gemini 503'));

    const t0 = 1_000_000;
    await getOrFetchAiResponse(fetchFn, t0);

    // stale 진입 + 백그라운드 refresh 시작
    const out = await getOrFetchAiResponse(fetchFn, t0 + 2 * 60_000);
    expect(out.raw).toEqual({ summary: 'initial' });
    expect(out.isStale).toBe(true);

    // 백그라운드 refresh 가 실패해도 cache entry 보존
    await new Promise(resolve => setTimeout(resolve, 10));
    expect(fetchFn).toHaveBeenCalledTimes(2);
    // 다시 호출하면 또 stale
    const out2 = await getOrFetchAiResponse(fetchFn, t0 + 2 * 60_000 + 100);
    expect(out2.raw).toEqual({ summary: 'initial' });
  });

  it('동시 첫 호출 (캐시 부재) — coalescing 으로 fetchFn 1회만', async () => {
    let resolveFetch!: (raw: Record<string, unknown>) => void;
    const fetchFn = vi.fn().mockImplementation(() => new Promise<Record<string, unknown>>(r => { resolveFetch = r; }));

    const p1 = getOrFetchAiResponse(fetchFn);
    const p2 = getOrFetchAiResponse(fetchFn);
    const p3 = getOrFetchAiResponse(fetchFn);

    resolveFetch({ summary: 'shared' });
    const [r1, r2, r3] = await Promise.all([p1, p2, p3]);

    expect(fetchFn).toHaveBeenCalledTimes(1); // 3 호출 모두 동일 promise 편승
    expect(r1.raw).toEqual({ summary: 'shared' });
    expect(r2.raw).toEqual({ summary: 'shared' });
    expect(r3.raw).toEqual({ summary: 'shared' });
  });
});

describe('getCacheState — 진단', () => {
  beforeEach(() => __resetForTests());

  it('빈 캐시 — EMPTY classification', () => {
    expect(getCacheState()).toEqual({ hasEntry: false, ageMs: null, classification: 'EMPTY', inflight: false });
  });

  it('FRESH 분류', async () => {
    const fetchFn = vi.fn().mockResolvedValue({ summary: 'x' });
    const t0 = 1_000_000;
    await getOrFetchAiResponse(fetchFn, t0);
    const state = getCacheState(t0 + 30_000);
    expect(state.hasEntry).toBe(true);
    expect(state.classification).toBe('FRESH');
  });

  it('STALE 분류', async () => {
    const fetchFn = vi.fn().mockResolvedValue({ summary: 'x' });
    const t0 = 1_000_000;
    await getOrFetchAiResponse(fetchFn, t0);
    const state = getCacheState(t0 + 2 * 60_000);
    expect(state.classification).toBe('STALE');
  });

  it('EXPIRED 분류', async () => {
    const fetchFn = vi.fn().mockResolvedValue({ summary: 'x' });
    const t0 = 1_000_000;
    await getOrFetchAiResponse(fetchFn, t0);
    const state = getCacheState(t0 + 10 * 60_000);
    expect(state.classification).toBe('EXPIRED');
  });
});
