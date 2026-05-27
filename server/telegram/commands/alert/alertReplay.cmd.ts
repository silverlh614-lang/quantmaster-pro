/**
 * @responsibility /alert_replay 명령 — 알림 ID로 원장을 조회해 PRIVATE DM 으로 재발송한다.
 */

import { findAlertHistoryById } from '../../../persistence/alertHistoryRepo.js';
import { sendPrivateAlert, escapeHtml } from '../../../alerts/telegramClient.js';
import { queryNotificationLedger } from '../../../persistence/notificationLedgerRepo.js';
import { commandRegistry } from '../../commandRegistry.js';
import type { TelegramCommand } from '../_types.js';

const alertReplay: TelegramCommand = {
  name: '/alert_replay', category: 'ALR', visibility: 'ADMIN', riskLevel: 1,
  description: '알림 ID를 PRIVATE DM으로 재표시', usage: '/alert_replay <id>',
  async execute({ args, reply, chatId }) {
    const id = (args[0] ?? '').trim();
    if (!id) return reply('❌ 사용법: /alert_replay <id>');
    if (chatId && process.env.TELEGRAM_CHAT_ID && chatId !== process.env.TELEGRAM_CHAT_ID) {
      await reply('❌ /alert_replay 는 PRIVATE DM 에서만 허용됩니다.');
      return;
    }
    const rows = await queryNotificationLedger({ keyword: id });
    const hit = rows.find(r => r.id === id);
    const body = hit?.message ?? findAlertHistoryById(id)?.message;
    if (!body) return reply(`❌ alert id not found: ${escapeHtml(id)}`);
    const msgId = await sendPrivateAlert(`${body}\n\n<i>[replay: ${escapeHtml(id)}]</i>`, { dedupeKey: `replay:${id}:${Date.now()}`, category: 'PRIVATE' }).catch(() => undefined);
    await reply(msgId !== undefined ? `✅ private replay sent: ${escapeHtml(id)} (message_id: ${msgId})` : `❌ replay failed: ${escapeHtml(id)}`);
  },
};
commandRegistry.register(alertReplay);
export default alertReplay;
