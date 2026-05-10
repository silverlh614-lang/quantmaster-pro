import { loadAndBuildShadowFutureReturnCacheCoverageSummary, loadResolveAndSaveShadowFutureReturnsFromCache } from '../../../learning/shadowFutureReturnCacheProvider.js';
import { clampShadowReturnWarmupLimit, runShadowFutureReturnWarmup, SHADOW_RETURN_WARMUP_DEFAULT_LIMIT } from '../../../learning/shadowFutureReturnWarmupPlanner.js';
import { commandRegistry } from '../../commandRegistry.js';
import type { TelegramCommand } from '../_types.js';

export function parseShadowFlowLimit(args: string[]): number {
  const raw = args[0];
  if (!raw) return SHADOW_RETURN_WARMUP_DEFAULT_LIMIT;
  const n = Number.parseInt(raw, 10);
  return Number.isFinite(n) ? clampShadowReturnWarmupLimit(n) : SHADOW_RETURN_WARMUP_DEFAULT_LIMIT;
}

const shadowFlow: TelegramCommand = {
  name: '/shadow_return_flow',
  aliases: ['/shadow_flow_returns'],
  category: 'SYS',
  visibility: 'ADMIN',
  riskLevel: 0,
  description: 'Run Shadow return cache warmup and resolver together.',
  usage: '/shadow_return_flow [limit=20]',
  async execute({ args, reply }) {
    const limit = parseShadowFlowLimit(args);
    const before = loadAndBuildShadowFutureReturnCacheCoverageSummary();
    const warmup = await runShadowFutureReturnWarmup(limit);
    const resolve = await loadResolveAndSaveShadowFutureReturnsFromCache();
    const after = loadAndBuildShadowFutureReturnCacheCoverageSummary();
    await reply([
      '🛠️ <b>Shadow Return Flow</b>',
      '',
      `Before: lookups=${before.checkedLookups}, hits=${before.cacheHits}, misses=${before.cacheMisses}, pending=${before.notYetDueLookups}, snapshots=${before.snapshotEntries}`,
      `Warmup: symbols=${warmup.attemptedSymbols}/${warmup.targetSymbols}, requests=${warmup.attemptedRequests}, stored=${warmup.storedSnapshots}, notFound=${warmup.notFound}, errors=${warmup.failed}`,
      `Resolver: updated=${resolve.updatedSignals}, miss=${resolve.providerMisses}, pending=${resolve.notYetDue}`,
      `After: lookups=${after.checkedLookups}, hits=${after.cacheHits}, misses=${after.cacheMisses}, pending=${after.notYetDueLookups}, snapshots=${after.snapshotEntries}`,
    ].join('\n'));
  },
};

commandRegistry.register(shadowFlow);

export default shadowFlow;
