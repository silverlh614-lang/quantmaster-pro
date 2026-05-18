import {
  markAutoTradeReady as markAutoTradeReadyRepo,
  markBlocked as markBlockedRepo,
  type TradeSignalBlockGate,
  type TradeSignalRecord,
} from '../../persistence/tradeSignalStatusRepo.js';
import { emitOperationalWarn } from './operationalWarn.js';

export type TradeSignalStatusWriteAction =
  | 'markAutoTradeReady'
  | 'markOrderPending'
  | 'markFilled'
  | 'markRejected'
  | 'markBlocked';

export interface TradeSignalStatusWriteInput {
  signalId?: string;
  reason: string;
  gate?: TradeSignalBlockGate;
  important?: boolean;
  now?: Date;
}

export interface TradeSignalStatusWriteResult {
  ok: boolean;
  action: TradeSignalStatusWriteAction;
  signalId?: string;
  skipped?: boolean;
  reason?: string;
  record?: TradeSignalRecord | null;
  error?: unknown;
}

function skippedResult(
  action: TradeSignalStatusWriteAction,
  signalId: string | undefined,
  reason: string,
): TradeSignalStatusWriteResult {
  return {
    ok: true,
    action,
    ...(signalId ? { signalId } : {}),
    skipped: true,
    reason,
  };
}

function emitWriteFailure(
  action: TradeSignalStatusWriteAction,
  input: TradeSignalStatusWriteInput,
  error?: unknown,
): void {
  emitOperationalWarn({
    code: 'P0_BUY_STATUS_WRITE_FAILED',
    message: `TradeSignalStatus ${action} failed`,
    context: {
      action,
      signalId: input.signalId,
      reason: input.reason,
      important: input.important ?? true,
    },
    ...(error !== undefined ? { cause: error } : {}),
  });
}

function runRepoWrite(
  action: TradeSignalStatusWriteAction,
  input: TradeSignalStatusWriteInput,
  writer: (id: string) => TradeSignalRecord | null,
): TradeSignalStatusWriteResult {
  if (!input.signalId) {
    return skippedResult(action, input.signalId, 'SIGNAL_ID_MISSING');
  }

  try {
    const record = writer(input.signalId);
    if (!record && input.important !== false) {
      emitWriteFailure(action, input);
    }
    return {
      ok: record !== null || input.important === false,
      action,
      signalId: input.signalId,
      record,
      ...(record ? {} : { reason: 'TRADE_SIGNAL_STATUS_RECORD_MISSING' }),
    };
  } catch (error) {
    if (input.important !== false) {
      emitWriteFailure(action, input, error);
    }
    return {
      ok: false,
      action,
      signalId: input.signalId,
      error,
      reason: 'TRADE_SIGNAL_STATUS_WRITE_THROW',
    };
  }
}

export function markAutoTradeReady(
  input: TradeSignalStatusWriteInput,
): TradeSignalStatusWriteResult {
  return runRepoWrite('markAutoTradeReady', input, (id) => markAutoTradeReadyRepo({
    id,
    reason: input.reason,
    now: input.now,
  }));
}

export function markOrderPending(
  input: TradeSignalStatusWriteInput,
): TradeSignalStatusWriteResult {
  return skippedResult(
    'markOrderPending',
    input.signalId,
    'LEGACY_TRADE_SIGNAL_STATUS_HAS_NO_ORDER_PENDING_STATE',
  );
}

export function markFilled(
  input: TradeSignalStatusWriteInput,
): TradeSignalStatusWriteResult {
  return skippedResult(
    'markFilled',
    input.signalId,
    'LEGACY_TRADE_SIGNAL_STATUS_HAS_NO_FILLED_STATE',
  );
}

export function markRejected(
  input: TradeSignalStatusWriteInput,
): TradeSignalStatusWriteResult {
  return runRepoWrite('markRejected', input, (id) => markBlockedRepo({
    id,
    gate: input.gate ?? 'USER_REJECT',
    reason: input.reason,
    now: input.now,
  }));
}

export function markBlocked(
  input: TradeSignalStatusWriteInput,
): TradeSignalStatusWriteResult {
  return runRepoWrite('markBlocked', input, (id) => markBlockedRepo({
    id,
    gate: input.gate ?? 'OTHER',
    reason: input.reason,
    now: input.now,
  }));
}
