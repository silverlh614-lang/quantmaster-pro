import { describe, expect, it } from 'vitest';

import { checkSellQuantity } from './sellQuantityGuard.js';

describe('checkSellQuantity', () => {
  it('allows requested quantity within available minus pending reserved quantity', () => {
    expect(checkSellQuantity({
      availableQty: 100,
      pendingReservedQty: 30,
      requestedQty: 70,
    })).toEqual({
      kind: 'ALLOW',
      availableAfterPending: 70,
      requestedQty: 70,
    });
  });

  it('blocks oversell requests', () => {
    expect(checkSellQuantity({
      availableQty: 100,
      pendingReservedQty: 30,
      requestedQty: 71,
    })).toEqual({
      kind: 'INSUFFICIENT_QUANTITY',
      availableQty: 100,
      pendingReservedQty: 30,
      availableAfterPending: 70,
      requestedQty: 71,
    });
  });

  it('blocks zero or invalid requests', () => {
    expect(checkSellQuantity({
      availableQty: 100,
      pendingReservedQty: 0,
      requestedQty: 0,
    }).kind).toBe('INSUFFICIENT_QUANTITY');
  });
});
