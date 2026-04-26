// @responsibility thresholds 모듈
// src/constants/thresholds.ts
// 퀀트 엔진 전역 임계값 — 매직 넘버를 한 곳에서 관리

/** MHS (Macro Health Score) 임계값 */
export const MHS = {
  /** MHS >= 70 → BULL (HIGH) */
  BULL: 70,
  /** MHS >= 50 → NEUTRAL_HIGH (MEDIUM) */
  NEUTRAL: 50,
  /** MHS >= 30 → NEUTRAL_LOW, MHS < 30 → DEFENSE */
  DEFENSE: 30,
} as const;

/** VKOSPI 임계값 */
export const VKOSPI = {
  /** 안정 구간 상한 — Bull Aggressive 판정 기준 */
  CALM: 20,
  /** 경계 수준 */
  ELEVATED: 25,
  /** 공포 수준 */
  FEAR: 30,
  /** 극단 공포 — Crisis 판정 기준 */
  EXTREME: 35,
} as const;

/** VIX 임계값 */
export const VIX = {
  /** 경계 수준 */
  ELEVATED: 20,
  /** 공포 수준 — Crisis 조합 기준 */
  FEAR: 30,
  /** 역발상 매수 극점 */
  CONTRARIAN: 35,
} as const;

/** USD/KRW 환율 임계값 */
export const FX = {
  /** 달러 강세 기준 */
  DOLLAR_STRONG: 1350,
  /** 달러 약세 기준 */
  DOLLAR_WEAK: 1280,
} as const;

/** 매크로 세부 점수 축별 최대값 (0-25 각 축) */
export const MACRO_AXIS_MAX = 25;

/** US10Y 금리 임계값 */
export const US10Y = {
  HIGH: 4.5,
} as const;

/** 한미 금리 스프레드 임계값 */
export const KR_US_SPREAD = {
  INVERSION: -1.0,
} as const;
