// @responsibility DART 제공자장애 시장신호 분리
import type { DartCatalystCategory, DartReason } from './dartPreNewsTypes.js';

const PROVIDER_REASONS: ReadonlySet<DartReason> = new Set([
  'PROVIDER_DART_API_KEY_MISSING',
  'PROVIDER_DART_RATE_LIMIT',
  'PROVIDER_DART_EMPTY_RESPONSE',
  'PROVIDER_DART_BODY_FETCH_FAILED',
  'PROVIDER_DART_PARSER_FAILED',
  'PROVIDER_DART_CORP_MAPPING_MISSING',
  'DATA_DART_FIELD_MISSING',
  'DATA_DART_FIELD_UNKNOWN',
]);

export function isProviderIssueReason(reason: string): boolean {
  return PROVIDER_REASONS.has(reason as DartReason);
}

export function splitProviderIssueFromMarketSignal(input: {
  category: DartCatalystCategory;
  reasons: string[];
  risks: string[];
  fetchProviderIssue?: boolean;
}): { providerIssue: boolean; marketSignal: boolean; mixed: boolean } {
  const providerIssue = Boolean(input.fetchProviderIssue)
    || input.reasons.some(isProviderIssueReason)
    || input.risks.some(isProviderIssueReason);
  const marketSignal = input.category !== 'UNKNOWN' && input.category !== 'NEUTRAL_INFO';
  return { providerIssue, marketSignal, mixed: providerIssue && marketSignal };
}
