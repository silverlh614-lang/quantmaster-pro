/**
 * @responsibility KIS-TR-CALL-PRESSURE-CONTROL-008 regression tests.
 */

import { beforeEach, describe, expect, it } from 'vitest';

import {
  __resetKisErrorTaxonomyForTests,
  assessKisTrPressure,
  claimKisHalfOpenTest,
  classifyKisError,
  coordinateKisRetry,
  extendKisTrCircuit,
  getKisCallPressureSnapshot,
  getKisTrCircuitState,
  isKisServerCircuitOpen,
  KIS_ERROR_TAXONOMY_CONSTANTS,
  recordKisCallStarted,
  recordKisServerErrorForCircuit,
  recordKisServerSuccess,
  selectKisFallback,
} from './errorTaxonomy.js';

beforeEach(() => {
  __resetKisErrorTaxonomyForTests();
});

describe('KIS-TR-CALL-PRESSURE-CONTROL-008 — TR pressure and circuit policy', () => {
  it('Test 1: opens TR circuit when same TR is called 9 times within one second', () => {
    const t = Date.parse('2026-05-13T00:00:00Z');
    for (let i = 0; i < 9; i += 1) recordKisCallStarted('FHPPG04650101', t + i * 10);

    const gate = assessKisTrPressure({ trId: 'FHPPG04650101', priority: 'SCAN_DIAGNOSTIC', nowMs: t + 900 });

    expect(gate.level).toBe('CIRCUIT_OPEN');
    expect(gate.sameSecondCalls).toBe(9);
    expect(gate.retryWaveDetected).toBe(true);
    expect(gate.circuitState).toBe('OPEN');
  });

  it('Test 2: opens or hard-throttles when sameMinuteCalls reaches 60', () => {
    const t = Date.parse('2026-05-13T00:00:00Z');
    for (let i = 0; i < 60; i += 1) recordKisCallStarted('FHPPG04650101', t + i * 900);

    const gate = assessKisTrPressure({ trId: 'FHPPG04650101', priority: 'WATCHLIST', nowMs: t + 59_000 });

    expect(['HARD', 'CIRCUIT_OPEN']).toContain(gate.level);
    expect(gate.sameMinuteCalls).toBe(60);
    expect(gate.shouldDefer).toBe(true);
  });

  it('Test 3: retryWaveDetected blocks individual retry fan-out and opens circuit', () => {
    const t = Date.parse('2026-05-13T00:00:00Z');
    const retry = coordinateKisRetry({ trId: 'FHPPG04650101', retryAttempt: 1, backoffMs: 1_000, nowMs: t, retryWaveDetected: true });

    expect(retry.allowed).toBe(false);
    expect(retry.representativeRetry).toBe(false);
    expect(retry.reason).toBe('RETRY_WAVE_DETECTED');
    expect(getKisTrCircuitState('FHPPG04650101', t)).toBe('OPEN');
  });

  it('Test 4: SCAN_DIAGNOSTIC is deferred when TR circuit is open', () => {
    const t = Date.parse('2026-05-13T00:00:00Z');
    extendKisTrCircuit('FHPPG04650101', 'CALL_PRESSURE_OR_RETRY_WAVE', t);

    const gate = assessKisTrPressure({ trId: 'FHPPG04650101', priority: 'SCAN_DIAGNOSTIC', nowMs: t + 100 });

    expect(gate.circuitState).toBe('OPEN');
    expect(gate.shouldDefer).toBe(true);
  });

  it('Test 5: REAL_POSITION/SHADOW_OPEN are not low-priority-deferred by soft throttle', () => {
    const t = Date.parse('2026-05-13T00:00:00Z');
    for (let i = 0; i < 4; i += 1) recordKisCallStarted('FHPPG04650101', t + i * 100);

    const real = assessKisTrPressure({ trId: 'FHPPG04650101', priority: 'REAL_POSITION', nowMs: t + 500 });
    const shadow = assessKisTrPressure({ trId: 'FHPPG04650101', priority: 'SHADOW_OPEN', nowMs: t + 500 });

    expect(real.level).toBe('SOFT');
    expect(real.shouldDefer).toBe(false);
    expect(shadow.shouldDefer).toBe(false);
  });

  it('Test 6: repeated identical in-flight request pressure is observable for single-flight joining', () => {
    const t = Date.parse('2026-05-13T00:00:00Z');
    recordKisCallStarted('FHPPG04650101', t, { endpoint: '/quote', symbol: '005930', priority: 'SCAN_DIAGNOSTIC' });
    recordKisCallStarted('FHPPG04650101', t + 5, { endpoint: '/quote', symbol: '005930', priority: 'SCAN_DIAGNOSTIC' });

    const pressure = getKisCallPressureSnapshot(t + 10, 'FHPPG04650101');

    expect(pressure.sameSecondCalls).toBe(2);
    expect(pressure.byTrId.FHPPG04650101).toBe(2);
  });

  it('Test 7: KIS 500 remains providerIssue=true, marketSignal=false, executionImpact=NONE', () => {
    const classified = classifyKisError({ httpStatus: 500, trId: 'FHPPG04650101' });

    expect(classified.errorClass).toBe('SERVER_ERROR');
    expect(classified.providerIssue).toBe(true);
    expect(classified.marketSignal).toBe(false);
    expect(classified.executionImpact).toBe('NONE');
  });

  it('Test 8: KIS 500 circuit has no engine/shadow stop flag in taxonomy surface', () => {
    const classified = classifyKisError({ httpStatus: 500, trId: 'FHPPG04650101' });

    expect(classified.executionImpact).toBe('NONE');
    expect(JSON.stringify(classified)).not.toContain('SELL_ONLY');
    expect(JSON.stringify(classified)).not.toContain('shadowLearning=false');
  });

  it('Test 9: TR circuit open selects cache/fallback for server errors', () => {
    const fallback = selectKisFallback({ trId: 'FHPPG04650101', errorClass: 'SERVER_ERROR' });

    expect(['CACHE', 'KRX']).toContain(fallback.fallbackProvider);
    expect(fallback.executionImpact).toBe('NONE');
  });

  it('Test 10: after cooldown, HALF_OPEN allows only one representative test', () => {
    const t = Date.parse('2026-05-13T00:00:00Z');
    extendKisTrCircuit('FHPPG04650101', 'CALL_PRESSURE_OR_RETRY_WAVE', t);

    expect(isKisServerCircuitOpen('FHPPG04650101', t + KIS_ERROR_TAXONOMY_CONSTANTS.SERVER_CIRCUIT_COOLDOWN_MS + 1)).toBe(false);
    expect(getKisTrCircuitState('FHPPG04650101', t + KIS_ERROR_TAXONOMY_CONSTANTS.SERVER_CIRCUIT_COOLDOWN_MS + 1)).toBe('HALF_OPEN');
    expect(claimKisHalfOpenTest('FHPPG04650101', t + KIS_ERROR_TAXONOMY_CONSTANTS.SERVER_CIRCUIT_COOLDOWN_MS + 2)).toBe(true);
    expect(claimKisHalfOpenTest('FHPPG04650101', t + KIS_ERROR_TAXONOMY_CONSTANTS.SERVER_CIRCUIT_COOLDOWN_MS + 3)).toBe(false);
  });

  it('Test 11: HALF_OPEN success transitions to CLOSED_RECOVERED', () => {
    const t = Date.parse('2026-05-13T00:00:00Z');
    extendKisTrCircuit('FHPPG04650101', 'CALL_PRESSURE_OR_RETRY_WAVE', t);
    claimKisHalfOpenTest('FHPPG04650101', t + KIS_ERROR_TAXONOMY_CONSTANTS.SERVER_CIRCUIT_COOLDOWN_MS + 1);

    recordKisServerSuccess('FHPPG04650101');

    expect(getKisTrCircuitState('FHPPG04650101')).toBe('CLOSED_RECOVERED');
  });

  it('Test 12: HALF_OPEN failure extends circuit OPEN', () => {
    const t = Date.parse('2026-05-13T00:00:00Z');
    extendKisTrCircuit('FHPPG04650101', 'CALL_PRESSURE_OR_RETRY_WAVE', t);
    claimKisHalfOpenTest('FHPPG04650101', t + KIS_ERROR_TAXONOMY_CONSTANTS.SERVER_CIRCUIT_COOLDOWN_MS + 1);

    const reopened = recordKisServerErrorForCircuit('FHPPG04650101', t + KIS_ERROR_TAXONOMY_CONSTANTS.SERVER_CIRCUIT_COOLDOWN_MS + 2);

    expect(getKisTrCircuitState('FHPPG04650101', t + KIS_ERROR_TAXONOMY_CONSTANTS.SERVER_CIRCUIT_COOLDOWN_MS + 2)).toBe('OPEN');
    expect(reopened.cooldownSec).toBe(60);
  });
});
