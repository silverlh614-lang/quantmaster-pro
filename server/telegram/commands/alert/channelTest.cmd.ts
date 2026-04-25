// @responsibility: /channel_test — TELEGRAM_CHAT_ID 채널로 테스트 메시지 전송하여 봇 권한·연결을 검증.
import { commandRegistry } from '../../commandRegistry.js';
import type { TelegramCommand } from '../_types.js';

const channelTest: TelegramCommand = {
  name: '/channel_test',
  category: 'ALR',
  visibility: 'ADMIN',
  riskLevel: 1,
  description: '채널 연결 테스트 (TELEGRAM_CHAT_ID 로 발송)',
  async execute({ reply }) {
    await reply(
      `🔍 <b>[채널 테스트]</b>\n` +
      `CHANNEL_ENABLED: ${process.env.CHANNEL_ENABLED ?? '미설정'}\n` +
      `TELEGRAM_CHAT_ID: ${process.env.TELEGRAM_CHAT_ID ?? '미설정'}\n` +
      `채널로 테스트 메시지를 전송합니다...`,
    );
    const { sendChannelAlert } = await import('../../../alerts/telegramClient.js');
    const kstStr = new Date(Date.now() + 9 * 3_600_000)
      .toISOString()
      .replace('T', ' ')
      .slice(0, 19);
    const msgId = await sendChannelAlert(
      `🧪 <b>[채널 연결 테스트]</b>\n` +
      `━━━━━━━━━━━━━━━━\n` +
      `✅ QuantMaster Pro 채널 연결 성공\n` +
      `⏰ ${kstStr} KST`,
    ).catch(() => null);
    await reply(
      msgId
        ? `✅ 채널 발송 성공 (message_id: ${msgId})`
        : `❌ 채널 발송 실패 — TELEGRAM_CHAT_ID 또는 봇 권한 확인 필요`,
    );
  },
};

commandRegistry.register(channelTest);

export default channelTest;
