import { describe, expect, it } from 'vitest';
import { buildGate3VolumeConfirmation } from './gate3VolumeConfirmation.js';

describe('buildGate3VolumeConfirmation', () => {
  it('classifies confirmed volume', () => {
    const result = buildGate3VolumeConfirmation({
      currentPrice: 10_000,
      volume: 1_800_000,
      avgVolume20d: 1_000_000,
    });

    expect(result.status).toBe('CONFIRMED');
    expect(result.volumeRatio20d).toBeCloseTo(1.8, 5);
    expect(result.tradingValueRatio20d).toBeCloseTo(1.8, 5);
    expect(result.marketSignal).toBe(false);
  });

  it('classifies partial volume', () => {
    const result = buildGate3VolumeConfirmation({
      volume: 1_200_000,
      avgVolume20d: 1_000_000,
    });

    expect(result.status).toBe('PARTIAL');
  });

  it('classifies dry-up as a distinct waiting state', () => {
    const result = buildGate3VolumeConfirmation({
      volume: 420_000,
      avgVolume20d: 1_000_000,
    });

    expect(result.status).toBe('DRY_UP');
    expect(result.volumeRatio20d).toBeCloseTo(0.42, 5);
  });

  it('classifies weak volume separately from unavailable volume', () => {
    const result = buildGate3VolumeConfirmation({
      volume: 800_000,
      avgVolume20d: 1_000_000,
    });

    expect(result.status).toBe('WEAK');
    expect(result.missingFields).toEqual([]);
  });

  it('classifies spike risk only when spike context is risky', () => {
    const result = buildGate3VolumeConfirmation({
      volume: 4_200_000,
      avgVolume20d: 1_000_000,
      upperWickRisk: true,
    });

    expect(result.status).toBe('SPIKE_RISK');
    expect(result.notes).toContain('VOLUME_SPIKE_RISK_CONTEXT');
  });

  it('keeps missing baseline as data unavailable', () => {
    const result = buildGate3VolumeConfirmation({
      volume: 1_000_000,
    });

    expect(result.status).toBe('DATA_UNAVAILABLE');
    expect(result.missingFields).toContain('avgVolume20d');
    expect(result.marketSignal).toBe(false);
  });
});
