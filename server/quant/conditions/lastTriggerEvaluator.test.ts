import { describe, expect, it } from 'vitest';
import { DEFAULT_CONDITION_WEIGHTS } from '../../quantFilter.js';
import { lastTriggerEvaluator } from './lastTriggerEvaluator.js';
import type { ConditionEvalContext } from './types.js';

function ctx(overrides: Record<string, unknown> = {}): ConditionEvalContext {
  return {
    quote: {
      price: 10_000,
      currentPrice: 10_000,
      high5d: 9_950,
      high20d: 9_900,
      volume: 2_500_000,
      avgVolume: 1_000_000,
      rsi14: 58,
      macdHistogram: 0.4,
      macd5dHistAgo: -0.1,
      rrr: 2.4,
      entryPriceAgeSec: 20,
      falseBreakoutRisk: 'LOW',
      ...overrides,
    } as unknown as ConditionEvalContext['quote'],
    weights: DEFAULT_CONDITION_WEIGHTS,
  };
}

describe('lastTriggerEvaluator', () => {
  it('all positive -> FIRED', () => {
    const result = lastTriggerEvaluator.evaluate(ctx());
    expect(result?.status).toBe('FIRED');
    expect(result?.score).toBe(DEFAULT_CONDITION_WEIGHTS.last_trigger);
  });

  it('stale price -> THRESHOLD_NOT_MET and live-only block semantics', () => {
    const result = lastTriggerEvaluator.evaluate(ctx({ entryPriceAgeSec: 90 }));
    expect(result?.status).toBe('THRESHOLD_NOT_MET');
    expect(result?.detail).toContain('ENTRY_PRICE_STALE');
  });

  it('RRR below 2.0 -> THRESHOLD_NOT_MET', () => {
    const result = lastTriggerEvaluator.evaluate(ctx({ rrr: 1.6 }));
    expect(result?.status).toBe('THRESHOLD_NOT_MET');
    expect(result?.detail).toContain('RRR_BELOW_2_0');
  });

  it('falseBreakoutRisk HIGH -> THRESHOLD_NOT_MET', () => {
    const result = lastTriggerEvaluator.evaluate(ctx({ falseBreakoutRisk: 'HIGH' }));
    expect(result?.status).toBe('THRESHOLD_NOT_MET');
    expect(result?.detail).toContain('FALSE_BREAKOUT_HIGH');
  });

  it('missing price -> DATA_UNAVAILABLE', () => {
    const result = lastTriggerEvaluator.evaluate(ctx({ price: undefined, currentPrice: undefined }));
    expect(result?.status).toBe('DATA_UNAVAILABLE');
    expect(result?.detail).toContain('PRICE_MISSING');
  });
});
