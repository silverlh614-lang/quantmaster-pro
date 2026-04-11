import fs from 'fs';
import { CONDITION_WEIGHTS_FILE, ensureDataDir } from './paths.js';
import {
  DEFAULT_CONDITION_WEIGHTS,
  type ConditionWeights,
} from '../serverQuantFilter.js';

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
