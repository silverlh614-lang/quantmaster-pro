// @responsibility channelActivity.cmd — compact read-only channel activity summary.
// @responsibility: /channel_activity — 오늘 채널별 sent/failed/skipped/digested를 한 화면에 요약.

import { AlertCategory } from '../../../alerts/alertCategories.js';
import { getChannelStatsByDate, getRecentDateKeys } from '../../../persistence/channelStatsRepo.js';
import { commandRegistry } from '../../commandRegistry.js';
import type { TelegramCommand } from '../_types.js';

const CATEGORIES: AlertCategory[] = [
  AlertCategory.TRADE,
  AlertCategory.ANALYSIS,
  AlertCategory.INFO,
  AlertCategory.SYSTEM,
];

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

function compactBucket(category: AlertCategory, stats: ReturnType<typeof getChannelStatsByDate>): string {
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
  return `${category}: ${state} · s${bucket.sent}/d${bucket.digested}/k${bucket.skipped}/f${bucket.failed}`;
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

function formatChannelActivity(rawArg?: string): string {
  const dateKey = resolveDateKey(rawArg);
  if (!dateKey) return '❌ 사용법: /channel_activity [today|yesterday|YYYY-MM-DD]';
  const stats = getChannelStatsByDate(dateKey);
  const recentKeys = getRecentDateKeys(5);
  const lines = [
    `📊 <b>CHANNEL ACTIVITY</b> ${dateKey} KST`,
    buildVerdict(stats),
    '',
    ...CATEGORIES.map((category) => compactBucket(category, stats)),
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
export { formatChannelActivity };
