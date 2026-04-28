// @responsibility Walk-Forward Framework 윈도우 결과 영속 SSOT — atomic write + FIFO trim.
/**
 * walkForwardResultsRepo.ts — ADR-0083 Walk-Forward Framework Extension
 *
 * `data/walk-forward-results.json` 영속 SSOT — Rolling window 결과 누적 진단.
 * 기존 `WALK_FORWARD_STATE_FILE` (freeze 상태) 와 책임 분리.
 *
 * - 외부 의존성 0 (fs/path + paths.ts 만)
 * - atomic write (tmp → rename) — race 시 이전 정상 본 보존
 * - 손상 JSON / 누락 schema → 빈 결과 fallback (시스템 무중단)
 * - FIFO trim (max windows env override)
 */

import fs from 'fs';
import path from 'path';
import {
  WALK_FORWARD_RESULTS_FILE,
  ensureDataDir,
} from './paths.js';

export const WALK_FORWARD_SCHEMA_VERSION = 1;

export interface WindowMetrics {
  /** closed (WIN+LOSS+EXPIRED) 표본 수 */
  sampleSize: number;
  /** wins / (wins + losses) — EXPIRED 제외 */
  winRate: number;
  /** 평균 actualReturn (%) */
  avgReturn: number;
  /** 누적 수익률 (복리, %) */
  totalReturn: number;
  /** mean / stdev (단순 — 일별 무위험률 미고려) */
  sharpe: number;
  /** 누적 수익률 시계열의 최대 낙폭 (%) */
  maxDrawdown: number;
}

export interface RegimeMetrics {
  is: WindowMetrics;
  oos: WindowMetrics;
}

export interface WalkForwardWindow {
  windowId: string;
  /** YYYY-MM-DD KST */
  inSampleStart: string;
  inSampleEnd: string;
  outSampleStart: string;
  outSampleEnd: string;
  isMetrics: WindowMetrics;
  oosMetrics: WindowMetrics;
  /** is.winRate - oos.winRate (%p, 양수면 OOS 가 IS 보다 나쁨 = 과최적화 신호) */
  degradation: number;
  /** entryRegime 별 IS/OOS 분리 (표본 부족 시 부재) */
  regimeMetrics?: Record<string, RegimeMetrics>;
  /** ISO 산출 시각 */
  computedAt: string;
}

export type DecayTrend = 'IMPROVING' | 'STABLE' | 'DECAYING' | 'INSUFFICIENT';

export interface WalkForwardSummary {
  totalWindows: number;
  /** 모든 윈도우 평균 degradation (%p) */
  avgDegradation: number;
  /** 모든 윈도우 중간값 degradation (%p) */
  medianDegradation: number;
  /** degradation > 15%p 인 윈도우 수 */
  overfitFlagged: number;
  /** 최근 1/3 vs 초기 1/3 윈도우 OOS winRate 추세 */
  decayTrend: DecayTrend;
}

export interface WalkForwardResults {
  schemaVersion: number;
  generatedAt: string;
  windows: WalkForwardWindow[];
  summary: WalkForwardSummary;
}

const EMPTY_SUMMARY: WalkForwardSummary = {
  totalWindows: 0,
  avgDegradation: 0,
  medianDegradation: 0,
  overfitFlagged: 0,
  decayTrend: 'INSUFFICIENT',
};

function buildEmpty(): WalkForwardResults {
  return {
    schemaVersion: WALK_FORWARD_SCHEMA_VERSION,
    generatedAt: new Date(0).toISOString(),
    windows: [],
    summary: EMPTY_SUMMARY,
  };
}

export function loadWalkForwardResults(): WalkForwardResults {
  ensureDataDir();
  if (!fs.existsSync(WALK_FORWARD_RESULTS_FILE)) {
    return buildEmpty();
  }
  try {
    const raw = fs.readFileSync(WALK_FORWARD_RESULTS_FILE, 'utf-8');
    const parsed = JSON.parse(raw) as Partial<WalkForwardResults>;
    if (!parsed || typeof parsed !== 'object') return buildEmpty();
    if (!Array.isArray(parsed.windows)) return buildEmpty();
    return {
      schemaVersion: parsed.schemaVersion ?? WALK_FORWARD_SCHEMA_VERSION,
      generatedAt: parsed.generatedAt ?? new Date(0).toISOString(),
      windows: parsed.windows as WalkForwardWindow[],
      summary: parsed.summary ?? EMPTY_SUMMARY,
    };
  } catch {
    // 손상 JSON — 빈 결과 fallback (시스템 무중단)
    return buildEmpty();
  }
}

/**
 * Atomic write — tmp 파일에 쓴 뒤 rename. race 시 이전 정상 본 보존.
 */
export function saveWalkForwardResults(results: WalkForwardResults): void {
  ensureDataDir();
  const tmp = `${WALK_FORWARD_RESULTS_FILE}.tmp`;
  const payload: WalkForwardResults = {
    schemaVersion: WALK_FORWARD_SCHEMA_VERSION,
    generatedAt: results.generatedAt ?? new Date().toISOString(),
    windows: results.windows ?? [],
    summary: results.summary ?? EMPTY_SUMMARY,
  };
  fs.writeFileSync(tmp, JSON.stringify(payload, null, 2));
  fs.renameSync(tmp, WALK_FORWARD_RESULTS_FILE);
}

/**
 * windowId 정확 1회 등록. 동일 ID 가 이미 있으면 덮어쓰기 (재계산 idempotent).
 * FIFO trim 적용 (maxWindows 초과 시 가장 오래된 windowId 제거).
 */
export function appendWalkForwardWindow(
  current: WalkForwardResults,
  window: WalkForwardWindow,
  maxWindows: number,
): WalkForwardResults {
  const safeMax = Math.max(1, Math.floor(maxWindows));
  const existing = current.windows.filter((w) => w.windowId !== window.windowId);
  const merged = [...existing, window];
  // 최신순 정렬은 호출자 책임 — 본 함수는 입력 그대로 유지
  const trimmed = merged.slice(-safeMax);
  return {
    schemaVersion: WALK_FORWARD_SCHEMA_VERSION,
    generatedAt: new Date().toISOString(),
    windows: trimmed,
    summary: current.summary,
  };
}

export function clearWalkForwardResults(): void {
  ensureDataDir();
  if (fs.existsSync(WALK_FORWARD_RESULTS_FILE)) {
    fs.unlinkSync(WALK_FORWARD_RESULTS_FILE);
  }
}

/** 테스트 전용 — DATA_DIR 격리 후 파일 정리. */
export function __resetWalkForwardResultsForTests(): void {
  try {
    if (fs.existsSync(WALK_FORWARD_RESULTS_FILE)) {
      fs.unlinkSync(WALK_FORWARD_RESULTS_FILE);
    }
    const tmp = `${WALK_FORWARD_RESULTS_FILE}.tmp`;
    if (fs.existsSync(tmp)) fs.unlinkSync(tmp);
  } catch {
    // 무시
  }
}

export const WALK_FORWARD_PATHS = {
  resultsFile: WALK_FORWARD_RESULTS_FILE,
  resultsDir: path.dirname(WALK_FORWARD_RESULTS_FILE),
};
