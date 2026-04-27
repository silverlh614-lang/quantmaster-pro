/**
 * @responsibility marketOverview parseStaleFieldsHeader + fetchMarketIndicators 헤더 회귀 (ADR-0069)
 *
 * 검증:
 *   1) parseStaleFieldsHeader: 빈/null/콤마/공백/단일 필드
 *   2) fetchMarketIndicators: 정상 응답에 X-Field-Stale 헤더 → staleFields 노출
 *   3) 헤더 부재 시 staleFields=undefined (기존 호출자 호환)
 *   4) HTTP 실패 시 staleFields 미설정 (기존 fallback)
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { fetchMarketIndicators, parseStaleFieldsHeader } from './marketOverview';

describe('parseStaleFieldsHeader — X-Field-Stale 헤더 파싱 (ADR-0069 §2.1)', () => {
  it('null 헤더 → 빈 배열', () => {
    expect(parseStaleFieldsHeader(null)).toEqual([]);
  });

  it('빈 문자열 → 빈 배열', () => {
    expect(parseStaleFieldsHeader('')).toEqual([]);
  });

  it('단일 필드', () => {
    expect(parseStaleFieldsHeader('vix')).toEqual(['vix']);
  });

  it('콤마 구분 다중 필드', () => {
    expect(parseStaleFieldsHeader('vix,us10yYield,kospi')).toEqual([
      'vix', 'us10yYield', 'kospi',
    ]);
  });

  it('공백 trim', () => {
    expect(parseStaleFieldsHeader(' vix , us10yYield ,  kospi  ')).toEqual([
      'vix', 'us10yYield', 'kospi',
    ]);
  });

  it('빈 항목 (콤마 연속) 제거', () => {
    expect(parseStaleFieldsHeader('vix,,kospi,')).toEqual(['vix', 'kospi']);
  });

  it('공백만 있는 항목 제거', () => {
    expect(parseStaleFieldsHeader('vix,   ,kospi')).toEqual(['vix', 'kospi']);
  });

  it('알 수 없는 필드명도 그대로 유지 (서버 변경 시 적응)', () => {
    expect(parseStaleFieldsHeader('newField,anotherUnknown')).toEqual([
      'newField', 'anotherUnknown',
    ]);
  });
});

describe('fetchMarketIndicators — X-Field-Stale 헤더 통합', () => {
  const ORIGINAL_FETCH = global.fetch;

  beforeEach(() => {
    vi.resetAllMocks();
  });

  afterEach(() => {
    global.fetch = ORIGINAL_FETCH;
  });

  it('헤더 있을 때 staleFields 배열 반환', async () => {
    const mockResp = new Response(JSON.stringify({
      vix: 18, us10yYield: 4.2, usShortRate: 5.1, samsungIri: 1.0,
      vkospi: 20, vkospiDayChange: 0, vkospi5dTrend: 0,
      kospi: { price: 2700, change: 5, changePct: 0.2 },
      kosdaq: { price: 800, change: 2, changePct: 0.25 },
      ewyReturn: 1.2, mtumReturn: 0.8,
    }), {
      status: 200,
      headers: new Headers({
        'Content-Type': 'application/json',
        'X-Field-Stale': 'vix,us10yYield',
      }),
    });
    global.fetch = vi.fn().mockResolvedValue(mockResp);

    const result = await fetchMarketIndicators();
    expect(result.staleFields).toEqual(['vix', 'us10yYield']);
    expect(result.vix).toBe(18);  // 데이터 본체는 정상 노출
  });

  it('헤더 부재 시 staleFields=undefined (기존 호출자 호환)', async () => {
    const mockResp = new Response(JSON.stringify({
      vix: 18, us10yYield: 4.2, usShortRate: null, samsungIri: null,
      vkospi: 20, vkospiDayChange: 0, vkospi5dTrend: 0,
      kospi: null, kosdaq: null, ewyReturn: null, mtumReturn: null,
    }), {
      status: 200,
      headers: new Headers({ 'Content-Type': 'application/json' }),
    });
    global.fetch = vi.fn().mockResolvedValue(mockResp);

    const result = await fetchMarketIndicators();
    expect(result.staleFields).toBeUndefined();
  });

  it('HTTP 실패 → 모든 필드 null + staleFields 미설정', async () => {
    global.fetch = vi.fn().mockRejectedValue(new Error('network'));

    const result = await fetchMarketIndicators();
    expect(result.vix).toBeNull();
    expect(result.kospi).toBeNull();
    expect(result.staleFields).toBeUndefined();
  });

  it('빈 헤더 ("X-Field-Stale: ") → staleFields=undefined', async () => {
    const mockResp = new Response(JSON.stringify({
      vix: null, us10yYield: null, usShortRate: null, samsungIri: null,
      vkospi: null, vkospiDayChange: null, vkospi5dTrend: null,
      kospi: null, kosdaq: null, ewyReturn: null, mtumReturn: null,
    }), {
      status: 200,
      headers: new Headers({ 'Content-Type': 'application/json', 'X-Field-Stale': '' }),
    });
    global.fetch = vi.fn().mockResolvedValue(mockResp);

    const result = await fetchMarketIndicators();
    expect(result.staleFields).toBeUndefined();  // 빈 배열은 undefined 로 정규화
  });
});
