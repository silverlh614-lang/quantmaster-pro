/**
 * feedbackLoopEngine.ts — 피드백 폐쇄 루프 (Feedback Closed Loop)
 *
 * 핵심 개념: 시스템 자기진화 — 30거래 누적 후부터 27조건 가중치가 실전 데이터로
 * 자동 교정된다. 구현 직후 효과는 적지만 시간이 지날수록 기하급수적으로 가치가 높아진다.
 *
 * 교정 알고리즘:
 *   1. 30건 이상 종료된 거래 기록 수집
 *   2. 조건별 승률·평균 수익률 집계
 *   3. 승률 > 60%: 가중치 +10% (최대 1.5)
 *      승률 < 40%: 가중치 -10% (최소 0.5)
 *      기타: 1.0 유지
 *   4. localStorage에 저장 → 다음 evaluateStock() 호출부터 반영
 */

import type { TradeRecord, FeedbackLoopResult, ConditionCalibration } from '../../types/portfolio';
import type { ConditionId } from '../../types/core';
import { ALL_CONDITIONS } from './evolutionEngine';
import { saveEvolutionWeights } from './evolutionEngine';
import { getSourceMultiplier, resolveSource } from './sourceWeighting';
import { getTradeLearningWeight, summarizeLossReasonBreakdown } from './lossReasonWeighting';

// ─── 캘리브레이션 임계값 ──────────────────────────────────────────────────────

/** 캘리브레이션 활성화에 필요한 최소 종료 거래 수 */
export const CALIBRATION_MIN_TRADES = 30;

/** 조건별 최소 기여 거래 수 (미달 시 가중치 유지) */
const MIN_CONDITION_TRADES = 5;

/** 가중치 범위 */
const WEIGHT_MIN = 0.5;
const WEIGHT_MAX = 1.5;
const WEIGHT_STEP = 0.10;

// ─── 핵심 로직 ────────────────────────────────────────────────────────────────

/**
 * 종료된 거래 기록에서 조건별 통계를 집계하여 캘리브레이션 결과를 반환한다.
 * calibrationActive = true 일 때만 실제 가중치가 업데이트된다.
 *
 * @param closedTrades - 상태가 'CLOSED'인 거래 기록 배열
 * @param currentWeights - 현재 조건별 가중치 (conditionId → weight)
 * @returns 피드백 루프 캘리브레이션 결과
 */
export function evaluateFeedbackLoop(
  closedTrades: TradeRecord[],
  currentWeights: Record<number, number> = {},
): FeedbackLoopResult {
  const closedCount = closedTrades.length;
  const calibrationActive = closedCount >= CALIBRATION_MIN_TRADES;
  const calibrationProgress = Math.min(1, closedCount / CALIBRATION_MIN_TRADES);

  if (!calibrationActive || closedCount === 0) {
    return {
      closedTradeCount: closedCount,
      calibrationActive: false,
      calibrationProgress,
      calibrations: [],
      boostedCount: 0,
      reducedCount: 0,
      lastCalibratedAt: null,
      summary: closedCount === 0
        ? '매매 기록 없음 — 첫 거래를 시작하세요.'
        : `${closedCount}/${CALIBRATION_MIN_TRADES}거래 누적 중 — ${CALIBRATION_MIN_TRADES - closedCount}건 추가 필요`,
    };
  }

  // ── 조건별 통계 집계 ────────────────────────────────────────────────────────
  const conditionIds = Object.keys(ALL_CONDITIONS).map(Number) as ConditionId[];
  const calibrations: ConditionCalibration[] = [];
  const updatedWeights: Record<number, number> = { ...currentWeights };

  for (const id of conditionIds) {
    // 해당 조건이 ≥ 5점인 거래만 대상
    const relevant = closedTrades.filter(t => (t.conditionScores?.[id] ?? 0) >= 5);
    if (relevant.length < MIN_CONDITION_TRADES) continue;

    // ADR-0022 (PR-E): trade-level confidence weighting — lossReason 별 multiplier 로
    // winRate / avgReturn 가중평균. 수익 거래는 항상 1.0, 손실 거래는 lossReason
    // 매핑 (STOP_TOO_TIGHT 0.3 / MACRO_SHOCK 0.2 / OVERHEATED_ENTRY 1.5 등).
    // lossReason 부재 v1/v2 레코드는 1.0 fallback.
    const tradeWeights = relevant.map(t => getTradeLearningWeight(t));
    const weightedTotal = tradeWeights.reduce((s, w) => s + w, 0);
    const wins = relevant.filter(t => (t.returnPct ?? 0) > 0);
    const weightedWins = wins.reduce((s, t) => s + getTradeLearningWeight(t), 0);
    // 0/0 안전 fallback — weightedTotal 이 0 이면 winRate=0 으로 STABLE 진입
    const winRate = weightedTotal > 0 ? weightedWins / weightedTotal : 0;
    const avgReturn = weightedTotal > 0
      ? relevant.reduce((s, t) => s + (t.returnPct ?? 0) * getTradeLearningWeight(t), 0) / weightedTotal
      : 0;

    const prevWeight = currentWeights[id] ?? 1.0;
    let newWeight = prevWeight;

    // ADR-0020 (PR-C): AI/COMPUTED 차등 학습 — relevant trades 의 conditionSources
    // 다수결로 trade-level source 결정 (PR-A v2 레코드만 있음). 부재 시 글로벌 SSOT.
    // Trade 별로 다를 수 있지만 단일 conditionId 의 source 는 안정적으로 동일하므로
    // 대표 1건의 conditionSources[id] 만 추출해도 충분. 부재 시 SOURCE_MAP fallback.
    const tradeSourceOverride = relevant
      .map(t => t.conditionSources?.[id])
      .find((s): s is 'COMPUTED' | 'AI' => s === 'COMPUTED' || s === 'AI');
    const source = resolveSource(id, tradeSourceOverride);
    const sourceMultiplier = getSourceMultiplier(id, tradeSourceOverride);
    const effectiveStep = WEIGHT_STEP * sourceMultiplier;

    if (winRate > 0.60) {
      newWeight = parseFloat(Math.min(WEIGHT_MAX, prevWeight + effectiveStep).toFixed(2));
    } else if (winRate < 0.40) {
      newWeight = parseFloat(Math.max(WEIGHT_MIN, prevWeight - effectiveStep).toFixed(2));
    }

    const delta = parseFloat((newWeight - prevWeight).toFixed(2));
    const direction: ConditionCalibration['direction'] =
      delta > 0 ? 'UP' : delta < 0 ? 'DOWN' : 'STABLE';

    updatedWeights[id] = newWeight;

    calibrations.push({
      conditionId: id,
      conditionName: ALL_CONDITIONS[id].name,
      tradeCount: relevant.length,
      winRate,
      avgReturn,
      prevWeight,
      newWeight,
      direction,
      delta,
      source,
      sourceMultiplier,
      // ADR-0022 (PR-E): 가중평균 진단 메타
      rawTradeCount: relevant.length,
      weightedTradeCount: parseFloat(weightedTotal.toFixed(2)),
      lossReasonBreakdown: summarizeLossReasonBreakdown(relevant),
    });
  }

  // ── 가중치 저장 ────────────────────────────────────────────────────────────
  const saveMap: Record<number, number> = {};
  for (const c of calibrations) {
    if (c.newWeight !== c.prevWeight) saveMap[c.conditionId] = c.newWeight;
  }
  if (Object.keys(saveMap).length > 0) {
    saveEvolutionWeights({ ...currentWeights, ...saveMap });
  }

  const boostedCount  = calibrations.filter(c => c.direction === 'UP').length;
  const reducedCount  = calibrations.filter(c => c.direction === 'DOWN').length;
  const lastCalibratedAt = new Date().toISOString();

  const summary = calibrations.length === 0
    ? `${closedCount}건 누적 — 조건별 데이터 부족 (조건당 최소 ${MIN_CONDITION_TRADES}건 필요)`
    : `${closedCount}건 실전 데이터 반영 — 상향 ${boostedCount}개 / 하향 ${reducedCount}개 조건 조정 완료`;

  return {
    closedTradeCount: closedCount,
    calibrationActive: true,
    calibrationProgress: 1,
    calibrations,
    boostedCount,
    reducedCount,
    lastCalibratedAt,
    summary,
  };
}
