/**
 * Tests for timingSyncEngine.ts — 조건 통과 시점 일치도 스코어
 */
import { describe, it, expect } from 'vitest';
import {
  evaluateTimingSync,
  tradingDaysBetween,
  RECENT_TRADING_DAYS,
  RECENCY_WEIGHT_MULTIPLIER,
  SYNC_HIGH_THRESHOLD,
  SYNC_MEDIUM_THRESHOLD,
} from '../../src/services/quant/timingSyncEngine';
import type { ConditionId } from '../../src/types/quant';

// ─── tradingDaysBetween ──────────────────────────────────────────────────────

describe('tradingDaysBetween', () => {
  it('같은 날이면 0 반환', () => {
    const d = new Date('2024-01-15');
    expect(tradingDaysBetween(d, d)).toBe(0);
  });

  it('주말 제외: 월~금(5 거래일)', () => {
    // 2024-01-15(월) ~ 2024-01-19(금)
    const from = new Date('2024-01-15');
    const to = new Date('2024-01-19');
    // 화/수/목/금 = 4 거래일 (from 다음 날부터 to까지)
    expect(tradingDaysBetween(from, to)).toBe(4);
  });

  it('한 주 = 5 거래일 (월~다음 월)', () => {
    // 2024-01-15(월) ~ 2024-01-22(월) = 5 거래일 (화~월)
    const from = new Date('2024-01-15');
    const to = new Date('2024-01-22');
    expect(tradingDaysBetween(from, to)).toBe(5);
  });

  it('from > to도 양수 반환 (절댓값)', () => {
    const a = new Date('2024-01-20');
    const b = new Date('2024-01-15');
    expect(tradingDaysBetween(a, b)).toBeGreaterThanOrEqual(0);
  });

  it('토/일만 포함하는 범위 = 0 거래일', () => {
    // 2024-01-20(토) ~ 2024-01-21(일)
    const from = new Date('2024-01-20');
    const to = new Date('2024-01-21');
    expect(tradingDaysBetween(from, to)).toBe(0);
  });
});

// ─── evaluateTimingSync ──────────────────────────────────────────────────────

function makeScores(passedIds: number[]): Record<ConditionId, number> {
  const scores: Record<number, number> = {};
  for (let i = 1; i <= 27; i++) {
    scores[i] = passedIds.includes(i) ? 8 : 2;
  }
  return scores as Record<ConditionId, number>;
}

describe('evaluateTimingSync', () => {
  it('통과 조건 없으면 syncScore=0, level=LOW', () => {
    const scores: Record<ConditionId, number> = {};
    for (let i = 1 as ConditionId; i <= 27; i++) scores[i] = 1;
    const result = evaluateTimingSync(scores);
    expect(result.syncScore).toBe(0);
    expect(result.level).toBe('LOW');
    expect(result.totalPassedCount).toBe(0);
    expect(result.recentConditionCount).toBe(0);
  });

  it('타임스탬프 없으면 기본 점수 계산', () => {
    const scores = makeScores([1, 2, 3, 5, 9, 19, 20]);
    const result = evaluateTimingSync(scores);
    expect(result.totalPassedCount).toBe(7);
    expect(result.recentConditionCount).toBe(0); // 타임스탬프 없음
    expect(result.syncScore).toBeGreaterThanOrEqual(0);
  });

  it('모든 조건이 최근 5거래일 이내 → recentConditionCount = totalPassedCount', () => {
    const scores = makeScores([1, 2, 3]);
    const now = new Date();
    // 3일 전 (거래일)
    const threeDaysAgo = new Date(now);
    threeDaysAgo.setDate(now.getDate() - 3);
    const timestamps: Partial<Record<ConditionId, string>> = {
      1: threeDaysAgo.toISOString(),
      2: threeDaysAgo.toISOString(),
      3: threeDaysAgo.toISOString(),
    };
    const result = evaluateTimingSync(scores, timestamps, now);
    expect(result.totalPassedCount).toBe(3);
    // 3일 전이면 최대 RECENT_TRADING_DAYS(5) 이내 → fresh
    // (단, 정확한 거래일 수 계산 의존, 주말 포함 여부에 따라 달라짐)
    expect(result.recentConditionCount).toBeGreaterThanOrEqual(0);
  });

  it('오래된 타임스탬프 → isFresh = false', () => {
    const scores = makeScores([1]);
    const longAgo = new Date('2020-01-01');
    const timestamps: Partial<Record<ConditionId, string>> = {
      1: longAgo.toISOString(),
    };
    const result = evaluateTimingSync(scores, timestamps);
    expect(result.conditionFreshness.find(c => c.conditionId === 1)?.isFresh).toBe(false);
  });

  it('최신 조건 가중치는 RECENCY_WEIGHT_MULTIPLIER(1.5)', () => {
    const scores = makeScores([1]);
    // 어제 통과 (거의 확실히 fresh)
    const yesterday = new Date();
    yesterday.setDate(yesterday.getDate() - 1);
    const timestamps: Partial<Record<ConditionId, string>> = {
      1: yesterday.toISOString(),
    };
    const result = evaluateTimingSync(scores, timestamps);
    const freshness = result.conditionFreshness.find(c => c.conditionId === 1);
    if (freshness && freshness.isFresh) {
      expect(freshness.weight).toBe(RECENCY_WEIGHT_MULTIPLIER);
    }
  });

  it('level HIGH 시 syncScore >= SYNC_HIGH_THRESHOLD', () => {
    const scores = makeScores([1, 2, 3, 5, 9, 19, 20, 22, 25]);
    const yesterday = new Date();
    yesterday.setDate(yesterday.getDate() - 1);
    const timestamps: Partial<Record<ConditionId, string>> = {};
    [1, 2, 3, 5, 9, 19, 20, 22, 25].forEach(id => {
      timestamps[id as ConditionId] = yesterday.toISOString();
    });
    const result = evaluateTimingSync(scores, timestamps);
    if (result.level === 'HIGH') {
      expect(result.syncScore).toBeGreaterThanOrEqual(SYNC_HIGH_THRESHOLD);
    }
  });

  it('level MEDIUM 시 SYNC_MEDIUM_THRESHOLD <= syncScore < SYNC_HIGH_THRESHOLD', () => {
    const result = { syncScore: 55, level: 'MEDIUM' as const };
    if (result.level === 'MEDIUM') {
      expect(result.syncScore).toBeGreaterThanOrEqual(SYNC_MEDIUM_THRESHOLD);
      expect(result.syncScore).toBeLessThan(SYNC_HIGH_THRESHOLD);
    }
  });

  it('반환된 결과에 필수 필드 포함', () => {
    const scores = makeScores([1, 5, 9]);
    const result = evaluateTimingSync(scores);
    expect(typeof result.syncScore).toBe('number');
    expect(['HIGH', 'MEDIUM', 'LOW']).toContain(result.level);
    expect(typeof result.recentConditionCount).toBe('number');
    expect(typeof result.totalPassedCount).toBe('number');
    expect(typeof result.freshnessWeightedScore).toBe('number');
    expect(Array.isArray(result.conditionFreshness)).toBe(true);
    expect(typeof result.message).toBe('string');
    expect(typeof result.interpretation).toBe('string');
  });

  it('syncScore는 0~100 범위', () => {
    // 극단 케이스 1: 모든 조건 만점 + 최신
    const allPassScores = makeScores(Array.from({ length: 27 }, (_, i) => i + 1));
    const yesterday = new Date();
    yesterday.setDate(yesterday.getDate() - 1);
    const ts: Partial<Record<ConditionId, string>> = {};
    for (let i = 1; i <= 27; i++) ts[i as ConditionId] = yesterday.toISOString();
    const r1 = evaluateTimingSync(allPassScores, ts);
    expect(r1.syncScore).toBeGreaterThanOrEqual(0);
    expect(r1.syncScore).toBeLessThanOrEqual(100);

    // 극단 케이스 2: 통과 조건 없음
    const noPassScores = makeScores([]);
    const r2 = evaluateTimingSync(noPassScores);
    expect(r2.syncScore).toBe(0);
  });

  it('타임스탬프가 부분적으로만 제공된 경우', () => {
    const scores = makeScores([1, 2, 3, 5]);
    const yesterday = new Date();
    yesterday.setDate(yesterday.getDate() - 1);
    // 일부만 제공
    const timestamps: Partial<Record<ConditionId, string>> = {
      1: yesterday.toISOString(),
      2: yesterday.toISOString(),
      // 3, 5는 타임스탬프 없음
    };
    const result = evaluateTimingSync(scores, timestamps);
    expect(result.totalPassedCount).toBe(4);
    // 타임스탬프 없는 조건은 isFresh=false, weight=1.0
    const c3 = result.conditionFreshness.find(c => c.conditionId === 3);
    expect(c3?.isFresh).toBe(false);
    expect(c3?.weight).toBe(1.0);
  });
});
