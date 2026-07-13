// @responsibility /channel_flush_status read-only Telegram channel digest buffer status.
import { getChannelFlushStatus } from '../../../alerts/alertRouter.js';
import { commandRegistry } from '../../commandRegistry.js';
import type { TelegramCommand } from '../_types.js';

const channelFlushStatus: TelegramCommand = {
  name: '/channel_flush_status',
  category: 'ALR',
  visibility: 'ADMIN',
  riskLevel: 0,
  description: '채널 digest/flush 버퍼 상태 조회',
  usage: '/channel_flush_status',
  async execute({ reply }) {
    const status = getChannelFlushStatus();
    await reply(
      `🧾 <b>[Channel Flush Status]</b>\n` +
      `infoDailyDigestBuffer=${status.infoDailyDigestBufferLength}\n` +
      `systemDailyBuffer=${status.systemDailyBufferLength}\n` +
      `systemWeeklyBuffer=${status.systemWeeklyBufferLength}\n` +
      `lastInfoFlushAt=${status.lastInfoFlushAt ?? 'N/A'}\n` +
      `lastSystemDailyFlushAt=${status.lastSystemDailyFlushAt ?? 'N/A'}\n` +
      `lastSystemWeeklyFlushAt=${status.lastSystemWeeklyFlushAt ?? 'N/A'}\n` +
      `nextScheduledFlushAt=${status.nextScheduledFlushAt}\n` +
      `flushJobEnabled=${status.flushJobEnabled}\n` +
      `executionImpact=NONE`,
    );
  },
};

commandRegistry.register(channelFlushStatus);
