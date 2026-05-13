/**
 * @responsibility KIS operational log policy regression tests.
 *
 * These tests cover log de-noising only; provider selection, materialization, and circuit breaker
 * behavior remain owned by their existing modules.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { __testOnly, resetKisCircuits } from '../kisClient.js';
import { __queryTestOnly } from './query.js';

describe('KIS operational log policy', () => {
  let infoSpy: ReturnType<typeof vi.spyOn>;
  let debugSpy: ReturnType<typeof vi.spyOn>;
  let warnSpy: ReturnType<typeof vi.spyOn>;
  let errorSpy: ReturnType<typeof vi.spyOn>;

  // LOG_LEVEL=debug 강제 — logger.debug 가 console.debug 로 전달되도록 정합 (server/utils/logger.ts default 'info' filter 우회).
  const origLogLevel = process.env.LOG_LEVEL;

  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-05-12T03:00:00.000Z'));
    process.env.LOG_LEVEL = 'debug';
    resetKisCircuits();
    __queryTestOnly.resetInvestorFlowSelectedLogState();
    infoSpy = vi.spyOn(console, 'info').mockImplementation(() => undefined);
    debugSpy = vi.spyOn(console, 'debug').mockImplementation(() => undefined);
    warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    errorSpy = vi.spyOn(console, 'error').mockImplementation(() => undefined);
  });

  afterEach(() => {
    resetKisCircuits();
    __queryTestOnly.resetInvestorFlowSelectedLogState();
    if (origLogLevel === undefined) delete process.env.LOG_LEVEL;
    else process.env.LOG_LEVEL = origLogLevel;
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it('emits info only once for repeated identical investorFlow selections', () => {
    for (let i = 0; i < 10; i += 1) {
      __queryTestOnly.logInvestorFlowSelected(30);
    }

    expect(infoSpy).toHaveBeenCalledTimes(1);
    expect(infoSpy.mock.calls[0]?.[0]).toContain('executionImpact=NONE');
    expect(infoSpy.mock.calls[0]?.[0]).toContain('providerIssue=false');
    expect(infoSpy.mock.calls[0]?.[0]).toContain('marketSignal=false');
    expect(infoSpy.mock.calls[0]?.[0]).toContain('logClass=TELEMETRY');
    expect(warnSpy).not.toHaveBeenCalled();
    expect(errorSpy).not.toHaveBeenCalled();
  });

  it('re-emits info when investorFlow confidence changes', () => {
    __queryTestOnly.logInvestorFlowSelected(30, 'VERIFIED');
    __queryTestOnly.logInvestorFlowSelected(30, 'VERIFIED');
    __queryTestOnly.logInvestorFlowSelected(30, 'DEGRADED');

    expect(infoSpy).toHaveBeenCalledTimes(2);
    expect(infoSpy.mock.calls[1]?.[0]).toContain('confidence=DEGRADED');
  });

  it('aggregates repeated investorFlow selections into a five-minute debug summary', () => {
    __queryTestOnly.logInvestorFlowSelected(30);
    for (let i = 0; i < 18; i += 1) {
      __queryTestOnly.logInvestorFlowSelected(30);
    }
    expect(debugSpy).not.toHaveBeenCalled();

    vi.advanceTimersByTime(5 * 60 * 1000);
    __queryTestOnly.logInvestorFlowSelected(30);

    expect(infoSpy).toHaveBeenCalledTimes(1);
    expect(debugSpy).toHaveBeenCalledTimes(1);
    expect(debugSpy.mock.calls[0]?.[0]).toContain('investorFlow selected unchanged');
    expect(debugSpy.mock.calls[0]?.[0]).toContain('repeated=19');
  });

  it('logs minor circuit recovery as debug telemetry without warn or error', () => {
    __testOnly.recordFailure('FHKST03010100', 500);
    __testOnly.recordSuccess('FHKST03010100');

    expect(debugSpy).toHaveBeenCalledTimes(1);
    expect(debugSpy.mock.calls[0]?.[0]).toBe('[KIS] circuit recovery minor');
    expect(debugSpy.mock.calls[0]?.[1]).toMatchObject({
      type: 'CIRCUIT_RECOVERY',
      trId: 'FHKST03010100',
      previousHard: 1,
      previousSoft: 0,
      logClass: 'TELEMETRY',
    });
    expect(infoSpy).not.toHaveBeenCalled();
    expect(warnSpy).not.toHaveBeenCalled();
    expect(errorSpy).not.toHaveBeenCalled();
  });

  it('rate-limits repeated recovery logs per endpoint for five minutes', () => {
    __testOnly.recordFailure('FHKST03010100', 500);
    __testOnly.recordSuccess('FHKST03010100');
    __testOnly.recordFailure('FHKST03010100', 500);
    __testOnly.recordSuccess('FHKST03010100');

    expect(debugSpy).toHaveBeenCalledTimes(1);

    vi.advanceTimersByTime(5 * 60 * 1000);
    __testOnly.recordFailure('FHKST03010100', 500);
    __testOnly.recordSuccess('FHKST03010100');

    expect(debugSpy).toHaveBeenCalledTimes(2);
  });
});
