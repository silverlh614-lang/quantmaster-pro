// @responsibility /bridge_stats — read-only ADR-0551 LeadershipBridge 주입률·스킵사유 조회(shadow 검증, live 변경 0).
import {
  summarizeLeadershipBridgeLedger,
  formatLeadershipBridgeLedgerSummaryLines,
} from '../../../persistence/leadershipBridgeLedgerRepo.js';
import { isLeadershipBridgeEnabled } from '../../../screener/leadershipBridge.js';
import { commandRegistry } from '../../commandRegistry.js';
import type { TelegramCommand } from '../_types.js';

const leadershipBridgeStats: TelegramCommand = {
  name: '/bridge_stats',
  aliases: ['/leadership_bridge'],
  category: 'SYS',
  visibility: 'HIDDEN',
  riskLevel: 0,
  description: 'ADR-0551 LeadershipBridge 주입률·스킵사유 (shadow 검증, read-only)',
  async execute({ reply, correlationId }) {
    console.info(`[BRIDGE_STATS_QUERY] correlationId=${correlationId ?? 'N/A'} command=/bridge_stats`);
    const summary = summarizeLeadershipBridgeLedger();
    const message = formatLeadershipBridgeLedgerSummaryLines(summary, isLeadershipBridgeEnabled()).join('\n');
    await reply(message);
    console.info(`[TELEGRAM_REPLY_SENT] correlationId=${correlationId ?? 'N/A'} command=/bridge_stats bytes=${message.length}`);
  },
};

commandRegistry.register(leadershipBridgeStats);

export default leadershipBridgeStats;
