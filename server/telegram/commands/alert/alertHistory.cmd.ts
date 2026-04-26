// @responsibility alertHistory.cmd 텔레그램 모듈
// @responsibility: /alert_history [n=8] — 최근 N건(최대 20) 알림 이력을 id/category/status/시각으로 표.
import { getRecentAlertHistory } from '../../../persistence/alertHistoryRepo.js';
import { escapeHtml } from '../../../alerts/telegramClient.js';
import { commandRegistry } from '../../commandRegistry.js';
import type { TelegramCommand } from '../_types.js';

const alertHistory: TelegramCommand = {
  name: '/alert_history',
  category: 'ALR',
  visibility: 'ADMIN',
  riskLevel: 0,
  description: '최근 알림 이력 조회 (기본 8건, 최대 20)',
  usage: '/alert_history [n=8]',
  async execute({ args, reply }) {
    const rawLimit = Number(args[0] ?? '8');
    const limit = Number.isFinite(rawLimit)
      ? Math.min(20, Math.max(1, Math.floor(rawLimit)))
      : 8;
    const rows = getRecentAlertHistory(limit);
    if (rows.length === 0) {
      await reply('ℹ️ alert history is empty');
      return;
    }
    const lines = rows.map(row => {
      const kst = new Date(row.at).toLocaleString('ko-KR', { timeZone: 'Asia/Seoul' });
      const status = row.success ? 'OK' : 'FAIL';
      return `${escapeHtml(row.id)} | ${row.category} | ${status} | ${kst}`;
    });
    await reply(
      `🗂️ <b>[Alert History 최근 ${rows.length}건]</b>\n` +
      `${lines.join('\n')}\n\n` +
      `<i>replay: /alert_replay &lt;id&gt; [TRADE|ANALYSIS|INFO|SYSTEM]</i>`,
    );
  },
};

commandRegistry.register(alertHistory);

export default alertHistory;
