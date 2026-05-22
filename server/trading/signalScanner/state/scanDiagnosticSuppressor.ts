// @responsibility Emit compact operational warns for scan-state diagnostics.

import { emitOperationalWarn } from '../../../observability/operationalWarn.js';
import type { ExecutionImpact } from '../../../observability/executionImpact.js';
import type { WarnMode } from '../../../observability/operationalWarnTypes.js';
import type { ScanEvaluationResult } from './scanEvaluationState.js';

export type ScanOperationalWarnCode =
  | 'P1_SCAN_STATE_UNCLEAR'
  | 'P1_QUOTE_HYDRATION_FAILED'
  | 'P1_GATE_EVALUATION_DEGRADED'
  | 'P1_SCAN_BLOCK_REASON_UNMAPPED'
  | 'P1_SELL_ONLY_EVALUATION_SKIPPED'
  | 'P1_R6_LIVE_BLOCKED_SHADOW_ALLOWED'
  | 'P1_SCAN_DIAGNOSTIC_BUILD_FAILED';

function toWarnMode(engineMode: string | undefined): WarnMode | undefined {
  switch (engineMode) {
    case 'LIVE':
    case 'SHADOW':
    case 'SHADOW_ONLY':
    case 'SELL_ONLY':
    case 'OBSERVE_ONLY':
    case 'NORMAL':
    case 'DEGRADED':
      return engineMode;
    default:
      return undefined;
  }
}

function toOperationalImpact(impact: ScanEvaluationResult['executionImpact'] | ExecutionImpact): ExecutionImpact {
  if (impact === 'NEW_BUY_BLOCKED_ONLY') return 'NEW_BUY_BLOCKED_ONLY';
  return impact;
}

export function emitScanOperationalWarn(input: {
  code: ScanOperationalWarnCode;
  message: string;
  result?: ScanEvaluationResult;
  executionImpact?: ExecutionImpact;
  dedupKey?: string;
  details?: Record<string, unknown>;
  ttlSec?: number;
}): void {
  const result = input.result;
  const executionImpact = input.executionImpact ?? (result ? toOperationalImpact(result.executionImpact) : 'NONE');
  emitOperationalWarn({
    priority: 'P1',
    domain: 'DIAGNOSTIC',
    code: input.code,
    message: input.message,
    executionImpact,
    mode: toWarnMode(result?.engineMode),
    regime: result?.effectiveRegime,
    dedupKey: input.dedupKey ?? `scan:${input.code}:${result?.evaluationState ?? 'unknown'}:${result?.breakPoint ?? 'none'}`,
    ttlSec: input.ttlSec ?? 60,
    details: {
      reason: input.message,
      evaluationState: result?.evaluationState,
      blockReason: result?.blockReason,
      breakPoint: result?.breakPoint,
      sourcePath: result?.sourcePath,
      scanId: result?.scanId,
      ...input.details,
    },
  });
}

export function emitScanEvaluationWarnings(result: ScanEvaluationResult): void {
  switch (result.evaluationState) {
    case 'NOT_EVALUATED_R6_LIVE_BLOCKED':
      emitScanOperationalWarn({
        code: 'P1_R6_LIVE_BLOCKED_SHADOW_ALLOWED',
        message: 'Legacy R6 live block ignored by rollback; Gate/data quality remains authoritative.',
        result,
      });
      return;
    case 'EVALUATED_QUOTE_HYDRATION_FAILED':
      emitScanOperationalWarn({
        code: 'P1_QUOTE_HYDRATION_FAILED',
        message: 'Quote hydration failed before gate evaluation.',
        result,
      });
      return;
    case 'EVALUATED_DATA_INSUFFICIENT':
    case 'EVALUATED_PARTIAL':
      emitScanOperationalWarn({
        code: 'P1_GATE_EVALUATION_DEGRADED',
        message: 'Scan evaluation completed with degraded data coverage.',
        result,
      });
      return;
    default:
      if (result.diagnostics?.unmappedBlockReason === true) {
        emitScanOperationalWarn({
          code: 'P1_SCAN_STATE_UNCLEAR',
          message: 'Scan evaluation reached an unclear state.',
          result,
        });
        emitScanOperationalWarn({
          code: 'P1_SCAN_BLOCK_REASON_UNMAPPED',
          message: 'Scan block reason could not be mapped cleanly.',
          result,
        });
      }
  }
}

export function emitScanDiagnosticBuildFailedWarn(input: {
  sourcePath: string;
  error: unknown;
  details?: Record<string, unknown>;
}): void {
  const reason = input.error instanceof Error ? input.error.message : String(input.error);
  emitScanOperationalWarn({
    code: 'P1_SCAN_DIAGNOSTIC_BUILD_FAILED',
    message: `Scan diagnostic build failed at ${input.sourcePath}`,
    executionImpact: 'NONE',
    dedupKey: `scan-diagnostic-build:${input.sourcePath}`,
    details: {
      reason,
      sourcePath: input.sourcePath,
      ...input.details,
    },
    ttlSec: 300,
  });
}
