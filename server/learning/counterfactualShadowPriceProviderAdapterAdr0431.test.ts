// @responsibility ADR-0431 thin adapter 회귀 테스트.
//
// ProvisionalShadowPriceProvider → CounterfactualShadowPriceProvider wrap 동등성.
// 사용자 §C 정합 — 큰 refactor 회피, ADR-0429 cache-first reuse.

import { describe, expect, it } from 'vitest';
import { wrapProvisionalProviderForCounterfactual } from './counterfactualShadowPriceProviderAdapter.js';
import type { ProvisionalShadowPriceProvider } from './provisionalShadowPerformanceReport.js';

describe('ADR-0431 counterfactualShadowPriceProviderAdapter', () => {
  it('available=true wrap — price/observedAtKst 그대로 forward + source ENTRY_SNAPSHOT', async () => {
    const provisional: ProvisionalShadowPriceProvider = async () => ({
      available: true,
      price: 105000,
      observedAtKst: '2026-05-07T11:00:00+09:00',
    });
    const wrapped = wrapProvisionalProviderForCounterfactual(provisional);
    const result = await wrapped('005930', 'T_PLUS_30M', '2026-05-07T10:00:00+09:00');
    if (!result.available) {
      throw new Error('expected available=true');
    }
    expect(result.price).toBe(105000);
    expect(result.observedAtKst).toBe('2026-05-07T11:00:00+09:00');
    expect(result.source).toBe('ENTRY_SNAPSHOT');
  });

  it('available=false wrap — reason / status / source NONE', async () => {
    const provisional: ProvisionalShadowPriceProvider = async () => ({
      available: false,
      reason: 'cache miss',
      status: 'DATA_UNAVAILABLE',
    });
    const wrapped = wrapProvisionalProviderForCounterfactual(provisional);
    const result = await wrapped('005930', 'T_PLUS_30M', '2026-05-07T10:00:00+09:00');
    if (result.available) {
      throw new Error('expected available=false');
    }
    expect(result.reason).toBe('cache miss');
    expect(result.status).toBe('DATA_UNAVAILABLE');
    expect(result.source).toBe('NONE');
  });

  it('horizon string forward — 6-value union 동등성', async () => {
    const seenHorizons: string[] = [];
    const provisional: ProvisionalShadowPriceProvider = async (_s, h) => {
      seenHorizons.push(h);
      return { available: false, reason: 'no data' };
    };
    const wrapped = wrapProvisionalProviderForCounterfactual(provisional);
    const horizons = [
      'T_PLUS_30M',
      'T_PLUS_1H',
      'SAME_DAY_CLOSE',
      'NEXT_OPEN',
      'T_PLUS_1D_CLOSE',
      'T_PLUS_3D_CLOSE',
    ] as const;
    for (const h of horizons) {
      await wrapped('005930', h, '2026-05-07T10:00:00+09:00');
    }
    expect(seenHorizons).toEqual([
      'T_PLUS_30M',
      'T_PLUS_1H',
      'SAME_DAY_CLOSE',
      'NEXT_OPEN',
      'T_PLUS_1D_CLOSE',
      'T_PLUS_3D_CLOSE',
    ]);
  });

  it('available=false + status undefined → status undefined 그대로 (호출자가 DATA_UNAVAILABLE fallback)', async () => {
    const provisional: ProvisionalShadowPriceProvider = async () => ({
      available: false,
      reason: 'no status set',
    });
    const wrapped = wrapProvisionalProviderForCounterfactual(provisional);
    const result = await wrapped('005930', 'T_PLUS_30M', '2026-05-07T10:00:00+09:00');
    if (result.available) {
      throw new Error('expected available=false');
    }
    expect(result.status).toBeUndefined();
    expect(result.source).toBe('NONE');
  });
});
