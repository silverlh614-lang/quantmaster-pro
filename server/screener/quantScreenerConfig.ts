/**
 * @responsibility Advisory screener threshold defaults
 */

import type { ScreenerConfig } from './quantScreenerTypes.js';

export const DEFAULT_SCREENER_CONFIG: ScreenerConfig = {
  minMarketCapKrw: 100_000_000_000,
  minAvgTradingValue20dKrw: 1_000_000_000,
  excludeNegativeEarnings: true,
  excludeManagedStocks: true,
  excludeTradingHalt: true,
  volumeSpikeRatio: 3.0,
  nearHigh52wRatio: 0.95,
  maxDistanceFromMa20Pct: 25,
  minRelativeStrengthPct: 0,
  maxCandidatesForAiAnalysis: 30,
  allowedStages: ['OBSERVE', 'SHADOW_SCORE', 'ADVISORY'],
};

export function resolveScreenerConfig(overrides: Partial<ScreenerConfig> = {}): ScreenerConfig {
  return {
    ...DEFAULT_SCREENER_CONFIG,
    ...overrides,
    allowedStages: overrides.allowedStages ?? [...DEFAULT_SCREENER_CONFIG.allowedStages],
  };
}
