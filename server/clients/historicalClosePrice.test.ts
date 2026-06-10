// @responsibility ADR-0175 A14 priceFetcher 회귀 — KIS 일봉 asOf bar 선택 + 미래 누출 금지 + 실패 null
/**
 * historicalClosePrice.test.ts (PENDING_WIRING A14 wiring)
 *
 * `fetchHistoricalClosePrice` — FutureReturnResolver cron 이 주입하는 priceFetcher SSOT.
 *
 * invariant:
 *   1. KIS(L1) primary — KIS 일봉 성공 시 Yahoo(guardedFetch) outbound 0건 (ADR-0561)
 *   2. asOf 시점 종가 — 일봉 배열에서 `date <= asOf` 의 최신 bar close 선택
 *   3. 미래 bar 누출 금지 — `date > asOf` bar 는 절대 선택 안 함 (time-travel 라벨 차단)
 *   4. KIS + Yahoo 모두 실패 → null (futureReturnResolver 의 errors++ 안전 분기 보존)
 *   5. invalid symbol → null + provider 호출 0건 (ADR-0438 hard reject)
 */

import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../screener/kisChartDataFetcher.js', () => ({ fetchKisChartData: vi.fn() }));
vi.mock('../utils/egressGuard.js', () => ({ guardedFetch: vi.fn() }));
vi.mock('../screener/adapters/yahooSymbolResolver.js', () => ({
  tryGetYahooSymbol: vi.fn(() => null),
}));
// symbolNormalizer 의 master lookup 의존성 격리 (fs read 차단) — 정규화 로직 자체는 실코드.
vi.mock('../persistence/krxStockMasterRepo.js', () => ({ getStockByCode: vi.fn(() => null) }));

import { fetchHistoricalClosePrice } from './historicalClosePrice.js';
import { fetchKisChartData } from '../screener/kisChartDataFetcher.js';
import { guardedFetch } from '../utils/egressGuard.js';

const mockedKis = vi.mocked(fetchKisChartData);
const mockedFetch = vi.mocked(guardedFetch);

function candle(date: string, close: number) {
  return { date, open: close, high: close, low: close, close, volume: 0 };
}

beforeEach(() => {
  vi.clearAllMocks();
  // Yahoo fallback default 실패 — KIS 경로 검증이 기본
  mockedFetch.mockRejectedValue(new Error('yahoo unavailable'));
});

describe('fetchHistoricalClosePrice — KIS 일봉 asOf bar 선택 (A14)', () => {
  it('asOf 당일 거래일 bar 의 close 선택', async () => {
    mockedKis.mockResolvedValueOnce([candle('20260601', 100), candle('20260602', 110)]);
    const price = await fetchHistoricalClosePrice('005930', new Date('2026-06-02T00:00:00Z'));
    expect(price).toBe(110);
  });

  it('미래 bar 누출 금지 — date > asOf bar 는 무시하고 asOf bar 선택', async () => {
    // 방어적 시나리오: provider 가 범위 밖 미래 bar 를 반환해도 time-travel 라벨 차단
    mockedKis.mockResolvedValueOnce([
      candle('20260601', 100),
      candle('20260602', 110),
      candle('20260603', 120),
    ]);
    const price = await fetchHistoricalClosePrice('005930', new Date('2026-06-02T00:00:00Z'));
    expect(price).toBe(110);
  });

  it('asOf 당일 bar 부재 (휴장) → 직전 거래일 bar close 선택', async () => {
    mockedKis.mockResolvedValueOnce([candle('20260529', 95), candle('20260601', 100)]);
    const price = await fetchHistoricalClosePrice('005930', new Date('2026-06-02T00:00:00Z'));
    expect(price).toBe(100);
  });

  it('KIS(L1) primary — KIS 성공 시 Yahoo(guardedFetch) outbound 0건 (ADR-0561)', async () => {
    mockedKis.mockResolvedValueOnce([candle('20260602', 110)]);
    await fetchHistoricalClosePrice('005930', new Date('2026-06-02T00:00:00Z'));
    expect(mockedFetch).not.toHaveBeenCalled();
  });

  it('close 비정상 (0/NaN) bar skip — 유효 close 의 직전 bar 선택', async () => {
    mockedKis.mockResolvedValueOnce([candle('20260601', 100), candle('20260602', 0)]);
    const price = await fetchHistoricalClosePrice('005930', new Date('2026-06-02T00:00:00Z'));
    expect(price).toBe(100);
  });
});

describe('fetchHistoricalClosePrice — 실패 안전 분기 (A14)', () => {
  it('KIS throw + Yahoo 실패 → null (errors++ 안전 분기 보존, 현재가 fallback 금지)', async () => {
    mockedKis.mockRejectedValueOnce(new Error('kis down'));
    const price = await fetchHistoricalClosePrice('005930', new Date('2026-06-02T00:00:00Z'));
    expect(price).toBeNull();
  });

  it('KIS 빈 배열 + Yahoo 실패 → null', async () => {
    mockedKis.mockResolvedValueOnce([]);
    const price = await fetchHistoricalClosePrice('005930', new Date('2026-06-02T00:00:00Z'));
    expect(price).toBeNull();
  });

  it('invalid symbol → null + KIS/Yahoo provider 호출 0건 (ADR-0438 hard reject)', async () => {
    const price = await fetchHistoricalClosePrice('INVALID', new Date('2026-06-02T00:00:00Z'));
    expect(price).toBeNull();
    expect(mockedKis).not.toHaveBeenCalled();
    expect(mockedFetch).not.toHaveBeenCalled();
  });

  it('invalid asOf (NaN Date) → null + provider 호출 0건', async () => {
    const price = await fetchHistoricalClosePrice('005930', new Date('invalid'));
    expect(price).toBeNull();
    expect(mockedKis).not.toHaveBeenCalled();
  });
});
