/**
 * @responsibility enrichStockWithRealData OHLCV Naver-first 배선 회귀 — 장외/주말에도 기술지표 계산.
 *
 * 사용자 보고: 종목검색 카드는 뜨나 상세(기술지표 등)가 전부 빈칸. 원인은 OHLCV 소스가 Yahoo
 * (/historical-data) 단독이라 장외에 204 → aiFallback(기술지표 미계산). Naver 일봉(장외 가용)을
 * 1차로 사용하면 OHLCV 확보 → RSI/MACD/볼린저 등 계산 → 카드 상세가 채워진다.
 * 본 테스트는 소스 배선(Naver 우선, Yahoo 폴백)을 검증한다(지표 계산 자체는 main-path 기존 로직).
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { StockRecommendation } from './types';

const N = 30;
const closes = Array.from({ length: N }, (_, i) => 100 + i);
const NAVER_OHLCV = {
  data: {
    timestamp: Array.from({ length: N }, (_, i) => 1_700_000_000 + i * 86400),
    indicators: {
      quote: [{
        open: closes.map((c) => c - 0.5),
        high: closes.map((c) => c + 1),
        low: closes.map((c) => c - 1),
        close: [...closes],
        volume: closes.map(() => 1000),
      }],
    },
  },
  meta: {},
};

const mockedNaver = vi.fn().mockResolvedValue(NAVER_OHLCV);
const mockedHistorical = vi.fn().mockResolvedValue(null);

vi.mock('./naverDailyChart', () => ({
  fetchNaverDailyChart: (code: string, range?: string) => mockedNaver(code, range),
  fetchNaverSupply: vi.fn().mockResolvedValue(null),
}));
vi.mock('./historicalData', () => ({ fetchHistoricalData: (code: string, range?: string) => mockedHistorical(code, range) }));
vi.mock('../../api/aiUniverseClient', () => ({ fetchAiUniverseSnapshot: vi.fn().mockResolvedValue(null) }));
vi.mock('./dartDataFetcher', () => ({ fetchCorpCode: vi.fn().mockResolvedValue(null), fetchDartFinancials: vi.fn().mockResolvedValue(null) }));
vi.mock('../../api/foreignerRatioClient', () => ({ fetchForeignerRatioTrend: vi.fn().mockResolvedValue(null) }));
vi.mock('../../api/krxInvestorClient', () => ({ fetchKrxInvestorTrend: vi.fn().mockResolvedValue(null) }));
vi.mock('../../api/yahooConsensusClient', () => ({ fetchYahooConsensus: vi.fn().mockResolvedValue(null) }));

beforeEach(() => {
  mockedNaver.mockClear();
  mockedHistorical.mockClear();
  mockedNaver.mockResolvedValue(NAVER_OHLCV);
});

const STUB = (overrides: Partial<StockRecommendation> = {}): StockRecommendation => ({
  name: '삼성전기', code: '009150', reason: '', type: 'BUY',
  patterns: [], hotness: 0, roeType: '', isLeadingSector: false,
  momentumRank: 0, supplyQuality: { passive: false, active: false },
  peakPrice: 0, currentPrice: 0, isPreviousLeader: false, ichimokuStatus: 'INSIDE_CLOUD',
  relatedSectors: [],
  valuation: { per: 0, pbr: 0, epsGrowth: 0, debtRatio: 0 },
  technicalSignals: { maAlignment: 'NEUTRAL', rsi: 0, macdStatus: 'NEUTRAL', bollingerStatus: 'NEUTRAL', stochasticStatus: 'NEUTRAL', volumeSurge: false, disparity20: 0, macdHistogram: 0, bbWidth: 0, stochRsi: 0 },
  economicMoat: { type: 'NONE', description: '' },
  scores: { value: 0, momentum: 0 },
  marketSentiment: { iri: 0, vkospi: 0 },
  confidenceScore: 0, marketCap: 0, marketCapCategory: 'MID',
  correlationGroup: '',
  aiConvictionScore: { totalScore: 0, factors: [], marketPhase: 'NEUTRAL', description: '' },
  riskFactors: [], targetPrice: 0, stopLoss: 0,
  checklist: {} as StockRecommendation['checklist'],
  visualReport: { financial: 0, technical: 0, supply: 0, summary: '' },
  ...overrides,
} as unknown as StockRecommendation);

describe('enrichStockWithRealData — OHLCV Naver-first 배선 (장외 기술지표 확보)', () => {
  it('KR 종목은 Naver 일봉 우선 → 성공 시 Yahoo(/historical-data) 미호출', async () => {
    const { enrichStockWithRealData } = await import('./enrichment');
    const result = await enrichStockWithRealData(STUB());

    expect(mockedNaver).toHaveBeenCalledWith('009150', '1y');
    expect(mockedHistorical).not.toHaveBeenCalled();
    // snapshot 부재 시 Naver 일봉 마지막 종가(129)로 currentPrice 채움(price fallback — 이전 "가격 미확보" 해소).
    expect(result.currentPrice).toBe(129);
  });

  it('Naver 실패(null) 시 Yahoo(/historical-data)로 폴백', async () => {
    mockedNaver.mockResolvedValue(null);
    const { enrichStockWithRealData } = await import('./enrichment');
    await enrichStockWithRealData(STUB());

    expect(mockedNaver).toHaveBeenCalled();
    expect(mockedHistorical).toHaveBeenCalledWith('009150', '1y');
  });

  it('비-KR 종목은 Naver 시도 안 하고 Yahoo 직행', async () => {
    const { enrichStockWithRealData } = await import('./enrichment');
    await enrichStockWithRealData(STUB({ code: 'AAPL' }));

    expect(mockedNaver).not.toHaveBeenCalled();
    expect(mockedHistorical).toHaveBeenCalledWith('AAPL', '1y');
  });
});
