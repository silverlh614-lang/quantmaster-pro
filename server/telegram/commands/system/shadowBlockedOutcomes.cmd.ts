// @responsibility shadowBlockedOutcomes.cmd — Shadow blocked outcome analytics 텔레그램 명령.
// @responsibility: /shadow_blocked_outcomes — blockedReason별 사후 성과와 과도 차단 후보 요약.
//
// Read-only command. It only reads ShadowLearningOnlySignal ledger through the
// analytics module and never mutates live trading, preflight, Gate, Kelly, order,
// or Telegram state.

import {
  formatOutcomeRow,
  formatShadowBlockedOutcomeCompactLine,
  loadAndSummarizeShadowBlockedOutcomes,
  type ShadowOutcomeAttributionSummary,
} from '../../../learning/shadowBlockedOutcomeAnalytics.js';
import { commandRegistry } from '../../commandRegistry.js';
import type { TelegramCommand } from '../_types.js';

function appendSection(
  lines: string[],
  title: string,
  rows: ShadowOutcomeAttributionSummary[],
  limit = 5,
): void {
  if (rows.length === 0) return;
  lines.push('');
  lines.push(`<b>${title}</b>`);
  rows.slice(0, limit).forEach((row, idx) => {
    lines.push(`${idx + 1}. ${formatOutcomeRow(row)}`);
  });
}

const shadowBlockedOutcomes: TelegramCommand = {
  name: '/shadow_blocked_outcomes',
  aliases: ['/blocked_outcomes', '/shadow_blocks'],
  category: 'SYS',
  visibility: 'ADMIN',
  riskLevel: 0,
  description: 'Shadow blocked-day outcome analytics — blockedReason별 사후 성과 요약. read-only.',
  usage: '/shadow_blocked_outcomes',
  async execute({ reply }) {
    try {
      const summary = loadAndSummarizeShadowBlockedOutcomes();
      const compact = formatShadowBlockedOutcomeCompactLine(summary);
      if (!compact) {
        await reply([
          '🧪 <b>Shadow Blocked Outcomes</b>',
          '',
          '아직 Shadow blocked outcome ledger 표본이 없습니다.',
          '<i>blocked-day ShadowLearningOnlySignal 이 쌓이고 futureReturn 이 resolve 되면 이 명령에서 요약됩니다.</i>',
        ].join('\n'));
        return;
      }
      const lines: string[] = [compact];

      appendSection(lines, 'By blockedReason', summary.byBlockedReason);
      appendSection(lines, 'By blockedReason × signalGrade', summary.byBlockedReasonSignalGrade, 6);
      appendSection(lines, 'By blockedReason × macroBlockReason', summary.byBlockedReasonMacroBlockReason, 6);
      appendSection(lines, 'By macroBlockReason', summary.byMacroBlockReason, 3);
      appendSection(lines, 'By dataQualityStatus', summary.byDataQualityStatus, 3);
      appendSection(lines, 'By signalGrade', summary.bySignalGrade, 3);

      if (summary.topFastOverBlocked.length > 0) {
        appendSection(lines, 'Fast over-block watchlist', summary.topFastOverBlocked, 5);
      }

      if (summary.topOverBlockedReasons.length > 0) {
        appendSection(lines, 'Top over-blocked reasons', summary.topOverBlockedReasons, 5);
      }

      lines.push('');
      lines.push('<i>read-only analytics — executionImpact remains NONE.</i>');
      await reply(lines.join('\n'));
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      await reply(`❌ Shadow blocked outcome analytics 생성 실패: ${msg}`);
    }
  },
};

commandRegistry.register(shadowBlockedOutcomes);

export default shadowBlockedOutcomes;
