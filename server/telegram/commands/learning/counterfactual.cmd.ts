// @responsibility Counterfactual outcome board Telegram command aliases.
import {
  buildCounterfactualOutcomeBoard,
  formatCounterfactualCommandReply,
  resolveCounterfactualCommandMode,
} from '../../../learning/counterfactualOutcomeBoard.js';
import { appendGateEvidenceForMode } from '../../../learning/counterfactualGateEvidenceBridge.js';
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
    // 표시 patch(2026-06-11): gate2/gate3 뷰는 보드 행과 별개로 누적 중인 네이티브 outcome
    // ledger(Gate2 seed·Gate3 evidence) 요약을 덧붙인다 — 보드 본체(1,499줄 한계) 무접촉.
    await reply(appendGateEvidenceForMode(mode, formatCounterfactualCommandReply(board, mode)));
  },
};

commandRegistry.register(counterfactual);

export default counterfactual;
