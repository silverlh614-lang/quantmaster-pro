// @responsibility Normalize sell reservation transaction outcomes.

import type { SellReservationRecord, SellReservationResult } from './sellReservationTypes.js';

export function normalizeReserved(record: SellReservationRecord): SellReservationResult {
  return {
    kind: 'RESERVED',
    reservationId: record.reservationId,
    reservedQty: record.reservedQty,
  };
}

export function normalizePending(record: SellReservationRecord): SellReservationResult {
  return {
    kind: 'PENDING',
    reservationId: record.reservationId,
    reservedQty: record.reservedQty,
    ordNo: record.ordNo,
  };
}

export function normalizeFailed(reason: string, rollbackRequired = true): SellReservationResult {
  return {
    kind: 'FAILED',
    reason,
    rollbackRequired,
  };
}

export function normalizeDuplicateBlocked(dedupKey: string): SellReservationResult {
  return {
    kind: 'DUPLICATE_BLOCKED',
    dedupKey,
  };
}

export function normalizeInsufficientQuantity(
  availableQty: number,
  requestedQty: number,
): SellReservationResult {
  return {
    kind: 'INSUFFICIENT_QUANTITY',
    availableQty,
    requestedQty,
  };
}
