// @responsibility 현재 Shadow 관측·전략·연구·알림 상태를 관리자에게 보여준다.
import { composeNowVerdict } from '../../metaCommands.js';
import { commandRegistry } from '../../commandRegistry.js';
import type { TelegramCommand } from '../_types.js';

const adminNowDetail: TelegramCommand = {
  name: '/admin_now_detail',
  aliases: ['/debug_macro', '/debug_regime', '/debug_market_state'],
  category: 'SYS', visibility: 'ADMIN', riskLevel: 0,
  description: 'Shadow 관측·전략·연구·알림 상태 상세',
  async execute({ reply }) {
    await reply(composeNowVerdict(new Date(), { mode: 'DEBUG', includeRaw: true }));
  },
};
commandRegistry.register(adminNowDetail);
