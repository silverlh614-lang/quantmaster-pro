/**
 * regimeAwareCalibrator.ts — 아이디어 1: 레짐별 독립 가중치 자기진화
 *
 * 기존 signalCalibrator는 전체 데이터를 하나의 가중치 파일로 조정한다.
 * R1 TURBO 장세에서 유효했던 조건이 R5 CAUTION에서는 허위 신호가 될 수 있으므로
 * 레짐별로 추천 이력을 분리하여 독립적인 가중치 파일을 생성·관리한다.
 *
 * 파일 네이밍: data/condition-weights-{REGIME}.json
 *   예: condition-weights-R2_BULL.json
 *
 * 의존성:
 *   - RecommendationRecord.entryRegime (signalScanner에서 저장)
 *   - loadConditionWeightsByRegime / saveConditionWeightsByRegime (conditionWeightsRepo)
 *   - timeWeight / calcConditionSharpe (signalCalibrator — 공유 유틸)
 */

import { getRecommendations } from './recommendationTracker.js';
import {
  loadConditionWeightsByRegime,
  saveConditionWeightsByRegime,
  type ConditionWeights,
} from '../persistence/conditionWeightsRepo.js';
import { sendTelegramAlert } from '../alerts/telegramClient.js';
import { timeWeight, calcConditionSharpe, latePenaltyForServerKey } from './signalCalibrator.js';

/** R6_DEFENSE 포함 전체 레짐 레벨 */
const ALL_REGIMES = [
  'R1_TURBO',
  'R2_BULL',
  'R3_EARLY',
  'R4_NEUTRAL',
  'R5_CAUTION',
  'R6_DEFENSE',
] as const;

/** 레짐별 최소 유효 샘플 수 (전역 캘리브레이터의 절반 — 레짐별 데이터가 적으므로) */
const MIN_SAMPLES = 5;

const WEIGHT_MIN = 0.3;
const WEIGHT_MAX = 1.8;

/**
 * 전체 추천 이력에서 레짐별로 분리하여 독립 가중치를 보정한다.
 * 월말 calibrateSignalWeights() 이후 순차 호출 권장.
 */
export async function calibrateByRegime(): Promise<void> {
  const allRecs = getRecommendations().filter(
    (r) =>
      r.status !== 'PENDING' &&
      r.conditionKeys && r.conditionKeys.length > 0 &&
      r.entryRegime,
  );

  if (allRecs.length === 0) {
    console.log('[RegimeCalibrator] 레짐 정보가 있는 결산 데이터 없음 — 건너뜀');
    return;
  }

  const summaryLines: string[] = [];

  for (const regime of ALL_REGIMES) {
    const regimeRecs = allRecs.filter((r) => r.entryRegime === regime);

    if (regimeRecs.length < MIN_SAMPLES) {
      console.log(
        `[RegimeCalibrator] ${regime}: 데이터 부족 (${regimeRecs.length}건 < ${MIN_SAMPLES}) — 건너뜀`,
      );
      continue;
    }

    // 조건별 시간 가중 WIN 집계 + 수익률 배열
    const condStats: Record<string, { wWins: number; wTotal: number; returns: number[] }> = {};

    for (const rec of regimeRecs) {
      // 아이디어 4 (Phase 2): 현재 처리 중인 레짐의 반감기로 시간 감쇠 조정.
      // R1_TURBO는 30일, R6_DEFENSE는 90일 — 시장 속도에 학습 속도 동기화.
      const tw = timeWeight(rec.signalTime, regime);
      for (const key of rec.conditionKeys ?? []) {
        if (!condStats[key]) condStats[key] = { wWins: 0, wTotal: 0, returns: [] };
        condStats[key].wTotal += tw;
        // 아이디어 5 (Phase 3): LATE_WIN × 타이밍 조건 시 WIN 기여를 0.7× 페널티.
        if (rec.status === 'WIN') {
          condStats[key].wWins += tw * latePenaltyForServerKey(rec.lateWin, key);
        }
        if (rec.actualReturn !== undefined) condStats[key].returns.push(rec.actualReturn);
      }
    }

    // 해당 레짐 전용 가중치 로드 (없으면 전역 폴백)
    const weights = loadConditionWeightsByRegime(regime);
    const adjustments: string[] = [];

    for (const [key, stat] of Object.entries(condStats)) {
      if (stat.wTotal < 0.5) continue; // 유효 기여 없음

      const winRate = stat.wWins / stat.wTotal;
      const sharpe  = calcConditionSharpe(stat.returns);
      const prev    = (weights as Record<string, number>)[key] ?? 1.0;

      let next = prev;

      if (sharpe > 1.0 || winRate > 0.65) {
        next = parseFloat(Math.min(WEIGHT_MAX, prev * 1.1).toFixed(2));
      } else if (sharpe < 0.3 || winRate < 0.40) {
        next = parseFloat(Math.max(WEIGHT_MIN, prev * 0.9).toFixed(2));
      }

      if (next !== prev) {
        (weights as Record<string, number>)[key] = next;
        adjustments.push(
          `${key}: ${prev.toFixed(2)}→${next} ` +
          `(WR:${(winRate * 100).toFixed(0)}% SR:${sharpe.toFixed(2)})`,
        );
      }
    }

    if (adjustments.length > 0) {
      saveConditionWeightsByRegime(regime, weights as ConditionWeights);
      const line = `[${regime}] ${regimeRecs.length}건 — ${adjustments.join(' | ')}`;
      summaryLines.push(line);
      console.log(`[RegimeCalibrator] ${line}`);
    } else {
      console.log(
        `[RegimeCalibrator] ${regime}: 변경 없음 (${regimeRecs.length}건)`,
      );
    }
  }

  if (summaryLines.length > 0) {
    await sendTelegramAlert(
      `🧬 <b>[RegimeCalibrator] 레짐별 가중치 자기진화</b>\n\n` +
      summaryLines.join('\n') +
      `\n\n<i>각 레짐 전용 파일: condition-weights-{REGIME}.json</i>`,
    ).catch(console.error);
  } else {
    console.log('[RegimeCalibrator] 모든 레짐 가중치 변경 없음');
  }
}
