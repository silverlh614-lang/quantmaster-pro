/**
 * sellPhase5.test.ts — Phase 5 자기학습 루프 검증
 *
 * 1) sellAuditLog: verdict 계산 + 레이어별 신뢰도 집계
 * 2) shadowSellMode: 기회 손익 계산 + 레이어 통계
 * 3) preFlightSellSim: 5가지 시나리오 출력 + 경보 수준
 */

import { describe, expect, it } from 'vitest';
import {
  buildAuditEntry,
  computeVerdict,
  aggregateLayerReliability,
  buildShadowRecord,
  evaluateShadowOutcome,
  aggregateShadowStats,
  isShadowMode,
  runPreFlightSellSim,
  type SellAuditEntry,
  type ShadowSellRecord,
} from '../sell';
import type {
  ActivePosition,
  SellContext,
  PreMortemData,
  SellSignal,
} from '../../../types/sell';

function basePosition(overrides: Partial<ActivePosition> = {}): ActivePosition {
  return {
    id: 'pos_p5',
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

// ─── sellAuditLog ─────────────────────────────────────────────────────────────

describe('sellAuditLog — 감사 로그', () => {
  it('buildAuditEntry: 기본 필드 채움 + verdict=PENDING', () => {
    const entry = buildAuditEntry({
      position: basePosition(),
      triggeredSignals: [{ action: 'HARD_STOP', ratio: 1, orderType: 'MARKET', reason: 'x' }],
      triggeredLayerIds: ['L1_HARD_STOP'],
      winningLayerId: 'L1_HARD_STOP',
      winningSignal: { action: 'HARD_STOP', ratio: 1, orderType: 'MARKET', reason: 'x' },
      executedPrice: 85_000,
      executedRatio: 1.0,
      regime: 'R2_BULL',
      now: 1_000_000,
    });
    expect(entry.returnAt).toBeCloseTo(-0.15, 5);
    expect(entry.verdict).toBe('PENDING');
    expect(entry.winningLayer).toBe('L1_HARD_STOP');
    expect(entry.timestamp).toBe(1_000_000);
  });

  it('computeVerdict: 매도 후 더 떨어졌으면 CORRECT', () => {
    const entry: SellAuditEntry = {
      id: 'e1', positionId: 'p', stockCode: 'x', timestamp: 0,
      triggeredLayers: ['L1'], winningLayer: 'L1', action: 'HARD_STOP', sellRatio: 1,
      priceAt: 85_000, returnAt: -0.15,
      regime: 'R2_BULL', roeType: undefined, ichimokuState: undefined,
      subsequentReturn30d: -0.25, // 매도 안 했으면 -25%까지 갔음
      verdict: 'PENDING',
    };
    expect(computeVerdict(entry)).toBe('CORRECT');
  });

  it('computeVerdict: 매도 후 더 올랐으면 REGRET', () => {
    const entry: SellAuditEntry = {
      id: 'e2', positionId: 'p', stockCode: 'x', timestamp: 0,
      triggeredLayers: ['L4'], winningLayer: 'L4_EUPHORIA', action: 'EUPHORIA_SELL', sellRatio: 0.5,
      priceAt: 120_000, returnAt: 0.20,
      regime: 'R2_BULL', roeType: undefined, ichimokuState: undefined,
      subsequentReturn30d: 0.35,
      verdict: 'PENDING',
    };
    expect(computeVerdict(entry)).toBe('REGRET');
  });

  it('computeVerdict: ±3% 밴드 안이면 NEUTRAL', () => {
    const entry: SellAuditEntry = {
      id: 'e3', positionId: 'p', stockCode: 'x', timestamp: 0,
      triggeredLayers: ['L3'], winningLayer: 'L3', action: 'PROFIT_TAKE', sellRatio: 0.3,
      priceAt: 112_000, returnAt: 0.12,
      regime: 'R2_BULL', roeType: undefined, ichimokuState: undefined,
      subsequentReturn30d: 0.14,
      verdict: 'PENDING',
    };
    expect(computeVerdict(entry)).toBe('NEUTRAL');
  });

  it('aggregateLayerReliability: 레이어별 accuracy 계산', () => {
    const mkEntry = (layer: string, verdict: SellAuditEntry['verdict']): SellAuditEntry => ({
      id: `${layer}_${verdict}_${Math.random()}`,
      positionId: 'p', stockCode: 'x', timestamp: 0,
      triggeredLayers: [layer], winningLayer: layer, action: 'HARD_STOP', sellRatio: 1,
      priceAt: 0, returnAt: 0, regime: 'R2_BULL', roeType: undefined, ichimokuState: undefined,
      verdict,
    });
    const entries: SellAuditEntry[] = [
      mkEntry('L1_HARD_STOP', 'CORRECT'),
      mkEntry('L1_HARD_STOP', 'CORRECT'),
      mkEntry('L1_HARD_STOP', 'CORRECT'),
      mkEntry('L1_HARD_STOP', 'CORRECT'),
      mkEntry('L1_HARD_STOP', 'REGRET'),
      mkEntry('L4_EUPHORIA', 'CORRECT'),
      mkEntry('L4_EUPHORIA', 'REGRET'),
      mkEntry('L4_EUPHORIA', 'REGRET'),
      mkEntry('L4_EUPHORIA', 'PENDING'),
    ];
    const stats = aggregateLayerReliability(entries);
    const l1 = stats.find(s => s.layerId === 'L1_HARD_STOP')!;
    const l4 = stats.find(s => s.layerId === 'L4_EUPHORIA')!;
    expect(l1.accuracy).toBeCloseTo(0.80, 5);  // 4 correct / (4+1)
    expect(l4.accuracy).toBeCloseTo(1 / 3, 5);  // 1 correct / (1+2)
    // 정확도 낮은 쪽이 먼저 (L4 먼저)
    expect(stats[0].layerId).toBe('L4_EUPHORIA');
  });
});

// ─── shadowSellMode ──────────────────────────────────────────────────────────

describe('shadowSellMode — 가상 매도 평가', () => {
  it('buildShadowRecord 기본 필드', () => {
    const r = buildShadowRecord({
      positionId: 'p1',
      stockCode: '005930',
      layerId: 'L3_PROFIT_TAKE',
      signal: { action: 'PROFIT_TAKE', ratio: 0.3, orderType: 'LIMIT', reason: 'x' },
      shadowPrice: 112_000,
      now: 1_000_000,
    });
    expect(r.layerId).toBe('L3_PROFIT_TAKE');
    expect(r.shadowPrice).toBe(112_000);
    expect(r.timestamp).toBe(1_000_000);
  });

  it('evaluateShadowOutcome: 가격이 올랐으면 opportunityGain > 0 (매도 안 할 걸)', () => {
    const r: ShadowSellRecord = {
      id: 's1', positionId: 'p', stockCode: 'x', timestamp: 0,
      layerId: 'L3', action: 'PROFIT_TAKE', sellRatio: 0.3,
      shadowPrice: 100_000, priceAfter30d: 110_000,
    };
    const o = evaluateShadowOutcome(r, '30d');
    expect(o.judged).toBe(true);
    expect(o.opportunityGain).toBeCloseTo(0.10, 5);
  });

  it('evaluateShadowOutcome: priceAfter 미기록 → judged=false', () => {
    const r: ShadowSellRecord = {
      id: 's2', positionId: 'p', stockCode: 'x', timestamp: 0,
      layerId: 'L3', action: 'PROFIT_TAKE', sellRatio: 0.3,
      shadowPrice: 100_000,
    };
    expect(evaluateShadowOutcome(r, '30d').judged).toBe(false);
  });

  it('aggregateShadowStats: 레이어별 avg + regretRate', () => {
    const mk = (layer: string, shadow: number, after30: number): ShadowSellRecord => ({
      id: `s_${layer}_${shadow}`, positionId: 'p', stockCode: 'x', timestamp: 0,
      layerId: layer, action: 'PROFIT_TAKE', sellRatio: 0.3,
      shadowPrice: shadow, priceAfter30d: after30,
    });
    const records: ShadowSellRecord[] = [
      mk('L3_PROFIT_TAKE', 100, 110), // +10% 기회손실 (팔면 후회)
      mk('L3_PROFIT_TAKE', 100, 108), // +8%
      mk('L3_PROFIT_TAKE', 100, 95),  // -5% (매도가 옳음)
      mk('L4_EUPHORIA', 100, 120),   // +20%
    ];
    const stats = aggregateShadowStats(records);
    const l3 = stats.find(s => s.layerId === 'L3_PROFIT_TAKE')!;
    expect(l3.triggerCount).toBe(3);
    expect(l3.avgOpportunityGain30d).toBeCloseTo((0.10 + 0.08 - 0.05) / 3, 5);
    expect(l3.regretRate30d).toBeCloseTo(2 / 3, 5); // 3개 중 2개가 +3% 초과 기회손실
  });

  it('isShadowMode: flag 토글', () => {
    expect(isShadowMode(undefined)).toBe(false);
    expect(isShadowMode({ enabled: false })).toBe(false);
    expect(isShadowMode({ enabled: true })).toBe(true);
  });
});

// ─── preFlightSellSim ────────────────────────────────────────────────────────

describe('runPreFlightSellSim — 5가지 시나리오', () => {
  const baseCtx = (): SellContext => ({
    position: basePosition(),
    regime: 'R2_BULL',
    preMortem: basePreMortem(),
    euphoria: null,
  });

  it('모든 5개 시나리오가 결과에 포함됨', () => {
    const report = runPreFlightSellSim(baseCtx());
    expect(report.scenarios).toHaveLength(5);
    const ids = report.scenarios.map(s => s.scenarioId);
    expect(ids).toEqual([
      'DAILY_CRASH_7',
      'ROE_TYPE4_TRANSITION',
      'ICHIMOKU_BREAKDOWN',
      'FOREIGN_SELLOUT_5D',
      'REGIME_R6_SHIFT',
    ]);
  });

  it('DAILY_CRASH_7 시나리오: expectedReturn ≈ -7%', () => {
    const report = runPreFlightSellSim(baseCtx());
    const s = report.scenarios.find(x => x.scenarioId === 'DAILY_CRASH_7')!;
    expect(s.expectedReturn).toBeCloseTo(-0.07, 2);
    // -7%면 REVALIDATE_GATE1 경보는 발동 (매도 아님)
    expect(s.triggeredSignals.some(sig => sig.action === 'REVALIDATE_GATE1')).toBe(true);
  });

  it('REGIME_R6_SHIFT 시나리오: HARD_STOP 30% 발동 (R6 비상 청산)', () => {
    const report = runPreFlightSellSim(baseCtx());
    const s = report.scenarios.find(x => x.scenarioId === 'REGIME_R6_SHIFT')!;
    const hs = s.triggeredSignals.find(sig => sig.action === 'HARD_STOP');
    expect(hs).toBeDefined();
    expect(hs?.ratio).toBe(0.30);
  });

  it('FOREIGN_SELLOUT_5D 시나리오: PRE_MORTEM FOREIGN_SELLOUT 발동', () => {
    const report = runPreFlightSellSim(baseCtx());
    const s = report.scenarios.find(x => x.scenarioId === 'FOREIGN_SELLOUT_5D')!;
    const pm = s.triggeredSignals.find(sig => sig.action === 'PRE_MORTEM');
    expect(pm).toBeDefined();
    expect(pm?.reason).toContain('외국인');
  });

  it('ROE_TYPE4_TRANSITION 시나리오: PRE_MORTEM ROE_DRIFT 발동 (50% 매도)', () => {
    const report = runPreFlightSellSim(baseCtx());
    const s = report.scenarios.find(x => x.scenarioId === 'ROE_TYPE4_TRANSITION')!;
    const roe = s.triggeredSignals.find(sig => sig.action === 'PRE_MORTEM' && sig.ratio === 0.5);
    expect(roe).toBeDefined();
  });

  it('worstExpectedReturn은 가장 낮은 값이어야 함', () => {
    const report = runPreFlightSellSim(baseCtx());
    const minFromScenarios = Math.min(...report.scenarios.map(s => s.expectedReturn));
    expect(report.worstExpectedReturn).toBe(minFromScenarios);
  });

  it('warningLevel: R6 shift로 HARD_STOP 있으면 CRITICAL', () => {
    // R6 shift에서 HARD_STOP ratio=0.30이므로 FULL_EXIT는 아님.
    // 하지만 ICHIMOKU_BREAKDOWN 시나리오가 75% 가격이므로 -25% < -20% → CRITICAL
    const report = runPreFlightSellSim(baseCtx());
    expect(report.warningLevel).toBe('CRITICAL');
  });

  it('dominantSignal은 가장 severity 높은 신호', () => {
    const report = runPreFlightSellSim(baseCtx());
    const r6 = report.scenarios.find(x => x.scenarioId === 'REGIME_R6_SHIFT')!;
    expect(r6.dominantSignal).not.toBeNull();
    expect(r6.dominantSignal?.severity).toBe('CRITICAL');
  });
});
