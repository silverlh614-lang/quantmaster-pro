// @responsibility Telegram command for Shadow futureReturn snapshot warmup.

import {
  clampShadowReturnWarmupLimit,
  runShadowFutureReturnWarmup,
  SHADOW_RETURN_WARMUP_DEFAULT_LIMIT,
  type ShadowFutureReturnWarmupStats,
} from '../../../learning/shadowFutureReturnWarmupPlanner.js';
import { commandRegistry } from '../../commandRegistry.js';
import type { TelegramCommand } from '../_types.js';

export function parseShadowWarmupReturnsLimit(args: string[]): number {
  const raw = args[0];
  if (!raw) return SHADOW_RETURN_WARMUP_DEFAULT_LIMIT;
  const parsed = Number.parseInt(raw, 10);
  if (!Number.isFinite(parsed)) return SHADOW_RETURN_WARMUP_DEFAULT_LIMIT;
  return clampShadowReturnWarmupLimit(parsed);
}

function formatShadowWarmupReturnsStats(stats: ShadowFutureReturnWarmupStats): string {
  const lines = [
    '🧪 <b>Shadow Return Warmup</b>',
    '',
    `• candidateSignals: ${stats.candidateSignals}`,
    `• targetSymbols: ${stats.targetSymbols}`,
    `• attemptedSymbols: ${stats.attemptedSymbols}`,
    `• attemptedRequests: ${stats.attemptedRequests}`,
    `• storedSnapshots: ${stats.storedSnapshots}`,
    `• notFound: ${stats.notFound}`,
    `• failed: ${stats.failed}`,
    `• skippedAlreadyResolved: ${stats.skippedAlreadyResolved}`,
  ];

  if (stats.sampleTargets.length > 0) {
    lines.push('', 'sampleTargets:');
    for (const target of stats.sampleTargets.slice(0, 10)) {
      lines.push(`- <code>${target}</code>`);
    }
  }

  if (stats.sampleFailures.length > 0) {
    lines.push('', 'sampleFailures:');
    for (const failure of stats.sampleFailures.slice(0, 10)) {
      lines.push(`- <code>${failure}</code>`);
    }
  }

  lines.push('', '<i>Snapshot cache warmup only. No live trading behavior changes.</i>');
  return lines.join('\n');
}

const shadowWarmupReturns: TelegramCommand = {
  name: '/shadow_warmup_returns',
  aliases: ['/warmup_shadow_returns', '/shadow_return_warmup'],
  category: 'SYS',
  visibility: 'ADMIN',
  riskLevel: 0,
  description: 'Warm up Yahoo snapshots for unresolved Shadow futureReturn symbols.',
  usage: '/shadow_warmup_returns [limit=20]',
  async execute({ args, reply }) {
    try {
      const limit = parseShadowWarmupReturnsLimit(args);
      const stats = await runShadowFutureReturnWarmup(limit);
      await reply(formatShadowWarmupReturnsStats(stats));
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      await reply(`Shadow return warmup failed: ${msg}`);
    }
  },
};

commandRegistry.register(shadowWarmupReturns);

export default shadowWarmupReturns;
