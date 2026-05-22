// @responsibility Telegram /pnl split PNL command.
import { commandRegistry } from '../../commandRegistry.js';
import type { TelegramCommand, CommandVisibility } from '../_types.js';
import { aggregatePnlSources } from './shadowPositionSources.js';
import { renderPnlSummary, type PnlView } from './positionOutputFormatters.js';
import { isEngineBlockQueryException, resolvePositionSource } from '../../../positions/positionSourceResolver.js';
import {
  formatPositionStateResolvedLog,
  formatTelegramPositionCommandUsingSsotLog,
  resolvePositionState,
} from '../../../positions/positionStateResolver.js';

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
      try {
      const snapshot = await aggregatePnlSources();
      console.info(`[SOURCE_QUERY_RESULT] correlationId=${correlationId ?? 'N/A'} command=${name} realizedPnlSource=ShadowTradeRepo unrealizedPnlSource=VirtualAccount virtualEquity=${snapshot.pnl.virtualTotalAssets} virtualCash=${snapshot.pnl.virtualCash} holding=${snapshot.openTrades.length} shadowPnL=${snapshot.counts.shadowRealizedCount + snapshot.counts.shadowOpenCount} livePnL=${snapshot.counts.livePnlSkipped ? 'SKIPPED' : 0}`);
      const resolution = resolvePositionSource({
        engineMode: snapshot.mode.modeLabel,
        liveCount: 0,
        shadowCount: snapshot.counts.shadowOpenCount,
        paperCount: snapshot.counts.paperLedgerCount,
        virtualCount: snapshot.counts.virtualAccountAvailable ? 1 : 0,
      });
      if (isEngineBlockQueryException(snapshot.mode.modeLabel)) {
        console.info(`[TELEGRAM_QUERY_ALLOWED_DESPITE_ENGINE_BLOCK] engineMode=${snapshot.mode.modeLabel} command=${name} executionImpact=NONE queryOnly=true tradeBlockedIgnoredForQuery=true`);
      }
      const positionStateResolution = await resolvePositionState(
        { modePreference: 'SHADOW_FIRST', includePending: true },
        snapshot.sourceAggregate ? { sourceAggregate: snapshot.sourceAggregate } : {},
      );
      console.info(formatPositionStateResolvedLog(positionStateResolution));
      console.info(formatTelegramPositionCommandUsingSsotLog({
        command: name,
        liveCount: 0,
        shadowCount: snapshot.counts.shadowOpenCount,
        virtualHoldingCount: snapshot.counts.virtualAccountAvailable ? 1 : 0,
        displayedCount: positionStateResolution.openCount + positionStateResolution.pendingCount,
      }));
      const message = `${renderPnlSummary(snapshot, view)}\nsourceResolver: ${resolution.selectedSource} (${resolution.reason})`;
      console.info(`[RESPONSE_FORMATTED] correlationId=${correlationId ?? 'N/A'} command=${name} bytes=${message.length}`);
      await reply(message);
      console.info(`[TELEGRAM_REPLY_SENT] correlationId=${correlationId ?? 'N/A'} command=${name}`);
      } catch (error) {
        console.error(`[TELEGRAM_PNL_QUERY_FAILED] correlationId=${correlationId ?? 'N/A'} command=${name}`, error);
        await reply('손익 조회 중 일부 데이터 소스 오류가 발생했습니다. 잠시 후 다시 시도해 주세요.');
      }
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
