// @responsibility ADR-452 evaluateServerGate score health 회귀 테스트
import { describe, expect, it } from 'vitest';
import { evaluateServerGate, DEFAULT_CONDITION_WEIGHTS } from './quantFilter.js';
import type { YahooQuoteExtended } from './screener/stockScreener.js';
import type { KisInvestorFlow } from './clients/kisClient.js';

function makeQuote(overrides: Partial<YahooQuoteExtended> = {}): YahooQuoteExtended {
  return {
    price: 100,
    changePercent: 0.2,
    rsi14: 50,
    rsi5dAgo: 48,
    return5d: 2,
    return20d: 4,
    ma5: 105,
    ma20: 100,
    ma60: 95,
    volume: 100,
    avgVolume: 100,
    high20d: 120,
    high5d: 105,
    bbWidthCurrent: 8,
    bbWidth20dAvg: 10,
    vol5dAvg: 80,
    vol20dAvg: 100,
    atr5d: 1,
    atr20avg: 1,
    atr: 1,
    macdHistogram: -0.1,
    macd5dHistAgo: 0,
    dailyVolumeDrying: false,
    monthlyAboveEMA12: true,
    monthlyEMARising: true,
    weeklyAboveCloud: true,
    weeklyLaggingSpanUp: true,
    weeklyRsi14: 50,
    per: 20,
    yahooDerivedIndicatorsReliable: true,
    ...overrides,
  } as YahooQuoteExtended;
}

describe('evaluateServerGate score health (ADR-452)', () => {
  it('gateScore는 rawScore와 동일하게 유지되어 live threshold 동작을 바꾸지 않는다', () => {
    const result = evaluateServerGate(
      makeQuote(),
      DEFAULT_CONDITION_WEIGHTS,
      1,
      { ocfRatio: 0.5 } as never,
      { institutionalNetBuy: -1000, foreignNetBuy: -1000 } as KisInvestorFlow,
      'R4_NEUTRAL',
    );

    expect(result.rawScore).toBe(result.gateScore);
    expect(result.normalizedGateScore).toBeGreaterThanOrEqual(0);
    expect(result.normalizedGateScore).toBeLessThanOrEqual(1);
  });

  it('kisFlow missing은 subtraction 감점이 아니라 unavailableConditions + availableMaxScore 분모 제외로 표현된다', () => {
    const quote = makeQuote();
    const withSupplyThresholdNotMet = evaluateServerGate(
      quote,
      DEFAULT_CONDITION_WEIGHTS,
      1,
      { ocfRatio: 0.5 } as never,
      { institutionalNetBuy: -1000, foreignNetBuy: -1000 } as KisInvestorFlow,
      'R4_NEUTRAL',
    );
    const missingSupply = evaluateServerGate(
      quote,
      DEFAULT_CONDITION_WEIGHTS,
      1,
      { ocfRatio: 0.5 } as never,
      null,
      'R4_NEUTRAL',
    );

    expect(missingSupply.unavailableConditions).toContain('supply_confluence');
    expect(missingSupply.thresholdNotMetConditions).not.toContain('supply_confluence');
    expect(withSupplyThresholdNotMet.thresholdNotMetConditions).toContain('supply_confluence');
    expect(withSupplyThresholdNotMet.unavailableConditions).not.toContain('supply_confluence');

    expect(withSupplyThresholdNotMet.gateScore).toBe(missingSupply.gateScore);
    expect(withSupplyThresholdNotMet.availableMaxScore - missingSupply.availableMaxScore)
      .toBeCloseTo(DEFAULT_CONDITION_WEIGHTS.supply_confluence, 5);
  });

  it('kospi20dReturn missing이면 relative_strength는 DATA_UNAVAILABLE로 분모에서 제외된다', () => {
    const result = evaluateServerGate(
      makeQuote(),
      DEFAULT_CONDITION_WEIGHTS,
      undefined,
      { ocfRatio: 0.5 } as never,
      { institutionalNetBuy: -1000, foreignNetBuy: -1000 } as KisInvestorFlow,
      'R4_NEUTRAL',
    );

    expect(result.unavailableConditions).toContain('relative_strength');
    expect(result.thresholdNotMetConditions).not.toContain('relative_strength');
  });

  it('THRESHOLD_NOT_MET 조건은 availableMaxScore 분모에 남는다', () => {
    const result = evaluateServerGate(
      makeQuote({ volume: 100, avgVolume: 100 }),
      DEFAULT_CONDITION_WEIGHTS,
      1,
      { ocfRatio: 0.5 } as never,
      { institutionalNetBuy: -1000, foreignNetBuy: -1000 } as KisInvestorFlow,
      'R4_NEUTRAL',
    );

    expect(result.thresholdNotMetConditions).toContain('volume_breakout');
    expect(result.unavailableConditions).not.toContain('volume_breakout');
    expect(result.availableMaxScore).toBeGreaterThan(result.rawScore);
  });
});
