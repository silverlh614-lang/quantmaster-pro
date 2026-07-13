// @responsibility alertRouter 4채널 발송 SSOT + 진동 정책 + 디지스트 라우팅
import { AlertCategory, ChannelSemantic, isCategoryEnabled, parseChannelMap } from './alertCategories.js';
import { sendChannelAlertTo } from './telegramClient.js';
import { incrementChannelStat } from '../persistence/channelStatsRepo.js';
import { appendAlertHistory } from '../persistence/alertHistoryRepo.js';
import { updateNotificationLedgerState } from '../persistence/notificationLedgerRepo.js';
import { evaluateAlertNoise, type AlertLevel, type AlertNoiseEvent } from './alertNoisePolicy.js';

// 채널 시멘틱 이름 re-export — 호출자가 alertRouter 한 곳만 import 하도록.
export { ChannelSemantic };
const fallbackWarned = new Set<string>();
const categoryCooldown = new Map<string, number>();
const infoDailyDigestBuffer: Array<{ at: string; message: string; priority: DispatchPriority }> = [];
const systemDailyBuffer: Array<{ at: string; message: string; priority: DispatchPriority }> = [];
const systemWeeklyBuffer: Array<{ at: string; message: string; priority: DispatchPriority }> = [];
let lastInfoFlushAt: string | undefined;
let lastSystemDailyFlushAt: string | undefined;
let lastSystemWeeklyFlushAt: string | undefined;

export const PUBLIC_SIGNAL_DISCLAIMER = '※ 투자 판단은 각자 책임입니다.';

function warnOnce(key: string, message: string): void {
  if (fallbackWarned.has(key)) return;
  fallbackWarned.add(key);
  console.warn(message);
}

function resolveTradeChannelId(): string | undefined {
  const trade = process.env.TELEGRAM_TRADE_CHANNEL_ID?.trim();
  if (trade) return trade;

  // 전용 트레이드 채널이 없으면 개인 TELEGRAM_CHAT_ID 로 폴백한다 (단일 chat 운영 환경 기본 경로).
  const chat = process.env.TELEGRAM_CHAT_ID?.trim();
  if (chat) {
    warnOnce(
      'legacy_trade_channel',
      '[AlertRouter] TELEGRAM_TRADE_CHANNEL_ID is missing; falling back to TELEGRAM_CHAT_ID.',
    );
    return chat;
  }
  return undefined;
}

function resolveAnalysisChannelId(): string | undefined {
  const analysis = process.env.TELEGRAM_ANALYSIS_CHANNEL_ID?.trim();
  if (analysis) return analysis;
  return process.env.TELEGRAM_PICK_CHANNEL_ID?.trim();
}

function resolveCategoryChannelMap(): Record<AlertCategory, string | undefined> {
  const trade = resolveTradeChannelId();
  const mapFromEnv = parseChannelMap(process.env.CHANNEL_MAP);

  const analysis = resolveAnalysisChannelId();
  const info = process.env.TELEGRAM_INFO_CHANNEL_ID?.trim() || trade;
  const system = process.env.TELEGRAM_SYSTEM_CHANNEL_ID?.trim() || trade;

  if (!process.env.TELEGRAM_INFO_CHANNEL_ID?.trim() && trade) {
    warnOnce(
      'missing_info_channel',
      '[AlertRouter] TELEGRAM_INFO_CHANNEL_ID is missing; falling back to TRADE channel.',
    );
  }
  if (!process.env.TELEGRAM_SYSTEM_CHANNEL_ID?.trim() && trade) {
    warnOnce(
      'missing_system_channel',
      '[AlertRouter] TELEGRAM_SYSTEM_CHANNEL_ID is missing; falling back to TRADE channel.',
    );
  }

  return {
    [AlertCategory.TRADE]: mapFromEnv[AlertCategory.TRADE] ?? trade,
    [AlertCategory.ANALYSIS]: mapFromEnv[AlertCategory.ANALYSIS] ?? analysis,
    [AlertCategory.INFO]: mapFromEnv[AlertCategory.INFO] ?? info,
    [AlertCategory.SYSTEM]: mapFromEnv[AlertCategory.SYSTEM] ?? system,
  };
}

export function getResolvedChannelMap(): Record<AlertCategory, string | undefined> {
  return resolveCategoryChannelMap();
}

/**
 * @responsibility checkTelegramChannelConfig 채널 설정 부팅 진단 SSOT
 */
export async function checkTelegramChannelConfig(): Promise<void> {
  const map = getResolvedChannelMap();
  const mapFromEnv = parseChannelMap(process.env.CHANNEL_MAP);
  const configured = (value: string | undefined): string => value ?? '❌ 미설정';
  const fallback = (category: AlertCategory, envName: string): string => {
    if (mapFromEnv[category]) return mapFromEnv[category];
    if (process.env[envName]?.trim()) return map[category] ?? process.env[envName]?.trim();
    return '❌ 미설정 → TRADE 폴백';
  };
  const message = [
    '🔧 [채널 설정 점검]',
    `CH1 EXECUTION(TRADE):  ${configured(map[AlertCategory.TRADE])}`,
    `CH2 SIGNAL(ANALYSIS):  ${configured(map[AlertCategory.ANALYSIS])}`,
    `CH3 REGIME(INFO):      ${fallback(AlertCategory.INFO, 'TELEGRAM_INFO_CHANNEL_ID')}`,
    `CH4 JOURNAL(SYSTEM):   ${fallback(AlertCategory.SYSTEM, 'TELEGRAM_SYSTEM_CHANNEL_ID')}`,
    `CHANNEL_ENABLED:       ${process.env.CHANNEL_ENABLED ?? '미설정'}`,
  ].join('\n');

  const { sendPrivateAlert } = await import('./telegramClient.js');
  await sendPrivateAlert(message, {
    dedupeKey: 'boot_channel_check',
    priority: 'HIGH',
  });
}

export interface DispatchAlertOptions {
  disableNotification?: boolean;
  priority?: DispatchPriority;
  /** AlertSeverity 별칭 — priority 와 동일 의미. 명시 시 priority 보다 우선. */
  severity?: AlertSeverity;
  dedupeKey?: string;
  eventType?: string;
  cooldownMs?: number;
  delivery?: 'immediate' | 'daily_digest' | 'weekly_digest';
  /** ADR-0468 diagnostic-only noise policy hook. */
  noiseEvent?: AlertNoiseEvent;
  ledgerId?: string;
}

export type DispatchPriority = 'CRITICAL' | 'HIGH' | 'NORMAL' | 'LOW';

/** AlertSeverity = DispatchPriority 시멘틱 별칭 (ADR-0032 §2). */
export type AlertSeverity = DispatchPriority;

/**
 * VIBRATION_POLICY (ADR-0032 §2) — 카테고리 × 심각도 별 진동(알림 소리) 매트릭스.
 *   true  = 진동 ON (disableNotification: false)
 *   false = 진동 OFF (disableNotification: true)
 * 호출자가 options.disableNotification 을 명시하면 정책 무시 (override).
 *
 * 페르소나 원칙 매핑:
 *   EXECUTION — 매도/체결은 즉각 인지 필요 (LOW 까지 진동 ON)
 *   SIGNAL    — 픽은 FOMO 차단을 위해 조용히 누적 (CRITICAL 만 진동)
 *   REGIME    — R-레짐 전환만 진동, 일상 매크로는 조용히
 *   JOURNAL   — 복기용이라 모두 진동 OFF (시간 격리)
 */
export const VIBRATION_POLICY: Record<AlertCategory, Record<AlertSeverity, boolean>> = {
  [AlertCategory.TRADE]:    { CRITICAL: true,  HIGH: true,  NORMAL: true,  LOW: true  },
  [AlertCategory.ANALYSIS]: { CRITICAL: true,  HIGH: false, NORMAL: false, LOW: false },
  [AlertCategory.INFO]:     { CRITICAL: true,  HIGH: true,  NORMAL: false, LOW: false },
  [AlertCategory.SYSTEM]:   { CRITICAL: false, HIGH: false, NORMAL: false, LOW: false },
};

/**
 * 진동 정책 결정 SSOT — 호출자 명시값이 있으면 그대로, 아니면 VIBRATION_POLICY.
 * @returns disableNotification 값 (true=조용히 / false=진동 / undefined=Telegram 기본)
 */
export function resolveVibrationDecision(
  category: AlertCategory,
  severity: AlertSeverity,
  override?: boolean,
): boolean {
  if (override !== undefined) return override;
  const vibrate = VIBRATION_POLICY[category]?.[severity];
  // 매트릭스 미정의 시 안전 기본값: 진동 ON (정보 손실보다 잘못된 알림이 낫다)
  return vibrate === undefined ? false : !vibrate;
}

const DEFAULT_PRIORITY_BY_CATEGORY: Record<AlertCategory, DispatchPriority> = {
  [AlertCategory.TRADE]: 'HIGH',
  [AlertCategory.ANALYSIS]: 'HIGH',
  [AlertCategory.INFO]: 'NORMAL',
  [AlertCategory.SYSTEM]: 'LOW',
};

const COOLDOWN_BY_CATEGORY_PRIORITY: Record<AlertCategory, Record<DispatchPriority, number>> = {
  [AlertCategory.TRADE]: { CRITICAL: 0, HIGH: 0, NORMAL: 0, LOW: 0 },
  [AlertCategory.ANALYSIS]: { CRITICAL: 0, HIGH: 60_000, NORMAL: 300_000, LOW: 3_600_000 },
  [AlertCategory.INFO]: { CRITICAL: 0, HIGH: 60_000, NORMAL: 300_000, LOW: 3_600_000 },
  [AlertCategory.SYSTEM]: { CRITICAL: 0, HIGH: 300_000, NORMAL: 3_600_000, LOW: 3_600_000 },
};

function resolvePriority(category: AlertCategory, options?: DispatchAlertOptions): DispatchPriority {
  return options?.severity ?? options?.priority ?? DEFAULT_PRIORITY_BY_CATEGORY[category];
}

function priorityFromNoiseLevel(level: AlertLevel): DispatchPriority {
  if (level === 'CRITICAL') return 'CRITICAL';
  if (level === 'WARNING') return 'HIGH';
  if (level === 'NOTICE') return 'NORMAL';
  return 'LOW';
}

function shouldSendByCooldown(
  category: AlertCategory,
  priority: DispatchPriority,
  options?: DispatchAlertOptions,
): boolean {
  if (!options?.dedupeKey) return true;
  if (priority === 'CRITICAL') return true;
  const cooldownMs = options.cooldownMs ?? COOLDOWN_BY_CATEGORY_PRIORITY[category][priority];
  const key = `${category}:${priority}:${options.dedupeKey}`;
  const last = categoryCooldown.get(key);
  if (last !== undefined && Date.now() - last < cooldownMs) return false;
  categoryCooldown.set(key, Date.now());
  return true;
}

function stripHtml(text: string): string {
  return text.replace(/<[^>]+>/g, '').trim();
}

function toDigestLine(message: string): string {
  const first = stripHtml(message).split('\n').find(line => line.trim().length > 0) ?? '';
  return first.length > 180 ? `${first.slice(0, 180)}...` : first;
}

/**
 * ChannelMessageFormatter — 채널 성격에 맞는 포맷 표준화 SSOT
 * CH1 EXECUTION : 즉각 행동용 — 태그 접두어 보장
 * CH2 SIGNAL    : 투자 판단용 — 면책 문구 보장
 * CH3 REGIME    : 매크로 컨텍스트 — 🌐 접두어 + 시간 스탬프
 * CH4 JOURNAL   : 복기용 조용히 — 📒 접두어
 */
function normalizeChannelMessage(category: AlertCategory, message: string): string {
  switch (category) {
    case AlertCategory.TRADE:
      if (/^\[?(EXECUTION|RISK|ORDER|SHADOW)/.test(message)) return message;
      if (message.startsWith('⚡')) return message;
      return `⚡ ${message}`;

    case AlertCategory.ANALYSIS:
      if (message.includes(PUBLIC_SIGNAL_DISCLAIMER)) return message;
      return `${message}\n\n${PUBLIC_SIGNAL_DISCLAIMER}`;

    case AlertCategory.INFO: {
      if (message.startsWith('🌐')) return message;
      const kstHHMM = new Date().toLocaleTimeString('ko-KR', {
        timeZone: 'Asia/Seoul',
        hour: '2-digit',
        minute: '2-digit',
        hour12: false,
      });
      return `🌐 <i>[${kstHHMM} KST]</i> ${message}`;
    }

    case AlertCategory.SYSTEM:
      if (message.startsWith('📒')) return message;
      return `📒 ${message}`;

    default:
      return message;
  }
}

function kstDateKey(iso: string): string {
  return new Date(iso).toLocaleDateString('sv-SE', { timeZone: 'Asia/Seoul' });
}

function nextKstTimeIso(hour: number, minute: number): string {
  const now = new Date();
  const kst = new Date(now.getTime() + 9 * 3_600_000);
  const candidateKstMs = Date.UTC(
    kst.getUTCFullYear(),
    kst.getUTCMonth(),
    kst.getUTCDate(),
    hour,
    minute,
    0,
    0,
  );
  const candidateUtcMs = candidateKstMs - 9 * 3_600_000;
  const adjustedUtcMs = candidateUtcMs >= now.getTime()
    ? candidateUtcMs
    : candidateUtcMs + 24 * 3_600_000;
  return new Date(adjustedUtcMs).toISOString();
}

export interface ChannelFlushStatus {
  infoDailyDigestBufferLength: number;
  systemDailyBufferLength: number;
  systemWeeklyBufferLength: number;
  lastInfoFlushAt?: string;
  lastSystemDailyFlushAt?: string;
  lastSystemWeeklyFlushAt?: string;
  nextScheduledFlushAt: string;
  flushJobEnabled: boolean;
}

export function getChannelFlushStatus(): ChannelFlushStatus {
  return {
    infoDailyDigestBufferLength: infoDailyDigestBuffer.length,
    systemDailyBufferLength: systemDailyBuffer.length,
    systemWeeklyBufferLength: systemWeeklyBuffer.length,
    lastInfoFlushAt,
    lastSystemDailyFlushAt,
    lastSystemWeeklyFlushAt,
    nextScheduledFlushAt: nextKstTimeIso(16, 10),
    flushJobEnabled: true,
  };
}

export async function flushInfoDailyDigest(): Promise<void> {
  if (infoDailyDigestBuffer.length === 0) return;
  const channelMap = resolveCategoryChannelMap();
  const channelId = channelMap[AlertCategory.INFO];
  if (!channelId) return;

  const sorted = infoDailyDigestBuffer.splice(0).sort((a, b) => a.at.localeCompare(b.at));
  const date = kstDateKey(sorted[0].at);
  const lines = sorted.slice(-30).map(item => `- ${toDigestLine(item.message)}`);
  const message =
    `* <b>[INFO] Daily Digest ${date} KST</b>\n` +
    `--------------------\n` +
    `${lines.join('\n')}\n` +
    `--------------------\n` +
    `count: ${sorted.length}`;
  const msgId = await sendChannelAlertTo(channelId, message, { disableNotification: true });
  if (msgId !== undefined) {
    lastInfoFlushAt = new Date().toISOString();
    incrementChannelStat(AlertCategory.INFO, 'sent', { eventType: 'INFO_DAILY_DIGEST_FLUSH' });
    appendAlertHistory({
      category: AlertCategory.INFO,
      priority: 'LOW',
      message,
      delivery: 'daily_digest',
      success: true,
      channelId,
      messageId: msgId,
    });
  } else {
    incrementChannelStat(AlertCategory.INFO, 'failed', { eventType: 'INFO_DAILY_DIGEST_FLUSH' });
    appendAlertHistory({
      category: AlertCategory.INFO,
      priority: 'LOW',
      message,
      delivery: 'daily_digest',
      success: false,
      channelId,
      error: 'send failed',
    });
  }
}

export async function flushSystemDailyDigest(): Promise<void> {
  if (systemDailyBuffer.length === 0) return;
  const channelMap = resolveCategoryChannelMap();
  const channelId = channelMap[AlertCategory.SYSTEM];
  if (!channelId) return;

  const sorted = systemDailyBuffer.splice(0).sort((a, b) => a.at.localeCompare(b.at));
  const date = kstDateKey(sorted[0].at);
  const lines = sorted.slice(-40).map(item => `- ${toDigestLine(item.message)}`);
  const message =
    `* <b>[SYSTEM] Daily Journal ${date} KST</b>\n` +
    `--------------------\n` +
    `${lines.join('\n')}\n` +
    `--------------------\n` +
    `count: ${sorted.length}`;
  const msgId = await sendChannelAlertTo(channelId, message, { disableNotification: true });
  if (msgId !== undefined) {
    lastSystemDailyFlushAt = new Date().toISOString();
    incrementChannelStat(AlertCategory.SYSTEM, 'sent', { eventType: 'SYSTEM_DAILY_DIGEST_FLUSH' });
    appendAlertHistory({
      category: AlertCategory.SYSTEM,
      priority: 'LOW',
      message,
      delivery: 'daily_digest',
      success: true,
      channelId,
      messageId: msgId,
    });
  } else {
    incrementChannelStat(AlertCategory.SYSTEM, 'failed', { eventType: 'SYSTEM_DAILY_DIGEST_FLUSH' });
    appendAlertHistory({
      category: AlertCategory.SYSTEM,
      priority: 'LOW',
      message,
      delivery: 'daily_digest',
      success: false,
      channelId,
      error: 'send failed',
    });
  }
}

export async function flushSystemWeeklySummary(): Promise<void> {
  if (systemWeeklyBuffer.length === 0) return;
  const channelMap = resolveCategoryChannelMap();
  const channelId = channelMap[AlertCategory.SYSTEM];
  if (!channelId) return;

  const sorted = systemWeeklyBuffer.splice(0).sort((a, b) => a.at.localeCompare(b.at));
  const start = kstDateKey(sorted[0].at);
  const end = kstDateKey(sorted[sorted.length - 1].at);
  const lines = sorted.slice(-50).map(item => `- ${toDigestLine(item.message)}`);
  const message =
    `* <b>[SYSTEM] Weekly Summary ${start} ~ ${end} KST</b>\n` +
    `--------------------\n` +
    `${lines.join('\n')}\n` +
    `--------------------\n` +
    `count: ${sorted.length}`;
  const msgId = await sendChannelAlertTo(channelId, message, { disableNotification: true });
  if (msgId !== undefined) {
    lastSystemWeeklyFlushAt = new Date().toISOString();
    incrementChannelStat(AlertCategory.SYSTEM, 'sent', { eventType: 'SYSTEM_WEEKLY_DIGEST_FLUSH' });
    appendAlertHistory({
      category: AlertCategory.SYSTEM,
      priority: 'LOW',
      message,
      delivery: 'weekly_digest',
      success: true,
      channelId,
      messageId: msgId,
    });
  } else {
    incrementChannelStat(AlertCategory.SYSTEM, 'failed', { eventType: 'SYSTEM_WEEKLY_DIGEST_FLUSH' });
    appendAlertHistory({
      category: AlertCategory.SYSTEM,
      priority: 'LOW',
      message,
      delivery: 'weekly_digest',
      success: false,
      channelId,
      error: 'send failed',
    });
  }
}

export interface ChannelHealthItem {
  ok: boolean;
  enabled: boolean;
  configured: boolean;
  channelId?: string;
  reason?: string;
  messageId?: number;
}

export async function runChannelHealthCheck(): Promise<Record<AlertCategory, ChannelHealthItem>> {
  const map = resolveCategoryChannelMap();
  const categories = Object.values(AlertCategory);
  const kstNow = new Date(Date.now() + 9 * 3_600_000).toISOString().replace('T', ' ').slice(0, 19);
  const result = {} as Record<AlertCategory, ChannelHealthItem>;

  for (const category of categories) {
    const enabled = isCategoryEnabled(category);
    const channelId = map[category];
    if (!channelId) {
      result[category] = {
        ok: false,
        enabled,
        configured: false,
        reason: 'channel_id missing',
      };
      continue;
    }

    const message =
      `* <b>[${category}] channel health check</b>\n` +
      `--------------------\n` +
      `${kstNow} KST`;
    const messageId = await sendChannelAlertTo(channelId, message, { disableNotification: true });
    result[category] = messageId !== undefined
      ? { ok: true, enabled, configured: true, channelId, messageId }
      : { ok: false, enabled, configured: true, channelId, reason: 'send failed' };
  }
  return result;
}

function appendSkippedHistory(
  category: AlertCategory,
  priority: DispatchPriority,
  message: string,
  delivery: 'skipped' | 'immediate',
  error: string,
  channelId?: string,
): void {
  appendAlertHistory({
    category,
    priority,
    message,
    delivery,
    success: false,
    channelId,
    error,
  });
}

function recordSkippedStat(
  category: AlertCategory,
  statName: 'disabledSkipped' | 'cooldownSkipped' | 'missingChannelSkipped',
  eventType: string | undefined,
  reason: string,
): void {
  incrementChannelStat(category, statName, {
    eventType,
    skippedReason: reason,
  });
  incrementChannelStat(category, 'skipped', {
    eventType,
    skippedReason: reason,
  });
}

function bufferAlertHistory(
  category: AlertCategory,
  priority: DispatchPriority,
  message: string,
): void {
  appendAlertHistory({
    category,
    priority,
    message,
    delivery: 'buffered',
    success: true,
  });
}

function bufferDailyAlert(
  category: AlertCategory,
  message: string,
  priority: DispatchPriority,
  statEventType: string | undefined,
  options?: DispatchAlertOptions,
): boolean {
  if (category === AlertCategory.SYSTEM) {
    systemDailyBuffer.push({ at: new Date().toISOString(), message, priority });
  } else if (category === AlertCategory.INFO) {
    infoDailyDigestBuffer.push({ at: new Date().toISOString(), message, priority });
  } else {
    return false;
  }
  incrementChannelStat(category, 'buffered', { eventType: statEventType });
  incrementChannelStat(category, 'digested', { eventType: statEventType });
  bufferAlertHistory(category, priority, message);
  return true;
}

function bufferWeeklyAlert(
  message: string,
  priority: DispatchPriority,
  statEventType: string | undefined,
): void {
  systemWeeklyBuffer.push({ at: new Date().toISOString(), message, priority });
  incrementChannelStat(AlertCategory.SYSTEM, 'buffered', { eventType: statEventType });
  incrementChannelStat(AlertCategory.SYSTEM, 'digested', { eventType: statEventType });
  bufferAlertHistory(AlertCategory.SYSTEM, priority, message);
}

interface NoiseDispatchResult {
  handled: boolean;
  options?: DispatchAlertOptions;
}

function applyNoisePolicyToDispatch(
  category: AlertCategory,
  message: string,
  options?: DispatchAlertOptions,
): NoiseDispatchResult {
  if (!options?.noiseEvent) return { handled: false, options };

  const noise = evaluateAlertNoise(options.noiseEvent);
  const statEventType = options.eventType ?? options.dedupeKey ?? noise.dedupeKey;
  if (!noise.shouldSendNow) {
    incrementChannelStat(category, 'emitted', { eventType: statEventType });
    if (noise.shouldDigest) {
      const row = { at: new Date().toISOString(), message, priority: 'LOW' as DispatchPriority };
      if (category === AlertCategory.INFO) infoDailyDigestBuffer.push(row);
      else systemDailyBuffer.push(row);
      incrementChannelStat(category, 'buffered', { eventType: statEventType });
      incrementChannelStat(category, 'digested', { eventType: statEventType });
      bufferAlertHistory(category, 'LOW', message);
    } else {
      incrementChannelStat(category, 'skipped', {
        eventType: statEventType,
        skippedReason: noise.reason,
      });
      appendSkippedHistory(category, 'LOW', message, 'skipped', noise.reason);
    }
    return { handled: true, options };
  }

  return {
    handled: false,
    options: {
      ...options,
      priority: options.priority ?? priorityFromNoiseLevel(noise.level),
      dedupeKey: options.dedupeKey ?? noise.dedupeKey,
      cooldownMs: options.cooldownMs ?? noise.ttlSeconds * 1000,
      eventType: options.eventType ?? noise.reason,
    },
  };
}

function handleDisabledCategory(
  category: AlertCategory,
  priority: DispatchPriority,
  message: string,
  statEventType: string | undefined,
  options?: DispatchAlertOptions,
): boolean {
  if (isCategoryEnabled(category)) return false;
  recordSkippedStat(category, 'disabledSkipped', statEventType, 'category disabled');
  appendSkippedHistory(category, priority, message, 'skipped', 'category disabled');
  return true;
}

function handleBufferedDelivery(
  category: AlertCategory,
  message: string,
  priority: DispatchPriority,
  options: DispatchAlertOptions | undefined,
  statEventType: string | undefined,
): boolean {
  if (options?.delivery === 'weekly_digest') {
    bufferWeeklyAlert(message, priority, statEventType);
    return true;
  }
  if (options?.delivery === 'daily_digest') {
    const buffered = bufferDailyAlert(category, message, priority, statEventType);
    return buffered;
  }
  return false;
}

function handleCooldownSkip(
  category: AlertCategory,
  message: string,
  priority: DispatchPriority,
  options: DispatchAlertOptions | undefined,
  statEventType: string | undefined,
): boolean {
  if (shouldSendByCooldown(category, priority, options)) return false;
  recordSkippedStat(category, 'cooldownSkipped', statEventType, 'cooldown');
  appendSkippedHistory(category, priority, message, 'skipped', 'cooldown');
  return true;
}

function resolveDispatchChannel(
  category: AlertCategory,
  message: string,
  priority: DispatchPriority,
  statEventType: string | undefined,
): string | undefined {
  const channelMap = resolveCategoryChannelMap();
  const channelId = channelMap[category];
  if (channelId) return channelId;

  warnOnce(
    `missing_channel_${category}`,
    `[AlertRouter] ${category} channel is not configured; skipping send.`,
  );
  recordSkippedStat(category, 'missingChannelSkipped', statEventType, 'channel_id missing');
  appendSkippedHistory(category, priority, message, 'immediate', 'channel_id missing');
  return undefined;
}

async function sendImmediateDispatch(
  category: AlertCategory,
  message: string,
  priority: DispatchPriority,
  channelId: string,
  options: DispatchAlertOptions | undefined,
  statEventType: string | undefined,
): Promise<number | undefined> {
  const disableNotification = resolveVibrationDecision(category, priority, options?.disableNotification);
  const msgId = await sendChannelAlertTo(channelId, message, { disableNotification });
  if (msgId !== undefined) {
    incrementChannelStat(category, 'sent', { eventType: statEventType });
    appendAlertHistory({
      category,
      priority,
      message,
      delivery: 'immediate',
      success: true,
      channelId,
      messageId: msgId,
    });
  } else {
    incrementChannelStat(category, 'failed', { eventType: statEventType });
    appendSkippedHistory(category, priority, message, 'immediate', 'send failed', channelId);
  }
  return msgId;
}

export async function dispatchAlert(
  category: AlertCategory,
  message: string,
  options?: DispatchAlertOptions,
): Promise<number | undefined> {
  const routedMessage = normalizeChannelMessage(category, message);
  const noiseResult = applyNoisePolicyToDispatch(category, routedMessage, options);
  if (noiseResult.handled) return undefined;
  options = noiseResult.options;

  const priority = resolvePriority(category, options);
  const statEventType = options?.eventType ?? options?.dedupeKey;
  incrementChannelStat(category, 'emitted', { eventType: statEventType });
  if (handleDisabledCategory(category, priority, routedMessage, statEventType, options)) return undefined;

  incrementChannelStat(category, 'routed', { eventType: statEventType });
  if (handleBufferedDelivery(category, routedMessage, priority, options, statEventType)) return undefined;
  if (handleCooldownSkip(category, routedMessage, priority, options, statEventType)) return undefined;

  const channelId = resolveDispatchChannel(category, routedMessage, priority, statEventType);
  if (!channelId) return undefined;
  return sendImmediateDispatch(category, routedMessage, priority, channelId, options, statEventType);
}
