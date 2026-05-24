import { describe, expect, it } from 'vitest';
import { buildGate3RrrInput } from './gate3RrrBuilder.js';

const base = {
  currentPrice: 10_000,
  priceFreshness: 'VERIFIED',
  entryPriceAgeSec: 20,
};

describe('buildGate3RrrInput', () => {
  it('calculates PASS when entry, stop and target are present', () => {
    const result = buildGate3RrrInput({ ...base, stopLoss: 9_300, targetPrice: 11_500 });
    expect(result.rrr).toBeCloseTo(1500 / 700, 5);
    expect(result.status).toBe('PASS');
    expect(result.source).toBe('MEASURED_MOVE');
  });

  it('uses fallback target when target is missing', () => {
    const result = buildGate3RrrInput({ ...base, stopLoss: 9_300 });
    expect(result.targetPrice).toBe(11_500);
    expect(result.status).toBe('PASS');
    expect(result.source).toBe('FALLBACK_PERCENT');
    expect(result.fallbackUsed).toBe(true);
  });

  it('uses fallback stop when stop is missing', () => {
    const result = buildGate3RrrInput({ ...base, targetPrice: 11_500 });
    expect(result.stopLoss).toBe(9_300);
    expect(result.status).toBe('PASS');
    expect(result.source).toBe('FALLBACK_PERCENT');
    expect(result.fallbackUsed).toBe(true);
  });

  it('returns MISSING when price is missing', () => {
    const result = buildGate3RrrInput({ stopLoss: 9_300, targetPrice: 11_500 });
    expect(result.status).toBe('MISSING');
    expect(result.missingFields).toContain('entryPrice');
  });

  it('sanity rejects target below entry as MISSING', () => {
    const result = buildGate3RrrInput({ ...base, stopLoss: 9_300, targetPrice: 9_900 });
    expect(result.status).toBe('MISSING');
    expect(result.missingFields).toContain('targetPrice');
    expect(result.notes).toContain('RRR_TARGET_SANITY_REJECTED');
  });

  it('sanity rejects stop above entry as MISSING', () => {
    const result = buildGate3RrrInput({ ...base, stopLoss: 10_100, targetPrice: 11_500 });
    expect(result.status).toBe('MISSING');
    expect(result.missingFields).toContain('stopLoss');
    expect(result.notes).toContain('RRR_STOP_SANITY_REJECTED');
  });

  it('classifies rrr below 1.5 as FAIL', () => {
    const result = buildGate3RrrInput({ ...base, stopLoss: 9_000, targetPrice: 11_400 });
    expect(result.rrr).toBeCloseTo(1.4, 5);
    expect(result.status).toBe('FAIL');
  });

  it('classifies 1.5 <= rrr < 2.0 as WATCH', () => {
    const result = buildGate3RrrInput({ ...base, stopLoss: 9_000, targetPrice: 11_700 });
    expect(result.rrr).toBeCloseTo(1.7, 5);
    expect(result.status).toBe('WATCH');
  });

  it('classifies rrr >= 2.0 as PASS', () => {
    const result = buildGate3RrrInput({ ...base, stopLoss: 9_000, targetPrice: 12_000 });
    expect(result.rrr).toBeCloseTo(2.0, 5);
    expect(result.status).toBe('PASS');
  });
});
