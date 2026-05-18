// @responsibility Sell reservation transaction contracts shared by exit rules.

export type SellReservationState =
  | 'RESERVED'
  | 'SUBMITTED'
  | 'FILLED'
  | 'PARTIALLY_FILLED'
  | 'RELEASED'
  | 'FAILED';

export type SellReservationMode = 'LIVE' | 'SHADOW';

export type SellReservationResult =
  | { kind: 'RESERVED'; reservationId: string; reservedQty: number }
  | { kind: 'PENDING'; reservationId: string; reservedQty: number; ordNo?: string }
  | { kind: 'FAILED'; reason: string; rollbackRequired: boolean }
  | { kind: 'DUPLICATE_BLOCKED'; dedupKey: string }
  | { kind: 'INSUFFICIENT_QUANTITY'; availableQty: number; requestedQty: number };

export interface SellReservationIdentity {
  mode: SellReservationMode;
  symbol: string;
  positionId: string;
  reason: string;
  qty: number;
}

export interface SellReservationRecord extends SellReservationIdentity {
  reservationId: string;
  dedupKey: string;
  reservedQty: number;
  state: SellReservationState;
  createdAt: string;
  updatedAt: string;
  ordNo?: string;
  failureReason?: string;
  filledQty?: number;
}

export interface SellReservationLedgerEvent {
  reservationId: string;
  dedupKey: string;
  state: SellReservationState;
  mode: SellReservationMode;
  symbol: string;
  positionId: string;
  reason: string;
  qty: number;
  ordNo?: string;
  ts: string;
  message?: string;
}
