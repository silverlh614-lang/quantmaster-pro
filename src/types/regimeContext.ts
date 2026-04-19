/**
 * @responsibility 시장 레짐 분류 결과로부터 모든 하위 엔진이 공유하는 단일 read-only 컨텍스트를 정의한다
 *
 * 배경:
 *   - marketRegimeClassifier 가 4단계 분류(MarketRegimeClassification) + 파생 파라미터를 반환.
 *   - dynamicStopEngine / positionLifecycleEngine 등이 각자 수동으로 파라미터를 복사해 사용.
 *   - 복사 누락 시 systemInterferenceChecker 가 런타임에 충돌을 감지(3가지).
 *
 * 해법:
 *   - RegimeContext: 분류 결과 + 모든 파생 파라미터를 미리 계산해 묶은 read-only 객체.
 *   - 모든 소비자는 이 컨텍스트의 필드만 읽음 → 복사 누락이 컴파일 타임에 불가능.
 *   - REGIME_TYPE_MISMATCH / LIFECYCLE_BREACH_THRESHOLD_MISMATCH /
 *     POSITION_SIZE_LIMIT_IGNORED 충돌이 구조적으로 발생 불가능.
 */

import type { MarketRegimeClassifierResult } from './macro';
import type { DynamicStopRegime } from './sell';

/** 포지션 생애주기 임계값 — RegimeContext 가 결정 */
export interface LifecycleThresholds {
  /** EXIT_PREP 전환 기준: Gate 1 이탈 최소 개수 */
  exitPrepBreachCount: number;
  /** FULL_EXIT 전환 기준: Gate 1 이탈 최소 개수 */
  fullExitBreachCount: number;
}

/**
 * 시장 레짐 단일 진실 소스(SSoT).
 *
 * 모든 필드는 `Readonly` — 소비자는 절대 수정할 수 없다. 분류기 입력이 바뀌면
 * `buildRegimeContext()` 로 새 컨텍스트를 만들어 전체를 교체한다.
 */
export interface RegimeContext {
  /** 4단계 분류기 결과 (모든 파생값의 출처) */
  readonly classifier: Readonly<MarketRegimeClassifierResult>;

  /** dynamicStopEngine 이 사용할 3단계 레짐 (자동 매핑) */
  readonly dynamicStopRegime: DynamicStopRegime;

  /** positionLifecycleEngine 이 사용할 임계값 (자동 도출) */
  readonly lifecycle: Readonly<LifecycleThresholds>;

  /** 신규 매수 차단 여부 (RISK_OFF_CRISIS 자동 true) */
  readonly buyingHalted: boolean;

  /** 포지션 사이즈 한도(0~100%) — 주문 단계에서 적용 */
  readonly positionSizeLimitPct: number;

  /** 컨텍스트 생성 시각 (ISO) — 캐시 만료/감사 추적용 */
  readonly builtAt: string;
}
