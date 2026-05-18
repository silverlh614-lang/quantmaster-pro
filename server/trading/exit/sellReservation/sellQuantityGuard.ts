// @responsibility Guard sell reservations against overselling a position.

export interface SellQuantityGuardInput {
  availableQty: number;
  pendingReservedQty: number;
  requestedQty: number;
}

export type SellQuantityGuardResult =
  | {
      kind: 'ALLOW';
      availableAfterPending: number;
      requestedQty: number;
    }
  | {
      kind: 'INSUFFICIENT_QUANTITY';
      availableQty: number;
      pendingReservedQty: number;
      availableAfterPending: number;
      requestedQty: number;
    };

function normalizeQty(value: number): number {
  return Number.isFinite(value) ? Math.max(0, Math.floor(value)) : 0;
}

export function checkSellQuantity(input: SellQuantityGuardInput): SellQuantityGuardResult {
  const availableQty = normalizeQty(input.availableQty);
  const pendingReservedQty = normalizeQty(input.pendingReservedQty);
  const requestedQty = normalizeQty(input.requestedQty);
  const availableAfterPending = Math.max(0, availableQty - pendingReservedQty);

  if (requestedQty <= 0 || availableAfterPending < requestedQty) {
    return {
      kind: 'INSUFFICIENT_QUANTITY',
      availableQty,
      pendingReservedQty,
      availableAfterPending,
      requestedQty,
    };
  }

  return {
    kind: 'ALLOW',
    availableAfterPending,
    requestedQty,
  };
}
