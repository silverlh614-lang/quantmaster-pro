// @responsibility conditionWeightsRepo 영속화 저장소 모듈
import fs from 'fs';
import { CONDITION_WEIGHTS_FILE, conditionWeightsRegimeFile, conditionWeightsCandidateFile, ensureDataDir } from './paths.js';
import {
  DEFAULT_CONDITION_WEIGHTS,
  type ConditionWeights,
} from '../quantFilter.js';

export type { ConditionWeights };

/**
 * ADR-0581 Phase 2 — 학습 가중치 provider 주입 seam (역의존 방지).
 *
 * 기본 미등록(null) → loadConditionWeights[ByRegime] 는 byte-identical(파일 직독, 기존 동작).
 * learning 레이어가 명시 등록(registerLearnedConditionWeightProvider)할 때만, 그리고 자체적으로
 * flag(LEARNING_WEIGHT_PROMOTION_ENABLED) + governance 승인 + clamp 를 책임진 뒤 유효 가중치(아니면
 * null)를 반환한다. conditionWeightsRepo 는 learning 을 import 하지 않는다.
 * (counterfacture_gate Phase D 의 registerLearnedGate1ThresholdProvider 패턴과 동형.)
 */
export type LearnedConditionWeightProvider = (regime?: string) => Partial<ConditionWeights> | null;
let learnedConditionWeightProvider: LearnedConditionWeightProvider | null = null;
export function registerLearnedConditionWeightProvider(provider: LearnedConditionWeightProvider | null): void {
  learnedConditionWeightProvider = provider;
}

export const CONDITION_WEIGHT_REGIMES = [
  'R1_TURBO',
  'R2_BULL',
  'R3_EARLY',
  'R4_NEUTRAL',
  'R5_CAUTION',
  'R6_DEFENSE',
] as const;
export type ConditionWeightResetScope = 'global' | 'regime' | 'all';

export interface ConditionWeightResetOptions {
  scope?: ConditionWeightResetScope;
  regime?: string;
  backup?: boolean;
  now?: Date;
}

export interface ConditionWeightResetResult {
  scope: ConditionWeightResetScope;
  resetAt: string;
  backupCreated: boolean;
  backupFiles: string[];
  touchedFiles: string[];
  resetGlobal: boolean;
  resetRegimes: string[];
  previousGlobal: ConditionWeights | null;
  previousRegimeWeights: Record<string, ConditionWeights | null>;
  executionImpact: 'NONE';
  liveExecutionAllowed: false;
  shadowLearningImpact: 'NONE';
}

function readConditionWeightsFile(file: string): ConditionWeights | null {
  if (!fs.existsSync(file)) return null;
  try {
    const raw = JSON.parse(fs.readFileSync(file, 'utf-8')) as Partial<ConditionWeights>;
    return { ...DEFAULT_CONDITION_WEIGHTS, ...raw };
  } catch {
    /* SDS-ignore: invalid condition weight JSON is reported as null and reset overwrites with defaults */
    return null;
  }
}

function copyBackupIfPresent(file: string, stamp: string, backup: boolean): string | null {
  if (!backup || !fs.existsSync(file)) return null;
  const backupFile = `${file}.${stamp}.bak`;
  fs.copyFileSync(file, backupFile);
  return backupFile;
}

function resetWeightFile(file: string): void {
  fs.writeFileSync(file, JSON.stringify({ ...DEFAULT_CONDITION_WEIGHTS }, null, 2));
}

function backupStamp(now: Date): string {
  return now.toISOString().replace(/[-:.]/g, '');
}

export function loadConditionWeights(): ConditionWeights {
  // ADR-0581 Phase 2: provider 미등록(기본)이면 undefined → 아래 파일 경로 byte-identical.
  const learned = learnedConditionWeightProvider?.(undefined);
  if (learned) return { ...DEFAULT_CONDITION_WEIGHTS, ...learned };
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

export function getConditionWeightsUpdatedAt(): string | null {
  ensureDataDir();
  if (!fs.existsSync(CONDITION_WEIGHTS_FILE)) return null;
  try {
    return fs.statSync(CONDITION_WEIGHTS_FILE).mtime.toISOString();
  } catch {
    return null;
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
  // ADR-0581 Phase 2: provider 미등록(기본)이면 undefined → 아래 파일 경로 byte-identical.
  const learned = learnedConditionWeightProvider?.(regime);
  if (learned) return { ...DEFAULT_CONDITION_WEIGHTS, ...learned };
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
 * ADR-0581 Phase 1: candidate(shadow) 가중치 read 측.
 * signalCalibrator.persistCandidateWeights 가 쓰는 `condition-weights-${regime}.candidate.json` 을 읽는다.
 * 기존엔 write-only(읽는 데 없음)였던 candidate 레인의 read 진입점 — 승격 후보 평가용.
 * 파일 부재/파싱 실패 시 null. live 스코어링에 직접 쓰이지 않는다(executionImpact=NONE).
 */
export function loadCandidateConditionWeights(regime = 'GLOBAL'): Partial<ConditionWeights> | null {
  ensureDataDir();
  const file = conditionWeightsCandidateFile(regime);
  if (!fs.existsSync(file)) return null;
  try {
    return JSON.parse(fs.readFileSync(file, 'utf-8')) as Partial<ConditionWeights>;
  } catch {
    /* SDS-ignore: invalid candidate weight JSON → null (read-only diagnostic, no live impact) */
    return null;
  }
}

export function resetConditionWeightsToDefault(
  options: ConditionWeightResetOptions = {},
): ConditionWeightResetResult {
  ensureDataDir();
  const scope = options.scope ?? (options.regime ? 'regime' : 'global');
  const now = options.now ?? new Date();
  const resetAt = now.toISOString();
  const stamp = backupStamp(now);
  const backup = options.backup ?? true;
  const result: ConditionWeightResetResult = {
    scope,
    resetAt,
    backupCreated: false,
    backupFiles: [],
    touchedFiles: [],
    resetGlobal: false,
    resetRegimes: [],
    previousGlobal: null,
    previousRegimeWeights: {},
    executionImpact: 'NONE',
    liveExecutionAllowed: false,
    shadowLearningImpact: 'NONE',
  };

  if (scope === 'global' || scope === 'all') {
    result.previousGlobal = readConditionWeightsFile(CONDITION_WEIGHTS_FILE);
    const backupFile = copyBackupIfPresent(CONDITION_WEIGHTS_FILE, stamp, backup);
    if (backupFile) result.backupFiles.push(backupFile);
    resetWeightFile(CONDITION_WEIGHTS_FILE);
    result.touchedFiles.push(CONDITION_WEIGHTS_FILE);
    result.resetGlobal = true;
  }

  if (scope === 'regime' || scope === 'all') {
    const regimes = scope === 'all' ? [...CONDITION_WEIGHT_REGIMES] : [options.regime];
    for (const regime of regimes) {
      if (!regime) throw new Error('regime is required when resetting condition weights by regime');
      const file = conditionWeightsRegimeFile(regime);
      result.previousRegimeWeights[regime] = readConditionWeightsFile(file);
      const backupFile = copyBackupIfPresent(file, stamp, backup);
      if (backupFile) result.backupFiles.push(backupFile);
      resetWeightFile(file);
      result.touchedFiles.push(file);
      result.resetRegimes.push(regime);
    }
  }

  result.backupCreated = result.backupFiles.length > 0;
  return result;
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
