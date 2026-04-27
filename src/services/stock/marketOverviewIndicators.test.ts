/**
 * @responsibility marketOverviewIndicators 회귀 테스트 (ADR-0061 PR-α)
 *
 * 본 SSOT 의 두 핵심 동작을 검증한다:
 *  1) extractDataPoint — Yahoo chart.result[0].meta 응답에서 MarketDataPoint 추출
 *  2) applyPrefilledOverlay — AI 응답을 prefill 결과로 강제 덮어쓰기 (hallucination 차단)
 *  3) fetchPrefilledMarketData — 8 심볼 병렬 fetch + Promise.allSettled graceful fallback
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import {
  applyPrefilledOverlay,
  COMMODITY_TARGETS,
  extractDataPoint,
  fetchPrefilledMarketData,
  FX_TARGETS,
  INDEX_TARGETS,
  type IndicatorTarget,
  type PrefilledMarketData,
} from './marketOverviewIndicators';
import * as historicalData from './historicalData';

const TARGET_SP500: IndicatorTarget = { symbol: '^GSPC', name: 'S&P 500' };

describe('SSOT — INDEX_TARGETS / FX_TARGETS / COMMODITY_TARGETS (ADR-0061 §2)', () => {
  it('INDEX_TARGETS 5 심볼 (S&P 500 / NASDAQ / Dow Jones / Nikkei 225 / CSI 300)', () => {
    expect(INDEX_TARGETS).toHaveLength(5);
    expect(INDEX_TARGETS.map(t => t.symbol)).toEqual([
      '^GSPC', '^IXIC', '^DJI', '^N225', '000300.SS',
    ]);
  });

  it('FX_TARGETS 2 심볼 (JPY/KRW + EUR/KRW). USD/KRW 는 ECOS macroCached 우선이라 제외', () => {
    expect(FX_TARGETS).toHaveLength(2);
    expect(FX_TARGETS.map(t => t.symbol)).toEqual(['JPYKRW=X', 'EURKRW=X']);
  });

  it('COMMODITY_TARGETS 2 심볼 (금 + WTI 원유)', () => {
    expect(COMMODITY_TARGETS).toHaveLength(2);
    expect(COMMODITY_TARGETS.map(t => t.symbol)).toEqual(['GC=F', 'CL=F']);
  });
});

describe('extractDataPoint — Yahoo meta 응답 → MarketDataPoint', () => {
  it('정상 응답: regularMarketPrice + regularMarketPreviousClose 가 모두 있을 때 change/changePercent 계산', () => {
    const point = extractDataPoint(TARGET_SP500, {
      meta: { regularMarketPrice: 4500, regularMarketPreviousClose: 4480 },
    });
    expect(point).toEqual({
      name: 'S&P 500', value: 4500, change: 20, changePercent: 0.45,
    });
  });

  it('previousClose 만 있을 때도 동작 (regularMarketPreviousClose fallback)', () => {
    const point = extractDataPoint(TARGET_SP500, {
      meta: { regularMarketPrice: 4500, previousClose: 4400 },
    });
    expect(point?.value).toBe(4500);
    expect(point?.change).toBe(100);
    expect(point?.changePercent).toBe(2.27);
  });

  it('prev 없으면 change/changePercent 는 0 (안전 fallback, 가격은 그대로 표시)', () => {
    const point = extractDataPoint(TARGET_SP500, {
      meta: { regularMarketPrice: 4500 },
    });
    expect(point).toEqual({
      name: 'S&P 500', value: 4500, change: 0, changePercent: 0,
    });
  });

  it('가격 0 또는 음수 또는 NaN 은 null 반환 (오염 차단)', () => {
    expect(extractDataPoint(TARGET_SP500, { meta: { regularMarketPrice: 0 } })).toBeNull();
    expect(extractDataPoint(TARGET_SP500, { meta: { regularMarketPrice: -10 } })).toBeNull();
    expect(extractDataPoint(TARGET_SP500, { meta: { regularMarketPrice: NaN } })).toBeNull();
    expect(extractDataPoint(TARGET_SP500, { meta: { regularMarketPrice: Infinity } })).toBeNull();
  });

  it('meta 없거나 null 입력은 null 반환 (graceful)', () => {
    expect(extractDataPoint(TARGET_SP500, null)).toBeNull();
    expect(extractDataPoint(TARGET_SP500, {})).toBeNull();
    expect(extractDataPoint(TARGET_SP500, { meta: null })).toBeNull();
  });

  it('prev 가 0 또는 음수면 무시하고 change=0 fallback (분모 0 방어)', () => {
    const point = extractDataPoint(TARGET_SP500, {
      meta: { regularMarketPrice: 4500, regularMarketPreviousClose: 0, previousClose: 0 },
    });
    expect(point?.change).toBe(0);
    expect(point?.changePercent).toBe(0);
  });
});

describe('applyPrefilledOverlay — AI 응답 hallucination 차단 (ADR-0061 §3)', () => {
  const aiHallucinated = {
    indices: [{ name: 'S&P 500', value: 9999, change: 100, changePercent: 1.0 }],
    exchangeRates: [{ name: 'JPY/KRW', value: 99, change: 0, changePercent: 0 }],
    commodities: [{ name: '금 (Gold)', value: 9999, change: 0, changePercent: 0 }],
  };

  const realPrefilled: PrefilledMarketData = {
    indices: [{ name: 'S&P 500', value: 4500, change: 20, changePercent: 0.45 }],
    exchangeRates: [{ name: 'JPY/KRW', value: 9.32, change: 0, changePercent: 0 }],
    commodities: [{ name: '금 (Gold)', value: 2400, change: 5, changePercent: 0.21 }],
    failedSymbols: [],
    fetchedAt: '2026-04-27T00:00:00.000Z',
  };

  it('prefill 카테고리에 데이터 있으면 AI 응답을 *완전히* 무시하고 prefill 사용', () => {
    const out = applyPrefilledOverlay(aiHallucinated, realPrefilled);
    expect(out.indices[0].value).toBe(4500); // AI 의 9999 가 아닌 prefill 의 4500
    expect(out.exchangeRates[0].value).toBe(9.32);
    expect(out.commodities[0].value).toBe(2400);
  });

  it('prefill 카테고리가 빈 배열이면 AI 응답 fallback 유지 (모든 심볼 fetch 실패 시)', () => {
    const empty: PrefilledMarketData = {
      indices: [], exchangeRates: [], commodities: [], failedSymbols: [], fetchedAt: '',
    };
    const out = applyPrefilledOverlay(aiHallucinated, empty);
    expect(out.indices[0].value).toBe(9999); // AI fallback
    expect(out.exchangeRates[0].value).toBe(99);
    expect(out.commodities[0].value).toBe(9999);
  });

  it('AI 응답 카테고리가 undefined 이면 빈 배열 fallback (안전)', () => {
    const empty: PrefilledMarketData = {
      indices: [], exchangeRates: [], commodities: [], failedSymbols: [], fetchedAt: '',
    };
    const out = applyPrefilledOverlay(
      { indices: undefined, exchangeRates: undefined, commodities: undefined },
      empty,
    );
    expect(out.indices).toEqual([]);
    expect(out.exchangeRates).toEqual([]);
    expect(out.commodities).toEqual([]);
  });

  it('일부 카테고리만 prefill 성공해도 카테고리별 독립 분기 (e.g. 지수만 성공, 환율 실패)', () => {
    const partial: PrefilledMarketData = {
      indices: [{ name: 'S&P 500', value: 4500, change: 0, changePercent: 0 }],
      exchangeRates: [], // FX fetch 실패
      commodities: [{ name: '금 (Gold)', value: 2400, change: 0, changePercent: 0 }],
      failedSymbols: ['JPYKRW=X', 'EURKRW=X'],
      fetchedAt: '',
    };
    const out = applyPrefilledOverlay(aiHallucinated, partial);
    expect(out.indices[0].value).toBe(4500);
    expect(out.exchangeRates[0].value).toBe(99); // AI fallback (FX 실패)
    expect(out.commodities[0].value).toBe(2400);
  });
});

describe('fetchPrefilledMarketData — Promise.allSettled graceful fallback', () => {
  let fetchSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    fetchSpy = vi.spyOn(historicalData, 'fetchHistoricalData');
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('모든 8 심볼 정상 응답 시 indices 5 + exchangeRates 2 + commodities 2 + failedSymbols 0', async () => {
    fetchSpy.mockResolvedValue({
      meta: { regularMarketPrice: 1000, regularMarketPreviousClose: 990 },
    } as any);

    const result = await fetchPrefilledMarketData();
    expect(result.indices).toHaveLength(5);
    expect(result.exchangeRates).toHaveLength(2);
    expect(result.commodities).toHaveLength(2);
    expect(result.failedSymbols).toEqual([]);
    expect(typeof result.fetchedAt).toBe('string');
    expect(fetchSpy).toHaveBeenCalledTimes(9);
  });

  it('일부 심볼 throw 해도 다른 심볼은 정상 처리 (graceful — 단일 OFFHOURS 가 전체 차단 X)', async () => {
    fetchSpy.mockImplementation(async (symbol: string) => {
      if (symbol === '^GSPC' || symbol === 'GC=F') {
        throw new Error('OFFHOURS');
      }
      return { meta: { regularMarketPrice: 1000, regularMarketPreviousClose: 990 } } as any;
    });

    const result = await fetchPrefilledMarketData();
    expect(result.indices.map(i => i.name)).not.toContain('S&P 500');
    expect(result.indices).toHaveLength(4); // 5 - 1 (^GSPC 실패)
    expect(result.commodities.map(c => c.name)).not.toContain('금 (Gold)');
    expect(result.commodities).toHaveLength(1); // 2 - 1 (GC=F 실패)
    expect(result.exchangeRates).toHaveLength(2); // FX 정상
    expect(result.failedSymbols.sort()).toEqual(['^GSPC', 'GC=F'].sort());
  });

  it('fetchHistoricalData 가 null 반환 (장외 OFFHOURS) 도 failedSymbols 로 분류', async () => {
    fetchSpy.mockResolvedValue(null as any);

    const result = await fetchPrefilledMarketData();
    expect(result.indices).toEqual([]);
    expect(result.exchangeRates).toEqual([]);
    expect(result.commodities).toEqual([]);
    expect(result.failedSymbols).toHaveLength(9);
  });

  it('range/interval 인자: 모든 호출이 1d/1d 로 통일 (intraday 신선도)', async () => {
    fetchSpy.mockResolvedValue({
      meta: { regularMarketPrice: 1000, regularMarketPreviousClose: 990 },
    } as any);

    await fetchPrefilledMarketData();
    for (const call of fetchSpy.mock.calls) {
      expect(call[1]).toBe('1d');
      expect(call[2]).toBe('1d');
    }
  });
});
