/**
 * @responsibility MarketRegimeClassifierResult 로부터 모든 소비자가 공유할 RegimeContext 를 빌드한다
 *
 * 사용:
 *   const ctx = buildRegimeContext(classifierResult);
 *   evaluateDynamicStop({ ...input, regime: ctx.dynamicStopRegime });
 *   evaluatePositionLifecycle(state, ctx);
 *
 * 보장:
 *   - dynamicStopRegime, lifecycle.{exitPrep,fullExit}BreachCount, buyingHalted,
 *     positionSizeLimitPct 모두 분류 결과로부터 자동 도출.
 *   - 한 번 생성된 컨텍스트의 필드는 변경 불가(Readonly).
 *   - 분류 결과가 바뀌면 새 컨텍스트를 build → 전체 교체.
 */

import type { MarketRegimeClassifierResult, MarketRegimeClassification } from '../../types/macro';
import type { DynamicStopRegime } from '../../types/sell';
import type { RegimeContext, LifecycleThresholds } from '../../types/regimeContext';

// ─── 4단계 → 3단계 매핑 ──────────────────────────────────────────────────────
//
// RISK_ON_BULL       → RISK_ON   (강세: ATR×2.0, 여유 손절)
// RISK_ON_EARLY      → RISK_ON   (초기 강세: ATR×2.0)
// RISK_OFF_CORRECTION → RISK_OFF (조정: ATR×1.5, 타이트 손절)
// RISK_OFF_CRISIS    → CRISIS    (위기: ATR×1.0, 초타이트 손절)

export function mapClassificationToDynamicStop(
  c: MarketRegimeClassification,
): DynamicStopRegime {
  switch (c) {
    case 'RISK_ON_BULL':        return 'RISK_ON';
    case 'RISK_ON_EARLY':       return 'RISK_ON';
    case 'RISK_OFF_CORRECTION': return 'RISK_OFF';
    case 'RISK_OFF_CRISIS':     return 'CRISIS';
  }
}

// ─── Lifecycle 임계값 도출 ────────────────────────────────────────────────────
//
// 분류기는 gate1BreachThreshold 를 출력하고, 이는 EXIT_PREP / FULL_EXIT 의
// 기준이 된다. 평상 시(BreachThreshold=3): EXIT_PREP=2, FULL_EXIT=3 (기존 하드코딩과 동일).
// CRISIS(BreachThreshold=1): EXIT_PREP=1, FULL_EXIT=1 — 1개 이탈만으로도 즉시 청산.
//
// 규칙: fullExit = max(1, gate1BreachThreshold), exitPrep = max(1, fullExit - 1)

function deriveLifecycleThresholds(
  classifier: MarketRegimeClassifierResult,
): LifecycleThresholds {
  const fullExit = Math.max(1, classifier.gate1BreachThreshold);
  const exitPrep = Math.max(1, fullExit - 1);
  return { exitPrepBreachCount: exitPrep, fullExitBreachCount: fullExit };
}

// ─── 메인 빌더 ────────────────────────────────────────────────────────────────

/**
 * 분류 결과로부터 단일 read-only 컨텍스트를 생성한다.
 * 동일 입력 → 동일 출력(순수 함수). 캐싱은 호출자 측에서 분류 결과 동일성으로 판단.
 */
export function buildRegimeContext(
  classifier: MarketRegimeClassifierResult,
): RegimeContext {
  // freeze 로 런타임에서도 변경 차단 (TS Readonly + Object.freeze 이중 방어)
  return Object.freeze({
    classifier: Object.freeze({ ...classifier, inputs: Object.freeze({ ...classifier.inputs }) }),
    dynamicStopRegime:    mapClassificationToDynamicStop(classifier.classification),
    lifecycle:            Object.freeze(deriveLifecycleThresholds(classifier)),
    buyingHalted:         classifier.buyingHalted,
    positionSizeLimitPct: classifier.positionSizeLimitPct,
    builtAt:              new Date().toISOString(),
  });
}
