// @responsibility Gate2 PER/DART 데이터 라인 표시·분류 순수 함수 단위 테스트 (5상태 분기 + providerIssue/marketSignal 불변식).

import { describe, expect, it } from 'vitest';
import { classifyDartLineHealth, classifyPerValuationDisplay } from './dataLineClassification.js';
import type { Gate2DerivedMetrics, Gate2ExternalRefreshTrace } from './types.js';

function metrics(overrides: Partial<Gate2DerivedMetrics> = {}): Gate2DerivedMetrics {
  return {
    per: null,
    roe: null,
    opm: null,
    netMargin: null,
    icr: null,
    debtRatio: null,
    currentRatio: null,
    earningsQualityScore: null,
    ocfGreaterThanNetIncome: null,
    opmYoYAcceleration: null,
    ...overrides,
  };
}

function trace(overrides: Partial<Gate2ExternalRefreshTrace> = {}): Gate2ExternalRefreshTrace {
  return {
    symbol: '005930',
    corpCodeResolveStatus: 'FOUND',
    fiscalPeriodStatus: 'RESOLVED',
    corpCodeRequestAttempted: true,
    dartRequestAttempted: true,
    dartRawRows: 10,
    normalizedRows: 10,
    derivedMetricsComputed: true,
    kisPerRequestAttempted: false,
    finalConfidence: 'VERIFIED',
    unavailableConditions: [],
    executionImpact: 'NONE',
    ...overrides,
  };
}

const ALL_FIELDS = metrics({ roe: 0.1, opm: 0.1, icr: 2, earningsQualityScore: 1.2 });

describe('classifyDartLineHealth', () => {
  it('VERIFIED when all required fields present', () => {
    const health = classifyDartLineHealth({ metrics: ALL_FIELDS, refreshTrace: trace() });
    expect(health.status).toBe('VERIFIED');
    expect(health.missingFields).toEqual([]);
    expect(health.providerIssue).toBe(false);
    expect(health.marketSignal).toBe(false);
    expect(health.executionImpact).toBe('NONE');
    expect(health.primaryIssue).toBe('NONE');
  });

  it('PARTIAL when some fields present and some missing', () => {
    const health = classifyDartLineHealth({
      metrics: metrics({ roe: 0.1, opm: 0.1 }),
      refreshTrace: trace(),
    });
    expect(health.status).toBe('PARTIAL');
    expect(health.availableFields).toEqual(['roe', 'opm']);
    expect(health.missingFields).toContain('earningsQuality');
    expect(health.providerIssue).toBe(false);
  });

  it('DEGRADED only on transport/parse error (http >= 400)', () => {
    const health = classifyDartLineHealth({
      metrics: ALL_FIELDS,
      refreshTrace: trace({ dartHttpStatus: 500 }),
    });
    expect(health.status).toBe('DEGRADED');
    expect(health.providerIssue).toBe(true);
    expect(health.marketSignal).toBe(false);
    expect(health.executionImpact).toBe('NONE');
  });

  it('DEGRADED + providerIssue on dartErrorCode (parse error)', () => {
    const health = classifyDartLineHealth({
      metrics: metrics(),
      refreshTrace: trace({ dartErrorCode: 'PARSE_FAILED', dartRawRows: 0 }),
    });
    expect(health.status).toBe('DEGRADED');
    expect(health.providerIssue).toBe(true);
  });

  it('EMPTY_VALID when attempted, no error, zero rows, no fields (미보고/기간)', () => {
    const health = classifyDartLineHealth({
      metrics: metrics(),
      refreshTrace: trace({ dartRawRows: 0, normalizedRows: 0, derivedMetricsComputed: false }),
    });
    expect(health.status).toBe('EMPTY_VALID');
    expect(health.providerIssue).toBe(false);
    expect(health.marketSignal).toBe(false);
    expect(health.primaryIssue).toBe('DATA_UNAVAILABLE:earnings_quality');
  });

  it('NOT_ATTEMPTED when dartRequestAttempted=false', () => {
    const health = classifyDartLineHealth({
      metrics: metrics(),
      refreshTrace: trace({ dartRequestAttempted: false }),
    });
    expect(health.status).toBe('NOT_ATTEMPTED');
    expect(health.providerIssue).toBe(false);
  });

  it('NOT_ATTEMPTED when no refreshTrace provided', () => {
    const health = classifyDartLineHealth({ metrics: ALL_FIELDS });
    expect(health.status).toBe('NOT_ATTEMPTED');
  });

  it('kisFinance.kisMergeApplied=true + KIS_PRIMARY when currentRatio present (ADR-0532 진단)', () => {
    // currentRatio 는 DART 정규화가 산출하지 않고 KIS stability-ratio 만 제공 → KIS 머지 적용 신호.
    const health = classifyDartLineHealth({
      metrics: metrics({ roe: 13.5, opm: 28.5, debtRatio: 45.6, currentRatio: 210.5 }),
      refreshTrace: trace(),
    });
    expect(health.kisFinance?.kisMergeApplied).toBe(true);
    expect(health.kisFinance?.financeSource).toBe('KIS_PRIMARY');
    expect(health.kisFinance?.debtRatio).toBe(45.6);
    expect(health.kisFinance?.currentRatio).toBe(210.5);
    expect(health.kisFinance?.roe).toBe(13.5);
    expect(health.kisFinance?.opm).toBe(28.5);
  });

  it('kisFinance DART_OR_DERIVED when roe/opm present but no currentRatio (KIS 미머지)', () => {
    const health = classifyDartLineHealth({
      metrics: metrics({ roe: 5.0, opm: 10.8 }),
      refreshTrace: trace(),
    });
    expect(health.kisFinance?.kisMergeApplied).toBe(false);
    expect(health.kisFinance?.financeSource).toBe('DART_OR_DERIVED');
    expect(health.kisFinance?.currentRatio).toBeNull();
  });

  it('kisFinance UNAVAILABLE when no roe/opm/currentRatio', () => {
    const health = classifyDartLineHealth({ metrics: metrics(), refreshTrace: trace() });
    expect(health.kisFinance?.kisMergeApplied).toBe(false);
    expect(health.kisFinance?.financeSource).toBe('UNAVAILABLE');
  });

  it('simple absence (no error) keeps providerIssue=false and marketSignal=false', () => {
    const health = classifyDartLineHealth({
      metrics: metrics({ roe: 0.1 }),
      refreshTrace: trace({ dartRawRows: 5 }),
    });
    expect(health.providerIssue).toBe(false);
    expect(health.marketSignal).toBe(false);
    expect(health.executionImpact).toBe('NONE');
  });
});

describe('classifyPerValuationDisplay', () => {
  it('AVAILABLE with KIS direct PER → HIGH confidence', () => {
    const display = classifyPerValuationDisplay({
      perCondition: { status: 'PASS', value: 12 },
      metricsPer: 12,
      perSource: 'KIS',
      perReason: 'PER_ACCEPTABLE',
      highConvictionImpact: 'NONE',
    });
    expect(display.perStatus).toBe('AVAILABLE');
    expect(display.rawPER).toBe(12);
    expect(display.normalizedPER).toBe(12);
    expect(display.confidence).toBe('HIGH');
    expect(display.entryHardBlockImpact).toBe('NO');
    expect(display.executionImpact).toBe('NONE');
  });

  it('KIS computed PER (price/eps) → MEDIUM confidence', () => {
    const display = classifyPerValuationDisplay({
      perCondition: { status: 'PASS', value: 8 },
      metricsPer: 8,
      perSource: 'KIS',
      perReason: 'PER_COMPUTED_FROM_KIS_PRICE_EPS',
      highConvictionImpact: 'NONE',
    });
    expect(display.confidence).toBe('MEDIUM');
  });

  it('UNAVAILABLE non-positive PER → LOW confidence, rawPER preserved, normalizedPER null', () => {
    const display = classifyPerValuationDisplay({
      perCondition: { status: 'UNAVAILABLE', value: null },
      metricsPer: -5,
      perSource: 'KIS',
      perReason: 'PER_NON_POSITIVE_OR_UNAVAILABLE',
      highConvictionImpact: 'BLOCK_STRONG_BUY_UPGRADE',
    });
    expect(display.perStatus).toBe('UNAVAILABLE');
    expect(display.rawPER).toBe(-5);
    expect(display.normalizedPER).toBeNull();
    expect(display.confidence).toBe('LOW');
    expect(display.entryHardBlockImpact).toBe('NO');
    expect(display.executionImpact).toBe('NONE');
    expect(display.highConvictionImpact).toBe('BLOCK_STRONG_BUY_UPGRADE');
  });

  it('UNAVAILABLE (no value) → LOW confidence + null normalizedPER', () => {
    const display = classifyPerValuationDisplay({
      perCondition: { status: 'UNAVAILABLE', value: null },
      metricsPer: null,
      perSource: 'NONE',
      perReason: 'PER_MISSING',
      highConvictionImpact: 'NONE',
    });
    expect(display.perStatus).toBe('UNAVAILABLE');
    expect(display.rawPER).toBeNull();
    expect(display.normalizedPER).toBeNull();
    expect(display.confidence).toBe('LOW');
  });

  it('DART_EPS_PRICE derived PER → MEDIUM confidence', () => {
    const display = classifyPerValuationDisplay({
      perCondition: { status: 'PASS', value: 15 },
      metricsPer: 15,
      perSource: 'DART_EPS_PRICE',
      perReason: 'PER_COMPUTED_FROM_DART_EPS_AND_KIS_PRICE',
      highConvictionImpact: 'NONE',
    });
    expect(display.confidence).toBe('MEDIUM');
  });
});
