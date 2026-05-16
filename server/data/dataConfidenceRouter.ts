// @responsibility Provider/value signal normalization SSOT. Pure functions; executionImpact is always explicit.

import type { ExecutionImpact } from '../runtime/engineRuntimePolicy.js';

export type DataConfidence =
  | 'VERIFIED'
  | 'DEGRADED'
  | 'STALE'
  | 'MISSING'
  | 'AI_ESTIMATED';

export type DataPromotionStage =
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
}

export interface NormalizeDataSignalInput {
  source: string;
  rawStatus?: string;
  requestedMarketSignal?: boolean;
  confidence?: DataConfidence;
  promotionStage?: DataPromotionStage;
  executionImpact?: ExecutionImpact;
  reasonCode?: string;
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
    };
  }

  if (STALE_STATUSES.has(rawStatus)) {
    return {
      source: input.source,
      providerIssue: false,
      marketSignal: false,
      confidence: 'STALE',
      promotionStage: 'OBSERVE',
      executionImpact: input.executionImpact ?? 'NONE',
      rawStatus: input.rawStatus,
      routedStatus: 'STALE_NO_MARKET_SIGNAL',
      reasonCode: input.reasonCode ?? 'STALE_DATA_NOT_MARKET_SIGNAL',
    };
  }

  if (input.confidence === 'AI_ESTIMATED') {
    return {
      source: input.source,
      providerIssue: false,
      marketSignal: input.requestedMarketSignal === true,
      confidence: 'AI_ESTIMATED',
      promotionStage: capPromotionStage(requestedStage, 'ADVISORY'),
      executionImpact: 'NONE',
      rawStatus: input.rawStatus,
      routedStatus: 'AI_ESTIMATED_CAPPED',
      reasonCode: input.reasonCode ?? 'AI_ESTIMATED_NOT_CORE',
    };
  }

  const confidence = input.confidence ?? 'VERIFIED';
  return {
    source: input.source,
    providerIssue: false,
    marketSignal: input.requestedMarketSignal === true,
    confidence,
    promotionStage: requestedStage,
    executionImpact: input.executionImpact ?? 'NONE',
    rawStatus: input.rawStatus,
    routedStatus: input.requestedMarketSignal === true ? 'MARKET_SIGNAL' : 'NO_MARKET_SIGNAL',
    reasonCode: input.reasonCode,
  };
}

export function canUseDataSignalInCore(signal: NormalizedDataSignal): boolean {
  return signal.confidence === 'VERIFIED'
    && signal.promotionStage === 'CORE'
    && signal.providerIssue === false;
}
