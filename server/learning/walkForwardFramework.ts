// @responsibility Walk-Forward Framework — Rolling window IS/OOS 진단 (LIVE 가중치 무영향).
/**
 * walkForwardFramework.ts — ADR-0083 Walk-Forward Framework Extension
 *
 * 사용자 P10 진단 — 기존 walkForwardValidator.ts 의 단일 윈도우 한계를 극복.
 *
 * - Rolling window (default IS=60일 / OOS=30일 / step=7일, 24개 FIFO 슬라이딩)
 * - Regime 별 분리 검증 (RecommendationRecord.entryRegime — PR-G ADR-0024)
 * - Alpha decay 추적 (최근 1/3 vs 초기 1/3 윈도우 OOS winRate 추세)
 * - LIVE 가중치 동결 정책 무영향 (기존 walkForwardValidator.ts 본체 0줄 수정)
 * - Yahoo OHLCV fetch 0건 (영속 데이터만 시간 분할 — ADR-0082 정합)
 *
 * ENV 롤백: `WALK_FORWARD_FRAMEWORK_DISABLED=true` 시 진입점 즉시 return.
 *
 * 외부 의존: recommendationTracker (read-only) + walkForwardResultsRepo (영속).
 */

import { getRecommendations, type RecommendationRecord } from './recommendationTracker.js';
import {
  computeMaxDrawdown as computeMaxDrawdownSsot,
  computeMaxDrawdownLegacyPositive,
  isMddLegacySignDisabled,
} from './mddCalculator.js';
import {
  WALK_FORWARD_SCHEMA_VERSION,
  appendWalkForwardWindow,
  loadWalkForwardResults,
  saveWalkForwardResults,
  type DecayTrend,
  type RegimeMetrics,
  type WalkForwardResults,
  type WalkForwardSummary,
  type WalkForwardWindow,
  type WindowMetrics,
} from '../persistence/walkForwardResultsRepo.js';

// ── 정책 상수 SSOT ──────────────────────────────────────────────────────────────

export const WALK_FORWARD_DEFAULTS = {
  IS_DAYS: 60,
  OOS_DAYS: 30,
  STEP_DAYS: 7,
  MAX_WINDOWS: 24,
  MIN_SAMPLE_PER_WINDOW: 5,
  REGIME_MIN_SAMPLE: 3,
  DECAY_DEGRADATION_PCT_PT: 5.0, // %p
  OVERFIT_FLAG_PCT_PT: 15.0,     // %p (기존 walkForwardValidator 와 동일)
  DECAY_MIN_WINDOWS: 6,
} as const;

const DAY_MS = 24 * 60 * 60 * 1000;

// ── Helpers ────────────────────────────────────────────────────────────────────

function envIntOr(key: string, fallback: number, min = 1): number {
  const raw = process.env[key];
  if (!raw) return fallback;
  const n = Number(raw);
  if (!Number.isFinite(n) || n < min) return fallback;
  return Math.floor(n);
}

export function isFrameworkDisabled(): boolean {
  return process.env.WALK_FORWARD_FRAMEWORK_DISABLED === 'true';
}

export function getResolvedConfig(): {
  isDays: number;
  oosDays: number;
  stepDays: number;
  maxWindows: number;
} {
  return {
    isDays: envIntOr('WALK_FORWARD_IS_DAYS', WALK_FORWARD_DEFAULTS.IS_DAYS),
    oosDays: envIntOr('WALK_FORWARD_OOS_DAYS', WALK_FORWARD_DEFAULTS.OOS_DAYS),
    stepDays: envIntOr('WALK_FORWARD_STEP_DAYS', WALK_FORWARD_DEFAULTS.STEP_DAYS),
    maxWindows: envIntOr('WALK_FORWARD_MAX_WINDOWS', WALK_FORWARD_DEFAULTS.MAX_WINDOWS, 1),
  };
}

function toIsoDate(ms: number): string {
  return new Date(ms).toISOString().slice(0, 10);
}

/** 입력 records 중 [start, end) ms 구간 + status closed 인 항목 추출. */
function pickClosedInRange(
  records: RecommendationRecord[],
  startMs: number,
  endMs: number,
): RecommendationRecord[] {
  return records.filter((r) => {
    if (r.status === 'PENDING') return false;
    const t = Date.parse(r.signalTime);
    if (!Number.isFinite(t)) return false;
    return t >= startMs && t < endMs;
  });
}

// ── 통계 산출 ──────────────────────────────────────────────────────────────────

/**
 * ADR-0129: MDD SSOT 통합 — `mddCalculator` 위임.
 *
 * 부호 정합 정책:
 * - default: 기존 walkForwardFramework 동작 (POSITIVE 반환) 유지 — 영속 schema +
 *   호출자 (formatWalkForwardMessage / WindowMetrics.maxDrawdown) 후방호환.
 * - ENV `MDD_SSOT_LEGACY_SIGN_DISABLED=true` 명시 시 NEGATIVE 반환 (mddCalculator
 *   기본 SSOT 와 정합 — 텔레그램 메시지 부호 일관성 강제).
 *
 * 수학은 단일 SSOT (compound) 라 양수/음수 변환만 다름.
 */
export function computeMaxDrawdown(returnsPct: number[]): number {
  if (isMddLegacySignDisabled()) {
    // ENV 명시 시: 음수 반환 (mddCalculator default)
    return computeMaxDrawdownSsot(returnsPct, 'compound');
  }
  // Default (후방호환): 양수 반환 (walkForwardFramework 기존 동작)
  return computeMaxDrawdownLegacyPositive(returnsPct);
}

export function computeSharpe(returnsPct: number[]): number {
  if (returnsPct.length < 2) return 0;
  const valid = returnsPct.filter((r) => Number.isFinite(r));
  if (valid.length < 2) return 0;
  const mean = valid.reduce((s, x) => s + x, 0) / valid.length;
  const variance = valid.reduce((s, x) => s + (x - mean) ** 2, 0) / valid.length;
  const stdev = Math.sqrt(variance);
  if (!Number.isFinite(stdev) || stdev === 0) return 0;
  return mean / stdev;
}

export function computeWindowMetrics(records: RecommendationRecord[]): WindowMetrics {
  if (records.length === 0) {
    return {
      sampleSize: 0,
      winRate: 0,
      avgReturn: 0,
      totalReturn: 0,
      sharpe: 0,
      maxDrawdown: 0,
    };
  }
  const wins = records.filter((r) => r.status === 'WIN');
  const losses = records.filter((r) => r.status === 'LOSS');
  const winLossTotal = wins.length + losses.length;
  const winRate = winLossTotal > 0 ? wins.length / winLossTotal : 0;

  // EXPIRED 도 포함해 평균 / 누적 수익률 계산 (실현 측면)
  const returns: number[] = records
    .map((r) => (Number.isFinite(r.actualReturn) ? Number(r.actualReturn) : 0));
  const avgReturn = returns.length > 0
    ? returns.reduce((s, x) => s + x, 0) / returns.length
    : 0;
  const totalReturn = returns.length > 0
    ? (returns.reduce((acc, r) => acc * (1 + r / 100), 1) - 1) * 100
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

// ── Rolling window 산출 ────────────────────────────────────────────────────────

export interface RollingWindowSpec {
  windowId: string;
  inSampleStartMs: number;
  inSampleEndMs: number;
  outSampleStartMs: number;
  outSampleEndMs: number;
}

/**
 * 현재 시각 기준으로 maxWindows 개의 rolling window 시간 범위 산출.
 *
 * 가장 최근 윈도우는 OOS 가 [now - oosDays, now) 가 되도록 정렬.
 * 슬라이딩 step 만큼 과거로 이동하며 누적.
 */
export function generateRollingWindows(
  nowMs: number,
  isDays: number,
  oosDays: number,
  stepDays: number,
  maxWindows: number,
): RollingWindowSpec[] {
  const windows: RollingWindowSpec[] = [];
  const oosLengthMs = oosDays * DAY_MS;
  const isLengthMs = isDays * DAY_MS;
  const stepMs = stepDays * DAY_MS;

  for (let i = 0; i < maxWindows; i += 1) {
    const oosEnd = nowMs - i * stepMs;
    const oosStart = oosEnd - oosLengthMs;
    const isEnd = oosStart;
    const isStart = isEnd - isLengthMs;
    if (isStart <= 0) break;
    windows.push({
      windowId: `${toIsoDate(isStart)}_${toIsoDate(oosEnd)}`,
      inSampleStartMs: isStart,
      inSampleEndMs: isEnd,
      outSampleStartMs: oosStart,
      outSampleEndMs: oosEnd,
    });
  }
  // 가장 최근 윈도우가 마지막 (FIFO trim 시 보존됨)
  return windows.reverse();
}

// ── Regime 분리 ────────────────────────────────────────────────────────────────

export function computeRegimeBreakdown(
  isRecords: RecommendationRecord[],
  oosRecords: RecommendationRecord[],
  minSample: number = WALK_FORWARD_DEFAULTS.REGIME_MIN_SAMPLE,
): Record<string, RegimeMetrics> {
  const groupBy = (recs: RecommendationRecord[]): Map<string, RecommendationRecord[]> => {
    const m = new Map<string, RecommendationRecord[]>();
    for (const r of recs) {
      const regime = (r.entryRegime ?? '').trim() || 'UNKNOWN';
      const arr = m.get(regime) ?? [];
      arr.push(r);
      m.set(regime, arr);
    }
    return m;
  };

  const isMap = groupBy(isRecords);
  const oosMap = groupBy(oosRecords);
  const allRegimes = new Set<string>([...isMap.keys(), ...oosMap.keys()]);
  const out: Record<string, RegimeMetrics> = {};
  for (const regime of allRegimes) {
    const isList = isMap.get(regime) ?? [];
    const oosList = oosMap.get(regime) ?? [];
    if (isList.length < minSample && oosList.length < minSample) continue;
    out[regime] = {
      is: computeWindowMetrics(isList),
      oos: computeWindowMetrics(oosList),
    };
  }
  return out;
}

// ── Decay trend ────────────────────────────────────────────────────────────────

export function computeDecayTrend(
  windows: WalkForwardWindow[],
  minWindows: number = WALK_FORWARD_DEFAULTS.DECAY_MIN_WINDOWS,
  thresholdPctPt: number = WALK_FORWARD_DEFAULTS.DECAY_DEGRADATION_PCT_PT,
): DecayTrend {
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
  const deltaPctPt = (lateOosWr - earlyOosWr) * 100; // %p
  if (deltaPctPt <= -thresholdPctPt) return 'DECAYING';
  if (deltaPctPt >= thresholdPctPt) return 'IMPROVING';
  return 'STABLE';
}

// ── 단일 윈도우 결과 산출 ──────────────────────────────────────────────────────

function buildWindow(
  spec: RollingWindowSpec,
  records: RecommendationRecord[],
  minSample: number,
): WalkForwardWindow | null {
  const isRecs = pickClosedInRange(records, spec.inSampleStartMs, spec.inSampleEndMs);
  const oosRecs = pickClosedInRange(records, spec.outSampleStartMs, spec.outSampleEndMs);
  if (isRecs.length < minSample || oosRecs.length < minSample) return null;
  const isMetrics = computeWindowMetrics(isRecs);
  const oosMetrics = computeWindowMetrics(oosRecs);
  const degradation = (isMetrics.winRate - oosMetrics.winRate) * 100; // %p
  const regimeMetrics = computeRegimeBreakdown(isRecs, oosRecs);
  return {
    windowId: spec.windowId,
    inSampleStart: toIsoDate(spec.inSampleStartMs),
    inSampleEnd: toIsoDate(spec.inSampleEndMs),
    outSampleStart: toIsoDate(spec.outSampleStartMs),
    outSampleEnd: toIsoDate(spec.outSampleEndMs),
    isMetrics,
    oosMetrics,
    degradation,
    regimeMetrics: Object.keys(regimeMetrics).length > 0 ? regimeMetrics : undefined,
    computedAt: new Date().toISOString(),
  };
}

// ── 요약 ────────────────────────────────────────────────────────────────────────

function median(values: number[]): number {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  if (sorted.length % 2 === 0) return (sorted[mid - 1] + sorted[mid]) / 2;
  return sorted[mid];
}

export function computeSummary(windows: WalkForwardWindow[]): WalkForwardSummary {
  if (windows.length === 0) {
    return {
      totalWindows: 0,
      avgDegradation: 0,
      medianDegradation: 0,
      overfitFlagged: 0,
      decayTrend: 'INSUFFICIENT',
    };
  }
  const degradations = windows.map((w) => w.degradation);
  const avgDegradation = degradations.reduce((s, x) => s + x, 0) / degradations.length;
  const medianDegradation = median(degradations);
  const overfitFlagged = degradations.filter(
    (d) => d > WALK_FORWARD_DEFAULTS.OVERFIT_FLAG_PCT_PT,
  ).length;
  return {
    totalWindows: windows.length,
    avgDegradation,
    medianDegradation,
    overfitFlagged,
    decayTrend: computeDecayTrend(windows),
  };
}

// ── 진입점 ──────────────────────────────────────────────────────────────────────

export interface RunWalkForwardOptions {
  now?: number;
}

/**
 * Rolling window 진단 1회 실행 + 영속 갱신.
 *
 * - WALK_FORWARD_FRAMEWORK_DISABLED=true 시 즉시 return (영속 미생성)
 * - 영속 결과 read → maxWindows 만큼 신규 산출 → 윈도우별 dedupe append → 요약 갱신 → 저장
 * - 본 함수는 Yahoo OHLCV fetch 0건 (영속 records 만 사용 — ADR-0082 정합)
 */
export async function runWalkForwardFramework(
  opts: RunWalkForwardOptions = {},
): Promise<{ skipped: boolean; results?: WalkForwardResults; reason?: string }> {
  if (isFrameworkDisabled()) {
    return { skipped: true, reason: 'DISABLED' };
  }
  const now = opts.now ?? Date.now();
  const config = getResolvedConfig();
  const records = getRecommendations();
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
  let aggregate = loadWalkForwardResults();
  for (const spec of specs) {
    const window = buildWindow(spec, records, WALK_FORWARD_DEFAULTS.MIN_SAMPLE_PER_WINDOW);
    if (window === null) continue;
    aggregate = appendWalkForwardWindow(aggregate, window, config.maxWindows);
  }
  aggregate = {
    schemaVersion: WALK_FORWARD_SCHEMA_VERSION,
    generatedAt: new Date(now).toISOString(),
    windows: aggregate.windows,
    summary: computeSummary(aggregate.windows),
  };
  saveWalkForwardResults(aggregate);
  return { skipped: false, results: aggregate };
}
