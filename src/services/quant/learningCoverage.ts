// @responsibility F2W 학습 데이터 밀도 게이트 — (조건 × 레짐) 셀 카운트 SSOT (ADR-0048 PR-Y4)
/**
 * learningCoverage.ts — Learning Coverage Heatmap 게이트
 *
 * 사용자 원안: "학습은 데이터가 있는 곳에서만 작동한다."
 *
 * 27조건 × 7레짐 = 189셀 매트릭스. 어떤 셀도 30건 미만이면 *해당 조건* 가중치
 * 보정 스킵. 페르소나의 "불확실성 높으면 관망" 의 학습 영역 적용.
 *
 * 외부 의존성: TradeRecord 만 — localStorage / 영속 신규 0건 (메모리 only).
 */

import type { TradeRecord } from '../../types/portfolio';
import type { ConditionId } from '../../types/core';
// ADR-0024 ALL_REGIMES 와 동일 — 순환 import 차단 위해 별도 사본.
// regimeMemoryBank 가 feedbackLoopEngine 을 import 하고, feedbackLoopEngine 이 본 모듈을 import 하기 때문.
export type RegimeKey =
  | 'RECOVERY' | 'EXPANSION' | 'SLOWDOWN' | 'RECESSION'
  | 'RANGE_BOUND' | 'UNCERTAIN' | 'CRISIS';
const ALL_REGIMES: RegimeKey[] = [
  'RECOVERY', 'EXPANSION', 'SLOWDOWN', 'RECESSION',
  'RANGE_BOUND', 'UNCERTAIN', 'CRISIS',
];

/** 셀 카운트 임계 — 사용자 원안 30거래 */
export const COVERAGE_THRESHOLD = 30;

/** entryRegime 부재 v1 레코드 fallback */
export const FALLBACK_REGIME: RegimeKey = 'UNCERTAIN';

function isDisabled(): boolean {
  if (typeof process === 'undefined' || !process.env) return false;
  return process.env.LEARNING_COVERAGE_GATE_DISABLED === 'true';
}

/**
 * trades 의 entryRegime 을 정규화 — ALL_REGIMES 에 속하지 않으면 FALLBACK.
 */
function normalizeRegime(raw: string | undefined): RegimeKey {
  if (!raw) return FALLBACK_REGIME;
  return (ALL_REGIMES as string[]).includes(raw) ? (raw as RegimeKey) : FALLBACK_REGIME;
}

/**
 * trades 의 (조건 ≥ 5점 trade) 를 entryRegime 별로 카운트.
 *
 * 입력: 단일 conditionId 의 relevant trades (≥5점)
 * 출력: regime → count Map
 */
export function countTradesByRegime(relevantTrades: TradeRecord[]): Map<RegimeKey, number> {
  const counts = new Map<RegimeKey, number>();
  for (const t of relevantTrades) {
    const r = normalizeRegime(t.entryRegime);
    counts.set(r, (counts.get(r) ?? 0) + 1);
  }
  return counts;
}

/**
 * 셀 충족 여부 판정 — 가장 많은 셀의 trade 수 ≥ COVERAGE_THRESHOLD.
 *
 * @returns { sufficient: boolean, maxCellCount: number }
 */
export function evaluateConditionCoverage(
  relevantTrades: TradeRecord[],
): { sufficient: boolean; maxCellCount: number } {
  if (isDisabled()) {
    return { sufficient: true, maxCellCount: relevantTrades.length };
  }
  const counts = countTradesByRegime(relevantTrades);
  if (counts.size === 0) {
    return { sufficient: false, maxCellCount: 0 };
  }
  const maxCellCount = Math.max(...counts.values());
  return { sufficient: maxCellCount >= COVERAGE_THRESHOLD, maxCellCount };
}

export interface ConditionCoverageMatrix {
  conditionId: ConditionId;
  /** regime → trade count */
  cells: Record<RegimeKey, number>;
  /** 가장 많은 셀 카운트 */
  maxCellCount: number;
  /** maxCellCount ≥ COVERAGE_THRESHOLD */
  sufficient: boolean;
}

/**
 * 모든 조건에 대한 셀 매트릭스 일괄 계산 (운영자 진단용).
 *
 * @param closedTrades 종료된 거래 전체
 * @param conditionScoreThreshold 조건 점수 ≥ 임계값 trade 만 카운트 (기본 5)
 */
export function buildCoverageMatrix(
  closedTrades: TradeRecord[],
  conditionIds: number[],
  conditionScoreThreshold: number = 5,
): ConditionCoverageMatrix[] {
  const result: ConditionCoverageMatrix[] = [];
  for (const id of conditionIds) {
    const relevant = closedTrades.filter(
      t => (t.conditionScores?.[id as ConditionId] ?? 0) >= conditionScoreThreshold,
    );
    const counts = countTradesByRegime(relevant);
    const cells: Record<string, number> = {};
    for (const r of ALL_REGIMES) {
      cells[r] = counts.get(r) ?? 0;
    }
    const maxCellCount = counts.size > 0 ? Math.max(...counts.values()) : 0;
    result.push({
      conditionId: id as ConditionId,
      cells: cells as Record<RegimeKey, number>,
      maxCellCount,
      sufficient: maxCellCount >= COVERAGE_THRESHOLD,
    });
  }
  return result;
}

export const LEARNING_COVERAGE_CONSTANTS = {
  COVERAGE_THRESHOLD,
  FALLBACK_REGIME,
  REGIME_COUNT: ALL_REGIMES.length,
} as const;
