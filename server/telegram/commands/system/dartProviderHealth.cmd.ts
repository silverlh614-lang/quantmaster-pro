// @responsibility /dart_provider_health read-only DART provider/Gate2 cache diagnostics.

import { commandRegistry } from '../../commandRegistry.js';
import type { TelegramCommand } from '../_types.js';
import { getGate2DartProviderHealth } from '../../../trading/gate2/gate2ExternalDataProvider.js';

function formatDartProviderHealthMessage(): string {
  const health = getGate2DartProviderHealth();
  return [
    '[dart_provider_health] DART Provider Health',
    `apiKeyPresent=${health.apiKeyPresent}`,
    `corpCodeCacheLoaded=${health.corpCodeCacheLoaded}`,
    `corpCodeCacheCount=${health.corpCodeCacheCount}`,
    `lastCorpCodeCacheUpdatedAt=${health.lastCorpCodeCacheUpdatedAt ?? 'NONE'}`,
    `requestEnabled=${health.requestEnabled}`,
    `lastHttpStatus=${health.lastHttpStatus ?? 'NONE'}`,
    `lastErrorCode=${health.lastErrorCode ?? 'NONE'}`,
    `lastNonBlockingIssue=${health.lastNonBlockingIssue ?? 'NONE'}`,
    `lastNonBlockingSymbols=${health.lastNonBlockingSymbols?.join(',') || 'NONE'}`,
    `rateLimitState=${health.rateLimitState}`,
    `cacheWritable=${health.cacheWritable}`,
    'executionImpact=NONE',
    'note: api keys and tokens are never printed.',
  ].join('\n');
}

const dartProviderHealth: TelegramCommand = {
  name: '/dart_provider_health',
  aliases: ['/dart_health', '/gate2_dart_health'],
  category: 'SYS',
  visibility: 'ADMIN',
  riskLevel: 0,
  description: 'Read-only DART provider health for Gate2 external financials',
  usage: '/dart_provider_health',
  async execute({ reply }) {
    await reply(formatDartProviderHealthMessage());
  },
};

commandRegistry.register(dartProviderHealth);

export { formatDartProviderHealthMessage };
export default dartProviderHealth;
