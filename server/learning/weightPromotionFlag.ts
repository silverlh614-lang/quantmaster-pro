// @responsibility ADR-0581 Phase 0 — shadow→live 조건가중치 승격 flag (default OFF, byte-equivalent).
/**
 * weightPromotionFlag.ts (ADR-0581 Phase 0)
 *
 * shadow/candidate 에서 검증된 조건가중치를 live(core)로 승격하는 파이프라인의 마스터 스위치.
 * 기본 OFF — 미설정 시 승격 provider 가 등록돼도 live 가중치 byte-identical(파일 직독).
 *
 * paper→live 신뢰경계: 이 flag + governance APPROVED + operator 명시 등록이 모두 충족돼야만
 * 승격된 가중치가 live 스코어링에 도달한다 (Phase 3~4, live 전환 전 마무리 예정). flag 단독으로는
 * 아무것도 바꾸지 않는다 — provider 미등록이면 무효.
 */

/** ENV LEARNING_WEIGHT_PROMOTION_ENABLED=true (default OFF, ADR-0157 정확 비교). */
export function isLearningWeightPromotionEnabled(): boolean {
  return process.env.LEARNING_WEIGHT_PROMOTION_ENABLED === 'true';
}
