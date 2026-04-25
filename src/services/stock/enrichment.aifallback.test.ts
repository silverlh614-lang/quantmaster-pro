/**
 * @responsibility enrichStockWithRealData aiFallback Naver closePrice 보강 회귀 — 2026-04-24
 *
 * 사용자 보고: AI 추천 카드는 보이지만 가격이 모두 "-" 로 표시됨. 원인은 장외/주말에
 * fetchHistoricalData 가 null 반환 → aiFallback 진입 → Gemini 가 currentPrice=0 으로
 * 응답 → applyTradingFieldFallbacks 도 currentPrice<=0 이면 비활성화. Naver snapshot 의
 * closePrice(전일 종가) 로 보강해 사용자에게 "참고 가격" 을 노출한다.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import type { StockRecommendation } from './types';

// fetch 모듈을 가짜로 — historical-data 는 null, ai-universe/snapshot 은 closePrice 가 있는 데이터.
const FAKE_FETCH_HISTORICAL_NULL = vi.fn().mockResolvedValue(null);
const FAKE_FETCH_SNAPSHOT_OK = vi.fn().mockResolvedValue({
  code: '005930',
  name: '삼성전자',
  per: 12.5, pbr: 1.3, eps: 5000, bps: 50000,
  marketCap: 480_0000_0000_0000, marketCapDisplay: '480조',
  dividendYield: 1.8, foreignerOwnRatio: 52.5,
  closePrice: 75000, changeRate: 2.5,
  found: true, source: 'NAVER_MOBILE',
});

vi.mock('./historicalData', () => ({
  fetchHistoricalData: (code: string, range?: string) => FAKE_FETCH_HISTORICAL_NULL(code, range),
}));
vi.mock('../../api/aiUniverseClient', () => ({
  fetchAiUniverseSnapshot: (code: string) => FAKE_FETCH_SNAPSHOT_OK(code),
}));
vi.mock('./dartDataFetcher', () => ({
  fetchCorpCode: vi.fn().mockResolvedValue(null),
  fetchDartFinancials: vi.fn().mockResolvedValue(null),
}));

beforeEach(() => {
  FAKE_FETCH_HISTORICAL_NULL.mockClear();
  FAKE_FETCH_SNAPSHOT_OK.mockClear();
});
afterEach(() => {
  vi.clearAllMocks();
});

const STUB_STOCK = (overrides: Partial<StockRecommendation> = {}): StockRecommendation => ({
  name: '삼성전자', code: '005930', reason: '', type: 'BUY',
  patterns: [], hotness: 5, roeType: '', isLeadingSector: false,
  momentumRank: 1, supplyQuality: { passive: false, active: false },
  peakPrice: 0, currentPrice: 0, isPreviousLeader: false, ichimokuStatus: 'INSIDE_CLOUD',
  relatedSectors: ['반도체'],
  valuation: { per: 0, pbr: 0, epsGrowth: 0, debtRatio: 0 },
  technicalSignals: { maAlignment: 'NEUTRAL', rsi: 0, macdStatus: 'NEUTRAL', bollingerStatus: 'NEUTRAL', stochasticStatus: 'NEUTRAL', volumeSurge: false, disparity20: 0, macdHistogram: 0, bbWidth: 0, stochRsi: 0 },
  economicMoat: { type: 'NONE', description: '' },
  scores: { value: 0, momentum: 0 },
  marketSentiment: { iri: 0, vkospi: 0 },
  confidenceScore: 75, marketCap: 0, marketCapCategory: 'LARGE',
  correlationGroup: '',
  aiConvictionScore: { totalScore: 0, factors: [], marketPhase: 'NEUTRAL', description: '' },
  riskFactors: [], targetPrice: 0, stopLoss: 0,
  checklist: {} as StockRecommendation['checklist'],
  visualReport: { financial: 0, technical: 0, supply: 0, summary: '' },
  historicalAnalogy: { stockName: '', period: '', similarity: 0, reason: '' },
  anomalyDetection: { type: 'NONE', score: 0, description: '' },
  semanticMapping: { theme: '', keywords: [], relevanceScore: 0, description: '' },
  ...overrides,
});

describe('enrichStockWithRealData — aiFallback Naver closePrice 보강 (2026-04-24)', () => {
  it('historical 데이터 없음 + currentPrice=0 → Naver closePrice(75000) 로 보강', async () => {
    const { enrichStockWithRealData } = await import('./enrichment');
    const stock = STUB_STOCK();
    const result = await enrichStockWithRealData(stock);

    // Naver snapshot 가 호출되어야 함
    expect(FAKE_FETCH_SNAPSHOT_OK).toHaveBeenCalledWith('005930');
    // 75000 으로 currentPrice 보강
    expect(result.currentPrice).toBe(75000);
    // applyTradingFieldFallbacks 가 75000 기준으로 활성화
    expect(result.targetPrice).toBe(Math.round(75000 * 1.20));      // 90,000
    expect(result.targetPrice2).toBe(Math.round(75000 * 1.35));     // 101,250
    expect(result.entryPrice).toBe(75000);
    expect(result.stopLoss).toBe(Math.round(75000 * 0.93));         // 69,750
    // PER/PBR/marketCap 도 Naver snapshot 으로 채워짐
    expect(result.valuation.per).toBe(12.5);
    expect(result.valuation.pbr).toBe(1.3);
    expect(result.marketCap).toBe(480_0000_0000_0000);
    // dataSourceType = 'STALE' (REALTIME 도 AI 도 아닌 전일 종가 출처 표시)
    expect(result.dataSourceType).toBe('STALE');
    expect(result.priceUpdatedAt).toContain('전일 종가');
  });

  it('Naver snapshot 도 실패하면 stock 그대로 (currentPrice=0 유지) + dataSourceType=AI', async () => {
    FAKE_FETCH_SNAPSHOT_OK.mockResolvedValueOnce(null);
    const { enrichStockWithRealData } = await import('./enrichment');
    const stock = STUB_STOCK();
    const result = await enrichStockWithRealData(stock);

    expect(result.currentPrice).toBe(0);
    expect(result.targetPrice).toBe(0);   // applyTradingFieldFallbacks 가 0 이면 비활성
    expect(result.dataSourceType).toBe('AI');
  });

  it('이미 currentPrice 가 있으면 Naver snapshot 호출 안 함 — 무비용 호출 절감', async () => {
    const { enrichStockWithRealData } = await import('./enrichment');
    const stock = STUB_STOCK({ currentPrice: 80000 });
    const result = await enrichStockWithRealData(stock);

    expect(FAKE_FETCH_SNAPSHOT_OK).not.toHaveBeenCalled();
    expect(result.currentPrice).toBe(80000);
  });

  it('비-한국 종목 (US 심볼) 은 Naver 시도 안 함', async () => {
    const { enrichStockWithRealData } = await import('./enrichment');
    const stock = STUB_STOCK({ code: 'AAPL' });
    await enrichStockWithRealData(stock);

    expect(FAKE_FETCH_SNAPSHOT_OK).not.toHaveBeenCalled();
  });

  it('snapshot.closePrice=0 (Naver miss) 면 currentPrice 보강 실패 — fallback 비활성', async () => {
    FAKE_FETCH_SNAPSHOT_OK.mockResolvedValueOnce({
      code: '005930', name: '', per: 0, pbr: 0, eps: 0, bps: 0,
      marketCap: 0, marketCapDisplay: '', dividendYield: 0, foreignerOwnRatio: 0,
      closePrice: 0, changeRate: 0, found: false, source: 'NAVER_MISS',
    });
    const { enrichStockWithRealData } = await import('./enrichment');
    const stock = STUB_STOCK();
    const result = await enrichStockWithRealData(stock);

    expect(result.currentPrice).toBe(0);
    expect(result.dataSourceType).toBe('AI');
  });
});
