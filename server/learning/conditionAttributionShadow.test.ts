// @responsibility conditionAttributionShadow 회귀 테스트 — Over-Strict / Good Defense 분류.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { RejectionShadowEntry } from './rejectionShadowTracker.js';

vi.mock('./rejectionShadowTracker.js', async () => {
  const actual = await vi.importActual<Record<string, unknown>>('./rejectionShadowTracker.js');
  return {
    ...actual,
    getAllRejectionShadow: vi.fn(),
  };
});

import * as repo from './rejectionShadowTracker.js';
import {
  SHADOW_ATTRIBUTION_CONSTANTS,
  analyzeShadowAttribution,
  isShadowAttributionDisabled,
} from './conditionAttributionShadow.js';

const mockedAll = vi.mocked(repo.getAllRejectionShadow);

function makeEntry(overrides: Partial<RejectionShadowEntry> = {}): RejectionShadowEntry {
  return {
    id: `r_${Math.random().toString(36).slice(2)}`,
    stockCode: '005930',
    stockName: '삼성전자',
    signalDate: '2026-04-15',
    signalPriceKrw: 70000,
    gateScore: 16,
    scoreDelta: 2,
    rejectionReason: 'Gate 1 미달',
    trackUntil: '2026-04-22',
    currentReturnPct: 7,
    closed: true,
    ...overrides,
  };
}

describe('conditionAttributionShadow — 상수 + ENV', () => {
  beforeEach(() => { delete process.env.SHADOW_CONDITION_ATTRIBUTION_DISABLED; });
  afterEach(() => { delete process.env.SHADOW_CONDITION_ATTRIBUTION_DISABLED; });

  it('상수 SSOT 정합', () => {
    expect(SHADOW_ATTRIBUTION_CONSTANTS.OVER_STRICT_RETURN_THRESHOLD_PCT).toBe(5);
    expect(SHADOW_ATTRIBUTION_CONSTANTS.GOOD_DEFENSE_RETURN_THRESHOLD_PCT).toBe(-5);
    expect(SHADOW_ATTRIBUTION_CONSTANTS.LOW_SCORE_THRESHOLD).toBe(6);
    expect(SHADOW_ATTRIBUTION_CONSTANTS.MIN_FREQUENCY).toBe(3);
  });

  it('ENV DISABLED — true 정확값', () => {
    expect(isShadowAttributionDisabled()).toBe(false);
    process.env.SHADOW_CONDITION_ATTRIBUTION_DISABLED = 'true';
    expect(isShadowAttributionDisabled()).toBe(true);
    process.env.SHADOW_CONDITION_ATTRIBUTION_DISABLED = 'TRUE';
    expect(isShadowAttributionDisabled()).toBe(false);
  });
});

describe('conditionAttributionShadow — analyzeShadowAttribution', () => {
  beforeEach(() => {
    delete process.env.SHADOW_CONDITION_ATTRIBUTION_DISABLED;
    mockedAll.mockReset();
  });

  afterEach(() => {
    delete process.env.SHADOW_CONDITION_ATTRIBUTION_DISABLED;
    vi.clearAllMocks();
  });

  it('ENV DISABLED → status DISABLED', () => {
    process.env.SHADOW_CONDITION_ATTRIBUTION_DISABLED = 'true';
    mockedAll.mockReturnValue([]);
    const result = analyzeShadowAttribution();
    expect(result.status).toBe('DISABLED');
    expect(result.totalConditions).toBe(0);
    expect(result.conditions).toEqual([]);
  });

  it('빈 entries → NO_DATA', () => {
    mockedAll.mockReturnValue([]);
    const result = analyzeShadowAttribution();
    expect(result.status).toBe('NO_DATA');
    expect(result.closedSampleSize).toBe(0);
  });

  it('closed=false entry 자동 제외 → NO_DATA', () => {
    mockedAll.mockReturnValue([
      makeEntry({ closed: false, conditionScores: { 1: 3 } }),
      makeEntry({ closed: false, conditionScores: { 1: 2 } }),
    ]);
    const result = analyzeShadowAttribution();
    expect(result.status).toBe('NO_DATA');
  });

  it('conditionScores 부재 entry 자동 제외 → NO_DATA', () => {
    mockedAll.mockReturnValue([
      makeEntry({ closed: true, conditionScores: undefined }),
    ]);
    const result = analyzeShadowAttribution();
    expect(result.status).toBe('NO_DATA');
  });

  it('정상 entries — 27 조건 모두 산출', () => {
    mockedAll.mockReturnValue([
      makeEntry({ closed: true, currentReturnPct: 7, conditionScores: { 1: 3 } }),
    ]);
    const result = analyzeShadowAttribution();
    expect(result.status).toBe('OK');
    expect(result.totalConditions).toBe(27);
    expect(result.conditions).toHaveLength(27);
  });

  it('Over-Strict 빈도 카운트 — 거절 후 +5% 종목 + 낮은 점수 조건', () => {
    mockedAll.mockReturnValue([
      // 5건 모두 +7% 종목, 조건 1 점수 3 (낮음) → over_strict count 5
      ...Array.from({ length: 5 }, () =>
        makeEntry({ closed: true, currentReturnPct: 7, conditionScores: { 1: 3 } }),
      ),
    ]);
    const result = analyzeShadowAttribution();
    const c1 = result.conditions.find((c) => c.conditionId === 1)!;
    expect(c1.overStrictCount).toBe(5);
    expect(c1.goodDefenseCount).toBe(0);
    expect(c1.classification).toBe('over_strict_candidate');
  });

  it('Good Defense 빈도 카운트 — 거절 후 -7% 종목 + 낮은 점수 조건', () => {
    mockedAll.mockReturnValue(Array.from({ length: 5 }, () =>
      makeEntry({ closed: true, currentReturnPct: -7, conditionScores: { 2: 2 } }),
    ));
    const result = analyzeShadowAttribution();
    const c2 = result.conditions.find((c) => c.conditionId === 2)!;
    expect(c2.overStrictCount).toBe(0);
    expect(c2.goodDefenseCount).toBe(5);
    expect(c2.classification).toBe('good_defense_candidate');
  });

  it('boundary 영역 (-5% < ret < +5%) 무시', () => {
    mockedAll.mockReturnValue([
      makeEntry({ closed: true, currentReturnPct: 3, conditionScores: { 1: 0 } }),
      makeEntry({ closed: true, currentReturnPct: -3, conditionScores: { 1: 0 } }),
    ]);
    const result = analyzeShadowAttribution();
    const c1 = result.conditions.find((c) => c.conditionId === 1)!;
    expect(c1.overStrictCount).toBe(0);
    expect(c1.goodDefenseCount).toBe(0);
    expect(c1.classification).toBe('insufficient');
  });

  it('점수 ≥ 6 인 조건은 분류 제외 (해당 조건 충족)', () => {
    mockedAll.mockReturnValue(Array.from({ length: 5 }, () =>
      makeEntry({ closed: true, currentReturnPct: 7, conditionScores: { 1: 6, 2: 3 } }),
    ));
    const result = analyzeShadowAttribution();
    const c1 = result.conditions.find((c) => c.conditionId === 1)!;
    const c2 = result.conditions.find((c) => c.conditionId === 2)!;
    expect(c1.overStrictCount).toBe(0); // score=6 → 충족
    expect(c2.overStrictCount).toBe(5);
  });

  it('빈도 부족 (총 < MIN_FREQUENCY=3) → insufficient', () => {
    mockedAll.mockReturnValue([
      makeEntry({ closed: true, currentReturnPct: 7, conditionScores: { 1: 3 } }),
      makeEntry({ closed: true, currentReturnPct: 7, conditionScores: { 1: 3 } }),
    ]);
    const result = analyzeShadowAttribution();
    const c1 = result.conditions.find((c) => c.conditionId === 1)!;
    expect(c1.classification).toBe('insufficient');
  });

  it('정확히 ratio=0.7 → over_strict_candidate', () => {
    // 7 over-strict + 3 good defense = ratio 0.7
    mockedAll.mockReturnValue([
      ...Array.from({ length: 7 }, () =>
        makeEntry({ closed: true, currentReturnPct: 7, conditionScores: { 1: 3 } }),
      ),
      ...Array.from({ length: 3 }, () =>
        makeEntry({ closed: true, currentReturnPct: -7, conditionScores: { 1: 3 } }),
      ),
    ]);
    const result = analyzeShadowAttribution();
    const c1 = result.conditions.find((c) => c.conditionId === 1)!;
    expect(c1.ratio).toBeCloseTo(0.7, 3);
    expect(c1.classification).toBe('over_strict_candidate');
  });

  it('정확히 ratio=0.3 → good_defense_candidate', () => {
    mockedAll.mockReturnValue([
      ...Array.from({ length: 3 }, () =>
        makeEntry({ closed: true, currentReturnPct: 7, conditionScores: { 1: 3 } }),
      ),
      ...Array.from({ length: 7 }, () =>
        makeEntry({ closed: true, currentReturnPct: -7, conditionScores: { 1: 3 } }),
      ),
    ]);
    const result = analyzeShadowAttribution();
    const c1 = result.conditions.find((c) => c.conditionId === 1)!;
    expect(c1.ratio).toBeCloseTo(0.3, 3);
    expect(c1.classification).toBe('good_defense_candidate');
  });

  it('균형 (0.4~0.6) → normal', () => {
    mockedAll.mockReturnValue([
      ...Array.from({ length: 5 }, () =>
        makeEntry({ closed: true, currentReturnPct: 7, conditionScores: { 1: 3 } }),
      ),
      ...Array.from({ length: 5 }, () =>
        makeEntry({ closed: true, currentReturnPct: -7, conditionScores: { 1: 3 } }),
      ),
    ]);
    const result = analyzeShadowAttribution();
    const c1 = result.conditions.find((c) => c.conditionId === 1)!;
    expect(c1.ratio).toBeCloseTo(0.5, 3);
    expect(c1.classification).toBe('normal');
  });

  it('summary 카운트 정확', () => {
    mockedAll.mockReturnValue([
      // 조건 1: over-strict 5건
      ...Array.from({ length: 5 }, () =>
        makeEntry({ closed: true, currentReturnPct: 7, conditionScores: { 1: 3 } }),
      ),
      // 조건 2: good defense 5건
      ...Array.from({ length: 5 }, () =>
        makeEntry({ closed: true, currentReturnPct: -7, conditionScores: { 2: 3 } }),
      ),
    ]);
    const result = analyzeShadowAttribution();
    expect(result.summary.overStrictCandidates).toBe(1);
    expect(result.summary.goodDefenseCandidates).toBe(1);
    expect(result.summary.insufficient).toBe(25); // 27 - 2
    expect(result.summary.normal).toBe(0);
  });

  it('avgReturn 정확', () => {
    mockedAll.mockReturnValue([
      makeEntry({ closed: true, currentReturnPct: 6, conditionScores: { 1: 0 } }),
      makeEntry({ closed: true, currentReturnPct: 8, conditionScores: { 1: 0 } }),
      makeEntry({ closed: true, currentReturnPct: 10, conditionScores: { 1: 0 } }),
    ]);
    const result = analyzeShadowAttribution();
    const c1 = result.conditions.find((c) => c.conditionId === 1)!;
    expect(c1.overStrictAvgReturn).toBeCloseTo(8, 1);
  });

  it('NaN/null currentReturnPct 안전 (제외)', () => {
    mockedAll.mockReturnValue([
      makeEntry({ closed: true, currentReturnPct: NaN, conditionScores: { 1: 0 } }),
      makeEntry({ closed: true, currentReturnPct: 7, conditionScores: { 1: 0 } }),
      makeEntry({ closed: true, currentReturnPct: 7, conditionScores: { 1: 0 } }),
      makeEntry({ closed: true, currentReturnPct: 7, conditionScores: { 1: 0 } }),
    ]);
    const result = analyzeShadowAttribution();
    const c1 = result.conditions.find((c) => c.conditionId === 1)!;
    expect(c1.overStrictCount).toBe(3); // NaN 제외
  });

  it('27 조건 모두 conditionId 1~27 순서대로', () => {
    mockedAll.mockReturnValue([
      makeEntry({ closed: true, currentReturnPct: 7, conditionScores: { 1: 0 } }),
    ]);
    const result = analyzeShadowAttribution();
    for (let i = 0; i < 27; i += 1) {
      expect(result.conditions[i].conditionId).toBe(i + 1);
    }
  });

  it('conditionName 매핑 — CONDITION_NAMES 사용', () => {
    mockedAll.mockReturnValue([
      makeEntry({ closed: true, currentReturnPct: 7, conditionScores: { 1: 0 } }),
    ]);
    const result = analyzeShadowAttribution();
    for (const c of result.conditions) {
      expect(typeof c.conditionName).toBe('string');
      expect(c.conditionName.length).toBeGreaterThan(0);
    }
  });
});

describe('conditionAttributionShadow — schema 호환', () => {
  it('RejectionShadowEntry.conditionScores 옵셔널 — 기존 영속 호환', () => {
    const entryWithout = makeEntry({ conditionScores: undefined });
    const entryWith = makeEntry({ conditionScores: { 1: 8 } });
    expect(entryWithout.conditionScores).toBeUndefined();
    expect(entryWith.conditionScores).toEqual({ 1: 8 });
  });
});
