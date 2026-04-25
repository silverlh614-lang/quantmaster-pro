// @responsibility: /ai_status 명령 — Gemini 예산·서킷·런타임 상태를 1메시지 요약.
import {
  getBudgetState,
  getGeminiCircuitStats,
  getGeminiRuntimeState,
} from '../../../clients/geminiClient.js';
import { commandRegistry } from '../../commandRegistry.js';
import type { TelegramCommand } from '../_types.js';

const aiStatus: TelegramCommand = {
  name: '/ai_status',
  category: 'SYS',
  visibility: 'ADMIN',
  riskLevel: 0,
  description: 'Gemini 예산/서킷/최근 실패 사유 조회',
  async execute({ reply }) {
    const budget = getBudgetState();
    const circuit = getGeminiCircuitStats();
    const runtime = getGeminiRuntimeState();
    await reply(
      `🤖 <b>[AI 상태]</b>\n` +
      `런타임: ${runtime.status}${runtime.reason ? ` (${runtime.reason})` : ''}\n` +
      `호출처: ${runtime.caller ?? '-'}\n` +
      `최근시각: ${runtime.updatedAt ?? '-'}\n` +
      `서킷: ${circuit.state} (실패 ${circuit.failures}회)\n` +
      `예산: $${budget.spentUsd.toFixed(2)} / $${budget.budgetUsd.toFixed(2)} (${budget.pctUsed.toFixed(1)}%)\n` +
      `차단: ${budget.blocked ? 'ON' : 'OFF'}`,
    );
  },
};

commandRegistry.register(aiStatus);

export default aiStatus;
