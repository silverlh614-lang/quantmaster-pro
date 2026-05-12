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
