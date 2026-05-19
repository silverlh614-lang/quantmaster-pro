// @responsibility Telegram event taxonomy router for ADR-0466.
import {
  dispatchAlert,
  ChannelSemantic,
  PUBLIC_SIGNAL_DISCLAIMER,
  type AlertSeverity,
  type DispatchAlertOptions,
} from './alertRouter.js';
import { AlertCategory } from './alertCategories.js';
import { sendPrivateAlert, type TelegramAlertOptions } from './telegramClient.js';
import { incrementChannelStat } from '../persistence/channelStatsRepo.js';
import { appendNotificationLedger, updateNotificationLedgerState } from '../persistence/notificationLedgerRepo.js';

export type TelegramEventType =
  | 'BUY_SIGNAL'
  | 'STRONG_BUY_SIGNAL'
  | 'BUY_FILLED'
  | 'SELL_SIGNAL'
  | 'SELL_WATCH'
  | 'TAKE_PROFIT_WATCH'
  | 'STOP_LOSS_WATCH'
  | 'SHADOW_BUY_SIGNAL'
  | 'SHADOW_SELL_SIGNAL'
  | 'SELL_FILLED'
  | 'STOP_LOSS_HIT'
  | 'TARGET_HIT'
  | 'PARTIAL_EXIT'
  | 'OCO_FAILURE'
  | 'ORDER_REJECTED'
  | 'KILL_SWITCH'
  | 'HARD_BLOCK'
  | 'SELL_ONLY_ENTERED'
  | 'WATCHLIST_ADDED'
  | 'WATCHLIST_REMOVED'
  | 'SCAN_SUMMARY'
  | 'NEW_HIGH_SCAN'
  | 'MARKET_BRIEFING'
  | 'REGIME_CHANGE'
  | 'MACRO_DIGEST'
  | 'SECTOR_ROTATION'
  | 'FOREIGN_FLOW'
  | 'PROVIDER_HEALTH'
  | 'SHADOW_SUMMARY'
  | 'COUNTERFACTUAL_RESULT'
  | 'LEARNING_REPORT'
  | 'PERFORMANCE_REPORT'
  | 'SYSTEM_HEALTH'
  | 'CRITICAL_ERROR'
  | 'ACCOUNT_BALANCE'
  | 'CREDENTIAL_FAILURE';

export type TelegramEventRoute = AlertCategory | 'PRIVATE';

export interface TelegramEvent {
  type: TelegramEventType;
  message: string;
  severity?: AlertSeverity;
  dedupeKey?: string;
  cooldownMs?: number;
  delivery?: DispatchAlertOptions['delivery'];
  disableNotification?: boolean;
  metadata?: Record<string, unknown>;
}

const EXECUTION_EVENTS = new Set<TelegramEventType>([
  'BUY_FILLED',
  'SELL_FILLED',
  'STOP_LOSS_HIT',
  'TARGET_HIT',
  'PARTIAL_EXIT',
  'OCO_FAILURE',
  'ORDER_REJECTED',
  'KILL_SWITCH',
  'HARD_BLOCK',
  'SELL_ONLY_ENTERED',
  'CRITICAL_ERROR',
]);

const SIGNAL_EVENTS = new Set<TelegramEventType>([
  'BUY_SIGNAL',
  'STRONG_BUY_SIGNAL',
  'SELL_SIGNAL',
  'SELL_WATCH',
  'TAKE_PROFIT_WATCH',
  'STOP_LOSS_WATCH',
  'SHADOW_BUY_SIGNAL',
  'SHADOW_SELL_SIGNAL',
  'WATCHLIST_ADDED',
  'WATCHLIST_REMOVED',
  'SCAN_SUMMARY',
  'NEW_HIGH_SCAN',
]);

const REGIME_EVENTS = new Set<TelegramEventType>([
  'MARKET_BRIEFING',
  'REGIME_CHANGE',
  'MACRO_DIGEST',
  'SECTOR_ROTATION',
  'FOREIGN_FLOW',
  'PROVIDER_HEALTH',
]);

const JOURNAL_EVENTS = new Set<TelegramEventType>([
  'SHADOW_SUMMARY',
  'COUNTERFACTUAL_RESULT',
  'LEARNING_REPORT',
  'PERFORMANCE_REPORT',
  'SYSTEM_HEALTH',
]);

const PRIVATE_EVENTS = new Set<TelegramEventType>([
  'ACCOUNT_BALANCE',
  'CREDENTIAL_FAILURE',
]);

const DEFAULT_SEVERITY: Record<TelegramEventType, AlertSeverity> = {
  BUY_SIGNAL: 'NORMAL',
  STRONG_BUY_SIGNAL: 'HIGH',
  BUY_FILLED: 'HIGH',
  SELL_SIGNAL: 'NORMAL',
  SELL_WATCH: 'NORMAL',
  TAKE_PROFIT_WATCH: 'NORMAL',
  STOP_LOSS_WATCH: 'NORMAL',
  SHADOW_BUY_SIGNAL: 'NORMAL',
  SHADOW_SELL_SIGNAL: 'NORMAL',
  SELL_FILLED: 'HIGH',
  STOP_LOSS_HIT: 'CRITICAL',
  TARGET_HIT: 'HIGH',
  PARTIAL_EXIT: 'HIGH',
  OCO_FAILURE: 'CRITICAL',
  ORDER_REJECTED: 'CRITICAL',
  KILL_SWITCH: 'CRITICAL',
  HARD_BLOCK: 'CRITICAL',
  SELL_ONLY_ENTERED: 'HIGH',
  WATCHLIST_ADDED: 'NORMAL',
  WATCHLIST_REMOVED: 'LOW',
  SCAN_SUMMARY: 'NORMAL',
  NEW_HIGH_SCAN: 'NORMAL',
  MARKET_BRIEFING: 'NORMAL',
  REGIME_CHANGE: 'HIGH',
  MACRO_DIGEST: 'NORMAL',
  SECTOR_ROTATION: 'NORMAL',
  FOREIGN_FLOW: 'NORMAL',
  PROVIDER_HEALTH: 'NORMAL',
  SHADOW_SUMMARY: 'NORMAL',
  COUNTERFACTUAL_RESULT: 'NORMAL',
  LEARNING_REPORT: 'NORMAL',
  PERFORMANCE_REPORT: 'NORMAL',
  SYSTEM_HEALTH: 'LOW',
  CRITICAL_ERROR: 'CRITICAL',
  ACCOUNT_BALANCE: 'HIGH',
  CREDENTIAL_FAILURE: 'CRITICAL',
};

export function routeTelegramEvent(type: TelegramEventType): TelegramEventRoute {
  if (PRIVATE_EVENTS.has(type)) return 'PRIVATE';
  if (EXECUTION_EVENTS.has(type)) return ChannelSemantic.EXECUTION;
  if (SIGNAL_EVENTS.has(type)) return ChannelSemantic.SIGNAL;
  if (REGIME_EVENTS.has(type)) return ChannelSemantic.REGIME;
  if (JOURNAL_EVENTS.has(type)) return ChannelSemantic.JOURNAL;
  return ChannelSemantic.JOURNAL;
}

function buildDedupeKey(event: TelegramEvent): string {
  if (event.dedupeKey) return event.dedupeKey;
  const keyParts = [
    event.type,
    event.metadata?.symbol,
    event.metadata?.stockCode,
    event.metadata?.scope,
  ].filter(Boolean);
  return keyParts.length > 1 ? keyParts.join(':') : event.type;
}

const SHADOW_SIGNAL_EVENTS = new Set<TelegramEventType>([
  'SHADOW_BUY_SIGNAL',
  'SHADOW_SELL_SIGNAL',
]);

function decorateSignalMessage(event: TelegramEvent): string {
  const lines = [event.message];
  if (SHADOW_SIGNAL_EVENTS.has(event.type)) {
    const engineMode = String(event.metadata?.engineMode ?? 'UNKNOWN');
    const reason = String(event.metadata?.blockedBy ?? event.metadata?.reason ?? 'N/A');
    if (!event.message.includes('[SHADOW / 주문 없음]')) lines.unshift('[SHADOW / 주문 없음]');
    if (!event.message.includes('executionImpact=NONE')) lines.push('executionImpact=NONE');
    if (!event.message.includes('engineMode=')) lines.push(`engineMode=${engineMode}`);
    if (!event.message.includes('blockedBy=') && !event.message.includes('reason=')) lines.push(`blockedBy=${reason}`);
  }
  const joined = lines.filter(Boolean).join('\n');
  return joined.includes(PUBLIC_SIGNAL_DISCLAIMER)
    ? joined
    : `${joined}\n\n${PUBLIC_SIGNAL_DISCLAIMER}`;
}

function decorateExecutionMessage(event: TelegramEvent): string {
  if (/\[(EXECUTION|RISK|ORDER) \//.test(event.message)) return event.message;
  const prefix = executionPrefix(event.type);
  return prefix ? `${prefix}\n${event.message}` : event.message;
}

function executionPrefix(type: TelegramEventType): string | null {
  switch (type) {
    case 'BUY_FILLED':
    case 'SELL_FILLED':
    case 'PARTIAL_EXIT':
    case 'TARGET_HIT':
      return '[EXECUTION / 실제 체결]';
    case 'STOP_LOSS_HIT':
      return '[RISK / 손절 실행]';
    case 'OCO_FAILURE':
    case 'ORDER_REJECTED':
      return '[ORDER / 주문 실패]';
    case 'KILL_SWITCH':
    case 'HARD_BLOCK':
    case 'SELL_ONLY_ENTERED':
    case 'CRITICAL_ERROR':
      return '[RISK / 위험 알림]';
    default:
      return null;
  }
}

export async function emitTelegramEvent(event: TelegramEvent): Promise<number | undefined> {
  const eventId = `evt-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  await appendNotificationLedger({ id: eventId, at: new Date().toISOString(), source: 'emitTelegramEvent', eventType: event.type, channelSemantic: routeTelegramEvent(event.type), deliveryState: 'CREATED', message: event.message, dedupeKey: event.dedupeKey, cooldownMs: event.cooldownMs, metadata: event.metadata });
  const route = routeTelegramEvent(event.type);
  const severity = event.severity ?? DEFAULT_SEVERITY[event.type];
  const dedupeKey = buildDedupeKey(event);

  try {
    if (route === 'PRIVATE') {
      incrementChannelStat(AlertCategory.SYSTEM, 'emitted', { eventType: event.type });
      incrementChannelStat(AlertCategory.SYSTEM, 'directDmBypass', { eventType: event.type });
      const options: TelegramAlertOptions = {
        priority: severity,
        dedupeKey,
        cooldownMs: event.cooldownMs,
        category: event.type,
      };
      const msgId = await sendPrivateAlert(event.message, options);
      await updateNotificationLedgerState(eventId, { at: new Date().toISOString(), eventType: event.type, deliveryState: msgId !== undefined ? 'PRIVATE_SENT' : 'FAILED', success: msgId !== undefined, messageId: msgId });
      return msgId;
    }

    const routedMessage = route === ChannelSemantic.SIGNAL
      ? decorateSignalMessage(event)
      : route === ChannelSemantic.EXECUTION
        ? decorateExecutionMessage(event)
        : event.message;

    return await dispatchAlert(route, routedMessage, {
      ledgerId: eventId,
      severity,
      dedupeKey,
      eventType: event.type,
      cooldownMs: event.cooldownMs,
      delivery: event.delivery,
      disableNotification: event.disableNotification,
    });
  } catch (error) {
    await updateNotificationLedgerState(eventId, { at: new Date().toISOString(), eventType: event.type, deliveryState: 'FAILED', success: false, error: error instanceof Error ? error.message : String(error) });
    console.error(
      `[TELEGRAM_EVENT_ROUTER_FAILED] eventType=${event.type} route=${route} executionImpact=NONE reason=${
        error instanceof Error ? error.message : String(error)
      }`,
    );
    return undefined;
  }
}
