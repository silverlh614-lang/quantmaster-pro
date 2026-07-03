// @responsibility kisIntradayCorrectionStep PoC 회귀 테스트 — mutation/log 검증

import { describe, expect, it, vi, beforeEach } from 'vitest';

vi.mock('../../../../screener/stockScreener.js', () => ({
  fetchKisIntraday: vi.fn(),
}));

import { kisIntradayCorrectionStep } from '../kisIntradayCorrectionStep.js';
import { fetchKisIntraday } from '../../../../screener/stockScreener.js';

describe('kisIntradayCorrectionStep', () => {
  beforeEach(() => {
    vi.mocked(fetchKisIntraday).mockReset();
    delete process.env.GATE3_ENTRY_PRICE_RESTAMP_ENABLED;
  });

  it('reCheckQuote=null — fetchKisIntraday 미호출 + applied=false', async () => {
    const result = await kisIntradayCorrectionStep({ stockCode: '005930', reCheckQuote: null });
    expect(result.applied).toBe(false);
    expect(result.logMessages).toEqual([]);
    expect(fetchKisIntraday).not.toHaveBeenCalled();
  });

  it('fetchKisIntraday 실패 — applied=false, mutation 없음', async () => {
    vi.mocked(fetchKisIntraday).mockResolvedValue(null);
    const reCheckQuote = { dayOpen: 70_000, prevClose: 69_500 };
    const result = await kisIntradayCorrectionStep({ stockCode: '005930', reCheckQuote });
    expect(result.applied).toBe(false);
    expect(reCheckQuote.dayOpen).toBe(70_000);
    expect(reCheckQuote.prevClose).toBe(69_500);
  });

  it('KIS dayOpen 보정 발생 — reCheckQuote.dayOpen mutate + 로그 출력', async () => {
    vi.mocked(fetchKisIntraday).mockResolvedValue({
      dayOpen: 70_500,
      prevClose: 69_500,
      price: 70_300,
      volume: 1_000_000,
    });
    const reCheckQuote = { dayOpen: 70_000, prevClose: 69_500 };
    const result = await kisIntradayCorrectionStep({ stockCode: '005930', reCheckQuote });
    expect(result.applied).toBe(true);
    expect(reCheckQuote.dayOpen).toBe(70_500);
    expect(result.logMessages).toHaveLength(1);
    expect(result.logMessages[0]).toMatch(/^\[KisIntraday\] 005930 시가 보정: Yahoo=70000 \/ KIS=70500/);
  });

  it('prevClose 양수 — reCheckQuote.prevClose mutate (로그 없음)', async () => {
    vi.mocked(fetchKisIntraday).mockResolvedValue({
      dayOpen: 70_000, // 동일하면 dayOpen 보정 없음
      prevClose: 69_800,
      price: 70_300,
      volume: 1_000_000,
    });
    const reCheckQuote = { dayOpen: 70_000, prevClose: 69_500 };
    const result = await kisIntradayCorrectionStep({ stockCode: '005930', reCheckQuote });
    expect(result.applied).toBe(true);
    expect(reCheckQuote.prevClose).toBe(69_800);
    expect(reCheckQuote.dayOpen).toBe(70_000);
    expect(result.logMessages).toHaveLength(0);
  });

  it('prevClose=0 또는 음수 — prevClose mutate 안 됨 (kill-switch: byte-identical 계약)', async () => {
    process.env.GATE3_ENTRY_PRICE_RESTAMP_ENABLED = 'false';
    vi.mocked(fetchKisIntraday).mockResolvedValue({
      dayOpen: 70_000,
      prevClose: 0,
      price: 70_300,
      volume: 1_000_000,
    });
    const reCheckQuote = { dayOpen: 70_000, prevClose: 69_500 };
    const result = await kisIntradayCorrectionStep({ stockCode: '005930', reCheckQuote });
    expect(result.applied).toBe(false);
    expect(reCheckQuote.prevClose).toBe(69_500);
  });

  // ADR-0661 — fresh 현재가·priceAsOf 재각인 (Gate3 entry price guard false-STALE 해소)
  describe('ADR-0661 entry price restamp', () => {
    it('default ON — price/currentPrice/priceAsOf 각인 + applied=true', async () => {
      vi.mocked(fetchKisIntraday).mockResolvedValue({
        dayOpen: 70_000,
        prevClose: 0, // prevClose 경로 비활성 — restamp 단독 검증
        price: 70_300,
        volume: 1_000_000,
        asOf: '2026-07-02T02:47:00.000Z',
      });
      const reCheckQuote: { dayOpen?: number; prevClose?: number; price?: number; currentPrice?: number; priceAsOf?: string } =
        { dayOpen: 70_000, prevClose: 69_500 };
      const result = await kisIntradayCorrectionStep({ stockCode: '005930', reCheckQuote });
      expect(result.applied).toBe(true);
      expect(reCheckQuote.price).toBe(70_300);
      expect(reCheckQuote.currentPrice).toBe(70_300);
      expect(reCheckQuote.priceAsOf).toBe('2026-07-02T02:47:00.000Z');
    });

    it('ON + asOf 결손 — priceAsOf 를 fetch 시점(now) ISO 로 fallback 각인', async () => {
      vi.mocked(fetchKisIntraday).mockResolvedValue({
        dayOpen: 70_000,
        prevClose: 0,
        price: 70_300,
        volume: 1_000_000,
      });
      const reCheckQuote: { dayOpen?: number; prevClose?: number; priceAsOf?: string } =
        { dayOpen: 70_000, prevClose: 69_500 };
      const before = Date.now();
      await kisIntradayCorrectionStep({ stockCode: '005930', reCheckQuote });
      expect(reCheckQuote.priceAsOf).toBeDefined();
      const stamped = new Date(reCheckQuote.priceAsOf as string).getTime();
      expect(Number.isFinite(stamped)).toBe(true);
      expect(stamped).toBeGreaterThanOrEqual(before - 1_000);
      expect(stamped).toBeLessThanOrEqual(Date.now() + 1_000);
    });

    it('kill-switch =false — price/priceAsOf 각인 없음 (byte-identical)', async () => {
      process.env.GATE3_ENTRY_PRICE_RESTAMP_ENABLED = 'false';
      vi.mocked(fetchKisIntraday).mockResolvedValue({
        dayOpen: 70_000,
        prevClose: 0,
        price: 70_300,
        volume: 1_000_000,
        asOf: '2026-07-02T02:47:00.000Z',
      });
      const reCheckQuote: { dayOpen?: number; prevClose?: number; price?: number; currentPrice?: number; priceAsOf?: string } =
        { dayOpen: 70_000, prevClose: 69_500 };
      const result = await kisIntradayCorrectionStep({ stockCode: '005930', reCheckQuote });
      expect(result.applied).toBe(false);
      expect(reCheckQuote.price).toBeUndefined();
      expect(reCheckQuote.currentPrice).toBeUndefined();
      expect(reCheckQuote.priceAsOf).toBeUndefined();
    });

    it('price<=0 — 각인 없음 (비정상 시세 방어)', async () => {
      vi.mocked(fetchKisIntraday).mockResolvedValue({
        dayOpen: 70_000,
        prevClose: 0,
        price: 0,
        volume: 1_000_000,
        asOf: '2026-07-02T02:47:00.000Z',
      });
      const reCheckQuote: { dayOpen?: number; prevClose?: number; price?: number; priceAsOf?: string } =
        { dayOpen: 70_000, prevClose: 69_500 };
      const result = await kisIntradayCorrectionStep({ stockCode: '005930', reCheckQuote });
      expect(result.applied).toBe(false);
      expect(reCheckQuote.priceAsOf).toBeUndefined();
    });
  });
});
