import { describe, expect, it } from 'vitest';

import {
  applySimpleTrailingStop,
  applyTp1BreakevenMove,
  attachTradePlanToPositionState,
  computeTradePlan,
  formatPositionTradePlanAttachedLog,
  formatRrInsufficientObservedLog,
  formatStopMovedToBreakevenAfterTp1Log,
  formatTradePlanResolvedLog,
  type PriceSnapshot,
} from './priceSnapshotSsot.js';
import { recordCounterfactualForDecision } from './gates/counterfactualAlwaysOn.js';
import { resolveSimpleTradeDecision } from './gates/simpleDecision.js';
import { renderDisplayState, type DisplayState } from '../telegram/displayState.js';

const NOW = '2026-05-21T00:05:00.000Z';

function snapshot(overrides: Partial<PriceSnapshot> = {}): PriceSnapshot {
  return {
    snapshotId: 'scan_trade_plan_1',
    priceSnapshotId: 'ps_trade_plan_1',
    symbol: '005930',
    asOf: '2026-05-21T00:04:55.000Z',
    tradingDate: '2026-05-21',
    currentPrice: 10_000,
    source: 'KIS_REALTIME_QUOTE',
    confidence: 'REALTIME',
    ageSec: 5,
    isTradableNow: true,
    isMarketOpen: true,
    priceUsableForDecision: true,
    priceUsableForExecution: true,
    priceUsableForShadowFill: true,
    ...overrides,
  };
}

describe('Simplification Step 14 TradePlan SSOT', () => {
  it('A. resolves the default fixed-percent and fixed-RR TradePlan', () => {
    const plan = computeTradePlan(snapshot(), { computedAt: NOW });

    expect(plan.entryPrice).toBe(10_000);
    expect(plan.initialStopLoss).toBe(9_500);
    expect(plan.currentStopLoss).toBe(9_500);
    expect(plan.targetPrice1).toBe(11_000);
    expect(plan.riskReward1).toBe(2);
    expect(plan.status).toBe('VALID');
    expect(plan.resolvedBy).toBe('TradePlanResolver');
    expect(formatTradePlanResolvedLog(plan)).toContain('[TRADE_PLAN_RESOLVED]');
  });

  it('B. marks a stop above entry as invalid', () => {
    const plan = computeTradePlan(snapshot(), {
      initialStopLoss: 10_100,
      computedAt: NOW,
    });

    expect(plan.status).toBe('INVALID_STOP');
    expect(plan.invalidReasons).toContain('STOP_NOT_BELOW_ENTRY');
  });

  it('C. marks a target below entry as invalid', () => {
    const plan = computeTradePlan(snapshot(), {
      targetPrice1: 9_900,
      computedAt: NOW,
    });

    expect(plan.status).toBe('INVALID_TARGET');
    expect(plan.invalidReasons).toContain('TARGET_NOT_ABOVE_ENTRY');
  });

  it('D. routes insufficient R:R to WATCH_RR_INSUFFICIENT and counterfactual learning', () => {
    const plan = computeTradePlan(snapshot(), {
      initialStopLoss: 9_500,
      targetPrice1: 10_500,
      minRiskReward: 2,
      computedAt: NOW,
    });
    const decision = resolveSimpleTradeDecision({
      symbol: '005930',
      dataUsable: true,
      riskRewardOk: plan.status !== 'RR_INSUFFICIENT',
      finalScore: 80,
      tradePlanValid: plan.status === 'VALID',
    });
    const recorded = recordCounterfactualForDecision({
      decision,
      snapshotId: 'scan_trade_plan_1',
      asOf: NOW,
      entryPrice: plan.entryPrice,
      stopLoss: plan.initialStopLoss,
      targetPrice: plan.targetPrice1,
      riskReward: plan.riskReward1,
      tradePlanId: plan.tradePlanId,
      initialStopLoss: plan.initialStopLoss,
      targetPrice1: plan.targetPrice1,
      riskReward1: plan.riskReward1,
      tradePlanStatus: plan.status,
      invalidReasons: plan.invalidReasons,
    });

    expect(plan.riskReward1).toBe(1);
    expect(plan.status).toBe('RR_INSUFFICIENT');
    expect(decision.decision).toBe('WATCH_RR_INSUFFICIENT');
    expect(recorded.sample.sampleType).toBe('RR_INSUFFICIENT_COUNTERFACTUAL');
    expect(recorded.sample.tradePlanId).toBe(plan.tradePlanId);
    expect(recorded.sample.learningLabels).toContain('RR_INSUFFICIENT_OBSERVED');
    expect(formatRrInsufficientObservedLog(plan)).toContain('[RR_INSUFFICIENT_OBSERVED]');
  });

  it('E. moves stop to breakeven after TP1 with the configured buffer', () => {
    const plan = computeTradePlan(snapshot(), { computedAt: NOW });
    const move = applyTp1BreakevenMove({
      tradePlan: plan,
      tp1Price: plan.targetPrice1,
      tp1RealizedPnL: 15_000,
    });

    expect(move.newStopLoss).toBe(10_010);
    expect(move.stopMovedToBreakeven).toBe(true);
    expect(formatStopMovedToBreakevenAfterTp1Log({ ...move, positionId: 'pos-1' }))
      .toContain('[STOP_MOVED_TO_BREAKEVEN_AFTER_TP1]');
  });

  it('F. simple trailing never lowers the current stop', () => {
    const trailing = applySimpleTrailingStop({
      entryPrice: 10_000,
      currentStopLoss: 10_010,
      latestPrice: 10_200,
    });

    expect(trailing.trailingStop).toBe(9_894);
    expect(trailing.currentStopLoss).toBe(10_010);
    expect(trailing.trailingActivated).toBe(false);
  });

  it('G. attaches TradePlan fields to PositionState-compatible records', () => {
    const plan = computeTradePlan(snapshot(), { computedAt: NOW });
    const position = attachTradePlanToPositionState({
      positionId: 'pos-1',
      symbol: '005930',
    }, plan);

    expect(position.tradePlanId).toBe(plan.tradePlanId);
    expect(position.initialStopLoss).toBe(plan.initialStopLoss);
    expect(position.targetPrice1).toBe(plan.targetPrice1);
    expect(formatPositionTradePlanAttachedLog({
      positionId: 'pos-1',
      symbol: '005930',
      tradePlan: plan,
    })).toContain('[POSITION_TRADE_PLAN_ATTACHED]');
  });

  it('H. renders Telegram BUY candidates from TradePlan values', () => {
    const plan = computeTradePlan(snapshot(), { computedAt: NOW });
    const state: DisplayState = {
      audience: 'USER_SIGNAL',
      severity: 'ACTION',
      eventType: 'BUY_CANDIDATE',
      symbol: '005930',
      name: 'Samsung',
      decision: 'BUY_ALLOWED',
      label: 'BUY',
      finalScore: 74,
      entryPrice: plan.entryPrice,
      stopLoss: 1,
      targetPrice: 1,
      riskReward: 1,
      initialStopLoss: plan.initialStopLoss,
      targetPrice1: plan.targetPrice1,
      riskReward1: plan.riskReward1,
      tradePlanId: plan.tradePlanId,
      tp1SellPct: plan.tp1SellPct,
      moveStopToBreakevenAfterTp1: plan.moveStopToBreakevenAfterTp1,
      mode: 'SHADOW',
      summaryLines: [],
    };
    const message = renderDisplayState(state);

    expect(message).toContain(plan.initialStopLoss.toLocaleString('ko-KR'));
    expect(message).toContain(plan.targetPrice1.toLocaleString('ko-KR'));
    expect(message).toContain(`R:R: ${plan.riskReward1}`);
    expect(message).toContain(`TradePlan: ${plan.tradePlanId}`);
  });

  it('records invalid TradePlan as a counterfactual sample instead of dropping it', () => {
    const plan = computeTradePlan(snapshot(), {
      initialStopLoss: 10_100,
      computedAt: NOW,
    });
    const decision = resolveSimpleTradeDecision({
      symbol: '005930',
      dataUsable: false,
      finalScore: 80,
      tradePlanValid: false,
    });
    const recorded = recordCounterfactualForDecision({
      decision,
      snapshotId: 'scan_trade_plan_invalid',
      asOf: NOW,
      tradePlanId: plan.tradePlanId,
      tradePlanStatus: plan.status,
      invalidReasons: plan.invalidReasons,
      entryPrice: plan.entryPrice,
      initialStopLoss: plan.initialStopLoss,
      targetPrice1: plan.targetPrice1,
      riskReward1: plan.riskReward1,
    });

    expect(plan.status).toBe('INVALID_STOP');
    expect(recorded.sample.sampleType).toBe('TRADE_PLAN_INVALID_COUNTERFACTUAL');
    expect(recorded.sample.learningLabels).toContain('TRADE_PLAN_INVALID_OBSERVED');
  });
});
