export type FillQueryResult =
  | { kind: 'FILLED'; filledQty: number; avgPrice: number; raw?: unknown }
  | { kind: 'PARTIALLY_FILLED'; filledQty: number; remainingQty: number; avgPrice?: number; raw?: unknown }
  | { kind: 'UNFILLED'; reason: string; retryable: boolean; raw?: unknown }
  | { kind: 'EMPTY_RESPONSE'; retryable: boolean; raw?: unknown }
  | { kind: 'REJECTED'; reason: string; raw?: unknown }
  | { kind: 'QUERY_FAILED'; reason: string; retryable: boolean; raw?: unknown };

export type FillSide = 'BUY' | 'SELL';

export type NormalizedBuyFillState =
  | 'SUBMITTED'
  | 'FILLED'
  | 'PARTIALLY_FILLED'
  | 'UNFILLED'
  | 'REJECTED';

export type NormalizedSellFillState =
  | 'SUBMITTED'
  | 'SELL_FILLED'
  | 'PARTIALLY_FILLED'
  | 'UNFILLED'
  | 'REJECTED';

export interface FillQueryOrder {
  ordNo: string;
  symbol: string;
  orderQty: number;
  side: FillSide;
}

export interface NormalizedKisFillRow {
  ordNo: string;
  orderQty: number;
  filledQty: number;
  avgPrice?: number;
  rejected?: boolean;
  rejectReason?: string;
  raw?: unknown;
}
