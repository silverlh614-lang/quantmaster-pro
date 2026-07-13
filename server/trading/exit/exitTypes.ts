// @responsibility Shared exit engine result contracts.

export type ExitDecision =
  | { kind: 'NO_EXIT'; reason: string }
  | { kind: 'LIVE_SELL_INTENT'; reason: string; qty: number }
  | { kind: 'LIVE_SELL_SUBMITTED'; reason: string; qty: number; ordNo: string }
  | { kind: 'LIVE_SELL_DEFERRED'; reason: string; pendingIntentId: string }
  | { kind: 'SHADOW_SELL_PAPER_FILLED'; reason: string; qty: number }
  | { kind: 'SHADOW_HOLD_R6_DEFENSE'; reason: string; executionImpact: 'NONE' }
  | { kind: 'EXIT_BLOCKED_BY_SESSION'; reason: string }
  | { kind: 'EXIT_FAILED'; reason: string };
export type ExitMarketSessionState =
  | 'OPEN'
  | 'REGULAR'
  | 'PRE_MARKET'
  | 'AFTER_HOURS'
  | 'CLOSED'
  | 'NON_TRADING_DAY'
  | 'SELL_ONLY'
  | 'UNKNOWN';
