// @responsibility weightHistoryRepo 영속화 저장소 모듈
/**
 * weightHistoryRepo.ts — 아이디어 8 (Phase 4): 가중치 스냅샷 히스토리.
 *
 * signalCalibrator.calibrateSignalWeights() 가 조정을 성공적으로 저장할 때마다
 * 해당 시점의 ConditionWeights 스냅샷을 이 파일에 append 한다. 워크포워드
 * 검증이 동결을 발동할 때 DEFAULT 로 리셋하는 대신 최근 N개 스냅샷의 중앙값을
 * 앙상블로 계산하여 임시 가중치로 사용한다 — "과최적화 방지 + 학습 정지 없음".
 *
 * 최대 12개 스냅샷 보관 (1년치). 각 스냅샷은 { timestamp, weights, source }.
 */

import fs from 'fs';
import { WEIGHT_HISTORY_FILE, ensureDataDir } from './paths.js';
import {
  DEFAULT_CONDITION_WEIGHTS,
  type ConditionWeights,
} from '../quantFilter.js';

export interface WeightSnapshot {
  timestamp: string;
  weights:   ConditionWeights;
  /** 'monthly' | 'weekly-lite' | 'incremental' — 저장한 경로 식별자 */
  source:    string;
}

const MAX_SNAPSHOTS = 12;

export function loadWeightHistory(): WeightSnapshot[] {
  ensureDataDir();
  if (!fs.existsSync(WEIGHT_HISTORY_FILE)) return [];
  try {
    return JSON.parse(fs.readFileSync(WEIGHT_HISTORY_FILE, 'utf-8')) as WeightSnapshot[];
  } catch {
    return [];
  }
}

export function appendWeightSnapshot(weights: ConditionWeights, source: string): void {
  ensureDataDir();
  const history = loadWeightHistory();
  history.push({
    timestamp: new Date().toISOString(),
    weights:   { ...DEFAULT_CONDITION_WEIGHTS, ...weights },
    source,
  });
  fs.writeFileSync(
    WEIGHT_HISTORY_FILE,
    JSON.stringify(history.slice(-MAX_SNAPSHOTS), null, 2),
  );
}

/**
 * 최근 N개 스냅샷의 각 키별 중앙값(median)을 계산한다.
 * 스냅샷이 N개 미만이면 null — 호출자가 DEFAULT 로 폴백하도록 한다.
 */
export function computeMedianWeights(lastN = 3): ConditionWeights | null {
  const history = loadWeightHistory();
  if (history.length < lastN) return null;
  const recent = history.slice(-lastN);

  const keys = Object.keys(DEFAULT_CONDITION_WEIGHTS) as Array<keyof ConditionWeights>;
  const out = { ...DEFAULT_CONDITION_WEIGHTS };

  for (const k of keys) {
    const vals = recent
      .map((s) => s.weights[k] ?? DEFAULT_CONDITION_WEIGHTS[k])
      .filter((v): v is number => Number.isFinite(v))
      .sort((a, b) => a - b);
    if (vals.length === 0) continue;
    const mid = Math.floor(vals.length / 2);
    const median = vals.length % 2 === 0
      ? (vals[mid - 1] + vals[mid]) / 2
      : vals[mid];
    out[k] = parseFloat(median.toFixed(3));
  }
  return out;
}
