/**
 * @responsibility aiClient getCachedAIResponse — null 응답 가드 + 메모리 TTL 회귀 — 2026-04-24
 *
 * 진단 Step 1 잔여 결함:
 *  H3: isEmptyRecommendationData(null) === false 라서 null 데이터가 박제 가능.
 *  + 메모리 캐시 timestamp 만료 검사 누락으로 4h 초과 entry 가 메모리에 살아남음.
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';

const memoryStore = new Map<string, string>();
const localStorageStub = {
  getItem: (k: string) => memoryStore.get(k) ?? null,
  setItem: (k: string, v: string) => { memoryStore.set(k, v); },
  removeItem: (k: string) => { memoryStore.delete(k); },
  clear: () => { memoryStore.clear(); },
  key: (i: number) => Array.from(memoryStore.keys())[i] ?? null,
  get length() { return memoryStore.size; },
};

beforeEach(() => {
  memoryStore.clear();
  (globalThis as any).localStorage = localStorageStub;
  (globalThis as any).window = (globalThis as any).window ?? { localStorage: localStorageStub };
});

describe('getCachedAIResponse — null 응답 가드 (2026-04-24)', () => {
  it('메모리 캐시에 null 데이터가 있어도 fetchFn 다시 호출', async () => {
    const { aiCache, getCachedAIResponse } = await import('./aiClient');
    aiCache['null-test'] = { data: null, timestamp: Date.now() };

    const fetchFn = vi.fn().mockResolvedValue({
      recommendations: [{ name: '카카오', code: '035720', confidenceScore: 70 }],
    });

    const result = await getCachedAIResponse('null-test', fetchFn);
    expect(fetchFn).toHaveBeenCalledTimes(1);
    expect((result as any).recommendations.length).toBeGreaterThan(0);
  });

  it('메모리 캐시 4시간(AI_CACHE_TTL) 초과 entry 는 무효화', async () => {
    const { aiCache, getCachedAIResponse } = await import('./aiClient');
    const FOUR_HOURS = 4 * 60 * 60 * 1000;
    aiCache['stale-test'] = {
      data: { recommendations: [{ name: '오래된', code: '111111', confidenceScore: 50 }] },
      timestamp: Date.now() - FOUR_HOURS - 60_000, // 4h 1분 전
    };

    const fetchFn = vi.fn().mockResolvedValue({
      recommendations: [{ name: '신선한', code: '222222', confidenceScore: 80 }],
    });

    const result = await getCachedAIResponse('stale-test', fetchFn);
    expect(fetchFn).toHaveBeenCalledTimes(1);
    expect((result as any).recommendations[0].code).toBe('222222');
  });

  it('메모리 캐시 TTL 내 + 비어있지 않으면 그대로 반환 (정상 경로)', async () => {
    const { aiCache, getCachedAIResponse } = await import('./aiClient');
    aiCache['fresh-test'] = {
      data: { recommendations: [{ name: '캐시', code: '333333', confidenceScore: 90 }] },
      timestamp: Date.now() - 60_000, // 1분 전
    };

    const fetchFn = vi.fn();
    const result = await getCachedAIResponse('fresh-test', fetchFn);
    expect(fetchFn).not.toHaveBeenCalled();
    expect((result as any).recommendations[0].code).toBe('333333');
  });
});
