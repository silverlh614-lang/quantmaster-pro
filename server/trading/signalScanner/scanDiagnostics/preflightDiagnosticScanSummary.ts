/**
 * @responsibility Patch: preflight HARD_BLOCK 경로용 minimal diagnostic ScanSummary 빌더 — getLastScanSummary()가
 * null 로 떨어져 /gate_full(SNAPSHOT_MISSING)·Runtime Resolver Trace(NO_SCAN_SUMMARY)·ADR-0505(PERSIST_SKIPPED/
 * SUMMARY_FIELD_MISSING)가 비는 것을 막는다. canonical scanId/candidate/scanEvaluation + minimal gate1 forensic detail carry (재계산·외부호출 0).
 *
 * 절대 invariant: display-only, executionImpact='NONE'. gatePass=0 (buyListLoop 미진입). 실거래/Gate/SourceSnapshot 0줄 변경.
 */
import type { ScanSummary } from './scanSummaryTypes.js';
import type { PreflightBlockedScanSummary, PreflightScanEvaluationState } from '../preflightBlockedScanSummary.js';
import type { ScanEvaluationResult, ScanEvaluationState } from '../state/scanEvaluationState.js';
import {
  buildGate1MinimumSignalForensicSummaryAdr0505,
  type Gate1MinimumSignalForensicSummaryAdr0505,
} from '../gate1MinimumSignalForensicAuditAdr0505.js';

const PREFLIGHT_GATE_COMPACT_FALLBACK =
  'UNAVAILABLE | reason=PRE_FLIGHT_BLOCK | fallback=true | marketSignal=false';

/** PreflightScanEvaluationState 의 R6 전용 값(canonical 미존재)을 ScanEvaluationState 로 좁힌다. 나머지는 동일 literal. */
function toCanonicalEvaluationState(state: PreflightScanEvaluationState): ScanEvaluationState {
  if (state === 'NOT_EVALUATED_R6_DEFENSE' || state === 'LIVE_ENTRY_SKIPPED_R6_DEFENSE') {
    return 'NOT_EVALUATED_R6_LIVE_BLOCKED';
  }
  return state;
}

function resolveGateCompact(
  diagnostics: Record<string, unknown> | undefined,
  key: 'gate1CompactText' | 'gate2CompactText' | 'gate3CompactText',
): string {
  const value = diagnostics?.[key];
  return typeof value === 'string' && value.length > 0 ? value : PREFLIGHT_GATE_COMPACT_FALLBACK;
}

/**
 * preflight HARD_BLOCK 시점의 minimal diagnostic ScanSummary. buyListLoop 미진입이므로 gatePass=0,
 * gateSamples 없음 — RuntimePipelineAudit 의 buyListLoopEntered 판정은 false 로 유지된다(정합).
 * snapshotId 는 canonical scanId 로 설정해 /gate_full 헤더·Runtime Trace 의 NO_SCAN_SUMMARY/SNAPSHOT_MISSING 을 제거한다.
 */
export function buildPreflightDiagnosticScanSummary(
  preflightBlocked: PreflightBlockedScanSummary,
): ScanSummary {
  const preflightEval = preflightBlocked.scanEvaluation;
  const diagnostics = preflightEval?.diagnostics as Record<string, unknown> | undefined;
  const snapshotId = preflightEval?.scanId ?? preflightBlocked.scanId;
  const time = preflightEval?.asOf ?? preflightBlocked.timestamp ?? new Date().toISOString();
  const scanEvaluation: ScanEvaluationResult | undefined = preflightEval
    ? { ...preflightEval, evaluationState: toCanonicalEvaluationState(preflightEval.evaluationState) }
    : undefined;

  // ADR-0505 forensic detail field: buyListLoop 미진입이라 score/hydration 은 계산 안 됨(0).
  // empty 빌더가 모든 required Record/literal 을 채우고, totalCandidates 만 candidateCount 로 덮어
  // hasSummaryField=true(EMITTED) 로 전환한다 — SUMMARY_FIELD_MISSING 제거. score 미계산은 0(진실).
  const candidateCount = preflightBlocked.candidateSummaryCount;
  const gate1Forensic: Gate1MinimumSignalForensicSummaryAdr0505 = {
    ...buildGate1MinimumSignalForensicSummaryAdr0505([]),
    totalCandidates: candidateCount,
    failedCandidates: candidateCount,
    evaluationState: 'NOT_EVALUATED_BUYLIST_NOT_REACHED',
    buyListLoopEntered: false,
  };

  return {
    time,
    candidates: candidateCount,
    trackB: 0,
    swing: 0,
    catalyst: 0,
    momentum: 0,
    yahooFails: 0,
    gateMisses: 0,
    rrrMisses: 0,
    entries: 0,
    snapshotId,
    scanEvaluation,
    gatePassDistribution: {
      gate1Pass: 0,
      gate2Pass: 0,
      gate3Pass: 0,
      lastTriggerPass: 0,
    },
    gate1MinimumSignalForensicAdr0505: gate1Forensic,
    gateDiagnostics: {
      gate1CompactText: resolveGateCompact(diagnostics, 'gate1CompactText'),
      gate2CompactText: resolveGateCompact(diagnostics, 'gate2CompactText'),
      gate3CompactText: resolveGateCompact(diagnostics, 'gate3CompactText'),
      marketSignal: false,
      diagnosticOnly: true,
      source: 'consolidatedDiagnostic',
    },
  };
}

/** preflight diagnostic 으로 영속된 ScanSummary 식별 (실제 스캔 summary 와 구분 — setter 가 clobber 회피에 사용). */
export const PREFLIGHT_DIAGNOSTIC_SOURCE_PATH_PREFIX = 'preflightBlockedScanSummary';

export function isPreflightDiagnosticScanSummary(summary: ScanSummary | null): boolean {
  const sourcePath = summary?.scanEvaluation?.sourcePath;
  return typeof sourcePath === 'string' && sourcePath.startsWith(PREFLIGHT_DIAGNOSTIC_SOURCE_PATH_PREFIX);
}
