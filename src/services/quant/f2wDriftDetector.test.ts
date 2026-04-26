/**
 * @responsibility f2wDriftDetector 회귀 테스트 (ADR-0046 PR-Y1)
 */
import { describe, it, expect, beforeEach, afterEach, beforeAll } from 'vitest';
import {
  computeWeightStdDev,
  recordWeightSnapshot,
  loadWeightHistory,
  evaluateDrift,
  pauseF2W,
  isF2WPausedUntil,
  getF2WPauseState,
  clearF2WPause,
  getTopDeviatingConditions,
  __resetF2WDriftStateForTests,
  F2W_DRIFT_CONSTANTS,
  type WeightHistorySnapshot,
} from './f2wDriftDetector';
import { attachMockLocalStorage } from './__test-utils__/localStorageMock';

beforeAll(() => { attachMockLocalStorage(); });

const ORIGINAL_DISABLED = process.env.LEARNING_F2W_DRIFT_DISABLED;
beforeEach(() => {
  __resetF2WDriftStateForTests();
  delete process.env.LEARNING_F2W_DRIFT_DISABLED;
});
afterEach(() => {
  if (ORIGINAL_DISABLED === undefined) delete process.env.LEARNING_F2W_DRIFT_DISABLED;
  else process.env.LEARNING_F2W_DRIFT_DISABLED = ORIGINAL_DISABLED;
});

const DAY_MS = 24 * 60 * 60 * 1000;

// ─── computeWeightStdDev ──────────────────────────────────────────────────────

describe('computeWeightStdDev', () => {
  it('빈 입력은 0', () => {
    expect(computeWeightStdDev({})).toBe(0);
  });

  it('단일 값은 σ=0', () => {
    expect(computeWeightStdDev({ 1: 1.0 })).toBe(0);
  });

  it('동일 값 모두는 σ=0 (변동성 없음)', () => {
    expect(computeWeightStdDev({ 1: 1.0, 2: 1.0, 3: 1.0 })).toBe(0);
  });

  it('정규 분포 σ 계산', () => {
    // [0.5, 1.0, 1.5] mean=1.0 variance=((0.25+0+0.25)/3)≈0.1667 σ≈0.408
    const sigma = computeWeightStdDev({ 1: 0.5, 2: 1.0, 3: 1.5 });
    expect(sigma).toBeCloseTo(0.408, 2);
  });

  it('NaN/Infinity 입력은 안전 제외', () => {
    const sigma = computeWeightStdDev({
      1: 0.5,
      2: NaN,
      3: 1.0,
      4: Infinity,
      5: 1.5,
    });
    expect(sigma).toBeCloseTo(0.408, 2);
  });
});

// ─── recordWeightSnapshot + loadWeightHistory ─────────────────────────────────

describe('recordWeightSnapshot / loadWeightHistory', () => {
  it('첫 snapshot 누적 후 1건 반환', () => {
    const now = new Date('2026-04-26T00:00:00.000Z');
    const snap = recordWeightSnapshot({ 1: 0.5, 2: 1.5 }, now);
    expect(snap.sigma).toBeGreaterThan(0);
    const history = loadWeightHistory();
    expect(history).toHaveLength(1);
    expect(history[0].capturedAt).toBe(now.toISOString());
    expect(history[0].weights).toEqual({ 1: 0.5, 2: 1.5 });
  });

  it('90일 이전 항목 자동 trim', () => {
    const now = new Date('2026-04-26T00:00:00.000Z');
    // 100일 전 snapshot 미리 누적
    const old = new Date(now.getTime() - 100 * DAY_MS);
    recordWeightSnapshot({ 1: 1.0 }, old);
    expect(loadWeightHistory()).toHaveLength(1);
    // 새 snapshot 누적 시 100일 전 자동 trim
    recordWeightSnapshot({ 1: 1.1 }, now);
    const history = loadWeightHistory();
    expect(history).toHaveLength(1);
    expect(history[0].capturedAt).toBe(now.toISOString());
  });

  it('손상된 localStorage 는 빈 배열 fallback', () => {
    if (typeof globalThis.localStorage !== 'undefined') {
      globalThis.localStorage.setItem(F2W_DRIFT_CONSTANTS.HISTORY_KEY, '<<<corrupt>>>');
    }
    expect(loadWeightHistory()).toEqual([]);
  });
});

// ─── evaluateDrift ───────────────────────────────────────────────────────────

function makeHistorySpread(
  count: number,
  sigma: number,
  startMs: number,
  intervalMs: number,
): WeightHistorySnapshot[] {
  return Array.from({ length: count }, (_, i) => ({
    capturedAt: new Date(startMs + i * intervalMs).toISOString(),
    sigma,
    weights: {},
  }));
}

describe('evaluateDrift', () => {
  it('표본 부족 (30일 윈도우 < 5건) → drifted=false', () => {
    const now = new Date('2026-04-26T00:00:00.000Z');
    const history = makeHistorySpread(3, 0.1, now.getTime() - 5 * DAY_MS, DAY_MS);
    const result = evaluateDrift(history, now);
    expect(result.drifted).toBe(false);
    expect(result.reason).toContain('30일 표본 부족');
  });

  it('7일 윈도우 표본 0 → drifted=false', () => {
    const now = new Date('2026-04-26T00:00:00.000Z');
    // 모든 snapshot 이 14~30일 전 (7일 윈도우 밖)
    const history = makeHistorySpread(
      10,
      0.1,
      now.getTime() - 30 * DAY_MS,
      2 * DAY_MS,
    );
    // 마지막은 -10일 전 = 7일 윈도우 밖
    const result = evaluateDrift(history, now);
    expect(result.drifted).toBe(false);
    expect(result.reason).toBe('7일 표본 부재');
  });

  it('정상 분포 (σ7d=σ30d) → drifted=false', () => {
    const now = new Date('2026-04-26T00:00:00.000Z');
    // 30일 동안 일정한 σ=0.1
    const history = makeHistorySpread(
      30,
      0.1,
      now.getTime() - 29 * DAY_MS,
      DAY_MS,
    );
    const result = evaluateDrift(history, now);
    expect(result.drifted).toBe(false);
    expect(result.ratio).toBeCloseTo(1.0, 1);
  });

  it('σ7d ≥ σ30d × 2 임계 정확 도달 → drifted=true', () => {
    const now = new Date('2026-04-26T00:00:00.000Z');
    // 30일 윈도우의 24일은 σ=0.05, 최근 6일은 σ=0.4 (강한 변동)
    // → σ30d 평균 ≈ (24*0.05 + 6*0.4)/30 = 0.12
    // → σ7d 평균 (최근 6일) ≈ 0.4
    // → ratio ≈ 3.33 → drift
    const old = makeHistorySpread(24, 0.05, now.getTime() - 30 * DAY_MS, DAY_MS);
    const recent = makeHistorySpread(6, 0.4, now.getTime() - 6 * DAY_MS, DAY_MS);
    const result = evaluateDrift([...old, ...recent], now);
    expect(result.drifted).toBe(true);
    expect(result.ratio).toBeGreaterThanOrEqual(2.0);
    expect(result.reason).toContain('σ7d');
  });

  it('임계 미달 (ratio = 1.5) → drifted=false', () => {
    const now = new Date('2026-04-26T00:00:00.000Z');
    // 30일 σ ≈ 0.1, 최근 7일 σ ≈ 0.15 → ratio ≈ 1.5
    const old = makeHistorySpread(23, 0.1, now.getTime() - 30 * DAY_MS, DAY_MS);
    const recent = makeHistorySpread(7, 0.15, now.getTime() - 7 * DAY_MS, DAY_MS);
    const result = evaluateDrift([...old, ...recent], now);
    expect(result.drifted).toBe(false);
    expect(result.ratio).toBeLessThan(2.0);
  });

  it('30일 평균 σ=0 → drifted=false (분모 0 fallback)', () => {
    const now = new Date('2026-04-26T00:00:00.000Z');
    const history = makeHistorySpread(30, 0, now.getTime() - 29 * DAY_MS, DAY_MS);
    const result = evaluateDrift(history, now);
    expect(result.drifted).toBe(false);
    expect(result.reason).toContain('30일 평균 σ = 0');
  });

  it('LEARNING_F2W_DRIFT_DISABLED=true 환경 → 항상 drifted=false', () => {
    process.env.LEARNING_F2W_DRIFT_DISABLED = 'true';
    const now = new Date('2026-04-26T00:00:00.000Z');
    const old = makeHistorySpread(24, 0.05, now.getTime() - 30 * DAY_MS, DAY_MS);
    const recent = makeHistorySpread(6, 0.4, now.getTime() - 6 * DAY_MS, DAY_MS);
    const result = evaluateDrift([...old, ...recent], now);
    expect(result.drifted).toBe(false);
    expect(result.reason).toBe('LEARNING_F2W_DRIFT_DISABLED');
  });
});

// ─── pause flag ──────────────────────────────────────────────────────────────

describe('pauseF2W / isF2WPausedUntil / clearF2WPause', () => {
  it('pause 미설정 → null', () => {
    expect(isF2WPausedUntil()).toBeNull();
    expect(getF2WPauseState()).toBeNull();
  });

  it('pause 설정 후 7일 TTL Date 반환', () => {
    const now = new Date('2026-04-26T00:00:00.000Z');
    const state = pauseF2W('drift detected', 2.5, now);
    expect(state.reason).toBe('drift detected');
    expect(state.ratio).toBe(2.5);

    const until = isF2WPausedUntil(now);
    expect(until).not.toBeNull();
    const expected = now.getTime() + 7 * DAY_MS;
    expect(until!.getTime()).toBe(expected);
  });

  it('TTL 만료 후 자동 해제 — null + localStorage cleared', () => {
    const t0 = new Date('2026-04-26T00:00:00.000Z');
    pauseF2W('test', 2.5, t0);
    // 8일 후 — 만료
    const t1 = new Date(t0.getTime() + 8 * DAY_MS);
    expect(isF2WPausedUntil(t1)).toBeNull();
    // 다시 호출해도 null (자동 cleared)
    expect(isF2WPausedUntil(t1)).toBeNull();
    expect(getF2WPauseState(t1)).toBeNull();
  });

  it('clearF2WPause 수동 해제', () => {
    const now = new Date('2026-04-26T00:00:00.000Z');
    pauseF2W('test', 2.5, now);
    expect(isF2WPausedUntil(now)).not.toBeNull();
    clearF2WPause();
    expect(isF2WPausedUntil(now)).toBeNull();
  });

  it('손상된 pause flag 자동 청소', () => {
    if (typeof globalThis.localStorage !== 'undefined') {
      globalThis.localStorage.setItem(F2W_DRIFT_CONSTANTS.PAUSE_KEY, '{{corrupt}}');
    }
    expect(isF2WPausedUntil()).toBeNull();
    expect(getF2WPauseState()).toBeNull();
  });
});

// ─── getTopDeviatingConditions ────────────────────────────────────────────────

describe('getTopDeviatingConditions', () => {
  it('빈 입력은 빈 배열', () => {
    expect(getTopDeviatingConditions({})).toEqual([]);
  });

  it('mean 기준 |편차| 내림차순 Top 3', () => {
    // mean = (0.5+1.0+1.5+1.2+0.8)/5 = 1.0
    // 편차: 0.5, 0, 0.5, 0.2, 0.2 → conditionId 1 / 3 (tied 0.5) → 4 / 5 (tied 0.2)
    const result = getTopDeviatingConditions({ 1: 0.5, 2: 1.0, 3: 1.5, 4: 1.2, 5: 0.8 }, 3);
    expect(result).toHaveLength(3);
    expect(result[0].deviation).toBe(0.5);
    expect(result[1].deviation).toBe(0.5);
    // Top 3 의 마지막은 편차 0.2 둘 중 하나
    expect(result[2].deviation).toBe(0.2);
  });

  it('topN > 항목 수 시 전체 반환', () => {
    const result = getTopDeviatingConditions({ 1: 0.5, 2: 1.5 }, 10);
    expect(result).toHaveLength(2);
  });

  it('NaN/Infinity 가중치 자동 제외', () => {
    const result = getTopDeviatingConditions({ 1: 0.5, 2: NaN, 3: 1.5, 4: Infinity });
    expect(result).toHaveLength(2);
    expect(result.map(r => r.conditionId).sort()).toEqual([1, 3]);
  });
});

// ─── 상수 검증 ────────────────────────────────────────────────────────────────

describe('F2W_DRIFT_CONSTANTS', () => {
  it('사용자 원안 임계 ×2 + 7일 TTL 보존', () => {
    expect(F2W_DRIFT_CONSTANTS.DRIFT_RATIO_THRESHOLD).toBe(2.0);
    expect(F2W_DRIFT_CONSTANTS.PAUSE_TTL_DAYS).toBe(7);
    expect(F2W_DRIFT_CONSTANTS.MIN_SAMPLES_FOR_DRIFT).toBe(5);
    expect(F2W_DRIFT_CONSTANTS.HISTORY_MAX_DAYS).toBe(90);
  });
});
