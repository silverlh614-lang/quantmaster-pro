// @responsibility Shadow Walk-Forward 결과 영속 SSOT — atomic write + FIFO trim + 손상 fallback.
/**
 * shadowWalkForwardResultsRepo.ts — ADR-0086 Shadow Walk-Forward Framework
 *
 * `data/walk-forward-shadow-results.json` 영속 SSOT — Rejection + Twin 데이터의
 * IS/OOS 분할 결과 누적. `walkForwardResultsRepo.ts` (LIVE recommendations 결과)
 * 와 책임 분리.
 *
 * - 외부 의존성 0 (fs/path + paths.ts 만)
 * - schema 재사용 — `WalkForwardWindow` / `WalkForwardSummary` / `WindowMetrics` 동일
 * - atomic write (tmp → rename) — race 시 이전 정상 본 보존
 * - 손상 JSON / 누락 schema → 빈 결과 fallback (시스템 무중단)
 * - FIFO trim
 */

import fs from 'fs';
import path from 'path';
import {
  WALK_FORWARD_SHADOW_RESULTS_FILE,
  ensureDataDir,
} from './paths.js';
import type {
  WalkForwardResults,
  WalkForwardSummary,
  WalkForwardWindow,
} from './walkForwardResultsRepo.js';

export const SHADOW_WALK_FORWARD_SCHEMA_VERSION = 1;

const EMPTY_SUMMARY: WalkForwardSummary = {
  totalWindows: 0,
  avgDegradation: 0,
  medianDegradation: 0,
  overfitFlagged: 0,
  decayTrend: 'INSUFFICIENT',
};

function buildEmpty(): WalkForwardResults {
  return {
    schemaVersion: SHADOW_WALK_FORWARD_SCHEMA_VERSION,
    generatedAt: new Date(0).toISOString(),
    windows: [],
    summary: EMPTY_SUMMARY,
  };
}

export function loadShadowWalkForwardResults(): WalkForwardResults {
  ensureDataDir();
  if (!fs.existsSync(WALK_FORWARD_SHADOW_RESULTS_FILE)) {
    return buildEmpty();
  }
  try {
    const raw = fs.readFileSync(WALK_FORWARD_SHADOW_RESULTS_FILE, 'utf-8');
    const parsed = JSON.parse(raw) as Partial<WalkForwardResults>;
    if (!parsed || typeof parsed !== 'object') return buildEmpty();
    if (!Array.isArray(parsed.windows)) return buildEmpty();
    return {
      schemaVersion: parsed.schemaVersion ?? SHADOW_WALK_FORWARD_SCHEMA_VERSION,
      generatedAt: parsed.generatedAt ?? new Date(0).toISOString(),
      windows: parsed.windows as WalkForwardWindow[],
      summary: parsed.summary ?? EMPTY_SUMMARY,
    };
  } catch {
    return buildEmpty();
  }
}

/** Atomic write — tmp 파일에 쓴 뒤 rename. */
export function saveShadowWalkForwardResults(results: WalkForwardResults): void {
  ensureDataDir();
  const tmp = `${WALK_FORWARD_SHADOW_RESULTS_FILE}.tmp`;
  const payload: WalkForwardResults = {
    schemaVersion: SHADOW_WALK_FORWARD_SCHEMA_VERSION,
    generatedAt: results.generatedAt ?? new Date().toISOString(),
    windows: results.windows ?? [],
    summary: results.summary ?? EMPTY_SUMMARY,
  };
  fs.writeFileSync(tmp, JSON.stringify(payload, null, 2));
  fs.renameSync(tmp, WALK_FORWARD_SHADOW_RESULTS_FILE);
}

/**
 * windowId 정확 1회 등록. 동일 ID 가 이미 있으면 덮어쓰기 (재계산 idempotent).
 * FIFO trim 적용 (maxWindows 초과 시 가장 오래된 windowId 제거).
 */
export function appendShadowWalkForwardWindow(
  current: WalkForwardResults,
  window: WalkForwardWindow,
  maxWindows: number,
): WalkForwardResults {
  const safeMax = Math.max(1, Math.floor(maxWindows));
  const existing = current.windows.filter((w) => w.windowId !== window.windowId);
  const merged = [...existing, window];
  const trimmed = merged.slice(-safeMax);
  return {
    schemaVersion: SHADOW_WALK_FORWARD_SCHEMA_VERSION,
    generatedAt: new Date().toISOString(),
    windows: trimmed,
    summary: current.summary,
  };
}

export function clearShadowWalkForwardResults(): void {
  ensureDataDir();
  if (fs.existsSync(WALK_FORWARD_SHADOW_RESULTS_FILE)) {
    fs.unlinkSync(WALK_FORWARD_SHADOW_RESULTS_FILE);
  }
}

export function __resetShadowWalkForwardResultsForTests(): void {
  try {
    if (fs.existsSync(WALK_FORWARD_SHADOW_RESULTS_FILE)) {
      fs.unlinkSync(WALK_FORWARD_SHADOW_RESULTS_FILE);
    }
    const tmp = `${WALK_FORWARD_SHADOW_RESULTS_FILE}.tmp`;
    if (fs.existsSync(tmp)) fs.unlinkSync(tmp);
  } catch {
    // ignore
  }
}

export const SHADOW_WALK_FORWARD_PATHS = {
  resultsFile: WALK_FORWARD_SHADOW_RESULTS_FILE,
  resultsDir: path.dirname(WALK_FORWARD_SHADOW_RESULTS_FILE),
};
