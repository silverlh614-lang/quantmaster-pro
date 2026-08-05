// @responsibility Counterfactual outcome board Telegram command aliases.
import {
  buildCounterfactualOutcomeBoard,
  formatCounterfactualCommandReply,
  resolveCounterfactualCommandMode,
} from '../../../learning/counterfactualOutcomeBoard.js';
import { appendGateEvidenceForMode } from '../../../learning/counterfactualGateEvidenceBridge.js';
import { appendOutcomeMaturityDiagnostic } from '../../../learning/counterfactualOutcomeMaturityBridge.js';
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
    // 표시 patch(2026-07-31): "Total recorded" 와 "Mature D1/D3/D5/D10" 의 모집단이 달라
    // (outcome 미탑재 소스가 Total 에만 잡힘) D10=0 의 원인이 가려지던 것을 소스별로 분해.
    // 동일하게 보드 본체 무접촉 append — 표시 전용·executionImpact=NONE.
    const base = appendGateEvidenceForMode(mode, formatCounterfactualCommandReply(board, mode));
    await reply(appendOutcomeMaturityDiagnostic(base, board.rows));
  },
};

commandRegistry.register(counterfactual);

export default counterfactual;
