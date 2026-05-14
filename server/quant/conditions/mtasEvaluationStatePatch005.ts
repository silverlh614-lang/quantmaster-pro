/**
 * @responsibility MTAS evaluation state SSOT (Patch-005 직속, 5-state union)
 *
 * Patch ID: KIS-CIRCUIT-OPEN-ENFORCEMENT-AND-DATA-EVAL-STATE-001
 *
 * 사용자 5/14 §"긴급 수정 목표" §7~§8 직접 인용:
 *   *"MTAS는 KIS live data 실패 시 실패율 100%로만 처리하지 말고 MTAS_STALE /
 *   MTAS_PARTIAL / MTAS_NOT_EVALUATED로 상태화한다."*
 *   *"MTAS_NOT_EVALUATED는 marketSignal=false, providerIssue=true/false 별도,
 *   executionImpact=NEW_BUY_BLOCKED_ONLY로만 처리한다."*
 *
 * Safety invariants (절대 변경 금지):
 *   - MTAS failRate=100% 단순 표기 영구 금지 (5-state 분류 의무)
 *   - sample=0 → MTAS_NOT_EVALUATED + failRate=null
 *   - marketSignal: false literal 강제
 *   - executionImpact: 'NONE' | 'NEW_BUY_BLOCKED_ONLY' literal 강제
 *   - LIVE 매매 본체 0줄 변경
 *   - ENV `=== 'true'` 정확 비교 (ADR-0157)
 */

// 5-value status union SSOT (사용자 명시, 절대 변경 금지)
export type MtasEvaluationStatus =
  | 'MTAS_REALTIME'              // live KIS 성공
  | 'MTAS_STALE_DEGRADED'        // cache 사용
  | 'MTAS_PARTIAL'               // 일부 종목만 성공
  | 'MTAS_NOT_EVALUATED'         // 평가 대상 없음 (sample=0)
  | 'MTAS_PROVIDER_UNAVAILABLE'; // provider 실패 (circuit OPEN/HARD_OPEN)

export interface MtasEvaluationState {
  readonly status: MtasEvaluationStatus;
  readonly sample: number;
  readonly successCount: number;
  readonly failCount: number;
  readonly failRate: number | null;   // null when sample=0 — N/A 강제
  readonly reason?: string;
  readonly providerIssue: boolean;     // sample>0 + provider error 시 true
  // 절대 불변식 literal types (TypeScript 컴파일 타임 강제):
  readonly marketSignal: false;
  readonly executionImpact: 'NONE' | 'NEW_BUY_BLOCKED_ONLY';
  readonly evaluatedAtMs: number;
}

export function isMtasEvaluationStateDisabled(): boolean {
  return process.env.MTAS_EVALUATION_STATE_PATCH_005_DISABLED === 'true';
}

export interface ClassifyMtasInput {
  readonly sample: number;
  readonly successCount: number;
  readonly failCount: number;
  readonly cacheUsedCount?: number;        // cache 로 성공한 종목 수 (MTAS_STALE_DEGRADED 판정 입력)
  readonly providerUnavailable?: boolean;  // circuit OPEN/HARD_OPEN 또는 provider error
  readonly nowMs?: number;
}

/**
 * MTAS 분류 결정 트리 SSOT (사용자 §"MTAS 정책" 정합, 절대 변경 금지).
 *
 * 우선순위:
 *   1. ENV DISABLED → MTAS_NOT_EVALUATED + reason='ENV_DISABLED'
 *   2. sample=0 → MTAS_NOT_EVALUATED + failRate=null (N/A 강제)
 *   3. providerUnavailable=true → MTAS_PROVIDER_UNAVAILABLE + executionImpact=NEW_BUY_BLOCKED_ONLY
 *   4. failCount=sample (전부 실패) + providerUnavailable=false → MTAS_PROVIDER_UNAVAILABLE
 *      (사용자 §"실패 100%" 결함 차단 — 단순 100% 표기 금지)
 *   5. cacheUsedCount=sample → MTAS_STALE_DEGRADED + executionImpact=NEW_BUY_BLOCKED_ONLY
 *   6. successCount > 0 + failCount > 0 → MTAS_PARTIAL + executionImpact=NEW_BUY_BLOCKED_ONLY
 *   7. successCount = sample → MTAS_REALTIME + executionImpact=NONE
 */
export function classifyMtasEvaluation(input: ClassifyMtasInput): MtasEvaluationState {
  const nowMs = input.nowMs ?? Date.now();

  const base = {
    sample: input.sample,
    successCount: input.successCount,
    failCount: input.failCount,
    marketSignal: false as const,
    evaluatedAtMs: nowMs,
  };

  // 1. ENV DISABLED
  if (isMtasEvaluationStateDisabled()) {
    return {
      ...base,
      status: 'MTAS_NOT_EVALUATED',
      failRate: null,
      reason: 'ENV_DISABLED',
      providerIssue: false,
      executionImpact: 'NONE',
    };
  }

  // 2. sample=0 → NOT_EVALUATED (사용자 §"기대 로그" 정합)
  if (input.sample === 0 || input.sample < 0 || !Number.isFinite(input.sample)) {
    return {
      ...base,
      sample: 0,
      successCount: 0,
      failCount: 0,
      status: 'MTAS_NOT_EVALUATED',
      failRate: null,
      reason: input.providerUnavailable ? 'KIS_CIRCUIT_OPEN' : 'NO_READY_CANDIDATE',
      providerIssue: false,
      executionImpact: 'NEW_BUY_BLOCKED_ONLY',
    };
  }

  // failRate 산출 (sample>0)
  const failRate = input.failCount / input.sample;

  // 3. provider unavailable
  if (input.providerUnavailable === true) {
    return {
      ...base,
      status: 'MTAS_PROVIDER_UNAVAILABLE',
      failRate,
      reason: 'KIS_CIRCUIT_OPEN_OR_HARD_OPEN',
      providerIssue: true,
      executionImpact: 'NEW_BUY_BLOCKED_ONLY',
    };
  }

  // 4. 전부 실패 (failCount=sample, success=0) — 사용자 §"실패 100% 반복 알림 금지"
  if (input.failCount === input.sample && input.successCount === 0) {
    return {
      ...base,
      status: 'MTAS_PROVIDER_UNAVAILABLE',
      failRate,
      reason: 'ALL_FAIL_TREATED_AS_PROVIDER_ISSUE',
      providerIssue: true,
      executionImpact: 'NEW_BUY_BLOCKED_ONLY',
    };
  }

  // 5. cacheUsedCount = sample → STALE_DEGRADED
  if ((input.cacheUsedCount ?? 0) === input.sample && input.sample > 0) {
    return {
      ...base,
      status: 'MTAS_STALE_DEGRADED',
      failRate,
      reason: 'ALL_CACHE_FALLBACK',
      providerIssue: false,
      executionImpact: 'NEW_BUY_BLOCKED_ONLY',
    };
  }

  // 6. successCount > 0 + failCount > 0 → PARTIAL
  if (input.successCount > 0 && input.failCount > 0) {
    return {
      ...base,
      status: 'MTAS_PARTIAL',
      failRate,
      reason: 'MIXED_SUCCESS_AND_FAILURE',
      providerIssue: false,
      executionImpact: 'NEW_BUY_BLOCKED_ONLY',
    };
  }

  // 7. successCount = sample → REALTIME
  return {
    ...base,
    status: 'MTAS_REALTIME',
    failRate,
    reason: 'ALL_LIVE_SUCCESS',
    providerIssue: false,
    executionImpact: 'NONE',
  };
}

/**
 * `[MTAS_EVALUATION_STATE]` 진단 로그 SSOT (사용자 §"기대 로그" 정확 형식).
 */
export function formatMtasEvaluationStateLog(state: MtasEvaluationState): string {
  const failRateStr = state.failRate === null ? 'N/A' : `${(state.failRate * 100).toFixed(1)}%`;
  return [
    `[MTAS_EVALUATION_STATE]`,
    `status=${state.status}`,
    `reason=${state.reason ?? 'N/A'}`,
    `sample=${state.sample}`,
    `failRate=${failRateStr}`,
    `marketSignal=false`,
    `executionImpact=${state.executionImpact}`,
  ].join(' ');
}

/**
 * `/scan_blockers runtime` compact line.
 */
export function formatMtasEvaluationCompactLine(state: MtasEvaluationState): string {
  const failRateStr = state.failRate === null ? 'N/A' : `${(state.failRate * 100).toFixed(1)}%`;
  return [
    `[PATCH-RUNTIME] (Patch-005 MTAS)`,
    `status=${state.status}`,
    `sample=${state.sample}`,
    `failRate=${failRateStr}`,
    `executionImpact=${state.executionImpact}`,
  ].join(' ');
}
