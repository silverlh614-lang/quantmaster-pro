// @responsibility Telegram /pnl split PNL command.
import { commandRegistry } from '../../commandRegistry.js';
import type { TelegramCommand, CommandVisibility } from '../_types.js';
import { aggregatePnlSources } from './shadowPositionSources.js';
import { renderPnlSummary, type PnlView } from './positionOutputFormatters.js';

function createPnlCommand(
  name: string,
  aliases: string[],
  view: PnlView,
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
    async execute({ reply, correlationId }) {
      console.info(`[PORTFOLIO_QUERY_STARTED] correlationId=${correlationId ?? 'N/A'} command=${name}`);
      const snapshot = await aggregatePnlSources();
      console.info(`[SOURCE_QUERY_RESULT] correlationId=${correlationId ?? 'N/A'} command=${name} realizedPnlSource=ShadowTradeRepo unrealizedPnlSource=VirtualAccount virtualEquity=${snapshot.pnl.virtualTotalAssets} virtualCash=${snapshot.pnl.virtualCash} holding=${snapshot.openTrades.length} shadowPnL=${snapshot.counts.shadowRealizedCount + snapshot.counts.shadowOpenCount} livePnL=${snapshot.counts.livePnlSkipped ? 'SKIPPED' : 0}`);
      const message = renderPnlSummary(snapshot, view);
      console.info(`[RESPONSE_FORMATTED] correlationId=${correlationId ?? 'N/A'} command=${name} bytes=${message.length}`);
      await reply(message);
      console.info(`[TELEGRAM_REPLY_SENT] correlationId=${correlationId ?? 'N/A'} command=${name}`);
    },
  };
}

const command = createPnlCommand('/pnl', ['pnl'], 'ALL', 'MENU', 'Shadow/Virtual/Live 손익 현황');

function registerOnce(cmd: TelegramCommand): void {
  if (!commandRegistry.resolve(cmd.name)) {
    commandRegistry.register(cmd);
  }
}

registerOnce(command);
registerOnce(createPnlCommand('/pnl_shadow', ['pnl_shadow'], 'SHADOW', 'HIDDEN', 'Shadow 가상 손익 조회'));
registerOnce(createPnlCommand('/pnl_live', ['pnl_live'], 'LIVE', 'HIDDEN', '실계좌 손익 조회'));

export default command;
