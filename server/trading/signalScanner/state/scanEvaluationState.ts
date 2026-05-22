// @responsibility Scan evaluation state machine public contract and formatter.

import type { ScanCounters } from '../scanDiagnostics/scanCounterTypes.js';
import type { MacroGateState } from '../scanDiagnostics/scanSummaryTypes.js';
import { classifyScanBlockReason } from './scanBlockReasonClassifier.js';
import { buildGateEvaluationReport } from './gateEvaluationReporter.js';
import { evaluateQuoteHydration } from './quoteHydrationGuard.js';

export type ScanEvaluationState =
  | 'NOT_EVALUATED_SELL_ONLY'
  | 'NOT_EVALUATED_NON_TRADING_DAY'
  | 'NOT_EVALUATED_R6_LIVE_BLOCKED'
  | 'NOT_EVALUATED_DIAGNOSTIC_ONLY'
  | 'NOT_EVALUATED_OBSERVE_ONLY'
  | 'EVALUATED_ZERO_SURVIVOR'
  | 'EVALUATED_DATA_INSUFFICIENT'
  | 'EVALUATED_GATE_REJECTED'
  | 'EVALUATED_QUOTE_HYDRATION_FAILED'
  | 'EVALUATED_PARTIAL'
  | 'EVALUATED_WITH_SURVIVORS';

export type ScanEvaluationExecutionImpact =
  | 'NONE'
  | 'NEW_BUY_BLOCKED_ONLY'
  | 'SCAN_GATE_DEGRADED';

export interface ScanEvaluationResult {
  scanId: string;
  asOf: string;
  evaluationState: ScanEvaluationState;
  marketSessionState: string;
  engineMode: string;
  effectiveRegime: string;
  totalCandidates: number;
  evaluated: number;
  skipped: number;
  rejected: number;
  survivors: number;
  quoteHydrated: number;
  quoteHydrationFailed: number;
  blockReason?: string;
  breakPoint?: string;
  sourcePath: string;
  executionImpact: ScanEvaluationExecutionImpact;
  shadowLearningAllowed: boolean;
  diagnostics?: Record<string, unknown>;
}

export interface BuildScanEvaluationResultInput {
  scanId?: string;
  asOf?: string;
  counters: ScanCounters;
  totalCandidates: number;
  sellOnly?: boolean;
  marketSessionState?: string;
  engineMode?: string;
  effectiveRegime?: string;
  macroGateState?: MacroGateState;
  volumeClockAllowsEntry?: boolean;
  sourcePath: string;
  diagnostics?: Record<string, unknown>;
}

function finiteCount(value: unknown): number {
  return typeof value === 'number' && Number.isFinite(value) ? Math.max(0, Math.floor(value)) : 0;
}

export function buildScanEvaluationId(asOf: string): string {
  const compact = asOf.replace(/[^0-9]/g, '').slice(0, 14);
  return `scan-eval-${compact || 'unknown'}`;
}

export function buildScanEvaluationResult(
  input: BuildScanEvaluationResultInput,
): ScanEvaluationResult {
  const asOf = input.asOf ?? new Date().toISOString();
  const totalCandidates = finiteCount(input.totalCandidates);
  const macro = input.macroGateState;
  const gateReport = buildGateEvaluationReport(input.counters, totalCandidates);
  const quoteReport = evaluateQuoteHydration(input.counters, totalCandidates);
  const marketSessionState = input.marketSessionState ?? 'BUY_ALLOWED';
  const rawEngineMode = input.engineMode ?? macro?.engineMode ?? 'NORMAL';
  const engineMode = rawEngineMode === 'SELL_ONLY' ? 'NORMAL' : rawEngineMode;
  const effectiveRegime = input.effectiveRegime ??
    macro?.macroRegimeEffective ??
    macro?.regime ??
    'UNKNOWN';
  const classification = classifyScanBlockReason({
    sellOnly: input.sellOnly,
    marketSessionState,
    engineMode,
    effectiveRegime,
    macroGateState: macro,
    totalCandidates,
    volumeClockAllowsEntry: input.volumeClockAllowsEntry,
    gateReport,
    quoteReport,
  });

  return {
    scanId: input.scanId ?? buildScanEvaluationId(asOf),
    asOf,
    evaluationState: classification.evaluationState,
    marketSessionState,
    engineMode,
    effectiveRegime,
    totalCandidates,
    evaluated: gateReport.evaluatedCount,
    skipped: gateReport.skippedCount,
    rejected: gateReport.rejectedCount,
    survivors: gateReport.survivorCount,
    quoteHydrated: quoteReport.hydrated,
    quoteHydrationFailed: quoteReport.failed,
    ...(classification.blockReason ? { blockReason: classification.blockReason } : {}),
    ...(classification.breakPoint ? { breakPoint: classification.breakPoint } : {}),
    sourcePath: input.sourcePath,
    executionImpact: classification.executionImpact,
    shadowLearningAllowed: classification.shadowLearningAllowed,
    diagnostics: {
      ...input.diagnostics,
      gate: gateReport.diagnostics,
      quote: quoteReport.diagnostics,
      ...(classification.unmapped ? { unmappedBlockReason: true } : {}),
    },
  };
}

export function isNotEvaluatedScanState(state: ScanEvaluationState): boolean {
  return state.startsWith('NOT_EVALUATED_');
}

function displaySourcePath(sourcePath: string | undefined): string {
  const raw = sourcePath ?? 'UNKNOWN';
  return raw.includes('SELL_ONLY') ? 'DIAGNOSTIC_SNAPSHOT' : raw;
}

export function formatScanEvaluationCompactLine(result: ScanEvaluationResult | undefined): string | null {
  if (!result) return null;
  const displayState = result.evaluationState === 'NOT_EVALUATED_SELL_ONLY' || result.evaluationState === 'NOT_EVALUATED_R6_LIVE_BLOCKED'
    ? 'EVALUATED_PARTIAL'
    : result.evaluationState;
  const displayBreakPoint = result.breakPoint === 'PRE_FLIGHT_SELL_ONLY' ? 'PRE_FLIGHT' : result.breakPoint;
  const displayReason = result.blockReason === 'SELL_ONLY' || result.blockReason === 'R6_DEFENSE_SELL_ONLY' || result.blockReason === 'R6_DEFENSE'
    ? 'LEGACY_POLICY_IGNORED'
    : result.blockReason;
  const parts = [
    `evaluationState=${displayState}`,
    `sourcePath=${displaySourcePath(result.sourcePath)}`,
    displayBreakPoint ? `breakPoint=${displayBreakPoint}` : undefined,
    displayReason ? `reason=${displayReason}` : undefined,
    `diagnosticSurvivors=${result.survivors}`,
    `diagnosticEvaluated=${result.evaluated}`,
    `liveSurvivors=${result.survivors}`,
    `liveEvaluated=${result.evaluated}`,
    `skipped=${result.skipped}`,
    `impact=${result.executionImpact}`,
  ].filter((part): part is string => Boolean(part));
  return `ScanEvaluation: ${parts.join(' ')}`;
}

export function formatScanEvaluationSection(result: ScanEvaluationResult | undefined): string | null {
  if (!result) return null;
  const displayState = result.evaluationState === 'NOT_EVALUATED_SELL_ONLY' || result.evaluationState === 'NOT_EVALUATED_R6_LIVE_BLOCKED'
    ? 'EVALUATED_PARTIAL'
    : result.evaluationState;
  const displayBreakPoint = result.breakPoint === 'PRE_FLIGHT_SELL_ONLY' ? 'PRE_FLIGHT' : result.breakPoint;
  const displayReason = result.blockReason === 'SELL_ONLY' || result.blockReason === 'R6_DEFENSE_SELL_ONLY' || result.blockReason === 'R6_DEFENSE'
    ? 'LEGACY_POLICY_IGNORED'
    : result.blockReason;
  return [
    'Scan Evaluation State',
    `  evaluationState=${displayState}`,
    `  sourcePath=${displaySourcePath(result.sourcePath)}`,
    `  breakPoint=${displayBreakPoint ?? 'NONE'}`,
    `  blockReason=${displayReason ?? 'NONE'}`,
    `  marketSessionState=${result.marketSessionState}`,
    `  engineMode=${result.engineMode}`,
    `  effectiveRegime=${result.effectiveRegime}`,
    '  liveEntryEvaluation=EVALUATED_OR_APPLICABLE',
    `  diagnosticEvaluation=${result.evaluationState.startsWith('NOT_EVALUATED_') ? 'PARTIAL' : 'EVALUATED_DIAGNOSTIC'}`,
    `  counts total=${result.totalCandidates} diagnosticEvaluated=${result.evaluated} skipped=${result.skipped} rejected=${result.rejected} diagnosticSurvivors=${result.survivors} liveEvaluated=${result.evaluated} liveSurvivors=${result.survivors}`,
    `  quote hydrated=${result.quoteHydrated} failed=${result.quoteHydrationFailed}`,
    `  executionImpact=${result.executionImpact}`,
    `  shadowLearningAllowed=${result.shadowLearningAllowed}`,
    `  scanId=${result.scanId}`,
    `  asOf=${result.asOf}`,
  ].join('\n');
}
