/**
 * sellEngine.golden.test.ts — 매도 엔진 골든 테스트 10개 시나리오
 *
 * Phase 1 리팩토링 전후 동치성 검증용.
 * 이 파일이 Green 상태일 때만 sellEngine의 수직 분해·Orchestrator 교체가 안전하다.
 */

import { describe, expect, it } from 'vitest';
import {
  evaluateSellSignals,
  checkHardStopLoss,
  evaluatePreMortems,
  checkProfitTargets,
  checkTrailingStop,
  evaluateEuphoria,
} from '../sellEngine';
import type {
  ActivePosition,
  PreMortemData,
  EuphoriaData,
  SellSignal,
} from '../../../types/sell';
import type { RegimeLevel } from '../../../types/core';

// ─── 테스트 픽스처 ───────────────────────────────────────────────────────────

function basePosition(overrides: Partial<ActivePosition> = {}): ActivePosition {
  return {
    id: 'pos_test_001',
    stockCode: '005930',
    name: 'Samsung',
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

function basePreMortemData(overrides: Partial<PreMortemData> = {}): PreMortemData {
  return {
    currentROEType: 3,
    foreignNetBuy5d: 100,
    ma20: 100_000,
    ma60: 99_000,
    currentRegime: 'R2_BULL',
    ...overrides,
  };
}

function baseEuphoria(overrides: Partial<EuphoriaData> = {}): EuphoriaData {
  return {
    rsi14: 50,
    volumeRatio: 1.0,
    retailRatio: 0.30,
    analystUpgradeCount30d: 0,
    ...overrides,
  };
}

// ─── 시나리오 10개 ────────────────────────────────────────────────────────────

describe('sellEngine 골든 시나리오', () => {
  it('[S1] 정상 보유 — 아무 신호도 발동하지 않음', () => {
    const position = basePosition({ currentPrice: 102_000 });
    const signals = evaluateSellSignals({
      position,
      regime: 'R2_BULL',
      preMortemData: basePreMortemData(),
      euphoriaData: baseEuphoria(),
    });
    expect(signals).toEqual([]);
  });

  it('[S2] L1 하드 손절 발동 — 나머지 레이어는 평가되지 않음', () => {
    const position = basePosition({
      currentPrice: 85_000, // -15% (profile A in R2_BULL → stopLoss -0.12)
      profile: 'A',
    });
    const signals = evaluateSellSignals({
      position,
      regime: 'R2_BULL',
      preMortemData: basePreMortemData(),
      euphoriaData: baseEuphoria({ rsi14: 85, volumeRatio: 4.0, retailRatio: 0.7, analystUpgradeCount30d: 6 }),
    });
    expect(signals).toHaveLength(1);
    expect(signals[0].action).toBe('HARD_STOP');
    expect(signals[0].ratio).toBe(1.0);
    expect(signals[0].orderType).toBe('MARKET');
  });

  it('[S3] -7% 도달 — REVALIDATE_GATE1 경보 (매도 아님)', () => {
    const position = basePosition({
      currentPrice: 93_000, // -7%
      profile: 'A',
      revalidated: false,
    });
    const signals = evaluateSellSignals({
      position,
      regime: 'R2_BULL',
      preMortemData: basePreMortemData(),
      euphoriaData: null,
    });
    const reval = signals.find((s: SellSignal) => s.action === 'REVALIDATE_GATE1');
    expect(reval).toBeDefined();
    expect(reval?.ratio).toBe(0);
  });

  it('[S4] R6 DEFENSE 레짐 — 30% 즉시 청산 (HARD_STOP)', () => {
    const position = basePosition({ currentPrice: 100_000 });
    const signal = checkHardStopLoss(position, 'R6_DEFENSE');
    expect(signal).not.toBeNull();
    expect(signal?.action).toBe('HARD_STOP');
    expect(signal?.ratio).toBe(0.30);
    expect(signal?.severity).toBe('CRITICAL');
  });

  it('[S5] L3 분할 익절 +15% — 30% 매도 (R2_BULL profile)', () => {
    const position = basePosition({ currentPrice: 112_000 }); // +12% → R2의 첫 타겟
    const signals = checkProfitTargets(position, 'R2_BULL');
    expect(signals.length).toBeGreaterThan(0);
    expect(signals[0].action).toBe('PROFIT_TAKE');
    expect(signals[0].ratio).toBeCloseTo(0.30, 5);
  });

  it('[S6] 이미 실현된 타겟은 중복 발동하지 않음', () => {
    // R2_BULL 타겟: [trigger=0.12, ratio=0.30] / [trigger=0.20, ratio=0.30] / TRAILING
    // currentPrice=115_000(+15%) → 첫 타겟만 도달, 둘째는 미달
    const position = basePosition({
      currentPrice: 115_000,
      takenProfit: [0.12], // 첫 타겟 이미 실현
    });
    const signals = checkProfitTargets(position, 'R2_BULL');
    // 첫 타겟은 중복 방지로 제외되어야 하고, 둘째 타겟은 아직 미달
    expect(signals).toHaveLength(0);
  });

  it('[S7] L3 트레일링 스톱 — 고점 대비 -10% 하락', () => {
    const position = basePosition({
      currentPrice: 108_000, // 고점 120k에서 -10%
      trailingEnabled: true,
      trailingHighWaterMark: 120_000,
      trailPct: 0.10,
      trailingRemainingRatio: 0.40,
    });
    const signal = checkTrailingStop(position);
    expect(signal).not.toBeNull();
    expect(signal?.action).toBe('TRAILING_STOP');
    expect(signal?.ratio).toBe(0.40);
  });

  it('[S8] L2 Pre-Mortem — ROE 유형 3→4 전이 시 50% 청산', () => {
    const position = basePosition({ entryROEType: 3 });
    const triggers = evaluatePreMortems(
      position,
      basePreMortemData({ currentROEType: 4 }),
    );
    const roeTrigger = triggers.find(t => t.type === 'ROE_DRIFT');
    expect(roeTrigger).toBeDefined();
    expect(roeTrigger?.sellRatio).toBe(0.50);
  });

  it('[S9] L2 Pre-Mortem — 데드크로스 발동 시 전량 청산', () => {
    const position = basePosition({
      prevMa20: 101_000,
      prevMa60: 100_000,
    });
    const triggers = evaluatePreMortems(
      position,
      basePreMortemData({ ma20: 99_000, ma60: 100_000 }),
    );
    const mx = triggers.find(t => t.type === 'MA_DEATH_CROSS');
    expect(mx).toBeDefined();
    expect(mx?.sellRatio).toBe(1.0);
  });

  it('[S10] L4 과열 — 4개 신호 중 3개 이상 → 50% 익절', () => {
    const position = basePosition({ currentPrice: 120_000 });
    const signal = evaluateEuphoria(
      position,
      baseEuphoria({
        rsi14: 85,              // OVERBOUGHT
        volumeRatio: 3.5,       // EXPLOSION
        retailRatio: 0.65,      // RETAIL_DOMINANCE
        analystUpgradeCount30d: 2, // frenzy 아님 → 3/4
      }),
    );
    expect(signal).not.toBeNull();
    expect(signal?.action).toBe('EUPHORIA_SELL');
    expect(signal?.ratio).toBe(0.50);
  });

  // ─── 추가 통합 케이스 ─────────────────────────────────────────────────────
  it('[S11] 과열 2개만 → 신호 없음', () => {
    const position = basePosition();
    const signal = evaluateEuphoria(
      position,
      baseEuphoria({ rsi14: 85, volumeRatio: 4.0 }),
    );
    expect(signal).toBeNull();
  });

  it('[S12] 고점 대비 -30% 추세 붕괴 → TREND_COLLAPSE', () => {
    const position = basePosition({
      highSinceEntry: 150_000,
      currentPrice: 100_000, // -33% drawdown
    });
    const triggers = evaluatePreMortems(position, basePreMortemData());
    const tc = triggers.find(t => t.type === 'TREND_COLLAPSE');
    expect(tc).toBeDefined();
    expect(tc?.sellRatio).toBe(1.0);
  });
});
