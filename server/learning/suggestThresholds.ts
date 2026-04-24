/**
 * @responsibility 학습 모듈 suggest 파이프라인의 임계값 상수(샘플수·비율·CI·Δ·커버리지)를 ADR-0007 기준으로 단일 정의한다.
 */

/** counterfactualShadow — suggest 발동에 필요한 최소 resolved 샘플 수. */
export const SUGGEST_MIN_SAMPLE_COUNTERFACTUAL = 30;

/** counterfactualShadow — 탈락 평균 / 통과 평균 비율이 이 이상이면 Gate 과잉 의심. */
export const SUGGEST_COUNTERFACTUAL_RATIO_THRESHOLD = 0.8;

/** ledgerSimulator — suggest 발동에 필요한 최소 resolved triplet 수. */
export const SUGGEST_MIN_SAMPLE_LEDGER = 30;

/** ledgerSimulator — B/C universe 가 A 대비 초과해야 하는 누적 수익률(%p → decimal 0.05). */
export const SUGGEST_LEDGER_EDGE_PCT = 0.05;

/** kellySurfaceMap — cell 당 최소 WIN/LOSS 샘플 수. */
export const SUGGEST_MIN_SAMPLE_KELLY_SURFACE = 20;

/** kellySurfaceMap — pHalfWidth (95% Wilson 반폭) 가 이 이하여야 안정된 추정. */
export const SUGGEST_KELLY_CI_THRESHOLD = 0.10;

/** kellySurfaceMap — |추정 Kelly* − 현재 운용 Kelly| 가 이 이상이면 suggest. */
export const SUGGEST_KELLY_DELTA_THRESHOLD = 0.5;

/** regimeBalancedSampler — current / target 비율이 이 미만이면 부족 레짐. */
export const SUGGEST_REGIME_COVERAGE_RATIO = 0.5;

/** regimeBalancedSampler — 해당 레짐 진입 0건이 지속된 일수가 이 이상이면 dry. */
export const SUGGEST_REGIME_DRY_DAYS = 30;
