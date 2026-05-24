import { describe, expect, it } from 'vitest';
import {
  attachForwardReturn,
  buildForwardReturnSnapshot,
} from './outcomeClosure.js';
import { seed } from './outcomeSeedCreation.test.js';

describe('ADR-0522 forward return tracker', () => {
  it('calculates return, MFE, MAE and target/stop flags', () => {
    const s = seed();
    const snapshot = buildForwardReturnSnapshot({
      seed: s,
      horizon: '10D',
      asOf: '2026-06-03',
      closePrice: 10_800,
      highPrice: 11_700,
      lowPrice: 9_700,
      targetHitAt: '2026-05-28',
    });

    expect(snapshot.returnPct).toBe(8);
    expect(snapshot.mfePct).toBe(17);
    expect(snapshot.maePct).toBe(-3);
    expect(snapshot.targetHit).toBe(true);
    expect(snapshot.stopHit).toBe(false);
    expect(snapshot.labelReady).toBe(true);
  });

  it('keeps missing price as not label ready', () => {
    const s = seed();
    const snapshot = buildForwardReturnSnapshot({
      seed: s,
      horizon: '1D',
      asOf: '2026-05-25',
      closePrice: null,
      highPrice: null,
      lowPrice: null,
    });
    const updated = attachForwardReturn(s, snapshot);

    expect(snapshot.priceDataHealth).toBe('MISSING');
    expect(snapshot.labelReady).toBe(false);
    expect(updated.forwardReturns?.['1D']).toBe(snapshot);
  });
});
