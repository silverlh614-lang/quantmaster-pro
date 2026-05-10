// @responsibility channelActivity.cmd — compact read-only channel activity summary.
// @responsibility: /channel_activity — 오늘 채널별 sent/failed/skipped/digested와 최근 활동 시각을 한 화면에 요약.

import { AlertCategory } from '../../../alerts/alertCategories.js';
import { getChannelStatsByDate, getRecentDateKeys } from '../../../persistence/channelStatsRepo.js';
import { getRecentAlertHistory, type AlertHistoryEntry } from '../../../persistence/alertHistoryRepo.js';
import { commandRegistry } from '../../commandRegistry.js';
import type { TelegramCommand } from '../_types.js';

const CATEGORIES: AlertCategory[] = [
  AlertCategory.TRADE,
  AlertCategory.ANALYSIS,
  AlertCategory.INFO,
  AlertCategory.SYSTEM,
];

interface LastActivitySummary {
  last?: AlertHistoryEntry;
  lastSent?: AlertHistoryEntry;
  lastFailed?: AlertHistoryEntry;
}

function todayKstDateKey(): string {
  return new Date().toLocaleDateString('sv-SE', { timeZone: 'Asia/Seoul' });
}

function yesterdayKstDateKey(): string {
  return new Date(Date.now() - 24 * 60 * 60 * 1000).toLocaleDateString('sv-SE', { timeZone: 'Asia/Seoul' });
}

function resolveDateKey(raw: string | undefined): string | null {
  const key = (raw ?? 'today').toLowerCase();
  if (key === 'today') return todayKstDateKey();
  if (key === 'yesterday') return yesterdayKstDateKey();
  if (/^\d{4}-\d{2}-\d{2}$/.test(key)) return key;
  return null;
}

function formatKstHm(iso: string | undefined): string {
  if (!iso) return 'none';
  const ts = Date.parse(iso);
  if (!Number.isFinite(ts)) return 'invalid';
  return new Date(ts).toLocaleString('ko-KR', {
    timeZone: 'Asia/Seoul',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  });
}

function buildLastActivityByCategory(history: AlertHistoryEntry[]): Record<AlertCategory, LastActivitySummary> {
  const result = {} as Record<AlertCategory, LastActivitySummary>;
  for (const category of CATEGORIES) result[category] = {};
  for (const entry of history) {
    const bucket = result[entry.category];
    if (!bucket) continue;
    if (!bucket.last) bucket.last = entry;
    if (!bucket.lastSent && entry.success && entry.delivery === 'immediate') bucket.lastSent = entry;
    if (!bucket.lastFailed && !entry.success) bucket.lastFailed = entry;
  }
  return result;
}

function compactBucket(
  category: AlertCategory,
  stats: ReturnType<typeof getChannelStatsByDate>,
  last: LastActivitySummary,
): string {
  const bucket = stats[category];
  const total = bucket.sent + bucket.failed + bucket.skipped + bucket.digested;
  const state = total === 0
    ? 'quiet'
    : bucket.failed > 0
      ? 'warn'
      : bucket.sent > 0
        ? 'sent'
        : bucket.digested > 0
          ? 'buffered'
          : 'skipped';
  return `${category}: ${state} · s${bucket.sent}/d${bucket.digested}/k${bucket.skipped}/f${bucket.failed} · last ${formatKstHm(last.last?.at)}`;
}

function buildVerdict(stats: ReturnType<typeof getChannelStatsByDate>): string {
  const totalSent = CATEGORIES.reduce((sum, category) => sum + stats[category].sent, 0);
  const totalFailed = CATEGORIES.reduce((sum, category) => sum + stats[category].failed, 0);
  const totalDigested = CATEGORIES.reduce((sum, category) => sum + stats[category].digested, 0);
  const totalSkipped = CATEGORIES.reduce((sum, category) => sum + stats[category].skipped, 0);

  if (totalFailed > 0) return `⚠️ failed=${totalFailed} — /channel_stats 상세 확인`;
  if (totalSent > 0) return `✅ sent=${totalSent}, digested=${totalDigested}, skipped=${totalSkipped}`;
  if (totalDigested > 0) return `🟡 sent=0, digest buffer=${totalDigested} — 조용히 누적 중`;
  if (totalSkipped > 0) return `🟡 sent=0, skipped=${totalSkipped} — cooldown/disabled 가능`;
  return '⚪ no channel activity yet — 이벤트가 아직 없거나 스케줄 대기';
}

function buildGlobalLastLine(lastByCategory: Record<AlertCategory, LastActivitySummary>): string {
  const lastSent = CATEGORIES
    .map((category) => lastByCategory[category].lastSent)
    .filter((entry): entry is AlertHistoryEntry => Boolean(entry))
    .sort((a, b) => b.at.localeCompare(a.at))[0];
  const lastFailed = CATEGORIES
    .map((category) => lastByCategory[category].lastFailed)
    .filter((entry): entry is AlertHistoryEntry => Boolean(entry))
    .sort((a, b) => b.at.localeCompare(a.at))[0];
  return `lastSent: ${lastSent ? `${lastSent.category} ${formatKstHm(lastSent.at)}` : 'none'} · lastFail: ${lastFailed ? `${lastFailed.category} ${formatKstHm(lastFailed.at)}` : 'none'}`;
}

function formatChannelActivity(rawArg?: string): string {
  const dateKey = resolveDateKey(rawArg);
  if (!dateKey) return '❌ 사용법: /channel_activity [today|yesterday|YYYY-MM-DD]';
  const stats = getChannelStatsByDate(dateKey);
  const recentKeys = getRecentDateKeys(5);
  const history = getRecentAlertHistory(200);
  const lastByCategory = buildLastActivityByCategory(history);
  const lines = [
    `📊 <b>CHANNEL ACTIVITY</b> ${dateKey} KST`,
    buildVerdict(stats),
    buildGlobalLastLine(lastByCategory),
    '',
    ...CATEGORIES.map((category) => compactBucket(category, stats, lastByCategory[category])),
    '',
    `recent: ${recentKeys.length > 0 ? recentKeys.join(', ') : 'none'}`,
    '상세: /channel_stats',
    '라우팅: /channel_routes',
  ];
  return lines.join('\n');
}

const channelActivity: TelegramCommand = {
  name: '/channel_activity',
  aliases: ['/alert_activity', '/channel_summary'],
  category: 'ALR',
  visibility: 'ADMIN',
  riskLevel: 0,
  description: '채널 활동량 요약 — sent/digested/skipped/failed compact view',
  usage: '/channel_activity [today|yesterday|YYYY-MM-DD]',
  async execute({ args, reply }) {
    await reply(formatChannelActivity(args[0]));
  },
};

commandRegistry.register(channelActivity);

export default channelActivity;
export { formatChannelActivity, buildLastActivityByCategory };
