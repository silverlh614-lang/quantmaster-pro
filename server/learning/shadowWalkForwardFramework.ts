// @responsibility Shadow Walk-Forward 진단 — Rejection + Twin 데이터 IS/OOS 분할 (LIVE 가중치 무영향).
/**
 * shadowWalkForwardFramework.ts — ADR-0086 Shadow Walk-Forward Framework
 *
 * `walkForwardFramework.ts` (LIVE recommendations) 위에 *Shadow 데이터 진단* 레이어.
 * Rejection (PR-L `rejectionShadowTracker`) + Twin (PR-M `counterfactualTwinPortfolio`)
 * 데이터를 IS/OOS 윈도우 분할 검증.
 *
 * 사용자 분석 (2026-04-28) — Shadow 학습 다음 단계 #4:
 *   "Shadow 데이터도 in-sample / out-of-sample 로 나눠야 함.
 *    예: 최근 60일 Shadow 학습, 다음 30일 검증.
 *    이렇게 해야 Shadow 학습도 과최적화를 피할 수 있음."
 *
 * 본 PR 은 *진단 + 통계 전용*. LIVE 가중치 / freeze 정책 영향 없음.
 *
 * - LIVE 매매 본체 0줄 변경
 * - Yahoo OHLCV fetch 0건 (영속 데이터만 사용 — ADR-0082 정합)
 * - ENV 롤백 `SHADOW_WALK_FORWARD_DISABLED=true`
 */

import { getAllRejectionShadow, type RejectionShadowEntry } from './rejectionShadowTracker.js';
import {
  getAllTwinEntries,
  type TwinEntry,
  type TwinKey,
} from './counterfactualTwinPortfolio.js';
import {
  WALK_FORWARD_DEFAULTS,
  computeMaxDrawdown,
  computeSharpe,
  generateRollingWindows,
  type RollingWindowSpec,
} from './walkForwardFramework.js';
import {
  SHADOW_WALK_FORWARD_SCHEMA_VERSION,
  appendShadowWalkForwardWindow,
  loadShadowWalkForwardResults,
  saveShadowWalkForwardResults,
} from '../persistence/shadowWalkForwardResultsRepo.js';
import type {
  WalkForwardResults,
  WalkForwardSummary,
  WalkForwardWindow,
  WindowMetrics,
} from '../persistence/walkForwardResultsRepo.js';

// ── 정책 SSOT (env 오버라이드 가능) ─────────────────────────────────────────────

export const SHADOW_WALK_FORWARD_DEFAULTS = {
  IS_DAYS: 60,
  OOS_DAYS: 30,
  STEP_DAYS: 7,
  MAX_WINDOWS: 24,
  MIN_SAMPLE_PER_WINDOW: 5,
  /** rejection: 종결 후 currentReturnPct ≥ 본 임계 시 alpha 누락 (false negative) */
  REJECTION_FALSE_NEG_THRESHOLD_PCT: 5,
  DECAY_DEGRADATION_PCT_PT: 5.0,
  OVERFIT_FLAG_PCT_PT: 15.0,
  DECAY_MIN_WINDOWS: 6,
} as const;

const DAY_MS = 24 * 60 * 60 * 1000;

function envIntOr(key: string, fallback: number, min = 1): number {
  const raw = process.env[key];
  if (!raw) return fallback;
  const n = Number(raw);
  if (!Number.isFinite(n) || n < min) return fallback;
  return Math.floor(n);
}

export function isShadowFrameworkDisabled(): boolean {
  return process.env.SHADOW_WALK_FORWARD_DISABLED === 'true';
}

export function getShadowResolvedConfig(): {
  isDays: number;
  oosDays: number;
  stepDays: number;
  maxWindows: number;
} {
  return {
    isDays: envIntOr('SHADOW_WALK_FORWARD_IS_DAYS', SHADOW_WALK_FORWARD_DEFAULTS.IS_DAYS),
    oosDays: envIntOr('SHADOW_WALK_FORWARD_OOS_DAYS', SHADOW_WALK_FORWARD_DEFAULTS.OOS_DAYS),
    stepDays: envIntOr('SHADOW_WALK_FORWARD_STEP_DAYS', SHADOW_WALK_FORWARD_DEFAULTS.STEP_DAYS),
    maxWindows: envIntOr('SHADOW_WALK_FORWARD_MAX_WINDOWS', SHADOW_WALK_FORWARD_DEFAULTS.MAX_WINDOWS, 1),
  };
}

// ── 공통 record adapter ────────────────────────────────────────────────────────

/**
 * Shadow 두 source 의 record 를 walk-forward 산출 가능한 공통 형태로 변환.
 *
 * - rejection: currentReturnPct → returnPct, closed=true → CLOSED, closed=false → PENDING
 * - twin: currentReturnPct → returnPct, status 그대로 (OPEN/CLOSED)
 *
 * 빈 currentReturnPct → 0 (안전 fallback). signalDate → closedAt 으로 매핑 (시간 분할 기준).
 */
export interface ShadowWindowRecord {
  /** 시간 분할 기준 (signalDate 또는 trackUntil — 호출자가 결정) */
  closedAt: string;
  returnPct: number;
  /** rejection 'CLOSED'(종결) | 'PENDING'(활성) | twin 'OPEN' | 'CLOSED' */
  status: 'CLOSED' | 'PENDING' | 'OPEN';
  isWin: boolean;
  source: 'REJECTION' | 'TWIN';
  /** TwinEntry 만 — AGGRESSIVE/DISCIPLINED/EQUAL_WEIGHT */
  twin?: TwinKey;
}

export function rejectionToWindowRecord(
  e: RejectionShadowEntry,
  threshold: number = SHADOW_WALK_FORWARD_DEFAULTS.REJECTION_FALSE_NEG_THRESHOLD_PCT,
): ShadowWindowRecord {
  const returnPct = Number.isFinite(e.currentReturnPct) ? Number(e.currentReturnPct) : 0;
  return {
    closedAt: e.signalDate,
    returnPct,
    status: e.closed ? 'CLOSED' : 'PENDING',
    /** rejection 의 alpha 누락 = ≥ threshold (false negative) */
    isWin: returnPct >= threshold,
    source: 'REJECTION',
  };
}

export function twinToWindowRecord(e: TwinEntry): ShadowWindowRecord {
  const returnPct = Number.isFinite(e.currentReturnPct) ? Number(e.currentReturnPct) : 0;
  return {
    closedAt: e.signalDate,
    returnPct,
    status: e.status, // 'OPEN' | 'CLOSED'
    isWin: returnPct > 0,
    source: 'TWIN',
    twin: e.twin,
  };
}

// ── Window metrics (Shadow 전용 — status 다양성 흡수) ──────────────────────────

function pickInRange(
  records: ShadowWindowRecord[],
  startMs: number,
  endMs: number,
): ShadowWindowRecord[] {
  return records.filter((r) => {
    const t = Date.parse(`${r.closedAt}T00:00:00Z`);
    if (!Number.isFinite(t)) return false;
    return t >= startMs && t < endMs;
  });
}

export function computeShadowWindowMetrics(records: ShadowWindowRecord[]): WindowMetrics {
  if (records.length === 0) {
    return { sampleSize: 0, winRate: 0, avgReturn: 0, totalReturn: 0, sharpe: 0, maxDrawdown: 0 };
  }
  const wins = records.filter((r) => r.isWin).length;
  const winRate = records.length > 0 ? wins / records.length : 0;
  const returns = records.map((r) => (Number.isFinite(r.returnPct) ? r.returnPct : 0));
  const avgReturn = returns.length > 0 ? returns.reduce((s, x) => s + x, 0) / returns.length : 0;
  const totalReturn = returns.length > 0
    ? (returns.reduce((acc, x) => acc * (1 + x / 100), 1) - 1) * 100
    : 0;
  return {
    sampleSize: records.length,
    winRate,
    avgReturn,
    totalReturn,
    sharpe: computeSharpe(returns),
    maxDrawdown: computeMaxDrawdown(returns),
  };
}

function buildShadowWindow(
  spec: RollingWindowSpec,
  records: ShadowWindowRecord[],
  minSample: number,
): WalkForwardWindow | null {
  const isRecs = pickInRange(records, spec.inSampleStartMs, spec.inSampleEndMs);
  const oosRecs = pickInRange(records, spec.outSampleStartMs, spec.outSampleEndMs);
  if (isRecs.length < minSample || oosRecs.length < minSample) return null;
  const isMetrics = computeShadowWindowMetrics(isRecs);
  const oosMetrics = computeShadowWindowMetrics(oosRecs);
  const degradation = (isMetrics.winRate - oosMetrics.winRate) * 100;
  return {
    windowId: `shadow_${spec.windowId}`,
    inSampleStart: new Date(spec.inSampleStartMs).toISOString().slice(0, 10),
    inSampleEnd: new Date(spec.inSampleEndMs).toISOString().slice(0, 10),
    outSampleStart: new Date(spec.outSampleStartMs).toISOString().slice(0, 10),
    outSampleEnd: new Date(spec.outSampleEndMs).toISOString().slice(0, 10),
    isMetrics,
    oosMetrics,
    degradation,
    computedAt: new Date().toISOString(),
  };
}

function median(values: number[]): number {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  if (sorted.length % 2 === 0) return (sorted[mid - 1] + sorted[mid]) / 2;
  return sorted[mid];
}

function computeShadowDecayTrend(
  windows: WalkForwardWindow[],
  minWindows: number = SHADOW_WALK_FORWARD_DEFAULTS.DECAY_MIN_WINDOWS,
  thresholdPctPt: number = SHADOW_WALK_FORWARD_DEFAULTS.DECAY_DEGRADATION_PCT_PT,
): WalkForwardSummary['decayTrend'] {
  if (windows.length < minWindows) return 'INSUFFICIENT';
  const sorted = [...windows].sort((a, b) =>
    Date.parse(a.computedAt) - Date.parse(b.computedAt),
  );
  const third = Math.max(1, Math.floor(sorted.length / 3));
  const earlySlice = sorted.slice(0, third);
  const lateSlice = sorted.slice(-third);
  const earlyOosWr = earlySlice.length > 0
    ? earlySlice.reduce((s, w) => s + w.oosMetrics.winRate, 0) / earlySlice.length
    : 0;
  const lateOosWr = lateSlice.length > 0
    ? lateSlice.reduce((s, w) => s + w.oosMetrics.winRate, 0) / lateSlice.length
    : 0;
  const deltaPctPt = (lateOosWr - earlyOosWr) * 100;
  if (deltaPctPt <= -thresholdPctPt) return 'DECAYING';
  if (deltaPctPt >= thresholdPctPt) return 'IMPROVING';
  return 'STABLE';
}

export function computeShadowSummary(windows: WalkForwardWindow[]): WalkForwardSummary {
  if (windows.length === 0) {
    return { totalWindows: 0, avgDegradation: 0, medianDegradation: 0, overfitFlagged: 0, decayTrend: 'INSUFFICIENT' };
  }
  const degradations = windows.map((w) => w.degradation);
  const avgDegradation = degradations.reduce((s, x) => s + x, 0) / degradations.length;
  const medianDegradation = median(degradations);
  const overfitFlagged = degradations.filter(
    (d) => d > SHADOW_WALK_FORWARD_DEFAULTS.OVERFIT_FLAG_PCT_PT,
  ).length;
  return {
    totalWindows: windows.length,
    avgDegradation,
    medianDegradation,
    overfitFlagged,
    decayTrend: computeShadowDecayTrend(windows),
  };
}

// ── 진입점 ──────────────────────────────────────────────────────────────────────

export interface RunShadowWalkForwardOptions {
  now?: number;
  /** REJECTION 만 또는 TWIN 만 또는 전체 — 미지정 시 전체 합산 */
  source?: 'REJECTION' | 'TWIN' | 'ALL';
}

/**
 * Shadow 데이터 Rolling window 진단 1회 실행 + 영속 갱신.
 *
 * - SHADOW_WALK_FORWARD_DISABLED=true → 즉시 return (영속 미생성)
 * - 입력: rejectionShadowTracker + twinPortfolio 영속 records 합산
 * - 출력: WalkForwardWindow[] (windowId='shadow_*' prefix) + summary + 영속
 */
export async function runShadowWalkForward(
  opts: RunShadowWalkForwardOptions = {},
): Promise<{ skipped: boolean; results?: WalkForwardResults; reason?: string }> {
  if (isShadowFrameworkDisabled()) {
    return { skipped: true, reason: 'DISABLED' };
  }
  const now = opts.now ?? Date.now();
  const config = getShadowResolvedConfig();
  const source = opts.source ?? 'ALL';

  const records: ShadowWindowRecord[] = [];
  if (source === 'REJECTION' || source === 'ALL') {
    const rejections = getAllRejectionShadow();
    for (const e of rejections) records.push(rejectionToWindowRecord(e));
  }
  if (source === 'TWIN' || source === 'ALL') {
    const twins = getAllTwinEntries();
    for (const e of twins) records.push(twinToWindowRecord(e));
  }
  if (records.length === 0) {
    return { skipped: true, reason: 'NO_RECORDS' };
  }

  const specs = generateRollingWindows(
    now,
    config.isDays,
    config.oosDays,
    config.stepDays,
    config.maxWindows,
  );

  let aggregate = loadShadowWalkForwardResults();
  for (const spec of specs) {
    const window = buildShadowWindow(spec, records, WALK_FORWARD_DEFAULTS.MIN_SAMPLE_PER_WINDOW);
    if (window === null) continue;
    aggregate = appendShadowWalkForwardWindow(aggregate, window, config.maxWindows);
  }
  aggregate = {
    schemaVersion: SHADOW_WALK_FORWARD_SCHEMA_VERSION,
    generatedAt: new Date(now).toISOString(),
    windows: aggregate.windows,
    summary: computeShadowSummary(aggregate.windows),
  };
  saveShadowWalkForwardResults(aggregate);
  return { skipped: false, results: aggregate };
}
