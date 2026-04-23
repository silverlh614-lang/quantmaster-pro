import { describe, it, expect } from 'vitest';
import { composeEffectiveKelly, TIER_KELLY_FACTOR, GRADE_UPPER_CAP } from './sizingTier.js';

describe('composeEffectiveKelly (Idea 7 안A)', () => {
  it('CONVICTION × STRONG_BUY · raw 0.3 → 0.3 (캡 미달)', () => {
    const r = composeEffectiveKelly('CONVICTION', 'STRONG_BUY', 0.3);
    expect(r.tierFactor).toBe(TIER_KELLY_FACTOR.CONVICTION);
    expect(r.gradeCap).toBe(GRADE_UPPER_CAP.STRONG_BUY);
    expect(r.effectiveKelly).toBe(0.3);
    expect(r.wasCapped).toBe(false);
  });

  it('CONVICTION × STRONG_BUY · raw 0.8 → 0.5 (STRONG_BUY cap)', () => {
    const r = composeEffectiveKelly('CONVICTION', 'STRONG_BUY', 0.8);
    expect(r.effectiveKelly).toBe(0.5);
    expect(r.wasCapped).toBe(true);
  });

  it('STANDARD × BUY · raw 0.3 → 0.25 (BUY cap)', () => {
    const r = composeEffectiveKelly('STANDARD', 'BUY', 0.3);
    expect(r.effectiveKelly).toBe(0.25);
    expect(r.wasCapped).toBe(true);
  });

  it('PROBING × PROBING · raw 0.05 → 0.05 (캡 미달)', () => {
    const r = composeEffectiveKelly('PROBING', 'PROBING', 0.05);
    expect(r.effectiveKelly).toBe(0.05);
    expect(r.wasCapped).toBe(false);
  });

  it('음수 raw 는 0 으로 clamp', () => {
    const r = composeEffectiveKelly('STANDARD', 'BUY', -0.1);
    expect(r.effectiveKelly).toBe(0);
  });
});
