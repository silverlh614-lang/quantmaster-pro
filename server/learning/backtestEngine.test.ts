// @responsibility backtestEngine 회귀 — KIS 일봉 OHLCV, NO_DATA 정직표기, MDD 복리 [-100,0] 바운드.
import { describe, it, expect } from 'vitest';
import {
  simulateTrade,
  aggregateStats,
  type BacktestTradeResult,
  type OHLCVDay,
} from './backtestEngine.js';
import type { RecommendationRecord } from './recommendationTracker.js';

function rec(overrides: Partial<RecommendationRecord> = {}): RecommendationRecord {
  return {
    id: 't1',
    stockCode: '005930',
    signalTime: '2026-04-01T00:00:00.000Z',
    priceAtRecommend: 10000,
    stopLoss: 9000,
    targetPrice: 11000,
    status: 'PENDING',
    ...overrides,
  } as unknown as RecommendationRecord;
}
function day(date: string, o: number, h: number, l: number, c: number): OHLCVDay {
  return { date, open: o, high: h, low: l, close: c };
}
function trade(o: Partial<BacktestTradeResult> = {}): BacktestTradeResult {
  return {
    id: 'x', code: '005930', entryDate: '2026-04-01', exitDate: '2026-04-02',
    outcome: 'EXPIRED', returnPct: 0, holdingDays: 1, source: 'KIS_DAILY', ...o,
  };
}

describe('backtestEngine.simulateTrade (Naver OHLCV)', () => {
  it('목표가 고가 도달 → WIN', () => {
    const r = simulateTrade(rec(), [day('2026-04-02', 10000, 11200, 9900, 11000)]);
    expect(r.outcome).toBe('WIN');
    expect(r.source).toBe('KIS_DAILY');
    expect(r.holdingDays).toBe(1);
  });

  it('손절가 저가 도달 → LOSS', () => {
    const r = simulateTrade(rec(), [day('2026-04-02', 10000, 10100, 8900, 9000)]);
    expect(r.outcome).toBe('LOSS');
  });

  it('미도달 + 30봉 미만 → EXPIRED (마지막 종가)', () => {
    const r = simulateTrade(rec(), [
      day('2026-04-02', 10000, 10100, 9900, 10050),
      day('2026-04-03', 10050, 10200, 9950, 10100),
    ]);
    expect(r.outcome).toBe('EXPIRED');
    expect(r.holdingDays).toBe(2);
  });

  it('OHLCV 빈 배열 → NO_DATA (EXPIRED 위장·stored return 재사용 금지)', () => {
    const r = simulateTrade(rec({ actualReturn: -2.79 } as Partial<RecommendationRecord>), []);
    expect(r.outcome).toBe('NO_DATA');
    expect(r.returnPct).toBe(0);   // stored actualReturn(-2.79) 재사용 안 함
    expect(r.holdingDays).toBe(0);
  });
});

describe('backtestEngine.aggregateStats', () => {
  it('NO_DATA 집계 제외 — winRate 는 resolved 기준, noData 별도 카운트', () => {
    const s = aggregateStats([
      trade({ outcome: 'WIN', returnPct: 10 }),
      trade({ outcome: 'NO_DATA', returnPct: 0 }),
      trade({ outcome: 'LOSS', returnPct: -5 }),
    ]);
    expect(s.totalTrades).toBe(3);
    expect(s.resolved).toBe(2);
    expect(s.noData).toBe(1);
    expect(s.winRate).toBe(50); // 1 win / 2 resolved
  });

  it('MDD 는 복리 자본곡선 — [-100,0] 바운드 (단순 %합산 −150% 불가)', () => {
    const s = aggregateStats([
      trade({ outcome: 'LOSS', returnPct: -50, exitDate: '2026-04-02' }),
      trade({ outcome: 'LOSS', returnPct: -50, exitDate: '2026-04-03' }),
      trade({ outcome: 'LOSS', returnPct: -50, exitDate: '2026-04-04' }),
    ]);
    expect(s.mdd).toBeGreaterThanOrEqual(-100);
    expect(s.mdd).toBeCloseTo(-87.5, 1); // 1·0.5·0.5·0.5=0.125 → peak1 대비 -87.5%
  });

  it('-100% 단일 거래 → MDD 정확히 -100 (바운드 floor)', () => {
    const s = aggregateStats([trade({ outcome: 'LOSS', returnPct: -100, exitDate: '2026-04-02' })]);
    expect(s.mdd).toBe(-100);
  });

  it('전건 NO_DATA → resolved 0, 지표 degenerate 0', () => {
    const s = aggregateStats([trade({ outcome: 'NO_DATA' }), trade({ outcome: 'NO_DATA' })]);
    expect(s.resolved).toBe(0);
    expect(s.noData).toBe(2);
    expect(s.winRate).toBe(0);
    expect(s.mdd).toBe(0);
  });
});
