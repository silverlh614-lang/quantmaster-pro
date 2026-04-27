/**
 * @responsibility buildRecommendationTimeseries 단위 테스트 — PR-M
 */
import { describe, it, expect } from 'vitest';
import { buildRecommendationTimeseries } from './recommendationsRouter.js';

const ONE_DAY = 24 * 60 * 60 * 1000;

// 2026-04-26 KST 자정 = UTC 2026-04-25 15:00
const NOW = Date.UTC(2026, 3, 26, 9, 0, 0); // KST 18:00

function rec(daysAgo: number, status: string, actualReturn?: number, opts: { hour?: number } = {}) {
  // KST 자정 - daysAgo + 옵셔널 시간
  const kstMidnightUtc = Date.UTC(2026, 3, 26) - 9 * 3_600_000 - daysAgo * ONE_DAY;
  const ts = kstMidnightUtc + ((opts.hour ?? 12) * 3_600_000);
  return {
    signalTime: new Date(ts).toISOString(),
    status,
    actualReturn,
  };
}

describe('buildRecommendationTimeseries — PR-M', () => {
  it('빈 records → days 일치 빈 슬롯', () => {
    const r = buildRecommendationTimeseries([], 7, NOW);
    expect(r).toHaveLength(7);
    expect(r.every(p => p.total === 0 && p.winRate === null)).toBe(true);
  });

  it('days=7 → 정확히 7개 슬롯, 정렬 (오늘이 마지막)', () => {
    const r = buildRecommendationTimeseries([], 7, NOW);
    expect(r).toHaveLength(7);
    // 마지막이 오늘 (2026-04-26)
    expect(r[r.length - 1].date).toBe('2026-04-26');
    // 첫번째가 6일 전 (2026-04-20)
    expect(r[0].date).toBe('2026-04-20');
  });

  it('records 일별 그룹핑 정확', () => {
    const records = [
      rec(0, 'WIN', 5),
      rec(0, 'WIN', 3),
      rec(0, 'LOSS', -2),
      rec(1, 'WIN', 10),
      rec(1, 'PENDING'),
      rec(2, 'EXPIRED'),
    ];
    const r = buildRecommendationTimeseries(records, 7, NOW);
    const today = r[r.length - 1];
    const yesterday = r[r.length - 2];
    expect(today.total).toBe(3);
    expect(today.wins).toBe(2);
    expect(today.losses).toBe(1);
    expect(today.winRate).toBeCloseTo(2 / 3, 5);
    expect(today.avgReturn).toBeCloseTo((5 + 3 - 2) / 3, 5);

    expect(yesterday.total).toBe(2);
    expect(yesterday.wins).toBe(1);
    expect(yesterday.pending).toBe(1);
    expect(yesterday.winRate).toBe(1); // 1/1 closed
  });

  it('avgReturn 은 closed (WIN/LOSS) 만 평균', () => {
    const records = [
      rec(0, 'WIN', 10),
      rec(0, 'PENDING', 100), // PENDING 은 actualReturn 무시
    ];
    const r = buildRecommendationTimeseries(records, 7, NOW);
    expect(r[r.length - 1].avgReturn).toBe(10);
  });

  it('range 밖 records 는 무시', () => {
    const records = [
      rec(0, 'WIN', 5),
      rec(10, 'WIN', 100), // 10일 전 — 7일 range 밖
    ];
    const r = buildRecommendationTimeseries(records, 7, NOW);
    expect(r.reduce((sum, p) => sum + p.total, 0)).toBe(1);
  });

  it('days=1 (오늘만)', () => {
    const r = buildRecommendationTimeseries([rec(0, 'WIN', 1)], 1, NOW);
    expect(r).toHaveLength(1);
    expect(r[0].total).toBe(1);
  });

  it('days=90 (최대) 절삭', () => {
    const r = buildRecommendationTimeseries([], 9999, NOW);
    expect(r).toHaveLength(90);
  });

  it('days=0/-5 → 1로 보정', () => {
    expect(buildRecommendationTimeseries([], 0, NOW)).toHaveLength(1);
    expect(buildRecommendationTimeseries([], -5, NOW)).toHaveLength(1);
  });

  it('signalTime 무효 → 무시', () => {
    const records = [
      { signalTime: 'invalid', status: 'WIN' },
      { signalTime: undefined, status: 'WIN' },
      rec(0, 'WIN', 1),
    ];
    const r = buildRecommendationTimeseries(records, 7, NOW);
    expect(r.reduce((sum, p) => sum + p.total, 0)).toBe(1);
  });

  it('actualReturn=NaN → avgReturn 계산 제외', () => {
    const records = [
      rec(0, 'WIN', 10),
      rec(0, 'LOSS', NaN),
    ];
    const r = buildRecommendationTimeseries(records, 7, NOW);
    // closed 2건 → winRate 0.5, avgReturn 은 NaN 제외 → 10
    expect(r[r.length - 1].winRate).toBe(0.5);
    expect(r[r.length - 1].avgReturn).toBe(10);
  });

  it('winRate=null when closed=0', () => {
    const records = [rec(0, 'PENDING'), rec(0, 'EXPIRED')];
    const r = buildRecommendationTimeseries(records, 7, NOW);
    expect(r[r.length - 1].winRate).toBeNull();
  });
});
