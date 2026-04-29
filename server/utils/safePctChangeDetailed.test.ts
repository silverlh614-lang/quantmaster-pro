// @responsibility safePctChangeDetailed 회귀 테스트 (ADR-0091 PR-Z4)
import { describe, it, expect, beforeEach, vi } from 'vitest';
import {
  safePctChangeDetailed,
  __resetSafePctChangeWarnsForTests,
  type PriceBase,
} from './safePctChange';

beforeEach(() => {
  __resetSafePctChangeWarnsForTests();
});

describe('safePctChangeDetailed — INVALID_PRICE 분기', () => {
  it('base=0 시 valid=false + reason=INVALID_PRICE', () => {
    const r = safePctChangeDetailed(100, 0);
    expect(r.valid).toBe(false);
    expect(r.reason).toBe('INVALID_PRICE');
    expect(r.value).toBe(0);
  });

  it('base=NaN 시 INVALID_PRICE', () => {
    expect(safePctChangeDetailed(100, NaN).reason).toBe('INVALID_PRICE');
  });

  it('base=Infinity 시 INVALID_PRICE', () => {
    expect(safePctChangeDetailed(100, Infinity).reason).toBe('INVALID_PRICE');
  });

  it('base=음수 시 INVALID_PRICE', () => {
    expect(safePctChangeDetailed(100, -50).reason).toBe('INVALID_PRICE');
  });

  it('current=NaN 시 INVALID_PRICE', () => {
    expect(safePctChangeDetailed(NaN, 100).reason).toBe('INVALID_PRICE');
  });

  it('current=Infinity 시 INVALID_PRICE', () => {
    expect(safePctChangeDetailed(Infinity, 100).reason).toBe('INVALID_PRICE');
  });

  it('current=음수 시 INVALID_PRICE', () => {
    expect(safePctChangeDetailed(-10, 100).reason).toBe('INVALID_PRICE');
  });
});

describe('safePctChangeDetailed — STALE_BASE_OR_SPLIT_ADJUSTMENT 분기', () => {
  it('이미지 로그 시나리오 — 189300.KS (-71%) 차단', () => {
    const r = safePctChangeDetailed(8740, {
      value: 28450,
      asOf: new Date(Date.now() - 1 * 24 * 60 * 60 * 1000).toISOString(),
      source: 'YAHOO_HISTORICAL',
    }, {
      label: 'yahooQuoteAdapter.changePercent:189300.KS',
      mode: 'DAILY',
      silent: true,
    });
    expect(r.valid).toBe(false);
    expect(r.reason).toBe('STALE_BASE_OR_SPLIT_ADJUSTMENT');
    expect(r.value).toBe(0);
  });

  it('이미지 로그 시나리오 — 001430.KS (-86%) 차단', () => {
    const r = safePctChangeDetailed(12610, 43500, {
      mode: 'DAILY',
      silent: true,
    });
    expect(r.valid).toBe(false);
    expect(r.reason).toBe('STALE_BASE_OR_SPLIT_ADJUSTMENT');
  });

  it('정상 +5% 통과', () => {
    const r = safePctChangeDetailed(105, 100, { mode: 'DAILY' });
    expect(r.valid).toBe(true);
    expect(r.reason).toBe('OK');
    expect(r.value).toBeCloseTo(5);
  });

  it('정상 -3% 통과', () => {
    const r = safePctChangeDetailed(97, 100, { mode: 'DAILY' });
    expect(r.valid).toBe(true);
    expect(r.value).toBeCloseTo(-3);
  });

  it('DAILY mode boundary 50% 정확 (49.99% 통과)', () => {
    const r = safePctChangeDetailed(149.99, 100, { mode: 'DAILY' });
    expect(r.valid).toBe(true);
  });

  it('DAILY mode boundary 50% 초과 (50.01% 차단)', () => {
    const r = safePctChangeDetailed(150.01, 100, { mode: 'DAILY', silent: true });
    expect(r.valid).toBe(false);
    expect(r.reason).toBe('STALE_BASE_OR_SPLIT_ADJUSTMENT');
  });

  it('sanityBoundPct override 우선 (mode 무시)', () => {
    const r = safePctChangeDetailed(120, 100, {
      mode: 'INTRADAY', // 기본 30%
      sanityBoundPct: 50, // override 50%
      silent: true,
    });
    expect(r.valid).toBe(true); // 20% < 50%
  });
});

describe('safePctChangeDetailed — STALE_BASE_AGE 분기 (PriceBase)', () => {
  it('asOf 가 30일 초과 시 STALE_BASE_AGE (DAILY mode 3일 임계)', () => {
    const base: PriceBase = {
      value: 100,
      asOf: new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString(),
      source: 'YAHOO_HISTORICAL',
    };
    const r = safePctChangeDetailed(105, base, { mode: 'DAILY', silent: true });
    expect(r.valid).toBe(false);
    expect(r.reason).toBe('STALE_BASE_AGE');
  });

  it('asOf 가 신선 시 정상 통과', () => {
    const base: PriceBase = {
      value: 100,
      asOf: new Date(Date.now() - 1 * 60 * 60 * 1000).toISOString(),
      source: 'YAHOO_HISTORICAL',
    };
    const r = safePctChangeDetailed(105, base, { mode: 'DAILY' });
    expect(r.valid).toBe(true);
    expect(r.value).toBeCloseTo(5);
  });

  it('잘못된 ISO asOf → STALE_BASE_AGE (보수적 차단)', () => {
    const base: PriceBase = {
      value: 100,
      asOf: 'invalid-iso',
      source: 'YAHOO_HISTORICAL',
    };
    const r = safePctChangeDetailed(105, base, { mode: 'DAILY', silent: true });
    expect(r.valid).toBe(false);
    expect(r.reason).toBe('STALE_BASE_AGE');
  });

  it('PriceBase.staleAfterDays override 가 mode 보다 우선', () => {
    const base: PriceBase = {
      value: 100,
      asOf: new Date(Date.now() - 5 * 24 * 60 * 60 * 1000).toISOString(),
      source: 'YAHOO_HISTORICAL',
      staleAfterDays: 10, // 10일 허용
    };
    const r = safePctChangeDetailed(105, base, { mode: 'DAILY' }); // DAILY=3일이지만 override=10일
    expect(r.valid).toBe(true);
  });
});

describe('safePctChangeDetailed — 진단 로그', () => {
  it('STALE_BASE_OR_SPLIT_ADJUSTMENT 시 console.warn 출력', () => {
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
    safePctChangeDetailed(150, 50, {
      label: 'test:symbol',
      mode: 'DAILY',
    });
    expect(warnSpy).toHaveBeenCalled();
    const msg = warnSpy.mock.calls[0][0] as string;
    expect(msg).toContain('STALE_BASE_OR_SPLIT_ADJUSTMENT');
    expect(msg).toContain('test:symbol');
    expect(msg).toContain('Yahoo 등락률 폐기 권고');
    warnSpy.mockRestore();
  });

  it('silent=true 시 console.warn 미출력', () => {
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
    safePctChangeDetailed(150, 50, {
      label: 'test:symbol',
      mode: 'DAILY',
      silent: true,
    });
    expect(warnSpy).not.toHaveBeenCalled();
    warnSpy.mockRestore();
  });

  it('label 별 60s throttle — 동일 label 1분 안 1회만 발송', () => {
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
    safePctChangeDetailed(150, 50, { label: 'throttle:test', mode: 'DAILY' });
    safePctChangeDetailed(160, 50, { label: 'throttle:test', mode: 'DAILY' });
    expect(warnSpy).toHaveBeenCalledTimes(1);
    warnSpy.mockRestore();
  });
});

describe('safePctChangeDetailed — 호출자 폴백 패턴 (사용자 패치 직접 검증)', () => {
  it('사용자 패치 §"valid=true 면 value 사용, false 면 KIS 폴백" 분기 작동', () => {
    const yahooResult = safePctChangeDetailed(8740, 28450, { mode: 'DAILY', silent: true });
    const kisChangePercent = -2.5;
    const changePercent = yahooResult.valid ? yahooResult.value : (kisChangePercent ?? 0);
    expect(changePercent).toBe(-2.5); // KIS 폴백 사용
  });

  it('사용자 패치 §"KIS 도 없으면 0 + 데이터품질 경고" 분기', () => {
    const yahooResult = safePctChangeDetailed(8740, 28450, { mode: 'DAILY', silent: true });
    const kisChangePercent = null;
    let dataQuality: 'OK' | 'STALE_BASE' = 'OK';
    const changePercent = yahooResult.valid ? yahooResult.value : (kisChangePercent ?? 0);
    if (!yahooResult.valid) dataQuality = 'STALE_BASE';
    expect(changePercent).toBe(0);
    expect(dataQuality).toBe('STALE_BASE');
  });
});
