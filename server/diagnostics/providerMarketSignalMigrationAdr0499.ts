// @responsibility ADR-0499 ProviderHealth vs MarketSignal classifier migration; diagnostic-only adapter with no live execution or persistence.
import {
  classifyProviderMarketSeparationAdr0497,
  type MarketSignalDirectionAdr0497,
  type ProviderHealthStatusAdr0497,
  type ProviderMarketSeparationAdr0497,
} from './diagnosticTaxonomyAdr0497.js';

export type ProviderHealthRawStatusAdr0499 = string | null | undefined;
export type MarketSignalRawStatusAdr0499 = string | number | null | undefined;

export interface ProviderMarketMigrationEvidenceAdr0499 {
  sourceAdr: string;
  dataLineId: string;
  providerHealth: ProviderHealthStatusAdr0497;
  providerIssue: boolean;
  requestedMarketSignal: MarketSignalDirectionAdr0497;
  finalMarketSignal: MarketSignalDirectionAdr0497;
  isMarketSignalValid: boolean;
  reason: string;
  executionImpact: 'NONE';
  warnings: string[];
}

const UNKNOWN_SEPARATION_ADR0499: ProviderMarketSeparationAdr0497 = Object.freeze({
  providerHealth: 'UNKNOWN',
  providerIssue: true,
  marketSignal: 'UNKNOWN',
  isMarketSignalValid: false,
  reason: 'ADR-0499 classifier_error normalized to UNKNOWN diagnostic provider issue',
});

function normalizeTokenAdr0499(raw: string): string {
  return raw.trim().toUpperCase().replace(/[\s-]+/g, '_');
}

export function normalizeProviderHealthStatusAdr0499(
  raw: ProviderHealthRawStatusAdr0499,
): ProviderHealthStatusAdr0497 {
  try {
    if (raw === null || raw === undefined) return 'UNKNOWN';
    const normalized = normalizeTokenAdr0499(raw);
    if (!normalized) return 'UNKNOWN';
    if (['UP', 'OK', 'READY', 'AVAILABLE', 'VERIFIED', 'HEALTHY', 'SUCCESS'].includes(normalized)) return 'UP';
    if (['DOWN', 'ERROR', 'PROVIDER_ERROR', 'HTTP_ERROR', 'API_ERROR', 'FAILED', 'FAILURE'].includes(normalized)) return 'DOWN';
    if (['DELAYED', 'TIMEOUT', 'SLOW', 'LAGGING'].includes(normalized)) return 'DELAYED';
    if (['RATE_LIMITED', 'RATE_LIMIT', 'THROTTLED', '429'].includes(normalized)) return 'RATE_LIMITED';
    if (['PARSE_ERROR', 'INVALID_SCHEMA', 'SCHEMA_ERROR', 'MALFORMED'].includes(normalized)) return 'PARSE_ERROR';
    if (['EMPTY', 'NO_DATA', 'DATA_UNAVAILABLE', 'NO_SAMPLE', 'NO_ROWS'].includes(normalized)) return 'EMPTY';
    if (['STALE', 'EXPIRED', 'CACHE_STALE', 'SOURCE_STALE'].includes(normalized)) return 'STALE';
    return 'UNKNOWN';
  } catch {
    return 'UNKNOWN';
  }
}

export function normalizeMarketSignalDirectionAdr0499(
  raw: MarketSignalRawStatusAdr0499,
): MarketSignalDirectionAdr0497 {
  try {
    if (raw === null || raw === undefined) return 'UNKNOWN';
    if (typeof raw === 'number') {
      if (!Number.isFinite(raw)) return 'UNKNOWN';
      if (raw > 0) return 'BULLISH';
      if (raw < 0) return 'BEARISH';
      return 'NEUTRAL';
    }
    const normalized = normalizeTokenAdr0499(raw);
    if (!normalized) return 'UNKNOWN';
    if (['BULLISH', 'BUY', 'NET_BUY', 'POSITIVE', 'INFLOW', 'FOREIGN_INSTITUTION_BOTH_BUY'].includes(normalized)) return 'BULLISH';
    if (['BEARISH', 'SELL', 'NET_SELL', 'NEGATIVE', 'OUTFLOW'].includes(normalized)) return 'BEARISH';
    if (['NEUTRAL', 'ZERO', 'FLAT', 'NO_CHANGE'].includes(normalized)) return 'NEUTRAL';
    if (['MIXED', 'DIVERGENT', 'CONFLICT'].includes(normalized)) return 'MIXED';
    return 'UNKNOWN';
  } catch {
    return 'UNKNOWN';
  }
}

function providerHealthWithFallbackAdr0499(input: {
  providerHealthRaw?: ProviderHealthRawStatusAdr0499;
  fallbackProviderHealth?: ProviderHealthStatusAdr0497;
}): ProviderHealthStatusAdr0497 {
  const normalized = normalizeProviderHealthStatusAdr0499(input.providerHealthRaw);
  return normalized === 'UNKNOWN' && input.fallbackProviderHealth ? input.fallbackProviderHealth : normalized;
}

function marketSignalWithFallbackAdr0499(input: {
  marketSignalRaw?: MarketSignalRawStatusAdr0499;
  fallbackMarketSignal?: MarketSignalDirectionAdr0497;
}): MarketSignalDirectionAdr0497 {
  const normalized = normalizeMarketSignalDirectionAdr0499(input.marketSignalRaw);
  return normalized === 'UNKNOWN' && input.fallbackMarketSignal ? input.fallbackMarketSignal : normalized;
}

export function classifyProviderMarketSignalAdr0499(input: {
  providerHealthRaw?: ProviderHealthRawStatusAdr0499;
  marketSignalRaw?: MarketSignalRawStatusAdr0499;
  fallbackProviderHealth?: ProviderHealthStatusAdr0497;
  fallbackMarketSignal?: MarketSignalDirectionAdr0497;
  reason?: string;
}): ProviderMarketSeparationAdr0497 {
  try {
    const providerHealth = providerHealthWithFallbackAdr0499(input);
    const requestedMarketSignal = marketSignalWithFallbackAdr0499(input);
    const classified = classifyProviderMarketSeparationAdr0497({ providerHealth, requestedMarketSignal });

    if (providerHealth !== 'UP') {
      return {
        providerHealth,
        providerIssue: true,
        marketSignal: 'UNKNOWN',
        isMarketSignalValid: false,
        reason: input.reason ?? classified.reason,
      };
    }

    return {
      ...classified,
      reason: input.reason ?? classified.reason,
    };
  } catch {
    return UNKNOWN_SEPARATION_ADR0499;
  }
}

export function classifyDataAvailabilityAdr0499(input: {
  hasRows?: boolean;
  sampleCount?: number | null;
  stale?: boolean;
  providerError?: boolean;
  parseError?: boolean;
  rateLimited?: boolean;
  delayed?: boolean;
  requestedSignal?: MarketSignalRawStatusAdr0499;
}): ProviderMarketSeparationAdr0497 {
  try {
    let providerHealth: ProviderHealthStatusAdr0497 = 'UNKNOWN';
    if (input.providerError) providerHealth = 'DOWN';
    else if (input.parseError) providerHealth = 'PARSE_ERROR';
    else if (input.rateLimited) providerHealth = 'RATE_LIMITED';
    else if (input.stale) providerHealth = 'STALE';
    else if (input.delayed) providerHealth = 'DELAYED';
    else if (input.hasRows === false) providerHealth = 'EMPTY';
    else if (input.sampleCount === 0) providerHealth = 'EMPTY';
    else if (typeof input.sampleCount === 'number' && Number.isFinite(input.sampleCount) && input.sampleCount > 0) providerHealth = 'UP';

    return classifyProviderMarketSignalAdr0499({
      fallbackProviderHealth: providerHealth,
      marketSignalRaw: input.requestedSignal,
    });
  } catch {
    return UNKNOWN_SEPARATION_ADR0499;
  }
}

export function buildProviderMarketMigrationEvidenceAdr0499(input: {
  sourceAdr: string;
  dataLineId: string;
  providerHealthRaw?: ProviderHealthRawStatusAdr0499;
  marketSignalRaw?: MarketSignalRawStatusAdr0499;
  reason?: string;
}): ProviderMarketMigrationEvidenceAdr0499 {
  try {
    const requestedMarketSignal = normalizeMarketSignalDirectionAdr0499(input.marketSignalRaw);
    const classified = classifyProviderMarketSignalAdr0499({
      providerHealthRaw: input.providerHealthRaw,
      marketSignalRaw: input.marketSignalRaw,
      reason: input.reason,
    });
    const warnings = classified.providerIssue && (requestedMarketSignal === 'BEARISH' || requestedMarketSignal === 'BULLISH')
      ? ['provider issue invalidated requested market signal']
      : [];

    return {
      sourceAdr: input.sourceAdr || 'UNKNOWN',
      dataLineId: input.dataLineId || 'UNKNOWN',
      providerHealth: classified.providerHealth,
      providerIssue: classified.providerIssue,
      requestedMarketSignal,
      finalMarketSignal: classified.marketSignal,
      isMarketSignalValid: classified.isMarketSignalValid,
      reason: input.reason ?? classified.reason,
      executionImpact: 'NONE',
      warnings,
    };
  } catch {
    return {
      sourceAdr: 'UNKNOWN',
      dataLineId: 'UNKNOWN',
      providerHealth: 'UNKNOWN',
      providerIssue: true,
      requestedMarketSignal: 'UNKNOWN',
      finalMarketSignal: 'UNKNOWN',
      isMarketSignalValid: false,
      reason: UNKNOWN_SEPARATION_ADR0499.reason,
      executionImpact: 'NONE',
      warnings: ['ADR-0499 evidence_error normalized to UNKNOWN'],
    };
  }
}

export function formatProviderMarketMigrationEvidenceAdr0499(
  evidence: ProviderMarketMigrationEvidenceAdr0499,
): string {
  try {
    const source = evidence.sourceAdr || 'UNKNOWN';
    const dataLine = evidence.dataLineId || 'UNKNOWN';
    const line = `[ADR-0499] ProviderMarket ${source}/${dataLine} provider=${evidence.providerHealth} requested=${evidence.requestedMarketSignal} final=${evidence.finalMarketSignal} valid=${String(evidence.isMarketSignalValid)} issue=${String(evidence.providerIssue)} impact=${evidence.executionImpact}`;
    return line.length <= 280 ? line : `${line.slice(0, 277)}...`;
  } catch {
    return '[ADR-0499] ProviderMarket UNKNOWN/UNKNOWN provider=UNKNOWN requested=UNKNOWN final=UNKNOWN valid=false issue=true impact=NONE';
  }
}

export function buildProviderMarketMigrationSectionAdr0499(
  evidences: ProviderMarketMigrationEvidenceAdr0499[],
  options: { maxLines?: number } = {},
): {
  lines: string[];
  truncated: boolean;
  executionImpact: 'NONE';
} {
  try {
    const maxLines = Math.max(0, Math.floor(options.maxLines ?? 5));
    const safeEvidences = Array.isArray(evidences) ? evidences : [];
    const formatted = safeEvidences.map((evidence) => formatProviderMarketMigrationEvidenceAdr0499(evidence));
    const truncated = formatted.length > maxLines;
    const lines = truncated
      ? [...formatted.slice(0, maxLines), `[ADR-0499] ProviderMarket truncated=${formatted.length - maxLines} more`]
      : formatted;
    return { lines, truncated, executionImpact: 'NONE' };
  } catch {
    return { lines: ['[ADR-0499] ProviderMarket unavailable formatter_error impact=NONE'], truncated: false, executionImpact: 'NONE' };
  }
}
