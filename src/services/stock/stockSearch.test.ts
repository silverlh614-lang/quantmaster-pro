// @responsibility searchStock master-first 회귀 — 특정 종목 검색이 로컬 마스터로 해석되어 Gemini(429) 미호출.
import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../../api/aiUniverseClient', () => ({ searchStockMaster: vi.fn() }));
vi.mock('./enrichment', () => ({
  enrichStockWithRealData: vi.fn(async (s: { code: string; name: string }) => ({ ...s, currentPrice: 70000 })),
}));
vi.mock('./aiClient', () => ({
  getAI: vi.fn(() => ({ models: { generateContent: vi.fn(async () => ({ text: '[]' })) } })),
  withRetry: vi.fn(async (fn: () => Promise<unknown>) => fn()),
  safeJsonParse: vi.fn(() => []),
}));
vi.mock('../../utils/debug', () => ({ debugLog: vi.fn() }));
vi.mock('../../constants/aiConfig', () => ({ AI_MODELS: { PRIMARY: 'test-model' } }));

import { searchStock, clearSearchCache } from './stockSearch';
import { searchStockMaster } from '../../api/aiUniverseClient';
import { getAI, withRetry } from './aiClient';
import { enrichStockWithRealData } from './enrichment';

const mockedMaster = vi.mocked(searchStockMaster);
const mockedEnrich = vi.mocked(enrichStockWithRealData);

describe('searchStock — master-first (Gemini 의존 제거)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    clearSearchCache();
  });

  it('마스터 히트 시 Gemini(getAI) 미호출 + enrich 실데이터 반환', async () => {
    mockedMaster.mockResolvedValue([{ code: '009150', name: '삼성전기', market: 'KOSPI' }]);

    const res = await searchStock('삼성전기');

    expect(mockedMaster).toHaveBeenCalledWith('삼성전기', 8);
    expect(mockedEnrich).toHaveBeenCalledTimes(1);
    expect(getAI).not.toHaveBeenCalled();   // 핵심: Gemini 미호출 → 휴장·크레딧소진 429 회피
    expect(withRetry).not.toHaveBeenCalled();
    expect(res).toHaveLength(1);
    expect(res[0].code).toBe('009150');
    expect(res[0].currentPrice).toBe(70000);
  });

  it('여러 마스터 히트는 최대 6건 enrich', async () => {
    mockedMaster.mockResolvedValue(
      Array.from({ length: 8 }, (_, i) => ({ code: String(100000 + i), name: `종목${i}`, market: 'KOSPI' as const })),
    );

    const res = await searchStock('종목');

    expect(res).toHaveLength(6);
    expect(getAI).not.toHaveBeenCalled();
  });

  it('마스터 미스 시 AI 폴백 경로 진입 (getAI 호출)', async () => {
    mockedMaster.mockResolvedValue([]);

    const res = await searchStock('존재하지않는종목XYZ');

    expect(mockedMaster).toHaveBeenCalled();
    expect(getAI).toHaveBeenCalled();       // 미등록 종목만 AI 폴백
    expect(res).toEqual([]);
  });

  it('마스터 호출 자체가 실패해도 throw 없이 AI 폴백', async () => {
    mockedMaster.mockRejectedValue(new Error('network'));

    const res = await searchStock('삼성전기');

    expect(getAI).toHaveBeenCalled();
    expect(res).toEqual([]);
  });
});
