// @responsibility: /channel_health — 4채널 (TRADE/ANALYSIS/INFO/SYSTEM) 상태 점검 후 enabled/configured/reason 표.
import { runChannelHealthCheck } from '../../../alerts/alertRouter.js';
import { AlertCategory } from '../../../alerts/alertCategories.js';
import { escapeHtml } from '../../../alerts/telegramClient.js';
import { commandRegistry } from '../../commandRegistry.js';
import type { TelegramCommand } from '../_types.js';

const channelHealth: TelegramCommand = {
  name: '/channel_health',
  category: 'ALR',
  visibility: 'ADMIN',
  riskLevel: 0,
  description: '4채널 상태 점검 (TRADE/ANALYSIS/INFO/SYSTEM)',
  async execute({ reply }) {
    await reply('🧪 4개 채널 헬스체크를 실행합니다...');
    const result = await runChannelHealthCheck();
    const categories: AlertCategory[] = [
      AlertCategory.TRADE,
      AlertCategory.ANALYSIS,
      AlertCategory.INFO,
      AlertCategory.SYSTEM,
    ];
    const lines = categories.map(category => {
      const item = result[category];
      const icon = item.ok ? '✅' : '❌';
      const reason = item.reason ? ` (${escapeHtml(item.reason)})` : '';
      const enabled = item.enabled ? '' : ' [disabled]';
      const configured = item.configured ? '' : ' [unconfigured]';
      return `${category}: ${icon}${enabled}${configured}${reason}`;
    });
    await reply(`🧪 <b>[채널 헬스체크 결과]</b>\n${lines.join('\n')}`);
  },
};

commandRegistry.register(channelHealth);

export default channelHealth;
