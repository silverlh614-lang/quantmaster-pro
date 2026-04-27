// @responsibility math 유틸 함수 모듈
// src/utils/math.ts
// 수학 유틸리티 — 퀀트 엔진 공용

/** 값을 [min, max] 범위로 제한 */
export function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}
