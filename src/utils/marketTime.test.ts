/**
 * @responsibility client marketTime SSOT 회귀 테스트 — 서버 Registry 와 결과 동등성 확인
 */
import { describe, expect, it } from 'vitest';
import {
  classifySymbol,
  isOpenAt,
  isMarketOpenFor,
  isKstWeekend,
  nextOpenAt,
  nextOpenAtFor,
  formatNextOpenKst,
} from './marketTime';

const SAT_KST_NOON = new Date('2026-04-25T03:00:00.000Z'); // KST 토 12:00
const MON_KST_NOON = new Date('2026-04-27T03:00:00.000Z'); // KST 월 12:00
const MON_NYSE_OPEN = new Date('2026-04-27T15:30:00.000Z'); // ET 월 10:30

describe('classifySymbol', () => {
  it('KR 티커·6자리·지수는 KRX', () => {
    expect(classifySymbol('005930.KS')).toBe('KRX');
    expect(classifySymbol('035420.KQ')).toBe('KRX');
    expect(classifySymbol('005930')).toBe('KRX');
    expect(classifySymbol('^KS11')).toBe('KRX');
    expect(classifySymbol('^KQ11')).toBe('KRX');
    expect(classifySymbol('^VKOSPI')).toBe('KRX');
  });
  it('JP 티커는 TSE, 그 외는 NYSE', () => {
    expect(classifySymbol('7203.T')).toBe('TSE');
    expect(classifySymbol('AAPL')).toBe('NYSE');
    expect(classifySymbol('^VIX')).toBe('NYSE');
    expect(classifySymbol('')).toBe('NYSE');
  });
});

describe('isKstWeekend', () => {
  it('토·일 true, 평일 false', () => {
    expect(isKstWeekend(SAT_KST_NOON)).toBe(true);
    expect(isKstWeekend(new Date('2026-04-26T03:00:00.000Z'))).toBe(true);
    expect(isKstWeekend(MON_KST_NOON)).toBe(false);
  });
});

describe('isMarketOpenFor', () => {
  it('KRX 장중(월 12:00 KST) — KR 심볼 true, US 심볼 false', () => {
    expect(isMarketOpenFor('005930.KS', MON_KST_NOON)).toBe(true);
    expect(isMarketOpenFor('AAPL', MON_KST_NOON)).toBe(false);
  });
  it('NYSE 장중(월 10:30 ET) — US 심볼 true, KR 심볼 false', () => {
    expect(isMarketOpenFor('AAPL', MON_NYSE_OPEN)).toBe(true);
    expect(isMarketOpenFor('005930.KS', MON_NYSE_OPEN)).toBe(false);
  });
  it('주말 토 12:00 KST — 모든 심볼 false', () => {
    expect(isMarketOpenFor('005930.KS', SAT_KST_NOON)).toBe(false);
    expect(isMarketOpenFor('AAPL', SAT_KST_NOON)).toBe(false);
  });
});

describe('isOpenAt — 엣지 (장 마감 경계)', () => {
  it('KRX 15:29 open, 15:30 closed', () => {
    const MON_KST_1529 = new Date('2026-04-27T06:29:00.000Z');
    const MON_KST_1530 = new Date('2026-04-27T06:30:00.000Z');
    expect(isOpenAt('KRX', MON_KST_1529)).toBe(true);
    expect(isOpenAt('KRX', MON_KST_1530)).toBe(false);
  });
});

describe('nextOpenAt / nextOpenAtFor', () => {
  it('KRX 주말 → 다음 개장 월 09:00 KST', () => {
    expect(nextOpenAt('KRX', SAT_KST_NOON).toISOString()).toBe('2026-04-27T00:00:00.000Z');
  });
  it('NYSE 금요일 마감 → 월 09:30 ET (주말 건너뜀)', () => {
    const FRI_1600_ET = new Date('2026-04-24T21:00:00.000Z');
    expect(nextOpenAt('NYSE', FRI_1600_ET).toISOString()).toBe('2026-04-27T14:30:00.000Z');
  });
  it('nextOpenAtFor 심볼 입력', () => {
    expect(nextOpenAtFor('005930.KS', SAT_KST_NOON).toISOString()).toBe('2026-04-27T00:00:00.000Z');
    expect(nextOpenAtFor('AAPL', SAT_KST_NOON).toISOString()).toBe('2026-04-27T14:30:00.000Z');
  });
});

describe('formatNextOpenKst', () => {
  it('UTC Date 를 "X HH:MM KST" 로 변환', () => {
    const mon9 = new Date('2026-04-27T00:00:00.000Z'); // KST 월 09:00
    expect(formatNextOpenKst(mon9)).toBe('월 09:00 KST');
  });
});
