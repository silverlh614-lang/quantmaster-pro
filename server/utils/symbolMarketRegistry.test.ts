/**
 * @responsibility SymbolMarketRegistry 분류·개장 판정 회귀 테스트
 */
import { afterEach, describe, expect, it } from 'vitest';
import {
  classifySymbol,
  isMarketOpenFor,
  isOpenAt,
  listMarkets,
} from './symbolMarketRegistry.js';

afterEach(() => {
  delete process.env.DATA_FETCH_FORCE_MARKET;
  delete process.env.DATA_FETCH_FORCE_OFF;
});

describe('classifySymbol', () => {
  it('KRX — .KS / .KQ / 6자리 숫자', () => {
    expect(classifySymbol('005930.KS')).toBe('KRX');
    expect(classifySymbol('035420.KQ')).toBe('KRX');
    expect(classifySymbol('009540')).toBe('KRX');
  });
  it('KRX — ^KS11 / ^KQ11 / ^VKOSPI 지수', () => {
    expect(classifySymbol('^KS11')).toBe('KRX');
    expect(classifySymbol('^KQ11')).toBe('KRX');
    expect(classifySymbol('^VKOSPI')).toBe('KRX');
  });
  it('TSE — .T 접미사', () => {
    expect(classifySymbol('7203.T')).toBe('TSE');
  });
  it('NYSE — US 티커 + 미매칭 지수 기본값', () => {
    expect(classifySymbol('AAPL')).toBe('NYSE');
    expect(classifySymbol('MTUM')).toBe('NYSE');
    expect(classifySymbol('^VIX')).toBe('NYSE');
    expect(classifySymbol('^TNX')).toBe('NYSE');
    expect(classifySymbol('^IRX')).toBe('NYSE');
    expect(classifySymbol('EWY')).toBe('NYSE');
  });
  it('방어적 기본값 — 빈/공백 문자열은 NYSE', () => {
    expect(classifySymbol('')).toBe('NYSE');
    expect(classifySymbol('   ')).toBe('NYSE');
  });
});

describe('isOpenAt — KRX', () => {
  const MON_KST_0900 = new Date('2026-04-27T00:00:00.000Z'); // KST 월 09:00
  const MON_KST_1529 = new Date('2026-04-27T06:29:00.000Z'); // KST 월 15:29
  const MON_KST_1530 = new Date('2026-04-27T06:30:00.000Z'); // KST 월 15:30 (마감)
  const SAT_KST_1200 = new Date('2026-04-25T03:00:00.000Z'); // KST 토 12:00

  it('09:00~15:30 사이만 open', () => {
    expect(isOpenAt('KRX', MON_KST_0900)).toBe(true);
    expect(isOpenAt('KRX', MON_KST_1529)).toBe(true);
    expect(isOpenAt('KRX', MON_KST_1530)).toBe(false);
  });
  it('주말은 closed', () => {
    expect(isOpenAt('KRX', SAT_KST_1200)).toBe(false);
  });
});

describe('isOpenAt — NYSE', () => {
  const MON_ET_0929 = new Date('2026-04-27T14:29:00.000Z'); // ET 월 09:29 (개장 직전)
  const MON_ET_0930 = new Date('2026-04-27T14:30:00.000Z'); // ET 월 09:30 (개장)
  const MON_ET_1559 = new Date('2026-04-27T20:59:00.000Z'); // ET 월 15:59
  const MON_ET_1600 = new Date('2026-04-27T21:00:00.000Z'); // ET 월 16:00 (마감)
  const SAT_ET_1200 = new Date('2026-04-25T17:00:00.000Z'); // ET 토 12:00

  it('09:30~16:00 ET 사이만 open', () => {
    expect(isOpenAt('NYSE', MON_ET_0929)).toBe(false);
    expect(isOpenAt('NYSE', MON_ET_0930)).toBe(true);
    expect(isOpenAt('NYSE', MON_ET_1559)).toBe(true);
    expect(isOpenAt('NYSE', MON_ET_1600)).toBe(false);
  });
  it('토요일은 closed', () => {
    expect(isOpenAt('NYSE', SAT_ET_1200)).toBe(false);
  });
});

describe('isOpenAt — TSE', () => {
  const MON_JST_0900 = new Date('2026-04-27T00:00:00.000Z'); // JST 월 09:00
  const MON_JST_1459 = new Date('2026-04-27T05:59:00.000Z'); // JST 월 14:59
  const MON_JST_1500 = new Date('2026-04-27T06:00:00.000Z'); // JST 월 15:00 (마감)

  it('09:00~15:00 JST 사이만 open (KRX 보다 30분 빨리 마감)', () => {
    expect(isOpenAt('TSE', MON_JST_0900)).toBe(true);
    expect(isOpenAt('TSE', MON_JST_1459)).toBe(true);
    expect(isOpenAt('TSE', MON_JST_1500)).toBe(false);
  });
});

describe('isMarketOpenFor — 심볼 통합', () => {
  const MON_KST_NOON = new Date('2026-04-27T03:00:00.000Z'); // KST 월 12:00 → KRX open, NYSE closed
  const MON_NYSE_OPEN = new Date('2026-04-27T15:30:00.000Z'); // ET 월 10:30 → KRX closed, NYSE open

  it('KR 심볼은 KRX 시간표 적용', () => {
    expect(isMarketOpenFor('005930.KS', MON_KST_NOON)).toBe(true);
    expect(isMarketOpenFor('005930.KS', MON_NYSE_OPEN)).toBe(false);
  });
  it('US 심볼은 NYSE 시간표 적용', () => {
    expect(isMarketOpenFor('AAPL', MON_KST_NOON)).toBe(false);
    expect(isMarketOpenFor('AAPL', MON_NYSE_OPEN)).toBe(true);
  });
  it('JP 심볼은 TSE 시간표 적용', () => {
    expect(isMarketOpenFor('7203.T', MON_KST_NOON)).toBe(true);
    expect(isMarketOpenFor('7203.T', MON_NYSE_OPEN)).toBe(false);
  });
});

describe('환경변수 강제 오버라이드', () => {
  const OFF_HOURS = new Date('2026-04-25T03:00:00.000Z'); // 토요일

  it('DATA_FETCH_FORCE_MARKET=true → 모든 시장 open', () => {
    process.env.DATA_FETCH_FORCE_MARKET = 'true';
    expect(isOpenAt('KRX', OFF_HOURS)).toBe(true);
    expect(isOpenAt('NYSE', OFF_HOURS)).toBe(true);
    expect(isOpenAt('TSE', OFF_HOURS)).toBe(true);
  });

  it('DATA_FETCH_FORCE_OFF=true → 모든 시장 closed', () => {
    process.env.DATA_FETCH_FORCE_OFF = 'true';
    const MON_KST_NOON = new Date('2026-04-27T03:00:00.000Z');
    expect(isOpenAt('KRX', MON_KST_NOON)).toBe(false);
    expect(isOpenAt('NYSE', MON_KST_NOON)).toBe(false);
  });

  it('FORCE_OFF 가 FORCE_MARKET 보다 우선', () => {
    process.env.DATA_FETCH_FORCE_MARKET = 'true';
    process.env.DATA_FETCH_FORCE_OFF = 'true';
    const MON_KST_NOON = new Date('2026-04-27T03:00:00.000Z');
    expect(isOpenAt('KRX', MON_KST_NOON)).toBe(false);
  });
});

describe('listMarkets', () => {
  it('KRX / NYSE / TSE 3종 등록', () => {
    const ids = listMarkets();
    expect(ids).toContain('KRX');
    expect(ids).toContain('NYSE');
    expect(ids).toContain('TSE');
    expect(ids).toHaveLength(3);
  });
});
