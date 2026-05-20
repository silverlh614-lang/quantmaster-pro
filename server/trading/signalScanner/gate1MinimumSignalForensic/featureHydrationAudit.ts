/**
 * @responsibility ADR-0509 feature hydration audit builder.
 */

import type {
  MinimumSignalScoreTrace,
  SignalScoreComponentTrace,
  SignalScoreComponentCode,
  SignalScoreComponentConfidence,
} from '../minimumSignalScoreTrace.js';
import type {
  CandidateEntryTrace,
  SupplyConfluenceState,
  SupplyProviderHealthTrace,
} from '../entryFilterDecomposition.js';
import type { SectorEnergyExecutionImpactResult } from '../../../clients/sectorEnergyExecutionImpact.js';
import { resolveWatchlistUpstreamScore } from '../watchlistUpstreamScoreResolver.js';
import { conditionResultsTraceToMap, type GateConditionResultTrace } from '../gateConditionResultTrace.js';
import {
  evaluateInvestorFlowSemanticAvailabilityV2,
  extractFlatInvestorFlowRow,
  hasActualInvestorNumericRow,
  shouldEmitSupplySemanticWireDiagLog,
  type InvestorFlowSemanticAvailabilityReason,
  type InvestorFlowSemanticAvailabilityResult,
  type InvestorFlowFieldKeyDiscoveryDiagnostic,
  type SanitizedInvestorFlowSemanticRow,
} from '../../../supply/investorFlowSemanticAvailability.js';
import type { InvestorRowMaterializationClass } from '../investorFlowProviderRouterAdr0477.js';
import { shouldSuppressNoise, recordNoiseSuppressed } from '../../../utils/logger.js';
import type {
  BreakoutHydrationSourceAdr0509,
  FeatureHydrationAuditAdr0509,
  HydrationMissingReason,
  RsHydrationSourceAdr0509,
} from './types.js';

function recordValue(input: unknown, key: string): unknown {
  return input && typeof input === 'object' ? (input as Record<string, unknown>)[key] : undefined;
}

function hasValue(input: unknown, key: string): boolean {
  const value = recordValue(input, key);
  return value !== undefined && value !== null;
}

function hasNestedValue(input: unknown, path: string): boolean {
  const value = path.split('.').reduce<unknown>((current, part) => recordValue(current, part), input);
  return value !== undefined && value !== null;
}

function hasAny(candidate: CandidateEntryTrace, fields: readonly string[]): boolean {
  return fields.some((field) => field.includes('.') ? hasNestedValue(candidate, field) : hasHydrationField(candidate, field));
}

function hasWatchlistReasonProxy(candidate: CandidateEntryTrace, pattern: RegExp): boolean {
  const reason = (candidate as unknown as Record<string, unknown>).watchlistReason;
  return Array.isArray(reason) && reason.some((item) => typeof item === 'string' && pattern.test(item));
}

const RS_HYDRATION_FIELDS = [
  'return20d',
  'return5d',
  'kospi20dReturn',
  'relativeReturn20d',
  'marketRelativeReturn',
  'rsRankPct',
  'relativeStrengthScore',
] as const;

const BREAKOUT_HYDRATION_FIELDS = [
  'price',
  'currentPrice',
  'high5d',
  'high20d',
  'high60',
  'volume',
  'avgVolume',
  'volumeRatio',
  'ma20',
  'ma60',
  'aboveMA20',
  'aboveMA60',
  'breakout_momentum',
  'turtle_high',
  'volume_breakout',
  'volume_surge',
  'vcp',
  'trend_acceleration',
  'breakoutSignals',
  'conditionResults',
  'conditionKeys',
] as const;

function hasHydrationField(candidate: CandidateEntryTrace, field: string): boolean {
  const record = candidate as unknown as Record<string, unknown>;
  const direct = record[field];
  if (direct !== undefined && direct !== null) return true;
  const quote = record.quote;
  if (quote && typeof quote === 'object' && (quote as Record<string, unknown>)[field] != null) return true;
  const symbolFeatures = record.symbolFeatures;
  if (symbolFeatures && typeof symbolFeatures === 'object' && (symbolFeatures as Record<string, unknown>)[field] != null) {
    return true;
  }
  const macroState = record.macroState;
  if (macroState && typeof macroState === 'object' && (macroState as Record<string, unknown>)[field] != null) return true;
  return false;
}


const REQUIRED_CONDITION_KEYS = [
  'momentum',
  'ma_alignment',
  'volume_breakout',
  'turtle_high',
  'relative_strength',
  'breakout_momentum',
  'vcp',
  'volume_surge',
  'rsi_zone',
  'macd_bull',
  'pullback',
  'ma60_rising',
  'weekly_rsi_zone',
  'supply_confluence',
  'earnings_quality',
  'trend_acceleration',
] as const;

export const BREAKOUT_CONDITION_KEYS: ReadonlySet<string> = new Set([
  'breakout_momentum',
  'turtle_high',
  'volume_breakout',
  'volume_surge',
  'vcp',
  'trend_acceleration',
]);

type ConditionStatus = 'FIRED' | 'DATA_UNAVAILABLE' | 'THRESHOLD_NOT_MET' | 'PROVIDER_DEGRADED' | 'ERROR';

function numericValue(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isFinite(value) ? value : undefined;
}

function conditionRecord(candidate: CandidateEntryTrace, key: string): Record<string, unknown> | undefined {
  const raw = candidate as unknown as Record<string, unknown>;
  const results = raw.conditionResults && typeof raw.conditionResults === 'object'
    ? raw.conditionResults
    : conditionResultsTraceToMap(Array.isArray(raw.conditionResultsTrace) ? raw.conditionResultsTrace as GateConditionResultTrace[] : undefined);
  if (!results || typeof results !== 'object') return undefined;
  const value = (results as Record<string, unknown>)[key];
  return value && typeof value === 'object' ? value as Record<string, unknown> : undefined;
}

function conditionStatus(candidate: CandidateEntryTrace, key: string): ConditionStatus | undefined {
  const record = conditionRecord(candidate, key);
  if (!record) return undefined;
  const explicit = typeof record.status === 'string' ? record.status.toUpperCase() : undefined;
  if (explicit === 'FIRED' || explicit === 'PASS' || explicit === 'PASSED') return 'FIRED';
  if (explicit === 'DATA_UNAVAILABLE' || explicit === 'UNAVAILABLE' || explicit === 'MISSING') return 'DATA_UNAVAILABLE';
  if (explicit === 'THRESHOLD_NOT_MET' || explicit === 'NOT_MET' || explicit === 'FALSE') return 'THRESHOLD_NOT_MET';
  if (explicit === 'PROVIDER_DEGRADED' || explicit === 'DEGRADED') return 'PROVIDER_DEGRADED';
  if (explicit === 'ERROR') return 'ERROR';
  if (record.fired === true || record.passed === true) return 'FIRED';
  if (record.unavailable === true || record.hadRequiredData === false) return 'DATA_UNAVAILABLE';
  if (record.providerDegraded === true) return 'PROVIDER_DEGRADED';
  if (record.thresholdNotMet === true || record.fired === false || record.passed === false) return 'THRESHOLD_NOT_MET';
  return numericValue(record.score) !== undefined || numericValue(record.normalizedScore) !== undefined ? 'THRESHOLD_NOT_MET' : 'DATA_UNAVAILABLE';
}

function hasConditionNumericScore(candidate: CandidateEntryTrace, key: string): boolean {
  const record = conditionRecord(candidate, key);
  return Boolean(record && (numericValue(record.score) !== undefined || numericValue(record.normalizedScore) !== undefined));
}

function hasPositiveConditionScore(candidate: CandidateEntryTrace, key: string): boolean {
  const record = conditionRecord(candidate, key);
  const score = numericValue(record?.score) ?? numericValue(record?.normalizedScore);
  return score !== undefined && score > 0;
}

function classifyRsSource(candidate: CandidateEntryTrace): RsHydrationSourceAdr0509 {
  if (conditionRecord(candidate, 'relative_strength')) return 'CONDITION_RESULTS';
  if (hasNestedValue(candidate, 'quote.return20d') || hasNestedValue(candidate, 'quote.return5d')) return 'QUOTE_RETURN';
  if (hasAny(candidate, ['return20d', 'return5d', 'kospi20dReturn', 'rsRankPct', 'relativeStrengthScore'])) return 'SYMBOL_FEATURES';
  if (hasAny(candidate, ['relativeReturn20d', 'marketRelativeReturn', 'kospiRelativeReturn'])) return 'EXPLICIT_RELATIVE_RETURN';
  if (hasWatchlistReasonProxy(candidate, /relative|rs|leader|leading|강세|주도주/i)) return 'WATCHLIST_PROXY';
  return 'MISSING';
}

function classifyBreakoutSource(candidate: CandidateEntryTrace): BreakoutHydrationSourceAdr0509 {
  if ([...BREAKOUT_CONDITION_KEYS].some((key) => conditionRecord(candidate, key))) return 'CONDITION_RESULTS';
  const keys = (candidate as unknown as Record<string, unknown>).conditionKeys;
  if (Array.isArray(keys) && keys.some((key) => BREAKOUT_CONDITION_KEYS.has(String(key)))) return 'CONDITION_KEYS';
  if (hasAny(candidate, ['quote.price', 'quote.currentPrice', 'quote.high5d', 'quote.high20d', 'quote.high60', 'quote.volume', 'quote.avgVolume', 'quote.volumeRatio', 'quote.ma20', 'quote.ma60'])) return 'QUOTE_OHLCV';
  if (hasAny(candidate, ['price', 'currentPrice', 'high5d', 'high20d', 'high60', 'volume', 'avgVolume', 'volumeRatio', 'ma20', 'ma60', 'aboveMA20', 'aboveMA60', 'breakoutSignals'])) return 'SYMBOL_FEATURES';
  if (hasWatchlistReasonProxy(candidate, /breakout|new high|vcp|turtle|volume surge|volume breakout|돌파|거래량/i)) return 'WATCHLIST_REASON_PROXY';
  return 'MISSING';
}

export function buildFeatureHydrationAuditAdr0509(
  candidate: CandidateEntryTrace | undefined,
  trace?: MinimumSignalScoreTrace,
): FeatureHydrationAuditAdr0509 {
  if (!candidate) {
    return {
      rsAvailable: false,
      breakoutAvailable: false,
      rsScoreUsable: false,
      breakoutScoreUsable: false,
      rsSource: 'MISSING',
      breakoutSource: 'MISSING',
      rsMissingReasons: ['CANDIDATE_TRACE_MISSING'],
      breakoutMissingReasons: ['CANDIDATE_TRACE_MISSING'],
      rsMissingFields: [...RS_HYDRATION_FIELDS],
      breakoutMissingFields: [...BREAKOUT_HYDRATION_FIELDS],
      missingFields: [...RS_HYDRATION_FIELDS, ...BREAKOUT_HYDRATION_FIELDS],
      candidateTraceHasQuote: false,
      candidateTraceHasSymbolFeatures: false,
      candidateTraceHasConditionResults: false,
      candidateTraceHasWatchlistScore: false,
      candidateTraceHasSupplyContext: false,
      candidateTraceHasMinSignalScoreTrace: Boolean(trace),
      watchlist: { sourceAvailable: false, sourceField: null, scoreImported: false, missingReason: 'CANDIDATE_TRACE_MISSING' },
    };
  }
  const record = candidate as unknown as Record<string, unknown>;
  const candidateTraceHasQuote = Boolean(record.quote && typeof record.quote === 'object');
  const candidateTraceHasSymbolFeatures = Boolean(record.symbolFeatures && typeof record.symbolFeatures === 'object');
  const candidateTraceHasConditionResults = Boolean((record.conditionResults && typeof record.conditionResults === 'object') || (Array.isArray(record.conditionResultsTrace) && record.conditionResultsTrace.length > 0));
  const candidateTraceHasSupplyContext = Boolean(record.supplyConfluenceState || record.supplyProviderHealth);
  const resolvedWatchlist = resolveWatchlistUpstreamScore(candidate);
  const candidateTraceHasWatchlistScore = resolvedWatchlist.confidence === 'VERIFIED';
  const rsMissingFields = RS_HYDRATION_FIELDS.filter((field) => !hasHydrationField(candidate, field));
  const breakoutMissingFields = BREAKOUT_HYDRATION_FIELDS.filter((field) => !hasHydrationField(candidate, field));
  const rsSource = classifyRsSource(candidate);
  const breakoutSource = classifyBreakoutSource(candidate);
  const rsAvailable = rsSource !== 'MISSING';
  const breakoutAvailable = breakoutSource !== 'MISSING';
  const conditionKeyStatus: Record<string, ConditionStatus> = {};
  for (const key of REQUIRED_CONDITION_KEYS) {
    const status = conditionStatus(candidate, key);
    if (status) conditionKeyStatus[key] = status;
  }
  const conditionKeys = Array.isArray(record.conditionKeys) ? record.conditionKeys.map(String) : [];
  const breakoutConditionKeys = [
    ...Object.keys(conditionKeyStatus).filter((key) => BREAKOUT_CONDITION_KEYS.has(key)),
    ...conditionKeys.filter((key) => BREAKOUT_CONDITION_KEYS.has(key)),
  ].filter((key, index, arr) => arr.indexOf(key) === index);
  const rsStatus = conditionStatus(candidate, 'relative_strength');
  const rsScoreUsable = rsSource === 'CONDITION_RESULTS'
    ? rsStatus === 'FIRED' || (rsStatus === undefined && hasPositiveConditionScore(candidate, 'relative_strength'))
    : rsAvailable && trace?.components?.some((c) => c.code === 'RELATIVE_STRENGTH' && c.confidence !== 'MISSING') === true;
  const breakoutScoreUsable = breakoutSource === 'CONDITION_RESULTS'
    ? breakoutConditionKeys.some((key) => {
        const status = conditionStatus(candidate, key);
        return status === 'FIRED' || (status === undefined && hasPositiveConditionScore(candidate, key));
      })
    : breakoutAvailable && trace?.components?.some((c) => c.code === 'BREAKOUT_STRUCTURE' && c.confidence !== 'MISSING') === true;
  const rsMissingReasons: HydrationMissingReason[] = [];
  const breakoutMissingReasons: HydrationMissingReason[] = [];
  if (!rsAvailable) rsMissingReasons.push('FIELD_MISSING');
  if (!candidateTraceHasQuote) rsMissingReasons.push('QUOTE_MISSING');
  if (!candidateTraceHasSymbolFeatures) rsMissingReasons.push('SYMBOL_FEATURES_MISSING');
  if (!breakoutAvailable) breakoutMissingReasons.push('FIELD_MISSING');
  if (!candidateTraceHasConditionResults) breakoutMissingReasons.push('CONDITION_RESULTS_MISSING');
  if (!candidateTraceHasSymbolFeatures) breakoutMissingReasons.push('SYMBOL_FEATURES_MISSING');
  return {
    rsAvailable,
    breakoutAvailable,
    rsScoreUsable,
    breakoutScoreUsable,
    rsSource,
    breakoutSource,
    rsMissingReasons,
    breakoutMissingReasons,
    rsMissingFields,
    breakoutMissingFields,
    missingFields: [...rsMissingFields, ...breakoutMissingFields],
    candidateTraceHasQuote,
    candidateTraceHasSymbolFeatures,
    candidateTraceHasConditionResults,
    candidateTraceHasWatchlistScore,
    candidateTraceHasSupplyContext,
    candidateTraceHasMinSignalScoreTrace: Boolean(trace),
    watchlist: {
      sourceAvailable: resolvedWatchlist.confidence === 'VERIFIED',
      sourceField: resolvedWatchlist.sourceField ?? null,
      scoreImported: resolvedWatchlist.confidence === 'VERIFIED' && resolvedWatchlist.sourceField !== undefined,
      rawScore: resolvedWatchlist.rawScore ?? null,
      normalizedWatchlistScore: resolvedWatchlist.confidence === 'VERIFIED' ? resolvedWatchlist.normalized100 : null,
      scoreScale: resolvedWatchlist.scoreScale ?? null,
      stage2Score: numericValue(record.stage2Score) ?? null,
      watchlistScore: numericValue(record.watchlistScore) ?? null,
      upstreamCandidateScore: numericValue(record.upstreamCandidateScore) ?? numericValue(record.upstreamScore) ?? null,
      watchlistRank: numericValue(record.watchlistRank) ?? null,
      totalCandidates: numericValue(record.totalCandidates) ?? null,
      watchlistReason: Array.isArray(record.watchlistReason) ? record.watchlistReason.filter((item): item is string => typeof item === 'string') : undefined,
      watchlistSourceField: resolvedWatchlist.sourceField ?? null,
      missingReason: resolvedWatchlist.confidence === 'VERIFIED' ? undefined : resolvedWatchlist.reason ?? 'WATCHLIST_SCORE_MISSING',
    },
    conditionKeyStatus,
    breakoutConditionKeys,
  };
}
