/**
 * @responsibility krxScreenerAdapter 단위 테스트 (PR-56) — 폴백 매핑·정렬·엣지 케이스
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../../clients/krxClient.js', () => ({
  fetchInvestorTrading: vi.fn(),
  fetchPerPbr: vi.fn(),
}));

const { fetchKrxScreenerFallback } = await import('./krxScreenerAdapter.js');
const { fetchInvestorTrading, fetchPerPbr } = await import('../../clients/krxClient.js');

describe('fetchKrxScreenerFallback', () => {
  beforeEach(() => { vi.clearAllMocks(); });

  it('investors 가 빈 배열 → 빈 배열 반환 (자연 폴백)', async () => {
    (fetchInvestorTrading as any).mockResolvedValue([]);
    (fetchPerPbr as any).mockResolvedValue([]);
    const result = await fetchKrxScreenerFallback();
    expect(result).toEqual([]);
  });

  it('foreignNetBuy ≤ 0 종목 제외', async () => {
    (fetchInvestorTrading as any).mockResolvedValue([
      { code: '005930', name: '삼성전자', foreignNetBuy: 1000 },
      { code: '000660', name: 'SK하이닉스', foreignNetBuy: -500 },  // 제외
      { code: '035420', name: 'NAVER', foreignNetBuy: 0 },         // 제외 (양수만)
    ]);
    (fetchPerPbr as any).mockResolvedValue([
      { code: '005930', close: 70000, per: 12.5 },
      { code: '000660', close: 130000, per: 8.2 },
      { code: '035420', close: 200000, per: 25.0 },
    ]);
    const result = await fetchKrxScreenerFallback();
    expect(result).toHaveLength(1);
    expect(result[0].code).toBe('005930');
  });

  it('PER/PBR 결측 종목 → close=0 → 제외', async () => {
    (fetchInvestorTrading as any).mockResolvedValue([
      { code: '005930', name: '삼성전자', foreignNetBuy: 1000 },
    ]);
    (fetchPerPbr as any).mockResolvedValue([]);
    const result = await fetchKrxScreenerFallback();
    expect(result).toEqual([]);  // close=0 인 로우 제외
  });

  it('foreignNetBuy 내림차순 정렬', async () => {
    (fetchInvestorTrading as any).mockResolvedValue([
      { code: 'A', name: 'a', foreignNetBuy: 100 },
      { code: 'B', name: 'b', foreignNetBuy: 5000 },
      { code: 'C', name: 'c', foreignNetBuy: 1000 },
    ]);
    (fetchPerPbr as any).mockResolvedValue([
      { code: 'A', close: 100, per: 10 },
      { code: 'B', close: 200, per: 12 },
      { code: 'C', close: 150, per: 8 },
    ]);
    const result = await fetchKrxScreenerFallback();
    expect(result.map(r => r.code)).toEqual(['B', 'C', 'A']);
  });

  it('상위 80개 절삭 (slice(0, 80))', async () => {
    const investors = Array.from({ length: 100 }, (_, i) => ({
      code: String(i).padStart(6, '0'),
      name: `stock-${i}`,
      foreignNetBuy: 100 - i,  // 100, 99, ..., 1
    }));
    const perPbr = investors.map(iv => ({ code: iv.code, close: 1000, per: 10 }));
    (fetchInvestorTrading as any).mockResolvedValue(investors);
    (fetchPerPbr as any).mockResolvedValue(perPbr);
    const result = await fetchKrxScreenerFallback();
    expect(result).toHaveLength(80);
  });

  it('PER 결측 시 999 fallback + ScreenedStock 매핑 정확성', async () => {
    (fetchInvestorTrading as any).mockResolvedValue([
      { code: '005930', name: '삼성전자', foreignNetBuy: 1000 },
    ]);
    (fetchPerPbr as any).mockResolvedValue([
      { code: '005930', close: 70000, per: undefined },  // PER 결측
    ]);
    const result = await fetchKrxScreenerFallback();
    expect(result[0]).toMatchObject({
      code: '005930',
      name: '삼성전자',
      currentPrice: 70000,
      changeRate: 0,
      volume: 0,
      foreignNetBuy: 1000,
      per: 999,
    });
    expect(result[0].screenedAt).toBeTruthy();
  });

  it('두 소스 모두 throw → catch 블록에서 빈 배열 반환', async () => {
    (fetchInvestorTrading as any).mockRejectedValue(new Error('KRX down'));
    (fetchPerPbr as any).mockRejectedValue(new Error('KRX down'));
    const result = await fetchKrxScreenerFallback();
    expect(result).toEqual([]);
  });
});
