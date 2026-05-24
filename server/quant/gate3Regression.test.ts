import { describe, expect, it } from 'vitest';
import { DEFAULT_CONDITION_WEIGHTS, evaluateServerGate, type ServerGateResult } from '../quantFilter.js';
import type { YahooQuoteExtended } from '../screener/stockScreener.js';

type QuoteLike = Partial<YahooQuoteExtended> & Record<string, unknown>;

function baseQuote(overrides: QuoteLike = {}): YahooQuoteExtended {
  return {
    price: 100,
    currentPrice: 100,
    dayOpen: 99,
    prevClose: 98,
    changePercent: 2,
    volume: 2_400_000,
    avgVolume: 1_000_000,
    avgVolume20d: 1_100_000,
    volumeRatio: 2.4,
    tradingValue: 24_000_000_000,
    avgTradingValue20d: 11_000_000_000,
    high5d: 100,
    high20d: 100,
    high60d: 102,
    low20d: 88,
    low60d: 80,
    rsi14: 58,
    rsi5dAgo: 52,
    macdHistogram: 1.2,
    macd5dHistAgo: -0.3,
    return5d: 4,
    ma20: 95,
    ma60: 90,
    bbWidthCurrent: 6,
    bbWidth20dAvg: 10,
    atr14: 1.2,
    atr5d: 1.1,
    atr20avg: 2,
    recentVolumeAvg3d: 300_000,
    contractionCount: 3,
    rangeContraction: 0.2,
    ...overrides,
  } as unknown as YahooQuoteExtended;
}

const run = (q: YahooQuoteExtended): ServerGateResult => evaluateServerGate(q, DEFAULT_CONDITION_WEIGHTS, 1, null, null);

const pickCoreDecisionFields = (result: ServerGateResult) => ({
  rawScore: result.rawScore,
  gateScore: result.gateScore,
  normalizedGateScore: result.normalizedGateScore,
  signalType: result.signalType,
  positionPct: result.positionPct,
  gate3Fired: result.gateLayerSummary?.gate3?.fired,
  gate3ThresholdNotMet: result.gateLayerSummary?.gate3?.thresholdNotMet,
  gate3Unavailable: result.gateLayerSummary?.gate3?.unavailable,
});

function sanitizeVolatileFields<T>(value: T): T {
  if (value == null || typeof value !== 'object') return value;
  const clone = JSON.parse(JSON.stringify(value));
  const volatileKeys = ['timestamp', 'fetchedAt', 'asOf', 'lastQuoteAt', 'lastTickAt', 'latestBarAt', 'reportDate'];
  const walk = (node: any) => {
    if (!node || typeof node !== 'object') return;
    for (const key of Object.keys(node)) {
      if (volatileKeys.includes(key)) {
        delete node[key];
      } else {
        walk(node[key]);
      }
    }
  };
  walk(clone);
  return clone;
}

const gate3DiagnosticSections = [
  'falseBreakout',
  'lastTrigger',
  'executionReadiness',
  'intradayTiming',
  'momentumIndicators',
  'priceStructure',
  'pullbackSupport',
  'technicalIndicators',
  'volumeStructure',
  'volumeTiming',
] as const;

function sanitizeGate3DiagnosticForSnapshot(gate3: any) {
  const external = sanitizeVolatileFields(gate3.externalDataCoverage ?? {}) as Record<string, any>;
  const consolidated = sanitizeVolatileFields(gate3.consolidatedDiagnostic ?? {}) as Record<string, any>;

  return {
    sourceCoverage: {
      allDeclaredInputsAvailable: gate3.sourceCoverage?.allDeclaredInputsAvailable,
      allRequiredDataAvailable: gate3.sourceCoverage?.allRequiredDataAvailable,
      missingInputs: gate3.sourceCoverage?.missingInputs ?? [],
      calculationIssues: gate3.sourceCoverage?.calculationIssues ?? [],
      marketSignal: gate3.sourceCoverage?.marketSignal,
      diagnosticOnly: gate3.sourceCoverage?.diagnosticOnly,
    },
    externalDataCoverage: {
      sections: Object.keys(external).sort(),
      statusMatrix: Object.fromEntries(gate3DiagnosticSections.map(section => [section, external[section]?.status ?? null])),
      marketSignalMatrix: Object.fromEntries(gate3DiagnosticSections.map(section => [section, external[section]?.marketSignal ?? null])),
      executionImpactMatrix: Object.fromEntries(gate3DiagnosticSections.map(section => [section, external[section]?.executionImpact ?? null])),
    },
    consolidatedDiagnostic: {
      health: consolidated.health ?? null,
      primaryIssue: consolidated.primaryIssue ?? null,
      operatorAction: consolidated.operatorAction ?? null,
      timingAlignment: consolidated.timingAlignment ?? null,
      marketSignal: consolidated.marketSignal ?? null,
      executionImpact: consolidated.executionImpact ?? null,
    },
  };
}

describe('Gate3 regression fixture snapshot / diagnostic invariance', () => {
  it('baseline fixture snapshot', () => {
    const gate3 = run(baseQuote()).gateLayerSummary?.gate3 as any;
    expect(typeof gate3.sourceCoverage.allDeclaredInputsAvailable).toBe('boolean');
    expect(typeof gate3.sourceCoverage.allRequiredDataAvailable).toBe('boolean');
    expect(gate3.sourceCoverage.allRequiredDataAvailable).toBe(true);
    expect(gate3.externalDataCoverage.volumeTiming.status).toBe('VERIFIED');
    expect(gate3.externalDataCoverage.priceStructure.status).toBe('VERIFIED');
    expect(['VERIFIED', 'PARTIAL', 'CALCULATION_MISSING']).toContain(gate3.externalDataCoverage.technicalIndicators.status);
    expect(gate3.externalDataCoverage.volumeTiming.marketSignal).toBe(false);
    expect(gate3.consolidatedDiagnostic.marketSignal).toBe(false);
    expect(sanitizeGate3DiagnosticForSnapshot(gate3)).toMatchSnapshot();
  });

  it('RSI/MACD missing remains diagnostic-only', () => {
    const gate3 = run(baseQuote({ rsi14: undefined, macdHistogram: undefined })).gateLayerSummary?.gate3 as any;
    expect(['MISSING', 'CALCULATION_MISSING', 'PARTIAL', 'DEGRADED']).toContain(gate3.externalDataCoverage.technicalIndicators.status);
    expect(gate3.externalDataCoverage.technicalIndicators.marketSignal).toBe(false);
  });

  it('avgVolume missing is not weak/bearish signal promotion', () => {
    const gate3 = run(baseQuote({ avgVolume: undefined, avgVolume20d: undefined })).gateLayerSummary?.gate3 as any;
    expect(['MISSING', 'CALCULATION_MISSING', 'DEGRADED']).toContain(gate3.externalDataCoverage.volumeTiming.status);
    expect(gate3.externalDataCoverage.volumeTiming.breakoutVolume.status).toBe('MISSING');
    expect(gate3.externalDataCoverage.volumeTiming.marketSignal).toBe(false);
  });

  it('high20d/high60d missing is not breakout fail signal', () => {
    const gate3 = run(baseQuote({ high5d: undefined, high20d: undefined, high60d: undefined })).gateLayerSummary?.gate3 as any;
    expect(['MISSING', 'CALCULATION_MISSING', 'DEGRADED', 'PARTIAL']).toContain(gate3.externalDataCoverage.priceStructure.status);
    expect(gate3.externalDataCoverage.priceStructure.turtle.status).toBe('MISSING');
    expect(gate3.externalDataCoverage.priceStructure.breakout.status).not.toBe('FAIL');
    expect(gate3.externalDataCoverage.priceStructure.marketSignal).toBe(false);
  });

  it('diagnostic-only invariance across fixtures', () => {
    const baseline = run(baseQuote());
    const fixtures = [
      baseQuote({ lastTickAt: '2026-05-20T00:00:00.000Z', volumeClock: 'OPENING' as any }),
      baseQuote({ fetchedAt: '2026-05-20T00:00:00.000Z' as any }),
      baseQuote({ intradayVolume: undefined, intradayVolumeRatio: undefined, volumeClock: undefined, lastTickAt: undefined }),
    ];

    for (const f of fixtures) {
      const candidate = run(f);
      expect(pickCoreDecisionFields(candidate)).toEqual(pickCoreDecisionFields(baseline));
      const gate3 = candidate.gateLayerSummary?.gate3 as any;
      const external = gate3.externalDataCoverage;
      const providerIssue = Boolean(external?.technicalIndicators?.providerIssue || external?.priceStructure?.providerIssue || external?.volumeTiming?.providerIssue);
      const calculationIssue = Boolean(external?.technicalIndicators?.calculationIssue || external?.priceStructure?.calculationIssue || external?.volumeTiming?.calculationIssue);
      expect(providerIssue && Boolean(external?.volumeTiming?.marketSignal)).toBe(false);
      expect(calculationIssue && Boolean(external?.volumeTiming?.marketSignal)).toBe(false);
    }
  });
});
