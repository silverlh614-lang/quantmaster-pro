// @responsibility 현재 Shadow 관측·매매·알림 건강 현황을 응답한다.
import { composeNowVerdict } from '../../metaCommands.js';
import { commandRegistry } from '../../commandRegistry.js';
import type { TelegramCommand } from '../_types.js';

const status: TelegramCommand = {
  name: '/status',
  category: 'SYS',
  visibility: 'MENU',
  riskLevel: 0,
  description: 'Shadow 관측·가상 매매·봇 건강 현황',
  async execute({ reply }) {
    await reply(composeNowVerdict());
  },
};

commandRegistry.register(status);
