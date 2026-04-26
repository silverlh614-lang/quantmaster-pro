// @responsibility quant drawdownThresholds 엔진 모듈
/**
 * sell/drawdownThresholds.ts — 레짐×프로파일 2차원 낙폭 역치 테이블
 *
 * 기존 Pre-Mortem 조건 5 "고점 대비 -30%" 고정 상수를 대체.
 *
 * 레짐이 공격적일수록(R1_TURBO) 변동성이 정상이므로 역치를 완만하게,
 * 방어적일수록(R5_CAUTION) 타이트하게 조인다. 프로파일도 마찬가지 —
 * A(대형 주도주)는 여유, D(촉매 플레이)는 타이트.
 *
 * 이 상수는 regimeEngine.REGIME_CONFIGS와 병렬 구조로 배치되어
 * 백테스팅 시 튜닝 가능한 단일 진실 공급원을 이룬다.
 */

import type { RegimeLevel, StockProfileType } from '../../../types/core';

/**
 * 고점 대비 낙폭 기준 (음수, e.g., -0.30 = 고점 대비 -30%).
 * 현재 drawdown이 이 값 이하로 내려가면 TREND_COLLAPSE 트리거 발동.
 */
export const DRAWDOWN_THRESHOLDS: Record<RegimeLevel, Record<StockProfileType, number>> = {
  R1_TURBO: {
    A: -0.35,  // 공격 레짐 × 대형 주도주 → 가장 여유
    B: -0.30,
    C: -0.25,
    D: -0.20,
  },
  R2_BULL: {
    A: -0.30,
    B: -0.27,
    C: -0.23,
    D: -0.18,
  },
  R3_EARLY: {
    A: -0.28,
    B: -0.25,
    C: -0.22,
    D: -0.17,
  },
  R4_NEUTRAL: {
    A: -0.25,
    B: -0.22,
    C: -0.20,
    D: -0.15,
  },
  R5_CAUTION: {
    A: -0.22,  // 주의 레짐 — 빠른 대응
    B: -0.20,
    C: -0.18,
    D: -0.13,
  },
  R6_DEFENSE: {
    A: -0.18,  // 블랙스완 — 최대한 타이트
    B: -0.15,
    C: -0.12,
    D: -0.10,
  },
};

/**
 * 현재 레짐과 프로파일에 해당하는 낙폭 역치 조회.
 */
export function resolveDrawdownThreshold(
  regime: RegimeLevel,
  profile: StockProfileType,
): number {
  return DRAWDOWN_THRESHOLDS[regime][profile];
}
