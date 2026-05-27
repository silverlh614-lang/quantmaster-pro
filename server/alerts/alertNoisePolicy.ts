// @responsibility ADR-0468 Telegram alert noise suppression policy.

export type AlertLevel = 'SILENT' | 'DIGEST' | 'NOTICE' | 'WARNING' | 'CRITICAL';

export type AlertNoiseEventType =
  | 'WATCHLIST_SATURATION'
  | 'WATCHLIST_CANDIDATE_REJECTED_CAPACITY'
  | 'KIS_TOKEN_EXPIRY'
  | 'KIS_TOKEN_REFRESH_SUCCESS'
  | 'KIS_TOKEN_REFRESH_FAILED'
  | 'KIS_TOKEN_EXPIRED_IMPACTED'
  | 'PROVIDER_FAILURE'
  | 'PROVIDER_RECOVERY'
  | 'ENGINE_STATE'
  | 'SHADOW_SIGNAL'
  | 'SHADOW_EXECUTION_COMPLETED'
  | 'HEALTH_OK'
  | 'HEALTH_FAILURE'
  | 'HEALTH_RECOVERY'
  | 'SCHEDULER_OK'
  | 'BACKUP_SUCCESS'
  | 'BACKUP_FAILURE'
  | 'TELEGRAM_HTML_RETRY'
  | 'SCAN_EMPTY'
  | 'SCAN_COMPLETED'
  | 'MAINTENANCE_SUCCESS'
  | string;

export interface AlertNoiseEvent {
  eventType: AlertNoiseEventType;
  status?: string;
  channel?: string;
  provider?: string;
  providerTier?: 'P0' | 'P1' | 'P2' | 'P3' | 'P4' | string;
  failureCount?: number;
  consecutiveFailures?: number;
  tokenExpiresInSeconds?: number;
  expiresAt?: string;
  refreshFailed?: boolean;
  executionImpact?: 'NONE' | string;
  queryImpacted?: boolean;
  orderImpacted?: boolean;
  accountImpacted?: boolean;
  state?: 'NORMAL' | 'SELL_ONLY' | 'HARD_BLOCK' | string;
  previousState?: string;
  symbol?: string;
  strategy?: string;
  session?: string;
  candidateStrength?: 'STRONG_BUY' | 'BUY' | string;
  candidateRejectedDueToCapacity?: boolean;
  plainRetrySuccess?: boolean;
  templateId?: string;
  templateFailureCount?: number;
  nowMs?: number;
  dedupeHint?: string;
}

export type NoiseDecision = {
  level: AlertLevel;
  shouldSendNow: boolean;
  shouldDigest: boolean;
  reason: string;
  dedupeKey: string;
  ttlSeconds: number;
};

export interface AlertNoiseStats {
  dateKey: string;
  suppressedByReason: Record<string, number>;
  digestedByChannel: Record<string, number>;
  sentByLevel: Record<AlertLevel, number>;
  topNoisyEventTypes: Array<{ eventType: string; count: number }>;
  lastSuppressedEvent?: {
    at: string;
    eventType: string;
    reason: string;
    dedupeKey: string;
    level: AlertLevel;
  };
  activeDedupeKeysCount: number;
}

interface DedupeEntry {
  expiresAtMs: number;
  decision: NoiseDecision;
}

const SIX_HOURS = 6 * 60 * 60;
const TRADING_DAY = 7 * 60 * 60;
const ONE_HOUR = 60 * 60;
const DEFAULT_TTL = 5 * 60;

const dedupe = new Map<string, DedupeEntry>();
const lastStateByKey = new Map<string, string>();
const suppressedByReason = new Map<string, number>();
const digestedByChannel = new Map<string, number>();
const sentByLevel = new Map<AlertLevel, number>();
const noisyEventTypes = new Map<string, number>();
let lastSuppressedEvent: AlertNoiseStats['lastSuppressedEvent'];
let statsDateKey = kstDateKey();

function nowMs(event: AlertNoiseEvent): number {
  return event.nowMs ?? Date.now();
}

function kstDateKey(ms = Date.now()): string {
  return new Date(ms).toLocaleDateString('sv-SE', { timeZone: 'Asia/Seoul' });
}

function count(map: Map<string, number>, key: string): void {
  map.set(key, (map.get(key) ?? 0) + 1);
}

function resetDailyStats(): void {
  suppressedByReason.clear();
  digestedByChannel.clear();
  sentByLevel.clear();
  noisyEventTypes.clear();
  lastSuppressedEvent = undefined;
}

function ensureStatsDay(ms: number): string {
  const key = kstDateKey(ms);
  if (key !== statsDateKey) {
    resetDailyStats();
    statsDateKey = key;
  }
  return key;
}

function prune(now: number): void {
  for (const [key, entry] of dedupe) {
    if (entry.expiresAtMs <= now) dedupe.delete(key);
  }
}

function isDedupeActive(key: string, now: number): boolean {
  const entry = dedupe.get(key);
  if (!entry) return false;
  if (entry.expiresAtMs <= now) {
    dedupe.delete(key);
    return false;
  }
  return true;
}

function remember(decision: NoiseDecision, event: AlertNoiseEvent): NoiseDecision {
  const at = nowMs(event);
  prune(at);
  ensureStatsDay(at);
  if (decision.ttlSeconds > 0) {
    dedupe.set(decision.dedupeKey, {
      expiresAtMs: at + decision.ttlSeconds * 1000,
      decision,
    });
  }

  if (decision.shouldSendNow) {
    const prev = sentByLevel.get(decision.level) ?? 0;
    sentByLevel.set(decision.level, prev + 1);
  } else if (decision.shouldDigest) {
    count(digestedByChannel, event.channel ?? 'CH4_JOURNAL');
    count(noisyEventTypes, event.eventType);
  } else {
    count(suppressedByReason, decision.reason);
    count(noisyEventTypes, event.eventType);
    lastSuppressedEvent = {
      at: new Date(at).toISOString(),
      eventType: event.eventType,
      reason: decision.reason,
      dedupeKey: decision.dedupeKey,
      level: decision.level,
    };
  }
  return decision;
}

function decision(
  event: AlertNoiseEvent,
  level: AlertLevel,
  reason: string,
  dedupeKey: string,
  ttlSeconds: number,
): NoiseDecision {
  return remember({
    level,
    shouldSendNow: level === 'NOTICE' || level === 'WARNING' || level === 'CRITICAL',
    shouldDigest: level === 'DIGEST',
    reason,
    dedupeKey,
    ttlSeconds,
  }, event);
}

function silent(event: AlertNoiseEvent, reason: string, dedupeKey: string, ttlSeconds = DEFAULT_TTL): NoiseDecision {
  return decision(event, 'SILENT', reason, dedupeKey, ttlSeconds);
}

function digest(event: AlertNoiseEvent, reason: string, dedupeKey: string, ttlSeconds = DEFAULT_TTL): NoiseDecision {
  return decision(event, 'DIGEST', reason, dedupeKey, ttlSeconds);
}

function notice(event: AlertNoiseEvent, reason: string, dedupeKey: string, ttlSeconds = DEFAULT_TTL): NoiseDecision {
  return decision(event, 'NOTICE', reason, dedupeKey, ttlSeconds);
}

function warning(event: AlertNoiseEvent, reason: string, dedupeKey: string, ttlSeconds = DEFAULT_TTL): NoiseDecision {
  return decision(event, 'WARNING', reason, dedupeKey, ttlSeconds);
}

function critical(event: AlertNoiseEvent, reason: string, dedupeKey: string, ttlSeconds = 0): NoiseDecision {
  return decision(event, 'CRITICAL', reason, dedupeKey, ttlSeconds);
}

function expiresBucket(event: AlertNoiseEvent): string {
  if (event.expiresAt) return event.expiresAt.slice(0, 13);
  const seconds = event.tokenExpiresInSeconds;
  if (seconds === undefined) return 'NA';
  if (seconds <= 30 * 60) return 'LT_30M';
  if (seconds <= 12 * 60 * 60) return 'LT_12H';
  return 'GT_12H';
}

function kisTokenKey(status: string, event: AlertNoiseEvent): string {
  return `KIS_TOKEN:${event.status ?? status}:${expiresBucket(event)}`;
}

function failureCount(event: AlertNoiseEvent): number {
  return Math.max(0, Math.trunc(event.consecutiveFailures ?? event.failureCount ?? 0));
}

function providerExecutionRelevant(event: AlertNoiseEvent): boolean {
  const tier = String(event.providerTier ?? '').toUpperCase();
  return ['P0', 'P1', 'P2'].includes(tier)
    || event.executionImpact !== undefined && event.executionImpact !== 'NONE'
    || event.queryImpacted === true
    || event.orderImpacted === true
    || event.accountImpacted === true;
}

function clearKisTokenDedupe(): void {
  for (const key of [...dedupe.keys()]) {
    if (key.startsWith('KIS_TOKEN:')) dedupe.delete(key);
  }
}

function isAlertNoisePolicyEnforced(): boolean {
  if (process.env.TELEGRAM_ALERT_NOISE_POLICY === 'disabled') return false;
  if (process.env.TELEGRAM_ALERT_NOISE_POLICY === 'enforce') return true;
  if (process.env.ALERT_NOISE_POLICY_ENFORCED === 'true') return true;
  return process.env.NODE_ENV === 'test' || process.env.VITEST === 'true';
}

function passThroughNoiseDecision(event: AlertNoiseEvent): NoiseDecision {
  return remember({
    level: 'NOTICE',
    shouldSendNow: true,
    shouldDigest: false,
    reason: 'ALERT_NOISE_POLICY_DISABLED_PASSTHROUGH',
    dedupeKey: `NOISE_POLICY_DISABLED:${event.eventType}:${event.dedupeHint ?? event.symbol ?? event.templateId ?? event.channel ?? 'GLOBAL'}`,
    ttlSeconds: 0,
  }, event);
}

type NoisePolicyHandler = (event: AlertNoiseEvent, ts: number) => NoiseDecision;

function handleWatchlistCandidateRejectedCapacity(event: AlertNoiseEvent, ts: number): NoiseDecision {
  const strong = event.candidateStrength === 'STRONG_BUY' || event.candidateStrength === 'BUY';
  const key = `WATCHLIST_CAPACITY_REJECT:${event.symbol ?? 'UNKNOWN'}:${event.session ?? 'ANY'}`;
  if (strong && event.candidateRejectedDueToCapacity) {
    if (isDedupeActive(key, ts)) return silent(event, 'WATCHLIST_CAPACITY_REJECT_DEDUPED', key, SIX_HOURS);
    return notice(event, 'WATCHLIST_CAPACITY_REJECTED_STRONG_CANDIDATE', key, SIX_HOURS);
  }
  return digest(event, 'WATCHLIST_CAPACITY_REJECTED_DIGEST_ONLY', key, SIX_HOURS);
}

function handleWatchlistSaturation(event: AlertNoiseEvent, ts: number): NoiseDecision {
  const key = `WATCHLIST_SATURATION:${event.dedupeHint ?? event.session ?? 'GLOBAL'}`;
  const status = String(event.status ?? '').toUpperCase();
  const nearHardCap = String(event.dedupeHint ?? '').startsWith('45~') || String(event.dedupeHint ?? '').startsWith('50');
  if (status === 'HARD_CAP' || nearHardCap) {
    if (isDedupeActive(key, ts)) return silent(event, 'WATCHLIST_HARD_CAP_ACTION_REQUIRED_DEDUPED', key, 15 * 60);
    return warning(event, 'WATCHLIST_HARD_CAP_ACTION_REQUIRED', key, 15 * 60);
  }
  if (isDedupeActive(key, ts)) return silent(event, 'WATCHLIST_SATURATION_DEDUPED', key, SIX_HOURS);
  return digest(event, 'WATCHLIST_CAPACITY_DIGEST_ONLY', key, SIX_HOURS);
}

function handleKisTokenRefreshSuccess(event: AlertNoiseEvent): NoiseDecision {
  clearKisTokenDedupe();
  return silent(event, 'KIS_TOKEN_REFRESH_SUCCESS_SILENT', kisTokenKey('REFRESH_SUCCESS', event), ONE_HOUR);
}

function handleKisTokenExpiry(event: AlertNoiseEvent): NoiseDecision {
  const key = kisTokenKey('EXPIRY', event);
  if ((event.tokenExpiresInSeconds ?? Number.POSITIVE_INFINITY) <= 30 * 60 && event.refreshFailed) {
    return critical(event, 'KIS_TOKEN_30M_REFRESH_FAILED_CRITICAL', key);
  }
  if ((event.tokenExpiresInSeconds ?? Number.POSITIVE_INFINITY) <= 12 * 60 * 60) {
    return silent(event, 'KIS_TOKEN_12H_EXPIRY_SILENT', key, ONE_HOUR);
  }
  return silent(event, 'KIS_TOKEN_EXPIRY_NO_ACTION', key, ONE_HOUR);
}

function handleKisTokenRefreshFailed(event: AlertNoiseEvent): NoiseDecision {
  const key = kisTokenKey('REFRESH_FAILED', event);
  if ((event.tokenExpiresInSeconds ?? Number.POSITIVE_INFINITY) <= 30 * 60) {
    return critical(event, 'KIS_TOKEN_30M_REFRESH_FAILED_CRITICAL', key);
  }
  const failures = failureCount(event);
  if (failures <= 1) return digest(event, 'KIS_TOKEN_REFRESH_FAILED_DIGEST', key, ONE_HOUR);
  return warning(event, 'KIS_TOKEN_REFRESH_FAILED_STREAK_WARNING', key, ONE_HOUR);
}

function handleProviderFailure(event: AlertNoiseEvent): NoiseDecision {
  const provider = event.provider ?? 'UNKNOWN';
  const key = `PROVIDER_FAILURE:${provider}:${event.providerTier ?? 'NA'}`;
  const failures = failureCount(event);
  if (providerExecutionRelevant(event)) return warning(event, 'PROVIDER_EXECUTION_DATA_IMPACT_WARNING', key, ONE_HOUR);
  if (failures >= 3) return digest(event, 'PROVIDER_FAILURE_STREAK_DIGEST', key, ONE_HOUR);
  return silent(event, 'PROVIDER_SINGLE_OR_DIAGNOSTIC_FAILURE_SILENT', key, DEFAULT_TTL);
}

function handleEngineState(event: AlertNoiseEvent): NoiseDecision {
  const state = event.state ?? 'UNKNOWN';
  const key = `ENGINE_STATE:${event.dedupeHint ?? 'GLOBAL'}`;
  const previous = event.previousState ?? lastStateByKey.get(key);
  lastStateByKey.set(key, state);
  if (state === 'SELL_ONLY' || previous === 'SELL_ONLY') {
    return silent(event, 'LEGACY_SELL_ONLY_STATE_INTERNAL_ONLY', `${key}:${previous ?? 'UNKNOWN'}->${state}`, TRADING_DAY);
  }
  if ((state === 'HARD_BLOCK' || previous === 'HARD_BLOCK') && previous !== state) {
    return notice(event, 'ENGINE_STATE_TRANSITION_NOTICE', `${key}:${previous ?? 'UNKNOWN'}->${state}`, TRADING_DAY);
  }
  return silent(event, 'ENGINE_STATE_MAINTAINED_SUPPRESSED', `${key}:${state}`, TRADING_DAY);
}

function handleShadowSignal(event: AlertNoiseEvent, ts: number): NoiseDecision {
  const key = `SHADOW_SIGNAL:${event.symbol ?? 'UNKNOWN'}:${event.strategy ?? 'UNKNOWN'}:${event.session ?? 'ANY'}`;
  if (isDedupeActive(key, ts)) return silent(event, 'SHADOW_SIGNAL_DEDUPED_EXECUTION_IMPACT_NONE', key, SIX_HOURS);
  return digest(event, 'SHADOW_SIGNAL_DIGEST_EXECUTION_IMPACT_NONE', key, SIX_HOURS);
}

function handleSilentOkEvent(event: AlertNoiseEvent): NoiseDecision {
  return silent(event, `${event.eventType}_SILENT`, `${event.eventType}:${event.dedupeHint ?? event.channel ?? 'GLOBAL'}`, DEFAULT_TTL);
}

function handleFailureUntilStreak(event: AlertNoiseEvent): NoiseDecision {
  return failureCount(event) >= 3
    ? warning(event, `${event.eventType}_STREAK_WARNING`, `${event.eventType}:${event.dedupeHint ?? 'GLOBAL'}`, ONE_HOUR)
    : digest(event, `${event.eventType}_DIGEST_UNTIL_STREAK`, `${event.eventType}:${event.dedupeHint ?? 'GLOBAL'}`, ONE_HOUR);
}

function handleTelegramHtmlRetry(event: AlertNoiseEvent): NoiseDecision {
  const key = `TELEGRAM_TEMPLATE:${event.templateId ?? 'UNKNOWN'}`;
  if (event.plainRetrySuccess) return silent(event, 'TELEGRAM_HTML_PARSE_RETRY_SUCCESS_SILENT', key, DEFAULT_TTL);
  if ((event.templateFailureCount ?? 0) >= 2) return digest(event, 'TELEGRAM_TEMPLATE_REPEAT_FAILURE_DIGEST', key, ONE_HOUR);
  return warning(event, 'TELEGRAM_PLAIN_RETRY_FAILED_WARNING', key, DEFAULT_TTL);
}

function handleDefaultNoiseEvent(event: AlertNoiseEvent): NoiseDecision {
  if (event.executionImpact && event.executionImpact !== 'NONE') {
    return warning(event, 'EXECUTION_IMPACT_EVENT_WARNING', `${event.eventType}:${event.dedupeHint ?? 'GLOBAL'}`, DEFAULT_TTL);
  }
  if (String(event.status ?? '').toUpperCase() === 'OK' || String(event.status ?? '').toUpperCase() === 'SUCCESS') {
    return silent(event, 'SUCCESS_OR_OK_EVENT_SILENT', `${event.eventType}:${event.dedupeHint ?? 'GLOBAL'}`, DEFAULT_TTL);
  }
  return notice(event, 'UNCLASSIFIED_EVENT_NOTICE', `${event.eventType}:${event.dedupeHint ?? 'GLOBAL'}`, DEFAULT_TTL);
}

const ALERT_NOISE_HANDLERS: Record<string, NoisePolicyHandler> = {
  WATCHLIST_CANDIDATE_REJECTED_CAPACITY: handleWatchlistCandidateRejectedCapacity,
  WATCHLIST_SATURATION: handleWatchlistSaturation,
  KIS_TOKEN_REFRESH_SUCCESS: handleKisTokenRefreshSuccess,
  KIS_TOKEN_EXPIRY: handleKisTokenExpiry,
  KIS_TOKEN_REFRESH_FAILED: handleKisTokenRefreshFailed,
  KIS_TOKEN_EXPIRED_IMPACTED: (event) =>
    critical(event, 'KIS_TOKEN_EXPIRED_EXECUTION_OR_QUERY_IMPACTED', kisTokenKey('EXPIRED_IMPACTED', event)),
  PROVIDER_RECOVERY: (event) =>
    notice(event, 'PROVIDER_RECOVERED_NOTICE_ONCE', `PROVIDER_RECOVERY:${event.provider ?? 'UNKNOWN'}`, ONE_HOUR),
  PROVIDER_FAILURE: handleProviderFailure,
  ENGINE_STATE: handleEngineState,
  SHADOW_SIGNAL: handleShadowSignal,
  SHADOW_EXECUTION_COMPLETED: (event) =>
    digest(event, 'SHADOW_COMPLETION_JOURNAL_DIGEST_EXECUTION_IMPACT_NONE', `SHADOW_COMPLETION:${event.symbol ?? 'UNKNOWN'}:${event.session ?? 'ANY'}`, DEFAULT_TTL),
  HEALTH_OK: handleSilentOkEvent,
  SCHEDULER_OK: handleSilentOkEvent,
  BACKUP_SUCCESS: handleSilentOkEvent,
  MAINTENANCE_SUCCESS: handleSilentOkEvent,
  SCAN_COMPLETED: handleSilentOkEvent,
  SCAN_EMPTY: handleSilentOkEvent,
  HEALTH_RECOVERY: (event) =>
    notice(event, 'HEALTH_RECOVERY_NOTICE_ONCE', `HEALTH_RECOVERY:${event.dedupeHint ?? event.channel ?? 'GLOBAL'}`, ONE_HOUR),
  HEALTH_FAILURE: handleFailureUntilStreak,
  BACKUP_FAILURE: handleFailureUntilStreak,
  TELEGRAM_HTML_RETRY: handleTelegramHtmlRetry,
};

export function evaluateAlertNoise(event: AlertNoiseEvent): NoiseDecision {
  const ts = nowMs(event);
  prune(ts);

  if (!isAlertNoisePolicyEnforced()) {
    return passThroughNoiseDecision(event);
  }

  return (ALERT_NOISE_HANDLERS[event.eventType] ?? handleDefaultNoiseEvent)(event, ts);
}

export function getAlertNoiseStats(now: Date = new Date()): AlertNoiseStats {
  prune(now.getTime());
  const dateKey = ensureStatsDay(now.getTime());
  const topNoisyEventTypes = [...noisyEventTypes.entries()]
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
    .slice(0, 10)
    .map(([eventType, countValue]) => ({ eventType, count: countValue }));

  const levelInit: Record<AlertLevel, number> = {
    SILENT: 0,
    DIGEST: 0,
    NOTICE: 0,
    WARNING: 0,
    CRITICAL: 0,
  };
  return {
    dateKey,
    suppressedByReason: Object.fromEntries(suppressedByReason),
    digestedByChannel: Object.fromEntries(digestedByChannel),
    sentByLevel: { ...levelInit, ...Object.fromEntries(sentByLevel) },
    topNoisyEventTypes,
    lastSuppressedEvent,
    activeDedupeKeysCount: dedupe.size,
  };
}

export function formatAlertNoiseStats(stats: AlertNoiseStats = getAlertNoiseStats()): string {
  return [
    `<b>[Alert Noise Stats ${stats.dateKey} KST]</b>`,
    `suppressedByReason=${JSON.stringify(stats.suppressedByReason)}`,
    `digestedByChannel=${JSON.stringify(stats.digestedByChannel)}`,
    `sentByLevel=${JSON.stringify(stats.sentByLevel)}`,
    `topNoisyEventTypes=${stats.topNoisyEventTypes.map((x) => `${x.eventType}:${x.count}`).join(',') || 'N/A'}`,
    `lastSuppressedEvent=${stats.lastSuppressedEvent ? JSON.stringify(stats.lastSuppressedEvent) : 'N/A'}`,
    `activeDedupeKeysCount=${stats.activeDedupeKeysCount}`,
    'programFlowUsedForLiveDecision=false passiveProxyUsedForLiveDecision=false executionImpact=NONE',
  ].join('\n');
}

export function __resetAlertNoisePolicyForTests(): void {
  dedupe.clear();
  lastStateByKey.clear();
  resetDailyStats();
  statsDateKey = kstDateKey();
}
