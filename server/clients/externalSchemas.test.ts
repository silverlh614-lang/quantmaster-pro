import { describe, it, expect } from 'vitest';
import { kisInquirePriceSchema, yahooChartSchema } from './externalSchemas.js';

describe('kisInquirePriceSchema', () => {
  it('정상 응답 통과 — output.stck_prpr 필수', () => {
    const result = kisInquirePriceSchema.safeParse({
      rt_cd: '0',
      msg_cd: 'MCA00000',
      output: { stck_prpr: '70000', stck_sdpr: '69000', hts_kor_isnm: '삼성전자' },
    });
    expect(result.success).toBe(true);
  });

  it('output 누락 → 실패', () => {
    expect(kisInquirePriceSchema.safeParse({ rt_cd: '0' }).success).toBe(false);
  });

  it('stck_prpr 빈 문자열 → 실패 (NaN 학습 가중치 누수 차단)', () => {
    expect(kisInquirePriceSchema.safeParse({ output: { stck_prpr: '' } }).success).toBe(false);
  });

  it('stck_prpr 숫자 타입 → 실패 (KIS 는 항상 string 으로 응답)', () => {
    expect(kisInquirePriceSchema.safeParse({ output: { stck_prpr: 70000 } }).success).toBe(false);
  });

  it('stck_sdpr 누락은 통과 (선택 필드)', () => {
    const result = kisInquirePriceSchema.safeParse({ output: { stck_prpr: '100' } });
    expect(result.success).toBe(true);
  });

  it('catchall 로 알 수 없는 필드 보존', () => {
    const result = kisInquirePriceSchema.safeParse({
      output: { stck_prpr: '100', new_field: 'future-value' },
      extra_root: { whatever: 1 },
    });
    expect(result.success).toBe(true);
  });
});

describe('yahooChartSchema', () => {
  function mkResponse(opts: { withResult?: boolean; withError?: boolean; withMeta?: boolean } = {}): unknown {
    if (opts.withError) {
      return { chart: { result: null, error: { code: 'Not Found', description: 'symbol not found' } } };
    }
    return {
      chart: {
        result: opts.withResult === false ? null : [{
          ...(opts.withMeta ? { meta: { regularMarketPrice: 100, regularMarketPreviousClose: 99 } } : {}),
          timestamp: [1, 2, 3],
          indicators: { quote: [{ open: [1, 2, 3], high: [1, 2, 3], low: [1, 2, 3], close: [1, 2, 3], volume: [10, 20, 30] }] },
        }],
        error: null,
      },
    };
  }

  it('정상 chart 응답 통과', () => {
    expect(yahooChartSchema.safeParse(mkResponse({ withMeta: true })).success).toBe(true);
  });

  it('chart.error 응답 통과 (result=null 허용 — 호출자가 별도 분기)', () => {
    expect(yahooChartSchema.safeParse(mkResponse({ withError: true })).success).toBe(true);
  });

  it('quote 배열의 null 값 보존 (Yahoo 가 null 을 자주 반환)', () => {
    const data = {
      chart: {
        result: [{
          timestamp: [1, 2, 3],
          indicators: { quote: [{ open: [1, null, 3], high: [1, null, 3], low: [1, null, 3], close: [1, null, 3], volume: [null, 20, 30] }] },
        }],
        error: null,
      },
    };
    expect(yahooChartSchema.safeParse(data).success).toBe(true);
  });

  it('chart 자체가 없으면 실패 — 학습 가중치 누수 차단', () => {
    expect(yahooChartSchema.safeParse({}).success).toBe(false);
  });

  it('chart.result 가 객체(배열 아님) 면 실패', () => {
    expect(yahooChartSchema.safeParse({ chart: { result: { foo: 'bar' }, error: null } }).success).toBe(false);
  });

  it('indicators.quote 누락 시 실패 — 가격 데이터 부재 차단', () => {
    const data = {
      chart: {
        result: [{ timestamp: [1, 2, 3], indicators: {} }],
        error: null,
      },
    };
    expect(yahooChartSchema.safeParse(data).success).toBe(false);
  });

  it('meta 가 다양한 필드를 가져도 통과 (record 보존)', () => {
    const data = {
      chart: {
        result: [{
          meta: {
            regularMarketPrice: 100,
            regularMarketPreviousClose: 99,
            regularMarketOpen: 98,
            trailingPE: 12.5,
            unknownField: 'whatever',
            futureField: { nested: 'object' },
          },
          timestamp: [1],
          indicators: { quote: [{ open: [1], high: [1], low: [1], close: [1], volume: [10] }] },
        }],
        error: null,
      },
    };
    expect(yahooChartSchema.safeParse(data).success).toBe(true);
  });
});
