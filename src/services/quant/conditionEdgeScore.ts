/**
 * @responsibility 조건별 Profit Factor / Edge Score 계산 — 단일 승률 한계 보완 (ADR-0023)
 *
 * winRate / avgReturn 만으로는 "승률 70%지만 손익비 나쁜 조건" vs "승률 45%지만
 * 손익비 좋은 조건" 을 구분 못 함. Profit Factor + 가중평균 손익률 + 종합
 * Edge Score 로 진단 정밀도를 확장한다. PR-E 의 trade-level multiplier 동일 적용.
 */
import type { TradeRecord } from '../../types/portfolio';
import { getTradeLearningWeight } from './lossReasonWeighting';

export interface ConditionEdgeStats {
  profitFactor: number | null;
  avgReturnPosi: number;
  avgReturnNeg: number;
  edgeScore: number;
}

const clamp = (v: number, min: number, max: number) => Math.min(max, Math.max(min, v));

/**
 * relevant trades (해당 조건 ≥ 5점) 에 대해 Profit Factor + 가중 양/음 평균 +
 * Edge Score 계산.
 *
 * Profit Factor: sum(wins × weight × returnPct) / |sum(losses × weight × returnPct)|.
 *   - losses 0 이면 null (정의 불가).
 *
 * Edge Score 공식:
 *   edge = (winRate - 0.5) × 4
 *        + clamp(avgReturn, -5, +5) × 0.4
 *        + clamp((profitFactor ?? 1) - 1, -2, +2) × 1.0
 *        - clamp(|avgReturnNeg|, 0, 15) × 0.2
 *   범위: -7 ~ +7. 양수 = 가중치 상향 정당화.
 */
export function computeConditionEdge(
  relevant: TradeRecord[],
  winRate: number,
  avgReturn: number,
): ConditionEdgeStats {
  let weightedWinReturn = 0;
  let weightedLossReturn = 0;
  let winWeightSum = 0;
  let lossWeightSum = 0;

  for (const t of relevant) {
    const ret = t.returnPct ?? 0;
    if (!Number.isFinite(ret)) continue;
    const w = getTradeLearningWeight(t);
    if (ret > 0) {
      weightedWinReturn += ret * w;
      winWeightSum += w;
    } else if (ret < 0) {
      weightedLossReturn += Math.abs(ret) * w;
      lossWeightSum += w;
    }
  }

  const profitFactor = lossWeightSum > 0 && weightedLossReturn > 0
    ? weightedWinReturn / weightedLossReturn
    : (weightedWinReturn > 0 ? null : null);

  const avgReturnPosi = winWeightSum > 0 ? weightedWinReturn / winWeightSum : 0;
  const avgReturnNeg = lossWeightSum > 0 ? -weightedLossReturn / lossWeightSum : 0;

  // Edge Score 합산
  const winRateScore = (winRate - 0.5) * 4;                              // -2 ~ +2
  const avgReturnScore = clamp(avgReturn, -5, 5) * 0.4;                  // -2 ~ +2
  const pfBase = profitFactor ?? 1;
  const pfScore = clamp(pfBase - 1, -2, 2) * 1.0;                        // -2 ~ +2
  const mddPenalty = clamp(Math.abs(avgReturnNeg), 0, 15) * 0.2;         // 0 ~ -3

  const edgeScore = winRateScore + avgReturnScore + pfScore - mddPenalty;

  return {
    profitFactor: profitFactor !== null ? Number(profitFactor.toFixed(3)) : null,
    avgReturnPosi: Number(avgReturnPosi.toFixed(2)),
    avgReturnNeg: Number(avgReturnNeg.toFixed(2)),
    edgeScore: Number(edgeScore.toFixed(2)),
  };
}
