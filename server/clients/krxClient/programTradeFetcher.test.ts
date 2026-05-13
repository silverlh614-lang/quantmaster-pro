// @responsibility Patch-006 KRX market program-trade fetcher unit — KOSPI/KOSDAQ aggregation + intraday + ENV gate.

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// krxPost mock (외부 호출 0)
vi.mock('./http.js', () => ({
  krxPost: vi.fn(),
}));

import { krxPost } from './http.js';
import {
  KRX_MARKET_PROGRAM_CODE_MAP,
  KRX_BLD_MARKET_PROGRAM_TRADE,
  isKrxMarketProgramFallbackDisabled,
  isKstIntradaySession,
  fetchKrxMarketProgramTradeSingle,
  fetchKrxMarketProgramTradeAggregate,
  type KrxMarketProgramRow,
} from './programTradeFetcher.js';

const mockKrxPost = vi.mocked(krxPost);

describe('Patch-006 KRX_MARKET_PROGRAM_CODE_MAP SSOT', () => {
  it('KOSPI/KOSDAQ/ALL 3 entry + frozen', () => {
    expect(KRX_MARKET_PROGRAM_CODE_MAP.KOSPI).toBe('STK');
    expect(KRX_MARKET_PROGRAM_CODE_MAP.KOSDAQ).toBe('KSQ');
    expect(KRX_MARKET_PROGRAM_CODE_MAP.ALL).toBe('ALL');
    expect(Object.isFrozen(KRX_MARKET_PROGRAM_CODE_MAP)).toBe(true);
  });
  it('KRX_BLD_MARKET_PROGRAM_TRADE default 또는 ENV override', () => {
    expect(typeof KRX_BLD_MARKET_PROGRAM_TRADE).toBe('string');
    expect(KRX_BLD_MARKET_PROGRAM_TRADE.length).toBeGreaterThan(0);
  });
});

describe('Patch-006 isKrxMarketProgramFallbackDisabled ENV gate', () => {
  const orig = process.env.KRX_MARKET_PROGRAM_FALLBACK_DISABLED;
  afterEach(() => {
    if (orig === undefined) delete process.env.KRX_MARKET_PROGRAM_FALLBACK_DISABLED;
    else process.env.KRX_MARKET_PROGRAM_FALLBACK_DISABLED = orig;
  });
  it('default OFF', () => {
    delete process.env.KRX_MARKET_PROGRAM_FALLBACK_DISABLED;
    expect(isKrxMarketProgramFallbackDisabled()).toBe(false);
  });
  it('=true → disabled', () => {
    process.env.KRX_MARKET_PROGRAM_FALLBACK_DISABLED = 'true';
    expect(isKrxMarketProgramFallbackDisabled()).toBe(true);
  });
  it('"1"/"TRUE"/"yes" 모두 거부 (ADR-0157)', () => {
    for (const v of ['1', 'TRUE', 'yes', '']) {
      process.env.KRX_MARKET_PROGRAM_FALLBACK_DISABLED = v;
      expect(isKrxMarketProgramFallbackDisabled()).toBe(false);
    }
  });
});

describe('Patch-006 isKstIntradaySession', () => {
  it('KST 평일 12:00 → true', () => {
    // UTC 03:00 화요일 = KST 12:00 화요일
    expect(isKstIntradaySession(Date.parse('2026-05-12T03:00:00Z'))).toBe(true);
  });
  it('KST 토요일 → false', () => {
    expect(isKstIntradaySession(Date.parse('2026-05-09T03:00:00Z'))).toBe(false);
  });
  it('KST 평일 08:00 → false (장전)', () => {
    // UTC 23:00 월요일 = KST 화요일 08:00
    expect(isKstIntradaySession(Date.parse('2026-05-11T23:00:00Z'))).toBe(false);
  });
  it('KST 평일 16:00 → false (장후)', () => {
    expect(isKstIntradaySession(Date.parse('2026-05-12T07:00:00Z'))).toBe(false);
  });
  it('KST 평일 09:00 boundary → true', () => {
    // UTC 00:00 화요일 = KST 09:00 화요일
    expect(isKstIntradaySession(Date.parse('2026-05-12T00:00:00Z'))).toBe(true);
  });
  it('KST 평일 15:30 boundary → true', () => {
    // UTC 06:30 화요일 = KST 15:30
    expect(isKstIntradaySession(Date.parse('2026-05-12T06:30:00Z'))).toBe(true);
  });
});

describe('Patch-006 fetchKrxMarketProgramTradeSingle', () => {
  beforeEach(() => {
    mockKrxPost.mockReset();
    delete process.env.KRX_MARKET_PROGRAM_FALLBACK_DISABLED;
  });

  it('ENV disabled → null + krxPost 미호출', async () => {
    process.env.KRX_MARKET_PROGRAM_FALLBACK_DISABLED = 'true';
    const r = await fetchKrxMarketProgramTradeSingle('KOSPI');
    expect(r).toBeNull();
    expect(mockKrxPost).not.toHaveBeenCalled();
    delete process.env.KRX_MARKET_PROGRAM_FALLBACK_DISABLED;
  });

  it('빈 응답 → null', async () => {
    mockKrxPost.mockResolvedValue({ output: [] });
    const r = await fetchKrxMarketProgramTradeSingle('KOSPI');
    expect(r).toBeNull();
    expect(mockKrxPost).toHaveBeenCalledTimes(1);
  });

  it('정상 응답 (한글 키 PRGM_NTBY_TRPMN) → row 추출', async () => {
    mockKrxPost.mockResolvedValue({
      output: [{ PRGM_NTBY_TRPMN: '1500', PRGM_BUY_TRPMN: '5000', PRGM_SELL_TRPMN: '3500', ARBT_NTBY_TRPMN: '300', NABT_NTBY_TRPMN: '1200', TRD_DD: '20260509' }],
    });
    const r = await fetchKrxMarketProgramTradeSingle('KOSPI');
    expect(r).not.toBeNull();
    expect(r?.market).toBe('KOSPI');
    expect(r?.programNetBuyAmount).toBe(1500);
    expect(r?.arbitrageNetBuy).toBe(300);
    expect(r?.nonArbitrageNetBuy).toBe(1200);
    expect(r?.rawDate).toBe('20260509');
  });

  it('영문 alt key (NETBUY_TRDVAL) fallback', async () => {
    mockKrxPost.mockResolvedValue({
      output: [{ NETBUY_TRDVAL: '800', BUY_TRDVAL: '2000', SELL_TRDVAL: '1200' }],
    });
    const r = await fetchKrxMarketProgramTradeSingle('KOSDAQ');
    expect(r?.programNetBuyAmount).toBe(800);
    expect(r?.market).toBe('KOSDAQ');
  });

  it('모든 필드 null 시 의미 없는 응답 → null 반환', async () => {
    mockKrxPost.mockResolvedValue({
      output: [{ TRD_DD: '20260509' }],
    });
    const r = await fetchKrxMarketProgramTradeSingle('KOSPI');
    expect(r).toBeNull();
  });

  it('콤마 포함 숫자 파싱', async () => {
    mockKrxPost.mockResolvedValue({
      output: [{ PRGM_NTBY_TRPMN: '1,234,567' }],
    });
    const r = await fetchKrxMarketProgramTradeSingle('KOSPI');
    expect(r?.programNetBuyAmount).toBe(1234567);
  });

  it('krxPost throw → null (graceful)', async () => {
    mockKrxPost.mockRejectedValue(new Error('KRX 500'));
    const r = await fetchKrxMarketProgramTradeSingle('KOSPI');
    expect(r).toBeNull();
  });

  it('output1 fallback 키 (extractRowsAt)', async () => {
    mockKrxPost.mockResolvedValue({
      output1: [{ PRGM_NTBY_TRPMN: '500' }],
    });
    const r = await fetchKrxMarketProgramTradeSingle('KOSPI');
    expect(r?.programNetBuyAmount).toBe(500);
  });

  it('OutBlock_1 fallback 키', async () => {
    mockKrxPost.mockResolvedValue({
      OutBlock_1: [{ PRGM_NTBY_TRPMN: '700' }],
    });
    const r = await fetchKrxMarketProgramTradeSingle('KOSPI');
    expect(r?.programNetBuyAmount).toBe(700);
  });

  it('mktId 파라미터 정확 매핑 (KOSPI=STK, KOSDAQ=KSQ)', async () => {
    mockKrxPost.mockResolvedValue({ output: [{ PRGM_NTBY_TRPMN: '100' }] });
    await fetchKrxMarketProgramTradeSingle('KOSPI');
    const [, kospiParams] = mockKrxPost.mock.calls[0];
    expect((kospiParams as Record<string, string>).mktId).toBe('STK');

    mockKrxPost.mockClear();
    await fetchKrxMarketProgramTradeSingle('KOSDAQ');
    const [, kosdaqParams] = mockKrxPost.mock.calls[0];
    expect((kosdaqParams as Record<string, string>).mktId).toBe('KSQ');
  });
});

describe('Patch-006 fetchKrxMarketProgramTradeAggregate', () => {
  beforeEach(() => {
    mockKrxPost.mockReset();
    delete process.env.KRX_MARKET_PROGRAM_FALLBACK_DISABLED;
  });

  it('ENV disabled → confidence=EMPTY + 호출 0건', async () => {
    process.env.KRX_MARKET_PROGRAM_FALLBACK_DISABLED = 'true';
    const r = await fetchKrxMarketProgramTradeAggregate(Date.now());
    expect(r.confidence).toBe('EMPTY');
    expect(r.kospi).toBeNull();
    expect(r.kosdaq).toBeNull();
    expect(r.totalProgramNet).toBeNull();
    expect(mockKrxPost).not.toHaveBeenCalled();
    delete process.env.KRX_MARKET_PROGRAM_FALLBACK_DISABLED;
  });

  it('KOSPI + KOSDAQ 둘 다 정상 → confidence=VERIFIED + 합산', async () => {
    mockKrxPost
      .mockResolvedValueOnce({ output: [{ PRGM_NTBY_TRPMN: '500', ARBT_NTBY_TRPMN: '100', NABT_NTBY_TRPMN: '400' }] })
      .mockResolvedValueOnce({ output: [{ PRGM_NTBY_TRPMN: '200', ARBT_NTBY_TRPMN: '50', NABT_NTBY_TRPMN: '150' }] });
    const r = await fetchKrxMarketProgramTradeAggregate(Date.now());
    expect(r.confidence).toBe('VERIFIED');
    expect(r.kospi?.programNetBuyAmount).toBe(500);
    expect(r.kosdaq?.programNetBuyAmount).toBe(200);
    expect(r.totalProgramNet).toBe(700);
    expect(r.arbitrageNet).toBe(150);
    expect(r.nonArbitrageNet).toBe(550);
    expect(r.marketsAttempted).toEqual(['KOSPI', 'KOSDAQ']);
    expect(r.marketsSucceeded).toEqual(['KOSPI', 'KOSDAQ']);
    expect(mockKrxPost).toHaveBeenCalledTimes(2);
  });

  it('KOSPI 만 성공 → confidence=PARTIAL', async () => {
    mockKrxPost
      .mockResolvedValueOnce({ output: [{ PRGM_NTBY_TRPMN: '500' }] })
      .mockResolvedValueOnce({ output: [] });
    const r = await fetchKrxMarketProgramTradeAggregate(Date.now());
    expect(r.confidence).toBe('PARTIAL');
    expect(r.kospi?.programNetBuyAmount).toBe(500);
    expect(r.kosdaq).toBeNull();
    expect(r.totalProgramNet).toBe(500);
    expect(r.marketsSucceeded).toEqual(['KOSPI']);
  });

  it('KOSDAQ 만 성공 → confidence=PARTIAL', async () => {
    mockKrxPost
      .mockResolvedValueOnce({ output: [] })
      .mockResolvedValueOnce({ output: [{ PRGM_NTBY_TRPMN: '300' }] });
    const r = await fetchKrxMarketProgramTradeAggregate(Date.now());
    expect(r.confidence).toBe('PARTIAL');
    expect(r.kospi).toBeNull();
    expect(r.kosdaq?.programNetBuyAmount).toBe(300);
    expect(r.totalProgramNet).toBe(300);
    expect(r.marketsSucceeded).toEqual(['KOSDAQ']);
  });

  it('둘 다 실패 → confidence=EMPTY + total=null', async () => {
    mockKrxPost
      .mockResolvedValueOnce({ output: [] })
      .mockResolvedValueOnce({ output: [] });
    const r = await fetchKrxMarketProgramTradeAggregate(Date.now());
    expect(r.confidence).toBe('EMPTY');
    expect(r.totalProgramNet).toBeNull();
    expect(r.marketsSucceeded).toEqual([]);
  });

  it('aggregate 응답 메타 (timestamp / fetchedAt / endpoint / bld) 포함', async () => {
    mockKrxPost.mockResolvedValueOnce({ output: [{ PRGM_NTBY_TRPMN: '500' }] })
      .mockResolvedValueOnce({ output: [{ PRGM_NTBY_TRPMN: '200' }] });
    const nowMs = Date.now();
    const r = await fetchKrxMarketProgramTradeAggregate(nowMs);
    expect(r.timestamp).toBe(new Date(nowMs).toISOString());
    expect(r.fetchedAt).toBe(new Date(nowMs).toISOString());
    expect(r.endpoint).toBe(KRX_BLD_MARKET_PROGRAM_TRADE);
    expect(r.bld).toBe(KRX_BLD_MARKET_PROGRAM_TRADE);
  });

  it('한쪽 throw → 그 쪽만 null + 다른 쪽 정상', async () => {
    mockKrxPost
      .mockRejectedValueOnce(new Error('KOSPI 500'))
      .mockResolvedValueOnce({ output: [{ PRGM_NTBY_TRPMN: '300' }] });
    const r = await fetchKrxMarketProgramTradeAggregate(Date.now());
    expect(r.confidence).toBe('PARTIAL');
    expect(r.kospi).toBeNull();
    expect(r.kosdaq?.programNetBuyAmount).toBe(300);
  });
});
