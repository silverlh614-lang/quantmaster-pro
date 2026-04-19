/**
 * @responsibility 14개 평가기를 단일 defaultRegistry 에 자동 등록해 외부에 노출하는 진입점
 *
 * 신규 조건 추가 절차:
 *   1. evaluators.ts 에 새 ConditionEvaluator 작성 (또는 별도 파일)
 *   2. CONDITION_KEYS 에 새 key 추가 (server/quantFilter.ts)
 *   3. 본 파일에서 register(...) 한 줄 추가
 *   기존 evaluator 코드는 한 줄도 수정하지 않는다 (Open-Closed).
 */

import { ConditionRegistry } from './registry.js';
import {
  momentumEvaluator,
  maAlignmentEvaluator,
  volumeBreakoutEvaluator,
  perEvaluator,
  turtleHighEvaluator,
  relativeStrengthEvaluator,
  vcpEvaluator,
  volumeSurgeEvaluator,
  rsiZoneEvaluator,
  macdBullEvaluator,
  pullbackEvaluator,
  ma60RisingEvaluator,
  weeklyRsiZoneEvaluator,
  supplyConfluenceEvaluator,
  earningsQualityEvaluator,
} from './evaluators.js';

export { ConditionRegistry } from './registry.js';
export type {
  ConditionEvaluator,
  ConditionEvalContext,
  ConditionEvalOutput,
  EvaluatorInput,
} from './types.js';
export { calculateCompressionScore } from './evaluators.js';

/**
 * 프로덕션 기본 레지스트리 — 모듈 로드 시점에 14개 평가기 등록.
 * 테스트는 `new ConditionRegistry().register(...)` 로 별도 인스턴스 가능.
 */
export const defaultRegistry: ConditionRegistry = new ConditionRegistry()
  .register(momentumEvaluator)
  .register(maAlignmentEvaluator)
  .register(volumeBreakoutEvaluator)
  .register(perEvaluator)
  .register(turtleHighEvaluator)
  .register(relativeStrengthEvaluator)
  .register(vcpEvaluator)
  .register(volumeSurgeEvaluator)
  .register(rsiZoneEvaluator)
  .register(macdBullEvaluator)
  .register(pullbackEvaluator)
  .register(ma60RisingEvaluator)
  .register(weeklyRsiZoneEvaluator)
  .register(supplyConfluenceEvaluator)
  .register(earningsQualityEvaluator);
