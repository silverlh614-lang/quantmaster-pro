// @responsibility alertReplay.cmd 텔레그램 모듈
// @responsibility: /alert_replay <id> [TRADE|ANALYSIS|INFO|SYSTEM] — alertHistoryRepo 에서 id 조회 후 dispatchAlert 재발송.
import { findAlertHistoryById } from '../../../persistence/alertHistoryRepo.js';
import { AlertCategory } from '../../../alerts/alertCategories.js';
import { dispatchAlert } from '../../../alerts/alertRouter.js';
import { escapeHtml } from '../../../alerts/telegramClient.js';
import { commandRegistry } from '../../commandRegistry.js';
import type { TelegramCommand } from '../_types.js';

const alertReplay: TelegramCommand = {
  name: '/alert_replay',
  category: 'ALR',
  visibility: 'ADMIN',
  riskLevel: 1,
  description: '알림 ID 재전송 (카테고리 선택)',
  usage: '/alert_replay <id> [TRADE|ANALYSIS|INFO|SYSTEM]',
  async execute({ args, reply }) {
    const id = (args[0] ?? '').trim();
    const categoryRaw = (args[1] ?? '').trim().toUpperCase();
    if (!id) {
      await reply('❌ 사용법: /alert_replay <id> [TRADE|ANALYSIS|INFO|SYSTEM]');
      return;
    }

    const history = findAlertHistoryById(id);
    if (!history) {
      await reply(`❌ alert id not found: ${escapeHtml(id)}`);
      return;
    }

    const targetCategory = categoryRaw
      ? (Object.values(AlertCategory).includes(categoryRaw as AlertCategory)
          ? (categoryRaw as AlertCategory)
          : null)
      : history.category;

    if (!targetCategory) {
      await reply('❌ category must be one of TRADE, ANALYSIS, INFO, SYSTEM');
      return;
    }

    const replayMessage = `${history.message}\n\n<i>[replay: ${escapeHtml(id)}]</i>`;
    const msgId = await dispatchAlert(targetCategory, replayMessage, {
      priority: history.priority,
      dedupeKey: `replay:${id}:${Date.now()}`,
      delivery: 'immediate',
    }).catch(() => undefined);

    await reply(
      msgId !== undefined
        ? `✅ replay sent: ${escapeHtml(id)} -> ${targetCategory} (message_id: ${msgId})`
        : `❌ replay failed: ${escapeHtml(id)} -> ${targetCategory}`,
    );
  },
};

commandRegistry.register(alertReplay);

export default alertReplay;
