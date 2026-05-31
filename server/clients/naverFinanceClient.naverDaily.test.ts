// @responsibility normalizeNaverDaily 순수함수 단위 테스트 (실제 Naver /price 응답 형태 mock)
import { describe, it, expect } from 'vitest';
import { normalizeNaverDaily } from './naverFinanceClient.js';

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
