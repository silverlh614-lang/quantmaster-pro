// @responsibility Counterfactual outcome board Telegram command aliases.
import {
  buildCounterfactualOutcomeBoard,
  formatCounterfactualCommandReply,
  resolveCounterfactualCommandMode,
} from '../../../learning/counterfactualOutcomeBoard.js';
import { getLastScanSummary } from '../../../trading/signalScanner/scanDiagnostics.js';
import { commandRegistry } from '../../commandRegistry.js';
import type { TelegramCommand } from '../_types.js';

const counterfactual: TelegramCommand = {
  name: '/counterfactual',
  aliases: [
    '/counterfactual_today',
    '/counterfactual_gate1',
    '/counterfactual_gate2',
    '/counterfactual_gate3',
    '/counterfactual_missed',
    '/counterfactual_review',
    '/counterfactual_debug',
  ],
  category: 'LRN',
  visibility: 'ADMIN',
  riskLevel: 0,
  description: 'Counterfactual outcome board by Gate band/blocker; read-only, executionImpact=NONE',
  usage: '/counterfactual [today|gate1|gate2|gate3|missed|review|debug]',
  async execute({ args, command, reply }) {
    const mode = resolveCounterfactualCommandMode(command, args);
    const board = await buildCounterfactualOutcomeBoard({
      lastScanSummary: getLastScanSummary(),
    });
    await reply(formatCounterfactualCommandReply(board, mode));
  },
};

commandRegistry.register(counterfactual);

export default counterfactual;
