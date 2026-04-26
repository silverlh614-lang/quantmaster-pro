/**
 * @responsibility evaluateEnemyChecklist 단위 테스트 — ADR-0021 PR-D
 */
import { describe, it, expect } from 'vitest';
import { evaluateEnemyChecklist } from './enemyChecklistFlag';
import type { StockRecommendation } from '../services/stockService';

function makeStock(opts: {
  shortTrend?: 'INCREASING' | 'DECREASING';
} = {}): StockRecommendation {
  return {
    code: 'X', name: 'X', currentPrice: 100, type: 'NEUTRAL',
    targetPrice: 110, stopLoss: 90,
    checklist: {} as StockRecommendation['checklist'],
    visualReport: { financial: 0, technical: 0, supply: 0, summary: '' },
    historicalAnalogy: { stockName: '', period: '', similarity: 0, reason: '' },
    anomalyDetection: { type: 'NONE', score: 0, description: '' },
    semanticMapping: { theme: '', keywords: [], relevanceScore: 0, description: '' },
    shortSelling: opts.shortTrend
      ? { ratio: 5, trend: opts.shortTrend, implication: '' }
      : undefined,
  } as unknown as StockRecommendation;
}

describe('evaluateEnemyChecklist — ADR-0021 3-플래그 평가', () => {
  it('0 WARNING → CLEAR', () => {
    const r = evaluateEnemyChecklist({
      stock: makeStock({ shortTrend: 'DECREASING' }),
      marginBalance5dChange: 2,
      weeklyRsi: 55,
    });
    expect(r.warningCount).toBe(0);
    expect(r.verdict).toBe('CLEAR');
    expect(r.flags.every(f => f.status === 'CLEAR')).toBe(true);
  });

  it('공매도 잔고 증가만 WARNING → CAUTION', () => {
    const r = evaluateEnemyChecklist({
      stock: makeStock({ shortTrend: 'INCREASING' }),
      marginBalance5dChange: 2,
      weeklyRsi: 55,
    });
    expect(r.warningCount).toBe(1);
    expect(r.verdict).toBe('CAUTION');
    expect(r.flags.find(f => f.id === 'SHORT_INCREASING')?.status).toBe('WARNING');
  });

  it('공매도 + 신용잔고 과열 → BLOCK (≥2 WARNING)', () => {
    const r = evaluateEnemyChecklist({
      stock: makeStock({ shortTrend: 'INCREASING' }),
      marginBalance5dChange: 7,
      weeklyRsi: 55,
    });
    expect(r.warningCount).toBe(2);
    expect(r.verdict).toBe('BLOCK');
  });

  it('3개 모두 WARNING → BLOCK', () => {
    const r = evaluateEnemyChecklist({
      stock: makeStock({ shortTrend: 'INCREASING' }),
      marginBalance5dChange: 10,
      weeklyRsi: 75,
    });
    expect(r.warningCount).toBe(3);
    expect(r.verdict).toBe('BLOCK');
    expect(r.flags.every(f => f.status === 'WARNING')).toBe(true);
  });

  it('주봉 RSI 정확히 70 → WARNING (≥ 70 과열)', () => {
    const r = evaluateEnemyChecklist({
      stock: makeStock({ shortTrend: 'DECREASING' }),
      marginBalance5dChange: 0,
      weeklyRsi: 70,
    });
    expect(r.flags.find(f => f.id === 'WEEKLY_RSI_OVERHEAT')?.status).toBe('WARNING');
  });

  it('주봉 RSI 69.9 → CLEAR (< 70)', () => {
    const r = evaluateEnemyChecklist({
      stock: makeStock({ shortTrend: 'DECREASING' }),
      marginBalance5dChange: 0,
      weeklyRsi: 69.9,
    });
    expect(r.flags.find(f => f.id === 'WEEKLY_RSI_OVERHEAT')?.status).toBe('CLEAR');
  });

  it('신용잔고 정확히 5% → WARNING (≥ 5)', () => {
    const r = evaluateEnemyChecklist({
      stock: makeStock({ shortTrend: 'DECREASING' }),
      marginBalance5dChange: 5,
      weeklyRsi: 50,
    });
    expect(r.flags.find(f => f.id === 'MARGIN_OVERHEAT')?.status).toBe('WARNING');
  });

  it('신용잔고 4.9% → CLEAR (< 5)', () => {
    const r = evaluateEnemyChecklist({
      stock: makeStock({ shortTrend: 'DECREASING' }),
      marginBalance5dChange: 4.9,
      weeklyRsi: 50,
    });
    expect(r.flags.find(f => f.id === 'MARGIN_OVERHEAT')?.status).toBe('CLEAR');
  });

  it('데이터 부재 (모두 undefined) → 모두 CLEAR (안전 fallback)', () => {
    const r = evaluateEnemyChecklist({
      stock: makeStock(), // shortSelling undefined
      marginBalance5dChange: undefined,
      weeklyRsi: undefined,
    });
    expect(r.warningCount).toBe(0);
    expect(r.verdict).toBe('CLEAR');
    expect(r.flags.every(f => f.status === 'CLEAR')).toBe(true);
    expect(r.flags.find(f => f.id === 'SHORT_INCREASING')?.detail).toContain('미수신');
    expect(r.flags.find(f => f.id === 'MARGIN_OVERHEAT')?.detail).toContain('미수신');
    expect(r.flags.find(f => f.id === 'WEEKLY_RSI_OVERHEAT')?.detail).toContain('미수신');
  });

  it('NaN/Infinity → 안전 fallback (미수신 처리)', () => {
    const r = evaluateEnemyChecklist({
      stock: makeStock({ shortTrend: 'DECREASING' }),
      marginBalance5dChange: NaN,
      weeklyRsi: Infinity,
    });
    expect(r.warningCount).toBe(0);
    expect(r.flags.find(f => f.id === 'MARGIN_OVERHEAT')?.detail).toContain('미수신');
    expect(r.flags.find(f => f.id === 'WEEKLY_RSI_OVERHEAT')?.detail).toContain('미수신');
  });

  it('모든 detail 메시지 형식', () => {
    const r = evaluateEnemyChecklist({
      stock: makeStock({ shortTrend: 'INCREASING' }),
      marginBalance5dChange: 6.5,
      weeklyRsi: 75,
    });
    expect(r.flags.find(f => f.id === 'SHORT_INCREASING')?.detail).toContain('증가 추세');
    expect(r.flags.find(f => f.id === 'MARGIN_OVERHEAT')?.detail).toContain('6.5%');
    expect(r.flags.find(f => f.id === 'MARGIN_OVERHEAT')?.detail).toContain('과열');
    expect(r.flags.find(f => f.id === 'WEEKLY_RSI_OVERHEAT')?.detail).toContain('75');
  });
});
