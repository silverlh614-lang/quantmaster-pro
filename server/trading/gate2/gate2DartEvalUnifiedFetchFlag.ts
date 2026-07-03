// @responsibility GATE2_DART_EVAL_UNIFIED_FETCH_ENABLED 플래그 SSOT — Gate2 평가 경로 DART fetch 를 모듈 B(fetchDartFinancialsForGate2)로 통일할지 단일 통로 결정.
/**
 * gate2DartEvalUnifiedFetchFlag.ts (ADR-0662)
 *
 * 평가 경로 getGate2DartFinancialsForEvaluation 의 DART leg 를 레거시 getDartFinancials 대신
 * 모듈 B fetchDartFinancialsForGate2 + evaluator 경계 단위 어댑터로 교체할지 결정한다.
 * - default ON (운영자 결정 2026-07-03 — 선례 kisFinancePrimaryFlag 와 동일 `!== 'false'` 방향):
 *   ICR/ocfToNi 실값 유입. 단위 계약(ocfRatio=OCF/매출% 동결·ocfToNi=OCF/NI배)은 ADR-0662 §1.
 * - 롤백: ENV `GATE2_DART_EVAL_UNIFIED_FETCH_ENABLED=false` 1줄 → 레거시 경로 즉시 복귀(byte-equivalent).
 */
export function isGate2DartEvalUnifiedFetchEnabled(): boolean {
  // default ON — 명시적 'false' 일 때만 레거시 경로 (ADR-0662 운영자 default-ON 승격 2026-07-03).
  return process.env.GATE2_DART_EVAL_UNIFIED_FETCH_ENABLED !== 'false';
}
