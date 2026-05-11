/**
 * stage1Audit.test.ts — BUG #1 회귀.
 *
 * evaluateStage1Filter 가 탈락 사유를 정확히 반환하고,
 * evaluateStage1FilterTracked 가 카운터를 정확히 누적하는지 검증.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import {
  evaluateStage1Filter, evaluateStage1FilterTracked,
  resetStage1RejectionCounts, getStage1RejectionCounts,
  projectIntradayVolume,
} from './pipelineHelpers.js';
import type { YahooQuoteExtended } from './stockScreener.js';

function q(overrides: Partial<YahooQuoteExtended> = {}): YahooQuoteExtended {
  return {
    symbol: 'TEST.KS', name: 't',
    price: 10_000, volume: 200_000, avgVolume: 100_000,
    atr: 300, atr20avg: 500,
    changePercent: 1.5,
    per: 10, ma20: 9_500, ma5: 9_800,
    rsi14: 50, rsi5dAgo: 45,
    isHighRisk: false,
    return5d: 3, high20d: 10_500, low20d: 9_000,
    recentCloses10d: undefined, recentVolumes10d: undefined,
    recentHighs10d: undefined, recentLows10d: undefined,
    dailyVolumeDrying: false,
    ...overrides,
  } as YahooQuoteExtended;
}

describe('evaluateStage1Filter — 사유 분기', () => {
  it('정상 통과 → pass=true, reason=undefined', () => {
    const r = evaluateStage1Filter(q());
    expect(r.pass).toBe(true);
    expect(r.reason).toBeUndefined();
  });

  it('MIN_PRICE: price < 3000', () => {
    expect(evaluateStage1Filter(q({ price: 2000 }))).toEqual({ pass: false, reason: 'MIN_PRICE' });
  });

  it('HIGH_RISK: isHighRisk=true', () => {
    expect(evaluateStage1Filter(q({ isHighRisk: true }))).toEqual({ pass: false, reason: 'HIGH_RISK' });
  });

  it('OVERHEAT: changePercent ≥ 8', () => {
    expect(evaluateStage1Filter(q({ changePercent: 8.5 }))).toEqual({ pass: false, reason: 'OVERHEAT' });
  });

  it('HIGH_PER: PER 80이라도 모멘텀/추세 보완 신호가 있으면 통과', () => {
    expect(evaluateStage1Filter(q({ per: 80, return20d: 6, price: 10_000, ma20: 9_500 }))).toEqual({ pass: true });
  });

  it('HIGH_PER: PER 160이고 보완 신호가 없으면 reject 유지', () => {
    expect(evaluateStage1Filter(q({
      per: 160,
      return20d: 0,
      return5d: 0,
      price: 10_000,
      ma20: 0,
      changePercent: 0,
      avgVolume: 0,
      atr: 500,
      atr20avg: 500,
      rsi14: 30,
    }))).toEqual({ pass: false, reason: 'HIGH_PER' });
  });

  it('HIGH_PER: PER <= 0은 HIGH_PER reject가 아니다', () => {
    expect(evaluateStage1Filter(q({ per: 0 }))).toEqual({ pass: true });
    expect(evaluateStage1Filter(q({ per: -5 }))).toEqual({ pass: true });
  });

  it('OVEREXTENDED: return5d > 15', () => {
    expect(evaluateStage1Filter(q({ return5d: 20 }))).toEqual({ pass: false, reason: 'OVEREXTENDED' });
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('LOW_VOLUME: 10:15 KST에는 avgVolume 25% 누적 거래량도 projection 기준으로 통과 가능', () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-05-11T01:15:00.000Z')); // 10:15 KST

    const r = evaluateStage1Filter(q({
      volume: 25_000, avgVolume: 100_000,  // 0.25× 누적 → projectedVolume ≈ 1.3×
      atr: 500, atr20avg: 500,             // not VCP
      changePercent: 1,                    // positive, no pullback consideration
    }));
    expect(r.pass).toBe(true);
    expect(r.reason).toBeUndefined();
  });

  it('LOW_VOLUME: 장후 15:30 이후에도 추세 보완 신호가 있으면 통과', () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-05-11T06:31:00.000Z')); // 15:31 KST

    const r = evaluateStage1Filter(q({
      volume: 50_000, avgVolume: 100_000,  // 0.5× — projection 이후에도 부족
      atr: 500, atr20avg: 500,             // not VCP
      price: 10_000, ma20: 9_500,          // 추세 보완 신호
      changePercent: 0,
      return20d: 0, return5d: 0, rsi14: 80,
    }));
    expect(r.pass).toBe(true);
    expect(r.reason).toBeUndefined();
  });

  it('LOW_VOLUME: 보완 신호가 없으면 reject 유지', () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-05-11T06:31:00.000Z')); // 15:31 KST

    const r = evaluateStage1Filter(q({
      volume: 50_000, avgVolume: 100_000,
      atr: 500, atr20avg: 500,
      price: 10_000, ma20: 0,
      changePercent: 0,
      return20d: 0, return5d: 0, rsi14: 80,
    }));
    expect(r.pass).toBe(false);
    expect(r.reason).toBe('LOW_VOLUME');
  });

  it('projectIntradayVolume: volume <= 0 이면 0 반환', () => {
    expect(projectIntradayVolume(0, new Date('2026-05-11T01:15:00.000Z'))).toBe(0);
    expect(projectIntradayVolume(-1, new Date('2026-05-11T01:15:00.000Z'))).toBe(0);
  });

  it('LOW_VOLUME: avgVolume <= 0 이면 hard reject 하지 않음', () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-05-11T06:31:00.000Z')); // 15:31 KST

    const r = evaluateStage1Filter(q({
      volume: 0,
      avgVolume: 0,
      atr: 500,
      atr20avg: 500,
      changePercent: 1,
    }));
    expect(r.pass).toBe(true);
    expect(r.reason).toBeUndefined();
  });

  it('LOW_VOLUME: volume 0은 LOW_VOLUME hard reject 하지 않음', () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-05-11T06:31:00.000Z')); // 15:31 KST

    const r = evaluateStage1Filter(q({
      volume: 0,
      avgVolume: 100_000,
      atr: 500,
      atr20avg: 500,
      changePercent: 0,
      return20d: 0,
      return5d: 0,
      ma20: 0,
      rsi14: 80,
    }));
    expect(r.pass).toBe(true);
    expect(r.reason).toBeUndefined();
  });

  it('NEGATIVE_DAY: -0.5%라도 추세/20일 수익률 보완 신호가 있으면 통과', () => {
    expect(evaluateStage1Filter(q({
      changePercent: -0.5,
      price: 10_000,
      ma20: 9_500,
      return20d: 1,
    }))).toEqual({ pass: true });
  });

  it('NEGATIVE_DAY: 보완 신호가 없으면 reject 유지', () => {
    expect(evaluateStage1Filter(q({
      changePercent: -0.5,
      price: 10_000,
      ma20: 11_000,
      ma60: 11_500,
      return20d: 0,
      return5d: 0,
      atr: 500,
      atr20avg: 500,
      rsi14: 80,
    }))).toEqual({ pass: false, reason: 'NEGATIVE_DAY' });
  });

  it('EXCESSIVE_DRAWDOWN: -3%는 NEGATIVE_DAY 완화와 무관하게 reject 유지', () => {
    expect(evaluateStage1Filter(q({
      changePercent: -3,
      price: 10_000,
      ma20: 9_500,
      return20d: 1,
    }))).toEqual({ pass: false, reason: 'EXCESSIVE_DRAWDOWN' });
  });
});

describe('evaluateStage1FilterTracked — 카운터 누적', () => {
  beforeEach(() => resetStage1RejectionCounts());

  it('reset → 모든 카운터 0', () => {
    const s = getStage1RejectionCounts();
    expect(s.totalEvaluated).toBe(0);
    expect(s.totalPassed).toBe(0);
    expect(s.totalRejected).toBe(0);
    expect(Object.values(s.byReason).every(n => n === 0)).toBe(true);
  });

  it('통과 1 + 탈락 2 (다른 사유) → 카운터 정확 누적', () => {
    evaluateStage1FilterTracked(q());                            // 통과
    evaluateStage1FilterTracked(q({ price: 1000 }));             // MIN_PRICE
    evaluateStage1FilterTracked(q({ changePercent: 10 }));       // OVERHEAT
    const s = getStage1RejectionCounts();
    expect(s.totalEvaluated).toBe(3);
    expect(s.totalPassed).toBe(1);
    expect(s.totalRejected).toBe(2);
    expect(s.byReason.MIN_PRICE).toBe(1);
    expect(s.byReason.OVERHEAT).toBe(1);
    expect(s.byReason.HIGH_PER).toBe(0);
  });

  it('동일 사유 반복 → 해당 사유 카운터만 증가', () => {
    for (let i = 0; i < 5; i++) {
      evaluateStage1FilterTracked(q({ return5d: 20 }));
    }
    const s = getStage1RejectionCounts();
    expect(s.totalRejected).toBe(5);
    expect(s.byReason.OVEREXTENDED).toBe(5);
  });
});
