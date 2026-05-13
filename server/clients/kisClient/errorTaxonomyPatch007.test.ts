/**
 * @responsibility KIS-ERROR-TAXONOMY-AND-ROUTER-007 regression tests.
 */

import { describe, it, expect, beforeEach } from 'vitest';

import {
  __resetKisErrorTaxonomyForTests,
  classifyKisError,
  formatKisProviderHealthSummary,
  getKisCallPressureSnapshot,
  isKisServerCircuitOpen,
  isKisTemporaryUnsupported,
  KIS_ERROR_TAXONOMY_CONSTANTS,
  kisTrCoverageMap,
  recordKisCallFinished,
  recordKisCallStarted,
  recordKisServerErrorForCircuit,
  recordKisUnsupported404,
  selectKisFallback,
} from './errorTaxonomy.js';

beforeEach(() => {
  __resetKisErrorTaxonomyForTests();
});

describe('KIS-ERROR-TAXONOMY-AND-ROUTER-007 — classification and retry policy', () => {
  it('Test 1/2/3/9: 404 is unsupported/param class, non-retryable, isolated from market signal', () => {
    const r = classifyKisError({
      httpStatus: 404,
      trId: 'FHKST01710000',
      endpoint: kisTrCoverageMap.FHKST01710000.endpoint,
      marketCode: 'KOSPI',
      symbol: '005930',
    });
    expect(r.errorClass).toBe('NOT_FOUND_OR_UNSUPPORTED');
    expect(r.retryable).toBe(false);
    expect(r.fallbackRequired).toBe(true);
    expect(r.circuitBreakerEligible).toBe(false);
    expect(r.providerIssue).toBe(true);
    expect(r.marketSignal).toBe(false);
    expect(r.executionImpact).toBe('NONE');

    const server = classifyKisError({ httpStatus: 500, trId: 'FHKST03010100' });
    expect(server.errorClass).toBe('SERVER_ERROR');
    expect(server.errorClass).not.toBe(r.errorClass);
  });

  it('Test 2: 404 with market/symbol mismatch is PARAM_MISMATCH', () => {
    expect(classifyKisError({ httpStatus: 404, trId: 'FHKST01710000', marketCode: 'NYSE', symbol: '005930' }).errorClass)
      .toBe('PARAM_MISMATCH');
    expect(classifyKisError({ httpStatus: 404, trId: 'FHKST01710000', marketCode: 'KOSPI', symbol: 'AAPL' }).errorClass)
      .toBe('PARAM_MISMATCH');
  });

  it('Test 4/6: 500 is retryable with bounded max retry and no market/execution impact', () => {
    const r = classifyKisError({ httpStatus: 500, trId: 'FHKST03010100' });
    expect(r.errorClass).toBe('SERVER_ERROR');
    expect(r.retryable).toBe(true);
    expect(r.circuitBreakerEligible).toBe(true);
    expect(KIS_ERROR_TAXONOMY_CONSTANTS.SERVER_MAX_RETRIES).toBe(2);
    expect(r.marketSignal).toBe(false);
    expect(r.executionImpact).toBe('NONE');
  });

  it('EMPTY_OUTPUT is not treated as server-error retry storm', () => {
    const r = classifyKisError({ httpStatus: 200, outputLength: 0, trId: 'FHKST01010100' });
    expect(r.errorClass).toBe('EMPTY_OUTPUT');
    expect(r.retryable).toBe(false);
    expect(r.fallbackRequired).toBe(true);
    expect(r.circuitBreakerEligible).toBe(false);
  });
});

describe('KIS-ERROR-TAXONOMY-AND-ROUTER-007 — unsupported TTL and circuit', () => {
  it('Test 7: repeated 404 on same TR/provider combination is suppressed by unsupported TTL', () => {
    const now = Date.parse('2026-05-13T00:00:00Z');
    const input = { trId: 'FHKST01710000', endpoint: kisTrCoverageMap.FHKST01710000.endpoint, marketCode: 'KOSPI' };
    recordKisUnsupported404({ ...input, httpStatus: 404 }, now);
    expect(isKisTemporaryUnsupported(input, now + 1_000)).toBe(true);
    expect(isKisTemporaryUnsupported(input, now + KIS_ERROR_TAXONOMY_CONSTANTS.UNSUPPORTED_TTL_MS + 1)).toBe(false);
  });

  it('Test 5: same TR 500 burst opens circuit within 60 seconds', () => {
    const t = Date.parse('2026-05-13T10:00:00Z');
    expect(recordKisServerErrorForCircuit('FHKST03010100', t).opened).toBe(false);
    expect(recordKisServerErrorForCircuit('FHKST03010100', t + 10_000).opened).toBe(false);
    const opened = recordKisServerErrorForCircuit('FHKST03010100', t + 20_000);
    expect(opened.opened).toBe(true);
    expect(opened.reason).toBe('HTTP_500_BURST');
    expect(isKisServerCircuitOpen('FHKST03010100', t + 21_000)).toBe(true);
  });

  it('consecutive 500 failures open circuit even outside the 60s burst window', () => {
    const t = Date.parse('2026-05-13T10:00:00Z');
    for (let i = 0; i < 4; i += 1) {
      const r = recordKisServerErrorForCircuit('FHKST03010100', t + i * 70_000);
      expect(r.opened).toBe(false);
    }
    const opened = recordKisServerErrorForCircuit('FHKST03010100', t + 280_000);
    expect(opened.opened).toBe(true);
    expect(opened.reason).toBe('CONSECUTIVE_FAILURES');
  });
});

describe('KIS-ERROR-TAXONOMY-AND-ROUTER-007 — call pressure, fallback, report summary', () => {
  it('Test 8: 500 context can include sameSecondCalls, sameMinuteCalls, concurrentCalls', () => {
    const t = Date.parse('2026-05-13T10:00:00Z');
    recordKisCallStarted('FHKST03010100', t);
    recordKisCallStarted('FHKST03010100', t + 100);
    const snap = getKisCallPressureSnapshot(t + 200);
    expect(snap.sameSecondCalls).toBe(2);
    expect(snap.sameMinuteCalls).toBe(2);
    expect(snap.concurrentCalls).toBe(2);
    expect(snap.byTrId.FHKST03010100).toBe(2);
    recordKisCallFinished();
    recordKisCallFinished();
  });

  it('Test 7 routing: 404 avoids same TR retry and selects alternative fallback', () => {
    const fallback = selectKisFallback({ trId: 'FHKST01710000', errorClass: 'NOT_FOUND_OR_UNSUPPORTED' });
    expect(fallback.fallbackProvider).toBe('KIS_ALT');
    expect(fallback.executionImpact).toBe('NONE');
    expect(fallback.marketSignal).toBe(false);
  });

  it('Test 10: provider health summary stays operationally isolated for trading/shadow learning', () => {
    const summary = formatKisProviderHealthSummary({ notFoundCount: 1, serverErrorCount: 3, circuitActive: true });
    expect(summary).toContain('KIS Provider Health:');
    expect(summary).toContain('executionImpact=NONE');
    expect(summary).toContain('marketSignal=false');
    // KIS taxonomy reports provider health only; no engine stop / shadow learning stop flag exists here.
    expect(summary).not.toContain('emergencyStop');
    expect(summary).not.toContain('shadowLearningAllowed=false');
  });
});
