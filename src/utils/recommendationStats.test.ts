/**
 * @responsibility computeSignalBreakdown 단위 테스트 — ADR-0034 PR-G
 */
import { describe, it, expect } from 'vitest';
import { computeSignalBreakdown, type StatsPeriod } from './recommendationStats';
import type { ClientRecommendationRecord } from '../api/recommendationsClient';

const now = Date.UTC(2026, 3, 26, 0, 0, 0);
const ONE_DAY = 24 * 60 * 60 * 1000;

function makeRec(opts: {
  id?: string;
  signalType?: 'STRONG_BUY' | 'BUY';
  status?: 'PENDING' | 'WIN' | 'LOSS' | 'EXPIRED';
  actualReturn?: number;
  daysAgo?: number;
}): ClientRecommendationRecord {
  return {
    id: opts.id ?? 'r',
    stockCode: '000000',
    stockName: 'X',
    signalTime: new Date(now - (opts.daysAgo ?? 0) * ONE_DAY).toISOString(),
    priceAtRecommend: 100,
    stopLoss: 90,
    targetPrice: 110,
    kellyPct: 0,
    gateScore: 7,
    signalType: opts.signalType ?? 'BUY',
    status: opts.status ?? 'PENDING',
    actualReturn: opts.actualReturn,
  };
}

describe('computeSignalBreakdown — ADR-0034 PR-G', () => {
  it('빈 records → 모든 stats 0 + winRate null', () => {
    const r = computeSignalBreakdown([], 'ALL', now);
    expect(r.all.total).toBe(0);
    expect(r.all.winRate).toBeNull();
    expect(r.all.avgReturn).toBeNull();
    expect(r.strongBuy.total).toBe(0);
    expect(r.buy.total).toBe(0);
  });

  it('WIN/LOSS/EXPIRED/PENDING 분류 정확', () => {
    const records = [
      makeRec({ id: '1', status: 'WIN', actualReturn: 10 }),
      makeRec({ id: '2', status: 'LOSS', actualReturn: -5 }),
      makeRec({ id: '3', status: 'EXPIRED' }),
      makeRec({ id: '4', status: 'PENDING' }),
    ];
    const r = computeSignalBreakdown(records, 'ALL', now);
    expect(r.all.total).toBe(4);
    expect(r.all.wins).toBe(1);
    expect(r.all.losses).toBe(1);
    expect(r.all.expired).toBe(1);
    expect(r.all.pending).toBe(1);
    expect(r.all.winRate).toBeCloseTo(0.5, 5); // 1/2
  });

  it('avgReturn 은 closed (WIN+LOSS) 만 평균', () => {
    const records = [
      makeRec({ id: '1', status: 'WIN', actualReturn: 10 }),
      makeRec({ id: '2', status: 'LOSS', actualReturn: -4 }),
      makeRec({ id: '3', status: 'PENDING', actualReturn: 100 }), // 무시
    ];
    const r = computeSignalBreakdown(records, 'ALL', now);
    expect(r.all.avgReturn).toBeCloseTo(3, 5); // (10 + -4) / 2
  });

  it('signalType 별 분리', () => {
    const records = [
      makeRec({ id: '1', signalType: 'STRONG_BUY', status: 'WIN', actualReturn: 15 }),
      makeRec({ id: '2', signalType: 'STRONG_BUY', status: 'WIN', actualReturn: 10 }),
      makeRec({ id: '3', signalType: 'BUY', status: 'LOSS', actualReturn: -5 }),
      makeRec({ id: '4', signalType: 'BUY', status: 'WIN', actualReturn: 8 }),
    ];
    const r = computeSignalBreakdown(records, 'ALL', now);
    expect(r.strongBuy.total).toBe(2);
    expect(r.strongBuy.winRate).toBe(1); // 2/2
    expect(r.buy.total).toBe(2);
    expect(r.buy.winRate).toBe(0.5); // 1/2
  });

  it('period=7d 필터 (8일 이상 전 record 제외)', () => {
    const records = [
      makeRec({ id: '1', status: 'WIN', daysAgo: 1 }),  // 포함
      makeRec({ id: '2', status: 'LOSS', daysAgo: 5 }), // 포함
      makeRec({ id: '3', status: 'WIN', daysAgo: 10 }), // 제외 (>7일)
    ];
    const r = computeSignalBreakdown(records, '7d', now);
    expect(r.all.total).toBe(2);
    expect(r.all.wins).toBe(1);
    expect(r.all.losses).toBe(1);
  });

  it('period=30d 필터', () => {
    const records = [
      makeRec({ id: '1', daysAgo: 5 }),
      makeRec({ id: '2', daysAgo: 25 }),
      makeRec({ id: '3', daysAgo: 35 }), // 제외
    ];
    const r = computeSignalBreakdown(records, '30d', now);
    expect(r.all.total).toBe(2);
  });

  it('period=ALL → 모든 record', () => {
    const records = [
      makeRec({ id: '1', daysAgo: 365 }),
      makeRec({ id: '2', daysAgo: 1 }),
    ];
    const r = computeSignalBreakdown(records, 'ALL', now);
    expect(r.all.total).toBe(2);
  });

  it('sampleSufficient — closed ≥ 5 건일 때만 true', () => {
    const make5 = Array.from({ length: 5 }, (_, i) =>
      makeRec({ id: `${i}`, status: 'WIN', actualReturn: 1 }));
    expect(computeSignalBreakdown(make5, 'ALL', now).all.sampleSufficient).toBe(true);

    const make4 = Array.from({ length: 4 }, (_, i) =>
      makeRec({ id: `${i}`, status: 'WIN', actualReturn: 1 }));
    expect(computeSignalBreakdown(make4, 'ALL', now).all.sampleSufficient).toBe(false);
  });

  it('signalTime 무효 → period 필터에서 제외', () => {
    const records = [
      { ...makeRec({ id: '1', daysAgo: 1 }), signalTime: 'invalid' },
      makeRec({ id: '2', daysAgo: 1 }),
    ];
    const r = computeSignalBreakdown(records, '7d', now);
    expect(r.all.total).toBe(1);
  });

  it('actualReturn=NaN → avgReturn 계산 제외', () => {
    const records = [
      makeRec({ id: '1', status: 'WIN', actualReturn: 10 }),
      makeRec({ id: '2', status: 'LOSS', actualReturn: NaN }),
    ];
    const r = computeSignalBreakdown(records, 'ALL', now);
    expect(r.all.avgReturn).toBe(10); // NaN 제외, WIN 10 만
  });
});
