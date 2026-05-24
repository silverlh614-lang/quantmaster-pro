// @responsibility Classify scan outcome as skipped, degraded, evaluated.

import type { MacroGateState } from '../scanDiagnostics/scanSummaryTypes.js';
import type { GateEvaluationReport } from './gateEvaluationReporter.js';
import type { QuoteHydrationReport } from './quoteHydrationGuard.js';
import type { ScanEvaluationExecutionImpact, ScanEvaluationState } from './scanEvaluationState.js';

export interface ScanBlockReasonClassification {
  evaluationState: ScanEvaluationState;
  blockReason?: string;
  breakPoint?: string;
  executionImpact: ScanEvaluationExecutionImpact;
  shadowLearningAllowed: boolean;
  unmapped?: boolean;
}

export interface ScanBlockReasonClassifierInput {
  sellOnly?: boolean;
  marketSessionState: string;
  engineMode: string;
  effectiveRegime: string;
  macroGateState?: MacroGateState;
  totalCandidates: number;
  volumeClockAllowsEntry?: boolean;
  gateReport: GateEvaluationReport;
  quoteReport: QuoteHydrationReport;
}

function includesAny(value: string | undefined, tokens: readonly string[]): boolean {
  const normalized = String(value ?? '').toUpperCase();
  return tokens.some((token) => normalized.includes(token));
}

function isNonTradingSession(input: ScanBlockReasonClassifierInput): boolean {
  return includesAny(input.marketSessionState, [
    'NON_TRADING',
    'HOLIDAY',
    'WEEKEND',
  ]);
}

function isR6LiveBlocked(input: ScanBlockReasonClassifierInput): boolean {
  return (
    input.effectiveRegime === 'R6_DEFENSE' ||
    input.macroGateState?.riskOverride === 'R6_DEFENSE' ||
    includesAny(input.macroGateState?.liveEntryBlockedReason, ['R6'])
  ) && input.macroGateState?.diagnosticLiveEntryBlocked === true;
}

function isRemovedPolicyLiveBlock(input: ScanBlockReasonClassifierInput): boolean {
  const reason = String(input.macroGateState?.liveEntryBlockedReason ?? '').toUpperCase();
  return input.engineMode === 'SELL_ONLY'
    || input.sellOnly === true
    || input.macroGateState?.sellOnlyMode === true
    || reason.includes('SELL_ONLY')
    || isR6LiveBlocked(input);
}

export function classifyScanBlockReason(
  input: ScanBlockReasonClassifierInput,
): ScanBlockReasonClassification {
  if (isNonTradingSession(input)) {
    return {
      evaluationState: 'NOT_EVALUATED_NON_TRADING_DAY',
      blockReason: input.volumeClockAllowsEntry === false ? 'NON_TRADING_TIME' : input.marketSessionState,
      breakPoint: 'SESSION_GUARD',
      executionImpact: 'NONE',
      shadowLearningAllowed: input.macroGateState?.shadowLearningAllowed !== false,
    };
  }

  if (input.engineMode === 'OBSERVE_ONLY') {
    return {
      evaluationState: 'NOT_EVALUATED_OBSERVE_ONLY',
      blockReason: 'OBSERVE_ONLY',
      breakPoint: 'ENGINE_MODE',
      executionImpact: 'NONE',
      shadowLearningAllowed: true,
    };
  }

  if (input.macroGateState?.diagnosticLiveEntryBlocked === true && !isRemovedPolicyLiveBlock(input)) {
    return {
      evaluationState: 'NOT_EVALUATED_DIAGNOSTIC_ONLY',
      blockReason: input.macroGateState.liveEntryBlockedReason ?? 'DIAGNOSTIC_ONLY',
      breakPoint: 'MACRO_DIAGNOSTIC_GUARD',
      executionImpact: 'NEW_BUY_BLOCKED_ONLY',
      shadowLearningAllowed: input.macroGateState.shadowLearningAllowed !== false,
    };
  }

  if (input.quoteReport.state === 'FAILED') {
    return {
      evaluationState: 'EVALUATED_QUOTE_HYDRATION_FAILED',
      blockReason: 'QUOTE_HYDRATION_FAILED',
      breakPoint: input.quoteReport.breakPoint ?? 'PRICE_FETCH',
      executionImpact: 'SCAN_GATE_DEGRADED',
      shadowLearningAllowed: true,
    };
  }

  if (input.gateReport.dataInsufficientCount > 0 && input.gateReport.evaluatedCount === 0) {
    return {
      evaluationState: 'EVALUATED_DATA_INSUFFICIENT',
      blockReason: 'DATA_INSUFFICIENT',
      breakPoint: 'DATA_GUARD',
      executionImpact: 'SCAN_GATE_DEGRADED',
      shadowLearningAllowed: true,
    };
  }

  if (input.quoteReport.state === 'PARTIAL') {
    return {
      evaluationState: 'EVALUATED_PARTIAL',
      blockReason: 'QUOTE_HYDRATION_PARTIAL',
      breakPoint: input.quoteReport.breakPoint ?? 'PRICE_FETCH',
      executionImpact: 'SCAN_GATE_DEGRADED',
      shadowLearningAllowed: true,
    };
  }

  if (input.gateReport.survivorCount > 0) {
    return {
      evaluationState: 'EVALUATED_WITH_SURVIVORS',
      executionImpact: 'NONE',
      shadowLearningAllowed: true,
    };
  }

  if (input.gateReport.rejectedCount > 0) {
    return {
      evaluationState: 'EVALUATED_GATE_REJECTED',
      blockReason: 'GATE_REJECTED',
      breakPoint: 'GATE_EVALUATION',
      executionImpact: 'NONE',
      shadowLearningAllowed: true,
    };
  }

  if (input.totalCandidates === 0 || input.gateReport.evaluatedCount > 0) {
    return {
      evaluationState: 'EVALUATED_ZERO_SURVIVOR',
      blockReason: input.totalCandidates === 0 ? 'NO_CANDIDATES' : 'ZERO_SURVIVOR',
      breakPoint: input.totalCandidates === 0 ? 'CANDIDATE_SELECTION' : 'GATE_EVALUATION',
      executionImpact: 'NONE',
      shadowLearningAllowed: true,
    };
  }

  return {
    evaluationState: 'EVALUATED_ZERO_SURVIVOR',
    blockReason: 'UNMAPPED_SCAN_STATE',
    breakPoint: 'UNKNOWN',
    executionImpact: 'SCAN_GATE_DEGRADED',
    shadowLearningAllowed: true,
    unmapped: true,
  };
}
