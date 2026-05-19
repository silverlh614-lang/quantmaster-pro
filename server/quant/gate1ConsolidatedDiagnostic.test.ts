// @responsibility Gate1 consolidated diagnostic renderer tests.

import { describe, expect, it } from 'vitest';
import type { GateLayerSummary } from '../quantFilter.js';
import { buildGate1ConsolidatedDiagnostic } from './gate1ConsolidatedDiagnostic.js';

function baseGate1(): GateLayerSummary['gate1'] {
  return {
    fired: ['ma_alignment', 'ma60_rising', 'weekly_rsi_zone'],
    unavailable: [],
    thresholdNotMet: [],
    providerDegraded: [],
    passed: true,
    score: 2.8,
    availableMaxScore: 2.8,
    wiring: [],
    sourceCoverage: {
      conditionCount: 3,
      quoteInputCount: 5,
      externalRequiredData: [],
      missingInputs: [],
      missingExternalData: [],
      allDeclaredInputsAvailable: true,
      allExternalDataAvailable: true,
    },
    survival: {
      quoteFreshness: {
        status: 'OK',
        asOf: '2026-05-19T09:30:00+09:00',
        ageSec: 10,
        provider: 'KIS_OFFICIAL',
        executionImpact: 'NONE',
        providerIssue: false,
        marketSignal: false,
      },
      tradability: {
        status: 'TRADABLE',
        source: 'QMP_MASTER',
        reason: null,
        executionImpact: 'DIAGNOSTIC_ONLY',
      },
      liquidityFloor: {
        status: 'PASS',
        volume: 1_000_000,
        avgVolume20d: 800_000,
        tradingValue: 12_000_000_000,
        avgTradingValue20d: 9_600_000_000,
        currentPrice: 12_000,
        threshold: {
          minVolume: 100_000,
          minTradingValue: 1_000_000_000,
          minAvgVolume20d: 50_000,
          minAvgTradingValue20d: 500_000_000,
        },
        checks: {
          volumePass: true,
          tradingValuePass: true,
          avgVolumePass: true,
          avgTradingValuePass: true,
        },
        source: 'KIS_OFFICIAL',
        sourceStatus: 'VERIFIED',
        reason: null,
        providerIssue: false,
        marketSignal: false,
        executionImpact: 'DIAGNOSTIC_ONLY',
      },
      marketSessionCompatibility: {
        session: 'REGULAR',
        engineMode: 'NORMAL',
        liveBuyAllowed: true,
        liveSellAllowed: true,
        shadowAllowed: true,
        observeAllowed: true,
        caseRecordingAllowed: true,
        reason: null,
        timeKst: '2026-05-19T10:15:00+09:00',
        tradingDate: '2026-05-19',
        sellOnlyWindow: {
          active: false,
          matchedWindow: null,
        },
        source: 'MARKET_CLOCK',
        sourceStatus: 'VERIFIED',
        providerIssue: false,
        marketSignal: false,
        executionImpact: 'DIAGNOSTIC_ONLY',
      },
      kisOfficialQuoteCoverage: {
        source: 'KIS_OFFICIAL',
        endpoint: '/uapi/domestic-stock/v1/quotations/inquire-price',
        trId: 'FHKST01010100',
        requiredParams: ['FID_COND_MRKT_DIV_CODE', 'FID_INPUT_ISCD'],
        requiredFields: ['currentPrice', 'volume', 'high', 'low', 'changePercent', 'tradingValue'],
        presentFields: ['currentPrice', 'volume', 'high', 'low', 'changePercent', 'tradingValue'],
        missingFields: [],
        allRequiredFieldsPresent: true,
        providerStatus: 'OK_WITH_DATA',
        confidence: 'VERIFIED',
        providerIssue: false,
        marketSignal: false,
        executionImpact: 'DIAGNOSTIC_ONLY',
        asOf: '2026-05-19T09:30:00+09:00',
        gate1DeclaredMissingInputs: [],
        driftDiagnostics: [],
      },
      shadowEligibility: {
        allowed: true,
        mode: 'NORMAL_SHADOW',
        shadowScanAllowed: true,
        shadowSignalAllowed: true,
        paperOrderAllowed: true,
        virtualFillAllowed: true,
        positionLifecycleAllowed: true,
        counterfactualLearningAllowed: true,
        caseRecordingAllowed: true,
        reason: null,
        blockers: [],
        degradedReasons: [],
        source: 'ALWAYS_ON_KERNEL',
        sourceStatus: 'VERIFIED',
        liveExecutionImpact: 'NONE',
        shadowExecutionImpact: 'NONE',
        executionImpact: 'NONE',
        providerIssue: false,
        marketSignal: false,
      },
    },
  };
}

describe('Gate1 consolidated diagnostic renderer', () => {
  it('renders OK when wiring, quote, tradability, liquidity, session, and shadow are healthy', () => {
    const diagnostic = buildGate1ConsolidatedDiagnostic({ gate1: baseGate1() });

    expect(diagnostic).toMatchObject({
      health: 'OK',
      primaryIssue: null,
      operatorAction: 'NONE',
      liveBuyAllowed: true,
      shadowAllowed: true,
      caseRecordingAllowed: true,
      marketSignal: false,
      executionImpact: 'NONE',
    });
    expect(diagnostic.compactText).toContain('Gate1: OK');
    expect(diagnostic.telegramText.split('\n').length).toBeLessThanOrEqual(8);
  });

  it('renders BLOCKED_LIVE_ONLY for SELL_ONLY while keeping shadow visible', () => {
    const gate1 = baseGate1();
    gate1.survival!.marketSessionCompatibility = {
      session: 'SELL_ONLY',
      engineMode: 'SELL_ONLY',
      liveBuyAllowed: false,
      liveSellAllowed: true,
      shadowAllowed: true,
      observeAllowed: true,
      caseRecordingAllowed: true,
      reason: 'SELL_ONLY_WINDOW_OPENING_0900_0930',
      timeKst: '2026-05-19T09:10:00+09:00',
      tradingDate: '2026-05-19',
      sellOnlyWindow: {
        active: true,
        matchedWindow: 'OPENING_0900_0930',
      },
      source: 'QMP_SESSION',
      sourceStatus: 'VERIFIED',
      providerIssue: false,
      marketSignal: false,
      executionImpact: 'LIVE_BUY_BLOCKED_ONLY',
    };
    gate1.survival!.shadowEligibility = {
      ...gate1.survival!.shadowEligibility,
      mode: 'NORMAL_SHADOW',
      liveExecutionImpact: 'LIVE_BUY_BLOCKED_ONLY',
      reason: 'LIVE_BUY_BLOCKED_BY_SELL_ONLY_BUT_SHADOW_ALLOWED',
    };

    const diagnostic = buildGate1ConsolidatedDiagnostic({ gate1 });

    expect(diagnostic).toMatchObject({
      health: 'BLOCKED_LIVE_ONLY',
      primaryIssue: 'LIVE_BUY_BLOCKED_BUT_SHADOW_ALLOWED',
      operatorAction: 'CHECK_SESSION_POLICY',
      executionImpact: 'LIVE_BUY_BLOCKED_ONLY',
      marketSignal: false,
    });
    expect(diagnostic.compactText).toContain('shadow=ON');
  });

  it('renders DEGRADED for quote coverage degradation without market signal', () => {
    const gate1 = baseGate1();
    gate1.survival!.kisOfficialQuoteCoverage = {
      ...gate1.survival!.kisOfficialQuoteCoverage,
      confidence: 'DEGRADED',
      providerStatus: 'FIELD_MISSING',
      missingFields: ['currentPrice', 'volume'],
      allRequiredFieldsPresent: false,
      providerIssue: true,
    };
    gate1.survival!.shadowEligibility = {
      ...gate1.survival!.shadowEligibility,
      mode: 'COUNTERFACTUAL_ONLY',
      shadowSignalAllowed: false,
      paperOrderAllowed: false,
      virtualFillAllowed: false,
      positionLifecycleAllowed: false,
      providerIssue: true,
      degradedReasons: ['QUOTE_COVERAGE_DEGRADED'],
    };

    const diagnostic = buildGate1ConsolidatedDiagnostic({ gate1 });

    expect(diagnostic).toMatchObject({
      health: 'DEGRADED',
      operatorAction: 'CHECK_QUOTE_PROVIDER',
      primaryIssue: 'QUOTE_COVERAGE_DEGRADED',
      marketSignal: false,
      providerIssue: true,
      executionImpact: 'DIAGNOSTIC_ONLY',
    });
    expect(diagnostic.compactText).toContain('missing=currentPrice,volume');
  });

  it('points to stock master when tradability is unknown', () => {
    const gate1 = baseGate1();
    gate1.survival!.tradability = {
      status: 'UNKNOWN',
      source: 'UNKNOWN',
      reason: 'STOCK_MASTER_MISSING',
      executionImpact: 'DIAGNOSTIC_ONLY',
    };

    const diagnostic = buildGate1ConsolidatedDiagnostic({ gate1 });

    expect(diagnostic).toMatchObject({
      health: 'WARN',
      operatorAction: 'CHECK_STOCK_MASTER',
      primaryIssue: 'TRADABILITY_UNKNOWN',
      marketSignal: false,
    });
  });

  it('renders liquidity advisory warnings without changing execution policy', () => {
    const gate1 = baseGate1();
    gate1.survival!.liquidityFloor = {
      ...gate1.survival!.liquidityFloor,
      status: 'THIN',
      checks: {
        volumePass: false,
        tradingValuePass: false,
        avgVolumePass: false,
        avgTradingValuePass: false,
      },
      reason: 'LIQUIDITY_BELOW_FLOOR',
    };

    const diagnostic = buildGate1ConsolidatedDiagnostic({ gate1 });

    expect(diagnostic).toMatchObject({
      health: 'WARN',
      operatorAction: 'CHECK_LIQUIDITY',
      primaryIssue: 'LIQUIDITY_WEAK',
      marketSignal: false,
      executionImpact: 'DIAGNOSTIC_ONLY',
    });
  });

  it('does not hide DISABLED_UNEXPECTED shadow kernel state', () => {
    const gate1 = baseGate1();
    gate1.survival!.shadowEligibility = {
      ...gate1.survival!.shadowEligibility,
      allowed: false,
      mode: 'DISABLED_UNEXPECTED',
      shadowScanAllowed: false,
      shadowSignalAllowed: false,
      paperOrderAllowed: false,
      virtualFillAllowed: false,
      positionLifecycleAllowed: false,
      reason: 'ALWAYS_ON_KERNEL_DISABLED_UNEXPECTED',
      blockers: ['ALWAYS_ON_KERNEL_DISABLED'],
      degradedReasons: ['ALWAYS_ON_KERNEL_DISABLED'],
      source: 'QMP_POLICY',
      sourceStatus: 'DEGRADED',
      liveExecutionImpact: 'LIVE_EXECUTION_BLOCKED',
      providerIssue: true,
    };

    const diagnostic = buildGate1ConsolidatedDiagnostic({ gate1 });

    expect(diagnostic).toMatchObject({
      health: 'DEGRADED',
      operatorAction: 'CHECK_SHADOW_KERNEL',
      primaryIssue: 'SHADOW_DISABLED_UNEXPECTED',
      shadowAllowed: false,
      marketSignal: false,
    });
  });
});
