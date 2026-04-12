import fs from 'fs';
import { CONDITION_WEIGHTS_FILE, conditionWeightsRegimeFile, ensureDataDir } from './paths.js';
import {
  DEFAULT_CONDITION_WEIGHTS,
  type ConditionWeights,
} from '../quantFilter.js';

export type { ConditionWeights };

export function loadConditionWeights(): ConditionWeights {
  ensureDataDir();
  if (!fs.existsSync(CONDITION_WEIGHTS_FILE)) return { ...DEFAULT_CONDITION_WEIGHTS };
  try {
    const raw = JSON.parse(fs.readFileSync(CONDITION_WEIGHTS_FILE, 'utf-8')) as Partial<ConditionWeights>;
    // 누락된 키는 기본값 1.0으로 채움
    return { ...DEFAULT_CONDITION_WEIGHTS, ...raw };
  } catch {
    return { ...DEFAULT_CONDITION_WEIGHTS };
  }
}

export function saveConditionWeights(w: ConditionWeights): void {
  ensureDataDir();
  fs.writeFileSync(CONDITION_WEIGHTS_FILE, JSON.stringify(w, null, 2));
}

/**
 * 레짐별 독립 가중치 로드 (아이디어 1 — Regime-Aware Calibration).
 * 해당 레짐의 파일이 없으면 전역 가중치를 폴백으로 반환.
 */
export function loadConditionWeightsByRegime(regime: string): ConditionWeights {
  ensureDataDir();
  const file = conditionWeightsRegimeFile(regime);
  if (!fs.existsSync(file)) return loadConditionWeights(); // 전역 폴백
  try {
    const raw = JSON.parse(fs.readFileSync(file, 'utf-8')) as Partial<ConditionWeights>;
    return { ...DEFAULT_CONDITION_WEIGHTS, ...raw };
  } catch {
    return loadConditionWeights();
  }
}

/**
 * 레짐별 독립 가중치 저장.
 */
export function saveConditionWeightsByRegime(regime: string, w: ConditionWeights): void {
  ensureDataDir();
  fs.writeFileSync(conditionWeightsRegimeFile(regime), JSON.stringify(w, null, 2));
}
