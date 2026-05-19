// @responsibility Gate1 diagnostic-only regression fixtures and snapshots.

import { describe, expect, it } from 'vitest';
import {
  DEFAULT_CONDITION_WEIGHTS,
  evaluateServerGate,
  type GateLayerSummary,
  type ServerGateResult,
} from '../quantFilter.js';
import type { YahooQuoteExtended } from '../screener/stockScreener.js';
import { buildGate1ConsolidatedDiagnostic } from './gate1ConsolidatedDiagnostic.js';
import { normalizeShadowEligibilityForGate1 } from './gate1ShadowEligibility.js';

type QuotePatch = Partial<YahooQuoteExtended> & Record<string, unknown>;

function gate1RegularOkFixture(overrides: QuotePatch = {}): YahooQuoteExtended {
  return {
    price: 100,
    currentPrice: 100,
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
    avgVolume20d: 1_000_000,
    high5d: 0,
    high20d: 200,
    high60d: 200,
    dayHigh: 105,
    dayLow: 95,
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
    tradingValue: 2_000_000_000,
    avgTradingValue20d: 1_000_000_000,
    market: 'KOSPI',
    stockType: 'COMMON',
    marketDivCode: 'J',
    symbol: '005930',
    priceProvider: 'KIS_PRICE',
    priceMetadata: {
      value: 100,
      asOf: new Date().toISOString(),
      source: 'KIS_REALTIME',
    },
    isHighRisk: false,
    marketSession: 'REGULAR',
    engineMode: 'NORMAL',
    ...overrides,
  } as YahooQuoteExtended;
}

function gate1SellOnlyShadowOnFixture(): YahooQuoteExtended {
  return gate1RegularOkFixture({
    marketSession: 'SELL_ONLY',
    engineMode: 'SELL_ONLY',
    matchedWindow: 'OPENING_0900_0930',
  });
}

function gate1QuoteMissingCounterfactualFixture(): YahooQuoteExtended {
  const quote = gate1RegularOkFixture() as QuotePatch;
  delete quote.price;
  delete quote.currentPrice;
  delete quote.volume;
  quote.high60d = 0;
  return quote as YahooQuoteExtended;
}

function gate1TradabilityHaltedFixture(): YahooQuoteExtended {
  return gate1RegularOkFixture({
    tradingHalted: true,
  });
}

function gate1LiquidityThinFixture(): YahooQuoteExtended {
  return gate1RegularOkFixture({
    tradingValue: 200_000_000,
    avgTradingValue20d: 150_000_000,
  });
}

function gate1ShadowDisabledUnexpectedFixture(): GateLayerSummary['gate1'] {
  const result = evaluateServerGate(gate1RegularOkFixture(), DEFAULT_CONDITION_WEIGHTS, 1, null, null);
  const gate1 = structuredClone(result.gateLayerSummary!.gate1) as GateLayerSummary['gate1'];
  gate1.survival!.shadowEligibility = normalizeShadowEligibilityForGate1({
    alwaysOnKernelEnabled: false,
    engineMode: 'NORMAL',
    marketSessionCompatibility: gate1.survival!.marketSessionCompatibility,
    quoteCoverage: gate1.survival!.kisOfficialQuoteCoverage,
    quoteFreshness: gate1.survival!.quoteFreshness,
    tradability: gate1.survival!.tradability,
    liquidityFloor: gate1.survival!.liquidityFloor,
  });
  gate1.consolidatedDiagnostic = buildGate1ConsolidatedDiagnostic({ gate1 });
  return gate1;
}

function evaluateFixture(quote: YahooQuoteExtended): ServerGateResult {
  return evaluateServerGate(quote, DEFAULT_CONDITION_WEIGHTS, 1, null, null);
}

function pickCoreDecisionFields(result: ServerGateResult) {
  const gate1 = result.gateLayerSummary?.gate1;
  return {
    rawScore: result.rawScore,
    gateScore: result.gateScore,
    normalizedGateScore: result.normalizedGateScore,
    signalType: result.signalType,
    positionPct: result.positionPct,
    gate1Fired: gate1?.fired,
    gate1ThresholdNotMet: gate1?.thresholdNotMet,
    gate1Unavailable: gate1?.unavailable,
  };
}

function sanitizeGate1DiagnosticForSnapshot(gate1: GateLayerSummary['gate1']) {
  const survival = gate1.survival!;
  const consolidated = gate1.consolidatedDiagnostic!;
  return {
    sourceCoverage: gate1.sourceCoverage,
    quoteFreshness: {
      ...survival.quoteFreshness,
      asOf: survival.quoteFreshness.asOf ? '<ISO_TIMESTAMP>' : null,
      ageSec: survival.quoteFreshness.ageSec == null ? null : '<AGE_SEC>',
    },
    quoteCoverage: {
      ...survival.kisOfficialQuoteCoverage,
      asOf: survival.kisOfficialQuoteCoverage.asOf ? '<ISO_TIMESTAMP>' : null,
      driftDiagnostics: survival.kisOfficialQuoteCoverage.driftDiagnostics.map(item => ({
        ...item,
      })),
    },
    tradability: survival.tradability,
    liquidityFloor: {
      status: survival.liquidityFloor.status,
      volume: survival.liquidityFloor.volume,
      avgVolume20d: survival.liquidityFloor.avgVolume20d,
      tradingValue: survival.liquidityFloor.tradingValue,
      avgTradingValue20d: survival.liquidityFloor.avgTradingValue20d,
      currentPrice: survival.liquidityFloor.currentPrice,
      checks: survival.liquidityFloor.checks,
      source: survival.liquidityFloor.source,
      sourceStatus: survival.liquidityFloor.sourceStatus,
      reason: survival.liquidityFloor.reason,
      providerIssue: survival.liquidityFloor.providerIssue,
      marketSignal: survival.liquidityFloor.marketSignal,
      executionImpact: survival.liquidityFloor.executionImpact,
    },
    marketSessionCompatibility: survival.marketSessionCompatibility,
    shadowEligibility: survival.shadowEligibility,
    consolidatedDiagnostic: {
      health: consolidated.health,
      primaryIssue: consolidated.primaryIssue,
      operatorAction: consolidated.operatorAction,
      liveBuyAllowed: consolidated.liveBuyAllowed,
      shadowAllowed: consolidated.shadowAllowed,
      caseRecordingAllowed: consolidated.caseRecordingAllowed,
      marketSignal: consolidated.marketSignal,
      providerIssue: consolidated.providerIssue,
      executionImpact: consolidated.executionImpact,
      compactText: consolidated.compactText,
    },
  };
}

function expectNoMarketSignalTrue(value: unknown): void {
  expect(JSON.stringify(value)).not.toContain('"marketSignal":true');
}

function isServerGateResult(value: ServerGateResult | GateLayerSummary['gate1']): value is ServerGateResult {
  return Boolean((value as ServerGateResult).gateLayerSummary);
}

function expectShadowExecutionImpactNone(result: ServerGateResult | GateLayerSummary['gate1']): void {
  const gate1 = isServerGateResult(result) ? result.gateLayerSummary!.gate1 : result;
  expect(gate1.survival?.shadowEligibility.shadowExecutionImpact).toBe('NONE');
}

describe('Gate1 diagnostic regression fixtures', () => {
  it('locks the REGULAR/KIS/TRADABLE/LIQUIDITY_PASS golden fixture', () => {
    const result = evaluateFixture(gate1RegularOkFixture());
    const gate1 = result.gateLayerSummary!.gate1;

    expect(result.rawScore).toBeCloseTo(2.8, 5);
    expect(result.gateScore).toBe(result.rawScore);
    expect(gate1.consolidatedDiagnostic).toMatchObject({
      health: 'OK',
      primaryIssue: null,
      operatorAction: 'NONE',
      marketSignal: false,
    });
    expect(gate1.sourceCoverage?.allDeclaredInputsAvailable).toBe(true);
    expect(gate1.survival?.kisOfficialQuoteCoverage.confidence).toBe('VERIFIED');
    expect(gate1.survival?.tradability).toMatchObject({
      status: 'TRADABLE',
      tradable: true,
      marketSignal: false,
    });
    expect(gate1.survival?.liquidityFloor.status).toBe('PASS');
    expect(gate1.survival?.marketSessionCompatibility.liveBuyAllowed).toBe(true);
    expect(gate1.survival?.shadowEligibility.allowed).toBe(true);
    expectNoMarketSignalTrue(gate1);
    expectShadowExecutionImpactNone(result);
  });

  it('keeps SELL_ONLY live buy separated from always-on shadow learning', () => {
    const result = evaluateFixture(gate1SellOnlyShadowOnFixture());
    const survival = result.gateLayerSummary!.gate1.survival!;

    expect(survival.marketSessionCompatibility).toMatchObject({
      session: 'SELL_ONLY',
      liveBuyAllowed: false,
      liveSellAllowed: true,
      shadowAllowed: true,
    });
    expect(survival.shadowEligibility).toMatchObject({
      allowed: true,
      mode: 'NORMAL_SHADOW',
      caseRecordingAllowed: true,
      liveExecutionImpact: 'LIVE_BUY_BLOCKED_ONLY',
      shadowExecutionImpact: 'NONE',
      marketSignal: false,
    });
    expect(result.gateLayerSummary!.gate1.consolidatedDiagnostic).toMatchObject({
      health: 'BLOCKED_LIVE_ONLY',
      primaryIssue: 'LIVE_BUY_BLOCKED_BUT_SHADOW_ALLOWED',
      executionImpact: 'LIVE_BUY_BLOCKED_ONLY',
      marketSignal: false,
    });
    expectNoMarketSignalTrue(result.gateLayerSummary!.gate1);
  });

  it('keeps missing quote data counterfactual-only instead of bearish', () => {
    const result = evaluateFixture(gate1QuoteMissingCounterfactualFixture());
    const survival = result.gateLayerSummary!.gate1.survival!;

    expect(result.rawScore).toBeCloseTo(2.8, 5);
    expect(survival.kisOfficialQuoteCoverage).toMatchObject({
      allRequiredFieldsPresent: false,
      confidence: 'MISSING',
      marketSignal: false,
    });
    expect(['MISSING', 'UNKNOWN']).toContain(survival.liquidityFloor.status);
    expect(survival.shadowEligibility).toMatchObject({
      allowed: true,
      mode: 'COUNTERFACTUAL_ONLY',
      counterfactualLearningAllowed: true,
      caseRecordingAllowed: true,
      marketSignal: false,
    });
    expect(result.gateLayerSummary!.gate1.consolidatedDiagnostic).toMatchObject({
      health: 'DEGRADED',
      operatorAction: 'CHECK_QUOTE_PROVIDER',
      marketSignal: false,
    });
    expectNoMarketSignalTrue(result.gateLayerSummary!.gate1);
  });

  it('exposes halted tradability while preserving counterfactual and case recording lanes', () => {
    const regular = evaluateFixture(gate1RegularOkFixture());
    const halted = evaluateFixture(gate1TradabilityHaltedFixture());
    const survival = halted.gateLayerSummary!.gate1.survival!;

    expect(pickCoreDecisionFields(halted)).toEqual(pickCoreDecisionFields(regular));
    expect(survival.tradability).toMatchObject({
      status: 'HALTED',
      tradable: false,
      marketSignal: false,
    });
    expect(survival.shadowEligibility).toMatchObject({
      allowed: true,
      paperOrderAllowed: false,
      virtualFillAllowed: false,
      counterfactualLearningAllowed: true,
      caseRecordingAllowed: true,
      marketSignal: false,
    });
    expectNoMarketSignalTrue(halted.gateLayerSummary!.gate1);
  });

  it('keeps liquidity thin advisory from changing score, signal, or position sizing', () => {
    const regular = evaluateFixture(gate1RegularOkFixture());
    const thin = evaluateFixture(gate1LiquidityThinFixture());

    expect(pickCoreDecisionFields(thin)).toEqual(pickCoreDecisionFields(regular));
    expect(thin.gateLayerSummary!.gate1.survival?.liquidityFloor.status).toMatch(/^(THIN|FAIL)$/);
    expect(thin.gateLayerSummary!.gate1.consolidatedDiagnostic).toMatchObject({
      health: 'WARN',
      operatorAction: 'CHECK_LIQUIDITY',
      primaryIssue: 'LIQUIDITY_WEAK',
      marketSignal: false,
    });
    expectNoMarketSignalTrue(thin.gateLayerSummary!.gate1);
  });

  it('does not hide unexpected shadow kernel disablement', () => {
    const gate1 = gate1ShadowDisabledUnexpectedFixture();

    expect(gate1.consolidatedDiagnostic).toMatchObject({
      health: 'DEGRADED',
      operatorAction: 'CHECK_SHADOW_KERNEL',
      primaryIssue: 'SHADOW_DISABLED_UNEXPECTED',
      marketSignal: false,
    });
    expect(gate1.survival?.shadowEligibility.mode).toBe('DISABLED_UNEXPECTED');
    expectShadowExecutionImpactNone(gate1);
  });

  it('snapshots sanitized diagnostic-only core fields for stable fixtures', () => {
    const snapshots = {
      regularOk: sanitizeGate1DiagnosticForSnapshot(evaluateFixture(gate1RegularOkFixture()).gateLayerSummary!.gate1),
      sellOnlyShadowOn: sanitizeGate1DiagnosticForSnapshot(evaluateFixture(gate1SellOnlyShadowOnFixture()).gateLayerSummary!.gate1),
      quoteMissingCounterfactual: sanitizeGate1DiagnosticForSnapshot(evaluateFixture(gate1QuoteMissingCounterfactualFixture()).gateLayerSummary!.gate1),
      liquidityThin: sanitizeGate1DiagnosticForSnapshot(evaluateFixture(gate1LiquidityThinFixture()).gateLayerSummary!.gate1),
      shadowDisabledUnexpected: sanitizeGate1DiagnosticForSnapshot(gate1ShadowDisabledUnexpectedFixture()),
    };

    expect(snapshots).toMatchInlineSnapshot(`
      {
        "liquidityThin": {
          "consolidatedDiagnostic": {
            "caseRecordingAllowed": true,
            "compactText": "Gate1: WARN | inputs=OK | quote=VERIFIED | tradable=TRADABLE | liquidity=FAIL | session=REGULAR | shadow=NORMAL_SHADOW | issue=LIQUIDITY_WEAK | action=CHECK_LIQUIDITY",
            "executionImpact": "DIAGNOSTIC_ONLY",
            "health": "WARN",
            "liveBuyAllowed": true,
            "marketSignal": false,
            "operatorAction": "CHECK_LIQUIDITY",
            "primaryIssue": "LIQUIDITY_WEAK",
            "providerIssue": false,
            "shadowAllowed": true,
          },
          "liquidityFloor": {
            "avgTradingValue20d": 150000000,
            "avgVolume20d": 1000000,
            "checks": {
              "avgTradingValuePass": false,
              "avgVolumePass": true,
              "tradingValuePass": false,
              "volumePass": true,
            },
            "currentPrice": 100,
            "executionImpact": "DIAGNOSTIC_ONLY",
            "marketSignal": false,
            "providerIssue": false,
            "reason": "LIQUIDITY_BELOW_FLOOR",
            "source": "KIS_OFFICIAL",
            "sourceStatus": "VERIFIED",
            "status": "FAIL",
            "tradingValue": 200000000,
            "volume": 200000,
          },
          "marketSessionCompatibility": {
            "caseRecordingAllowed": true,
            "engineMode": "NORMAL",
            "executionImpact": "DIAGNOSTIC_ONLY",
            "liveBuyAllowed": true,
            "liveSellAllowed": true,
            "marketSignal": false,
            "observeAllowed": true,
            "providerIssue": false,
            "reason": null,
            "sellOnlyWindow": {
              "active": false,
              "matchedWindow": null,
            },
            "session": "REGULAR",
            "shadowAllowed": true,
            "source": "QMP_SESSION",
            "sourceStatus": "VERIFIED",
            "timeKst": null,
            "tradingDate": null,
          },
          "quoteCoverage": {
            "allRequiredFieldsPresent": true,
            "asOf": null,
            "confidence": "VERIFIED",
            "driftDiagnostics": [],
            "endpoint": "/uapi/domestic-stock/v1/quotations/inquire-price",
            "executionImpact": "DIAGNOSTIC_ONLY",
            "gate1DeclaredMissingInputs": [],
            "marketSignal": false,
            "missingFields": [],
            "presentFields": [
              "currentPrice",
              "volume",
              "high",
              "low",
              "changePercent",
              "tradingValue",
            ],
            "providerIssue": false,
            "providerStatus": "OK_WITH_DATA",
            "requiredFields": [
              "currentPrice",
              "volume",
              "high",
              "low",
              "changePercent",
              "tradingValue",
            ],
            "requiredParams": [
              "FID_COND_MRKT_DIV_CODE",
              "FID_INPUT_ISCD",
            ],
            "source": "KIS_OFFICIAL",
            "trId": "FHKST01010100",
          },
          "quoteFreshness": {
            "ageSec": "<AGE_SEC>",
            "asOf": "<ISO_TIMESTAMP>",
            "executionImpact": "NONE",
            "marketSignal": false,
            "provider": "KIS_OFFICIAL",
            "providerIssue": false,
            "status": "OK",
          },
          "shadowEligibility": {
            "allowed": true,
            "blockers": [],
            "caseRecordingAllowed": true,
            "counterfactualLearningAllowed": true,
            "degradedReasons": [],
            "executionImpact": "NONE",
            "liveExecutionImpact": "NONE",
            "marketSignal": false,
            "mode": "NORMAL_SHADOW",
            "paperOrderAllowed": true,
            "positionLifecycleAllowed": true,
            "providerIssue": false,
            "reason": null,
            "shadowExecutionImpact": "NONE",
            "shadowScanAllowed": true,
            "shadowSignalAllowed": true,
            "source": "ALWAYS_ON_KERNEL",
            "sourceStatus": "VERIFIED",
            "virtualFillAllowed": true,
          },
          "sourceCoverage": {
            "allDeclaredInputsAvailable": true,
            "allExternalDataAvailable": true,
            "conditionCount": 3,
            "externalRequiredData": [],
            "missingExternalData": [],
            "missingInputs": [],
            "quoteInputCount": 5,
          },
          "tradability": {
            "executionImpact": "NONE",
            "market": "KOSPI",
            "marketSignal": false,
            "providerIssue": false,
            "reason": null,
            "source": "QMP_MASTER",
            "sourceStatus": "VERIFIED",
            "status": "TRADABLE",
            "stockType": "COMMON",
            "tradable": true,
          },
        },
        "quoteMissingCounterfactual": {
          "consolidatedDiagnostic": {
            "caseRecordingAllowed": true,
            "compactText": "Gate1: DEGRADED | issue=QUOTE_COVERAGE_DEGRADED | missing=currentPrice,volume | shadow=COUNTERFACTUAL_ONLY | action=CHECK_QUOTE_PROVIDER",
            "executionImpact": "DIAGNOSTIC_ONLY",
            "health": "DEGRADED",
            "liveBuyAllowed": true,
            "marketSignal": false,
            "operatorAction": "CHECK_QUOTE_PROVIDER",
            "primaryIssue": "QUOTE_COVERAGE_DEGRADED",
            "providerIssue": true,
            "shadowAllowed": true,
          },
          "liquidityFloor": {
            "avgTradingValue20d": 1000000000,
            "avgVolume20d": 1000000,
            "checks": {
              "avgTradingValuePass": true,
              "avgVolumePass": true,
              "tradingValuePass": true,
              "volumePass": null,
            },
            "currentPrice": null,
            "executionImpact": "DIAGNOSTIC_ONLY",
            "marketSignal": false,
            "providerIssue": true,
            "reason": "LIQUIDITY_INPUT_MISSING",
            "source": "KIS_OFFICIAL",
            "sourceStatus": "MISSING",
            "status": "MISSING",
            "tradingValue": 2000000000,
            "volume": null,
          },
          "marketSessionCompatibility": {
            "caseRecordingAllowed": true,
            "engineMode": "NORMAL",
            "executionImpact": "DIAGNOSTIC_ONLY",
            "liveBuyAllowed": true,
            "liveSellAllowed": true,
            "marketSignal": false,
            "observeAllowed": true,
            "providerIssue": false,
            "reason": null,
            "sellOnlyWindow": {
              "active": false,
              "matchedWindow": null,
            },
            "session": "REGULAR",
            "shadowAllowed": true,
            "source": "QMP_SESSION",
            "sourceStatus": "VERIFIED",
            "timeKst": null,
            "tradingDate": null,
          },
          "quoteCoverage": {
            "allRequiredFieldsPresent": false,
            "asOf": null,
            "confidence": "MISSING",
            "driftDiagnostics": [],
            "endpoint": "/uapi/domestic-stock/v1/quotations/inquire-price",
            "executionImpact": "DIAGNOSTIC_ONLY",
            "gate1DeclaredMissingInputs": [],
            "marketSignal": false,
            "missingFields": [
              "currentPrice",
              "volume",
            ],
            "presentFields": [
              "high",
              "low",
              "changePercent",
              "tradingValue",
            ],
            "providerIssue": true,
            "providerStatus": "FIELD_MISSING",
            "requiredFields": [
              "currentPrice",
              "volume",
              "high",
              "low",
              "changePercent",
              "tradingValue",
            ],
            "requiredParams": [
              "FID_COND_MRKT_DIV_CODE",
              "FID_INPUT_ISCD",
            ],
            "source": "KIS_OFFICIAL",
            "trId": "FHKST01010100",
          },
          "quoteFreshness": {
            "ageSec": "<AGE_SEC>",
            "asOf": "<ISO_TIMESTAMP>",
            "executionImpact": "DIAGNOSTIC_ONLY",
            "marketSignal": false,
            "provider": "KIS_OFFICIAL",
            "providerIssue": true,
            "status": "MISSING",
          },
          "shadowEligibility": {
            "allowed": true,
            "blockers": [
              "QUOTE_MISSING",
            ],
            "caseRecordingAllowed": true,
            "counterfactualLearningAllowed": true,
            "degradedReasons": [
              "QUOTE_COVERAGE_MISSING",
              "LIQUIDITY_DIAGNOSTIC_DEGRADED",
            ],
            "executionImpact": "NONE",
            "liveExecutionImpact": "LIVE_BUY_BLOCKED_ONLY",
            "marketSignal": false,
            "mode": "COUNTERFACTUAL_ONLY",
            "paperOrderAllowed": false,
            "positionLifecycleAllowed": false,
            "providerIssue": true,
            "reason": "QUOTE_MISSING_COUNTERFACTUAL_ONLY",
            "shadowExecutionImpact": "NONE",
            "shadowScanAllowed": true,
            "shadowSignalAllowed": false,
            "source": "ALWAYS_ON_KERNEL",
            "sourceStatus": "DEGRADED",
            "virtualFillAllowed": false,
          },
          "sourceCoverage": {
            "allDeclaredInputsAvailable": true,
            "allExternalDataAvailable": true,
            "conditionCount": 3,
            "externalRequiredData": [],
            "missingExternalData": [],
            "missingInputs": [],
            "quoteInputCount": 5,
          },
          "tradability": {
            "executionImpact": "NONE",
            "market": "KOSPI",
            "marketSignal": false,
            "providerIssue": false,
            "reason": null,
            "source": "QMP_MASTER",
            "sourceStatus": "VERIFIED",
            "status": "TRADABLE",
            "stockType": "COMMON",
            "tradable": true,
          },
        },
        "regularOk": {
          "consolidatedDiagnostic": {
            "caseRecordingAllowed": true,
            "compactText": "Gate1: OK | inputs=OK | quote=VERIFIED | tradable=TRADABLE | liquidity=PASS | session=REGULAR | shadow=NORMAL_SHADOW",
            "executionImpact": "NONE",
            "health": "OK",
            "liveBuyAllowed": true,
            "marketSignal": false,
            "operatorAction": "NONE",
            "primaryIssue": null,
            "providerIssue": false,
            "shadowAllowed": true,
          },
          "liquidityFloor": {
            "avgTradingValue20d": 1000000000,
            "avgVolume20d": 1000000,
            "checks": {
              "avgTradingValuePass": true,
              "avgVolumePass": true,
              "tradingValuePass": true,
              "volumePass": true,
            },
            "currentPrice": 100,
            "executionImpact": "DIAGNOSTIC_ONLY",
            "marketSignal": false,
            "providerIssue": false,
            "reason": null,
            "source": "KIS_OFFICIAL",
            "sourceStatus": "VERIFIED",
            "status": "PASS",
            "tradingValue": 2000000000,
            "volume": 200000,
          },
          "marketSessionCompatibility": {
            "caseRecordingAllowed": true,
            "engineMode": "NORMAL",
            "executionImpact": "DIAGNOSTIC_ONLY",
            "liveBuyAllowed": true,
            "liveSellAllowed": true,
            "marketSignal": false,
            "observeAllowed": true,
            "providerIssue": false,
            "reason": null,
            "sellOnlyWindow": {
              "active": false,
              "matchedWindow": null,
            },
            "session": "REGULAR",
            "shadowAllowed": true,
            "source": "QMP_SESSION",
            "sourceStatus": "VERIFIED",
            "timeKst": null,
            "tradingDate": null,
          },
          "quoteCoverage": {
            "allRequiredFieldsPresent": true,
            "asOf": null,
            "confidence": "VERIFIED",
            "driftDiagnostics": [],
            "endpoint": "/uapi/domestic-stock/v1/quotations/inquire-price",
            "executionImpact": "DIAGNOSTIC_ONLY",
            "gate1DeclaredMissingInputs": [],
            "marketSignal": false,
            "missingFields": [],
            "presentFields": [
              "currentPrice",
              "volume",
              "high",
              "low",
              "changePercent",
              "tradingValue",
            ],
            "providerIssue": false,
            "providerStatus": "OK_WITH_DATA",
            "requiredFields": [
              "currentPrice",
              "volume",
              "high",
              "low",
              "changePercent",
              "tradingValue",
            ],
            "requiredParams": [
              "FID_COND_MRKT_DIV_CODE",
              "FID_INPUT_ISCD",
            ],
            "source": "KIS_OFFICIAL",
            "trId": "FHKST01010100",
          },
          "quoteFreshness": {
            "ageSec": "<AGE_SEC>",
            "asOf": "<ISO_TIMESTAMP>",
            "executionImpact": "NONE",
            "marketSignal": false,
            "provider": "KIS_OFFICIAL",
            "providerIssue": false,
            "status": "OK",
          },
          "shadowEligibility": {
            "allowed": true,
            "blockers": [],
            "caseRecordingAllowed": true,
            "counterfactualLearningAllowed": true,
            "degradedReasons": [],
            "executionImpact": "NONE",
            "liveExecutionImpact": "NONE",
            "marketSignal": false,
            "mode": "NORMAL_SHADOW",
            "paperOrderAllowed": true,
            "positionLifecycleAllowed": true,
            "providerIssue": false,
            "reason": null,
            "shadowExecutionImpact": "NONE",
            "shadowScanAllowed": true,
            "shadowSignalAllowed": true,
            "source": "ALWAYS_ON_KERNEL",
            "sourceStatus": "VERIFIED",
            "virtualFillAllowed": true,
          },
          "sourceCoverage": {
            "allDeclaredInputsAvailable": true,
            "allExternalDataAvailable": true,
            "conditionCount": 3,
            "externalRequiredData": [],
            "missingExternalData": [],
            "missingInputs": [],
            "quoteInputCount": 5,
          },
          "tradability": {
            "executionImpact": "NONE",
            "market": "KOSPI",
            "marketSignal": false,
            "providerIssue": false,
            "reason": null,
            "source": "QMP_MASTER",
            "sourceStatus": "VERIFIED",
            "status": "TRADABLE",
            "stockType": "COMMON",
            "tradable": true,
          },
        },
        "sellOnlyShadowOn": {
          "consolidatedDiagnostic": {
            "caseRecordingAllowed": true,
            "compactText": "Gate1: LIVE_BLOCKED_ONLY | inputs=OK | quote=VERIFIED | tradable=TRADABLE | liquidity=PASS | session=SELL_ONLY | shadow=ON | issue=LIVE_BUY_BLOCKED_BUT_SHADOW_ALLOWED | action=CHECK_SESSION_POLICY",
            "executionImpact": "LIVE_BUY_BLOCKED_ONLY",
            "health": "BLOCKED_LIVE_ONLY",
            "liveBuyAllowed": false,
            "marketSignal": false,
            "operatorAction": "CHECK_SESSION_POLICY",
            "primaryIssue": "LIVE_BUY_BLOCKED_BUT_SHADOW_ALLOWED",
            "providerIssue": false,
            "shadowAllowed": true,
          },
          "liquidityFloor": {
            "avgTradingValue20d": 1000000000,
            "avgVolume20d": 1000000,
            "checks": {
              "avgTradingValuePass": true,
              "avgVolumePass": true,
              "tradingValuePass": true,
              "volumePass": true,
            },
            "currentPrice": 100,
            "executionImpact": "DIAGNOSTIC_ONLY",
            "marketSignal": false,
            "providerIssue": false,
            "reason": null,
            "source": "KIS_OFFICIAL",
            "sourceStatus": "VERIFIED",
            "status": "PASS",
            "tradingValue": 2000000000,
            "volume": 200000,
          },
          "marketSessionCompatibility": {
            "caseRecordingAllowed": true,
            "engineMode": "SELL_ONLY",
            "executionImpact": "LIVE_BUY_BLOCKED_ONLY",
            "liveBuyAllowed": false,
            "liveSellAllowed": true,
            "marketSignal": false,
            "observeAllowed": true,
            "providerIssue": false,
            "reason": "SELL_ONLY_WINDOW_OPENING_0900_0930",
            "sellOnlyWindow": {
              "active": true,
              "matchedWindow": "OPENING_0900_0930",
            },
            "session": "SELL_ONLY",
            "shadowAllowed": true,
            "source": "QMP_SESSION",
            "sourceStatus": "VERIFIED",
            "timeKst": null,
            "tradingDate": null,
          },
          "quoteCoverage": {
            "allRequiredFieldsPresent": true,
            "asOf": null,
            "confidence": "VERIFIED",
            "driftDiagnostics": [],
            "endpoint": "/uapi/domestic-stock/v1/quotations/inquire-price",
            "executionImpact": "DIAGNOSTIC_ONLY",
            "gate1DeclaredMissingInputs": [],
            "marketSignal": false,
            "missingFields": [],
            "presentFields": [
              "currentPrice",
              "volume",
              "high",
              "low",
              "changePercent",
              "tradingValue",
            ],
            "providerIssue": false,
            "providerStatus": "OK_WITH_DATA",
            "requiredFields": [
              "currentPrice",
              "volume",
              "high",
              "low",
              "changePercent",
              "tradingValue",
            ],
            "requiredParams": [
              "FID_COND_MRKT_DIV_CODE",
              "FID_INPUT_ISCD",
            ],
            "source": "KIS_OFFICIAL",
            "trId": "FHKST01010100",
          },
          "quoteFreshness": {
            "ageSec": "<AGE_SEC>",
            "asOf": "<ISO_TIMESTAMP>",
            "executionImpact": "NONE",
            "marketSignal": false,
            "provider": "KIS_OFFICIAL",
            "providerIssue": false,
            "status": "OK",
          },
          "shadowEligibility": {
            "allowed": true,
            "blockers": [],
            "caseRecordingAllowed": true,
            "counterfactualLearningAllowed": true,
            "degradedReasons": [],
            "executionImpact": "NONE",
            "liveExecutionImpact": "LIVE_BUY_BLOCKED_ONLY",
            "marketSignal": false,
            "mode": "NORMAL_SHADOW",
            "paperOrderAllowed": true,
            "positionLifecycleAllowed": true,
            "providerIssue": false,
            "reason": "LIVE_BUY_BLOCKED_BY_SELL_ONLY_BUT_SHADOW_ALLOWED",
            "shadowExecutionImpact": "NONE",
            "shadowScanAllowed": true,
            "shadowSignalAllowed": true,
            "source": "ALWAYS_ON_KERNEL",
            "sourceStatus": "VERIFIED",
            "virtualFillAllowed": true,
          },
          "sourceCoverage": {
            "allDeclaredInputsAvailable": true,
            "allExternalDataAvailable": true,
            "conditionCount": 3,
            "externalRequiredData": [],
            "missingExternalData": [],
            "missingInputs": [],
            "quoteInputCount": 5,
          },
          "tradability": {
            "executionImpact": "NONE",
            "market": "KOSPI",
            "marketSignal": false,
            "providerIssue": false,
            "reason": null,
            "source": "QMP_MASTER",
            "sourceStatus": "VERIFIED",
            "status": "TRADABLE",
            "stockType": "COMMON",
            "tradable": true,
          },
        },
        "shadowDisabledUnexpected": {
          "consolidatedDiagnostic": {
            "caseRecordingAllowed": false,
            "compactText": "Gate1: DEGRADED | inputs=OK | quote=VERIFIED | tradable=TRADABLE | liquidity=PASS | session=REGULAR | shadow=DISABLED_UNEXPECTED | issue=SHADOW_DISABLED_UNEXPECTED | action=CHECK_SHADOW_KERNEL",
            "executionImpact": "DIAGNOSTIC_ONLY",
            "health": "DEGRADED",
            "liveBuyAllowed": true,
            "marketSignal": false,
            "operatorAction": "CHECK_SHADOW_KERNEL",
            "primaryIssue": "SHADOW_DISABLED_UNEXPECTED",
            "providerIssue": true,
            "shadowAllowed": false,
          },
          "liquidityFloor": {
            "avgTradingValue20d": 1000000000,
            "avgVolume20d": 1000000,
            "checks": {
              "avgTradingValuePass": true,
              "avgVolumePass": true,
              "tradingValuePass": true,
              "volumePass": true,
            },
            "currentPrice": 100,
            "executionImpact": "DIAGNOSTIC_ONLY",
            "marketSignal": false,
            "providerIssue": false,
            "reason": null,
            "source": "KIS_OFFICIAL",
            "sourceStatus": "VERIFIED",
            "status": "PASS",
            "tradingValue": 2000000000,
            "volume": 200000,
          },
          "marketSessionCompatibility": {
            "caseRecordingAllowed": true,
            "engineMode": "NORMAL",
            "executionImpact": "DIAGNOSTIC_ONLY",
            "liveBuyAllowed": true,
            "liveSellAllowed": true,
            "marketSignal": false,
            "observeAllowed": true,
            "providerIssue": false,
            "reason": null,
            "sellOnlyWindow": {
              "active": false,
              "matchedWindow": null,
            },
            "session": "REGULAR",
            "shadowAllowed": true,
            "source": "QMP_SESSION",
            "sourceStatus": "VERIFIED",
            "timeKst": null,
            "tradingDate": null,
          },
          "quoteCoverage": {
            "allRequiredFieldsPresent": true,
            "asOf": null,
            "confidence": "VERIFIED",
            "driftDiagnostics": [],
            "endpoint": "/uapi/domestic-stock/v1/quotations/inquire-price",
            "executionImpact": "DIAGNOSTIC_ONLY",
            "gate1DeclaredMissingInputs": [],
            "marketSignal": false,
            "missingFields": [],
            "presentFields": [
              "currentPrice",
              "volume",
              "high",
              "low",
              "changePercent",
              "tradingValue",
            ],
            "providerIssue": false,
            "providerStatus": "OK_WITH_DATA",
            "requiredFields": [
              "currentPrice",
              "volume",
              "high",
              "low",
              "changePercent",
              "tradingValue",
            ],
            "requiredParams": [
              "FID_COND_MRKT_DIV_CODE",
              "FID_INPUT_ISCD",
            ],
            "source": "KIS_OFFICIAL",
            "trId": "FHKST01010100",
          },
          "quoteFreshness": {
            "ageSec": "<AGE_SEC>",
            "asOf": "<ISO_TIMESTAMP>",
            "executionImpact": "NONE",
            "marketSignal": false,
            "provider": "KIS_OFFICIAL",
            "providerIssue": false,
            "status": "OK",
          },
          "shadowEligibility": {
            "allowed": false,
            "blockers": [
              "ALWAYS_ON_KERNEL_DISABLED",
            ],
            "caseRecordingAllowed": false,
            "counterfactualLearningAllowed": false,
            "degradedReasons": [
              "ALWAYS_ON_KERNEL_DISABLED",
            ],
            "executionImpact": "NONE",
            "liveExecutionImpact": "LIVE_EXECUTION_BLOCKED",
            "marketSignal": false,
            "mode": "DISABLED_UNEXPECTED",
            "paperOrderAllowed": false,
            "positionLifecycleAllowed": false,
            "providerIssue": true,
            "reason": "ALWAYS_ON_KERNEL_DISABLED_UNEXPECTED",
            "shadowExecutionImpact": "NONE",
            "shadowScanAllowed": false,
            "shadowSignalAllowed": false,
            "source": "QMP_POLICY",
            "sourceStatus": "DEGRADED",
            "virtualFillAllowed": false,
          },
          "sourceCoverage": {
            "allDeclaredInputsAvailable": true,
            "allExternalDataAvailable": true,
            "conditionCount": 3,
            "externalRequiredData": [],
            "missingExternalData": [],
            "missingInputs": [],
            "quoteInputCount": 5,
          },
          "tradability": {
            "executionImpact": "NONE",
            "market": "KOSPI",
            "marketSignal": false,
            "providerIssue": false,
            "reason": null,
            "source": "QMP_MASTER",
            "sourceStatus": "VERIFIED",
            "status": "TRADABLE",
            "stockType": "COMMON",
            "tradable": true,
          },
        },
      }
    `);
  });
});
