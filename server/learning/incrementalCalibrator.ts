/**
 * incrementalCalibrator.ts — 증분/경량 캘리브레이션 (아이디어 2)
 *
 * 월간 calibrateSignalWeights()는 전체 Attribution Record를 O(n×27)로 재분석한다.
 * 신규 결산 1~2건마다 전체를 재연산하는 것은 낭비이므로, 다음 3종의 경량 경로를
 * 이 모듈에서 제공한다.
 *
 *   1. runIncrementalCalibration(record)  — 단일 결산 레코드 온라인 학습
 *   2. calibrateSignalWeightsLite()        — 전주 레코드만 ±5% 제한 재보정
 *   3. calibrateByRegimeSingle(regime)     — 특정 레짐 하나만 즉시 재보정
 *
 * 워크포워드 동결 상태에서는 모두 건너뛴다.
 */

import {
  loadConditionWeights,
  saveConditionWeights,
  loadConditionWeightsByRegime,
  saveConditionWeightsByRegime,
} from '../persistence/conditionWeightsRepo.js';
import {
  loadAttributionRecords,
  type ServerAttributionRecord,
} from '../persistence/attributionRepo.js';
import { serverConditionKey } from './attributionAnalyzer.js';
import { loadWalkForwardState } from './walkForwardValidator.js';
import { getRecommendations } from './recommendationTracker.js';
import {
  timeWeight,
  calcConditionSharpe,
  latePenaltyForServerKey,
} from './signalCalibrator.js';
import { markCalibRan } from './learningState.js';

const WEIGHT_MIN = 0.3;
const WEIGHT_MAX = 1.8;

function clamp(v: number, lo: number, hi: number): number {
  return Math.max(lo, Math.min(hi, v));
}

/**
 * 단일 결산 레코드를 기존 가중치에 반영 (아이디어 2 — Online Learning).
 * WIN 이면 해당 conditionScore에 비례해 +learningRate, LOSS 이면 -learningRate.
 * 건당 최대 2% 조정 (월간의 1/7 정도).
 */
export async function runIncrementalCalibration(
  newRecord: ServerAttributionRecord,
): Promise<void> {
  if (loadWalkForwardState()) {
    console.log('[IncrementalCalib] 워크포워드 동결 중 — 스킵');
    return;
  }

  const weights = loadConditionWeights();
  const learningRate = 0.02;
  const direction = newRecord.isWin ? +1 : -1;
  let adjusted = 0;

  for (const [conditionIdStr, score] of Object.entries(newRecord.conditionScores ?? {})) {
    const key = serverConditionKey(Number(conditionIdStr));
    if (!key) continue;

    const scoreNorm = Math.max(0, Math.min(1, Number(score) / 10));
    // 아이디어 5 (Phase 3): LATE_WIN 시 타이밍 조건 기여를 감쇠.
    const penalty   = direction > 0 ? latePenaltyForServerKey(newRecord.lateWin, key) : 1.0;
    const delta     = learningRate * direction * scoreNorm * penalty;
    const prev      = (weights as Record<string, number>)[key] ?? 1.0;
    const next      = clamp(prev + delta, WEIGHT_MIN, WEIGHT_MAX);

    if (Math.abs(next - prev) > 0.005) {
      (weights as Record<string, number>)[key] = parseFloat(next.toFixed(3));
      adjusted++;
    }
  }

  if (adjusted > 0) {
    saveConditionWeights(weights);
    markCalibRan();
    console.log(
      `[IncrementalCalib] ${newRecord.stockCode} ${newRecord.isWin ? 'WIN' : 'LOSS'} ` +
      `→ ${adjusted}개 키 ±${(learningRate * 100).toFixed(1)}% 범위 조정`,
    );
  }
}

/**
 * 경량 주간 캘리브레이션 (아이디어 1 / L3).
 * 최근 7일 결산 AttributionRecord 만 대상으로, 가중치 변화를 ±5%로 제한.
 * 월간 calibrateSignalWeights()의 경량 버전.
 */
export async function calibrateSignalWeightsLite(): Promise<void> {
  if (loadWalkForwardState()) {
    console.log('[CalibLite] 워크포워드 동결 중 — 스킵');
    return;
  }

  const cutoff = Date.now() - 7 * 86_400_000;
  const recent = loadAttributionRecords().filter(
    (r) => new Date(r.closedAt).getTime() >= cutoff,
  );

  if (recent.length < 5) {
    console.log(`[CalibLite] 전주 결산 ${recent.length}건 < 5 — 스킵`);
    return;
  }

  const weights = loadConditionWeights();
  // conditionKey → 누적 (WIN 가중 / 전체 가중) 집계
  const agg: Record<string, { wWin: number; wTotal: number }> = {};

  for (const rec of recent) {
    for (const [conditionIdStr, score] of Object.entries(rec.conditionScores ?? {})) {
      const key = serverConditionKey(Number(conditionIdStr));
      if (!key) continue;
      const s = Math.max(0, Math.min(1, Number(score) / 10));
      if (s < 0.5) continue; // 저점수 조건은 가중치 신호로 보지 않음
      if (!agg[key]) agg[key] = { wWin: 0, wTotal: 0 };
      agg[key].wTotal += s;
      // 아이디어 5 (Phase 3): lateWin × 타이밍 조건 WIN 기여 0.7× 감쇠
      if (rec.isWin) agg[key].wWin += s * latePenaltyForServerKey(rec.lateWin, key);
    }
  }

  const MAX_STEP = 0.05; // 건당 최대 ±5%
  const adjustments: string[] = [];

  for (const [key, st] of Object.entries(agg)) {
    if (st.wTotal < 1.0) continue;
    const winRate = st.wWin / st.wTotal;
    const prev    = (weights as Record<string, number>)[key] ?? 1.0;

    let scale = 1.0;
    if (winRate >= 0.6)      scale = 1 + MAX_STEP;
    else if (winRate <= 0.4) scale = 1 - MAX_STEP;
    else continue;

    const next = clamp(prev * scale, WEIGHT_MIN, WEIGHT_MAX);
    if (Math.abs(next - prev) > 0.01) {
      (weights as Record<string, number>)[key] = parseFloat(next.toFixed(2));
      adjustments.push(`${key}: ${prev.toFixed(2)}→${next.toFixed(2)} (WR ${(winRate * 100).toFixed(0)}%)`);
    }
  }

  if (adjustments.length > 0) {
    saveConditionWeights(weights);
    markCalibRan();
    console.log(`[CalibLite] 전주 ${recent.length}건 기반 ${adjustments.length}건 조정: ${adjustments.join(' | ')}`);
  } else {
    console.log(`[CalibLite] 전주 ${recent.length}건 — 조정 없음`);
  }
}

/**
 * 특정 레짐 하나의 가중치만 즉시 재보정 (아이디어 5).
 * macroSectorSync에서 레짐 전환 감지 시 신규 레짐만 대상으로 호출된다.
 */
export async function calibrateByRegimeSingle(targetRegime: string): Promise<void> {
  if (loadWalkForwardState()) {
    console.log(`[RegimeCalibSingle:${targetRegime}] 워크포워드 동결 중 — 스킵`);
    return;
  }

  const recs = getRecommendations().filter(
    (r) =>
      r.status !== 'PENDING' &&
      r.entryRegime === targetRegime &&
      r.conditionKeys && r.conditionKeys.length > 0,
  );

  if (recs.length < 5) {
    console.log(`[RegimeCalibSingle:${targetRegime}] 결산 ${recs.length}건 < 5 — 스킵`);
    return;
  }

  const weights = loadConditionWeightsByRegime(targetRegime);
  const condStats: Record<string, { wWins: number; wTotal: number; returns: number[] }> = {};

  for (const rec of recs) {
    // 아이디어 4 (Phase 2): 레짐별 반감기로 적응형 감쇠 — 단일 레짐 캘리브.
    const tw = timeWeight(rec.signalTime, targetRegime);
    for (const key of rec.conditionKeys ?? []) {
      if (!condStats[key]) condStats[key] = { wWins: 0, wTotal: 0, returns: [] };
      condStats[key].wTotal += tw;
      if (rec.status === 'WIN') condStats[key].wWins += tw;
      if (rec.actualReturn !== undefined) condStats[key].returns.push(rec.actualReturn);
    }
  }

  const adjustments: string[] = [];
  for (const [key, st] of Object.entries(condStats)) {
    if (st.wTotal < 0.5) continue;
    const winRate = st.wWins / st.wTotal;
    const sharpe  = calcConditionSharpe(st.returns);
    const prev    = (weights as Record<string, number>)[key] ?? 1.0;
    let next = prev;

    if (sharpe > 1.0 || winRate > 0.65) {
      next = parseFloat(clamp(prev * 1.1, WEIGHT_MIN, WEIGHT_MAX).toFixed(2));
    } else if (sharpe < 0.3 || winRate < 0.40) {
      next = parseFloat(clamp(prev * 0.9, WEIGHT_MIN, WEIGHT_MAX).toFixed(2));
    }

    if (next !== prev) {
      (weights as Record<string, number>)[key] = next;
      adjustments.push(`${key}: ${prev.toFixed(2)}→${next} (WR ${(winRate * 100).toFixed(0)}% SR ${sharpe.toFixed(2)})`);
    }
  }

  if (adjustments.length > 0) {
    saveConditionWeightsByRegime(targetRegime, weights);
    console.log(`[RegimeCalibSingle:${targetRegime}] ${recs.length}건 — ${adjustments.join(' | ')}`);
  } else {
    console.log(`[RegimeCalibSingle:${targetRegime}] ${recs.length}건 — 변경 없음`);
  }
}
