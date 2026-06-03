// @responsibility closeSeriesProvider flag-gated 라우터 회귀 테스트 — flag OFF byte-equiv + flag ON KIS-first
/**
 * closeSeriesProvider.test.ts — ADR-0561 exit 경로 종가 라우터 회귀.
 *
 * 합격 절대조건 검증:
 *   1. flag OFF byte-equivalent: 기존 fetchCloses(symbol, range) 그대로 위임(호출 1회·인자·반환형 동일).
 *      → exit 청산 결정(ma60/RSI) 데이터 불변.
 *   2. flag ON 구현만: KIS 일봉(L1) 종가배열 1차, 실패 시 Yahoo graceful fallback(불변식 #6).
 *   3. KIS 캔들(과거→최신) → number[] 오름차순 매핑이 Yahoo fetchCloses 와 동형.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

vi.mock('../../marketDataRefresh.js', () => ({
  fetchCloses: vi.fn(),
}));
vi.mock('../../../screener/kisChartDataFetcher.js', () => ({
  fetchKisDailyCandles: vi.fn(),
}));

import { fetchCloseSeries } from './closeSeriesProvider.js';
import { fetchCloses } from '../../marketDataRefresh.js';
import { fetchKisDailyCandles } from '../../../screener/kisChartDataFetcher.js';

const yahooMock = vi.mocked(fetchCloses);
const kisMock = vi.mocked(fetchKisDailyCandles);

const CODE = '005930';
const SYMBOL = '005930.KS';

function candle(close: number) {
  return { date: '20260101', open: close, high: close, low: close, close, volume: 0 };
}

describe('closeSeriesProvider.fetchCloseSeries', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    delete process.env.KIS_OHLCV_PRIMARY_ENABLED;
  });
  afterEach(() => {
    delete process.env.KIS_OHLCV_PRIMARY_ENABLED;
  });

  // ── 합격조건 1: flag OFF byte-equivalent ──────────────────────────────
  it('flag OFF: 기존 fetchCloses(symbol, range) 로 정확히 위임한다 (byte-equal, KIS 미호출)', async () => {
    const series = [100, 101, 102];
    yahooMock.mockResolvedValue(series);

    const out = await fetchCloseSeries(CODE, SYMBOL, '60d');

    expect(yahooMock).toHaveBeenCalledTimes(1);
    expect(yahooMock).toHaveBeenCalledWith(SYMBOL, '60d');
    expect(kisMock).not.toHaveBeenCalled();
    // 반환 객체 동일성(byte-equal): 라우터가 변형 없이 그대로 통과.
    expect(out).toBe(series);
  });

  it('flag OFF: fetchCloses 가 null 이면 그대로 null (byte-equal, 실패 경로)', async () => {
    yahooMock.mockResolvedValue(null);
    const out = await fetchCloseSeries(CODE, SYMBOL, '120d');
    expect(yahooMock).toHaveBeenCalledWith(SYMBOL, '120d');
    expect(out).toBeNull();
    expect(kisMock).not.toHaveBeenCalled();
  });

  it('flag 미설정(undefined) === flag OFF (default byte-equal)', async () => {
    yahooMock.mockResolvedValue([1, 2]);
    await fetchCloseSeries(CODE, SYMBOL, '60d');
    expect(kisMock).not.toHaveBeenCalled();
    expect(yahooMock).toHaveBeenCalledTimes(1);
  });

  // ── 합격조건 2/3: flag ON KIS-first (구현만) ──────────────────────────
  it('flag ON: KIS 일봉(과거→최신) 종가배열을 1차로 반환하고 Yahoo 는 미호출', async () => {
    process.env.KIS_OHLCV_PRIMARY_ENABLED = 'true';
    kisMock.mockResolvedValue([candle(100), candle(101), candle(102)]);

    const out = await fetchCloseSeries(CODE, SYMBOL, '60d');

    expect(kisMock).toHaveBeenCalledTimes(1);
    // number[] 오름차순(과거→최신) — Yahoo fetchCloses 와 동형.
    expect(out).toEqual([100, 101, 102]);
    expect(yahooMock).not.toHaveBeenCalled();
  });

  it('flag ON: KIS 빈 배열이면 Yahoo funnel 로 graceful fallback (불변식 #6, provider 장애≠약세)', async () => {
    process.env.KIS_OHLCV_PRIMARY_ENABLED = 'true';
    kisMock.mockResolvedValue([]);
    yahooMock.mockResolvedValue([100, 101]);

    const out = await fetchCloseSeries(CODE, SYMBOL, '60d');

    expect(kisMock).toHaveBeenCalledTimes(1);
    expect(yahooMock).toHaveBeenCalledWith(SYMBOL, '60d');
    expect(out).toEqual([100, 101]);
  });

  it('flag ON: KIS throw 시 Yahoo funnel 로 graceful fallback (에러 삼킴 아님 — 로그 후 fallback)', async () => {
    process.env.KIS_OHLCV_PRIMARY_ENABLED = 'true';
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
    kisMock.mockRejectedValue(new Error('KIS down'));
    yahooMock.mockResolvedValue([50, 51]);

    const out = await fetchCloseSeries(CODE, SYMBOL, '120d');

    expect(yahooMock).toHaveBeenCalledWith(SYMBOL, '120d');
    expect(out).toEqual([50, 51]);
    expect(warnSpy).toHaveBeenCalled();
    warnSpy.mockRestore();
  });
});
