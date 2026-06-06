/**
 * @responsibility fetchDartFinancials marginAcceleration 파생 회귀 — 영업이익증가율 − 매출증가율(pp).
 *
 * ③ 게이트 충전: checklist marginAcceleration(#23, Gate3)는 마진 가속(영업이익이 매출보다 빨리 성장)을
 * 1로 본다. DART YoY(thstrm/frmtrm)로 산출. 전기 값 부재(0) 시 0(미산출).
 */
import { describe, it, expect, vi, afterEach } from 'vitest';
import { fetchDartFinancials } from './dartDataFetcher';

const origFetch = global.fetch;
function mockDart(list: any[]) {
  global.fetch = vi.fn().mockResolvedValue({ json: async () => ({ status: '000', list }) }) as any;
}

describe('fetchDartFinancials — marginAcceleration', () => {
  afterEach(() => { global.fetch = origFetch; vi.restoreAllMocks(); });

  it('영업이익증가율(20%) > 매출증가율(10%) → +10pp', async () => {
    mockDart([
      { account_nm: '매출액', thstrm_amount: '110', frmtrm_amount: '100' },
      { account_nm: '영업이익', thstrm_amount: '24', frmtrm_amount: '20' },
      { account_nm: '자본총계', thstrm_amount: '200', frmtrm_amount: '180' },
    ]);
    const fin = await fetchDartFinancials('00111111');
    expect(fin).not.toBeNull();
    expect(fin!.marginAcceleration).toBeCloseTo(10);
  });

  it('매출증가율(30%) > 영업이익증가율(10%) → −20pp', async () => {
    mockDart([
      { account_nm: '매출액', thstrm_amount: '130', frmtrm_amount: '100' },
      { account_nm: '영업이익', thstrm_amount: '22', frmtrm_amount: '20' },
    ]);
    const fin = await fetchDartFinancials('00222222');
    expect(fin!.marginAcceleration).toBeCloseTo(-20);
  });

  it('전기 값 부재(0) → marginAcceleration 0', async () => {
    mockDart([
      { account_nm: '매출액', thstrm_amount: '110', frmtrm_amount: '0' },
      { account_nm: '영업이익', thstrm_amount: '24', frmtrm_amount: '0' },
    ]);
    const fin = await fetchDartFinancials('00333333');
    expect(fin!.marginAcceleration).toBe(0);
  });
});
