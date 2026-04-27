// @responsibility F2W 가중치 σ 변화 감시 — drift 감지 시 LIVE 학습 일시정지
/**
 * f2wDriftDetector.ts — F2W (Feedback-to-Weight) drift 감시 메타 회로 (ADR-0046)
 *
 * 사용자 원안: "변화는 영양이지만 변화의 변화는 독."
 *
 * 동작:
 *   1. 매 학습 사이클마다 `recordWeightSnapshot()` 으로 가중치 σ 영속 누적
 *   2. `evaluateDrift()` 가 sigma7d ≥ sigma30dAvg × 2 판정
 *   3. drift 시 `pauseF2W()` 가 LIVE saveEvolutionWeights 차단 flag 설정
 *   4. 7일 TTL 자동 해제 + 운영자 수동 해제 (`clearF2WPause()`) 가능
 *
 * 외부 의존성 0 — feedbackLoopEngine 만 import 함.
 */

import type { ConditionId } from '../../types/core';

// ─── 영속 키 ──────────────────────────────────────────────────────────────────

const HISTORY_KEY = 'k-stock-f2w-weight-history';
const PAUSE_KEY = 'k-stock-f2w-pause-state';

/** 히스토리 ring buffer 최대 보존 일수 */
const HISTORY_MAX_DAYS = 90;

/** drift 판정에 필요한 최소 30일 윈도우 표본 수 (false positive 차단) */
const MIN_SAMPLES_FOR_DRIFT = 5;

/** drift 임계 — 사용자 원안 그대로 ×2 */
const DRIFT_RATIO_THRESHOLD = 2.0;

/** pause TTL (일) — 시장 국면 전환 평균 기간 */
const PAUSE_TTL_DAYS = 7;

const DAY_MS = 24 * 60 * 60 * 1000;

// ─── 타입 ────────────────────────────────────────────────────────────────────

export interface WeightHistorySnapshot {
  capturedAt: string;
  sigma: number;
  weights: Record<ConditionId, number>;
}

export interface DriftEvaluation {
  drifted: boolean;
  sigma7d: number;
  sigma30dAvg: number;
  ratio: number;
  sampleCount30d: number;
  reason?: string;
}

export interface F2WPauseState {
  pausedAt: string;
  pausedUntil: string;
  reason: string;
  ratio: number;
}

export interface ConditionDeviation {
  conditionId: ConditionId;
  weight: number;
  deviation: number;
}

// ─── 환경 가드 ────────────────────────────────────────────────────────────────

function isDisabled(): boolean {
  if (typeof process === 'undefined' || !process.env) return false;
  return process.env.LEARNING_F2W_DRIFT_DISABLED === 'true';
}

function lsGet(key: string): string | null {
  if (typeof localStorage === 'undefined') return null;
  try {
    return localStorage.getItem(key);
  } catch {
    return null;
  }
}

function lsSet(key: string, value: string): void {
  if (typeof localStorage === 'undefined') return;
  try {
    localStorage.setItem(key, value);
  } catch {
    // storage quota 등 실패는 무시 — drift 감지가 학습을 막지 않음
  }
}

function lsRemove(key: string): void {
  if (typeof localStorage === 'undefined') return;
  try {
    localStorage.removeItem(key);
  } catch {
    // ignore
  }
}

// ─── 통계 ────────────────────────────────────────────────────────────────────

/**
 * 가중치 분포의 표준편차(σ).
 *
 * 입력 변화에 강건:
 *   - 빈 입력 → 0
 *   - 단일 값 → 0
 *   - NaN/Infinity 제외 후 계산
 */
export function computeWeightStdDev(weights: Record<number, number>): number {
  const values = Object.values(weights).filter(
    (v): v is number => typeof v === 'number' && Number.isFinite(v),
  );
  if (values.length < 2) return 0;
  const mean = values.reduce((s, v) => s + v, 0) / values.length;
  const variance = values.reduce((s, v) => s + (v - mean) ** 2, 0) / values.length;
  return Math.sqrt(variance);
}

// ─── 히스토리 영속 ───────────────────────────────────────────────────────────

export function loadWeightHistory(): WeightHistorySnapshot[] {
  const raw = lsGet(HISTORY_KEY);
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw) as unknown;
    if (!Array.isArray(parsed)) return [];
    const result: WeightHistorySnapshot[] = [];
    for (const item of parsed) {
      if (
        item &&
        typeof item === 'object' &&
        typeof (item as WeightHistorySnapshot).capturedAt === 'string' &&
        typeof (item as WeightHistorySnapshot).sigma === 'number' &&
        Number.isFinite((item as WeightHistorySnapshot).sigma) &&
        (item as WeightHistorySnapshot).weights &&
        typeof (item as WeightHistorySnapshot).weights === 'object'
      ) {
        result.push(item as WeightHistorySnapshot);
      }
    }
    return result;
  } catch {
    return [];
  }
}

function saveWeightHistory(history: WeightHistorySnapshot[]): void {
  lsSet(HISTORY_KEY, JSON.stringify(history));
}

/**
 * 학습 사이클마다 호출 — 히스토리에 1건 추가 + 90일 ring buffer trim.
 *
 * 동일 capturedAt 중복 방지: 마지막 항목이 같은 분(minute) 이면 덮어쓰기.
 */
export function recordWeightSnapshot(
  weights: Record<number, number>,
  now: Date = new Date(),
): WeightHistorySnapshot {
  const sigma = computeWeightStdDev(weights);
  const snapshot: WeightHistorySnapshot = {
    capturedAt: now.toISOString(),
    sigma,
    weights: { ...weights },
  };

  const history = loadWeightHistory();
  // 90일 이전 trim
  const cutoff = now.getTime() - HISTORY_MAX_DAYS * DAY_MS;
  const trimmed = history.filter(s => {
    const t = new Date(s.capturedAt).getTime();
    return Number.isFinite(t) && t >= cutoff;
  });

  trimmed.push(snapshot);
  saveWeightHistory(trimmed);
  return snapshot;
}

// ─── drift 판정 ──────────────────────────────────────────────────────────────

/**
 * 사용자 원안 그대로:
 *   drifted = sigma7d ≥ sigma30dAvg × 2
 *
 * 표본 가드:
 *   - 30일 윈도우 표본 < MIN_SAMPLES_FOR_DRIFT → drifted=false
 *   - 7일 윈도우 표본 = 0 → drifted=false
 *   - sigma30dAvg = 0 → drifted=false (분모 0 fallback)
 *   - LEARNING_F2W_DRIFT_DISABLED 환경 → 항상 drifted=false
 */
export function evaluateDrift(
  history: WeightHistorySnapshot[],
  now: Date = new Date(),
): DriftEvaluation {
  if (isDisabled()) {
    return {
      drifted: false,
      sigma7d: 0,
      sigma30dAvg: 0,
      ratio: 0,
      sampleCount30d: 0,
      reason: 'LEARNING_F2W_DRIFT_DISABLED',
    };
  }

  const nowMs = now.getTime();
  const w7Cutoff = nowMs - 7 * DAY_MS;
  const w30Cutoff = nowMs - 30 * DAY_MS;

  const window7 = history.filter(s => {
    const t = new Date(s.capturedAt).getTime();
    return Number.isFinite(t) && t >= w7Cutoff && t <= nowMs;
  });
  const window30 = history.filter(s => {
    const t = new Date(s.capturedAt).getTime();
    return Number.isFinite(t) && t >= w30Cutoff && t <= nowMs;
  });

  const sampleCount30d = window30.length;

  if (window7.length === 0) {
    return {
      drifted: false,
      sigma7d: 0,
      sigma30dAvg: 0,
      ratio: 0,
      sampleCount30d,
      reason: '7일 표본 부재',
    };
  }
  if (sampleCount30d < MIN_SAMPLES_FOR_DRIFT) {
    return {
      drifted: false,
      sigma7d: 0,
      sigma30dAvg: 0,
      ratio: 0,
      sampleCount30d,
      reason: `30일 표본 부족 (${sampleCount30d} < ${MIN_SAMPLES_FOR_DRIFT})`,
    };
  }

  const sigma7d = window7.reduce((s, snap) => s + snap.sigma, 0) / window7.length;
  const sigma30dAvg = window30.reduce((s, snap) => s + snap.sigma, 0) / window30.length;

  if (sigma30dAvg === 0) {
    return {
      drifted: false,
      sigma7d,
      sigma30dAvg,
      ratio: 0,
      sampleCount30d,
      reason: '30일 평균 σ = 0 (가중치 변동 없음)',
    };
  }

  const ratio = sigma7d / sigma30dAvg;
  const drifted = ratio >= DRIFT_RATIO_THRESHOLD;

  return {
    drifted,
    sigma7d: Number(sigma7d.toFixed(4)),
    sigma30dAvg: Number(sigma30dAvg.toFixed(4)),
    ratio: Number(ratio.toFixed(3)),
    sampleCount30d,
    reason: drifted
      ? `σ7d (${sigma7d.toFixed(4)}) ≥ σ30d (${sigma30dAvg.toFixed(4)}) × 2`
      : undefined,
  };
}

// ─── pause 영속 ──────────────────────────────────────────────────────────────

/**
 * 활성 pause 가 있으면 만료 시각을 Date 로 반환, 없거나 만료됐으면 null.
 *
 * 만료된 pause 는 자동으로 localStorage 에서 제거.
 */
export function isF2WPausedUntil(now: Date = new Date()): Date | null {
  const raw = lsGet(PAUSE_KEY);
  if (!raw) return null;
  try {
    const state = JSON.parse(raw) as F2WPauseState;
    const until = new Date(state.pausedUntil);
    if (!Number.isFinite(until.getTime())) {
      lsRemove(PAUSE_KEY);
      return null;
    }
    if (until.getTime() <= now.getTime()) {
      lsRemove(PAUSE_KEY);
      return null;
    }
    return until;
  } catch {
    lsRemove(PAUSE_KEY);
    return null;
  }
}

export function getF2WPauseState(now: Date = new Date()): F2WPauseState | null {
  const raw = lsGet(PAUSE_KEY);
  if (!raw) return null;
  try {
    const state = JSON.parse(raw) as F2WPauseState;
    const until = new Date(state.pausedUntil);
    if (!Number.isFinite(until.getTime()) || until.getTime() <= now.getTime()) {
      lsRemove(PAUSE_KEY);
      return null;
    }
    return state;
  } catch {
    lsRemove(PAUSE_KEY);
    return null;
  }
}

/**
 * F2W 일시정지 flag 설정. TTL 7일 자동 만료.
 *
 * @param reason drift 판정 사유 (텔레그램 메시지 + 로그 표기)
 * @param ratio sigma7d / sigma30dAvg
 * @param now 테스트용 시각 주입
 */
export function pauseF2W(
  reason: string,
  ratio: number,
  now: Date = new Date(),
): F2WPauseState {
  const pausedUntil = new Date(now.getTime() + PAUSE_TTL_DAYS * DAY_MS);
  const state: F2WPauseState = {
    pausedAt: now.toISOString(),
    pausedUntil: pausedUntil.toISOString(),
    reason,
    ratio: Number(ratio.toFixed(3)),
  };
  lsSet(PAUSE_KEY, JSON.stringify(state));
  return state;
}

/**
 * 운영자 수동 pause 해제.
 */
export function clearF2WPause(): void {
  lsRemove(PAUSE_KEY);
}

// ─── 진단 헬퍼 ────────────────────────────────────────────────────────────────

/**
 * σ 기여 Top N — drift 알림 메시지에 노출되는 의심 조건 식별.
 *
 * 가중치가 평균에서 가장 멀리 떨어진 조건 순으로 반환.
 */
export function getTopDeviatingConditions(
  weights: Record<number, number>,
  topN: number = 3,
): ConditionDeviation[] {
  const entries = Object.entries(weights)
    .map(([k, v]) => ({ id: parseInt(k, 10), weight: v }))
    .filter(e => Number.isFinite(e.id) && typeof e.weight === 'number' && Number.isFinite(e.weight));
  if (entries.length === 0) return [];

  const mean = entries.reduce((s, e) => s + e.weight, 0) / entries.length;
  const limit = Math.max(1, Math.min(topN, entries.length));

  return entries
    .map(e => ({
      conditionId: e.id as ConditionId,
      weight: e.weight,
      deviation: Number(Math.abs(e.weight - mean).toFixed(3)),
    }))
    .sort((a, b) => b.deviation - a.deviation)
    .slice(0, limit);
}

// ─── 테스트 전용 ──────────────────────────────────────────────────────────────

/**
 * vi.beforeEach 에서 호출하는 테스트 격리 헬퍼.
 *
 * 프로덕션 코드는 절대 호출 금지.
 */
export function __resetF2WDriftStateForTests(): void {
  lsRemove(HISTORY_KEY);
  lsRemove(PAUSE_KEY);
}

// ─── 상수 (테스트 가시화) ────────────────────────────────────────────────────

export const F2W_DRIFT_CONSTANTS = {
  HISTORY_KEY,
  PAUSE_KEY,
  HISTORY_MAX_DAYS,
  MIN_SAMPLES_FOR_DRIFT,
  DRIFT_RATIO_THRESHOLD,
  PAUSE_TTL_DAYS,
} as const;
