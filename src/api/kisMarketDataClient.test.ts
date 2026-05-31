// @responsibility KIS read-only 수급/공매도 normalize 순수함수 단위 테스트 (공식 스펙 기반 mock)
import { describe, it, expect } from 'vitest';
import { normalizeKisInvestorSupply, normalizeKisShortSale } from './kisMarketDataClient';

describe('normalizeKisInvestorSupply (FHKST01010900)', () => {
  // 공식 필드: frgn_ntby_qty(외국인)·orgn_ntby_qty(기관계)·prsn_ntby_qty(개인) — 최신순 row
  const body = {
    output: [
      { stck_bsop_date: '20260529', frgn_ntby_qty: '1,000', orgn_ntby_qty: '500', prsn_ntby_qty: '-1,500' },
      { stck_bsop_date: '20260528', frgn_ntby_qty: '2,000', orgn_ntby_qty: '-300', prsn_ntby_qty: '-1,700' },
      { stck_bsop_date: '20260527', frgn_ntby_qty: '500', orgn_ntby_qty: '800', prsn_ntby_qty: '-1,300' },
      { stck_bsop_date: '20260526', frgn_ntby_qty: '-100', orgn_ntby_qty: '200', prsn_ntby_qty: '-100' },
    ],
  };

  it('5일(이내) 누적 순매수를 합산한다', () => {
    const r = normalizeKisInvestorSupply(body)!;
    expect(r.foreignNet).toBe(1000 + 2000 + 500 - 100);
    expect(r.institutionNet).toBe(500 - 300 + 800 + 200);
    expect(r.individualNet).toBe(-1500 - 1700 - 1300 - 100);
    expect(r.dataSource).toBe('KIS');
  });

  it('외국인 연속 순매수일을 최신부터 카운트(음수에서 중단)', () => {
    // 최신 3일 양수(+1000,+2000,+500) 후 -100 → 연속 3
    expect(normalizeKisInvestorSupply(body)!.foreignConsecutive).toBe(3);
  });

  it('외국인+기관 동반 순매수면 isPassiveAndActive=true', () => {
    expect(normalizeKisInvestorSupply(body)!.isPassiveAndActive).toBe(true);
  });

  it('output 부재/빈 배열 → null (호출자 fallback)', () => {
    expect(normalizeKisInvestorSupply({})).toBeNull();
    expect(normalizeKisInvestorSupply({ output: [] })).toBeNull();
    expect(normalizeKisInvestorSupply(null)).toBeNull();
  });
});

describe('normalizeKisShortSale (FHPST04830000)', () => {
  // 공식 필드: output2[] 의 ssts_vol_rlim(공매도 거래량 비중 %) — 최신순
  const increasing = {
    output2: [
      { stck_bsop_date: '20260529', ssts_vol_rlim: '8.5' },
      { stck_bsop_date: '20260528', ssts_vol_rlim: '8.0' },
      { stck_bsop_date: '20260527', ssts_vol_rlim: '7.5' },
      { stck_bsop_date: '20260526', ssts_vol_rlim: '4.0' },
      { stck_bsop_date: '20260525', ssts_vol_rlim: '3.5' },
      { stck_bsop_date: '20260524', ssts_vol_rlim: '3.0' },
    ],
  };

  it('최신 공매도 비중을 ratio 로 노출', () => {
    expect(normalizeKisShortSale(increasing)!.ratio).toBe(8.5);
  });

  it('최근 평균 ≥ 이전 평균 → INCREASING', () => {
    expect(normalizeKisShortSale(increasing)!.trend).toBe('INCREASING');
  });

  it('최근 평균 < 이전 평균 → DECREASING', () => {
    const decreasing = {
      output2: [
        { ssts_vol_rlim: '2.0' }, { ssts_vol_rlim: '2.5' }, { ssts_vol_rlim: '3.0' },
        { ssts_vol_rlim: '7.0' }, { ssts_vol_rlim: '7.5' }, { ssts_vol_rlim: '8.0' },
      ],
    };
    expect(normalizeKisShortSale(decreasing)!.trend).toBe('DECREASING');
  });

  it('output2 부재/비중 0 → null', () => {
    expect(normalizeKisShortSale({})).toBeNull();
    expect(normalizeKisShortSale({ output2: [] })).toBeNull();
    expect(normalizeKisShortSale({ output2: [{ ssts_vol_rlim: '0' }] })).toBeNull();
  });
});
