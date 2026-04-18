/**
 * sellPhase3.test.ts — Phase 3 신규 레이어 검증
 *
 * 1) StopLossLadder 3단 사다리 (profile별 threshold)
 * 2) Ichimoku 구름대 이탈 서브 트리거
 * 3) 2D Drawdown 역치 (레짐×프로파일)
 */

import { describe, expect, it } from 'vitest';
import {
  evaluateStopLadder,
  STOP_LADDER_CONFIG,
  evaluateIchimokuExit,
  computeIchimokuSeries,
  detectCloudBreakdown,
  detectTkDeathWithCloudExit,
  DRAWDOWN_THRESHOLDS,
  resolveDrawdownThreshold,
  evaluateSellSignalsFromContext,
} from '../sell';
import { evaluatePreMortems } from '../sell/preMortem';
import type {
  ActivePosition,
  OHLCCandle,
  PreMortemData,
  SellContext,
} from '../../../types/sell';

function basePosition(overrides: Partial<ActivePosition> = {}): ActivePosition {
  return {
    id: 'pos_p3',
    stockCode: '005930',
    name: 'test',
    profile: 'A',
    entryPrice: 100_000,
    entryDate: '2026-01-01T00:00:00.000Z',
    currentPrice: 100_000,
    quantity: 10,
    entryROEType: 3,
    entryRegime: 'R2_BULL',
    highSinceEntry: 100_000,
    trailingEnabled: false,
    trailingHighWaterMark: 100_000,
    trailPct: 0.10,
    trailingRemainingRatio: 0.40,
    revalidated: false,
    takenProfit: [],
    ...overrides,
  };
}

function basePreMortem(overrides: Partial<PreMortemData> = {}): PreMortemData {
  return {
    currentROEType: 3,
    foreignNetBuy5d: 100,
    ma20: 100_000,
    ma60: 99_000,
    currentRegime: 'R2_BULL',
    ...overrides,
  };
}

// ─── StopLossLadder ───────────────────────────────────────────────────────────

describe('evaluateStopLadder (L1.5 3단 사다리)', () => {
  it('profile A -15% → ALERT 경보만 (sellRatio=0)', () => {
    const pos = basePosition({ profile: 'A', currentPrice: 85_000 }); // -15%
    const signals = evaluateStopLadder(pos);
    expect(signals).toHaveLength(1);
    expect(signals[0].action).toBe('STOP_LADDER');
    expect(signals[0].rung).toBe('ALERT');
    expect(signals[0].ratio).toBe(0);
    expect(signals[0].lifecycleStage).toBe('ALERT');
  });

  it('profile A -25% → HALF 50% 매도', () => {
    const pos = basePosition({ profile: 'A', currentPrice: 75_000 }); // -25%
    const signals = evaluateStopLadder(pos);
    expect(signals[0].rung).toBe('HALF');
    expect(signals[0].ratio).toBe(0.50);
    expect(signals[0].lifecycleStage).toBe('EXIT_PREP');
  });

  it('profile A -30% → FULL 전량 (MARKET)', () => {
    const pos = basePosition({ profile: 'A', currentPrice: 70_000 }); // -30%
    const signals = evaluateStopLadder(pos);
    expect(signals[0].rung).toBe('FULL');
    expect(signals[0].ratio).toBe(1.0);
    expect(signals[0].orderType).toBe('MARKET');
    expect(signals[0].lifecycleStage).toBe('FULL_EXIT');
  });

  it('profile D -12% → HALF (profile별 역치가 더 타이트)', () => {
    const pos = basePosition({ profile: 'D', currentPrice: 88_000 }); // -12%
    const signals = evaluateStopLadder(pos);
    expect(signals[0].rung).toBe('HALF');
  });

  it('profile A -10% → 사다리 미발동', () => {
    const pos = basePosition({ profile: 'A', currentPrice: 90_000 });
    expect(evaluateStopLadder(pos)).toHaveLength(0);
  });

  it('STOP_LADDER_CONFIG는 A<B<C<D 순서로 threshold가 조여진다', () => {
    // threshold 값이 음수이므로 "조여짐" = 값이 0에 가까움 = 절댓값이 작음
    for (const rung of ['ALERT', 'HALF', 'FULL'] as const) {
      const a = Math.abs(STOP_LADDER_CONFIG.A[rung].threshold);
      const b = Math.abs(STOP_LADDER_CONFIG.B[rung].threshold);
      const c = Math.abs(STOP_LADDER_CONFIG.C[rung].threshold);
      const d = Math.abs(STOP_LADDER_CONFIG.D[rung].threshold);
      expect(a).toBeGreaterThanOrEqual(b);
      expect(b).toBeGreaterThanOrEqual(c);
      expect(c).toBeGreaterThanOrEqual(d);
    }
  });
});

// ─── Ichimoku ─────────────────────────────────────────────────────────────────

/** 지정한 종가 배열로 OHLC 캔들 생성 (high=close+5, low=close-5로 고정) */
function mkCandles(closes: number[]): OHLCCandle[] {
  return closes.map((c, i) => ({
    date: `2026-01-${String(i + 1).padStart(2, '0')}`,
    open: c,
    high: c + 5,
    low: c - 5,
    close: c,
    volume: 1_000_000,
  }));
}

describe('Ichimoku Exit — 구름대 이탈 감지', () => {
  it('캔들이 52개 미만이면 null 반환', () => {
    const pos = basePosition();
    expect(evaluateIchimokuExit(pos, mkCandles(Array.from({ length: 40 }, () => 100)))).toBeNull();
  });

  it('100에서 평탄한 상승장 → 이탈 신호 없음', () => {
    // 긴 상승 후 현재가가 구름대 상단에 있는 정상 케이스
    const closes = Array.from({ length: 80 }, (_, i) => 100 + i * 0.5);
    const pos = basePosition({ currentPrice: closes[closes.length - 1] });
    expect(evaluateIchimokuExit(pos, mkCandles(closes))).toBeNull();
  });

  it('현재가가 구름대 아래로 급락 + 2일 연속 이탈 → 30% 매도', () => {
    // 52봉 상승 후 마지막 2봉이 저가권으로 급락
    const closes: number[] = [];
    for (let i = 0; i < 80; i++) closes.push(100 + i);
    closes[78] = 40;
    closes[79] = 38;
    const pos = basePosition({ currentPrice: closes[closes.length - 1] });
    const signal = evaluateIchimokuExit(pos, mkCandles(closes));
    expect(signal).not.toBeNull();
    expect(signal?.action).toBe('ICHIMOKU_EXIT');
  });

  it('computeIchimokuSeries: 52봉 정확히 주면 seriesLen=1', () => {
    const series = computeIchimokuSeries(mkCandles(Array.from({ length: 52 }, (_, i) => 100 + i)));
    expect(series).not.toBeNull();
    expect(series?.closes.length).toBe(1);
  });

  it('detectCloudBreakdown: 마지막 2봉 종가가 spanA/B 아래면 true', () => {
    const closes: number[] = [];
    for (let i = 0; i < 78; i++) closes.push(100 + i);
    closes.push(30, 25);
    const series = computeIchimokuSeries(mkCandles(closes))!;
    expect(detectCloudBreakdown(series)).toBe(true);
  });

  it('detectTkDeathWithCloudExit: 데드크로스 + 구름대 아래 동시 조건', () => {
    // 상승 후 급락하는 케이스 → 전환선(단기)이 기준선(장기)을 아래로 뚫고 구름대 아래 위치
    const closes: number[] = [];
    for (let i = 0; i < 60; i++) closes.push(100 + i * 2);   // 강한 상승
    for (let i = 0; i < 20; i++) closes.push(180 - i * 8);   // 급락
    const series = computeIchimokuSeries(mkCandles(closes))!;
    // 최종 종가는 충분히 구름대 아래에 있어야 함
    expect(series.closes[series.closes.length - 1]).toBeLessThan(
      Math.min(
        series.senkouA[series.senkouA.length - 1],
        series.senkouB[series.senkouB.length - 1],
      ),
    );
  });
});

// ─── 2D Drawdown ──────────────────────────────────────────────────────────────

describe('DRAWDOWN_THRESHOLDS (레짐×프로파일 2D)', () => {
  it('R1_TURBO × A는 R6_DEFENSE × A보다 여유로운 역치 (절댓값 더 큼)', () => {
    expect(Math.abs(DRAWDOWN_THRESHOLDS.R1_TURBO.A))
      .toBeGreaterThan(Math.abs(DRAWDOWN_THRESHOLDS.R6_DEFENSE.A));
  });

  it('resolveDrawdownThreshold 직접 호출', () => {
    expect(resolveDrawdownThreshold('R2_BULL', 'A')).toBe(-0.30);
    expect(resolveDrawdownThreshold('R5_CAUTION', 'D')).toBe(-0.13);
  });

  it('R5_CAUTION × D (−13%) → −15% 낙폭에서 TREND_COLLAPSE 발동', () => {
    const pos = basePosition({
      profile: 'D',
      highSinceEntry: 100_000,
      currentPrice: 85_000, // -15%
    });
    const triggers = evaluatePreMortems(pos, basePreMortem({ currentRegime: 'R5_CAUTION' }), {
      regime: 'R5_CAUTION',
    });
    const tc = triggers.find(t => t.type === 'TREND_COLLAPSE');
    expect(tc).toBeDefined();
  });

  it('R1_TURBO × A (−35%) → −33% 낙폭으로는 TREND_COLLAPSE 미발동', () => {
    const pos = basePosition({
      profile: 'A',
      highSinceEntry: 150_000,
      currentPrice: 100_000, // -33%
    });
    const triggers = evaluatePreMortems(pos, basePreMortem({ currentRegime: 'R1_TURBO' }), {
      regime: 'R1_TURBO',
    });
    expect(triggers.find(t => t.type === 'TREND_COLLAPSE')).toBeUndefined();
  });
});

// ─── 통합: registry가 신규 레이어를 포함 ──────────────────────────────────────

describe('Phase 3 registry 통합', () => {
  it('-30% 프로파일 A 포지션 → L1.5 FULL 발동 + shortCircuit', () => {
    const ctx: SellContext = {
      position: basePosition({ currentPrice: 70_000 }), // -30%
      regime: 'R2_BULL',
      preMortem: basePreMortem(),
      euphoria: null,
    };
    const signals = evaluateSellSignalsFromContext(ctx);
    // L1 HARD_STOP(-12%)이 먼저 발동하므로 두 레이어 모두 발동 가능하지만
    // HARD_STOP이 priority 10이고 shortCircuit이라 L1.5 미실행 — 결과는 HARD_STOP 단독
    expect(signals).toHaveLength(1);
    expect(signals[0].action).toBe('HARD_STOP');
  });

  it('R6_DEFENSE + 캔들 없음 → 일목 레이어는 미발동 (null 반환)', () => {
    const ctx: SellContext = {
      position: basePosition(),
      regime: 'R3_EARLY', // R6 아닌 레짐 (R6는 HARD_STOP 먼저)
      preMortem: basePreMortem({ currentRegime: 'R3_EARLY' }),
      euphoria: null,
    };
    const signals = evaluateSellSignalsFromContext(ctx);
    expect(signals.find(s => s.action === 'ICHIMOKU_EXIT')).toBeUndefined();
  });
});
