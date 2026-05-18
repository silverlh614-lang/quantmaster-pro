// @responsibility Record sell reservation lifecycle transitions.

import { appendShadowLog } from '../../../persistence/shadowTradeRepo.js';
import type { SellReservationLedgerEvent, SellReservationRecord, SellReservationState } from './sellReservationTypes.js';

const events: SellReservationLedgerEvent[] = [];

export function recordSellReservationLedgerEvent(
  record: SellReservationRecord,
  state: SellReservationState,
  message?: string,
): SellReservationLedgerEvent {
  const event: SellReservationLedgerEvent = {
    reservationId: record.reservationId,
    dedupKey: record.dedupKey,
    state,
    mode: record.mode,
    symbol: record.symbol,
    positionId: record.positionId,
    reason: record.reason,
    qty: record.reservedQty,
    ordNo: record.ordNo,
    ts: new Date().toISOString(),
    message,
  };
  events.push(event);

  appendShadowLog({
    event: 'SELL_RESERVATION_LEDGER',
    reservationId: event.reservationId,
    dedupKey: event.dedupKey,
    state: event.state,
    mode: event.mode,
    stockCode: event.symbol,
    positionId: event.positionId,
    reason: event.reason,
    qty: event.qty,
    ordNo: event.ordNo,
    message: event.message,
  });

  return event;
}

export function listSellReservationLedgerEvents(): SellReservationLedgerEvent[] {
  return [...events];
}

export function clearSellReservationLedger(): void {
  events.length = 0;
}
