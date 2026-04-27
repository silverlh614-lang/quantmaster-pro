// @responsibility conditionWeightsRepo 영속화 저장소 모듈
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

/**
 * 레짐별 가중치 초기값 리셋 (아이디어 2 — 레짐 급변 트리거).
 *
 * R2_BULL → R5_CAUTION 같은 2단계 이상 급전환 시, 새 레짐에서는
 * 이전 레짐에서 학습된 가중치가 오히려 유해할 수 있다. "직전 장세의
 * 주도주는 신장세의 주도주가 아니다" 원칙을 가중치 레벨로 실현.
 *
 * @param regime  리셋 대상 레짐 (예: 'R5_CAUTION')
 * @returns 리셋 전 가중치의 서명된 스냅샷 (감사 로그용).
 *          파일이 없었으면 null.
 */
export function resetConditionWeightsForRegime(regime: string): ConditionWeights | null {
  ensureDataDir();
  const file = conditionWeightsRegimeFile(regime);
  let prev: ConditionWeights | null = null;
  if (fs.existsSync(file)) {
    try {
      const raw = JSON.parse(fs.readFileSync(file, 'utf-8')) as Partial<ConditionWeights>;
      prev = { ...DEFAULT_CONDITION_WEIGHTS, ...raw };
    } catch {
      prev = null;
    }
  }
  fs.writeFileSync(file, JSON.stringify({ ...DEFAULT_CONDITION_WEIGHTS }, null, 2));
  return prev;
}
