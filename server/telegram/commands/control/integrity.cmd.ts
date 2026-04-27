// @responsibility integrity.cmd 텔레그램 모듈
// @responsibility: /integrity [clear] — 데이터 무결성 차단 상태 조회/해제 (신규 매수 게이트). EMR.
import {
  getDataIntegrityBlocked,
  setDataIntegrityBlocked,
  getAutoTradePaused,
} from '../../../state.js';
import { commandRegistry } from '../../commandRegistry.js';
import type { TelegramCommand } from '../_types.js';

const integrity: TelegramCommand = {
  name: '/integrity',
  category: 'EMR',
  visibility: 'ADMIN',
  riskLevel: 1,
  description: '데이터 무결성 차단 상태 조회/해제',
  usage: '/integrity [clear]',
  async execute({ args, reply }) {
    const blocked = getDataIntegrityBlocked();
    const paused = getAutoTradePaused();
    if (args[0] === 'clear') {
      setDataIntegrityBlocked(false);
      await reply('🟢 <b>데이터 무결성 차단 해제</b>\n신규 매수 재허용.');
      return;
    }
    await reply(
      `🔍 <b>[데이터 무결성 상태]</b>\n` +
      `무결성 차단: ${blocked ? '🔴 차단 중 (신규 매수 금지)' : '🟢 정상'}\n` +
      `엔진 일시정지: ${paused ? '⏸ 정지 중' : '▶️ 실행 중'}\n` +
      (blocked ? `\n<i>/integrity clear — 차단 수동 해제</i>` : ''),
    );
  },
};

commandRegistry.register(integrity);

export default integrity;
