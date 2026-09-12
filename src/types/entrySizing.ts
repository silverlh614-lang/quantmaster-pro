// @responsibility Define shared entry order sizing contracts.

export interface EntryOrderSizingInput {
  totalAssets: number;
  orderableCash: number;
  /** Fraction of total assets; 0.1 means ten percent. */
  positionPct: number;
  price: number;
  remainingSlots: number;
}

export interface EntryOrderSizingResult {
  quantity: number;
  effectiveBudget: number;
}
