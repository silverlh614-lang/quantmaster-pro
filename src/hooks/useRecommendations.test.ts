/**
 * useRecommendations.test.ts — Phase 5-⑬ 리프 노드 파생 훅 회귀.
 * 훅의 순수 파생 로직을 computeRecommendationsDerived() 로 직접 검증.
 */

import { describe, it, expect } from 'vitest';
import { computeRecommendationsDerived, type RecommendationFilterInput } from './useRecommendations';
import type { StockRecommendation } from '../services/stockService';

function stock(code: string, overrides: Partial<StockRecommendation> = {}): StockRecommendation {
  return {
    code, name: `종목${code}`, type: 'MOMENTUM',
    currentPrice: 10_000, entryPrice: 9_500, stopLoss: 9_000, targetPrice: 11_000,
    peakPrice: 10_500, confidenceScore: 70,
    patterns: [], relatedSectors: ['반도체'],
    ...overrides,
  } as unknown as StockRecommendation;
}

const baseInput: RecommendationFilterInput = {
  recommendations: [stock('005930'), stock('000660'), stock('035720')],
  searchResults: [],
  watchlist: [],
  selectedType: 'ALL',
  selectedPattern: 'ALL',
  selectedSentiment: 'ALL',
  selectedChecklist: [],
  searchQuery: '',
  minPrice: '',
  maxPrice: '',
  sortBy: 'NONE',
  view: 'DISCOVER',
};

describe('useRecommendations — 파생 필터링', () => {
  it('기본 — 모두 통과', () => {
    const r = computeRecommendationsDerived(baseInput);
    expect(r.filteredRecommendations).toHaveLength(3);
    expect(r.displayList).toHaveLength(3);
  });

  it('selectedType=SWING → SWING 만 통과', () => {
    const input: RecommendationFilterInput = {
      ...baseInput,
      recommendations: [
        stock('005930', { type: 'MOMENTUM' as any }),
        stock('000660', { type: 'SWING' as any }),
      ],
      selectedType: 'SWING',
    };
    const r = computeRecommendationsDerived(input);
    expect(r.filteredRecommendations).toHaveLength(1);
    expect(r.filteredRecommendations[0].code).toBe('000660');
  });

  it('가격 범위 필터 — minPrice 10000 → 현재가 ≥ 10000', () => {
    const input: RecommendationFilterInput = {
      ...baseInput,
      recommendations: [
        stock('A', { currentPrice: 8_000 }),
        stock('B', { currentPrice: 12_000 }),
      ],
      minPrice: '10000',
    };
    const r = computeRecommendationsDerived(input);
    expect(r.filteredRecommendations).toHaveLength(1);
    expect(r.filteredRecommendations[0].code).toBe('B');
  });

  it('searchQuery 이름 매칭', () => {
    const input: RecommendationFilterInput = {
      ...baseInput,
      recommendations: [
        stock('A', { name: '삼성전자' }),
        stock('B', { name: 'SK하이닉스' }),
      ],
      searchQuery: '삼성',
    };
    const r = computeRecommendationsDerived(input);
    expect(r.filteredRecommendations).toHaveLength(1);
    expect(r.filteredRecommendations[0].name).toBe('삼성전자');
  });
});

describe('useRecommendations — 정렬', () => {
  it('sortBy=NAME — 이름 가나다', () => {
    const input: RecommendationFilterInput = {
      ...baseInput,
      recommendations: [
        stock('A', { name: '하이닉스' }),
        stock('B', { name: '가온' }),
        stock('C', { name: '네이버' }),
      ],
      sortBy: 'NAME',
    };
    const r = computeRecommendationsDerived(input);
    expect(r.displayList.map((s) => s.name)).toEqual(['가온', '네이버', '하이닉스']);
  });

  it('sortBy=PERFORMANCE — (현재가/진입가 - 1) 내림차순', () => {
    const input: RecommendationFilterInput = {
      ...baseInput,
      recommendations: [
        stock('A', { currentPrice: 10_000, entryPrice: 10_000 }),  // 0%
        stock('B', { currentPrice: 12_000, entryPrice: 10_000 }),  // +20%
        stock('C', { currentPrice: 9_000,  entryPrice: 10_000 }),  // -10%
      ],
      sortBy: 'PERFORMANCE',
    };
    const r = computeRecommendationsDerived(input);
    expect(r.displayList.map((s) => s.code)).toEqual(['B', 'A', 'C']);
  });
});

describe('useRecommendations — view 전환', () => {
  it('view=WATCHLIST → watchlist 만 표시 (recommendations 제외)', () => {
    const input: RecommendationFilterInput = {
      ...baseInput,
      recommendations: [stock('A'), stock('B')],
      watchlist: [stock('W1', { name: '관심종목1' })],
      view: 'WATCHLIST',
    };
    const r = computeRecommendationsDerived(input);
    expect(r.displayList).toHaveLength(1);
    expect(r.displayList[0].code).toBe('W1');
  });

  it('WATCHLIST + searchQuery 이름 필터', () => {
    const input: RecommendationFilterInput = {
      ...baseInput,
      watchlist: [
        stock('W1', { name: '삼성전자' }),
        stock('W2', { name: 'LG화학' }),
      ],
      view: 'WATCHLIST',
      searchQuery: 'LG',
    };
    const r = computeRecommendationsDerived(input);
    expect(r.displayList).toHaveLength(1);
    expect(r.displayList[0].name).toBe('LG화학');
  });
});

describe('useRecommendations — allPatterns 중복 제거', () => {
  it('recommendations 내 patterns 합집합', () => {
    const input: RecommendationFilterInput = {
      ...baseInput,
      recommendations: [
        stock('A', { patterns: ['돌파', '52주신고가'] as any }),
        stock('B', { patterns: ['돌파', '수급'] as any }),
      ],
    };
    const r = computeRecommendationsDerived(input);
    expect(r.allPatterns.sort()).toEqual(['52주신고가', '돌파', '수급']);
  });
});
