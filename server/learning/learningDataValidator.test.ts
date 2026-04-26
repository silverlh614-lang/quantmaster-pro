/**
 * @responsibility learningDataValidator 회귀 테스트 — 영업일 필터링 + 거부 진단 (ADR-0037 PR-B)
 */

import { describe, it, expect } from 'vitest';
import {
  filterToTradingDayRecords,
  countTradingDays,
} from './learningDataValidator.js';

interface TestRec {
  id: string;
  date?: string;
}

describe('filterToTradingDayRecords — 영업일 필터링', () => {
  it('빈 입력 → 빈 결과', () => {
    const res = filterToTradingDayRecords<TestRec>(
      [],
      (r) => r.date,
      (r) => r.id,
    );
    expect(res.validRecords).toHaveLength(0);
    expect(res.rejectedCount).toBe(0);
    expect(res.rejectedSamples).toHaveLength(0);
  });

  it('모든 영업일 레코드는 통과', () => {
    const recs: TestRec[] = [
      { id: 'a', date: '2026-04-21' }, // 화
      { id: 'b', date: '2026-04-22' }, // 수
      { id: 'c', date: '2026-04-23' }, // 목
    ];
    const res = filterToTradingDayRecords(recs, (r) => r.date, (r) => r.id);
    expect(res.validRecords).toHaveLength(3);
    expect(res.rejectedCount).toBe(0);
  });

  it('주말 레코드는 NON_TRADING_DAY 사유로 거부', () => {
    const recs: TestRec[] = [
      { id: 'sat', date: '2026-04-25' }, // 토
      { id: 'sun', date: '2026-04-26' }, // 일
      { id: 'tue', date: '2026-04-21' }, // 화 — 통과
    ];
    const res = filterToTradingDayRecords(recs, (r) => r.date, (r) => r.id);
    expect(res.validRecords).toHaveLength(1);
    expect(res.validRecords[0].id).toBe('tue');
    expect(res.rejectedCount).toBe(2);
    expect(res.rejectedSamples).toHaveLength(2);
    expect(res.rejectedSamples[0]).toEqual({
      recordId: 'sat',
      date: '2026-04-25',
      reason: 'NON_TRADING_DAY',
    });
  });

  it('KRX 공휴일 레코드도 NON_TRADING_DAY 거부', () => {
    const recs: TestRec[] = [
      { id: 'children', date: '2026-05-05' }, // 어린이날
      { id: 'tue', date: '2026-05-06' },       // 영업일
    ];
    const res = filterToTradingDayRecords(recs, (r) => r.date, (r) => r.id);
    expect(res.validRecords.map((r) => r.id)).toEqual(['tue']);
    expect(res.rejectedSamples[0].reason).toBe('NON_TRADING_DAY');
  });

  it('date 필드 부재 시 KST_DATE_MISSING 거부', () => {
    const recs: TestRec[] = [
      { id: 'a' }, // date 없음
      { id: 'b', date: '2026-04-21' },
    ];
    const res = filterToTradingDayRecords(recs, (r) => r.date, (r) => r.id);
    expect(res.validRecords.map((r) => r.id)).toEqual(['b']);
    expect(res.rejectedSamples[0]).toEqual({
      recordId: 'a',
      date: '',
      reason: 'KST_DATE_MISSING',
    });
  });

  it('rejectedSamples 는 최대 5건으로 절삭', () => {
    const recs: TestRec[] = Array.from({ length: 10 }, (_, i) => ({
      id: `sat-${i}`,
      date: '2026-04-25',
    }));
    const res = filterToTradingDayRecords(recs, (r) => r.date, (r) => r.id);
    expect(res.rejectedCount).toBe(10);
    expect(res.rejectedSamples).toHaveLength(5); // 절삭
  });
});

describe('countTradingDays — 영업일 카운트', () => {
  it('단일 영업일 → 1', () => {
    expect(countTradingDays('2026-04-21', '2026-04-21')).toBe(1);
  });

  it('단일 주말 → 0', () => {
    expect(countTradingDays('2026-04-25', '2026-04-25')).toBe(0);
  });

  it('한 주 (월~일) → 5 영업일', () => {
    // 2026-04-20 월 ~ 2026-04-26 일
    expect(countTradingDays('2026-04-20', '2026-04-26')).toBe(5);
  });

  it('어린이날 포함 한 주 (5/4 월 ~ 5/10 일) → 4 영업일', () => {
    // 5/4 월(POST_HOLIDAY 영업일), 5/5 화(어린이날 휴장), 5/6 수, 5/7 목, 5/8 금
    expect(countTradingDays('2026-05-04', '2026-05-10')).toBe(4);
  });

  it('역순 입력 → 0', () => {
    expect(countTradingDays('2026-04-30', '2026-04-21')).toBe(0);
  });

  it('빈 입력 → 0', () => {
    expect(countTradingDays('', '')).toBe(0);
    expect(countTradingDays('2026-04-21', '')).toBe(0);
  });
});
