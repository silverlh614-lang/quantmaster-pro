/**
 * @responsibility filterStocksBySector + stockMatchesSector 단위 테스트 — PR-K
 */
import { describe, it, expect } from 'vitest';
import { stockMatchesSector, filterStocksBySector } from './sectorStockMatch';
import type { StockRecommendation } from '../services/stockService';

function makeStock(code: string, sectors: string[]): StockRecommendation {
  return {
    code, name: `s${code}`, currentPrice: 100, type: 'NEUTRAL',
    targetPrice: 110, stopLoss: 90,
    relatedSectors: sectors,
    checklist: {} as StockRecommendation['checklist'],
    visualReport: { financial: 0, technical: 0, supply: 0, summary: '' },
    historicalAnalogy: { stockName: '', period: '', similarity: 0, reason: '' },
    anomalyDetection: { type: 'NONE', score: 0, description: '' },
    semanticMapping: { theme: '', keywords: [], relevanceScore: 0, description: '' },
  } as unknown as StockRecommendation;
}

describe('stockMatchesSector — PR-K', () => {
  it('정확 일치', () => {
    expect(stockMatchesSector(makeStock('1', ['반도체']), '반도체')).toBe(true);
  });

  it('대소문자 무시', () => {
    expect(stockMatchesSector(makeStock('1', ['Semiconductor']), 'semiconductor')).toBe(true);
  });

  it('부분 포함 (양방향)', () => {
    expect(stockMatchesSector(makeStock('1', ['조선·해운']), '조선')).toBe(true);
    expect(stockMatchesSector(makeStock('1', ['조선']), '조선·해운')).toBe(true);
  });

  it('미매칭 sector', () => {
    expect(stockMatchesSector(makeStock('1', ['반도체']), '바이오')).toBe(false);
  });

  it('null stock → false', () => {
    expect(stockMatchesSector(null, '반도체')).toBe(false);
  });

  it('빈 sectorName → false', () => {
    expect(stockMatchesSector(makeStock('1', ['반도체']), '')).toBe(false);
    expect(stockMatchesSector(makeStock('1', ['반도체']), '   ')).toBe(false);
  });

  it('빈 relatedSectors → false', () => {
    expect(stockMatchesSector(makeStock('1', []), '반도체')).toBe(false);
  });

  it('relatedSectors 가 배열이 아니면 → false', () => {
    const bad = makeStock('1', ['반도체']);
    (bad as unknown as { relatedSectors: unknown }).relatedSectors = 'not array';
    expect(stockMatchesSector(bad, '반도체')).toBe(false);
  });
});

describe('filterStocksBySector — PR-K', () => {
  const stocks = [
    makeStock('1', ['반도체']),
    makeStock('2', ['바이오']),
    makeStock('3', ['반도체', 'AI']),
    makeStock('4', ['조선·해운']),
    makeStock('5', ['조선']),
  ];

  it('섹터 필터 — 부분 포함 + 정확 일치 통합', () => {
    const r = filterStocksBySector(stocks, '반도체');
    expect(r.map(s => s.code).sort()).toEqual(['1', '3']);
  });

  it('섹터명 부분 포함 (조선 → 조선·해운 + 조선)', () => {
    const r = filterStocksBySector(stocks, '조선');
    expect(r.map(s => s.code).sort()).toEqual(['4', '5']);
  });

  it('미매칭 섹터 → 빈 배열', () => {
    expect(filterStocksBySector(stocks, '에너지')).toEqual([]);
  });

  it('중복 code 제거 (dedupe)', () => {
    const dup = [makeStock('1', ['반도체']), makeStock('1', ['반도체']), makeStock('3', ['반도체'])];
    const r = filterStocksBySector(dup, '반도체');
    expect(r).toHaveLength(2);
  });

  it('빈 stocks → 빈 결과', () => {
    expect(filterStocksBySector([], '반도체')).toEqual([]);
  });
});

describe('stockMatchesSector — sector 단일 필드 fallback (ADR-0060 §3.1)', () => {
  /** ShadowTrade-shaped 매칭 후보 (relatedSectors 미보유, sector 단일 필드) */
  function makeShadowLike(code: string, sector?: string) {
    return { code, name: `s${code}`, sector };
  }

  it('stock.sector 단일 필드 매칭 — relatedSectors 부재 fallback', () => {
    expect(stockMatchesSector(makeShadowLike('1', '반도체'), '반도체')).toBe(true);
    expect(stockMatchesSector(makeShadowLike('1', '조선·해운'), '조선')).toBe(true);
    expect(stockMatchesSector(makeShadowLike('1', '반도체'), '바이오')).toBe(false);
    expect(stockMatchesSector(makeShadowLike('1'), '반도체')).toBe(false); // sector undefined
    expect(stockMatchesSector(makeShadowLike('1', ''), '반도체')).toBe(false); // sector 빈 문자열
  });

  it('relatedSectors 우선순위 — relatedSectors 매칭 시 sector 단일 무시', () => {
    // relatedSectors=['반도체'] + sector='바이오' — relatedSectors 매칭이 먼저 성공
    const stock = {
      code: '1',
      name: 's1',
      relatedSectors: ['반도체'],
      sector: '바이오',
    };
    expect(stockMatchesSector(stock, '반도체')).toBe(true);
    // 둘 다 매칭 안 됨
    expect(stockMatchesSector(stock, '에너지')).toBe(false);
    // relatedSectors 미매칭이지만 sector 단일 매칭 → fallback 작동
    expect(stockMatchesSector(stock, '바이오')).toBe(true);
  });

  it('filterStocksBySector dedupe — relatedSectors 와 sector 양쪽 매칭 시 중복 없음', () => {
    // 동일 code 의 두 객체: 하나는 relatedSectors 매칭, 다른 하나는 sector 매칭
    // dedupe (code 기준) 로 한 건만 결과에 포함
    const items = [
      { code: '1', name: 's1', relatedSectors: ['반도체'] },
      { code: '1', name: 's1-dup', sector: '반도체' },
      { code: '2', name: 's2', sector: '반도체' },
    ];
    const r = filterStocksBySector(items, '반도체');
    expect(r).toHaveLength(2);
    expect(r.map(s => s.code).sort()).toEqual(['1', '2']);
    // 첫 항목이 우선 (Set seen 기반)
    expect(r[0].name).toBe('s1');
  });
});
