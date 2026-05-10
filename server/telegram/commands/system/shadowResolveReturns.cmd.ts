// @responsibility shadowResolveReturns.cmd — Shadow future-return resolver manual command.
// @responsibility: /shadow_resolve_returns — cache-backed futureReturn resolver 수동 실행.
//
// This command updates only the ShadowLearningOnlySignal learning ledger through
// its SSOT resolver. It does not touch live trading, preflight, Gate, Kelly,
// STRONG_BUY, or order paths.

import { loadResolveAndSaveShadowFutureReturnsFromCache } from '../../../learning/shadowFutureReturnCacheProvider.js';
import { commandRegistry } from '../../commandRegistry.js';
import type { TelegramCommand } from '../_types.js';

function formatShadowResolveReturnsStats(stats: Awaited<ReturnType<typeof loadResolveAndSaveShadowFutureReturnsFromCache>>): string {
  return [
    '🧪 <b>Shadow Future Returns Resolver</b>',
    '',
    `• scanned: ${stats.scanned}`,
    `• updatedSignals: ${stats.updatedSignals}`,
    `• resolved: 1d=${stats.resolved1d}, 3d=${stats.resolved3d}, 5d=${stats.resolved5d}, 20d=${stats.resolved20d}`,
    `• skippedAlreadyResolved: ${stats.skippedAlreadyResolved}`,
    `• providerMisses: ${stats.providerMisses}`,
    '',
    '<i>cache-backed read-only price source; updates learning ledger only.</i>',
  ].join('\n');
}

const shadowResolveReturns: TelegramCommand = {
  name: '/shadow_resolve_returns',
  aliases: ['/resolve_shadow_returns', '/shadow_return_resolve'],
  category: 'SYS',
  visibility: 'ADMIN',
  riskLevel: 0,
  description: 'Shadow blocked-day futureReturn resolver 수동 실행. learning ledger only.',
  usage: '/shadow_resolve_returns',
  async execute({ reply }) {
    try {
      const stats = await loadResolveAndSaveShadowFutureReturnsFromCache();
      await reply(formatShadowResolveReturnsStats(stats));
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      await reply(`❌ Shadow futureReturn resolver 실행 실패: ${msg}`);
    }
  },
};

commandRegistry.register(shadowResolveReturns);

export default shadowResolveReturns;
