// @responsibility refreshToken.cmd 텔레그램 모듈
// @responsibility: /refresh_token — KIS 토큰 무효화 + 강제 갱신 + 잔여 시간 보고. EMR 인프라.
import {
  invalidateKisToken,
  refreshKisToken,
  getKisTokenRemainingHours,
} from '../../../clients/kisClient.js';
import { commandRegistry } from '../../commandRegistry.js';
import type { TelegramCommand } from '../_types.js';

const refreshToken: TelegramCommand = {
  name: '/refresh_token',
  category: 'EMR',
  visibility: 'ADMIN',
  riskLevel: 1,
  description: 'KIS 토큰 강제 갱신',
  async execute({ reply }) {
    try {
      invalidateKisToken();
      await refreshKisToken();
      const hours = getKisTokenRemainingHours();
      await reply(`🔄 <b>KIS 토큰 강제 갱신 완료</b>\n잔여: ${hours}시간`);
    } catch (e) {
      await reply(
        `❌ <b>KIS 토큰 갱신 실패</b>\n${e instanceof Error ? e.message : String(e)}`,
      );
    }
  },
};

commandRegistry.register(refreshToken);

export default refreshToken;
