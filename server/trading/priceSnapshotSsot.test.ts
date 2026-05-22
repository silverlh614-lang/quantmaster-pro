import { describe, expect, it } from 'vitest';

import {
  checkPriceMismatch,
  computeTradePlan,
  formatPriceMismatchBlockedFillLog,
  formatPriceNotUsableForExecutionLog,
  formatPriceSnapshotResolvedLog,
  formatShadowFillPriceConfirmedLog,
  formatTradePlanComputedFromPriceSnapshotLog,
  formatTradePlanPriceValidationFailedLog,
  priceSnapshotFromAuthoritativeQuote,
  resolveEntryPriceFromSnapshot,
  validateTradePlanAgainstLatestPrice,
  type PriceSnapshot,
} from './priceSnapshotSsot.js';
import type { AuthoritativeQuoteSnapshot } from './shadowExecutionSafety.js';
import { recordCounterfactualForDecision } from './gates/counterfactualAlwaysOn.js';
import { resolveSimpleTradeDecision } from './gates/simpleDecision.js';

const NOW = new Date('2026-05-21T00:05:00.000Z');

function quote(overrides: Partial<AuthoritativeQuoteSnapshot> = {}): AuthoritativeQuoteSnapshot {
  return {
    symbol: '005930',
    currentPrice: 10_000,
    lastTradePrice: 10_000,
    quoteSource: 'KIS_WS',
    quoteAsOf: '2026-05-21T00:04:55.000Z',
    snapshotId: 'scan_1_quote_005930',
    marketSession: 'REGULAR',
    isStale: false,
    staleMs: 5_000,
    confidence: 'VERIFIED',
    providerIssue: null,
    tradingHalted: false,
    priceBasis: 'REALTIME_LAST',
    ...overrides,
  };
}

function snapshot(overrides: Partial<PriceSnapshot> = {}): PriceSnapshot {
  return {
    snapshotId: 'scan_1_quote_005930',
    priceSnapshotId: 'ps_scan_1_quote_005930',
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

describe('Price Snapshot SSOT', () => {
  it('A. allows Shadow fill from fresh REALTIME price', () => {
    const priceSnapshot = priceSnapshotFromAuthoritativeQuote({
      quote: quote(),
      purpose: 'SHADOW_FILL',
      now: NOW,
      marketSession: 'REGULAR',
    });

    expect(priceSnapshot.priceUsableForShadowFill).toBe(true);
    expect(resolveEntryPriceFromSnapshot(priceSnapshot, 'SHADOW_FILL')).toBe(10_000);
    expect(formatPriceSnapshotResolvedLog({ purpose: 'SHADOW_FILL', snapshot: priceSnapshot })).toContain('[PRICE_SNAPSHOT_RESOLVED]');
    expect(formatShadowFillPriceConfirmedLog({
      symbol: '005930',
      priceSnapshot,
      fillPrice: 10_000,
    })).toContain('[SHADOW_FILL_PRICE_CONFIRMED]');
  });

  it('B. blocks Shadow fill from stale price', () => {
    const priceSnapshot = priceSnapshotFromAuthoritativeQuote({
      quote: quote({
        quoteAsOf: '2026-05-21T00:00:00.000Z',
        isStale: true,
        staleMs: 300_000,
      }),
      purpose: 'SHADOW_FILL',
      now: NOW,
      marketSession: 'REGULAR',
    });

    expect(priceSnapshot.confidence).toBe('STALE');
    expect(priceSnapshot.priceUsableForShadowFill).toBe(false);
    expect(resolveEntryPriceFromSnapshot(priceSnapshot, 'SHADOW_FILL')).toBeNull();
    expect(formatPriceNotUsableForExecutionLog({
      symbol: '005930',
      purpose: 'SHADOW_FILL',
      snapshot: priceSnapshot,
    })).toContain("executionImpact='ORDER_WAIT_PRICE_VALID'");
  });

  it('C. blocks previous close fallback for Live/Shadow fill', () => {
    const priceSnapshot = snapshot({
      source: 'FALLBACK_PREV_CLOSE',
      confidence: 'STALE',
      priceUsableForExecution: false,
      priceUsableForShadowFill: false,
    });

    expect(resolveEntryPriceFromSnapshot(priceSnapshot, 'LIVE_ORDER')).toBeNull();
    expect(resolveEntryPriceFromSnapshot(priceSnapshot, 'SHADOW_FILL')).toBeNull();
  });

  it('D. blocks 3% price mismatch', () => {
    const mismatch = checkPriceMismatch({
      referencePrice: 10_000,
      latestPrice: 9_700,
    });

    expect(mismatch.status).toBe('MISMATCH');
    expect(mismatch.diffPct).toBeCloseTo(3.0928, 3);
    expect(formatPriceMismatchBlockedFillLog({ symbol: '005930', mismatch })).toContain('[PRICE_MISMATCH_BLOCKED_FILL]');
  });

  it('E. rejects TradePlan when stopLoss is above latest price', () => {
    const plan = computeTradePlan(snapshot(), {
      existingStopLoss: 9_900,
      existingTargetPrice: 12_000,
      computedAt: NOW.toISOString(),
    });
    const latest = snapshot({ currentPrice: 9_800 });
    const validation = validateTradePlanAgainstLatestPrice({
      tradePlan: plan,
      latestPriceSnapshot: latest,
      maxEntryLatestDiffPct: 5,
    });

    expect(validation.ok).toBe(false);
    expect(validation.reason).toBe('STOP_ABOVE_LATEST_PRICE');
    expect(formatTradePlanPriceValidationFailedLog({
      symbol: '005930',
      tradePlan: plan,
      latestPriceSnapshot: latest,
      reason: validation.reason,
    })).toContain('[TRADE_PLAN_PRICE_VALIDATION_FAILED]');
  });

  it('F. computes TradePlan from the same entry price snapshot', () => {
    const priceSnapshot = snapshot({ currentPrice: 10_000 });
    const plan = computeTradePlan(priceSnapshot, {
      stopLossPct: 0.05,
      targetGainPct: 0.15,
      computedAt: NOW.toISOString(),
    });

    expect(plan.priceSnapshotId).toBe(priceSnapshot.priceSnapshotId);
    expect(plan.entryPrice).toBe(10_000);
    expect(plan.stopLoss).toBe(9_500);
    expect(plan.targetPrice).toBe(11_500);
    expect(plan.riskReward).toBe(3);
    expect(formatTradePlanComputedFromPriceSnapshotLog(plan)).toContain('[TRADE_PLAN_COMPUTED_FROM_PRICE_SNAPSHOT]');
  });

  it('G. keeps Telegram/display currentPrice and entryPrice aligned for BUY candidate', () => {
    const priceSnapshot = snapshot({ currentPrice: 12_300 });
    const plan = computeTradePlan(priceSnapshot);

    expect(priceSnapshot.currentPrice).toBe(plan.entryPrice);
  });

  it('H. stores priceSnapshotId in Counterfactual sample when price is usable', () => {
    const priceSnapshot = snapshot();
    const decision = resolveSimpleTradeDecision({
      symbol: '005930',
      dataUsable: true,
      riskRewardOk: true,
      slotAvailable: true,
      finalScore: 75,
    });
    const recorded = recordCounterfactualForDecision({
      decision,
      snapshotId: 'scan_1',
      asOf: NOW.toISOString(),
      priceSnapshotId: priceSnapshot.priceSnapshotId,
      priceConfidence: priceSnapshot.confidence,
      priceAgeSec: priceSnapshot.ageSec,
      entryPrice: priceSnapshot.currentPrice,
    });

    expect(recorded.sample.priceSnapshotId).toBe(priceSnapshot.priceSnapshotId);
    expect(recorded.sample.entryPrice).toBe(10_000);
  });
});
