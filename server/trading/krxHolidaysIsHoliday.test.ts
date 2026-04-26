/**
 * @responsibility krxHolidays.isKrxHoliday 헬퍼 회귀 테스트 — PR-A 신규.
 *
 * 본 헬퍼는 향후 ADR-0037 (MarketDayClassifier SSOT) 도입 시 단일 교체 지점이 된다.
 * KRX_HOLIDAYS Set 직접 접근을 차단하기 위한 추상화 계층의 단위 검증.
 */

import { describe, it, expect } from 'vitest';
import { isKrxHoliday, KRX_HOLIDAYS } from './krxHolidays.js';

describe('isKrxHoliday — PR-A', () => {
  it('2026 어린이날(5/5)은 KRX 공휴일이다', () => {
    expect(isKrxHoliday('2026-05-05')).toBe(true);
  });

  it('2026 어린이날 다음날(5/6)은 평일 영업일이다', () => {
    expect(isKrxHoliday('2026-05-06')).toBe(false);
  });

  it('2027 신정(1/1)도 차단된다 — 다년도 커버리지', () => {
    expect(isKrxHoliday('2027-01-01')).toBe(true);
  });

  it('목록에 없는 미래 날짜(2099-01-01)는 false', () => {
    expect(isKrxHoliday('2099-01-01')).toBe(false);
  });

  it('빈 문자열은 false (방어적)', () => {
    expect(isKrxHoliday('')).toBe(false);
  });

  it('잘못된 형식은 Set lookup miss 로 false', () => {
    expect(isKrxHoliday('2026/05/05')).toBe(false);
  });

  it('KRX_HOLIDAYS Set 과 일관성을 유지한다', () => {
    // 헬퍼는 Set.has 단순 래퍼 — 모든 등록 항목이 true 를 반환해야 한다.
    for (const ymd of KRX_HOLIDAYS) {
      expect(isKrxHoliday(ymd)).toBe(true);
    }
  });
});
