// @responsibility channelStats.cmd 텔레그램 모듈
// @responsibility: /channel_stats — 채널 통계 조회 (today/yesterday/YYYY-MM-DD) — sent/skipped/failed/digested 분리 표시.
import { getChannelStatsByDate, getRecentDateKeys } from '../../../persistence/channelStatsRepo.js';
import { AlertCategory } from '../../../alerts/alertCategories.js';
import { commandRegistry } from '../../commandRegistry.js';
import type { TelegramCommand } from '../_types.js';

const channelStats: TelegramCommand = {
  name: '/channel_stats',
  category: 'ALR',
  visibility: 'ADMIN',
  riskLevel: 0,
  description: '채널 발송 통계 조회 ([YYYY-MM-DD|today|yesterday])',
  usage: '/channel_stats [YYYY-MM-DD|today|yesterday]',
  async execute({ args, reply }) {
    const raw = (args[0] ?? 'today').toLowerCase();
    const todayKey = new Date().toLocaleDateString('sv-SE', { timeZone: 'Asia/Seoul' });
    const yesterdayKey = new Date(Date.now() - 24 * 60 * 60 * 1000).toLocaleDateString('sv-SE', {
      timeZone: 'Asia/Seoul',
    });
    const dateKey = raw === 'today' ? todayKey : raw === 'yesterday' ? yesterdayKey : raw;
    if (!/^\d{4}-\d{2}-\d{2}$/.test(dateKey)) {
      await reply('❌ 사용법: /channel_stats [YYYY-MM-DD|today|yesterday]');
      return;
    }

    const stats = getChannelStatsByDate(dateKey);
    const recentKeys = getRecentDateKeys(7);
    const categories: AlertCategory[] = [
      AlertCategory.TRADE,
      AlertCategory.ANALYSIS,
      AlertCategory.INFO,
      AlertCategory.SYSTEM,
    ];
    const lines = categories.map(category => {
      const bucket = stats[category];
      return [
        `${category}:`,
        `emitted=${bucket.emitted}`,
        `routed=${bucket.routed}`,
        `sent=${bucket.sent}`,
        `buffered=${bucket.buffered}`,
        `skipped=${bucket.skipped}`,
        `failed=${bucket.failed}`,
        `digested=${bucket.digested}`,
        `cooldownSkipped=${bucket.cooldownSkipped}`,
        `disabledSkipped=${bucket.disabledSkipped}`,
        `missingChannelSkipped=${bucket.missingChannelSkipped}`,
        `directDmBypass=${bucket.directDmBypass}`,
        `lastEventType=${bucket.lastEventType ?? 'N/A'}`,
        `lastSentAt=${bucket.lastSentAt ?? 'N/A'}`,
        `lastSkippedReason=${bucket.lastSkippedReason ?? 'N/A'}`,
      ].join(' ');
    });
    const totalSent = categories.reduce((sum, c) => sum + stats[c].sent, 0);
    const totalFailed = categories.reduce((sum, c) => sum + stats[c].failed, 0);
    const totalEmitted = categories.reduce((sum, c) => sum + stats[c].emitted, 0);
    const totalBuffered = categories.reduce((sum, c) => sum + stats[c].buffered, 0);

    await reply(
      `📊 <b>[채널 통계 ${dateKey} KST]</b>\n` +
      `${lines.join('\n')}\n` +
      `total: emitted=${totalEmitted}, sent=${totalSent}, buffered=${totalBuffered}, failed=${totalFailed}\n` +
      `healthCheckStatus=separate_command:/channel_health\n` +
      `recent keys: ${recentKeys.length > 0 ? recentKeys.join(', ') : '(none)'}`,
    );
  },
};

commandRegistry.register(channelStats);

export default channelStats;
