// @responsibility preflightRegressionMatrix tests — live new-buy guard expectations.

import { describe, expect, it } from 'vitest';
import {
  buildHappyPathLivePreflightInput,
  evaluateLivePreflightRegression,
  type LivePreflightBlockReason,
  type LivePreflightRegressionInput,
} from './preflightRegressionMatrix.js';

const BLOCK_CASES: Array<{
  name: string;
  overrides: Partial<LivePreflightRegressionInput>;
  reason: LivePreflightBlockReason;
}> = [
  { name: 'SHADOW mode blocks live new buy', overrides: { autoTradeMode: 'SHADOW' }, reason: 'AUTO_TRADE_MODE_NOT_LIVE' },
  { name: 'VTS mode blocks live new buy', overrides: { autoTradeMode: 'VTS' }, reason: 'AUTO_TRADE_MODE_NOT_LIVE' },
  { name: 'auto trade disabled blocks live new buy', overrides: { autoTradeEnabled: false }, reason: 'AUTO_TRADE_DISABLED' },
  { name: 'liveExecutionAllowed=false blocks live new buy', overrides: { liveExecutionAllowed: false }, reason: 'LIVE_EXECUTION_NOT_ALLOWED' },
  { name: 'emergency stop blocks live new buy', overrides: { emergencyStop: true }, reason: 'EMERGENCY_STOP' },
  { name: 'daily loss limit blocks live new buy', overrides: { dailyLossLimitReached: true }, reason: 'DAILY_LOSS_LIMIT_REACHED' },
  { name: 'KIS missing blocks live new buy', overrides: { kisConfigured: false }, reason: 'KIS_NOT_CONFIGURED' },
  { name: 'KIS expired blocks live new buy', overrides: { kisTokenValid: false }, reason: 'KIS_TOKEN_EXPIRED' },
  { name: 'SELL_ONLY blocks live new buy', overrides: { sellOnlyMode: true }, reason: 'SELL_ONLY_MODE' },
  { name: 'position full blocks live new buy', overrides: { positionFull: true }, reason: 'POSITION_FULL' },
  { name: 'duplicate order risk blocks live new buy', overrides: { duplicateOrderRisk: true }, reason: 'DUPLICATE_ORDER_RISK' },
  { name: 'provider down blocks live new buy', overrides: { providerHealth: 'DOWN' }, reason: 'DATA_PROVIDER_ERROR' },
  { name: 'stale data blocks live new buy', overrides: { dataFreshness: 'STALE' }, reason: 'DATA_STALE' },
  { name: 'missing data blocks live new buy', overrides: { dataFreshness: 'MISSING' }, reason: 'DATA_STALE' },
  { name: 'volume clock blocks live new buy', overrides: { volumeClockAllowsEntry: false }, reason: 'VOLUME_CLOCK_BLOCK' },
  { name: 'market session blocks live new buy', overrides: { marketSessionAllowsEntry: false }, reason: 'MARKET_SESSION_BLOCK' },
];

describe('evaluateLivePreflightRegression', () => {
  it('happy path allows live new buy and keeps executionImpact=NONE', () => {
    const result = evaluateLivePreflightRegression(buildHappyPathLivePreflightInput());
    expect(result).toEqual({
      allowNewBuy: true,
      executionImpact: 'NONE',
      liveOrderAllowed: true,
      blockReasons: [],
      confidenceAction: 'ALLOW',
    });
  });

  it.each(BLOCK_CASES)('$name', ({ overrides, reason }) => {
    const result = evaluateLivePreflightRegression(buildHappyPathLivePreflightInput(overrides));
    expect(result.allowNewBuy).toBe(false);
    expect(result.liveOrderAllowed).toBe(false);
    expect(result.executionImpact).toBe('NONE');
    expect(result.blockReasons).toContain(reason);
  });

  it('accumulates multiple block reasons without unlocking live order', () => {
    const result = evaluateLivePreflightRegression(buildHappyPathLivePreflightInput({
      autoTradeMode: 'SHADOW',
      emergencyStop: true,
      sellOnlyMode: true,
      positionFull: true,
      duplicateOrderRisk: true,
      providerHealth: 'DOWN',
      dataFreshness: 'STALE',
    }));
    expect(result.allowNewBuy).toBe(false);
    expect(result.liveOrderAllowed).toBe(false);
    expect(result.executionImpact).toBe('NONE');
    expect(result.blockReasons).toEqual(expect.arrayContaining([
      'AUTO_TRADE_MODE_NOT_LIVE',
      'EMERGENCY_STOP',
      'SELL_ONLY_MODE',
      'POSITION_FULL',
      'DUPLICATE_ORDER_RISK',
      'DATA_PROVIDER_ERROR',
      'DATA_STALE',
    ]));
  });

  it('provider/data-only problems are classified as downgrade-only rather than runtime mutation', () => {
    const result = evaluateLivePreflightRegression(buildHappyPathLivePreflightInput({
      providerHealth: 'DOWN',
      dataFreshness: 'STALE',
    }));
    expect(result.allowNewBuy).toBe(false);
    expect(result.liveOrderAllowed).toBe(false);
    expect(result.executionImpact).toBe('NONE');
    expect(result.confidenceAction).toBe('DOWNGRADE_ONLY');
    expect(result.blockReasons).toEqual(['DATA_PROVIDER_ERROR', 'DATA_STALE']);
  });

  it('data degraded but fresh does not block in the pure matrix', () => {
    const result = evaluateLivePreflightRegression(buildHappyPathLivePreflightInput({
      providerHealth: 'DEGRADED',
      dataFreshness: 'FRESH',
    }));
    expect(result.allowNewBuy).toBe(true);
    expect(result.liveOrderAllowed).toBe(true);
    expect(result.blockReasons).toEqual([]);
  });
});
