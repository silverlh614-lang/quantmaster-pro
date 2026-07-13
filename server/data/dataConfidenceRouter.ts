// @responsibility Provider/value signal normalization SSOT. Pure functions; executionImpact is always explicit.

import type { ExecutionImpact } from '../runtime/engineRuntimePolicy.js';
import {
  classifyProviderHealthSnapshot,
  inferProviderName,
  type ProviderHealthSnapshot,
} from '../diagnostics/providerMarketSignalIsolationStep16.js';

export type DataConfidence =
  | 'VERIFIED'
  | 'COMPUTED'
  | 'API_REPORTED'
  | 'USER_CONFIRMED'
  | 'DEGRADED'
  | 'STALE'
  | 'MISSING'
  | 'AI_ESTIMATED'
  | 'LLM_INFERRED'
  | 'SEARCH_SUMMARIZED';

const EXECUTION_ALLOWED_CONFIDENCE: ReadonlySet<DataConfidence> = new Set([
  'VERIFIED',
  'COMPUTED',
  'API_REPORTED',
  'USER_CONFIRMED',
]);
type DataPromotionStage =
  | 'OBSERVE'
  | 'SHADOW_SCORE'
  | 'ADVISORY'
  | 'WEIGHTED'
  | 'GATED'
  | 'CORE';

export interface NormalizedDataSignal {
  source: string;
  providerIssue: boolean;
  marketSignal: boolean;
  confidence: DataConfidence;
  promotionStage: DataPromotionStage;
  executionImpact: ExecutionImpact;
  rawStatus?: string;
  routedStatus?: string;
  reasonCode?: string;
  providerHealthSnapshot?: ProviderHealthSnapshot;
  providerIssueMarketImpact: 'NONE';
  confidenceAdjustment: number;
  missingFields: string[];
  learningLabels: string[];
}

export interface NormalizeDataSignalInput {
  source: string;
  rawStatus?: string;
  requestedMarketSignal?: boolean;
  confidence?: DataConfidence;
  promotionStage?: DataPromotionStage;
  executionImpact?: ExecutionImpact;
  reasonCode?: string;
  missingFields?: string[];
  requiredDataMissing?: boolean;
}

const PROVIDER_ERROR_STATUSES = new Set([
  'ERROR',
  'HTTP_500',
  'HTTP_502',
  'HTTP_503',
  'HTTP_504',
  'PROVIDER_ERROR',
  'PROVIDER_UNAVAILABLE',
  'TIMEOUT',
  'RATE_LIMITED',
  'PARSE_FAILED',
]);

const EMPTY_VALID_STATUSES = new Set([
  'ACCEPTED_EMPTY',
  'EMPTY_VALID',
  'NO_OUTPUT',
  'OK_EMPTY_OUTPUT',
  'OUTPUT_EMPTY',
  'FIELD_MISSING',
]);

const STALE_STATUSES = new Set(['STALE', 'CACHE_STALE', 'STALE_CACHE']);

const STAGE_ORDER: DataPromotionStage[] = ['OBSERVE', 'SHADOW_SCORE', 'ADVISORY', 'WEIGHTED', 'GATED', 'CORE'];

export function isExecutionAllowedConfidence(confidence: DataConfidence): boolean {
  return EXECUTION_ALLOWED_CONFIDENCE.has(confidence);
}

export function isAiEstimatedConfidence(confidence: DataConfidence): boolean {
  return confidence === 'AI_ESTIMATED'
    || confidence === 'LLM_INFERRED'
    || confidence === 'SEARCH_SUMMARIZED';
}

function capPromotionStage(stage: DataPromotionStage, maxStage: DataPromotionStage): DataPromotionStage {
  const stageIndex = STAGE_ORDER.indexOf(stage);
  const maxIndex = STAGE_ORDER.indexOf(maxStage);
  if (stageIndex < 0 || maxIndex < 0) return 'OBSERVE';
  return STAGE_ORDER[Math.min(stageIndex, maxIndex)];
}

function normalizeRawStatus(rawStatus?: string): string {
  return (rawStatus ?? '').trim().toUpperCase();
}

export function normalizeDataSignal(input: NormalizeDataSignalInput): NormalizedDataSignal {
  const rawStatus = normalizeRawStatus(input.rawStatus);
  const requestedStage = input.promotionStage ?? 'OBSERVE';
  const rawStatusForProvider = input.rawStatus ?? 'VERIFIED';
  const providerHealthSnapshot = classifyProviderHealthSnapshot({
    provider: inferProviderName(input.source),
    rawStatus: rawStatusForProvider,
    missingFields: input.missingFields,
    requiredDataMissing: input.requiredDataMissing,
  });
  const providerIssueFromHealth = rawStatus.length > 0
    && providerHealthSnapshot.status !== 'EMPTY_VALID'
    && providerHealthSnapshot.isProviderIssue;
  const providerMeta = {
    providerHealthSnapshot,
    providerIssueMarketImpact: 'NONE' as const,
    confidenceAdjustment: providerHealthSnapshot.confidenceAdjustment,
    missingFields: providerHealthSnapshot.missingFields,
    learningLabels: providerHealthSnapshot.isProviderIssue || providerHealthSnapshot.status === 'EMPTY_VALID'
      ? [providerHealthSnapshot.status === 'EMPTY_VALID' ? 'EMPTY_RESPONSE_OBSERVED' : 'PROVIDER_ISSUE_OBSERVED']
      : [],
  };

  if (PROVIDER_ERROR_STATUSES.has(rawStatus)) {
    return {
      source: input.source,
      providerIssue: true,
      marketSignal: false,
      confidence: 'DEGRADED',
      promotionStage: 'OBSERVE',
      executionImpact: 'NONE',
      rawStatus: input.rawStatus,
      routedStatus: 'PROVIDER_ISSUE',
      reasonCode: input.reasonCode ?? 'PROVIDER_ERROR_IS_NOT_MARKET_SIGNAL',
      ...providerMeta,
    };
  }

  if (EMPTY_VALID_STATUSES.has(rawStatus)) {
    return {
      source: input.source,
      providerIssue: false,
      marketSignal: false,
      confidence: 'MISSING',
      promotionStage: 'OBSERVE',
      executionImpact: input.executionImpact ?? 'NONE',
      rawStatus: input.rawStatus,
      routedStatus: 'EMPTY_NO_MARKET_SIGNAL',
      reasonCode: input.reasonCode ?? 'EMPTY_VALID_NOT_BEARISH',
      ...providerMeta,
    };
  }

  if (STALE_STATUSES.has(rawStatus)) {
    return {
      source: input.source,
      providerIssue: providerHealthSnapshot.isProviderIssue,
      marketSignal: false,
      confidence: 'STALE',
      promotionStage: 'OBSERVE',
      executionImpact: input.executionImpact ?? 'NONE',
      rawStatus: input.rawStatus,
      routedStatus: 'STALE_NO_MARKET_SIGNAL',
      reasonCode: input.reasonCode ?? 'STALE_DATA_NOT_MARKET_SIGNAL',
      ...providerMeta,
    };
  }

  if (input.confidence && isAiEstimatedConfidence(input.confidence)) {
    return {
      source: input.source,
      providerIssue: providerIssueFromHealth,
      marketSignal: input.requestedMarketSignal === true && !providerIssueFromHealth,
      confidence: input.confidence,
      promotionStage: capPromotionStage(requestedStage, 'ADVISORY'),
      executionImpact: 'NONE',
      rawStatus: input.rawStatus,
      routedStatus: `${input.confidence}_CAPPED`,
      reasonCode: input.reasonCode ?? 'AI_ESTIMATED_NOT_CORE',
      ...providerMeta,
    };
  }

  const confidence = input.confidence ?? 'VERIFIED';
  return {
    source: input.source,
    providerIssue: providerIssueFromHealth,
    marketSignal: input.requestedMarketSignal === true && !providerIssueFromHealth,
    confidence,
    promotionStage: requestedStage,
    executionImpact: input.executionImpact ?? 'NONE',
    rawStatus: input.rawStatus,
    routedStatus: input.requestedMarketSignal === true ? 'MARKET_SIGNAL' : 'NO_MARKET_SIGNAL',
    reasonCode: input.reasonCode,
    ...providerMeta,
  };
}

export function canUseDataSignalInCore(signal: NormalizedDataSignal): boolean {
  return isExecutionAllowedConfidence(signal.confidence)
    && signal.promotionStage === 'CORE'
    && signal.providerIssue === false;
}
