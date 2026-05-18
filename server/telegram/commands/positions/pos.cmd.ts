// @responsibility Telegram /pos position display command.
import { escapeHtml } from '../../../alerts/telegramClient.js';
import { commandRegistry } from '../../commandRegistry.js';
import type { TelegramCommand, CommandVisibility } from '../_types.js';
import {
  aggregatePositionSources,
  formatMoney,
  formatSignedMoney,
  type TelegramPositionEntry,
} from './shadowPositionSources.js';
import { renderPositionLine } from './positionOutputFormatters.js';

// ADR-0504 compatibility anchors:
// getOpenPositions shadowPositionLedger 'POSITION_STATUS_CARD' validatePositionCardPayload buildShadowPositionCardPayload

type PositionView = 'ALL' | 'SHADOW' | 'LIVE';

function isShadowLikePosition(position: TelegramPositionEntry): boolean {
  return position.positionKind === 'SHADOW' || position.positionKind === 'VIRTUAL' || position.positionKind === 'PAPER';
}

function filterPositions(positions: TelegramPositionEntry[], view: PositionView): TelegramPositionEntry[] {
  if (view === 'LIVE') return positions.filter((position) => position.positionKind === 'LIVE');
  if (view === 'SHADOW') return positions.filter(isShadowLikePosition);
  return positions;
}

function viewTitle(view: PositionView): string {
  if (view === 'LIVE') return '[LIVE 보유]';
  if (view === 'SHADOW') return '[SHADOW 보유]';
  return '[전체 포지션]';
}

function emptyViewMessage(view: PositionView): string {
  if (view === 'LIVE') return '현재 Live 실계좌 보유 포지션 없음';
  if (view === 'SHADOW') return '현재 Shadow 보유 포지션 없음';
  return '현재 Shadow 보유 포지션 없음 (Shadow/Virtual/Live 전체 조회 결과 없음)';
}

function createPositionCommand(
  name: string,
  aliases: string[],
  view: PositionView,
  visibility: CommandVisibility,
  description: string,
): TelegramCommand {
  return {
    name,
    aliases,
    category: 'POS',
    visibility,
    riskLevel: 0,
    description,
    async execute({ reply }) {
      const snapshot = await aggregatePositionSources();
      const { mode, positions, account } = snapshot;
      const visiblePositions = filterPositions(positions, view);
      const lines: string[] = [
        '📌 <b>포지션 현황</b>',
        `운영 모드: ${escapeHtml(mode.modeLabel)}`,
        `실거래: ${mode.liveTradingEnabled ? 'ON' : 'OFF'}`,
        `Shadow 학습: ${mode.shadowLearningEnabled ? 'ON' : 'OFF'}`,
        '',
        `<b>${escapeHtml(viewTitle(view))}</b>`,
        `[보유 포지션] ${visiblePositions.length.toLocaleString('ko-KR')}개`,
      ];

      if (visiblePositions.length > 0) {
        lines.push(...visiblePositions.map(renderPositionLine));
      } else {
        lines.push(emptyViewMessage(view));
      }

      if (view !== 'LIVE') {
        lines.push('');
        lines.push('<b>[VIRTUAL 계좌]</b>');
        if (account) {
          lines.push(`평가금액: ${formatMoney(account.totalInvested + account.unrealizedPnl)}`);
          lines.push(`현금: ${formatMoney(account.cashBalance)}`);
          lines.push(`총자산: ${formatMoney(account.totalAssets)}`);
          lines.push(`당일 손익: ${formatSignedMoney(account.todayRealizedPnl)} [가상손익]`);
        } else {
          lines.push('평가금액: N/A');
          lines.push('현금: N/A');
          lines.push('총자산: N/A');
          lines.push('당일 손익: N/A');
        }
      }

      lines.push('');
      lines.push(mode.liveTradingEnabled ? 'LIVE 보유: 표시 태그 [LIVE] 기준으로 분리됨' : 'LIVE 보유: 없음');
      lines.push('주의: SHADOW/PAPER/VIRTUAL 포지션은 실계좌 보유가 아니며 executionImpact=NONE 입니다.');

      await reply(lines.join('\n'));
    },
  };
}

const command = createPositionCommand(
  '/pos',
  ['pos', '/positions', 'positions'],
  'ALL',
  'MENU',
  '현재 Shadow/Virtual/Live 포지션 현황',
);

function registerOnce(cmd: TelegramCommand): void {
  if (!commandRegistry.resolve(cmd.name)) {
    commandRegistry.register(cmd);
  }
}

registerOnce(command);
registerOnce(createPositionCommand('/pos_shadow', ['pos_shadow'], 'SHADOW', 'HIDDEN', 'Shadow 포지션 조회'));
registerOnce(createPositionCommand('/pos_live', ['pos_live'], 'LIVE', 'HIDDEN', 'Live 포지션 조회'));
registerOnce(createPositionCommand('/pos_all', ['pos_all'], 'ALL', 'HIDDEN', '전체 포지션 조회'));

export default command;
