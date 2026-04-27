// @responsibility pending.cmd 텔레그램 모듈
// @responsibility: /pending — fillMonitor 기준 PENDING/PARTIAL 미체결 주문을 종목·수량·폴링 카운트와 함께 나열.
import { fillMonitor } from '../../../trading/fillMonitor.js';
import { escapeHtml } from '../../../alerts/telegramClient.js';
import { commandRegistry } from '../../commandRegistry.js';
import type { TelegramCommand } from '../_types.js';

const pending: TelegramCommand = {
  name: '/pending',
  category: 'POS',
  visibility: 'ADMIN',
  riskLevel: 0,
  description: '미체결 주문 조회',
  async execute({ reply }) {
    const orders = fillMonitor
      .getPendingOrders()
      .filter(o => o.status === 'PENDING' || o.status === 'PARTIAL');
    if (orders.length === 0) {
      await reply('✅ 미체결 주문 없음');
      return;
    }
    const lines = orders
      .map(
        o =>
          `• ${escapeHtml(o.stockName)}(${escapeHtml(o.ordNo)}) ${o.quantity}주 @${o.orderPrice.toLocaleString()} [${o.pollCount}/${10}회]`,
      )
      .join('\n');
    await reply(`⏳ <b>미체결 주문 (${orders.length}건)</b>\n${lines}`);
  },
};

commandRegistry.register(pending);

export default pending;
