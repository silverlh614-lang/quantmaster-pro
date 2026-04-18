/**
 * sell/sellChecklist27.ts — 매도 27단계 대칭 체크리스트
 *
 * 매수 27조건의 역방향을 체계화. 매수 Gate 1/2/3 피라미드와 정확히 대칭.
 *
 * Survival Exit (5)   — Gate 1 조건 이탈 ≥ 3 → 자동 전량 청산
 *                       매수 Gate 1 [1, 3, 5, 7, 9]의 역방향
 * Warning (12)        — Gate 2 조건 이탈 ≥ 9 → 50% 매도
 *                       매수 Gate 2 [4, 6, 8, 10, 11, 12, 13, 14, 15, 16, 21, 24]의 역방향
 * Precision Exit (10) — Gate 3 조건 이탈 관측 (경보)
 *                       매수 Gate 3 [2, 17, 18, 19, 20, 22, 23, 25, 26, 27]의 역방향
 *
 * 매수 때 썼던 데이터 페처를 그대로 재사용하므로 구현 비용이 낮다.
 * 각 조건 평가는 호출자가 SellChecklistInput으로 주입하는 boolean 플래그로 통일.
 * 실제 조건 평가 로직은 매수 gateEngine이 계산한 결과를 negate하여 전달.
 */

import type { ActivePosition } from '../../../types/sell';

// ─── 조건 ID 배열 (매수 Gate와 대칭) ─────────────────────────────────────────

/** Survival Exit 5개 — 매수 Gate 1의 역방향. 이 중 3개 이상 이탈 시 전량. */
export const SURVIVAL_EXIT_IDS = [1, 3, 5, 7, 9] as const;

/** Warning 12개 — 매수 Gate 2의 역방향. 9개 이상 이탈 시 50% 매도. */
export const WARNING_EXIT_IDS = [4, 6, 8, 10, 11, 12, 13, 14, 15, 16, 21, 24] as const;

/** Precision Exit 10개 — 매수 Gate 3의 역방향. 관측만 (경보). */
export const PRECISION_EXIT_IDS = [2, 17, 18, 19, 20, 22, 23, 25, 26, 27] as const;

export type SellConditionId =
  | (typeof SURVIVAL_EXIT_IDS)[number]
  | (typeof WARNING_EXIT_IDS)[number]
  | (typeof PRECISION_EXIT_IDS)[number];

// ─── 입력 ─────────────────────────────────────────────────────────────────────

/**
 * 호출자가 주입하는 조건별 이탈 여부 맵.
 * true  = 해당 조건이 **이탈됨** (매수 때 통과했던 조건이 지금은 실패)
 * false = 여전히 통과 상태
 *
 * 매수 엔진이 이미 계산한 각 조건 스코어(0~10)가 PASS_THRESHOLD(5) 미만이면 true로 설정.
 */
export type ConditionBreachMap = Readonly<Partial<Record<SellConditionId, boolean>>>;

export interface SellChecklistInput {
  /** 매수 시점 조건 통과 기록 (리그레션 감지용 — 매수 때 통과했는데 지금 이탈 → 진짜 이탈) */
  entryPassMap?: ConditionBreachMap;
  /** 현재 시점 조건별 이탈 여부 */
  currentBreachMap: ConditionBreachMap;
}

// ─── 출력 ─────────────────────────────────────────────────────────────────────

export interface SellChecklistResult {
  survivalFails:  SellConditionId[];   // 이탈된 Gate 1 역방향 조건 id
  warningFails:   SellConditionId[];
  precisionFails: SellConditionId[];
  /**
   * 자동 조치 권고:
   *   FULL_EXIT  — survivalFails ≥ 3
   *   HALF_EXIT  — warningFails ≥ 9
   *   ALERT      — precisionFails ≥ 7 (매도 아님, 경보만)
   *   NONE       — 임계 미만
   */
  verdict: 'FULL_EXIT' | 'HALF_EXIT' | 'ALERT' | 'NONE';
  /** verdict에 대응하는 매도 비율 (0~1). ALERT는 0. */
  sellRatio: number;
  reason: string;
}

// ─── 임계값 (매수 Gate와 대칭) ────────────────────────────────────────────────

const SURVIVAL_FAIL_THRESHOLD = 3;   // Gate 1 5개 중 3개 이탈
const WARNING_FAIL_THRESHOLD  = 9;   // Gate 2 12개 중 9개 이탈
const PRECISION_FAIL_THRESHOLD = 7;  // Gate 3 10개 중 7개 이탈 (경보만)

// ─── 평가 함수 ───────────────────────────────────────────────────────────────

/**
 * 조건 ID 배열에서 이탈된 것만 추출.
 * entryPassMap이 있으면 "매수 때 통과 AND 지금 이탈"만 이탈로 간주 (리그레션 기반).
 * 없으면 currentBreachMap만 사용.
 */
function collectFails(
  ids: readonly SellConditionId[],
  input: SellChecklistInput,
): SellConditionId[] {
  const fails: SellConditionId[] = [];
  for (const id of ids) {
    const isBreach = input.currentBreachMap[id] === true;
    if (!isBreach) continue;
    if (input.entryPassMap) {
      // 매수 때 통과했는지(=breach=false) 확인 — 통과했던 조건만 카운트
      const entryWasPass = input.entryPassMap[id] === false;
      if (!entryWasPass) continue;
    }
    fails.push(id);
  }
  return fails;
}

export function evaluateSellChecklist27(
  position: ActivePosition,
  input: SellChecklistInput,
): SellChecklistResult {
  const survivalFails  = collectFails(SURVIVAL_EXIT_IDS,  input);
  const warningFails   = collectFails(WARNING_EXIT_IDS,   input);
  const precisionFails = collectFails(PRECISION_EXIT_IDS, input);

  if (survivalFails.length >= SURVIVAL_FAIL_THRESHOLD) {
    return {
      survivalFails,
      warningFails,
      precisionFails,
      verdict: 'FULL_EXIT',
      sellRatio: 1.0,
      reason: `Survival 조건 ${survivalFails.length}개 이탈(기준 ${SURVIVAL_FAIL_THRESHOLD}): [${survivalFails.join(',')}]. 전량 청산.`,
    };
  }

  if (warningFails.length >= WARNING_FAIL_THRESHOLD) {
    return {
      survivalFails,
      warningFails,
      precisionFails,
      verdict: 'HALF_EXIT',
      sellRatio: 0.50,
      reason: `Warning 조건 ${warningFails.length}개 이탈(기준 ${WARNING_FAIL_THRESHOLD}): [${warningFails.join(',')}]. ${position.stockCode} 50% 매도.`,
    };
  }

  if (precisionFails.length >= PRECISION_FAIL_THRESHOLD) {
    return {
      survivalFails,
      warningFails,
      precisionFails,
      verdict: 'ALERT',
      sellRatio: 0,
      reason: `Precision 조건 ${precisionFails.length}개 이탈(기준 ${PRECISION_FAIL_THRESHOLD}): [${precisionFails.join(',')}]. 경보만, 매도 없음.`,
    };
  }

  return {
    survivalFails,
    warningFails,
    precisionFails,
    verdict: 'NONE',
    sellRatio: 0,
    reason: '이상 없음 — 모든 체크리스트 임계 미만.',
  };
}
