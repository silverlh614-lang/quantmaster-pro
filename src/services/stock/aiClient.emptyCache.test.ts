/**
 * @responsibility aiClient getCachedAIResponse 의 빈 응답 read 무효화 회귀
 *
 * 사용자 보고 "AI 추천 버튼 누르면 바로 완료되었다고 뜨고 아무것도 안 검색됨" 의
 * 핵심 원인 — 이전 버전이 빈 recommendations 를 캐시에 저장한 뒤 read 경로가
 * 그대로 반환하여 24h 동안 박제되던 구조 해소.
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';

// localStorage stub — happy-dom/jsdom 이 없는 vitest 노드 환경 대비
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
  // global window/localStorage 가 없으면 만들어준다
  (globalThis as any).localStorage = localStorageStub;
  (globalThis as any).window = (globalThis as any).window ?? { localStorage: localStorageStub };
});

describe('getCachedAIResponse — 빈 응답 read 무효화 (PR-31)', () => {
  it('메모리 캐시에 빈 recommendations 가 있어도 fetchFn 을 다시 호출한다', async () => {
    const { aiCache, getCachedAIResponse } = await import('./aiClient');
    // 사전 박제 — 빈 recommendations
    aiCache['recommendations-test-empty'] = {
      data: { recommendations: [] },
      timestamp: Date.now(),
    };

    const fetchFn = vi.fn().mockResolvedValue({
      recommendations: [{ name: '삼성전자', code: '005930', confidenceScore: 80 }],
      marketContext: {},
    });

    const result = await getCachedAIResponse('recommendations-test-empty', fetchFn);
    expect(fetchFn).toHaveBeenCalledTimes(1);
    expect(result).toEqual(expect.objectContaining({
      recommendations: expect.arrayContaining([expect.objectContaining({ code: '005930' })]),
    }));
    // 빈 entry 는 자동 무효화되어 새 결과로 교체
    expect(aiCache['recommendations-test-empty']?.data).toEqual(result);
  });

  it('비어있지 않은 메모리 캐시는 그대로 반환', async () => {
    const { aiCache, getCachedAIResponse } = await import('./aiClient');
    const cached = {
      data: { recommendations: [{ name: '카카오', code: '035720', confidenceScore: 70 }] },
      timestamp: Date.now(),
    };
    aiCache['recommendations-test-hit'] = cached;

    const fetchFn = vi.fn();
    const result = await getCachedAIResponse('recommendations-test-hit', fetchFn);
    expect(fetchFn).not.toHaveBeenCalled();
    expect(result).toEqual(cached.data);
  });

  it('localStorage 에 박제된 빈 응답도 read 시 자동 무효화', async () => {
    const { getCachedAIResponse } = await import('./aiClient');
    const lsKey = 'qm:ai:recommendations-test-ls-empty';
    localStorageStub.setItem(lsKey, JSON.stringify({
      data: { recommendations: [] },
      timestamp: Date.now(),
    }));

    const fetchFn = vi.fn().mockResolvedValue({
      recommendations: [{ name: '삼성전자', code: '005930', confidenceScore: 80 }],
      marketContext: {},
    });

    await getCachedAIResponse('recommendations-test-ls-empty', fetchFn);
    expect(fetchFn).toHaveBeenCalledTimes(1);
    // 빈 entry 가 무효화되고 새 fetch 결과로 교체됨 — 박제 상태 해소.
    const after = localStorageStub.getItem(lsKey);
    expect(after).not.toBeNull();
    const parsed = after ? JSON.parse(after) : null;
    expect(parsed?.data?.recommendations?.length).toBeGreaterThan(0);
  });
});
