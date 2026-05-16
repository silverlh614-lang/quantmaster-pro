// @responsibility Telegram event taxonomy router for ADR-0466.
import {
  dispatchAlert,
  ChannelSemantic,
  type AlertSeverity,
  type DispatchAlertOptions,
} from './alertRouter.js';
import { AlertCategory } from './alertCategories.js';
import { sendPrivateAlert, type TelegramAlertOptions } from './telegramClient.js';
import { incrementChannelStat } from '../persistence/channelStatsRepo.js';

export type TelegramEventType =
  | 'BUY_SIGNAL'
  | 'STRONG_BUY_SIGNAL'
  | 'BUY_FILLED'
  | 'SELL_SIGNAL'
  | 'SELL_FILLED'
  | 'STOP_LOSS_HIT'
  | 'TARGET_HIT'
  | 'PARTIAL_EXIT'
  | 'OCO_FAILURE'
  | 'ORDER_REJECTED'
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
  'SELL_SIGNAL',
  'SELL_FILLED',
  'STOP_LOSS_HIT',
  'TARGET_HIT',
  'PARTIAL_EXIT',
  'OCO_FAILURE',
  'ORDER_REJECTED',
  'CRITICAL_ERROR',
]);

const SIGNAL_EVENTS = new Set<TelegramEventType>([
  'BUY_SIGNAL',
  'STRONG_BUY_SIGNAL',
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
  SELL_SIGNAL: 'HIGH',
  SELL_FILLED: 'HIGH',
  STOP_LOSS_HIT: 'CRITICAL',
  TARGET_HIT: 'HIGH',
  PARTIAL_EXIT: 'HIGH',
  OCO_FAILURE: 'CRITICAL',
  ORDER_REJECTED: 'CRITICAL',
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

export async function emitTelegramEvent(event: TelegramEvent): Promise<number | undefined> {
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
      return await sendPrivateAlert(event.message, options);
    }

    return await dispatchAlert(route, event.message, {
      severity,
      dedupeKey,
      eventType: event.type,
      cooldownMs: event.cooldownMs,
      delivery: event.delivery,
      disableNotification: event.disableNotification,
    });
  } catch (error) {
    console.error(
      `[TELEGRAM_EVENT_ROUTER_FAILED] eventType=${event.type} route=${route} executionImpact=NONE reason=${
        error instanceof Error ? error.message : String(error)
      }`,
    );
    return undefined;
  }
}
