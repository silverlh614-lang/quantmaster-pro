/**
 * learningState.ts — 4티어 자기학습 주기의 공유 상태 저장소
 *
 * L1(실시간) / L2(일중) / L3(주간) / L4(월간) 티어별 마지막 실행 타임스탬프,
 * 레짐 전환 감지를 위한 이전 레짐 스냅샷, 연속 LOSS 거래 홀드 만료 시각,
 * 첫 캘리브레이션 완료 플래그를 단일 JSON 파일로 관리한다.
 *
 * learningOrchestrator / scheduler health-check / macroSectorSync / exitEngine
 * 모두 이 모듈을 통해 상태를 읽고 쓴다.
 */

import fs from 'fs';
import { LEARNING_STATE_FILE, ensureDataDir } from '../persistence/paths.js';

export type LearningTier = 'L1_REALTIME' | 'L2_DAILY' | 'L3_WEEKLY' | 'L4_MONTHLY';

export interface LearningState {
  /** 티어별 마지막 실행 시각 ISO (없으면 미실행) */
  lastRunAt: Partial<Record<LearningTier, string>>;
  /** 마지막 evaluateRecommendations() 실행 시각 ISO */
  lastEvalAt: string | null;
  /** 마지막 calibrateSignalWeights() 실행 시각 ISO */
  lastCalibAt: string | null;
  /** 마지막으로 관찰된 레짐 (전환 감지용) */
  prevRegime: string | null;
  /** true면 Resolution 10건 돌파 초기 캘리브레이션이 실행됨 */
  firstCalibrationDone: boolean;
  /** 연속 LOSS 실시간 감지로 설정된 신규 진입 홀드 만료 시각 ISO (null = 홀드 없음) */
  tradingHoldUntil: string | null;
}

const DEFAULT_STATE: LearningState = {
  lastRunAt:            {},
  lastEvalAt:           null,
  lastCalibAt:          null,
  prevRegime:           null,
  firstCalibrationDone: false,
  tradingHoldUntil:     null,
};

function loadState(): LearningState {
  ensureDataDir();
  if (!fs.existsSync(LEARNING_STATE_FILE)) return { ...DEFAULT_STATE };
  try {
    const raw = JSON.parse(fs.readFileSync(LEARNING_STATE_FILE, 'utf-8')) as Partial<LearningState>;
    return { ...DEFAULT_STATE, ...raw, lastRunAt: { ...(raw.lastRunAt ?? {}) } };
  } catch {
    return { ...DEFAULT_STATE };
  }
}

function saveState(state: LearningState): void {
  ensureDataDir();
  fs.writeFileSync(LEARNING_STATE_FILE, JSON.stringify(state, null, 2));
}

export function loadLearningState(): LearningState {
  return loadState();
}

export function markTierRan(tier: LearningTier): void {
  const state = loadState();
  state.lastRunAt[tier] = new Date().toISOString();
  saveState(state);
}

export function markEvalRan(): void {
  const state = loadState();
  state.lastEvalAt = new Date().toISOString();
  saveState(state);
}

export function markCalibRan(): void {
  const state = loadState();
  state.lastCalibAt = new Date().toISOString();
  saveState(state);
}

export function loadPrevRegime(): string | null {
  return loadState().prevRegime;
}

export function savePrevRegime(regime: string): void {
  const state = loadState();
  state.prevRegime = regime;
  saveState(state);
}

export function isFirstCalibrationDone(): boolean {
  return loadState().firstCalibrationDone;
}

export function markFirstCalibrationDone(): void {
  const state = loadState();
  state.firstCalibrationDone = true;
  saveState(state);
}

/**
 * 연속 LOSS 실시간 감지 등으로 신규 진입을 일시 차단한다.
 * 이미 설정된 홀드보다 짧게 덮어쓰지 않는다 (기존 홀드 유지).
 */
export function setTradingHold(durationMs: number): void {
  const state = loadState();
  const next = Date.now() + durationMs;
  const curr = state.tradingHoldUntil ? new Date(state.tradingHoldUntil).getTime() : 0;
  if (next > curr) {
    state.tradingHoldUntil = new Date(next).toISOString();
    saveState(state);
  }
}

export function isTradingHeld(): boolean {
  const state = loadState();
  if (!state.tradingHoldUntil) return false;
  return Date.now() < new Date(state.tradingHoldUntil).getTime();
}

export function clearTradingHold(): void {
  const state = loadState();
  state.tradingHoldUntil = null;
  saveState(state);
}
