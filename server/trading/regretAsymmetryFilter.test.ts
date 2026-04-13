import { describe, expect, it } from 'vitest';
import {
  evaluateRegretAsymmetry,
  checkCooldownRelease,
  FOMO_SURGE_THRESHOLD_PCT,
  COOLDOWN_DURATION_MS,
} from './regretAsymmetryFilter.js';

describe('evaluateRegretAsymmetry', () => {
  it('triggers cooldown when 5d return exceeds +15%', () => {
    const now = new Date('2026-01-10T01:00:00Z');
    const result = evaluateRegretAsymmetry(16.5, 50_000, now);

    expect(result.isCooldown).toBe(true);
    expect(result.recentHigh).toBe(50_000);
    // cooldownUntil should be now + 48h
    const expectedEnd = new Date(now.getTime() + COOLDOWN_DURATION_MS).toISOString();
    expect(result.cooldownUntil).toBe(expectedEnd);
  });

  it('does not trigger cooldown when 5d return is exactly at threshold', () => {
    const result = evaluateRegretAsymmetry(FOMO_SURGE_THRESHOLD_PCT, 30_000);
    expect(result.isCooldown).toBe(false);
    expect(result.cooldownUntil).toBeUndefined();
  });

  it('does not trigger cooldown when 5d return is below threshold', () => {
    const result = evaluateRegretAsymmetry(10, 20_000);
    expect(result.isCooldown).toBe(false);
  });
});

describe('checkCooldownRelease', () => {
  it('releases cooldown after 48 hours have passed', () => {
    const cooldownUntil = new Date('2026-01-09T10:00:00Z').toISOString();
    const now           = new Date('2026-01-09T11:00:00Z'); // after expiry
    expect(checkCooldownRelease(cooldownUntil, 50_000, 48_000, now)).toBe(true);
  });

  it('keeps cooldown active before 48 hours with no sufficient pullback', () => {
    const now = new Date('2026-01-08T10:00:00Z');
    const cooldownUntil = new Date(now.getTime() + COOLDOWN_DURATION_MS).toISOString();
    // Only -2% pullback — not enough to release
    const currentPrice = Math.round(50_000 * 0.98);
    expect(checkCooldownRelease(cooldownUntil, 50_000, currentPrice, now)).toBe(false);
  });

  it('releases cooldown on -5% to -8% pullback within 48h window', () => {
    const now = new Date('2026-01-08T10:00:00Z');
    const cooldownUntil = new Date(now.getTime() + COOLDOWN_DURATION_MS).toISOString();
    // -6% pullback — within release range
    const currentPrice = Math.round(50_000 * 0.94);
    expect(checkCooldownRelease(cooldownUntil, 50_000, currentPrice, now)).toBe(true);
  });

  it('keeps cooldown if pullback is deeper than -8%', () => {
    const now = new Date('2026-01-08T10:00:00Z');
    const cooldownUntil = new Date(now.getTime() + COOLDOWN_DURATION_MS).toISOString();
    // -10% pullback — over-correction, not a healthy retracement
    const currentPrice = Math.round(50_000 * 0.90);
    expect(checkCooldownRelease(cooldownUntil, 50_000, currentPrice, now)).toBe(false);
  });
});
