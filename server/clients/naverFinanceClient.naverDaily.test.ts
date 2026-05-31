// @responsibility normalizeNaverDaily 순수함수 단위 테스트 (실제 Naver /price 응답 형태 mock)
import { describe, it, expect } from 'vitest';
import { normalizeNaverDaily, normalizeNaverInvestorTrend } from './naverFinanceClient.js';

// 실제 m.stock.naver.com/api/stock/{code}/price 응답 형태 (최신순·콤마 문자열·거래량 숫자)
const rows = [
  { localTradedAt: '2026-05-29', openPrice: '303,000', highPrice: '319,000', lowPrice: '303,000', closePrice: '317,000', accumulatedTradingVolume: 57920925 },
  { localTradedAt: '2026-05-28', openPrice: '305,000', highPrice: '306,500', lowPrice: '287,500', closePrice: '299,500', accumulatedTradingVolume: 30195334 },
  { localTradedAt: '2026-05-27', openPrice: '321,500', highPrice: '323,000', lowPrice: '306,000', closePrice: '307,000', accumulatedTradingVolume: 33916688 },
];

describe('normalizeNaverDaily', () => {
  it('최신순 입력을 오름차순으로 정렬 + Yahoo 호환 형태(콤마 파싱)', () => {
    const r = normalizeNaverDaily(rows)!;
    expect(r.timestamp).toHaveLength(3);
    expect(r.timestamp[0]).toBeLessThan(r.timestamp[1]);
    expect(r.timestamp[1]).toBeLessThan(r.timestamp[2]);
    const q = r.indicators.quote[0];
    expect(q.close).toEqual([307000, 299500, 317000]); // 27 → 28 → 29 순
    expect(q.high).toEqual([323000, 306500, 319000]);
    expect(q.volume).toEqual([33916688, 30195334, 57920925]);
  });

  it('52주 peak = max(high) 산출 가능 (Naver 일봉 기반)', () => {
    const r = normalizeNaverDaily(rows)!;
    expect(Math.max(...r.indicators.quote[0].high)).toBe(323000);
  });

  it('빈 배열/비배열 → null (호출자 Yahoo fallback)', () => {
    expect(normalizeNaverDaily([])).toBeNull();
    expect(normalizeNaverDaily(null)).toBeNull();
    expect(normalizeNaverDaily({})).toBeNull();
  });

  it('종가 0·날짜 불량 row 는 스킵', () => {
    const r = normalizeNaverDaily([
      { localTradedAt: '2026-05-29', openPrice: '303,000', highPrice: '319,000', lowPrice: '303,000', closePrice: '317,000', accumulatedTradingVolume: 100 },
      { localTradedAt: 'bad-date', closePrice: '999,000' },
      { localTradedAt: '2026-05-28', closePrice: '0' },
    ])!;
    expect(r.timestamp).toHaveLength(1);
    expect(r.indicators.quote[0].close).toEqual([317000]);
  });
});

describe('normalizeNaverInvestorTrend (frgn.naver)', () => {
  // 실제 frgn.naver 행 형태 (최신순): 날짜·종가·전일대비·등락률·거래량·기관순매수·외인순매수·외인보유주수·보유율%
  const html = `<table>
    <tr><td>2026.05.29</td><td>317,000</td><td>17,500</td><td>+5.84%</td><td>32,804,208</td><td>+5,314,304</td><td>-1,061,741</td><td>2,822,131,672</td><td>48.27%</td></tr>
    <tr><td>2026.05.28</td><td>299,500</td><td>7,500</td><td>-2.44%</td><td>30,195,334</td><td>-1,613,562</td><td>-5,173,125</td><td>2,823,193,413</td><td>48.29%</td></tr>
    <tr><td>2026.05.27</td><td>307,000</td><td>8,000</td><td>+2.68%</td><td>33,916,688</td><td>+1,550,904</td><td>-274,173</td><td>2,828,993,929</td><td>48.39%</td></tr>
  </table>`;

  it('5일 누적 순매수 합산 (컬럼: 기관=nums[4], 외국인=nums[5])', () => {
    const r = normalizeNaverInvestorTrend(html)!;
    expect(r.institutionNet).toBe(5314304 - 1613562 + 1550904);
    expect(r.foreignNet).toBe(-1061741 - 5173125 - 274173);
    expect(r.individualNet).toBe(-(r.foreignNet + r.institutionNet));
    expect(r.dataSource).toBe('NAVER');
  });

  it('외국인 보유율 = 최신행 nums[7], 연속 순매수일 = 0(최신 외인 순매도)', () => {
    const r = normalizeNaverInvestorTrend(html)!;
    expect(r.foreignerOwnRatio).toBe(48.27);
    expect(r.foreignConsecutive).toBe(0);
  });

  it('데이터 행 없음/빈 HTML → null', () => {
    expect(normalizeNaverInvestorTrend('<table><tr><th>날짜</th></tr></table>')).toBeNull();
    expect(normalizeNaverInvestorTrend('')).toBeNull();
  });
});
