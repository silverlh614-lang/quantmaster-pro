/**
 * @responsibility ADR-0173 §5 LearningFreshnessGuard 회귀 — 시간 감쇠 + regime 불일치 + 안전 fallback
 */

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import {
  applyFreshnessDecay,
  isFreshnessGuardEnabled,
  FRESHNESS_DECAY_14D_RATIO,
  FRESHNESS_EXPIRY_30D,
  REGIME_MISMATCH_RATIO,
  FRESHNESS_DECAY_AGE_DAYS,
  FRESHNESS_EXPIRY_AGE_DAYS,
} from './learningFreshnessGuard.js';

const ENV_KEY = 'LEARNING_FRESHNESS_GUARD_ENABLED';

beforeEach(() => {
  // 회귀 테스트는 ENV ON 상태에서 정책 검증.
  process.env[ENV_KEY] = 'true';
});

afterEach(() => {
  delete process.env[ENV_KEY];
});

// ─── 결정 트리 분기 ──────────────────────────────────────────────────────────

describe('applyFreshnessDecay — 결정 트리', () => {
  it('ENV OFF — no-op (입력 그대로)', () => {
    delete process.env[ENV_KEY];
    const lesson = { weight: 1.0, ageDays: 50, regime: 'BULL' };
    const result = applyFreshnessDecay(lesson, 'BEAR');
    expect(result.weight).toBe(1.0); // 30일+ regime 불일치도 무시
  });

  it('age=10 정상 (감쇠 임계 미달) → weight 보존', () => {
    const lesson = { weight: 0.8, ageDays: 10 };
    const result = applyFreshnessDecay(lesson);
    expect(result.weight).toBe(0.8);
  });

  it('age=15 (FRESHNESS_DECAY_AGE_DAYS 14 초과) → weight × 0.3', () => {
    const lesson = { weight: 1.0, ageDays: 15 };
    const result = applyFreshnessDecay(lesson);
    expect(result.weight).toBeCloseTo(0.3, 6);
  });

  it('age=20 → weight × 0.3', () => {
    const lesson = { weight: 0.5, ageDays: 20 };
    const result = applyFreshnessDecay(lesson);
    expect(result.weight).toBeCloseTo(0.5 * 0.3, 6);
  });

  it('age=29 (만료 임계 미달) → weight × 0.3 (감쇠만)', () => {
    const lesson = { weight: 1.0, ageDays: 29 };
    const result = applyFreshnessDecay(lesson);
    expect(result.weight).toBeCloseTo(0.3, 6);
  });

  it('age=30 (만료 임계 boundary, =30 → 감쇠만 — 만료 트리거 ageDays > 30)', () => {
    const lesson = { weight: 1.0, ageDays: 30 };
    const result = applyFreshnessDecay(lesson);
    // 사용자 명세: ageDays > 30 → 0. 30 정확이면 만료 미트리거 → 감쇠만.
    expect(result.weight).toBeCloseTo(0.3, 6);
  });

  it('age=31 (만료 임계 초과) → weight = 0', () => {
    const lesson = { weight: 1.0, ageDays: 31 };
    const result = applyFreshnessDecay(lesson);
    expect(result.weight).toBe(0);
  });

  it('age=100 → weight = 0', () => {
    const lesson = { weight: 0.9, ageDays: 100 };
    const result = applyFreshnessDecay(lesson);
    expect(result.weight).toBe(0);
  });
});

// ─── regime 분기 ─────────────────────────────────────────────────────────────

describe('applyFreshnessDecay — regime 분기', () => {
  it('regime 일치 → 감쇠 영향 없음 (10일 정상)', () => {
    const lesson = { weight: 1.0, ageDays: 5, regime: 'BULL' };
    const result = applyFreshnessDecay(lesson, 'BULL');
    expect(result.weight).toBe(1.0);
  });

  it('regime 불일치 → weight × 0.5', () => {
    const lesson = { weight: 1.0, ageDays: 5, regime: 'BULL' };
    const result = applyFreshnessDecay(lesson, 'BEAR');
    expect(result.weight).toBeCloseTo(0.5, 6);
  });

  it('lesson.regime undefined / currentRegime undefined → 영향 없음', () => {
    const lesson = { weight: 1.0, ageDays: 5 };
    const result = applyFreshnessDecay(lesson);
    expect(result.weight).toBe(1.0);
  });
});

// ─── 곱셈 결합 ──────────────────────────────────────────────────────────────

describe('applyFreshnessDecay — 곱셈 결합', () => {
  it('age=15 + regime 불일치 → 0.3 × 0.5 = 0.15', () => {
    const lesson = { weight: 1.0, ageDays: 15, regime: 'BULL' };
    const result = applyFreshnessDecay(lesson, 'BEAR');
    expect(result.weight).toBeCloseTo(0.15, 6);
  });

  it('age=31 + regime 불일치 → 0 (만료가 우선)', () => {
    const lesson = { weight: 1.0, ageDays: 31, regime: 'BULL' };
    const result = applyFreshnessDecay(lesson, 'BEAR');
    expect(result.weight).toBe(0);
  });
});

// ─── 안전 fallback ──────────────────────────────────────────────────────────

describe('applyFreshnessDecay — 안전 fallback', () => {
  it('NaN ageDays → no-op', () => {
    const lesson = { weight: 0.7, ageDays: NaN };
    const result = applyFreshnessDecay(lesson);
    expect(result.weight).toBe(0.7);
  });

  it('Infinity ageDays → no-op', () => {
    const lesson = { weight: 0.7, ageDays: Number.POSITIVE_INFINITY };
    const result = applyFreshnessDecay(lesson);
    expect(result.weight).toBe(0.7);
  });

  it('음수 ageDays → no-op', () => {
    const lesson = { weight: 0.7, ageDays: -5 };
    const result = applyFreshnessDecay(lesson);
    expect(result.weight).toBe(0.7);
  });

  it('weight=0 → 그대로 0 보존 (감쇠 영향 없음)', () => {
    const lesson = { weight: 0, ageDays: 50, regime: 'BULL' };
    const result = applyFreshnessDecay(lesson, 'BEAR');
    expect(result.weight).toBe(0);
  });
});

// ─── 임계 SSOT 정합 ─────────────────────────────────────────────────────────

describe('임계 SSOT 정합', () => {
  it('상수 SSOT 값 정합 (ADR-0173 §5)', () => {
    expect(FRESHNESS_DECAY_14D_RATIO).toBe(0.3);
    expect(FRESHNESS_EXPIRY_30D).toBe(0);
    expect(REGIME_MISMATCH_RATIO).toBe(0.5);
    expect(FRESHNESS_DECAY_AGE_DAYS).toBe(14);
    expect(FRESHNESS_EXPIRY_AGE_DAYS).toBe(30);
  });
});

// ─── T extends LessonWithMeta — 입력 type 보존 ─────────────────────────────

describe('T extends LessonWithMeta — 입력 type 보존', () => {
  it('호출자 추가 필드 보존 (Spread 재구성)', () => {
    interface RecentReflection {
      weight: number;
      ageDays: number;
      regime?: string;
      narrative: string;
      verdictLabel: 'GOOD_DAY' | 'BAD_DAY';
    }
    const lesson: RecentReflection = {
      weight: 1.0,
      ageDays: 15,
      regime: 'BULL',
      narrative: '어제는 손절 2건 + 익절 1건',
      verdictLabel: 'BAD_DAY',
    };
    const result = applyFreshnessDecay(lesson, 'BULL');
    // 추가 필드 보존
    expect(result.narrative).toBe('어제는 손절 2건 + 익절 1건');
    expect(result.verdictLabel).toBe('BAD_DAY');
    // 감쇠는 적용
    expect(result.weight).toBeCloseTo(0.3, 6);
  });
});

// ─── ENV 헬퍼 정합 ──────────────────────────────────────────────────────────

describe('isFreshnessGuardEnabled — ENV 비교', () => {
  it("ENV='true' → true", () => {
    process.env[ENV_KEY] = 'true';
    expect(isFreshnessGuardEnabled()).toBe(true);
  });

  it('ENV 미설정 → false (default OFF)', () => {
    delete process.env[ENV_KEY];
    expect(isFreshnessGuardEnabled()).toBe(false);
  });

  it("ENV='1' → false (정확 비교)", () => {
    process.env[ENV_KEY] = '1';
    expect(isFreshnessGuardEnabled()).toBe(false);
  });

  it("ENV='TRUE' → false (대문자 거부)", () => {
    process.env[ENV_KEY] = 'TRUE';
    expect(isFreshnessGuardEnabled()).toBe(false);
  });
});
