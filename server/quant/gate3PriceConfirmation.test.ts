import { describe, expect, it } from 'vitest';
import { buildGate3PriceConfirmation } from './gate3PriceConfirmation.js';

describe('buildGate3PriceConfirmation', () => {
  it('classifies breakout confirmed above the 20-day high buffer', () => {
    const result = buildGate3PriceConfirmation({
      currentPrice: 10_030,
      high20d: 10_000,
      ma20: 9_700,
    });

    expect(result.status).toBe('BREAKOUT_CONFIRMED');
    expect(result.distanceToHigh20dPct).toBeCloseTo(0.3, 5);
    expect(result.marketSignal).toBe(false);
  });

  it('classifies near breakout before confirmation', () => {
    const result = buildGate3PriceConfirmation({
      currentPrice: 9_900,
      high20d: 10_000,
      ma20: 9_650,
    });

    expect(result.status).toBe('NEAR_BREAKOUT');
  });

  it('classifies pullback entry near the 20-day baseline', () => {
    const result = buildGate3PriceConfirmation({
      currentPrice: 10_200,
      high20d: 11_000,
      ma20: 10_000,
    });

    expect(result.status).toBe('PULLBACK_ENTRY');
  });

  it('classifies not confirmed when no breakout or pullback setup exists', () => {
    const result = buildGate3PriceConfirmation({
      currentPrice: 9_000,
      high20d: 10_000,
      ma20: 8_500,
    });

    expect(result.status).toBe('NOT_CONFIRMED');
  });

  it('classifies overextended before chasing a stretched price', () => {
    const result = buildGate3PriceConfirmation({
      currentPrice: 11_300,
      high20d: 12_000,
      ma20: 10_000,
    });

    expect(result.status).toBe('OVEREXTENDED');
    expect(result.extensionFromMa20Pct).toBeCloseTo(13, 5);
  });

  it('keeps missing price as data unavailable, not failed timing', () => {
    const result = buildGate3PriceConfirmation({
      high20d: 10_000,
      ma20: 9_500,
    });

    expect(result.status).toBe('DATA_UNAVAILABLE');
    expect(result.missingFields).toContain('currentPrice');
    expect(result.marketSignal).toBe(false);
  });
});
