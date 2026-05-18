import { escapeHtml } from '../../../alerts/telegramClient.js';
import { commandRegistry } from '../../commandRegistry.js';
import type { TelegramCommand } from '../../commandTypes.js';
import {
  aggregatePnlSources,
  formatMoney,
  formatSignedMoney,
} from './shadowPositionSources.js';

const command: TelegramCommand = {
  name: 'pnl',
  description: 'Shadow/Virtual 손익 현황',
  async execute({ reply }) {
    const snapshot = aggregatePnlSources();
    const { mode, account, counts, openTrades, closedTrades } = snapshot;
    const shadowRealizedPnl = account?.realizedPnl ?? 0;
    const shadowUnrealizedPnl = account?.unrealizedPnl ?? 0;
    const cumulativeShadowPnl = shadowRealizedPnl + shadowUnrealizedPnl;
    const lines: string[] = [
      '📊 <b>손익 현황</b>',
      `운영 모드: ${escapeHtml(mode.modeLabel)}`,
      `실거래: ${mode.liveTradingEnabled ? 'ON' : 'OFF'}`,
      '',
      `Shadow 실현손익: ${formatSignedMoney(shadowRealizedPnl)}`,
      `Shadow 평가손익: ${formatSignedMoney(shadowUnrealizedPnl)}`,
      `Virtual 계좌 총자산: ${formatMoney(account?.totalAssets)}`,
      `금일 Shadow PnL: ${formatSignedMoney(account?.todayRealizedPnl ?? 0)}`,
      `누적 Shadow PnL: ${formatSignedMoney(cumulativeShadowPnl)}`,
      `열린 Shadow 포지션 수: ${counts.shadowOpenCount.toLocaleString('ko-KR')}`,
      `종료 Shadow 트레이드 수: ${closedTrades.length.toLocaleString('ko-KR')}`,
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
