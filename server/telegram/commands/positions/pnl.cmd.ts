import { escapeHtml } from '../../../alerts/telegramClient.js';
import { commandRegistry } from '../../commandRegistry.js';
import type { TelegramCommand } from '../_types.js';
import {
  aggregatePnlSources,
  formatMoney,
  formatSignedMoney,
} from './shadowPositionSources.js';

const command: TelegramCommand = {
  name: '/pnl',
  aliases: ['pnl'],
  category: 'POS',
  visibility: 'MENU',
  riskLevel: 0,
  description: 'Shadow/Virtual 손익 현황',
  async execute({ reply }) {
    const snapshot = aggregatePnlSources();
    const { mode, counts, openTrades, pnl } = snapshot;
    const lines: string[] = [
      '📊 <b>손익 현황</b>',
      `운영 모드: ${escapeHtml(mode.modeLabel)}`,
      `실거래: ${mode.liveTradingEnabled ? 'ON' : 'OFF'}`,
      '',
      `Shadow 실현손익: ${formatSignedMoney(pnl.realizedPnl)}`,
      `Shadow 평가손익: ${formatSignedMoney(pnl.unrealizedPnl)}`,
      `Virtual 계좌 총자산: ${formatMoney(pnl.virtualTotalAssets)}`,
      `금일 Shadow PnL: ${formatSignedMoney(pnl.todayPnl)}`,
      `누적 Shadow PnL: ${formatSignedMoney(pnl.cumulativePnl)}`,
      `열린 Shadow 포지션 수: ${counts.shadowOpenCount.toLocaleString('ko-KR')}`,
      `종료 Shadow 트레이드 수: ${pnl.closedTradeCount.toLocaleString('ko-KR')}`,
      '',
      mode.liveTradingEnabled ? 'Live PnL: 조회 우선순위 후순위' : 'Live PnL: 비활성 또는 미사용',
    ];

    if (openTrades.length > 0) {
      lines.push('');
      lines.push('<b>[열린 Shadow 포지션]</b>');
      lines.push(
        ...openTrades.slice(0, 10).map((trade, index) => {
          const name = escapeHtml(trade.stockName || trade.stockCode);
          const code = escapeHtml(trade.stockCode);
          return `${index + 1}. ${name} / ${code} - ${escapeHtml(String(trade.status))}`;
        }),
      );
    }

    await reply(lines.join('\n'));
  },
};

commandRegistry.register(command);

export default command;
