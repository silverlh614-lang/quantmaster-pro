/**
 * kellyHalfLife.ts — Idea 3: Kelly 의 물리적 반감기 (시간 감쇠 모델).
 *
 * "오래 들고 있는 포지션일수록 같은 조건이라도 근거가 약해진다" 는 행동경제학 인사이트를
 * 수학적으로 강제한다. 후회 회피 편향(loss aversion, disposition effect) 에 대한 구조적
 * 방벽 — 시간 자체가 음의 weight 를 만든다.
 *
 *   effectiveKelly(t) = entryKelly × exp(-λt),  λ = ln2 / half_life_days
 *
 * 기본 half_life = 10 영업일 (레짐 평균 보유일 기준). 레짐별 오버라이드 가능.
 * 이 모듈은 "가중치 계산기" 역할만 한다 — 사이즈 결정권은 exitEngine / kellyHealthCard
 * 가 가진다. 본 weight 가 일정 threshold 이하로 떨어지면 trim 후보로 분류 (Phase 3).
 */

const LN2 = Math.log(2);

/** 레짐별 Kelly half-life (영업일). TURBO/BULL 은 짧게 (빠른 감쇠), DEFENSE 는 길게. */
export const REGIME_HALF_LIFE_DAYS: Record<string, number> = {
  R1_TURBO:   7,
  R2_BULL:    10,
  R3_EARLY:   12,
  R4_NEUTRAL: 10,
  R5_CAUTION: 8,
  R6_DEFENSE: 5,
};

/** 기본값 — 레짐 미상 시 사용. */
export const DEFAULT_HALF_LIFE_DAYS = 10;

/**
 * 특정 보유 일수 t 에서의 시간 감쇠 가중치 (0~1).
 *   halfLifeDays 일 지나면 0.5, 2× halfLife 지나면 0.25, …
 */
export function computePositionRiskWeight(
  daysHeld: number,
  halfLifeDays: number = DEFAULT_HALF_LIFE_DAYS,
): number {
  if (!Number.isFinite(daysHeld) || daysHeld <= 0) return 1;
  if (!Number.isFinite(halfLifeDays) || halfLifeDays <= 0) return 1;
  const lambda = LN2 / halfLifeDays;
  return Math.exp(-lambda * daysHeld);
}

/**
 * entryKelly 에 시간 감쇠를 적용한 유효 Kelly.
 */
export function effectiveKellyAfter(
  entryKelly: number,
  daysHeld: number,
  halfLifeDays: number = DEFAULT_HALF_LIFE_DAYS,
): number {
  return entryKelly * computePositionRiskWeight(daysHeld, halfLifeDays);
}

/**
 * 진입 시각으로부터 현재까지의 캘린더 일수를 영업일로 근사.
 * 정확한 영업일 계산은 외부 캘린더가 필요 — 여기서는 `× 5/7` 비례로 근사.
 */
export function businessDaysSince(entryIso: string, now: Date = new Date()): number {
  const entry = new Date(entryIso).getTime();
  const diffMs = now.getTime() - entry;
  if (!Number.isFinite(diffMs) || diffMs <= 0) return 0;
  const calendarDays = diffMs / (24 * 3600 * 1000);
  return calendarDays * (5 / 7);
}

export interface HalfLifeSnapshot {
  /** 진입 후 경과 영업일 (근사) */
  daysHeld: number;
  /** 적용된 half-life (영업일) */
  halfLifeDays: number;
  /** exp(-λt) — 진입 대비 현재 시간 감쇠 가중치 */
  timeDecayWeight: number;
  /** entryKelly × timeDecayWeight */
  effectiveKelly: number;
  /** 권고 플래그 — weight < 0.5 (half-life 초과) 이면 "soft trim 후보" */
  trimCandidate: boolean;
}

/**
 * 진입 포지션에 대한 half-life 스냅샷. kellyHealthCard·/kelly 명령 재활용.
 */
export function halfLifeSnapshot(input: {
  entryKelly: number;
  entryIso: string;
  regime?: string;
  now?: Date;
}): HalfLifeSnapshot {
  const halfLifeDays = REGIME_HALF_LIFE_DAYS[input.regime ?? ''] ?? DEFAULT_HALF_LIFE_DAYS;
  const daysHeld = businessDaysSince(input.entryIso, input.now);
  const weight = computePositionRiskWeight(daysHeld, halfLifeDays);
  return {
    daysHeld,
    halfLifeDays,
    timeDecayWeight: weight,
    effectiveKelly: input.entryKelly * weight,
    trimCandidate: weight < 0.5,
  };
}
