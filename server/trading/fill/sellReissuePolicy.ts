import { emitOperationalWarn } from './fillOperationalWarn.js';

export type SellReissueMode = 'LIVE' | 'PAPER' | 'SHADOW';

export interface SellReissueIdentity {
  mode: SellReissueMode;
  symbol: string;
  originalOrdNo: string;
  reason: string;
}

export interface SellReissueDecisionInput extends SellReissueIdentity {
  now?: Date;
  marketOpen: boolean;
  liveSellAllowed: boolean;
  remainingQty: number;
}

export type SellReissueDecision =
  | {
      kind: 'ALLOW_REISSUE';
      dedupKey: string;
      executionImpact: 'LIVE_SELL_BLOCKED' | 'EXIT_MONITOR_DEGRADED' | 'NONE';
      reason: string;
    }
  | {
      kind: 'DUPLICATE_BLOCKED';
      dedupKey: string;
      executionImpact: 'LIVE_SELL_BLOCKED';
      reason: string;
    }
  | {
      kind: 'DEFERRED_MONITOR';
      dedupKey: string;
      executionImpact: 'EXIT_MONITOR_DEGRADED';
      reason: string;
    }
  | {
      kind: 'REJECTED';
      dedupKey: string;
      executionImpact: 'LIVE_SELL_BLOCKED';
      reason: string;
    };

export interface SellReissueReservation {
  dedupKey: string;
  identity: SellReissueIdentity;
  reservedAt: string;
}

const reservations = new Map<string, SellReissueReservation>();

function normalizePart(value: string): string {
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : 'UNKNOWN';
}

export function buildSellReissueDedupKey(input: SellReissueIdentity): string {
  return [
    'sell-reissue',
    normalizePart(input.mode),
    normalizePart(input.symbol),
    normalizePart(input.originalOrdNo),
    normalizePart(input.reason),
  ].join(':');
}

export function reserveSellReissue(input: SellReissueIdentity, now = new Date()): SellReissueDecision {
  const dedupKey = buildSellReissueDedupKey(input);
  if (reservations.has(dedupKey)) {
    emitOperationalWarn({
      code: 'P0_SELL_REISSUE_DUPLICATE_BLOCKED',
      message: 'Duplicate sell market reissue blocked by idempotency guard',
      context: {
        dedupKey,
        symbol: input.symbol,
        originalOrdNo: input.originalOrdNo,
        reason: input.reason,
        executionImpact: 'LIVE_SELL_BLOCKED',
      },
    });
    return {
      kind: 'DUPLICATE_BLOCKED',
      dedupKey,
      executionImpact: 'LIVE_SELL_BLOCKED',
      reason: 'DUPLICATE_SELL_REISSUE_BLOCKED',
    };
  }

  reservations.set(dedupKey, {
    dedupKey,
    identity: {
      mode: input.mode,
      symbol: normalizePart(input.symbol),
      originalOrdNo: normalizePart(input.originalOrdNo),
      reason: normalizePart(input.reason),
    },
    reservedAt: now.toISOString(),
  });
  return {
    kind: 'ALLOW_REISSUE',
    dedupKey,
    executionImpact: 'NONE',
    reason: 'SELL_REISSUE_RESERVED',
  };
}

export function decideSellReissue(input: SellReissueDecisionInput): SellReissueDecision {
  const dedupKey = buildSellReissueDedupKey(input);
  if (input.remainingQty <= 0) {
    return {
      kind: 'REJECTED',
      dedupKey,
      executionImpact: 'LIVE_SELL_BLOCKED',
      reason: 'NO_REMAINING_QTY_TO_REISSUE',
    };
  }
  if (!input.marketOpen) {
    return {
      kind: 'DEFERRED_MONITOR',
      dedupKey,
      executionImpact: 'EXIT_MONITOR_DEGRADED',
      reason: 'MARKET_CLOSED_DEFER_REISSUE',
    };
  }
  if (!input.liveSellAllowed) {
    return {
      kind: 'DEFERRED_MONITOR',
      dedupKey,
      executionImpact: 'EXIT_MONITOR_DEGRADED',
      reason: 'LIVE_SELL_NOT_ALLOWED_DEFER_REISSUE',
    };
  }
  return reserveSellReissue(input, input.now);
}

export function markSellReissueFailed(input: SellReissueIdentity, cause: unknown): void {
  emitOperationalWarn({
    code: 'P0_SELL_REISSUE_FAILED',
    message: 'Sell market reissue failed after idempotency reservation',
    context: {
      dedupKey: buildSellReissueDedupKey(input),
      symbol: input.symbol,
      originalOrdNo: input.originalOrdNo,
      reason: input.reason,
      executionImpact: 'LIVE_SELL_BLOCKED',
    },
    cause,
  });
}

export function __resetSellReissuePolicyForTests(): void {
  reservations.clear();
}
