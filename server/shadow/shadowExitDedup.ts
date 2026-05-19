export type ShadowExitStage =
  | 'PRE_ALERT'
  | 'CONFIRMED'
  | 'ORDER_PENDING'
  | 'PAPER_FILLED'
  | 'POSITION_CLOSED'
  | 'SETTLED'
  | 'ARCHIVED'
  | 'BLOCKED_DIAGNOSTIC';

const TERMINAL = new Set(['CLOSED', 'SETTLED', 'ARCHIVED', 'POSITION_CLOSED', 'PAPER_CLOSED', 'EXITED', 'CANCELLED']);
const PENDING = new Set(['EXIT_PENDING', 'ORDER_PENDING', 'PAPER_FILL_PENDING', 'CLOSING', 'CONFIRMED']);

type ChannelType = 'USER_SIGNAL' | 'BOT' | 'DEBUG' | 'ADMIN' | string;

export interface ShadowExitDedupRecord {
  eventId: string;
  positionKey: string;
  symbol: string;
  positionId?: string | null;
  exitReason: string;
  exitStage: string;
  mode: string;
  tradeDate: string;
  channelType: ChannelType;
  firstSeenAt: string;
  lastSeenAt: string;
  sentCount: number;
  suppressedCount: number;
  terminal: boolean;
}

const eventLedger = new Map<string, ShadowExitDedupRecord>();
const positionTerminal = new Map<string, string>();

export function buildShadowLiquidationEventId(input: { mode: string; tradeDate: string; symbol: string; positionId?: string | null; exitReason: string; exitStage: string }): string {
  return `${input.mode}:${input.tradeDate}:${input.symbol}:${input.positionId || 'NO_POSITION'}:${input.exitReason}:${input.exitStage}`;
}

export function buildShadowExitPositionKey(input: { mode: string; tradeDate: string; symbol: string; positionId?: string | null; exitReason: string }): string {
  return `${input.mode}:${input.tradeDate}:${input.symbol}:${input.positionId || 'NO_POSITION'}:${input.exitReason}`;
}

export function isTerminalShadowPositionStatus(status?: string | null): boolean {
  return status ? TERMINAL.has(status.toUpperCase()) : false;
}

export function isPendingShadowExitStatus(status?: string | null): boolean {
  return status ? PENDING.has(status.toUpperCase()) : false;
}

export function shouldSendShadowExitNotification(input: {
  mode: string; tradeDate: string; symbol: string; positionId?: string | null; exitReason: string; exitStage: string; positionStatus?: string | null; channelType: ChannelType; messageKind: string;
}): { allow: boolean; eventId: string; positionKey: string; reason: string; suppressToLogOnly: boolean } {
  const eventId = buildShadowLiquidationEventId(input);
  const positionKey = buildShadowExitPositionKey(input);
  if (input.mode !== 'SHADOW') return { allow: true, eventId, positionKey, reason: 'NON_SHADOW_BYPASS', suppressToLogOnly: false };
  if (isTerminalShadowPositionStatus(input.positionStatus)) {
    return { allow: false, eventId, positionKey, reason: `TERMINAL_STATUS:${input.positionStatus}`, suppressToLogOnly: true };
  }
  if (positionTerminal.has(positionKey)) {
    return { allow: false, eventId, positionKey, reason: `TERMINAL_POSITION_KEY:${positionTerminal.get(positionKey)}`, suppressToLogOnly: true };
  }
  if (isPendingShadowExitStatus(input.positionStatus) && input.exitStage === 'PRE_ALERT') {
    return { allow: false, eventId, positionKey, reason: `PENDING_STATUS:${input.positionStatus}`, suppressToLogOnly: true };
  }
  if (input.exitStage === 'BLOCKED_DIAGNOSTIC' && input.channelType === 'USER_SIGNAL') {
    return { allow: false, eventId, positionKey, reason: 'DIAGNOSTIC_LOG_ONLY', suppressToLogOnly: true };
  }
  if (eventLedger.get(eventId)?.sentCount) {
    return { allow: false, eventId, positionKey, reason: 'DUPLICATE_EVENT', suppressToLogOnly: true };
  }
  return { allow: true, eventId, positionKey, reason: 'ALLOW', suppressToLogOnly: false };
}

export function recordShadowExitNotification(input: {
  mode: string; tradeDate: string; symbol: string; positionId?: string | null; exitReason: string; exitStage: string; channelType: ChannelType; terminal?: boolean;
}): ShadowExitDedupRecord {
  const now = new Date().toISOString();
  const eventId = buildShadowLiquidationEventId(input);
  const positionKey = buildShadowExitPositionKey(input);
  const prev = eventLedger.get(eventId);
  const next: ShadowExitDedupRecord = prev ? { ...prev, lastSeenAt: now, sentCount: prev.sentCount + 1, terminal: prev.terminal || Boolean(input.terminal) } : {
    eventId, positionKey, symbol: input.symbol, positionId: input.positionId, exitReason: input.exitReason, exitStage: input.exitStage, mode: input.mode, tradeDate: input.tradeDate, channelType: input.channelType, firstSeenAt: now, lastSeenAt: now, sentCount: 1, suppressedCount: 0, terminal: Boolean(input.terminal),
  };
  eventLedger.set(eventId, next);
  if (next.terminal || ['PAPER_FILLED', 'POSITION_CLOSED', 'SETTLED', 'ARCHIVED'].includes(input.exitStage)) {
    positionTerminal.set(positionKey, input.exitStage);
  }
  return next;
}

export function recordShadowExitSuppressed(eventId: string): void {
  const prev = eventLedger.get(eventId);
  if (!prev) return;
  eventLedger.set(eventId, { ...prev, suppressedCount: prev.suppressedCount + 1, lastSeenAt: new Date().toISOString() });
}

export function resetShadowExitDedupStateForTest(): void { eventLedger.clear(); positionTerminal.clear(); }
