/**
 * @responsibility Investor flow router emission throttling.
 * ADR-0001 scan diagnostics core split.
 */

import { logger } from '../../../utils/logger.js';

export type InvestorFlowRouterEngineMode = 'NORMAL' | 'SHADOW_ONLY' | 'SELL_ONLY' | 'OBSERVE_ONLY' | string;
export type InvestorFlowRouterConfidence = 'VERIFIED' | 'DEGRADED' | 'MISSING' | 'HIGH' | 'MEDIUM' | 'LOW' | 'NONE' | string;

export interface InvestorFlowRouterEmissionState {
  engineMode: InvestorFlowRouterEngineMode;
  status: string;
  signal: string;
  selectedProvider: string;
  executionImpact: 'NONE' | string;
  liveExecutionAllowed: boolean;
  confidence?: InvestorFlowRouterConfidence | null;
  previousSelectedProvider?: string | null;
  previousConfidence?: InvestorFlowRouterConfidence | null;
  providerIssue?: boolean;
  marketSignal?: boolean;
  shadowLearning?: boolean;
}

export interface InvestorFlowRouterEmissionOptions {
  nowMs?: number;
  detailTtlMs?: number;
  summaryTtlMs?: number;
  logger?: Pick<Console, 'debug' | 'info' | 'warn'>;
}

export interface InvestorFlowRouterEmissionResult {
  emitted: boolean;
  adr0477: boolean;
  observation: boolean;
  summaryEmitted: boolean;
  reasonCodes: string[];
  dedupKey: string;
  marketSignal: boolean;
  providerIssue: boolean;
  executionImpact: string;
  suppressedCount: number;
  shadowLearning: boolean;
}

const INVESTOR_FLOW_OBSERVATION_DETAIL_TTL_MS = 300 * 1000;
const INVESTOR_FLOW_OBSERVATION_SUMMARY_TTL_MS = 900 * 1000;
const investorFlowObservationLastDetailAt = new Map<string, number>();
const investorFlowObservationLastSummaryAt = new Map<string, number>();
const investorFlowObservationSuppressedCount = new Map<string, number>();
let lastInvestorFlowRouterSelectedProvider: string | null = null;
let lastInvestorFlowRouterConfidence: InvestorFlowRouterConfidence | null = null;

function normalizeInvestorFlowRouterConfidenceForEmission(confidence: InvestorFlowRouterConfidence | null | undefined): 'VERIFIED' | 'DEGRADED' | 'MISSING' | 'UNKNOWN' {
  if (confidence === 'VERIFIED' || confidence === 'HIGH' || confidence === 'MEDIUM') return 'VERIFIED';
  if (confidence === 'DEGRADED' || confidence === 'LOW') return 'DEGRADED';
  if (confidence === 'MISSING' || confidence === 'NONE') return 'MISSING';
  return 'UNKNOWN';
}

function hasInvestorFlowProviderIssueForEmission(state: InvestorFlowRouterEmissionState): boolean {
  if (state.providerIssue === true) return true;
  return new Set([
    'DEGRADED',
    'MISSING',
    'FAILED',
    'DATA_UNAVAILABLE',
    'NOT_WIRED',
    'ERROR',
    'PROVIDER_ERROR',
    'PROVIDER_EMPTY_RESPONSE',
    'CACHE_EMPTY',
    'EMPTY',
    'PARSE_ERROR',
    'PARSER_KEY_MISMATCH',
    'PARSER_FIELD_MISMATCH',
    'QUARANTINED',
  ]).has(state.status);
}

function hasInvestorFlowMarketSignalForEmission(state: InvestorFlowRouterEmissionState): boolean {
  if (state.marketSignal === true) return true;
  return state.signal === 'BULLISH' || state.signal === 'BEARISH';
}

function investorFlowRouterDedupKey(state: InvestorFlowRouterEmissionState): string {
  return `ADR-0477:${state.engineMode}:${state.status}:${state.signal}:${state.selectedProvider}:${state.executionImpact}:${state.liveExecutionAllowed}`;
}

function isNoActionInvestorFlowObservation(state: InvestorFlowRouterEmissionState): boolean {
  return state.status === 'OBSERVING'
    && state.signal === 'UNKNOWN'
    && state.executionImpact === 'NONE'
    && state.liveExecutionAllowed === false
    && (state.engineMode === 'SHADOW_ONLY' || state.engineMode === 'SELL_ONLY' || state.engineMode === 'OBSERVE_ONLY')
    && (state.selectedProvider === 'CACHE' || state.selectedProvider === 'NONE');
}

function buildInvestorFlowAdr0477ReasonCodes(state: InvestorFlowRouterEmissionState, providerIssue: boolean, marketSignal: boolean): string[] {
  const reasons: string[] = [];
  if (state.executionImpact !== 'NONE') reasons.push('ADR_0477_EXECUTION_IMPACT');
  if (marketSignal) reasons.push('ADR_0477_SIGNAL_CHANGED');
  if (providerIssue) reasons.push('ADR_0477_PROVIDER_DEGRADED');
  if (state.status === 'DEGRADED' || state.status === 'MISSING' || state.status === 'FAILED') reasons.push('ADR_0477_PROVIDER_DEGRADED');
  if (state.signal === 'BULLISH' || state.signal === 'BEARISH') reasons.push('ADR_0477_SIGNAL_CHANGED');
  if (state.previousSelectedProvider && state.previousSelectedProvider !== state.selectedProvider) reasons.push('ADR_0477_PROVIDER_CHANGED');
  const previousConfidence = normalizeInvestorFlowRouterConfidenceForEmission(state.previousConfidence);
  const confidence = normalizeInvestorFlowRouterConfidenceForEmission(state.confidence);
  if (previousConfidence === 'VERIFIED' && (confidence === 'DEGRADED' || confidence === 'MISSING')) reasons.push('ADR_0477_CONFIDENCE_DROPPED');
  if (state.liveExecutionAllowed === true && (state.signal === 'UNKNOWN' || state.selectedProvider === 'NONE')) reasons.push('ADR_0477_LIVE_EXECUTION_INCONSISTENCY');
  return Array.from(new Set(reasons));
}

export function resetInvestorFlowRouterEmissionPolicyForTest(): void {
  investorFlowObservationLastDetailAt.clear();
  investorFlowObservationLastSummaryAt.clear();
  investorFlowObservationSuppressedCount.clear();
  lastInvestorFlowRouterSelectedProvider = null;
  lastInvestorFlowRouterConfidence = null;
}

export function emitInvestorFlowRouterEventAdr0477(
  inputState: InvestorFlowRouterEmissionState,
  options: InvestorFlowRouterEmissionOptions = {},
): InvestorFlowRouterEmissionResult {
  const activeLogger = options.logger ?? logger;
  const nowMs = options.nowMs ?? Date.now();
  const previousSelectedProvider = inputState.previousSelectedProvider ?? lastInvestorFlowRouterSelectedProvider;
  const previousConfidence = inputState.previousConfidence ?? lastInvestorFlowRouterConfidence;
  const state: InvestorFlowRouterEmissionState = {
    ...inputState,
    previousSelectedProvider,
    previousConfidence,
    executionImpact: inputState.engineMode === 'SHADOW_ONLY' ? 'NONE' : inputState.executionImpact,
    shadowLearning: inputState.engineMode === 'SHADOW_ONLY' ? true : inputState.shadowLearning,
  };
  const marketSignal = hasInvestorFlowMarketSignalForEmission(state);
  const providerIssue = hasInvestorFlowProviderIssueForEmission(state);
  const dedupKey = investorFlowRouterDedupKey(state);
  lastInvestorFlowRouterSelectedProvider = state.selectedProvider;
  lastInvestorFlowRouterConfidence = state.confidence ?? null;

  if (isNoActionInvestorFlowObservation(state)) {
    const detailTtlMs = options.detailTtlMs ?? INVESTOR_FLOW_OBSERVATION_DETAIL_TTL_MS;
    const summaryTtlMs = options.summaryTtlMs ?? INVESTOR_FLOW_OBSERVATION_SUMMARY_TTL_MS;
    const lastDetailAt = investorFlowObservationLastDetailAt.get(dedupKey) ?? 0;
    const lastSummaryAt = investorFlowObservationLastSummaryAt.get(dedupKey) ?? 0;
    let emitted = false;
    let summaryEmitted = false;

    if (lastDetailAt === 0 || nowMs - lastDetailAt >= detailTtlMs) {
      investorFlowObservationLastDetailAt.set(dedupKey, nowMs);
      if (lastSummaryAt === 0) investorFlowObservationLastSummaryAt.set(dedupKey, nowMs);
      activeLogger.debug(
        `[InvestorFlowRouterObservation] ` +
        `engineMode=${state.engineMode} status=${state.status} signal=${state.signal} ` +
        `selectedProvider=${state.selectedProvider} executionImpact=NONE ` +
        `liveExecutionAllowed=false marketSignal=false providerIssue=false action=NO_ACTION_NORMAL`,
      );
      emitted = true;
    } else {
      investorFlowObservationSuppressedCount.set(dedupKey, (investorFlowObservationSuppressedCount.get(dedupKey) ?? 0) + 1);
    }

    const suppressedCount = investorFlowObservationSuppressedCount.get(dedupKey) ?? 0;
    if (suppressedCount > 0 && (lastSummaryAt === 0 || nowMs - lastSummaryAt >= summaryTtlMs)) {
      investorFlowObservationLastSummaryAt.set(dedupKey, nowMs);
      activeLogger.info(
        `[InvestorFlowRouterObservationSummary] ` +
        `suppressedCount=${suppressedCount} ` +
        `lastState=${state.engineMode}/${state.status}/${state.signal}/${state.selectedProvider} ` +
        `executionImpact=NONE marketSignal=false providerIssue=false action=NO_ACTION_NORMAL`,
      );
      investorFlowObservationSuppressedCount.set(dedupKey, 0);
      summaryEmitted = true;
      emitted = true;
    }

    return {
      emitted,
      adr0477: false,
      observation: true,
      summaryEmitted,
      reasonCodes: [],
      dedupKey,
      marketSignal: false,
      providerIssue: false,
      executionImpact: 'NONE',
      suppressedCount,
      shadowLearning: state.shadowLearning ?? false,
    };
  }

  const reasonCodes = buildInvestorFlowAdr0477ReasonCodes(state, providerIssue, marketSignal);
  if (reasonCodes.length === 0) {
    activeLogger.debug(
      `[InvestorFlowRouterObservation] ` +
      `engineMode=${state.engineMode} status=${state.status} signal=${state.signal} ` +
      `selectedProvider=${state.selectedProvider} executionImpact=${state.executionImpact} ` +
      `liveExecutionAllowed=${state.liveExecutionAllowed} marketSignal=${marketSignal} ` +
      `providerIssue=${providerIssue} action=NO_ACTION_NORMAL`,
    );
    return {
      emitted: true,
      adr0477: false,
      observation: true,
      summaryEmitted: false,
      reasonCodes: [],
      dedupKey,
      marketSignal,
      providerIssue,
      executionImpact: state.executionImpact,
      suppressedCount: 0,
      shadowLearning: state.shadowLearning ?? false,
    };
  }

  const message = `[ADR-0477] InvestorFlowProviderRouter emitted ` +
    `reasonCode=${reasonCodes.join(',')} engineMode=${state.engineMode} status=${state.status} ` +
    `signal=${state.signal} selectedProvider=${state.selectedProvider} ` +
    `executionImpact=${state.executionImpact} liveExecutionAllowed=${state.liveExecutionAllowed} ` +
    `marketSignal=${marketSignal} providerIssue=${providerIssue}`;
  if (state.executionImpact !== 'NONE' || providerIssue || state.liveExecutionAllowed === true) activeLogger.warn(message);
  else activeLogger.info(message);

  return {
    emitted: true,
    adr0477: true,
    observation: false,
    summaryEmitted: false,
    reasonCodes,
    dedupKey,
    marketSignal,
    providerIssue,
    executionImpact: state.executionImpact,
    suppressedCount: 0,
    shadowLearning: state.shadowLearning ?? false,
  };
}
