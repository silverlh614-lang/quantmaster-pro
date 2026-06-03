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
}): { providerIssue: boolean; marketSignal: boolean } {
  // 불변식 #6: provider 장애(providerIssue)는 marketSignal(약세/강세 시장신호)로 변환 금지.
  //   providerIssue 가 우선하여 marketSignal=false 로 격리한다.
  //   (server/runtime/executionPermissionResolver.ts:210 providerIssueIsolated 패턴과 동일 의미.)
  const providerIssue = Boolean(input.fetchProviderIssue)
    || input.reasons.some(isProviderIssueReason)
    || input.risks.some(isProviderIssueReason);
  const categorySignal = input.category !== 'UNKNOWN' && input.category !== 'NEUTRAL_INFO';
  const marketSignal = providerIssue ? false : categorySignal;
  return { providerIssue, marketSignal };
}
