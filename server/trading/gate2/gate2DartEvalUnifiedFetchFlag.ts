// @responsibility GATE2_DART_EVAL_UNIFIED_FETCH_ENABLED 플래그 SSOT — Gate2 평가 경로 DART fetch 를 모듈 B(fetchDartFinancialsForGate2)로 통일할지 단일 통로 결정.
/**
 * gate2DartEvalUnifiedFetchFlag.ts (ADR-0661)
 *
 * 평가 경로 getGate2DartFinancialsForEvaluation 의 DART leg 를 레거시 getDartFinancials 대신
 * 모듈 B fetchDartFinancialsForGate2 + evaluator 경계 단위 어댑터로 교체할지 결정한다.
 * - default OFF: 레거시 경로 byte-equivalent (ADR-0157 opt-in — 운영자 관측 후 =true 승격).
 * - ON: ICR/ocfToNi 실값 유입. 단위 계약(ocfRatio=OCF/매출% 동결·ocfToNi=OCF/NI배)은 ADR-0661 §1.
 * - 롤백: ENV 미설정/`false` 1줄 → 레거시 즉시 복귀.
 */
export function isGate2DartEvalUnifiedFetchEnabled(): boolean {
  // default OFF — 명시적으로 'true' 일 때만 활성 (ADR-0157 opt-in 정확 비교).
  return process.env.GATE2_DART_EVAL_UNIFIED_FETCH_ENABLED === 'true';
}
