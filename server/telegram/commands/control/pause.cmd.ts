// @responsibility: /pause — 소프트 일시정지 발동 (신규 tick 차단, 미체결·기존 포지션 유지). EMR.
import { getEmergencyStop, getAutoTradePaused, setAutoTradePaused } from '../../../state.js';
import { commandRegistry } from '../../commandRegistry.js';
import type { TelegramCommand } from '../_types.js';

const pause: TelegramCommand = {
  name: '/pause',
  category: 'EMR',
  visibility: 'ADMIN',
  riskLevel: 2,
  description: '엔진 소프트 일시정지 (주문 취소 없음)',
  async execute({ reply }) {
    if (getEmergencyStop()) {
      await reply('🔴 이미 비상 정지 상태입니다. /reset 으로 해제 후 /pause 사용 가능.');
      return;
    }
    if (getAutoTradePaused()) {
      await reply('⏸ 이미 일시정지 상태입니다. /resume 으로 재개 가능.');
      return;
    }
    setAutoTradePaused(true);
    console.warn('[TelegramBot] /pause — 소프트 일시정지 발동');
    await reply(
      '⏸ <b>[엔진 일시정지]</b>\n' +
      '신규 tick 실행 중단 (미체결 주문·기존 포지션 유지)\n' +
      '/resume 으로 재개 | /stop 으로 완전 정지',
    );
  },
};

commandRegistry.register(pause);

export default pause;
