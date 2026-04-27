// @responsibility sizingTier 매매 엔진 모듈
/**
 * sizingTier.ts — Phase 4-⑧ 대체 구현: 신뢰도 티어 기반 사이징.
 *
 * 이전 구현(timeframe 축 SCALPING/DAY/SWING)은 다음 5가지 구조적 문제를 일으켰다:
 *   ① 포지션 총량 6 → 12 로 두 배 (수급/리스크 원칙과 충돌)
 *   ② 오케스트레이터 스캔 주기(6~18분) 가 초 단위 스캘핑을 감당 못함
 *   ③ 한국 증시 왕복 비용 ~0.96% 가 스캘핑 수익 구간을 거의 무효화
 *   ④ 학습 데이터가 3개 버킷으로 쪼개져 콜드스타트가 3배 길어짐
 *   ⑤ 기존 INTRADAY (MAX_INTRADAY_POSITIONS) 가드와 중복
 *
 * 대안: 카테고리 신설 없이 "모든 진입에 동일 Kelly 를 쓰는" 문제만 해결한다.
 * 진입 품질 지표(Gate, MTAS, 섹터정렬, 통과 조건 수) 를 티어로 매핑해
 * Kelly 만 차등 적용. 포지션 총량·워치리스트·학습 버킷은 전부 그대로 유지.
 *
 *   CONVICTION — liveGate ≥ 8 && MTAS ≥ 8 && sector aligned  → Kelly ×1.0
 *   STANDARD   — Gate 1 통과 && liveGate 6~8                  → Kelly ×0.6
 *   PROBING    — Gate 1 미달이지만 3개 조건 만족              → Kelly ×0.25, 최대 1슬롯
 *
 * "Gate 1 직전이 가장 수익 높다" 메모리 원칙을 PROBING 슬롯으로 제한 수용.
 */

export type SizingTier = 'CONVICTION' | 'STANDARD' | 'PROBING';

export const CONVICTION_MIN_LIVE_GATE = 8;
export const CONVICTION_MIN_MTAS      = 8;
export const STANDARD_MIN_LIVE_GATE   = 6;
export const PROBING_MIN_CONDITIONS   = 3;
export const PROBING_MAX_SLOTS        = 1;

export const TIER_KELLY_FACTOR: Record<SizingTier, number> = {
  CONVICTION: 1.0,
  STANDARD:   0.6,
  PROBING:    0.25,
};

export interface SizingTierInput {
  /** 실시간 Gate 점수 (재평가 후) — +volumeClockBonus 포함 여부는 일관되게 넘길 것 */
  liveGate: number;
  /** MTAS (0~10) */
  mtas: number;
  /** Gate 1 통과 여부 (예: 서버 Gate 의 gate1.pass) */
  gate1Pass: boolean;
  /** 섹터 정렬 여부 — leadingSectorRS ≥ 60 또는 sectorCycleStage EARLY/MID */
  sectorAligned: boolean;
  /**
   * Gate 1 미달 상태에서 별도로 만족한 핵심 조건 수.
   * PROBING 자격 — 구조상 Gate 1 미달이지만 품질 지표 3개 이상이면 소량 탐색 허용.
   */
  conditionsMatched: number;
}

export interface SizingTierDecision {
  tier: SizingTier | null;
  kellyFactor: number;
  reason: string;
}

/**
 * 진입 품질을 3단계 티어로 분류. null 이면 PROBING 자격도 미달 — 호출부는 스킵.
 */
export function classifySizingTier(input: SizingTierInput): SizingTierDecision {
  if (input.liveGate >= CONVICTION_MIN_LIVE_GATE &&
      input.mtas     >= CONVICTION_MIN_MTAS &&
      input.sectorAligned) {
    return {
      tier: 'CONVICTION',
      kellyFactor: TIER_KELLY_FACTOR.CONVICTION,
      reason: `Gate ${input.liveGate.toFixed(1)} ≥ ${CONVICTION_MIN_LIVE_GATE} · MTAS ${input.mtas.toFixed(1)} ≥ ${CONVICTION_MIN_MTAS} · sector aligned`,
    };
  }
  if (input.gate1Pass &&
      input.liveGate >= STANDARD_MIN_LIVE_GATE &&
      input.liveGate <  CONVICTION_MIN_LIVE_GATE) {
    return {
      tier: 'STANDARD',
      kellyFactor: TIER_KELLY_FACTOR.STANDARD,
      reason: `Gate 1 통과 · liveGate ${input.liveGate.toFixed(1)} ∈ [${STANDARD_MIN_LIVE_GATE}, ${CONVICTION_MIN_LIVE_GATE})`,
    };
  }
  if (!input.gate1Pass && input.conditionsMatched >= PROBING_MIN_CONDITIONS) {
    return {
      tier: 'PROBING',
      kellyFactor: TIER_KELLY_FACTOR.PROBING,
      reason: `Gate 1 미달 · 핵심 조건 ${input.conditionsMatched}개 만족 → 탐색적 소량 진입`,
    };
  }
  return {
    tier: null,
    kellyFactor: 0,
    reason: `조건 불충족 (Gate1=${input.gate1Pass}, liveGate=${input.liveGate.toFixed(1)}, conditions=${input.conditionsMatched})`,
  };
}

// ── PROBING 슬롯 카운터 ────────────────────────────────────────────────────────
// 같은 스캔 tick 내에서 PROBING 진입이 1개를 넘지 못하도록 호출부에서 사용.

export function canReserveProbingSlot(currentProbingCount: number): boolean {
  return currentProbingCount < PROBING_MAX_SLOTS;
}

// ── Idea 7 안A — Tier × Grade 직교 분리 ──────────────────────────────────────
//
// 기존 코드는 (tierDecision.kellyFactor) 와 (FRACTIONAL_KELLY_CAP[grade]) 가 loosely
// 연결되어, STANDARD 티어(×0.6) 가 BUY 등급 캡(0.25) 에 의해 재절단되는 겹침이
// 발생했다. "안A" 는 두 축을 **명시적으로 직교 분리** 한다:
//
//   tier    → "후보 신호의 baseKelly 크기" (0.25~1.0) — 품질 게이트 통과 정도
//   grade   → "절대 상한 (upper cap)" (0.1~0.5)      — Fractional Kelly 파산 방벽
//
// 최종 effectiveKelly 는 아래 한 함수 안에서 순차 적용 (tier × 누적 곱) → grade cap.
// 효과는 기존 min-chain 과 수학적으로 동형이지만:
//   1. 의도가 함수 시그니처와 문서로 드러남 (어디서 무엇이 축소됐는지 역추적 가능)
//   2. snapshot 에 tier/grade 분해가 동시에 기록되어 사후 복기 가능
//   3. tuning 지점 (예: STANDARD 과 STRONG_BUY 의 조합 특례) 이 한 곳에 집중됨
//
// 참고: signalScanner 의 기존 흐름 (positionPct = raw × tierFactor → applyFractionalKelly)
// 은 유지한다. 본 함수는 "동일 결과를 단일 API 로 얻는" 정규 경로.

/** grade 축 — Fractional Kelly upper cap (accountRiskBudget 의 FRACTIONAL_KELLY_CAP 와 정합). */
export const GRADE_UPPER_CAP: Record<'STRONG_BUY' | 'BUY' | 'HOLD' | 'PROBING', number> = {
  STRONG_BUY: 0.50,
  BUY:        0.25,
  HOLD:       0.10,
  PROBING:    0.10,
};

export interface TierGradeComposition {
  /** tier 로 정해진 baseKelly (누적 곱 전 기준 0.25~1.0) */
  tierFactor: number;
  /** grade 로 정해진 upper cap */
  gradeCap: number;
  /** 누적 원 positionPct (raw Kelly × account scale × section × tier 까지 반영된 값) */
  rawKelly: number;
  /** min(rawKelly, gradeCap) — 최종 effective Kelly */
  effectiveKelly: number;
  /** grade cap 에 의해 절단되었는가 */
  wasCapped: boolean;
}

/**
 * Idea 7 안A — tier/grade 를 직교 축으로 조합하는 정규 API.
 * signalScanner 의 기존 computeRiskAdjustedSize 경로와 결과는 동형 (회귀 방어).
 */
export function composeEffectiveKelly(
  tier: SizingTier,
  grade: 'STRONG_BUY' | 'BUY' | 'HOLD' | 'PROBING',
  rawKelly: number,
): TierGradeComposition {
  const tierFactor = TIER_KELLY_FACTOR[tier];
  const gradeCap   = GRADE_UPPER_CAP[grade];
  const safeRaw = Math.max(0, rawKelly);
  const wasCapped = safeRaw > gradeCap;
  const effectiveKelly = Math.min(safeRaw, gradeCap);
  return { tierFactor, gradeCap, rawKelly: safeRaw, effectiveKelly, wasCapped };
}
