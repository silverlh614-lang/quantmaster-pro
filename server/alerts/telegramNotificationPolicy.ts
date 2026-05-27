// @responsibility Telegram push severity taxonomy; diagnostic suppression router.

import type { AlertPriority } from './telegramClient.js';
import type { AlertTier } from './alertTiers.js';

export type TelegramNotificationSeverity =
  | 'CRITICAL'
  | 'ACTION_REQUIRED'
  | 'TRADE_EVENT'
  | 'SUMMARY'
  | 'DIAGNOSTIC'
  | 'DEBUG_LOG_ONLY';

export type TelegramNotificationTarget =
  | 'USER_SIGNAL_CHANNEL'
  | 'BOT_QUERY_RESPONSE'
  | 'DEBUG_CHANNEL'
  | 'RAILWAY_LOGS';

export interface TelegramNotificationPolicyInput {
  message: string;
  eventType?: string;
  severity?: TelegramNotificationSeverity;
  priority?: AlertPriority;
  tier?: AlertTier;
  category?: string;
  dedupeKey?: string;
  cooldownMs?: number;
  tradeDate?: string;
  section?: string;
  symbol?: string;
  regime?: string;
  stateBucket?: string;
  normalizedReason?: string;
  summaryId?: string;
  eventId?: string;
  executionImpact?: 'NONE' | string;
  marketSignal?: boolean;
  providerIssue?: boolean;
  kisImpact?: 'NONE' | string;
  actionRequired?: boolean;
  tradeEvent?: boolean;
  critical?: boolean;
  diagnosticOnly?: boolean;
  notificationOnly?: boolean;
  targetChannel?: TelegramNotificationTarget;
  nowMs?: number;
}

export interface TelegramNotificationRouteDecision {
  eventType: string;
  severity: TelegramNotificationSeverity;
  targetChannel: TelegramNotificationTarget;
  dedupKey: string;
  cooldownMs: number;
  cooldownRemainingMs: number;
  telegramEligible: boolean;
  shouldSuppress: boolean;
  reason: string;
  priority: AlertPriority;
  tier: AlertTier;
  executionImpact: 'NONE' | string;
  marketSignal: boolean;
  providerIssue: boolean;
  kisImpact: 'NONE' | string;
  actionRequired: boolean;
  tradeEvent: boolean;
  critical: boolean;
  diagnosticOnly: boolean;
  notificationOnly: true;
  tradingLogicChanged: false;
  gateLogicChanged: false;
  orderLogicChanged: false;
  thresholdChanged: false;
  watchlistSelectionChanged: false;
}

export interface TelegramNotificationPolicyStats {
  dateKey: string;
  suppressedCount: number;
  topReasons: Array<{ reason: string; count: number }>;
  actionRequiredCount: number;
  criticalCount: number;
  tradeEventCount: number;
  sentBySeverity: Record<TelegramNotificationSeverity, number>;
  classifiedBySeverity: Record<TelegramNotificationSeverity, number>;
  lastSuppressed?: {
    at: string;
    eventType: string;
    severity: TelegramNotificationSeverity;
    reason: string;
    dedupKey: string;
  };
}

const DEFAULT_COOLDOWN_MS: Record<TelegramNotificationSeverity, number> = {
  CRITICAL: 60_000,
  ACTION_REQUIRED: 10 * 60_000,
  TRADE_EVENT: 0,
  SUMMARY: 30 * 60_000,
  DIAGNOSTIC: 60 * 60_000,
  DEBUG_LOG_ONLY: 0,
};

const sentByDedupKey = new Map<string, number>();
const sentTradeEventIds = new Set<string>();
const suppressionReasons = new Map<string, number>();
const sentBySeverity = new Map<TelegramNotificationSeverity, number>();
const classifiedBySeverity = new Map<TelegramNotificationSeverity, number>();
let statsDateKey = kstDateKey();
let lastSuppressed: TelegramNotificationPolicyStats['lastSuppressed'];

function boolText(value: boolean): 'true' | 'false' {
  return value ? 'true' : 'false';
}

function kstDateKey(ms = Date.now()): string {
  return new Date(ms).toLocaleDateString('sv-SE', { timeZone: 'Asia/Seoul' });
}

function ensureStatsDay(ms: number): string {
  const key = kstDateKey(ms);
  if (key !== statsDateKey) {
    suppressionReasons.clear();
    sentBySeverity.clear();
    classifiedBySeverity.clear();
    lastSuppressed = undefined;
    statsDateKey = key;
  }
  return key;
}

function count(map: Map<string, number>, key: string): void {
  map.set(key, (map.get(key) ?? 0) + 1);
}

function countSeverity(map: Map<TelegramNotificationSeverity, number>, key: TelegramNotificationSeverity): void {
  map.set(key, (map.get(key) ?? 0) + 1);
}

function fieldBool(message: string, key: string): boolean | undefined {
  const match = message.match(new RegExp(`${key}\\s*=\\s*(true|false)`, 'i'));
  if (!match) return undefined;
  return match[1].toLowerCase() === 'true';
}

function fieldValue(message: string, key: string): string | undefined {
  return message.match(new RegExp(`${key}\\s*=\\s*([^\\s\\n]+)`, 'i'))?.[1];
}

function inferEventType(input: TelegramNotificationPolicyInput): string {
  if (input.eventType) return input.eventType;
  if (input.category) return input.category.toUpperCase();
  if (input.dedupeKey) return input.dedupeKey.split(/[:|]/)[0].toUpperCase();
  const firstLine = input.message.split('\n').find((line) => line.trim()) ?? 'TELEGRAM_MESSAGE';
  return firstLine.replace(/<[^>]+>/g, '').replace(/[^\w가-힣]+/g, '_').replace(/^_+|_+$/g, '').slice(0, 48)
    || 'TELEGRAM_MESSAGE';
}

function normalizedToken(value: unknown, fallback: string): string {
  if (value === undefined || value === null || value === '') return fallback;
  return String(value).replace(/\s+/g, '_').slice(0, 80);
}

function buildPolicyDedupKey(
  input: TelegramNotificationPolicyInput,
  eventType: string,
  severity: TelegramNotificationSeverity,
  reason: string,
): string {
  if (input.dedupeKey) return input.dedupeKey;
  const tradeDate = input.tradeDate ?? kstDateKey(input.nowMs);
  return [
    tradeDate,
    `eventType=${eventType}`,
    `severity=${severity}`,
    `section=${normalizedToken(input.section, 'NA')}`,
    `symbol=${normalizedToken(input.symbol, 'NA')}`,
    `regime=${normalizedToken(input.regime, 'NA')}`,
    `normalizedReason=${normalizedToken(input.normalizedReason ?? reason, 'NA')}`,
    `stateBucket=${normalizedToken(input.stateBucket ?? input.summaryId ?? input.eventId, 'NA')}`,
  ].join('|');
}

function hasTextToken(input: TelegramNotificationPolicyInput, token: string): boolean {
  const haystack = `${input.eventType ?? ''} ${input.category ?? ''} ${input.dedupeKey ?? ''} ${input.message}`.toUpperCase();
  return haystack.includes(token);
}

function inferFlags(input: TelegramNotificationPolicyInput): {
  executionImpact: 'NONE' | string;
  marketSignal: boolean;
  providerIssue: boolean;
  kisImpact: 'NONE' | string;
  actionRequired: boolean;
  tradeEvent: boolean;
  critical: boolean;
  diagnosticOnly: boolean;
} {
  const message = input.message;
  const executionImpact = input.executionImpact ?? fieldValue(message, 'executionImpact') ?? 'UNKNOWN';
  const kisImpact = input.kisImpact ?? fieldValue(message, 'kisImpact') ?? 'UNKNOWN';
  const actionRequired = input.actionRequired ?? fieldBool(message, 'actionRequired') ?? false;
  const tradeEvent = input.tradeEvent ?? fieldBool(message, 'tradeEvent') ?? false;
  const diagnosticOnly = input.diagnosticOnly ?? fieldBool(message, 'diagnosticOnly') ?? false;
  const explicitCritical = input.critical ?? fieldBool(message, 'critical') ?? false;
  return {
    executionImpact,
    marketSignal: input.marketSignal ?? fieldBool(message, 'marketSignal') ?? false,
    providerIssue: input.providerIssue ?? fieldBool(message, 'providerIssue') ?? false,
    kisImpact,
    actionRequired,
    tradeEvent,
    critical: explicitCritical || input.priority === 'CRITICAL' || input.tier === 'T1_ALARM',
    diagnosticOnly,
  };
}

function inferSeverity(
  input: TelegramNotificationPolicyInput,
  flags: ReturnType<typeof inferFlags>,
): TelegramNotificationSeverity {
  if (input.severity) return input.severity;
  if (flags.critical) return 'CRITICAL';
  if (flags.tradeEvent || hasTextToken(input, 'FILLED') || hasTextToken(input, 'STOP_LOSS')) return 'TRADE_EVENT';
  if (flags.actionRequired || input.tier === 'T1_ALARM' || input.priority === 'HIGH') return 'ACTION_REQUIRED';
  if (
    flags.diagnosticOnly ||
    hasTextToken(input, 'THRESHOLD_SEARCH') ||
    hasTextToken(input, 'SCAN_BLOCKERS') ||
    hasTextToken(input, 'GATE_FORENSIC') ||
    hasTextToken(input, 'FORENSIC') ||
    hasTextToken(input, 'SOFT_CAP') ||
    hasTextToken(input, 'NO_ENTRY_DIAGNOSTIC')
  ) {
    return 'DIAGNOSTIC';
  }
  if (hasTextToken(input, '[DEBUG]') || hasTextToken(input, '[TRACE]') || hasTextToken(input, 'BATCH_ACCUMULATED')) {
    return 'DEBUG_LOG_ONLY';
  }
  return 'SUMMARY';
}

function priorityForSeverity(severity: TelegramNotificationSeverity, fallback?: AlertPriority): AlertPriority {
  if (fallback) return fallback;
  if (severity === 'CRITICAL') return 'CRITICAL';
  if (severity === 'ACTION_REQUIRED' || severity === 'TRADE_EVENT') return 'HIGH';
  if (severity === 'SUMMARY') return 'LOW';
  return 'LOW';
}

function tierForSeverity(severity: TelegramNotificationSeverity, fallback?: AlertTier): AlertTier {
  if (fallback) return fallback;
  if (severity === 'CRITICAL' || severity === 'ACTION_REQUIRED') return 'T1_ALARM';
  if (severity === 'TRADE_EVENT') return 'T2_REPORT';
  return 'T3_DIGEST';
}

function targetForSeverity(severity: TelegramNotificationSeverity, explicit?: TelegramNotificationTarget): TelegramNotificationTarget {
  if (explicit) return explicit;
  if (severity === 'DEBUG_LOG_ONLY') return 'RAILWAY_LOGS';
  if (severity === 'DIAGNOSTIC') return 'DEBUG_CHANNEL';
  return 'USER_SIGNAL_CHANNEL';
}

function isExplicitNoImpact(flags: ReturnType<typeof inferFlags>): boolean {
  return flags.executionImpact === 'NONE'
    && flags.marketSignal === false
    && flags.providerIssue === false
    && flags.kisImpact === 'NONE'
    && flags.actionRequired === false
    && flags.tradeEvent === false
    && flags.critical === false;
}

function suppressReason(
  input: TelegramNotificationPolicyInput,
  severity: TelegramNotificationSeverity,
  flags: ReturnType<typeof inferFlags>,
  dedupKey: string,
  nowMs: number,
): { shouldSuppress: boolean; reason: string; cooldownRemainingMs: number } {
  if (severity === 'DEBUG_LOG_ONLY') {
    return { shouldSuppress: true, reason: 'DEBUG_LOG_ONLY', cooldownRemainingMs: 0 };
  }
  if (severity === 'DIAGNOSTIC') {
    return { shouldSuppress: true, reason: flags.diagnosticOnly ? 'DIAGNOSTIC_ONLY' : 'DIAGNOSTIC_PUSH_DISABLED', cooldownRemainingMs: 0 };
  }
  const explicitSummary = input.severity === 'SUMMARY' || Boolean(input.summaryId);
  if (!explicitSummary && isExplicitNoImpact(flags)) {
    return { shouldSuppress: true, reason: 'executionImpact_NONE', cooldownRemainingMs: 0 };
  }
  if (severity === 'TRADE_EVENT' && input.eventId && sentTradeEventIds.has(input.eventId)) {
    return { shouldSuppress: true, reason: 'TRADE_EVENT_DUPLICATE_EVENT_ID', cooldownRemainingMs: 0 };
  }
  if (severity === 'CRITICAL') {
    return { shouldSuppress: false, reason: 'CRITICAL_ALWAYS_PUSH', cooldownRemainingMs: 0 };
  }
  const lastSentAt = sentByDedupKey.get(dedupKey);
  const cooldownMs = input.cooldownMs ?? DEFAULT_COOLDOWN_MS[severity];
  if (lastSentAt !== undefined && cooldownMs > 0) {
    const remaining = cooldownMs - (nowMs - lastSentAt);
    if (remaining > 0) {
      return { shouldSuppress: true, reason: 'COOLDOWN_ACTIVE', cooldownRemainingMs: remaining };
    }
  }
  return { shouldSuppress: false, reason: 'TELEGRAM_ELIGIBLE', cooldownRemainingMs: 0 };
}

export function routeTelegramNotification(input: TelegramNotificationPolicyInput): TelegramNotificationRouteDecision {
  const nowMs = input.nowMs ?? Date.now();
  ensureStatsDay(nowMs);
  const eventType = inferEventType(input);
  const flags = inferFlags(input);
  const severity = inferSeverity(input, flags);
  countSeverity(classifiedBySeverity, severity);
  const preReason = flags.diagnosticOnly ? 'DIAGNOSTIC_ONLY' : 'TELEGRAM_ELIGIBLE';
  const dedupKey = buildPolicyDedupKey(input, eventType, severity, preReason);
  const suppression = suppressReason(input, severity, flags, dedupKey, nowMs);
  if (suppression.shouldSuppress) {
    count(suppressionReasons, suppression.reason);
    lastSuppressed = {
      at: new Date(nowMs).toISOString(),
      eventType,
      severity,
      reason: suppression.reason,
      dedupKey,
    };
  }

  return {
    eventType,
    severity,
    targetChannel: targetForSeverity(severity, input.targetChannel),
    dedupKey,
    cooldownMs: input.cooldownMs ?? DEFAULT_COOLDOWN_MS[severity],
    cooldownRemainingMs: Math.max(0, Math.ceil(suppression.cooldownRemainingMs)),
    telegramEligible: !suppression.shouldSuppress,
    shouldSuppress: suppression.shouldSuppress,
    reason: suppression.reason,
    priority: priorityForSeverity(severity, input.priority),
    tier: tierForSeverity(severity, input.tier),
    executionImpact: flags.executionImpact,
    marketSignal: flags.marketSignal,
    providerIssue: flags.providerIssue,
    kisImpact: flags.kisImpact,
    actionRequired: flags.actionRequired,
    tradeEvent: flags.tradeEvent,
    critical: flags.critical,
    diagnosticOnly: flags.diagnosticOnly,
    notificationOnly: true,
    tradingLogicChanged: false,
    gateLogicChanged: false,
    orderLogicChanged: false,
    thresholdChanged: false,
    watchlistSelectionChanged: false,
  };
}

export function recordTelegramNotificationSent(decision: TelegramNotificationRouteDecision, eventId?: string, nowMs = Date.now()): void {
  sentByDedupKey.set(decision.dedupKey, nowMs);
  if (decision.severity === 'TRADE_EVENT' && eventId) sentTradeEventIds.add(eventId);
  countSeverity(sentBySeverity, decision.severity);
}

function safetyFields(decision: TelegramNotificationRouteDecision): string {
  return [
    `executionImpact=${decision.executionImpact}`,
    `marketSignal=${boolText(decision.marketSignal)}`,
    `providerIssue=${boolText(decision.providerIssue)}`,
    `kisImpact=${decision.kisImpact}`,
    'notificationOnly=true',
    'tradingLogicChanged=false',
    'gateLogicChanged=false',
    'orderLogicChanged=false',
    'thresholdChanged=false',
    'watchlistSelectionChanged=false',
  ].join(' ');
}

export function formatNotificationClassifiedLog(decision: TelegramNotificationRouteDecision): string {
  return [
    '[NOTIFICATION_CLASSIFIED]',
    `eventType=${decision.eventType}`,
    `severity=${decision.severity}`,
    `actionRequired=${boolText(decision.actionRequired)}`,
    `tradeEvent=${boolText(decision.tradeEvent)}`,
    `diagnosticOnly=${boolText(decision.diagnosticOnly)}`,
    safetyFields(decision),
  ].join(' ');
}

export function formatTelegramNotificationSuppressedLog(decision: TelegramNotificationRouteDecision): string {
  return [
    '[TELEGRAM_NOTIFICATION_SUPPRESSED]',
    `eventType=${decision.eventType}`,
    `severity=${decision.severity}`,
    `reason=${decision.reason}`,
    `dedupKey=${decision.dedupKey}`,
    `cooldownRemainingMs=${decision.cooldownRemainingMs}`,
    'telegramSent=false',
    safetyFields(decision),
  ].join(' ');
}

export function formatTelegramNotificationRoutedLog(decision: TelegramNotificationRouteDecision): string {
  return [
    '[TELEGRAM_NOTIFICATION_ROUTED]',
    `eventType=${decision.eventType}`,
    `severity=${decision.severity}`,
    `targetChannel=${decision.targetChannel}`,
    `telegramEligible=${boolText(decision.telegramEligible)}`,
    safetyFields(decision),
  ].join(' ');
}

export function formatTelegramNotificationSentLog(decision: TelegramNotificationRouteDecision): string {
  return [
    '[TELEGRAM_NOTIFICATION_SENT]',
    `eventType=${decision.eventType}`,
    `severity=${decision.severity}`,
    `targetChannel=${decision.targetChannel}`,
    `dedupKey=${decision.dedupKey}`,
    'telegramSent=true',
    safetyFields(decision),
  ].join(' ');
}

function emptySeverityRecord(): Record<TelegramNotificationSeverity, number> {
  return {
    CRITICAL: 0,
    ACTION_REQUIRED: 0,
    TRADE_EVENT: 0,
    SUMMARY: 0,
    DIAGNOSTIC: 0,
    DEBUG_LOG_ONLY: 0,
  };
}

export function getTelegramNotificationPolicyStats(now: Date = new Date()): TelegramNotificationPolicyStats {
  const dateKey = ensureStatsDay(now.getTime());
  const suppressedCount = [...suppressionReasons.values()].reduce((sum, value) => sum + value, 0);
  return {
    dateKey,
    suppressedCount,
    topReasons: [...suppressionReasons.entries()]
      .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
      .slice(0, 10)
      .map(([reason, countValue]) => ({ reason, count: countValue })),
    actionRequiredCount: sentBySeverity.get('ACTION_REQUIRED') ?? 0,
    criticalCount: sentBySeverity.get('CRITICAL') ?? 0,
    tradeEventCount: sentBySeverity.get('TRADE_EVENT') ?? 0,
    sentBySeverity: { ...emptySeverityRecord(), ...Object.fromEntries(sentBySeverity) },
    classifiedBySeverity: { ...emptySeverityRecord(), ...Object.fromEntries(classifiedBySeverity) },
    lastSuppressed,
  };
}

export function formatTelegramNotificationPolicyStats(stats = getTelegramNotificationPolicyStats()): string {
  return [
    `[NOTIFICATION_DAILY_SUMMARY_AGGREGATED]`,
    `dateKey=${stats.dateKey}`,
    `suppressedCount=${stats.suppressedCount}`,
    `topReasons=${stats.topReasons.map((item) => `${item.reason}:${item.count}`).join(',') || 'N/A'}`,
    `actionRequiredCount=${stats.actionRequiredCount}`,
    `criticalCount=${stats.criticalCount}`,
    `tradeEventCount=${stats.tradeEventCount}`,
    `sentBySeverity=${JSON.stringify(stats.sentBySeverity)}`,
    `classifiedBySeverity=${JSON.stringify(stats.classifiedBySeverity)}`,
    `lastSuppressed=${stats.lastSuppressed ? JSON.stringify(stats.lastSuppressed) : 'N/A'}`,
    'executionImpact=NONE marketSignal=false providerIssue=false notificationOnly=true tradingLogicChanged=false gateLogicChanged=false orderLogicChanged=false thresholdChanged=false watchlistSelectionChanged=false',
  ].join('\n');
}

export function __resetTelegramNotificationPolicyForTests(): void {
  sentByDedupKey.clear();
  sentTradeEventIds.clear();
  suppressionReasons.clear();
  sentBySeverity.clear();
  classifiedBySeverity.clear();
  lastSuppressed = undefined;
  statsDateKey = kstDateKey();
}
