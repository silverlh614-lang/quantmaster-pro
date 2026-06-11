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

describe('buildGate3PriceConfirmation — ADR-0598 G2 이격 검증불가 보수화', () => {
  it('flag OFF(default) + ma20 결손 + 돌파 → BREAKOUT_CONFIRMED 유지 + observe note (byte-equivalent)', () => {
    const result = buildGate3PriceConfirmation(
      { currentPrice: 171_500, high20d: 160_000 },
      {},
    );
    expect(result.status).toBe('BREAKOUT_CONFIRMED');
    expect(result.notes).toContain('EXTENSION_UNVERIFIABLE_MA20_MISSING_OBSERVE');
    expect(result.missingFields).toContain('ma20');
  });

  it('flag ON + ma20 결손 + 돌파 → NOT_CONFIRMED (확정 보류, live 차단) + strict note', () => {
    const result = buildGate3PriceConfirmation(
      { currentPrice: 171_500, high20d: 160_000 },
      { GATE3_EXTENSION_GUARD_STRICT_ENABLED: 'true' },
    );
    expect(result.status).toBe('NOT_CONFIRMED');
    expect(result.notes).toContain('BREAKOUT_EXTENSION_UNVERIFIABLE_MA20_MISSING_STRICT_BLOCK');
    expect(result.missingFields).toContain('ma20');
    expect(result.marketSignal).toBe(false);
  });

  it('flag ON + ma20 존재 + 돌파(이격 <12%) → BREAKOUT_CONFIRMED 불변 (보수화는 결손 시에만)', () => {
    const result = buildGate3PriceConfirmation(
      { currentPrice: 161_000, high20d: 160_000, ma20: 150_000 },
      { GATE3_EXTENSION_GUARD_STRICT_ENABLED: 'true' },
    );
    expect(result.status).toBe('BREAKOUT_CONFIRMED');
    expect(result.notes).not.toContain('BREAKOUT_EXTENSION_UNVERIFIABLE_MA20_MISSING_STRICT_BLOCK');
  });

  it('flag ON + ma20 존재 + 이격 >=12% → 기존 OVEREXTENDED 우선 (strict 분기 미도달)', () => {
    const result = buildGate3PriceConfirmation(
      { currentPrice: 171_500, high20d: 160_000, ma20: 150_000 },
      { GATE3_EXTENSION_GUARD_STRICT_ENABLED: 'true' },
    );
    expect(result.status).toBe('OVEREXTENDED');
  });
});
