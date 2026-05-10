// @responsibility shadowBlockedOutcomes.cmd — Shadow blocked outcome analytics 텔레그램 명령.
// @responsibility: /shadow_blocked_outcomes — blockedReason별 사후 성과와 과도 차단 후보 요약.
//
// Read-only command. It only reads ShadowLearningOnlySignal ledger through the
// analytics module and never mutates live trading, preflight, Gate, Kelly, order,
// or Telegram state.

import {
  formatShadowBlockedOutcomeCompactLine,
  loadAndSummarizeShadowBlockedOutcomes,
} from '../../../learning/shadowBlockedOutcomeAnalytics.js';
import { commandRegistry } from '../../commandRegistry.js';
import type { TelegramCommand } from '../_types.js';

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
      if (summary.topOverBlockedReasons.length > 0) {
        lines.push('');
        lines.push('Top over-blocked reasons:');
        summary.topOverBlockedReasons.slice(0, 5).forEach((row, idx) => {
          const avg5d = row.avgReturn5d === null ? 'n/a' : `${row.avgReturn5d > 0 ? '+' : ''}${(row.avgReturn5d * 100).toFixed(1)}%`;
          const win5d = row.winRate5d === null ? 'n/a' : `${(row.winRate5d * 100).toFixed(1)}%`;
          lines.push(`${idx + 1}. ${row.blockedReason}: over=${row.overBlockedCount}, total=${row.total}, 5d=${avg5d}, win=${win5d}`);
        });
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
