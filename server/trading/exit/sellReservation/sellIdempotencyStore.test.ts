import { beforeEach, describe, expect, it } from 'vitest';

import {
  activeReservedQtyForPosition,
  buildSellReservationDedupKey,
  clearSellReservationStore,
  hasActiveSellReservation,
  saveSellReservation,
  updateSellReservation,
} from './sellIdempotencyStore.js';
import type { SellReservationRecord } from './sellReservationTypes.js';

function record(state: SellReservationRecord['state']): SellReservationRecord {
  const identity = {
    mode: 'LIVE' as const,
    symbol: '005930',
    positionId: 'pos-1',
    reason: 'STOP_LOSS',
    qty: 10,
  };
  const dedupKey = buildSellReservationDedupKey(identity);
  return {
    ...identity,
    reservationId: 'res-1',
    dedupKey,
    reservedQty: 10,
    state,
    createdAt: '2026-05-19T00:00:00.000Z',
    updatedAt: '2026-05-19T00:00:00.000Z',
  };
}

describe('sellIdempotencyStore', () => {
  beforeEach(() => clearSellReservationStore());

  it('builds the required sell-reserve dedup key', () => {
    expect(buildSellReservationDedupKey({
      mode: 'LIVE',
      symbol: '005930',
      positionId: 'pos-1',
      reason: 'STOP_LOSS',
      qty: 10,
    })).toBe('sell-reserve:LIVE:005930:pos-1:STOP_LOSS:10');
  });

  it('treats non-terminal reservations as active duplicates', () => {
    const reserved = record('RESERVED');
    saveSellReservation(reserved);

    expect(hasActiveSellReservation(reserved.dedupKey)).toBe(true);
    expect(activeReservedQtyForPosition('pos-1')).toBe(10);
  });

  it('releases duplicate block after terminal transition', () => {
    const reserved = record('RESERVED');
    saveSellReservation(reserved);
    updateSellReservation({ ...reserved, state: 'RELEASED' });

    expect(hasActiveSellReservation(reserved.dedupKey)).toBe(false);
    expect(activeReservedQtyForPosition('pos-1')).toBe(0);
  });
});
