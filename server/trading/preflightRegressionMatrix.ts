// @responsibility preflightRegressionMatrix — pure live-entry guard matrix for tests and operator reasoning.
//
// This module is pure/read-only. It does not import KIS/order/Gate/Kelly runtime paths
// and does not dispatch orders. It models the minimum conditions required before a
// live new-buy path may be considered.

export type LivePreflightBlockReason =
  | 'AUTO_TRADE_MODE_NOT_LIVE'
  | 'AUTO_TRADE_DISABLED'
  | 'LIVE_EXECUTION_NOT_ALLOWED'
  | 'EMERGENCY_STOP'
  | 'DAILY_LOSS_LIMIT_REACHED'
  | 'KIS_NOT_CONFIGURED'
  | 'KIS_TOKEN_EXPIRED'
  | 'SELL_ONLY_MODE'
  | 'POSITION_FULL'
  | 'DUPLICATE_ORDER_RISK'
  | 'DATA_PROVIDER_ERROR'
  | 'DATA_STALE'
  | 'VOLUME_CLOCK_BLOCK'
  | 'MARKET_SESSION_BLOCK';

export interface LivePreflightRegressionInput {
  autoTradeMode: 'LIVE' | 'SHADOW' | 'VTS' | string;
  autoTradeEnabled: boolean;
  liveExecutionAllowed: boolean;
  emergencyStop: boolean;
  dailyLossLimitReached: boolean;
  kisConfigured: boolean;
  kisTokenValid: boolean;
  sellOnlyMode: boolean;
  positionFull: boolean;
  duplicateOrderRisk: boolean;
  providerHealth: 'OK' | 'DEGRADED' | 'STALE' | 'DOWN' | 'UNKNOWN';
  dataFreshness: 'FRESH' | 'STALE' | 'MISSING' | 'UNKNOWN';
  volumeClockAllowsEntry: boolean;
  marketSessionAllowsEntry: boolean;
}

export interface LivePreflightRegressionResult {
  allowNewBuy: boolean;
  executionImpact: 'NONE';
  liveOrderAllowed: boolean;
  blockReasons: LivePreflightBlockReason[];
  confidenceAction: 'ALLOW' | 'BLOCK' | 'DOWNGRADE_ONLY';
}

export function evaluateLivePreflightRegression(input: LivePreflightRegressionInput): LivePreflightRegressionResult {
  const blockReasons: LivePreflightBlockReason[] = [];

  if (input.autoTradeMode !== 'LIVE') blockReasons.push('AUTO_TRADE_MODE_NOT_LIVE');
  if (!input.autoTradeEnabled) blockReasons.push('AUTO_TRADE_DISABLED');
  if (!input.liveExecutionAllowed) blockReasons.push('LIVE_EXECUTION_NOT_ALLOWED');
  if (input.emergencyStop) blockReasons.push('EMERGENCY_STOP');
  if (input.dailyLossLimitReached) blockReasons.push('DAILY_LOSS_LIMIT_REACHED');
  if (!input.kisConfigured) blockReasons.push('KIS_NOT_CONFIGURED');
  if (!input.kisTokenValid) blockReasons.push('KIS_TOKEN_EXPIRED');
  if (input.sellOnlyMode) blockReasons.push('SELL_ONLY_MODE');
  if (input.positionFull) blockReasons.push('POSITION_FULL');
  if (input.duplicateOrderRisk) blockReasons.push('DUPLICATE_ORDER_RISK');
  if (input.providerHealth === 'DOWN') blockReasons.push('DATA_PROVIDER_ERROR');
  if (input.dataFreshness === 'STALE' || input.dataFreshness === 'MISSING') blockReasons.push('DATA_STALE');
  if (!input.volumeClockAllowsEntry) blockReasons.push('VOLUME_CLOCK_BLOCK');
  if (!input.marketSessionAllowsEntry) blockReasons.push('MARKET_SESSION_BLOCK');

  const allowNewBuy = blockReasons.length === 0;
  const downgradeOnly = !allowNewBuy
    && blockReasons.every((reason) => reason === 'DATA_STALE' || reason === 'DATA_PROVIDER_ERROR');

  return {
    allowNewBuy,
    executionImpact: 'NONE',
    liveOrderAllowed: allowNewBuy,
    blockReasons,
    confidenceAction: allowNewBuy ? 'ALLOW' : downgradeOnly ? 'DOWNGRADE_ONLY' : 'BLOCK',
  };
}

export function buildHappyPathLivePreflightInput(
  overrides: Partial<LivePreflightRegressionInput> = {},
): LivePreflightRegressionInput {
  return {
    autoTradeMode: 'LIVE',
    autoTradeEnabled: true,
    liveExecutionAllowed: true,
    emergencyStop: false,
    dailyLossLimitReached: false,
    kisConfigured: true,
    kisTokenValid: true,
    sellOnlyMode: false,
    positionFull: false,
    duplicateOrderRisk: false,
    providerHealth: 'OK',
    dataFreshness: 'FRESH',
    volumeClockAllowsEntry: true,
    marketSessionAllowsEntry: true,
    ...overrides,
  };
}
