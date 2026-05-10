// @responsibility shadowCases.cmd — compact read-only Shadow blocked case runtime summary.
// @responsibility: /shadow_cases — 차단 사유별 Shadow 학습 케이스 누적 상태를 한 화면에 요약.

import {
  formatPct,
  loadAndSummarizeShadowBlockedOutcomes,
  type ShadowBlockedOutcomeSummary,
  type ShadowOutcomeAttributionSummary,
} from '../../../learning/shadowBlockedOutcomeAnalytics.js';
import { loadAndBuildShadowFutureReturnCacheCoverageSummary } from '../../../learning/shadowFutureReturnCacheProvider.js';
import { commandRegistry } from '../../commandRegistry.js';
import type { TelegramCommand } from '../_types.js';

function compactReason(row: ShadowOutcomeAttributionSummary): string {
  return `${row.key}: n=${row.total}, pend=${row.pendingCount}, res=${row.resolvedAnyCount}, 1d=${formatPct(row.avgReturn1d)}, over=${row.overBlockedCount}`;
}

function deriveVerdict(summary: ShadowBlockedOutcomeSummary): string {
  if (summary.totalSignals === 0) return '⚪ no blocked cases yet';
  if (summary.pendingSignals > summary.resolvedSignals) return '🟡 accumulating — outcomes still pending';
  if (summary.topOverBlockedReasons.length > 0) return '🟠 over-block watch active';
  return '🟢 learning ledger healthy';
}

function formatShadowCases(): string {
  const summary = loadAndSummarizeShadowBlockedOutcomes();
  const coverage = loadAndBuildShadowFutureReturnCacheCoverageSummary();
  if (summary.totalSignals === 0) {
    return [
      '🧪 <b>SHADOW CASES</b>',
      '⚪ no blocked learning cases yet',
      '',
      '상세: /shadow_blocked_outcomes',
      '<i>read-only; executionImpact=NONE.</i>',
    ].join('\n');
  }

  const topReasons = summary.byBlockedReason.slice(0, 5);
  const overTop = summary.topOverBlockedReasons[0];
  const lines = [
    '🧪 <b>SHADOW CASES</b>',
    deriveVerdict(summary),
    `total=${summary.totalSignals} · resolved=${summary.resolvedSignals} · pending=${summary.pendingSignals}`,
    `returnCache: miss=${coverage.cacheMisses} · unresolved=${coverage.unresolvedSignals} · due=${coverage.notYetDueLookups}`,
    '',
    '<b>Top reasons</b>',
    ...topReasons.map((row, idx) => `${idx + 1}. ${compactReason(row)}`),
    '',
    `<b>Over-block top</b>: ${overTop ? compactReason(overTop) : 'none'}`,
    '상세: /shadow_blocked_outcomes',
    '<i>read-only; executionImpact=NONE.</i>',
  ];
  return lines.join('\n');
}

const shadowCases: TelegramCommand = {
  name: '/shadow_cases',
  aliases: ['/shadow_blocked_summary', '/blocked_cases'],
  category: 'SYS',
  visibility: 'ADMIN',
  riskLevel: 0,
  description: 'Shadow blocked learning cases compact summary — read-only',
  usage: '/shadow_cases',
  async execute({ reply }) {
    await reply(formatShadowCases());
  },
};

commandRegistry.register(shadowCases);

export default shadowCases;
export { formatShadowCases };
