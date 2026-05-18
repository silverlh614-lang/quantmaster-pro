// @responsibility In-memory idempotency store for sell reservation intents.

import type { SellReservationIdentity, SellReservationRecord, SellReservationState } from './sellReservationTypes.js';

const terminalStates = new Set<SellReservationState>(['FILLED', 'RELEASED', 'FAILED']);

const reservationsByKey = new Map<string, SellReservationRecord>();
const reservationsById = new Map<string, SellReservationRecord>();

export function buildSellReservationDedupKey(input: SellReservationIdentity): string {
  return `sell-reserve:${input.mode}:${input.symbol}:${input.positionId}:${input.reason}:${input.qty}`;
}

export function getSellReservationByKey(dedupKey: string): SellReservationRecord | undefined {
  return reservationsByKey.get(dedupKey);
}

export function getSellReservationById(reservationId: string): SellReservationRecord | undefined {
  return reservationsById.get(reservationId);
}

export function hasActiveSellReservation(dedupKey: string): boolean {
  const existing = reservationsByKey.get(dedupKey);
  return !!existing && !terminalStates.has(existing.state);
}

export function saveSellReservation(record: SellReservationRecord): void {
  reservationsByKey.set(record.dedupKey, record);
  reservationsById.set(record.reservationId, record);
}

export function updateSellReservation(record: SellReservationRecord): void {
  saveSellReservation(record);
}

export function activeReservedQtyForPosition(positionId: string): number {
  let qty = 0;
  for (const record of reservationsById.values()) {
    if (record.positionId !== positionId) continue;
    if (record.state !== 'RESERVED') continue;
    qty += record.reservedQty;
  }
  return qty;
}

export function listActiveSellReservations(now = new Date(), staleMs = 30 * 60 * 1000): SellReservationRecord[] {
  const cutoff = now.getTime() - staleMs;
  return Array.from(reservationsById.values()).filter(record => {
    if (terminalStates.has(record.state)) return false;
    const updatedAt = new Date(record.updatedAt).getTime();
    return Number.isFinite(updatedAt) && updatedAt < cutoff;
  });
}

export function clearSellReservationStore(): void {
  reservationsByKey.clear();
  reservationsById.clear();
}
