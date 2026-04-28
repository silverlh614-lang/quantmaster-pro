// @responsibility conditionLifecyclePolicy 회귀 테스트 — 결정 트리 + 27 카탈로그 + 헬퍼.
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { ServerAttributionRecord } from '../persistence/attributionRepo.js';
import {
  CONDITION_LIFECYCLE_CONSTANTS,
  KNOWN_CONDITION_IDS,
  activatedCount,
  activationRate,
  ageDays,
  firstSeenAt,
  getAllConditionLifecycleStatuses,
  getConditionLifecycleStatus,
  isConditionLifecycleDisabled,
  lastSeenAt,
  summarizeConditionLifecycle,
} from './conditionLifecyclePolicy.js';

function makeRecord(overrides: Partial<ServerAttributionRecord> = {}): ServerAttributionRecord {
  return {
    schemaVersion: 2,
    tradeId: `t_${Math.random().toString(36).slice(2)}`,
    stockCode: '005930',
    stockName: '삼성전자',
    closedAt: '2026-04-15T01:00:00Z',
    returnPct: 5,
    isWin: true,
    holdingDays: 3,
    conditionScores: {},
    ...overrides,
  };
}

describe('conditionLifecyclePolicy — 상수 SSOT', () => {
  it('27 조건 카탈로그', () => {
    expect(KNOWN_CONDITION_IDS).toHaveLength(27);
    expect(KNOWN_CONDITION_IDS[0]).toBe(1);
    expect(KNOWN_CONDITION_IDS[26]).toBe(27);
  });

  it('상수 임계값 정합', () => {
    expect(CONDITION_LIFECYCLE_CONSTANTS.HIGH_SCORE_THRESHOLD).toBe(6);
    expect(CONDITION_LIFECYCLE_CONSTANTS.MIN_SAMPLE_FOR_LIFECYCLE).toBe(30);
    expect(CONDITION_LIFECYCLE_CONSTANTS.GRACE_PERIOD_DAYS).toBe(30);
    expect(CONDITION_LIFECYCLE_CONSTANTS.DEPRECATED_THRESHOLD).toBe(0.01);
    expect(CONDITION_LIFECYCLE_CONSTANTS.SILENT_THRESHOLD).toBe(0.05);
  });
});

describe('conditionLifecyclePolicy — 헬퍼', () => {
  it('activatedCount — score ≥ 6 만 카운트', () => {
    const records = [
      makeRecord({ conditionScores: { 1: 8 } }),
      makeRecord({ conditionScores: { 1: 6 } }),
      makeRecord({ conditionScores: { 1: 5 } }),
      makeRecord({ conditionScores: { 1: 0 } }),
      makeRecord({ conditionScores: {} }),
    ];
    expect(activatedCount(1, records)).toBe(2);
  });

  it('activatedCount — 빈 records 0', () => {
    expect(activatedCount(1, [])).toBe(0);
  });

  it('activatedCount — 다른 conditionId 무영향', () => {
    const records = [
      makeRecord({ conditionScores: { 1: 8, 2: 0 } }),
    ];
    expect(activatedCount(2, records)).toBe(0);
  });

  it('activationRate — 정상 비율', () => {
    const records = [
      makeRecord({ conditionScores: { 1: 8 } }),
      makeRecord({ conditionScores: { 1: 0 } }),
    ];
    expect(activationRate(1, records)).toBe(0.5);
  });

  it('activationRate — 빈 records 0', () => {
    expect(activationRate(1, [])).toBe(0);
  });

  it('activationRate — 0 활성 0', () => {
    const records = [makeRecord({ conditionScores: {} })];
    expect(activationRate(1, records)).toBe(0);
  });

  it('firstSeenAt — 가장 오래된 활성 record closedAt', () => {
    const records = [
      makeRecord({ conditionScores: { 1: 8 }, closedAt: '2026-04-15T01:00:00Z' }),
      makeRecord({ conditionScores: { 1: 8 }, closedAt: '2026-03-01T01:00:00Z' }),
      makeRecord({ conditionScores: { 1: 8 }, closedAt: '2026-04-01T01:00:00Z' }),
      makeRecord({ conditionScores: { 1: 0 }, closedAt: '2026-01-01T01:00:00Z' }), // 비활성 — 무시
    ];
    expect(firstSeenAt(1, records)).toBe('2026-03-01T01:00:00Z');
  });

  it('firstSeenAt — 활성 record 부재 → null', () => {
    const records = [makeRecord({ conditionScores: { 1: 0 } })];
    expect(firstSeenAt(1, records)).toBeNull();
  });

  it('lastSeenAt — 가장 최근 활성 record closedAt', () => {
    const records = [
      makeRecord({ conditionScores: { 1: 8 }, closedAt: '2026-04-15T01:00:00Z' }),
      makeRecord({ conditionScores: { 1: 8 }, closedAt: '2026-03-01T01:00:00Z' }),
    ];
    expect(lastSeenAt(1, records)).toBe('2026-04-15T01:00:00Z');
  });

  it('ageDays — 정상 일수 계산', () => {
    const now = new Date('2026-04-30T00:00:00Z');
    const result = ageDays('2026-04-01T00:00:00Z', now);
    expect(result).toBeCloseTo(29, 0);
  });

  it('ageDays — null firstSeen 0', () => {
    expect(ageDays(null)).toBe(0);
  });

  it('ageDays — 잘못된 ISO 0', () => {
    expect(ageDays('NOT_AN_ISO')).toBe(0);
  });
});

describe('conditionLifecyclePolicy — 결정 트리', () => {
  beforeEach(() => {
    delete process.env.CONDITION_LIFECYCLE_DISABLED;
  });

  afterEach(() => {
    delete process.env.CONDITION_LIFECYCLE_DISABLED;
  });

  it('ENV DISABLED → normal', () => {
    process.env.CONDITION_LIFECYCLE_DISABLED = 'true';
    const result = getConditionLifecycleStatus([], 1);
    expect(result.status).toBe('normal');
    expect(result.reason).toContain('정책 우회');
  });

  it('isConditionLifecycleDisabled 도 ENV 읽음', () => {
    process.env.CONDITION_LIFECYCLE_DISABLED = 'true';
    expect(isConditionLifecycleDisabled()).toBe(true);
    process.env.CONDITION_LIFECYCLE_DISABLED = 'false';
    expect(isConditionLifecycleDisabled()).toBe(false);
  });

  it('빈 records → grace (활성 0)', () => {
    const result = getConditionLifecycleStatus([], 1);
    expect(result.status).toBe('grace');
    expect(result.reason).toContain('활성 record 부재');
  });

  it('첫 등장 < 30일 → grace', () => {
    const now = new Date('2026-04-28T00:00:00Z');
    const records = [
      makeRecord({ conditionScores: { 1: 8 }, closedAt: '2026-04-15T00:00:00Z' }),
    ];
    const result = getConditionLifecycleStatus(records, 1, { now });
    expect(result.status).toBe('grace');
    expect(result.reason).toContain('grace');
  });

  it('표본 부족 (≥30일 + activated < 30) → grace', () => {
    const now = new Date('2026-04-28T00:00:00Z');
    const records: ServerAttributionRecord[] = [];
    for (let i = 0; i < 10; i += 1) {
      records.push(makeRecord({
        conditionScores: { 1: 8 },
        closedAt: '2026-01-01T00:00:00Z',
      }));
    }
    const result = getConditionLifecycleStatus(records, 1, { now });
    expect(result.status).toBe('grace');
    expect(result.reason).toContain('표본 부족');
  });

  it('activationRate < 1% → deprecated', () => {
    const now = new Date('2026-04-28T00:00:00Z');
    const records: ServerAttributionRecord[] = [];
    // 활성 30건 + 비활성 10000건 = activationRate 약 0.3%
    for (let i = 0; i < 30; i += 1) {
      records.push(makeRecord({
        conditionScores: { 1: 8 },
        closedAt: '2026-01-01T00:00:00Z',
      }));
    }
    for (let i = 0; i < 10000; i += 1) {
      records.push(makeRecord({
        conditionScores: { 1: 0 },
        closedAt: '2026-01-01T00:00:00Z',
      }));
    }
    const result = getConditionLifecycleStatus(records, 1, { now });
    expect(result.status).toBe('deprecated');
    expect(result.reason).toContain('<');
  });

  it('1% ≤ activationRate < 5% → silent', () => {
    const now = new Date('2026-04-28T00:00:00Z');
    const records: ServerAttributionRecord[] = [];
    // 활성 30건 + 비활성 970건 = activationRate 3%
    for (let i = 0; i < 30; i += 1) {
      records.push(makeRecord({
        conditionScores: { 1: 8 },
        closedAt: '2026-01-01T00:00:00Z',
      }));
    }
    for (let i = 0; i < 970; i += 1) {
      records.push(makeRecord({
        conditionScores: { 1: 0 },
        closedAt: '2026-01-01T00:00:00Z',
      }));
    }
    const result = getConditionLifecycleStatus(records, 1, { now });
    expect(result.status).toBe('silent');
  });

  it('activationRate ≥ 5% → normal', () => {
    const now = new Date('2026-04-28T00:00:00Z');
    const records: ServerAttributionRecord[] = [];
    // 활성 30건 + 비활성 270건 = activationRate 10%
    for (let i = 0; i < 30; i += 1) {
      records.push(makeRecord({
        conditionScores: { 1: 8 },
        closedAt: '2026-01-01T00:00:00Z',
      }));
    }
    for (let i = 0; i < 270; i += 1) {
      records.push(makeRecord({
        conditionScores: { 1: 0 },
        closedAt: '2026-01-01T00:00:00Z',
      }));
    }
    const result = getConditionLifecycleStatus(records, 1, { now });
    expect(result.status).toBe('normal');
  });

  it('windowDays 필터링 — 윈도우 밖 record 제외', () => {
    const now = new Date('2026-04-28T00:00:00Z');
    const records: ServerAttributionRecord[] = [
      makeRecord({ conditionScores: { 1: 8 }, closedAt: '2025-04-01T00:00:00Z' }), // 1년 전
      makeRecord({ conditionScores: { 1: 8 }, closedAt: '2026-04-15T00:00:00Z' }), // 13일 전
    ];
    const result = getConditionLifecycleStatus(records, 1, { now, windowDays: 30 });
    expect(result.totalRecords).toBe(1); // 윈도우 안 record 만
  });

  it('byRegime — 표본 ≥3 regime 만 노출', () => {
    const records: ServerAttributionRecord[] = [];
    for (let i = 0; i < 5; i += 1) {
      records.push(makeRecord({
        conditionScores: { 1: 8 },
        entryRegime: 'R2_BULL',
        closedAt: '2026-01-01T00:00:00Z',
      }));
    }
    records.push(makeRecord({
      conditionScores: { 1: 8 },
      entryRegime: 'R5_CAUTION', // 1건만 — 표본 부족
      closedAt: '2026-01-01T00:00:00Z',
    }));
    const result = getConditionLifecycleStatus(records, 1, {
      now: new Date('2026-04-28T00:00:00Z'),
    });
    expect(result.byRegime).toBeDefined();
    expect(Object.keys(result.byRegime!)).toContain('R2_BULL');
    expect(Object.keys(result.byRegime!)).not.toContain('R5_CAUTION');
  });

  it('threshold override — DEPRECATED_THRESHOLD 5% 로 격상 시 silent → deprecated', () => {
    const now = new Date('2026-04-28T00:00:00Z');
    const records: ServerAttributionRecord[] = [];
    for (let i = 0; i < 30; i += 1) {
      records.push(makeRecord({
        conditionScores: { 1: 8 },
        closedAt: '2026-01-01T00:00:00Z',
      }));
    }
    for (let i = 0; i < 970; i += 1) {
      records.push(makeRecord({
        conditionScores: { 1: 0 },
        closedAt: '2026-01-01T00:00:00Z',
      }));
    }
    // 기본 임계값으로는 silent (3%)
    let result = getConditionLifecycleStatus(records, 1, { now });
    expect(result.status).toBe('silent');
    // override 5% deprecated → 3% 가 deprecated
    result = getConditionLifecycleStatus(records, 1, {
      now,
      thresholds: { DEPRECATED_THRESHOLD: 0.05 },
    });
    expect(result.status).toBe('deprecated');
  });
});

describe('conditionLifecyclePolicy — getAllConditionLifecycleStatuses', () => {
  it('27 조건 모두 반환', () => {
    const reports = getAllConditionLifecycleStatuses([]);
    expect(reports).toHaveLength(27);
    const ids = reports.map((r) => r.conditionId);
    expect(ids).toEqual(KNOWN_CONDITION_IDS.slice());
  });

  it('각 report 에 conditionName 포함', () => {
    const reports = getAllConditionLifecycleStatuses([]);
    for (const r of reports) {
      expect(typeof r.conditionName).toBe('string');
      expect(r.conditionName.length).toBeGreaterThan(0);
    }
  });
});

describe('conditionLifecyclePolicy — summarizeConditionLifecycle', () => {
  it('빈 reports → total 0', () => {
    const summary = summarizeConditionLifecycle([]);
    expect(summary.total).toBe(0);
    expect(summary.normal).toBe(0);
  });

  it('27 조건 status 카운트', () => {
    const reports = getAllConditionLifecycleStatuses([]);
    const summary = summarizeConditionLifecycle(reports);
    expect(summary.total).toBe(27);
    expect(summary.grace).toBe(27); // 모두 빈 records → grace
    expect(summary.normal).toBe(0);
    expect(summary.silent).toBe(0);
    expect(summary.deprecated).toBe(0);
  });
});
