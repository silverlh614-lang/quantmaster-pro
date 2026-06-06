// @responsibility realDataRecommendations 회귀 — AI-off 후보발굴(discoverAiUniverse+enrich, Gemini 미호출).
import { describe, it, expect, vi, beforeEach } from 'vitest';

const mockedDiscover = vi.fn();
const mockedEnrich = vi.fn(async (s: { code: string }) => ({ ...s, currentPrice: 160000 }));
const mockedFetch = vi.fn();
vi.stubGlobal('fetch', mockedFetch);

vi.mock('../../api/aiUniverseClient', () => ({ discoverAiUniverse: (...a: unknown[]) => mockedDiscover(...a) }));
vi.mock('./enrichment', () => ({ enrichStockWithRealData: (s: unknown) => mockedEnrich(s as { code: string }) }));
vi.mock('../../utils/debug', () => ({ debugLog: vi.fn() }));

import { buildRealDataRecommendations, rankCandidates, mapToUniverseMode } from './realDataRecommendations';
import type { MomentumCandidate } from './momentumRecommendations';

function universe(cands: Array<Record<string, unknown>>) {
  return {
    mode: 'MOMENTUM',
    candidates: cands,
    fetchedAt: 0,
    diagnostics: { googleQueries: 0, googleHits: 0, masterMisses: 0, enrichSucceeded: 0, enrichFailed: 0, budgetExceeded: false, sourceStatus: 'FALLBACK_QUANT' },
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  mockedEnrich.mockImplementation(async (s: { code: string }) => ({ ...s, currentPrice: 160000 }));
  // 기본: KIS 스크리너 캐시 비어있음 → discover(Naver) 폴백 경로 검증.
  mockedFetch.mockResolvedValue({ ok: true, json: async () => [] });
});

describe('buildRealDataRecommendations — AI-off 후보발굴', () => {
  it('discover 후보를 enrich 해 추천 생성 (Gemini 경로 없음)', async () => {
    mockedDiscover.mockResolvedValue(universe([
      { code: '009150', name: '삼성전기', market: 'KOSPI', discoveredFrom: ['quant'], snapshot: { per: 12, pbr: 1.2, changeRate: 3.5, marketCapDisplay: '13조' } },
      { code: '005930', name: '삼성전자', market: 'KOSPI', discoveredFrom: ['quant'], snapshot: { per: 10, pbr: 1.1, changeRate: 1.0, marketCapDisplay: '480조' } },
    ]));
    const res = await buildRealDataRecommendations({ mode: 'MOMENTUM' });

    expect(mockedDiscover).toHaveBeenCalledWith('MOMENTUM', expect.anything());
    expect(res.recommendations.length).toBe(2);
    expect(res.recommendations[0].currentPrice).toBe(160000);
    expect(res.sourceStatus).toBe('FALLBACK_QUANT');
  });

  it('KIS 스크리너 캐시가 있으면 KIS 우선 사용 (discover 미호출, quota-safe)', async () => {
    mockedFetch.mockResolvedValue({
      ok: true,
      json: async () => [
        { code: '009150', name: '삼성전기', changeRate: 3.5, per: 12, volume: 1, turnoverRate: 1, foreignNetBuy: 100, currentPrice: 160000, screenedAt: '' },
        { code: '005930', name: '삼성전자', changeRate: 1.0, per: 10, volume: 1, turnoverRate: 1, foreignNetBuy: 50, currentPrice: 80000, screenedAt: '' },
      ],
    });
    const res = await buildRealDataRecommendations({ mode: 'MOMENTUM' });
    expect(mockedDiscover).not.toHaveBeenCalled();
    expect(res.recommendations.length).toBe(2);
    expect(res.recommendations[0].code).toBe('009150'); // changeRate 3.5 > 1.0 → 모멘텀 상위
  });

  it('universe 비면 빈 추천 + 경고', async () => {
    mockedDiscover.mockResolvedValue(universe([]));
    const res = await buildRealDataRecommendations({ mode: 'MOMENTUM' });
    expect(res.recommendations).toEqual([]);
    expect((res.warnings ?? []).length).toBeGreaterThan(0);
  });

  it('discover 가 throw 해도 throw 없이 빈 추천', async () => {
    mockedDiscover.mockRejectedValue(new Error('net'));
    const res = await buildRealDataRecommendations({ mode: 'MOMENTUM' });
    expect(res.recommendations).toEqual([]);
  });
});

describe('rankCandidates / mapToUniverseMode', () => {
  const mk = (code: string, changePercent: number, rank: number): MomentumCandidate => ({
    code, name: code, market: '', changePercent, rank, source: '', per: 0, pbr: 0, marketCapDisplay: '',
  });

  it('MOMENTUM 은 상승률 desc, BEAR 는 하락률(asc) 우선', () => {
    const list = [mk('a', 1, 2), mk('b', 5, 1)];
    expect(rankCandidates(list, 'MOMENTUM')[0].code).toBe('b');
    expect(rankCandidates(list, 'BEAR_SCREEN')[0].code).toBe('a');
  });

  it('maxPer 필터 적용(per>0 만)', () => {
    const list = [mk('a', 1, 1), { ...mk('b', 1, 2), per: 50 }];
    const out = rankCandidates(list, 'MOMENTUM', { maxPer: 20 });
    expect(out.map((c) => c.code)).toEqual(['a']); // per 50 > 20 제외, per 0 은 통과
  });

  it('mapToUniverseMode', () => {
    expect(mapToUniverseMode('BEAR_SCREEN')).toBe('BEAR_SCREEN');
    expect(mapToUniverseMode('QUANT_SCREEN')).toBe('QUANT_SCREEN');
    expect(mapToUniverseMode(undefined)).toBe('MOMENTUM');
    expect(mapToUniverseMode('xyz')).toBe('MOMENTUM');
  });
});
