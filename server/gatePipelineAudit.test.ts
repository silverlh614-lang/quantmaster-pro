// @responsibility Gate pipeline integrity audit tests
import { describe, expect, it } from 'vitest';
import {
  DEFAULT_CONDITION_WEIGHTS,
  GATE_CONDITION_LAYER_MAP,
  evaluateServerGate,
} from './quantFilter.js';
import {
  DEFAULT_DATA_PROMOTION_STATUS,
  accumulateGateLayerSummary,
  buildGateLayerAuditSummary,
  createScanCounters,
  recordPipelineStage,
  buildPerStageDropoffSummary,
} from './trading/signalScanner/scanDiagnostics.js';
import { classifyGateEligibility } from './trading/signalScanner/gateEligibilityClassifier.js';
import type { YahooQuoteExtended } from './screener/stockScreener.js';

function quote(overrides: Partial<YahooQuoteExtended> = {}): YahooQuoteExtended {
  return {
    price: 100,
    changePercent: 3,
    rsi14: 55,
    rsi5dAgo: 50,
    return5d: 4,
    return20d: 9,
    ma5: 110,
    ma20: 102,
    ma60: 95,
    volume: 300,
    avgVolume: 100,
    high20d: 100,
    high5d: 105,
    bbWidthCurrent: 6,
    bbWidth20dAvg: 10,
    atr: 1,
    atr20avg: 2,
    dailyVolumeDrying: true,
    monthlyAboveEMA12: true,
    monthlyEMARising: true,
    weeklyAboveCloud: true,
    weeklyLaggingSpanUp: true,
    per: 12,
    sectorReturn5d: 1,
    marketReturn5d: 0,
    ...overrides,
  } as YahooQuoteExtended;
}

function gate1OnlyQuote(overrides: Partial<YahooQuoteExtended> = {}): YahooQuoteExtended {
  return {
    ...quote({
      price: 100,
      changePercent: 0,
      rsi14: 30,
      rsi5dAgo: 30,
      return5d: 0,
      return20d: 0,
      ma5: 110,
      ma20: 100,
      ma60: 90,
      ma60TrendUp: true,
      weeklyRSI: 55,
      volume: 200_000,
      avgVolume: 1_000_000,
      high5d: 0,
      high20d: 200,
      high60d: 200,
      bbWidthCurrent: 1,
      bbWidth20dAvg: 1,
      atr: 1,
      atr20avg: 2,
      atr5d: 1,
      vol5dAvg: 1,
      vol20dAvg: 1,
      per: 999,
      macdHistogram: -1,
      macd5dHistAgo: 0,
      dailyVolumeDrying: false,
      monthlyAboveEMA12: false,
      monthlyEMARising: false,
      weeklyAboveCloud: false,
      weeklyLaggingSpanUp: false,
    }),
    dayHigh: 105,
    dayLow: 95,
    tradingValue: 200_000_000,
    marketDivCode: 'J',
    symbol: '005930',
    priceProvider: 'KIS_PRICE',
    priceMetadata: {
      value: 100,
      asOf: new Date().toISOString(),
      source: 'KIS_REALTIME',
    },
    marketSession: 'REGULAR',
    ...overrides,
  } as YahooQuoteExtended;
}

describe('Gate pipeline integrity audit', () => {
  it('maps server gate conditions into Gate 1/2/3 diagnostic layers', () => {
    expect(GATE_CONDITION_LAYER_MAP.ma_alignment).toBe('gate1');
    expect(GATE_CONDITION_LAYER_MAP.ma60_rising).toBe('gate1');
    expect(GATE_CONDITION_LAYER_MAP.relative_strength).toBe('gate2');
    expect(GATE_CONDITION_LAYER_MAP.supply_confluence).toBe('gate2');
    expect(GATE_CONDITION_LAYER_MAP.earnings_quality).toBe('gate2');
    expect(GATE_CONDITION_LAYER_MAP.vcp).toBe('gate3');
    expect(GATE_CONDITION_LAYER_MAP.volume_breakout).toBe('gate3');
  });

  it('adds gateLayerSummary without replacing raw live score semantics', () => {
    const result = evaluateServerGate(quote(), DEFAULT_CONDITION_WEIGHTS, 1, null, null);
    expect(result.gateScore).toBe(result.rawScore);
    expect(result.normalizedGateScore).toBeLessThanOrEqual(1);
    expect(result.gateLayerSummary).toBeDefined();
    expect(result.gateLayerSummary?.gate1.availableMaxScore).toBeGreaterThan(0);
    expect(result.gateLayerSummary?.gate3.fired.length).toBeGreaterThan(0);
  });

  it('adds Gate1 wiring and source coverage for complete quote inputs', () => {
    const result = evaluateServerGate(gate1OnlyQuote(), DEFAULT_CONDITION_WEIGHTS, 1, null, null);

    expect(result.gateScore).toBeCloseTo(2.8, 5);
    expect(result.rawScore).toBeCloseTo(2.8, 5);
    expect(result.gateScore).toBe(result.rawScore);

    const gate1 = result.gateLayerSummary?.gate1;
    expect(gate1?.sourceCoverage).toMatchObject({
      conditionCount: 3,
      quoteInputCount: 5,
      externalRequiredData: [],
      missingInputs: [],
      missingExternalData: [],
      allDeclaredInputsAvailable: true,
      allExternalDataAvailable: true,
    });

    const maAlignment = gate1?.wiring?.find(item => item.key === 'ma_alignment');
    expect(maAlignment).toMatchObject({
      key: 'ma_alignment',
      layer: 'gate1',
      status: 'FIRED',
      inputs: ['quote.ma5', 'quote.ma20', 'quote.ma60'],
      quoteInputs: ['quote.ma5', 'quote.ma20', 'quote.ma60'],
      missingInputs: [],
      dataPath: 'QUOTE_ONLY',
    });
  });

  it('adds Gate1 survival diagnostics for complete quote inputs without touching score semantics', () => {
    const result = evaluateServerGate(gate1OnlyQuote(), DEFAULT_CONDITION_WEIGHTS, 1, null, null);

    expect(result.gateScore).toBeCloseTo(2.8, 5);
    expect(result.rawScore).toBeCloseTo(2.8, 5);
    expect(result.gateScore).toBe(result.rawScore);

    const survival = result.gateLayerSummary?.gate1.survival;
    expect(survival?.kisOfficialQuoteCoverage.allRequiredFieldsPresent).toBe(true);
    expect(survival?.kisOfficialQuoteCoverage.confidence).toBe('VERIFIED');
    expect(survival?.kisOfficialQuoteCoverage.marketSignal).toBe(false);
    expect(survival?.shadowEligibility).toMatchObject({
      allowed: true,
      mode: 'NORMAL_SHADOW',
      executionImpact: 'NONE',
    });
    expect(survival?.marketSessionCompatibility).toMatchObject({
      session: 'REGULAR',
      liveBuyAllowed: true,
      shadowAllowed: true,
    });
  });

  it('reports missing weeklyRSI in Gate1 source coverage without changing raw score semantics', () => {
    const missingWeekly = gate1OnlyQuote() as Partial<YahooQuoteExtended>;
    delete missingWeekly.weeklyRSI;
    const result = evaluateServerGate(missingWeekly as YahooQuoteExtended, DEFAULT_CONDITION_WEIGHTS, 1, null, null);

    expect(result.gateScore).toBeCloseTo(2.0, 5);
    expect(result.rawScore).toBeCloseTo(2.0, 5);
    expect(result.gateScore).toBe(result.rawScore);

    const gate1 = result.gateLayerSummary?.gate1;
    expect(gate1?.sourceCoverage).toMatchObject({
      conditionCount: 3,
      quoteInputCount: 5,
      externalRequiredData: [],
      missingInputs: ['quote.weeklyRSI'],
      missingExternalData: [],
      allDeclaredInputsAvailable: false,
      allExternalDataAvailable: true,
    });

    const weekly = gate1?.wiring?.find(item => item.key === 'weekly_rsi_zone');
    expect(weekly).toMatchObject({
      key: 'weekly_rsi_zone',
      layer: 'gate1',
      status: 'THRESHOLD_NOT_MET',
      inputs: ['quote.weeklyRSI'],
      quoteInputs: ['quote.weeklyRSI'],
      missingInputs: ['quote.weeklyRSI'],
      dataPath: 'QUOTE_ONLY',
    });

    expect(gate1?.survival?.kisOfficialQuoteCoverage.missingFields).toContain('quote.weeklyRSI');
    expect(gate1?.survival?.kisOfficialQuoteCoverage.allRequiredFieldsPresent).toBe(false);
    expect(gate1?.survival?.kisOfficialQuoteCoverage.marketSignal).toBe(false);
  });

  it('reports missing price/volume as provider freshness or quote coverage degradation while keeping shadow enabled', () => {
    const missingQuotePayload = gate1OnlyQuote() as Partial<YahooQuoteExtended>;
    delete missingQuotePayload.price;
    delete missingQuotePayload.volume;
    missingQuotePayload.high60d = 0;
    const result = evaluateServerGate(missingQuotePayload as YahooQuoteExtended, DEFAULT_CONDITION_WEIGHTS, 1, null, null);

    expect(result.gateScore).toBeCloseTo(2.8, 5);
    expect(result.rawScore).toBeCloseTo(2.8, 5);

    const survival = result.gateLayerSummary?.gate1.survival;
    expect(survival?.quoteFreshness.status).toBe('MISSING');
    expect(survival?.quoteFreshness.marketSignal).toBe(false);
    expect(['DIAGNOSTIC_ONLY', 'LIVE_BUY_BLOCKED_ONLY']).toContain(survival?.quoteFreshness.executionImpact);
    expect(survival?.kisOfficialQuoteCoverage.confidence).toBe('MISSING');
    expect(survival?.kisOfficialQuoteCoverage.missingFields).toEqual(
      expect.arrayContaining(['quote.price', 'quote.volume']),
    );
    expect(survival?.kisOfficialQuoteCoverage.marketSignal).toBe(false);
    expect(survival?.shadowEligibility).toMatchObject({
      allowed: true,
      mode: 'DEGRADED_SHADOW',
      executionImpact: 'NONE',
    });
  });

  it('keeps shadow allowed during SELL_ONLY while live buy is diagnostically disallowed', () => {
    const q = { ...gate1OnlyQuote(), marketSession: 'SELL_ONLY' } as YahooQuoteExtended;
    const result = evaluateServerGate(q, DEFAULT_CONDITION_WEIGHTS, 1, null, null);

    expect(result.gateScore).toBeCloseTo(2.8, 5);
    expect(result.rawScore).toBeCloseTo(2.8, 5);
    expect(result.gateLayerSummary?.gate1.survival?.marketSessionCompatibility).toMatchObject({
      session: 'SELL_ONLY',
      liveBuyAllowed: false,
      shadowAllowed: true,
    });
    expect(result.gateLayerSummary?.gate1.survival?.shadowEligibility.allowed).toBe(true);
  });

  it('keeps closed-session shadow recording observable without changing score semantics', () => {
    const q = { ...gate1OnlyQuote(), marketSession: 'CLOSED' } as YahooQuoteExtended;
    const result = evaluateServerGate(q, DEFAULT_CONDITION_WEIGHTS, 1, null, null);

    expect(result.gateScore).toBeCloseTo(2.8, 5);
    expect(result.rawScore).toBeCloseTo(2.8, 5);
    expect(result.gateLayerSummary?.gate1.survival?.marketSessionCompatibility).toMatchObject({
      session: 'CLOSED',
      liveBuyAllowed: false,
      shadowAllowed: true,
    });
    expect(result.gateLayerSummary?.gate1.survival?.shadowEligibility).toMatchObject({
      allowed: true,
      mode: 'OBSERVE_ONLY',
      executionImpact: 'NONE',
    });
  });

  it('KIS flow unavailable keeps live false, shadow observable true, and no execution impact field', () => {
    const eligibility = classifyGateEligibility({
      stockCode: '005930',
      currentPrice: 70000,
      investorFlowProviderUnavailable: true,
      signalGrade: 'STRONG_BUY',
      hasTechnicalSetup: true,
    });
    expect(eligibility.liveEligible).toBe(false);
    expect(eligibility.shadowObservable).toBe(true);
    expect(eligibility.dataUnavailableReasons).toContain('INVESTOR_FLOW_PROVIDER_UNAVAILABLE');
    expect('executionImpact' in eligibility).toBe(false);
  });

  it('sector energy STALE records provider degradation while preserving shadow observation', () => {
    const eligibility = classifyGateEligibility({
      stockCode: '005930',
      currentPrice: 70000,
      sectorEnergyDataQuality: 'STALE',
      signalGrade: 'BUY',
      hasMomentumSignal: true,
    });
    expect(eligibility.liveEligible).toBe(false);
    expect(eligibility.shadowObservable).toBe(true);
    expect(eligibility.degradedProviderReasons).toContain('SECTOR_DATA_STALE');
  });

  it('macro/risk hard block only is not shadow observable', () => {
    const eligibility = classifyGateEligibility({
      stockCode: '005930',
      currentPrice: 70000,
      macroBlocked: true,
      riskBlocked: true,
      signalGrade: 'STRONG_BUY',
      hasTechnicalSetup: true,
    });
    expect(eligibility.liveEligible).toBe(false);
    expect(eligibility.shadowObservable).toBe(false);
  });

  it('suppresses strong buy audit count when high score has DATA_UNAVAILABLE', () => {
    const counters = createScanCounters();
    const gate = evaluateServerGate(quote(), DEFAULT_CONDITION_WEIGHTS, 1, null, null);
    accumulateGateLayerSummary(counters, gate.gateLayerSummary, 'STRONG');
    const audit = buildGateLayerAuditSummary(counters);
    expect(audit.strongBuySuppressedByDataUnavailableCount).toBeGreaterThanOrEqual(1);
    expect(gate.normalizedGateScore).not.toBe(gate.gateScore);
  });

  it('all data OK with strong score remains live eligible through classifier', () => {
    const gate = evaluateServerGate(quote(), DEFAULT_CONDITION_WEIGHTS, 1, { revenueGrowth: 20, operatingMargin: 15 } as never, { foreignNetBuy: 10, institutionNetBuy: 10 } as never);
    const eligibility = classifyGateEligibility({
      stockCode: '005930',
      currentPrice: 70000,
      signalGrade: gate.signalType === 'STRONG' ? 'STRONG_BUY' : 'BUY',
      hasTechnicalSetup: true,
    });
    expect(gate.mtas).toBeGreaterThanOrEqual(7);
    expect(eligibility.liveEligible).toBe(true);
    expect(eligibility.shadowObservable).toBe(false);
  });

  it('records pipeline stage dropoff and conservative data promotion defaults', () => {
    const counters = createScanCounters();
    recordPipelineStage(counters, 'SERVER_GATE_EVALUATED', 'PASS');
    recordPipelineStage(counters, 'GATE_ELIGIBILITY_CLASSIFIED', 'SHADOW_ONLY');
    const stages = buildPerStageDropoffSummary(counters);
    expect(stages.find((s) => s.stage === 'SERVER_GATE_EVALUATED')?.pass).toBe(1);
    expect(stages.find((s) => s.stage === 'GATE_ELIGIBILITY_CLASSIFIED')?.shadowOnly).toBe(1);
    expect(DEFAULT_DATA_PROMOTION_STATUS.kisInvestorFlow).not.toBe('CORE');
    expect(DEFAULT_DATA_PROMOTION_STATUS.sectorEnergy).not.toBe('CORE');
  });
});
