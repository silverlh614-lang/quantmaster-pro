// @responsibility alertRouter 4채널 발송 SSOT + 진동 정책 + 디지스트 라우팅
import { AlertCategory, ChannelSemantic, isCategoryEnabled, parseChannelMap } from './alertCategories.js';
import { sendChannelAlertTo } from './telegramClient.js';
import { incrementChannelStat } from '../persistence/channelStatsRepo.js';
import { appendAlertHistory } from '../persistence/alertHistoryRepo.js';

// 채널 시멘틱 이름 re-export — 호출자가 alertRouter 한 곳만 import 하도록.
export { ChannelSemantic };
export type { ChannelSemanticName } from './alertCategories.js';

const fallbackWarned = new Set<string>();
const categoryCooldown = new Map<string, number>();
const infoDailyDigestBuffer: Array<{ at: string; message: string; priority: DispatchPriority }> = [];
const systemWeeklyBuffer: Array<{ at: string; message: string; priority: DispatchPriority }> = [];

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

export interface DispatchAlertOptions {
  disableNotification?: boolean;
  priority?: DispatchPriority;
  /** AlertSeverity 별칭 — priority 와 동일 의미. 명시 시 priority 보다 우선. */
  severity?: AlertSeverity;
  dedupeKey?: string;
  cooldownMs?: number;
  delivery?: 'immediate' | 'daily_digest' | 'weekly_digest';
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

function kstDateKey(iso: string): string {
  return new Date(iso).toLocaleDateString('sv-SE', { timeZone: 'Asia/Seoul' });
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
    incrementChannelStat(AlertCategory.INFO, 'sent');
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
    incrementChannelStat(AlertCategory.INFO, 'failed');
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
    incrementChannelStat(AlertCategory.SYSTEM, 'sent');
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
    incrementChannelStat(AlertCategory.SYSTEM, 'failed');
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

export async function dispatchAlert(
  category: AlertCategory,
  message: string,
  options?: DispatchAlertOptions,
): Promise<number | undefined> {
  if (!isCategoryEnabled(category)) {
    incrementChannelStat(category, 'skipped');
    appendAlertHistory({
      category,
      priority: resolvePriority(category, options),
      message,
      delivery: 'skipped',
      success: false,
      error: 'category disabled',
    });
    return;
  }
  const priority = resolvePriority(category, options);

  if (category === AlertCategory.SYSTEM && priority !== 'CRITICAL') {
    systemWeeklyBuffer.push({ at: new Date().toISOString(), message, priority });
    incrementChannelStat(category, 'digested');
    appendAlertHistory({
      category,
      priority,
      message,
      delivery: 'buffered',
      success: true,
    });
    return;
  }

  if (options?.delivery === 'weekly_digest') {
    systemWeeklyBuffer.push({ at: new Date().toISOString(), message, priority });
    incrementChannelStat(AlertCategory.SYSTEM, 'digested');
    appendAlertHistory({
      category: AlertCategory.SYSTEM,
      priority,
      message,
      delivery: 'buffered',
      success: true,
    });
    return;
  }

  if (category === AlertCategory.INFO && options?.delivery === 'daily_digest') {
    infoDailyDigestBuffer.push({ at: new Date().toISOString(), message, priority });
    incrementChannelStat(category, 'digested');
    appendAlertHistory({
      category,
      priority,
      message,
      delivery: 'buffered',
      success: true,
    });
    return;
  }

  if (!shouldSendByCooldown(category, priority, options)) {
    incrementChannelStat(category, 'skipped');
    appendAlertHistory({
      category,
      priority,
      message,
      delivery: 'skipped',
      success: false,
      error: 'cooldown',
    });
    return;
  }

  const channelMap = resolveCategoryChannelMap();
  const channelId = channelMap[category];
  if (!channelId) {
    warnOnce(
      `missing_channel_${category}`,
      `[AlertRouter] ${category} channel is not configured; skipping send.`,
    );
    incrementChannelStat(category, 'failed');
    appendAlertHistory({
      category,
      priority,
      message,
      delivery: 'immediate',
      success: false,
      error: 'channel_id missing',
    });
    return;
  }

  const disableNotification = resolveVibrationDecision(category, priority, options?.disableNotification);
  const msgId = await sendChannelAlertTo(channelId, message, { disableNotification });
  if (msgId !== undefined) {
    incrementChannelStat(category, 'sent');
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
    incrementChannelStat(category, 'failed');
    appendAlertHistory({
      category,
      priority,
      message,
      delivery: 'immediate',
      success: false,
      channelId,
      error: 'send failed',
    });
  }
  return msgId;
}
