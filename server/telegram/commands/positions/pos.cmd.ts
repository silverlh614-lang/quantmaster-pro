import { escapeHtml } from '../../../alerts/telegramClient.js';
import { commandRegistry } from '../../commandRegistry.js';
import type { TelegramCommand } from '../_types.js';
import {
  aggregatePositionSources,
  formatMoney,
  formatMultiple,
  formatPercent,
  formatSignedMoney,
  type TelegramPositionEntry,
} from './shadowPositionSources.js';

function renderPositionLine(position: TelegramPositionEntry, index: number): string {
  const name = escapeHtml(position.stockName || position.stockCode);
  const code = escapeHtml(position.stockCode);
  const status = escapeHtml(position.status);

  return [
    `${index + 1}. <b>${name} / ${code}</b>`,
    `   수량: ${position.qty.toLocaleString('ko-KR')}`,
    `   진입가: ${formatMoney(position.entryPrice)}`,
    `   현재가: ${formatMoney(position.currentPrice)}`,
    `   평가손익: ${formatSignedMoney(position.unrealizedPnl)} (${formatPercent(position.unrealizedPct)})`,
    `   R multiple: ${formatMultiple(position.rMultiple)}`,
    `   상태: ${status}`,
    `   source: ${position.source}`,
  ].join('\n');
}

const command: TelegramCommand = {
  name: '/pos',
  aliases: ['pos'],
  category: 'POS',
  visibility: 'MENU',
  riskLevel: 0,
  description: '현재 Shadow/Virtual/Live 포지션 현황',
  async execute({ reply }) {
    const snapshot = aggregatePositionSources();
    const { mode, positions, account } = snapshot;
    const lines: string[] = [
      '📌 <b>포지션 현황</b>',
      `운영 모드: ${escapeHtml(mode.modeLabel)}`,
      `실거래: ${mode.liveTradingEnabled ? 'ON' : 'OFF'}`,
      `Shadow 학습: ${mode.shadowLearningEnabled ? 'ON' : 'OFF'}`,
      '',
    ];

    if (positions.length > 0) {
      lines.push('<b>[SHADOW 보유]</b>');
      lines.push(...positions.map(renderPositionLine));
    } else {
      lines.push('<b>[SHADOW 보유]</b>');
      lines.push('현재 조회 가능한 Shadow/Virtual/Live 포지션이 없습니다.');
    }

    lines.push('');
    lines.push('<b>[VIRTUAL 계좌]</b>');
    if (account) {
      lines.push(`평가금액: ${formatMoney(account.totalInvested + account.unrealizedPnl)}`);
      lines.push(`현금: ${formatMoney(account.cashBalance)}`);
      lines.push(`총자산: ${formatMoney(account.totalAssets)}`);
      lines.push(`당일 손익: ${formatSignedMoney(account.todayRealizedPnl)}`);
    } else {
      lines.push('평가금액: N/A');
      lines.push('현금: N/A');
      lines.push('총자산: N/A');
      lines.push('당일 손익: N/A');
    }

    lines.push('');
    lines.push(mode.liveTradingEnabled ? 'LIVE 보유: 조회 우선순위 후순위' : 'LIVE 보유: 없음');

    await reply(lines.join('\n'));
  },
};

commandRegistry.register(command);

export default command;
