// @responsibility buildMockShadowSignal 회귀 테스트 (cc 분해 검증)
import { describe, it, expect } from 'vitest';
import { buildMockShadowSignal } from './buildMockShadowSignal';
import type { StockRecommendation } from '../../../services/stockService';

function buildStock(over: Partial<StockRecommendation>): StockRecommendation {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return { code: '005930', name: 'X', type: 'BUY', confidenceScore: 70, ...over } as any;
}

describe('buildMockShadowSignal', () => {
  it('confidenceScore >= 80 시 positionSize 20', () => {
    const out = buildMockShadowSignal(buildStock({ confidenceScore: 80 })) as Record<string, unknown>;
    expect(out.positionSize).toBe(20);
  });

  it('confidenceScore < 80 시 절반 10%', () => {
    const out = buildMockShadowSignal(buildStock({ confidenceScore: 70 })) as Record<string, unknown>;
    expect(out.positionSize).toBe(10);
  });

  it('confidenceScore=undefined 시 절반 10% (falsy)', () => {
    const out = buildMockShadowSignal(buildStock({ confidenceScore: undefined })) as Record<string, unknown>;
    expect(out.positionSize).toBe(10);
  });

  it('type=STRONG_BUY 시 lastTrigger=true', () => {
    const out = buildMockShadowSignal(buildStock({ type: 'STRONG_BUY' })) as Record<string, unknown>;
    expect(out.lastTrigger).toBe(true);
  });

  it('type!=STRONG_BUY 시 lastTrigger=false', () => {
    const out = buildMockShadowSignal(buildStock({ type: 'BUY' })) as Record<string, unknown>;
    expect(out.lastTrigger).toBe(false);
  });

  it('STRONG_BUY 시 recommendation 풀 포지션 (positionSize 20% 와 함께)', () => {
    const out = buildMockShadowSignal(
      buildStock({ confidenceScore: 90, type: 'STRONG_BUY' })
    ) as Record<string, unknown>;
    expect(out.recommendation).toBe('풀 포지션');
  });

  it('BUY 시 recommendation 절반 포지션', () => {
    const out = buildMockShadowSignal(
      buildStock({ confidenceScore: 70, type: 'BUY' })
    ) as Record<string, unknown>;
    expect(out.recommendation).toBe('절반 포지션');
  });

  it('profile.stopLoss 항상 -8 고정', () => {
    const out = buildMockShadowSignal(buildStock({})) as Record<string, unknown>;
    expect((out.profile as { stopLoss: number }).stopLoss).toBe(-8);
  });

  it('rrr 항상 2 고정', () => {
    const out = buildMockShadowSignal(buildStock({})) as Record<string, unknown>;
    expect(out.rrr).toBe(2);
  });
});
