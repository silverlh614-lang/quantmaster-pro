// @responsibility 기존 사이징 명령에 현재 Shadow의 실험 수량과 매매 현황을 안내한다.
import { composeNowVerdict } from '../../metaCommands.js';
import { commandRegistry } from '../../commandRegistry.js';
import type { TelegramCommand } from '../_types.js';
const kelly: TelegramCommand = {
  name: '/kelly', category: 'LRN', visibility: 'ADMIN', riskLevel: 0,
  description: 'Kelly 폐기 안내·현재 매매 현황',
  async execute({ reply }) {
    await reply('LIVE·PAPER·SHADOW 모든 모드에서 Kelly를 사용하지 않습니다. 현재 Shadow는 실험당 1주를 기록하며 실제 주문을 하지 않습니다.\n\n' + composeNowVerdict());
  },
};
commandRegistry.register(kelly);
