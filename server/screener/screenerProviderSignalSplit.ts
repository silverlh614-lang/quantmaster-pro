/**
 * @responsibility Screener provider signal classification
 */

import type { AbnormalSignalRecord, ScreenerUniverseItem } from './quantScreenerTypes.js';

const PROVIDER_ISSUE_KEYWORDS = [
  'API_ERROR',
  'EMPTY_RESPONSE',
  'STALE_CACHE',
  'RATE_LIMIT',
  'PARSING_FAILURE',
  'MISSING_SOURCE',
  'MISSING',
  'NOT_AVAILABLE',
];

export function detectProviderIssue(item: ScreenerUniverseItem, missingData: string[] = []): boolean {
  if ((item.providerIssues ?? []).length > 0) return true;
  if (missingData.length > 0) return true;
  return [...(item.missingData ?? [])].some((reason) =>
    PROVIDER_ISSUE_KEYWORDS.some((keyword) => reason.toUpperCase().includes(keyword)),
  );
}

export function classifyProviderSignalState(record: Pick<AbnormalSignalRecord, 'providerIssue' | 'marketSignal'>): AbnormalSignalRecord['signalState'] {
  if (record.providerIssue && record.marketSignal) return 'MIXED';
  if (record.providerIssue) return 'PROVIDER_ISSUE';
  if (record.marketSignal) return 'MARKET_SIGNAL';
  return 'NONE';
}
