// @responsibility ADR-0603 해외지수 일봉 파서·ENV 가드 회귀 (수익률 산식·결손·정렬·코드 ENV).
import { describe, expect, it } from 'vitest';
import {
  isKisOverseasIndexDailyDisabled,
  parseKisOverseasIndexDaily,
  resolveKisOverseasNdxIscd,
  resolveKisOverseasSpxIscd,
} from './overseasIndex.js';

function row(date: string, close: number | string) {
  return { stck_bsop_date: date, ovrs_nmix_prpr: close };
}

describe('parseKisOverseasIndexDaily', () => {
  it('output2 최신순 정렬 후 1d/20d 수익률 산출', () => {
    const closes = Array.from({ length: 21 }, (_, i) => row(
      `202606${String(30 - i).padStart(2, '0')}`, 100 + (20 - i),
    ));
    const parsed = parseKisOverseasIndexDaily('SPX', { output2: closes });
    expect(parsed?.series[0].close).toBe(120);
    expect(parsed?.dayReturnPct).toBe(Number((((120 - 119) / 119) * 100).toFixed(2)));
    expect(parsed?.return20dPct).toBe(20);
  });

  it('비정상 행(날짜/종가 결손) 제외 · 전부 결손 시 null (결손 ≠ 신호)', () => {
    const parsed = parseKisOverseasIndexDaily('SPX', {
      output2: [row('20260611', 100), { stck_bsop_date: 'bad', ovrs_nmix_prpr: 99 }, row('20260610', '0')],
    });
    expect(parsed?.series).toHaveLength(1);
    expect(parsed?.dayReturnPct).toBeNull();
    expect(parseKisOverseasIndexDaily('SPX', { output2: [] })).toBeNull();
    expect(parseKisOverseasIndexDaily('SPX', {})).toBeNull();
  });
});

describe('ENV 가드', () => {
  it('default ON · false 명시 시 OFF · ISCD ENV 오버라이드', () => {
    expect(isKisOverseasIndexDailyDisabled({})).toBe(false);
    expect(isKisOverseasIndexDailyDisabled({ KIS_OVERSEAS_INDEX_DAILY_ENABLED: 'false' })).toBe(true);
    expect(resolveKisOverseasSpxIscd({})).toBe('SPX');
    expect(resolveKisOverseasNdxIscd({ KIS_OVERSEAS_NDX_ISCD: 'COMP' })).toBe('COMP');
  });
});
