/**
 * @responsibility kisQuoteAdapter 단위 테스트 (PR-56) — KIS API mock + 일봉 부족 fallback + MTAS 보강
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../../clients/kisClient.js', () => ({
  realDataKisGet: vi.fn(),
  HAS_REAL_DATA_CLIENT: true,
}));
vi.mock('../kisChartDataFetcher.js', () => ({
  fetchKisMTASData: vi.fn(),
  fetchKisDailyCandles: vi.fn(),
}));
vi.mock('../dataCompletenessTracker.js', () => ({
  recordMtasAttempt: vi.fn(),
}));

const { fetchKisQuoteFallback, fetchKisIntraday, enrichQuoteWithKisMTAS } = await import('./kisQuoteAdapter.js');
const { realDataKisGet } = await import('../../clients/kisClient.js');
const { fetchKisMTASData, fetchKisDailyCandles } = await import('../kisChartDataFetcher.js');
const { recordMtasAttempt } = await import('../dataCompletenessTracker.js');

/** 표준 KIS inquire-price 응답 — 등락 부호 정상 */
function makeKisPriceResponse(opts: { price?: number; oprc?: number; vol?: number; prdyVrss?: number; sign?: string } = {}) {
  return {
    output: {
      stck_prpr: String(opts.price ?? 70000),
      stck_oprc: String(opts.oprc ?? 69500),
      acml_vol: String(opts.vol ?? 12345),
      stck_prdy_vrss: String(opts.prdyVrss ?? 500),
      prdy_vrss_sign: opts.sign ?? '2',  // '2'=상승
    },
  };
}

describe('fetchKisQuoteFallback', () => {
  beforeEach(() => { vi.clearAllMocks(); });

  it('KIS 응답 output 없음 → null', async () => {
    (realDataKisGet as any).mockResolvedValue(null);
    const result = await fetchKisQuoteFallback('005930');
    expect(result).toBeNull();
  });

  it('price=0 → null (유효성 가드)', async () => {
    (realDataKisGet as any).mockResolvedValue(makeKisPriceResponse({ price: 0 }));
    const result = await fetchKisQuoteFallback('005930');
    expect(result).toBeNull();
  });

  it('일봉 < 20봉 → 보수적 0값 fallback (Gate 통과 불가)', async () => {
    (realDataKisGet as any).mockResolvedValue(makeKisPriceResponse({ price: 70000 }));
    (fetchKisDailyCandles as any).mockResolvedValue([]);  // 빈 캔들
    const result = await fetchKisQuoteFallback('005930');
    expect(result).not.toBeNull();
    expect(result!.price).toBe(70000);
    expect(result!.ma5).toBe(0);     // 보수적 fallback
    expect(result!.ma60).toBe(0);
    expect(result!.atr).toBe(0);
    expect(result!.high5d).toBe(70000);  // price 로 채움
  });

  it('일봉 충분 (≥20) → buildExtendedFromKisDaily 정상 산출', async () => {
    (realDataKisGet as any).mockResolvedValue(makeKisPriceResponse({ price: 70000 }));
    // 30봉 상승 시계열
    const candles = Array.from({ length: 30 }, (_, i) => ({
      date: `2026-04-${String(i + 1).padStart(2, '0')}`,
      open: 60000 + i * 100,
      high: 60500 + i * 100,
      low: 59500 + i * 100,
      close: 60000 + i * 100,
      volume: 10000 + i * 100,
    }));
    (fetchKisDailyCandles as any).mockResolvedValue(candles);
    const result = await fetchKisQuoteFallback('005930');
    expect(result).not.toBeNull();
    expect(result!.price).toBe(70000);
    expect(result!.ma5).toBeGreaterThan(0);
    expect(result!.ma20).toBeGreaterThan(0);
  });

  it('등락 부호 5/4 (하락) → prdyChange 음수 처리', async () => {
    (realDataKisGet as any).mockResolvedValue(makeKisPriceResponse({
      price: 69500, prdyVrss: 500, sign: '5',  // 하락
    }));
    (fetchKisDailyCandles as any).mockResolvedValue([]);
    const result = await fetchKisQuoteFallback('005930');
    expect(result).not.toBeNull();
    expect(result!.changePercent).toBeLessThan(0);
  });

  it('throw → null (catch 블록)', async () => {
    (realDataKisGet as any).mockRejectedValue(new Error('KIS down'));
    const result = await fetchKisQuoteFallback('005930');
    expect(result).toBeNull();
  });
});

describe('fetchKisIntraday', () => {
  beforeEach(() => { vi.clearAllMocks(); });

  it('정상 응답 → price/dayOpen/prevClose/volume 추출', async () => {
    (realDataKisGet as any).mockResolvedValue(makeKisPriceResponse({
      price: 70000, oprc: 69500, vol: 12345, prdyVrss: 500, sign: '2',
    }));
    const result = await fetchKisIntraday('005930');
    expect(result).not.toBeNull();
    expect(result!.price).toBe(70000);
    expect(result!.dayOpen).toBe(69500);
    expect(result!.volume).toBe(12345);
    expect(result!.prevClose).toBe(69500); // 70000 - 500
  });

  it('output 없음 → null', async () => {
    (realDataKisGet as any).mockResolvedValue(null);
    const result = await fetchKisIntraday('005930');
    expect(result).toBeNull();
  });

  it('throw → null (catch)', async () => {
    (realDataKisGet as any).mockRejectedValue(new Error('boom'));
    const result = await fetchKisIntraday('005930');
    expect(result).toBeNull();
  });
});

describe('enrichQuoteWithKisMTAS', () => {
  const baseQuote: any = {
    price: 70000, dayOpen: 69500, prevClose: 69000, changePercent: 1.45,
    volume: 12345, avgVolume: 10000,
    ma5: 70000, ma20: 70000, ma60: 70000,
    high5d: 71000, high20d: 72000, high60d: 73000,
    atr: 1000, atr20avg: 1000, per: 12,
    rsi14: 55, macd: 100, macdSignal: 90, macdHistogram: 10,
    rsi5dAgo: 50, weeklyRSI: 60, ma60TrendUp: true, macd5dHistAgo: 5,
    return5d: 2.0, return20d: 5.0,
    bbWidthCurrent: 0.05, bbWidth20dAvg: 0.06,
    vol5dAvg: 11000, vol20dAvg: 10000, atr5d: 1000,
    monthlyAboveEMA12: false, monthlyEMARising: false,
    weeklyAboveCloud: false, weeklyLaggingSpanUp: false,
    dailyVolumeDrying: false, isHighRisk: false,
  };

  beforeEach(() => { vi.clearAllMocks(); });

  it('KIS MTAS 데이터 없음 → 원본 그대로 반환', async () => {
    (fetchKisMTASData as any).mockResolvedValue(null);
    const result = await enrichQuoteWithKisMTAS(baseQuote, '005930');
    expect(result).toEqual(baseQuote);
    expect(recordMtasAttempt).toHaveBeenCalledWith('005930', false);
  });

  it('dataAvailable=false → 원본 그대로', async () => {
    (fetchKisMTASData as any).mockResolvedValue({ dataAvailable: false, monthlyCandleCount: 0, weeklyCandleCount: 0 });
    const result = await enrichQuoteWithKisMTAS(baseQuote, '005930');
    expect(result).toEqual(baseQuote);
  });

  it('월봉 ≥13 → monthlyAboveEMA12 + monthlyEMARising 덮어쓰기', async () => {
    (fetchKisMTASData as any).mockResolvedValue({
      dataAvailable: true,
      monthlyCandleCount: 24,
      monthlyAboveEMA12: true,
      monthlyEMARising: true,
      weeklyCandleCount: 30, // 52 미만 — 주봉은 보강 안 됨
      weeklyAboveCloud: true,
      weeklyLaggingSpanUp: true,
    });
    const result = await enrichQuoteWithKisMTAS(baseQuote, '005930');
    expect(result.monthlyAboveEMA12).toBe(true);  // 보강됨
    expect(result.monthlyEMARising).toBe(true);
    expect(result.weeklyAboveCloud).toBe(false);  // 30 < 52 → 보강 안 됨
  });

  it('주봉 ≥52 → weeklyAboveCloud + weeklyLaggingSpanUp 덮어쓰기', async () => {
    (fetchKisMTASData as any).mockResolvedValue({
      dataAvailable: true,
      monthlyCandleCount: 5,  // 13 미만 — 월봉은 보강 안 됨
      monthlyAboveEMA12: true,
      monthlyEMARising: true,
      weeklyCandleCount: 60,
      weeklyAboveCloud: true,
      weeklyLaggingSpanUp: true,
    });
    const result = await enrichQuoteWithKisMTAS(baseQuote, '005930');
    expect(result.weeklyAboveCloud).toBe(true);
    expect(result.weeklyLaggingSpanUp).toBe(true);
    expect(result.monthlyAboveEMA12).toBe(false);  // 월봉은 안 보강됨
  });

  it('throw → 원본 반환 (graceful fallback)', async () => {
    (fetchKisMTASData as any).mockRejectedValue(new Error('KIS MTAS down'));
    const result = await enrichQuoteWithKisMTAS(baseQuote, '005930');
    expect(result).toEqual(baseQuote);
    expect(recordMtasAttempt).toHaveBeenCalledWith('005930', false);
  });
});
