/**
 * prefetchedContext.test.ts — 아이디어 3 검증
 *
 * 검증 목표:
 *   1. 종목코드 검증: 6자리 아닌 입력은 throw.
 *   2. 전 소스 실패 시에도 블록 문자열은 생성되고 "데이터 없음" 마커가 포함된다.
 *   3. 정상 데이터 주입 시 수급·기술·재무·밸류에이션 섹션이 모두 나온다.
 */

import { describe, expect, it, vi, beforeEach } from 'vitest';

// 실제 fetch·KIS·DART 모듈은 외부 네트워크 의존 — 모두 mock.
vi.mock('../clients/kisClient.js', () => ({
  fetchCurrentPrice: vi.fn(),
  fetchKisInvestorFlow: vi.fn(),
  HAS_REAL_DATA_CLIENT: false,
  KIS_IS_REAL: false,
  hasKisClientOverrides: () => false,
  realDataKisGet: vi.fn(),
  fetchStockName: vi.fn(),
  fetchAccountBalance: vi.fn(),
}));

vi.mock('../screener/stockScreener.js', () => ({
  fetchYahooQuote: vi.fn(),
}));

vi.mock('../clients/dartFinancialClient.js', () => ({
  getDartFinancials: vi.fn(),
}));

vi.mock('../clients/krxClient.js', () => ({
  fetchPerPbr: vi.fn(async () => []),
}));

import { fetchCurrentPrice, fetchKisInvestorFlow } from '../clients/kisClient.js';
import { fetchYahooQuote } from '../screener/stockScreener.js';
import { getDartFinancials } from '../clients/dartFinancialClient.js';
import { fetchPerPbr } from '../clients/krxClient.js';
import { buildStockInterpretContext } from './prefetchedContext.js';

describe('buildStockInterpretContext', () => {
  beforeEach(() => {
    vi.mocked(fetchCurrentPrice).mockReset();
    vi.mocked(fetchKisInvestorFlow).mockReset();
    vi.mocked(fetchYahooQuote).mockReset();
    vi.mocked(getDartFinancials).mockReset();
    vi.mocked(fetchPerPbr).mockReset().mockResolvedValue([]);
  });

  it('6자리가 아닌 종목코드는 즉시 throw', async () => {
    await expect(
      buildStockInterpretContext({ code: 'ABCDEF', name: '잘못된' }),
    ).rejects.toThrow(/6자리/);
  });

  it('모든 소스가 null·실패여도 블록 문자열은 생성된다', async () => {
    vi.mocked(fetchCurrentPrice).mockResolvedValue(null);
    vi.mocked(fetchKisInvestorFlow).mockResolvedValue(null);
    vi.mocked(fetchYahooQuote).mockResolvedValue(null);
    vi.mocked(getDartFinancials).mockResolvedValue(null);

    const ctx = await buildStockInterpretContext({ code: '005930', name: '삼성전자' });
    expect(ctx).toContain('삼성전자');
    expect(ctx).toContain('## 수급 (KIS 실계좌)');
    expect(ctx).toContain('## 기술지표 (Yahoo 실계산)');
    expect(ctx).toContain('## 재무 (DART 실계산)');
    expect(ctx).toContain('## 밸류에이션');
    expect(ctx).toMatch(/데이터 없음/);
  });

  it('정상 데이터 주입 시 숫자·섹션이 모두 포함된다', async () => {
    vi.mocked(fetchCurrentPrice).mockResolvedValue(72500);
    vi.mocked(fetchKisInvestorFlow).mockResolvedValue({
      foreignNetBuy: 1_200_000,
      institutionalNetBuy: 300_000,
      individualNetBuy: -1_500_000,
      source: 'KIS_API',
    });
    vi.mocked(fetchYahooQuote).mockResolvedValue({
      price: 72500, changePercent: 1.5, volume: 20_000_000,
      dayOpen: 71000, prevClose: 71400,
      avgVolume: 15_000_000,
      ma5: 71000, ma20: 70500, ma60: 68000,
      high5d: 72800, high20d: 73000, high60d: 75000,
      atr: 1200, atr20avg: 1100, per: 18.5,
      rsi14: 62, macd: 300, macdSignal: 250, macdHistogram: 50,
      rsi5dAgo: 55, weeklyRSI: 60, ma60TrendUp: true, macd5dHistAgo: 20,
      return5d: 2.1, bbWidthCurrent: 0.05, bbWidth20dAvg: 0.06,
      vol5dAvg: 18_000_000, vol20dAvg: 15_000_000, atr5d: 1150,
      monthlyAboveEMA12: true, monthlyEMARising: true,
      weeklyAboveCloud: true, weeklyLaggingSpanUp: true,
      dailyVolumeDrying: false, isHighRisk: false,
    });
    vi.mocked(getDartFinancials).mockResolvedValue({
      roe: 12.5, opm: 15.3, debtRatio: 45.2, ocfRatio: 20.1,
      year: '2024', source: 'DART_API',
    });
    vi.mocked(fetchPerPbr).mockResolvedValue([
      { code: '005930', name: '삼성전자', per: 17.2, pbr: 1.3, dividendYield: 2.5, eps: 4200, bps: 55000, close: 72500 },
    ]);

    const ctx = await buildStockInterpretContext({ code: '005930', name: '삼성전자' });
    expect(ctx).toContain('72,500');       // 현재가
    expect(ctx).toContain('1,200,000');    // 외국인 순매수
    expect(ctx).toContain('12.5');         // ROE
    expect(ctx).toContain('17.2');         // KRX PER (KRX가 Yahoo보다 우선)
    expect(ctx).toContain('1.3');          // PBR
  });
});
