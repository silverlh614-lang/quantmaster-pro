// @responsibility /gate2_external_status read-only Gate2 ExternalData cache status command.

import { commandRegistry } from '../../commandRegistry.js';
import type { TelegramCommand } from '../_types.js';
import { loadGate2ExternalCache, summarizeGate2ExternalCache } from '../../../trading/gate2/gate2ExternalCache.js';

function formatGate2ExternalStatusMessage(): string {
  const cache = loadGate2ExternalCache();
  const summary = summarizeGate2ExternalCache();
  const lastRefresh = cache.lastRefresh;
  const lastRefreshAsOf = lastRefresh?.asOf ?? summary.latestUpdatedAt ?? 'NONE';
  const lastRefreshRootCause = lastRefresh?.rootCause ?? (summary.recordCount > 0 ? 'REFRESH_METADATA_MISSING' : 'NONE');
  const counters = lastRefresh?.counters;
  const providerHealth = lastRefresh?.providerHealth;
  const samples = cache.records.slice(-8).map(record => {
    const snapshot = record.projection.financialSnapshot;
    return [
      record.symbol,
      `source=${snapshot.source}`,
      `confidence=${snapshot.confidence}`,
      `fiscalPeriod=${snapshot.fiscalPeriod ?? 'NONE'}`,
      `roe=${record.projection.profitability.roe ?? 'null'}`,
      `opm=${record.projection.profitability.opm ?? 'null'}`,
      `icr=${record.projection.stability.icr ?? 'null'}`,
      `unavailable=${record.projection.unavailableCount}`,
    ].join(':');
  });
  return [
    '[gate2_external_status] Gate2 ExternalData Cache',
    `cacheRecords=${summary.recordCount}`,
    `latestUpdatedAt=${summary.latestUpdatedAt ?? 'NONE'}`,
    `verified=${summary.verifiedCount} stale=${summary.staleCount} missing=${summary.missingCount}`,
    `rowsProjected=${summary.recordCount}`,
    `unavailableCount=${summary.unavailableCount}`,
    `lastRefreshMetadata=${lastRefresh ? 'present' : 'missing'}`,
    `lastRefreshAsOf=${lastRefreshAsOf}`,
    `lastRefreshRootCause=${lastRefreshRootCause}`,
    ...(counters ? [
      `providerRequestsAttempted=${counters.providerRequestsAttempted}`,
      `corpCodeResolved=${counters.corpCodeResolved}`,
      `corpCodeMissing=${counters.corpCodeMissing}`,
      `fiscalPeriodResolved=${counters.fiscalPeriodResolved}`,
      `fiscalPeriodMissing=${counters.fiscalPeriodMissing}`,
      `dartResponsesOk=${counters.dartResponsesOk}`,
      `dartResponsesError=${counters.dartResponsesError}`,
      `dartRowsFetched=${counters.dartRowsFetched}`,
      `normalizedRowsBuilt=${counters.normalizedRowsBuilt}`,
      `derivedMetricsComputed=${counters.derivedMetricsComputed}`,
      `kisPerAttempted=${counters.kisPerAttempted}`,
      `kisPerAvailable=${counters.kisPerAvailable}`,
      `kisPerUnavailable=${counters.kisPerUnavailable}`,
    ] : []),
    ...(providerHealth ? [
      `providerHealth=apiKeyPresent:${providerHealth.apiKeyPresent}|requestEnabled:${providerHealth.requestEnabled}|corpCodeCacheLoaded:${providerHealth.corpCodeCacheLoaded}|corpCodeCacheCount:${providerHealth.corpCodeCacheCount}|lastHttpStatus:${providerHealth.lastHttpStatus ?? 'NONE'}|lastErrorCode:${providerHealth.lastErrorCode ?? 'NONE'}|rateLimitState:${providerHealth.rateLimitState}|cacheWritable:${providerHealth.cacheWritable}`,
    ] : []),
    `strongBuyBlockedReason=${summary.missingCount > 0 ? 'GATE2_EXTERNAL_PARTIAL' : summary.unavailableCount > 0 ? 'GATE2_EXTERNAL_PARTIAL' : 'NONE'}`,
    'entryHardBlockImpact=NO',
    'shadowObservablePreserved=true',
    'counterfactualAllowed=true',
    'executionImpact=NONE',
    ...(samples.length > 0 ? ['', 'samples:', ...samples] : ['', 'samples=NONE']),
    '',
    'note: status only; no provider fetch, no scan execution, no broker order, no live promotion.',
  ].join('\n');
}

const gate2ExternalStatus: TelegramCommand = {
  name: '/gate2_external_status',
  aliases: ['/gate2_status', '/gate2_external_cache'],
  category: 'SYS',
  visibility: 'ADMIN',
  riskLevel: 0,
  description: 'Gate2 ExternalData cache hit/miss, fiscal period, confidence, and projected rows',
  usage: '/gate2_external_status',
  async execute({ reply }) {
    await reply(formatGate2ExternalStatusMessage());
  },
};

commandRegistry.register(gate2ExternalStatus);

export { formatGate2ExternalStatusMessage };
export default gate2ExternalStatus;
