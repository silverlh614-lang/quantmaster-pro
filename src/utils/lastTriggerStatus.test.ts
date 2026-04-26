/**
 * @responsibility evaluateLastTrigger 단위 테스트 — ADR-0021 PR-D
 */
import { describe, it, expect } from 'vitest';
import { evaluateLastTrigger } from './lastTriggerStatus';
import type { StockRecommendation } from '../services/stockService';

const PASS = 7;
const FAIL = 3;

function makeStock(opts: { vcp?: number; volume?: number } = {}): StockRecommendation {
  return {
    code: 'X', name: 'X', currentPrice: 100, type: 'NEUTRAL',
    targetPrice: 110, stopLoss: 90,
    checklist: {
      vcpPattern: opts.vcp ?? FAIL,
      volumeSurgeVerified: opts.volume ?? FAIL,
    } as StockRecommendation['checklist'],
    visualReport: { financial: 0, technical: 0, supply: 0, summary: '' },
    historicalAnalogy: { stockName: '', period: '', similarity: 0, reason: '' },
    anomalyDetection: { type: 'NONE', score: 0, description: '' },
    semanticMapping: { theme: '', keywords: [], relevanceScore: 0, description: '' },
  } as unknown as StockRecommendation;
}

describe('evaluateLastTrigger — ADR-0021 4-체크 평가', () => {
  it('4/4 충족 → EXECUTE', () => {
    const r = evaluateLastTrigger({
      stock: makeStock({ vcp: PASS, volume: PASS }),
      vkospi: 18,
      recentPositiveDisclosure: true,
    });
    expect(r.triggeredCount).toBe(4);
    expect(r.totalChecks).toBe(4);
    expect(r.verdict).toBe('EXECUTE');
    expect(r.checks.every(c => c.status === 'TRIGGERED')).toBe(true);
  });

  it('3/4 충족 → WATCHLIST', () => {
    const r = evaluateLastTrigger({
      stock: makeStock({ vcp: PASS, volume: PASS }),
      vkospi: 18,
      recentPositiveDisclosure: false,
    });
    expect(r.triggeredCount).toBe(3);
    expect(r.verdict).toBe('WATCHLIST');
  });

  it('1/4 충족 → WATCHLIST (>=1 도 WATCHLIST)', () => {
    const r = evaluateLastTrigger({
      stock: makeStock({ vcp: PASS, volume: FAIL }),
      vkospi: 30,
      recentPositiveDisclosure: false,
    });
    expect(r.triggeredCount).toBe(1);
    expect(r.verdict).toBe('WATCHLIST');
  });

  it('0/4 충족 → INACTIVE', () => {
    const r = evaluateLastTrigger({
      stock: makeStock({ vcp: FAIL, volume: FAIL }),
      vkospi: 30,
      recentPositiveDisclosure: false,
    });
    expect(r.triggeredCount).toBe(0);
    expect(r.verdict).toBe('INACTIVE');
  });

  it('VKOSPI 정확히 25 → PENDING (< 25 만 안정)', () => {
    const r = evaluateLastTrigger({
      stock: makeStock({ vcp: PASS, volume: PASS }),
      vkospi: 25,
      recentPositiveDisclosure: true,
    });
    const vkospiCheck = r.checks.find(c => c.id === 'VKOSPI_STABLE');
    expect(vkospiCheck?.status).toBe('PENDING');
  });

  it('VKOSPI 24.9 → TRIGGERED (안정 경계)', () => {
    const r = evaluateLastTrigger({
      stock: makeStock({ vcp: PASS, volume: PASS }),
      vkospi: 24.9,
      recentPositiveDisclosure: true,
    });
    const vkospiCheck = r.checks.find(c => c.id === 'VKOSPI_STABLE');
    expect(vkospiCheck?.status).toBe('TRIGGERED');
  });

  it('VKOSPI null/undefined → PENDING + detail 미수신 표시', () => {
    const r = evaluateLastTrigger({
      stock: makeStock({ vcp: PASS, volume: PASS }),
      vkospi: null,
      recentPositiveDisclosure: true,
    });
    const vkospiCheck = r.checks.find(c => c.id === 'VKOSPI_STABLE');
    expect(vkospiCheck?.status).toBe('PENDING');
    expect(vkospiCheck?.detail).toContain('미수신');
  });

  it('체크리스트 점수 < 5 → PENDING (CONDITION_PASS_THRESHOLD)', () => {
    const r = evaluateLastTrigger({
      stock: makeStock({ vcp: 4, volume: 4 }),
      vkospi: 18,
      recentPositiveDisclosure: true,
    });
    expect(r.checks.find(c => c.id === 'VCP_BREAKOUT')?.status).toBe('PENDING');
    expect(r.checks.find(c => c.id === 'VOLUME_SURGE')?.status).toBe('PENDING');
    expect(r.triggeredCount).toBe(2); // VKOSPI + Disclosure 만
    expect(r.verdict).toBe('WATCHLIST');
  });

  it('VKOSPI=NaN → PENDING (안전 fallback)', () => {
    const r = evaluateLastTrigger({
      stock: makeStock({ vcp: PASS, volume: PASS }),
      vkospi: NaN,
      recentPositiveDisclosure: true,
    });
    expect(r.checks.find(c => c.id === 'VKOSPI_STABLE')?.status).toBe('PENDING');
  });

  it('각 체크 detail 메시지 — TRIGGERED vs PENDING 구분', () => {
    const r = evaluateLastTrigger({
      stock: makeStock({ vcp: PASS, volume: FAIL }),
      vkospi: 18,
      recentPositiveDisclosure: false,
    });
    expect(r.checks.find(c => c.id === 'VCP_BREAKOUT')?.detail).toContain('박스 상단');
    expect(r.checks.find(c => c.id === 'VOLUME_SURGE')?.detail).toContain('미증가');
    expect(r.checks.find(c => c.id === 'POSITIVE_DISCLOSURE')?.detail).toContain('없음');
  });
});
