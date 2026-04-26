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

  it('prevClose=0 또는 음수 — prevClose mutate 안 됨', async () => {
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
});
