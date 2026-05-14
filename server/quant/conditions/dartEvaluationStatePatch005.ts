/**
 * @responsibility DART evaluation state SSOT (Patch-005 직속, 4-state union)
 *
 * Patch ID: KIS-CIRCUIT-OPEN-ENFORCEMENT-AND-DATA-EVAL-STATE-001
 *
 * 사용자 5/14 §"긴급 수정 목표" §9 직접 인용:
 *   *"DART sample=0이면 DART null 0.0%가 아니라 DART=N/A 또는 DART_NOT_EVALUATED로 표시한다."*
 *
 * Safety invariants (절대 변경 금지):
 *   - DART D0 일 때 nullRate 0.0% 표기 영구 금지 (sample=0 → null/N/A literal 강제)
 *   - marketSignal: false literal 강제
 *   - executionImpact: 'NONE' | 'NEW_BUY_BLOCKED_ONLY' literal 강제
 *   - LIVE 매매 본체 0줄 변경
 *   - ENV `=== 'true'` 정확 비교 (ADR-0157)
 */

// 4-value status union SSOT (사용자 명시)
export type DartEvaluationStatus =
  | 'DART_REALTIME'
  | 'DART_STALE'
  | 'DART_NOT_EVALUATED'         // sample=0 → nullRate=null (N/A)
  | 'DART_PROVIDER_UNAVAILABLE';

export interface DartEvaluationState {
  readonly status: DartEvaluationStatus;
  readonly sample: number;
  readonly nullCount: number;
  readonly nullRate: number | null;   // null when sample=0 — 사용자 §"DART D0일 때 0.0% 금지" 강제
  readonly reason?: string;
  readonly providerIssue: boolean;
  // 절대 불변식 literal types (TypeScript 컴파일 타임 강제):
  readonly marketSignal: false;
  readonly executionImpact: 'NONE' | 'NEW_BUY_BLOCKED_ONLY';
  readonly evaluatedAtMs: number;
}

export function isDartEvaluationStateDisabled(): boolean {
  return process.env.DART_EVALUATION_STATE_PATCH_005_DISABLED === 'true';
}

export interface ClassifyDartInput {
  readonly sample: number;
  readonly nullCount: number;
  readonly cacheUsedCount?: number;        // cache 로 응답한 종목 수 (DART_STALE 판정 입력)
  readonly providerUnavailable?: boolean;
  readonly mtasEvaluatedReadyCount?: number; // MTAS 후 ready candidate 수 (NOT_EVALUATED reason)
  readonly nowMs?: number;
}

/**
 * DART 분류 결정 트리 SSOT (사용자 §"기대 로그" 정합, 절대 변경 금지).
 *
 * 우선순위:
 *   1. ENV DISABLED → DART_NOT_EVALUATED + reason='ENV_DISABLED'
 *   2. sample=0 → DART_NOT_EVALUATED + nullRate=null (N/A 강제, 사용자 §9)
 *   3. providerUnavailable=true → DART_PROVIDER_UNAVAILABLE + executionImpact=NEW_BUY_BLOCKED_ONLY
 *   4. cacheUsedCount = sample → DART_STALE
 *   5. 그 외 → DART_REALTIME
 */
export function classifyDartEvaluation(input: ClassifyDartInput): DartEvaluationState {
  const nowMs = input.nowMs ?? Date.now();

  const base = {
    sample: input.sample,
    nullCount: input.nullCount,
    marketSignal: false as const,
    evaluatedAtMs: nowMs,
  };

  // 1. ENV DISABLED
  if (isDartEvaluationStateDisabled()) {
    return {
      ...base,
      status: 'DART_NOT_EVALUATED',
      nullRate: null,
      reason: 'ENV_DISABLED',
      providerIssue: false,
      executionImpact: 'NONE',
    };
  }

  // 2. sample=0 → NOT_EVALUATED + nullRate=null (사용자 §9)
  if (input.sample === 0 || input.sample < 0 || !Number.isFinite(input.sample)) {
    return {
      ...base,
      sample: 0,
      nullCount: 0,
      status: 'DART_NOT_EVALUATED',
      nullRate: null,
      reason: (input.mtasEvaluatedReadyCount ?? 0) === 0
        ? 'NO_READY_CANDIDATE_AFTER_MTAS'
        : 'NO_DART_SAMPLE',
      providerIssue: false,
      executionImpact: 'NEW_BUY_BLOCKED_ONLY',
    };
  }

  const nullRate = input.nullCount / input.sample;

  // 3. provider unavailable
  if (input.providerUnavailable === true) {
    return {
      ...base,
      status: 'DART_PROVIDER_UNAVAILABLE',
      nullRate,
      reason: 'DART_PROVIDER_ERROR',
      providerIssue: true,
      executionImpact: 'NEW_BUY_BLOCKED_ONLY',
    };
  }

  // 4. cache fallback
  if ((input.cacheUsedCount ?? 0) === input.sample && input.sample > 0) {
    return {
      ...base,
      status: 'DART_STALE',
      nullRate,
      reason: 'ALL_CACHE_FALLBACK',
      providerIssue: false,
      executionImpact: 'NEW_BUY_BLOCKED_ONLY',
    };
  }

  // 5. realtime
  return {
    ...base,
    status: 'DART_REALTIME',
    nullRate,
    reason: 'ALL_LIVE_SUCCESS',
    providerIssue: false,
    executionImpact: 'NONE',
  };
}

/**
 * `[DART_EVALUATION_STATE]` 진단 로그 SSOT (사용자 §"기대 로그" 정확 형식).
 */
export function formatDartEvaluationStateLog(state: DartEvaluationState): string {
  const nullRateStr = state.nullRate === null ? 'N/A' : `${(state.nullRate * 100).toFixed(1)}%`;
  return [
    `[DART_EVALUATION_STATE]`,
    `status=${state.status}`,
    `sample=${state.sample}`,
    `nullRate=${nullRateStr}`,
    `reason=${state.reason ?? 'N/A'}`,
  ].join(' ');
}

/**
 * `/scan_blockers runtime` compact line.
 */
export function formatDartEvaluationCompactLine(state: DartEvaluationState): string {
  const nullRateStr = state.nullRate === null ? 'N/A' : `${(state.nullRate * 100).toFixed(1)}%`;
  return [
    `[PATCH-RUNTIME] (Patch-005 DART)`,
    `status=${state.status}`,
    `sample=${state.sample}`,
    `nullRate=${nullRateStr}`,
    `executionImpact=${state.executionImpact}`,
  ].join(' ');
}
