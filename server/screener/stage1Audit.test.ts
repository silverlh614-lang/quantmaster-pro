/**
 * stage1Audit.test.ts — BUG #1 회귀.
 *
 * evaluateStage1Filter 가 탈락 사유를 정확히 반환하고,
 * evaluateStage1FilterTracked 가 카운터를 정확히 누적하는지 검증.
 */

import { describe, it, expect, beforeEach } from 'vitest';
import {
  evaluateStage1Filter, evaluateStage1FilterTracked,
  resetStage1RejectionCounts, getStage1RejectionCounts,
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

  it('HIGH_PER: per > 60', () => {
    expect(evaluateStage1Filter(q({ per: 75 }))).toEqual({ pass: false, reason: 'HIGH_PER' });
  });

  it('OVEREXTENDED: return5d > 15', () => {
    expect(evaluateStage1Filter(q({ return5d: 20 }))).toEqual({ pass: false, reason: 'OVEREXTENDED' });
  });

  it('LOW_VOLUME: volume < avg×1.2 & !VCP & !pullback', () => {
    const r = evaluateStage1Filter(q({
      volume: 50_000, avgVolume: 100_000,  // 0.5× — fails
      atr: 500, atr20avg: 500,             // not VCP
      changePercent: 1,                     // positive, no pullback consideration
    }));
    expect(r.pass).toBe(false);
    expect(r.reason).toBe('LOW_VOLUME');
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
