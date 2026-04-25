// @responsibility: /stop — 비상 정지 발동 + 모든 미체결 주문 취소 (cancelAllPendingOrders). EMR.
import { setEmergencyStop } from '../../../state.js';
import { cancelAllPendingOrders } from '../../../emergency.js';
import { commandRegistry } from '../../commandRegistry.js';
import type { TelegramCommand } from '../_types.js';

const stop: TelegramCommand = {
  name: '/stop',
  category: 'EMR',
  visibility: 'ADMIN',
  riskLevel: 2,
  description: '비상 정지 발동 (미체결 전량 취소)',
  async execute({ reply }) {
    setEmergencyStop(true);
    console.error('[TelegramBot] Telegram /stop 명령 — 비상 정지 발동');
    await cancelAllPendingOrders().catch(console.error);
    await reply('🔴 <b>[비상 정지 발동]</b>\n모든 미체결 주문 취소 완료. /reset 으로 재개 가능.');
  },
};

commandRegistry.register(stop);

export default stop;
