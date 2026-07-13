// @responsibility Sell reservation transaction manager for live and shadow exits.

import type { ServerShadowTrade } from '../../../persistence/shadowTradeRepo.js';
import { emitExitOperationalWarn } from '../exitOperationalWarn.js';
import {
  activeReservedQtyForPosition,
  buildSellReservationDedupKey,
  clearSellReservationStore,
  getSellReservationById,
  hasActiveSellReservation,
  listActiveSellReservations,
  saveSellReservation,
  updateSellReservation,
} from './sellIdempotencyStore.js';
import { checkSellQuantity } from './sellQuantityGuard.js';
import { recordSellReservationLedgerEvent } from './sellReservationLedger.js';
import {
  normalizeDuplicateBlocked,
  normalizeFailed,
  normalizeInsufficientQuantity,
  normalizePending,
  normalizeReserved,
} from './sellReservationResultNormalizer.js';
import type {
  SellReservationMode,
  SellReservationRecord,
  SellReservationResult,
  SellReservationState,
} from './sellReservationTypes.js';

export interface ReserveSellTransactionInput {
  trade: ServerShadowTrade;
  requestedQty: number;
  reason: string;
  mode?: SellReservationMode;
  availableQtyOverride?: number;
  now?: Date;
}

export interface ConfirmSellSubmittedInput {
  reservationId: string;
  ordNo: string;
  now?: Date;
}

export interface ReleaseSellReservationInput {
  reservationId: string;
  reason: string;
  now?: Date;
}

export interface MarkSellFilledInput {
  reservationId: string;
  filledQty?: number;
  now?: Date;
}

export interface MarkSellFailedInput {
  reservationId: string;
  reason: string;
  now?: Date;
}

function modeForTrade(trade: ServerShadowTrade, explicit?: SellReservationMode): SellReservationMode {
  if (explicit) return explicit;
  return trade.mode === 'LIVE' ? 'LIVE' : 'SHADOW';
}

function positionIdForTrade(trade: ServerShadowTrade): string {
  return trade.id || trade.stockCode;
}

function activeBuyQty(trade: ServerShadowTrade): number {
  return (trade.fills ?? [])
    .filter(fill => fill.type === 'BUY' && fill.status !== 'REVERTED')
    .reduce((sum, fill) => sum + fill.qty, 0);
}

function confirmedSellQty(trade: ServerShadowTrade): number {
  return (trade.fills ?? [])
    .filter(fill => fill.type === 'SELL' && fill.status !== 'REVERTED' && fill.status !== 'PROVISIONAL')
    .reduce((sum, fill) => sum + fill.qty, 0);
}

function provisionalSellQty(trade: ServerShadowTrade): number {
  return (trade.fills ?? [])
    .filter(fill => fill.type === 'SELL' && fill.status === 'PROVISIONAL')
    .reduce((sum, fill) => sum + fill.qty, 0);
}

function confirmedAvailableQty(trade: ServerShadowTrade, fallbackAvailableQty = 0): number {
  const buyQty = activeBuyQty(trade);
  if (buyQty > 0) return Math.max(0, buyQty - confirmedSellQty(trade));
  return Math.max(
    0,
    Math.floor(trade.originalQuantity ?? 0),
    Math.floor(trade.quantity ?? 0),
    Math.floor(fallbackAvailableQty),
  );
}

function pendingReservedQty(trade: ServerShadowTrade, positionId: string): number {
  return provisionalSellQty(trade) + activeReservedQtyForPosition(positionId);
}

function newReservationId(now: Date, positionId: string): string {
  return `sell-res-${positionId}-${now.getTime().toString(36)}`;
}

function emitReservationWarn(
  code: string,
  message: string,
  context?: Record<string, unknown>,
  cause?: unknown,
): void {
  emitExitOperationalWarn({
    code,
    message,
    context,
    cause,
  });
}

function recordLifecycle(record: SellReservationRecord, state: SellReservationState, message?: string): void {
  try {
    recordSellReservationLedgerEvent(record, state, message);
  } catch (cause) {
    emitReservationWarn('P0_SELL_RESERVATION_FAILED', 'Sell reservation ledger write failed', {
      reservationId: record.reservationId,
      dedupKey: record.dedupKey,
      state,
    }, cause);
  }
}

function transition(
  record: SellReservationRecord,
  state: SellReservationState,
  now: Date,
  patch: Partial<SellReservationRecord> = {},
): SellReservationRecord {
  const next: SellReservationRecord = {
    ...record,
    ...patch,
    state,
    updatedAt: now.toISOString(),
  };
  updateSellReservation(next);
  recordLifecycle(next, state, patch.failureReason);
  return next;
}

export const sellReservationManager = {
  reserveSell(input: ReserveSellTransactionInput): SellReservationResult {
    const now = input.now ?? new Date();
    const mode = modeForTrade(input.trade, input.mode);
    const positionId = positionIdForTrade(input.trade);
    const symbol = input.trade.stockCode;
    const requestedQty = Math.max(0, Math.floor(input.requestedQty));
    const identity = {
      mode,
      symbol,
      positionId,
      reason: input.reason,
      qty: requestedQty,
    };
    const dedupKey = buildSellReservationDedupKey(identity);

    try {
      if (hasActiveSellReservation(dedupKey)) {
        emitReservationWarn('P0_SELL_DUPLICATE_BLOCKED', 'Duplicate sell reservation blocked', {
          dedupKey,
          mode,
          symbol,
          positionId,
          reason: input.reason,
          requestedQty,
        });
        return normalizeDuplicateBlocked(dedupKey);
      }

      const availableQty = confirmedAvailableQty(input.trade, input.availableQtyOverride);
      const reservedQty = pendingReservedQty(input.trade, positionId);
      const quantityGuard = checkSellQuantity({
        availableQty,
        pendingReservedQty: reservedQty,
        requestedQty,
      });

      if (quantityGuard.kind === 'INSUFFICIENT_QUANTITY') {
        emitReservationWarn('P0_SELL_INSUFFICIENT_QUANTITY', 'Sell reservation exceeds available quantity', {
          dedupKey,
          mode,
          symbol,
          positionId,
          reason: input.reason,
          availableQty: quantityGuard.availableAfterPending,
          requestedQty,
          pendingReservedQty: reservedQty,
        });
        return normalizeInsufficientQuantity(quantityGuard.availableAfterPending, requestedQty);
      }

      const record: SellReservationRecord = {
        ...identity,
        reservationId: newReservationId(now, positionId),
        dedupKey,
        reservedQty: requestedQty,
        state: 'RESERVED',
        createdAt: now.toISOString(),
        updatedAt: now.toISOString(),
      };
      saveSellReservation(record);
      recordLifecycle(record, 'RESERVED');
      return normalizeReserved(record);
    } catch (cause) {
      emitReservationWarn('P0_SELL_RESERVATION_FAILED', 'Sell reservation failed', {
        dedupKey,
        mode,
        symbol,
        positionId,
        reason: input.reason,
        requestedQty,
      }, cause);
      return normalizeFailed(cause instanceof Error ? cause.message : String(cause));
    }
  },

  confirmSellSubmitted(input: ConfirmSellSubmittedInput): SellReservationResult {
    const now = input.now ?? new Date();
    const record = getSellReservationById(input.reservationId);
    if (!record) return normalizeFailed('RESERVATION_NOT_FOUND');
    if (record.mode === 'SHADOW') return normalizeFailed('SHADOW_RESERVATION_CANNOT_SUBMIT_LIVE_ORDER');
    if (record.state !== 'RESERVED') return normalizeFailed(`INVALID_STATE_${record.state}`);

    const next = transition(record, 'SUBMITTED', now, { ordNo: input.ordNo });
    return normalizePending(next);
  },

  releaseReservation(input: ReleaseSellReservationInput): SellReservationResult {
    const now = input.now ?? new Date();
    const record = getSellReservationById(input.reservationId);
    if (!record) return normalizeFailed('RESERVATION_NOT_FOUND', false);

    try {
      const next = transition(record, 'RELEASED', now, { failureReason: input.reason });
      return normalizeFailed(input.reason, false) satisfies SellReservationResult;
    } catch (cause) {
      emitReservationWarn('P0_SELL_RESERVATION_ROLLBACK_FAILED', 'Sell reservation release failed', {
        reservationId: input.reservationId,
        reason: input.reason,
      }, cause);
      return normalizeFailed(cause instanceof Error ? cause.message : String(cause));
    }
  },

  markSellFilled(input: MarkSellFilledInput): SellReservationResult {
    const now = input.now ?? new Date();
    const record = getSellReservationById(input.reservationId);
    if (!record) return normalizeFailed('RESERVATION_NOT_FOUND');
    const filledQty = Math.max(0, Math.floor(input.filledQty ?? record.reservedQty));
    const state: SellReservationState = filledQty > 0 && filledQty < record.reservedQty
      ? 'PARTIALLY_FILLED'
      : 'FILLED';
    const next = transition(record, state, now, { filledQty });
    return normalizePending(next);
  },

  markSellFailed(input: MarkSellFailedInput): SellReservationResult {
    const now = input.now ?? new Date();
    const record = getSellReservationById(input.reservationId);
    if (!record) return normalizeFailed('RESERVATION_NOT_FOUND');
    transition(record, 'FAILED', now, { failureReason: input.reason });
    return normalizeFailed(input.reason, true);
  },

  reconcileOrphanedReservations(now = new Date(), staleMs?: number): SellReservationRecord[] {
    const orphaned = listActiveSellReservations(now, staleMs);
    for (const record of orphaned) {
      emitReservationWarn('P0_SELL_RESERVATION_ORPHANED', 'Orphaned sell reservation reconciled as FAILED', {
        reservationId: record.reservationId,
        dedupKey: record.dedupKey,
        state: record.state,
        symbol: record.symbol,
        positionId: record.positionId,
      });
      transition(record, 'FAILED', now, { failureReason: 'ORPHANED_RESERVATION_RECONCILED' });
    }
    return orphaned;
  },

  __testOnly: {
    clear(): void {
      clearSellReservationStore();
    },
    confirmedAvailableQty,
    pendingReservedQty,
  },
};

export const reserveSell = sellReservationManager.reserveSell.bind(sellReservationManager);
export const confirmSellSubmitted = sellReservationManager.confirmSellSubmitted.bind(sellReservationManager);
const releaseReservation = sellReservationManager.releaseReservation.bind(sellReservationManager);
export const markSellFilled = sellReservationManager.markSellFilled.bind(sellReservationManager);
export const markSellFailed = sellReservationManager.markSellFailed.bind(sellReservationManager);
export const reconcileOrphanedReservations =
  sellReservationManager.reconcileOrphanedReservations.bind(sellReservationManager);
