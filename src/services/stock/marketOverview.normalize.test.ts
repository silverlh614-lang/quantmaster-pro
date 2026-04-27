/**
 * @responsibility marketOverview.normalizeMarketOverview prefill overlay 회귀 (ADR-0061 PR-α)
 *
 * AI 가 hallucinated 가격을 답해도 prefill overlay 가 강제로 덮어쓰는지 검증.
 * normalize 가 export 함수로 격상되어 단위 테스트 가능 (이전엔 module-private).
 */
import { describe, expect, it } from 'vitest';

import { normalizeMarketOverview } from './marketOverview';
import type { MarketDataPoint } from './types';

const PREFILL_OK = {
  indices: [
    { name: 'S&P 500', value: 4500, change: 20, changePercent: 0.45 },
  ] as MarketDataPoint[],
  exchangeRates: [
    { name: 'JPY/KRW', value: 9.32, change: 0, changePercent: 0 },
  ] as MarketDataPoint[],
  commodities: [
    { name: '금 (Gold)', value: 2400, change: 5, changePercent: 0.21 },
  ] as MarketDataPoint[],
};

describe('normalizeMarketOverview — prefill overlay (ADR-0061 §3)', () => {
  it('prefillOverlay 미전달 시 기존 동작 유지 (raw spread 그대로)', () => {
    const raw = {
      indices: [{ name: 'X', value: 1, change: 0, changePercent: 0 }],
      exchangeRates: [{ name: 'Y', value: 2, change: 0, changePercent: 0 }],
      commodities: [{ name: 'Z', value: 3, change: 0, changePercent: 0 }],
      summary: 'baseline',
      lastUpdated: '2026-04-27T00:00:00.000Z',
    };
    const out = normalizeMarketOverview(raw);
    expect(out.indices).toEqual(raw.indices);
    expect(out.exchangeRates).toEqual(raw.exchangeRates);
    expect(out.commodities).toEqual(raw.commodities);
    expect(out.summary).toBe('baseline');
  });

  it('prefillOverlay 전달 시 AI 응답의 indices/exchangeRates/commodities 를 *완전히* 덮어쓴다', () => {
    const aiHallucinated = {
      indices: [{ name: 'S&P 500', value: 9999, change: 100, changePercent: 1.0 }],
      exchangeRates: [{ name: 'JPY/KRW', value: 99, change: 0, changePercent: 0 }],
      commodities: [{ name: '금 (Gold)', value: 9999, change: 0, changePercent: 0 }],
      summary: 'AI hallucinated prices above',
      lastUpdated: '2026-04-27T00:00:00.000Z',
    };
    const out = normalizeMarketOverview(aiHallucinated, PREFILL_OK);
    expect(out.indices[0].value).toBe(4500); // AI 의 9999 가 아닌 prefill 의 4500
    expect(out.exchangeRates[0].value).toBe(9.32);
    expect(out.commodities[0].value).toBe(2400);
    // summary / lastUpdated 등 AI 가 답한 *분석* 필드는 그대로 유지
    expect(out.summary).toBe('AI hallucinated prices above');
  });

  it('prefill 카테고리가 빈 배열이면 AI 응답 fallback (모든 심볼 fetch 실패 시)', () => {
    const aiResponse = {
      indices: [{ name: 'S&P 500', value: 4500, change: 0, changePercent: 0 }],
      exchangeRates: [{ name: 'JPY/KRW', value: 9.32, change: 0, changePercent: 0 }],
      commodities: [{ name: '금', value: 2400, change: 0, changePercent: 0 }],
      summary: 'fallback',
      lastUpdated: '2026-04-27T00:00:00.000Z',
    };
    const out = normalizeMarketOverview(aiResponse, {
      indices: [], exchangeRates: [], commodities: [],
    });
    expect(out.indices).toEqual(aiResponse.indices); // AI fallback
    expect(out.exchangeRates).toEqual(aiResponse.exchangeRates);
    expect(out.commodities).toEqual(aiResponse.commodities);
  });

  it('sectorRotation flat 배열 → { topSectors: [...] } 변환 (기존 동작 보존)', () => {
    const raw = {
      sectorRotation: [
        { sector: '반도체', momentum: 85, flow: 'INFLOW' },
        { sector: '이차전지', momentum: 40, flow: 'OUTFLOW' },
      ],
      summary: '', lastUpdated: '',
    };
    const out = normalizeMarketOverview(raw);
    expect(out.sectorRotation?.topSectors).toHaveLength(2);
    expect(out.sectorRotation?.topSectors[0].name).toBe('반도체');
    expect(out.sectorRotation?.topSectors[0].strength).toBe(85);
    expect(out.sectorRotation?.topSectors[0].isLeading).toBe(true);
  });

  it('regimeShiftDetector { current, probability, signal } → { currentRegime, shiftProbability, leadingIndicator } 변환', () => {
    const raw = {
      regimeShiftDetector: { current: 'BULL', probability: 85, signal: 'BUY' },
      summary: '', lastUpdated: '',
    };
    const out = normalizeMarketOverview(raw);
    expect(out.regimeShiftDetector?.currentRegime).toBe('BULL');
    expect(out.regimeShiftDetector?.shiftProbability).toBe(0.85); // 85 / 100
    expect(out.regimeShiftDetector?.leadingIndicator).toBe('BUY');
  });

  it('overlay + sectorRotation 변환 동시 적용 (혼합 케이스)', () => {
    const raw = {
      indices: [{ name: 'X', value: 9999, change: 0, changePercent: 0 }],
      exchangeRates: [],
      commodities: [],
      sectorRotation: [{ sector: '반도체', momentum: 85, flow: 'INFLOW' }],
      summary: 'mixed',
      lastUpdated: '',
    };
    const out = normalizeMarketOverview(raw, PREFILL_OK);
    expect(out.indices[0].value).toBe(4500); // overlay
    expect(out.sectorRotation?.topSectors).toHaveLength(1); // 변환
    expect(out.summary).toBe('mixed');
  });
});
