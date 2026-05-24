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
  const dartNotApplicable = lastRefresh?.dartNotApplicable
    ?? counters?.dartNotApplicableCount
    ?? lastRefresh?.dartNotApplicableSymbols?.length
    ?? 0;
  const trueCorpCodeNotFound = lastRefresh?.trueCorpCodeNotFound
    ?? counters?.trueCorpCodeNotFound
    ?? lastRefresh?.trueCorpCodeNotFoundSymbols?.length
    ?? 0;
  const lookupFailed = lastRefresh?.lookupFailed
    ?? counters?.corpCodeLookupFailed
    ?? lastRefresh?.corpCodeLookupFailedSymbols?.length
    ?? 0;
  const excludedSymbols = lastRefresh?.excludedSymbols ?? lastRefresh?.dartNotApplicableSymbols ?? [];
  const excludedCount = lastRefresh?.excludedCount ?? counters?.excludedCount ?? excludedSymbols.length;
  const actionableUnavailable = lastRefresh?.unavailableCountActionable
    ?? counters?.unavailableCountActionable
    ?? summary.unavailableCount;
  const strongBuyBlockedReason = actionableUnavailable <= 0
    ? 'NONE'
    : summary.recordCount > 0 && summary.missingCount === summary.recordCount
      ? 'DART_FINANCIALS_MISSING'
      : 'GATE2_EXTERNAL_PARTIAL';
  const externalDataBlockReason = lastRefresh?.externalDataBlockReason ?? strongBuyBlockedReason;
  const externalDataBlockedDetails = lastRefresh?.externalDataBlockedDetails
    ?? lastRefresh?.blockingDetails
    ?? lastRefresh?.strongBuyBlockedDetails
    ?? 'NONE';
  const qualityFailDetails = lastRefresh?.qualityFailDetails
    ?? lastRefresh?.fundamentalQualityFailDetails
    ?? ((counters?.perFailDueToNegativeEps ?? 0) > 0 ? `EPS_NON_POSITIVE_${counters?.perFailDueToNegativeEps}` : 'NONE');
  const fundamentalQualityFailReason = lastRefresh?.fundamentalQualityFailReason
    ?? (qualityFailDetails.includes('EPS_NON_POSITIVE') ? 'EPS_NON_POSITIVE' : 'NONE');
  const providerHealth = lastRefresh?.providerHealth;
  const equityUniverse = Math.max(0, summary.recordCount - excludedCount);
  const equityVerified = Math.min(summary.verifiedCount, equityUniverse);
  const perUniverse = counters?.corpCodeResolved ?? equityUniverse;
  const perAvailable = counters?.kisPerAvailable ?? 0;
  const epsNegativeFail = counters?.perFailDueToNegativeEps ?? 0;
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
      `dartNotApplicable=${dartNotApplicable}`,
      `trueCorpCodeNotFound=${trueCorpCodeNotFound}`,
      `lookupFailed=${lookupFailed}`,
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
      `dartEpsComputed=${counters.dartEpsComputed ?? 0}`,
      `perComputedFromPriceAndEps=${counters.perComputedFromPriceAndEps ?? 0}`,
      `perCacheHit=${counters.perCacheHit ?? 0}`,
      `unavailableDueToPER=${lastRefresh?.unavailableDueToPER ?? counters.unavailableDueToPER ?? 0}`,
      `perFailDueToNegativeEps=${counters.perFailDueToNegativeEps ?? 0}`,
      `perUnavailableDueToNegativeEps=${counters.perUnavailableDueToNegativeEps ?? 0}`,
      `perUnavailableDueToProviderMissing=${counters.perUnavailableDueToProviderMissing ?? 0}`,
      `perUnavailableDueToPriceMissing=${counters.perUnavailableDueToPriceMissing ?? 0}`,
      `perUnavailableDueToEpsMissing=${counters.perUnavailableDueToEpsMissing ?? 0}`,
      `perUnavailableDueToNonPositive=${counters.perUnavailableDueToNonPositive ?? 0}`,
      `unavailableDueToCorpCodeMissing=${lastRefresh?.unavailableDueToCorpCodeMissing ?? counters.unavailableDueToCorpCodeMissing ?? 0}`,
      `unavailableDueToFiscalPeriodMissing=${counters.unavailableDueToFiscalPeriodMissing ?? 0}`,
      `unavailableDueToFinancialRowsEmpty=${counters.unavailableDueToFinancialRowsEmpty ?? 0}`,
      `unavailableDueToNormalizationFailed=${counters.unavailableDueToNormalizationFailed ?? 0}`,
      `unavailableCountRaw=${lastRefresh?.unavailableCountRaw ?? counters.unavailableCountRaw ?? summary.unavailableCount}`,
      `unavailableCountActionable=${lastRefresh?.unavailableCountActionable ?? counters.unavailableCountActionable ?? summary.unavailableCount}`,
      `unavailableExcludingExcluded=${lastRefresh?.unavailableExcludingExcluded ?? counters.unavailableExcludingExcluded ?? summary.unavailableCount}`,
      `excludedCount=${excludedCount}`,
      `excludedSymbols=${excludedSymbols.join(',') || 'NONE'}`,
      `excludedReason=${lastRefresh?.excludedReason ?? (excludedCount > 0 ? 'DART_NOT_APPLICABLE' : 'NONE')}`,
      `excludedUnavailableEquivalent=${lastRefresh?.excludedUnavailableEquivalent ?? counters.excludedUnavailableEquivalent ?? 0}`,
      `strongBuyBlockedDetails=${lastRefresh?.strongBuyBlockedDetails ?? 'NONE'}`,
      `blockingDetails=${lastRefresh?.blockingDetails ?? lastRefresh?.strongBuyBlockedDetails ?? 'NONE'}`,
      `externalDataBlockReason=${externalDataBlockReason}`,
      `externalDataBlockedDetails=${externalDataBlockedDetails}`,
      `fundamentalQualityFailReason=${fundamentalQualityFailReason}`,
      `fundamentalQualityFailDetails=${qualityFailDetails}`,
      `qualityFailDetails=${qualityFailDetails}`,
      `excludedDetails=${lastRefresh?.excludedDetails ?? 'NONE'}`,
      `corpCodeMissingSymbols=${lastRefresh?.corpCodeMissingSymbols?.join(',') || 'NONE'}`,
      `dartNotApplicableSymbols=${lastRefresh?.dartNotApplicableSymbols?.join(',') || 'NONE'}`,
      `trueCorpCodeNotFoundSymbols=${lastRefresh?.trueCorpCodeNotFoundSymbols?.join(',') || 'NONE'}`,
      `corpCodeLookupFailedSymbols=${lastRefresh?.corpCodeLookupFailedSymbols?.join(',') || 'NONE'}`,
      `nonEquitySymbols=${lastRefresh?.nonEquitySymbols?.join(',') || 'NONE'}`,
    ] : []),
    ...(providerHealth ? [
      `providerHealth=apiKeyPresent:${providerHealth.apiKeyPresent}|requestEnabled:${providerHealth.requestEnabled}|corpCodeCacheLoaded:${providerHealth.corpCodeCacheLoaded}|corpCodeCacheCount:${providerHealth.corpCodeCacheCount}|lastHttpStatus:${providerHealth.lastHttpStatus ?? 'NONE'}|lastErrorCode:${providerHealth.lastErrorCode ?? 'NONE'}|lastNonBlockingIssue:${providerHealth.lastNonBlockingIssue ?? 'NONE'}|lastNonBlockingSymbols:${providerHealth.lastNonBlockingSymbols?.join(',') || 'NONE'}|rateLimitState:${providerHealth.rateLimitState}|cacheWritable:${providerHealth.cacheWritable}`,
    ] : []),
    'Gate2 ExternalData Summary:',
    `- equityFinancialCoverage=${equityVerified}/${equityUniverse}`,
    `- excludedNonEquity=${excludedCount}`,
    `- actionableDataMissing=${actionableUnavailable}`,
    `- perAvailable=${perAvailable}/${perUniverse}`,
    `- epsNegativeFail=${epsNegativeFail}`,
    `- externalDataBlock=${externalDataBlockReason}`,
    `- fundamentalQualityFail=${qualityFailDetails}`,
    '- executionImpact=NONE',
    `strongBuyBlockedReason=${strongBuyBlockedReason}`,
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
