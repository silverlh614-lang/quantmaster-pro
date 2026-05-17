/**
 * @responsibility Screener quant gate evaluation
 */

import type { QuantFilterRecord, ScreenerConfig, ScreenerDataPoint, ScreenerUniverseItem } from './quantScreenerTypes.js';
import { QuantScreenerReason } from './quantScreenerTypes.js';
import { hasVerifiedValue, summarizeItemConfidence } from './screenerDataConfidence.js';
import { detectProviderIssue } from './screenerProviderSignalSplit.js';

function numericValue(point: ScreenerDataPoint<number> | undefined): number | null {
  return typeof point?.value === 'number' && Number.isFinite(point.value) ? point.value : null;
}

function booleanValue(point: ScreenerDataPoint<boolean> | undefined): boolean | null {
  return typeof point?.value === 'boolean' ? point.value : null;
}

export function applyQuantFirstFilter(items: ScreenerUniverseItem[], config: ScreenerConfig): QuantFilterRecord[] {
  return items.map((item) => evaluateQuantFirstFilter(item, config));
}

export function evaluateQuantFirstFilter(item: ScreenerUniverseItem, config: ScreenerConfig): QuantFilterRecord {
  const reasons: string[] = [];
  const risks: string[] = [];
  const missingData = [...(item.missingData ?? [])];
  let quantScore = 0;

  if (!hasVerifiedValue(item.latestClose)) {
    reasons.push(QuantScreenerReason.RejectPriceDataMissing);
    missingData.push('latestClose');
  } else {
    quantScore += 20;
  }

  const marketCap = numericValue(item.marketCapKrw);
  if (marketCap === null) {
    reasons.push(QuantScreenerReason.RejectCoreDataMissing);
    missingData.push('marketCapKrw');
  } else if (marketCap < config.minMarketCapKrw) {
    reasons.push(QuantScreenerReason.RejectMarketCapTooSmall);
    risks.push(`marketCapKrw ${marketCap} < ${config.minMarketCapKrw}`);
  } else {
    quantScore += 25;
  }

  const avgTradingValue = numericValue(item.avgTradingValue20dKrw);
  if (avgTradingValue === null) {
    reasons.push(QuantScreenerReason.RejectCoreDataMissing);
    missingData.push('avgTradingValue20dKrw');
  } else if (avgTradingValue < config.minAvgTradingValue20dKrw) {
    reasons.push(QuantScreenerReason.RejectAvgTradingValueTooLow);
    risks.push(`avgTradingValue20dKrw ${avgTradingValue} < ${config.minAvgTradingValue20dKrw}`);
  } else {
    quantScore += 25;
  }

  if (config.excludeNegativeEarnings) {
    const per = numericValue(item.per);
    if (per !== null && per < 0) {
      reasons.push(QuantScreenerReason.RejectNegativeEarnings);
      risks.push('negative earnings excluded');
    }
  }

  if (config.excludeManagedStocks && booleanValue(item.isManaged) === true) {
    reasons.push(QuantScreenerReason.RejectManagedStock);
    risks.push('managed stock excluded');
  }

  if (config.excludeTradingHalt && booleanValue(item.isTradingHalt) === true) {
    reasons.push(QuantScreenerReason.RejectTradingHalt);
    risks.push('trading halt excluded');
  }

  const rejected = reasons.some((reason) => reason.startsWith('REJECT_'));
  if (!rejected) {
    reasons.push(QuantScreenerReason.PassQuantFilter);
    quantScore += 30;
  }

  const dedupedMissingData = [...new Set(missingData)];
  return {
    item,
    passedQuantFilter: !rejected,
    quantScore: Math.min(100, quantScore),
    reasons,
    risks,
    missingData: dedupedMissingData,
    dataConfidence: summarizeItemConfidence({ ...item, missingData: dedupedMissingData }),
    providerIssue: detectProviderIssue(item, dedupedMissingData),
  };
}
