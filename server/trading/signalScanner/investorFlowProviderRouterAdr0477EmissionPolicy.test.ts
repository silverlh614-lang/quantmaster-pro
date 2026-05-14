// @responsibility ADR-0477 investor-flow router emission policy and no-action observation dedup tests.
import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  emitInvestorFlowRouterEventAdr0477,
  resetInvestorFlowRouterEmissionPolicyForTest,
} from './scanDiagnostics.js';

function testLogger() {
  return {
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
  };
}

describe('ADR-0477 InvestorFlowProviderRouter emission policy', () => {
  beforeEach(() => {
    resetInvestorFlowRouterEmissionPolicyForTest();
  });

  it('SHADOW_ONLY + OBSERVING + UNKNOWN + CACHE + executionImpact NONE is not emitted as ADR-0477', () => {
    const logger = testLogger();
    const result = emitInvestorFlowRouterEventAdr0477({
      engineMode: 'SHADOW_ONLY',
      status: 'OBSERVING',
      signal: 'UNKNOWN',
      selectedProvider: 'CACHE',
      executionImpact: 'BLOCKED_BY_TEST_SHOULD_BE_FORCED_NONE',
      liveExecutionAllowed: false,
    }, { logger, nowMs: 1_000 });

    expect(result.adr0477).toBe(false);
    expect(result.observation).toBe(true);
    expect(result.executionImpact).toBe('NONE');
    expect(result.shadowLearning).toBe(true);
    expect(logger.warn).not.toHaveBeenCalled();
    expect(logger.info).not.toHaveBeenCalledWith(expect.stringContaining('[ADR-0477]'));
    expect(logger.debug).toHaveBeenCalledWith(expect.stringContaining('[InvestorFlowRouterObservation]'));
    expect(logger.debug).toHaveBeenCalledWith(expect.stringContaining('marketSignal=false providerIssue=false action=NO_ACTION_NORMAL'));
  });

  it('SELL_ONLY + OBSERVING + UNKNOWN + CACHE + executionImpact NONE is not emitted as ADR-0477', () => {
    const logger = testLogger();
    const result = emitInvestorFlowRouterEventAdr0477({
      engineMode: 'SELL_ONLY',
      status: 'OBSERVING',
      signal: 'UNKNOWN',
      selectedProvider: 'CACHE',
      executionImpact: 'NONE',
      liveExecutionAllowed: false,
    }, { logger, nowMs: 1_000 });

    expect(result.adr0477).toBe(false);
    expect(result.reasonCodes).toEqual([]);
    expect(logger.warn).not.toHaveBeenCalled();
    expect(logger.debug).toHaveBeenCalledWith(expect.stringContaining('[InvestorFlowRouterObservation]'));
  });

  it('NORMAL + VERIFIED + BULLISH + KIS_API emits a signal ADR-0477 info log', () => {
    const logger = testLogger();
    const result = emitInvestorFlowRouterEventAdr0477({
      engineMode: 'NORMAL',
      status: 'VERIFIED',
      signal: 'BULLISH',
      selectedProvider: 'KIS_API',
      executionImpact: 'NONE',
      liveExecutionAllowed: false,
      confidence: 'VERIFIED',
    }, { logger, nowMs: 1_000 });

    expect(result.adr0477).toBe(true);
    expect(result.marketSignal).toBe(true);
    expect(result.providerIssue).toBe(false);
    expect(result.reasonCodes).toContain('ADR_0477_SIGNAL_CHANGED');
    expect(logger.info).toHaveBeenCalledWith(expect.stringContaining('reasonCode=ADR_0477_SIGNAL_CHANGED'));
    expect(logger.warn).not.toHaveBeenCalled();
  });

  it('NORMAL + providerIssue true + executionImpact NONE emits provider health ADR-0477 with marketSignal false', () => {
    const logger = testLogger();
    const result = emitInvestorFlowRouterEventAdr0477({
      engineMode: 'NORMAL',
      status: 'DEGRADED',
      signal: 'UNKNOWN',
      selectedProvider: 'KIS_API',
      executionImpact: 'NONE',
      liveExecutionAllowed: false,
      providerIssue: true,
      marketSignal: false,
    }, { logger, nowMs: 1_000 });

    expect(result.adr0477).toBe(true);
    expect(result.providerIssue).toBe(true);
    expect(result.marketSignal).toBe(false);
    expect(result.reasonCodes).toContain('ADR_0477_PROVIDER_DEGRADED');
    expect(logger.warn).toHaveBeenCalledWith(expect.stringContaining('marketSignal=false providerIssue=true'));
  });

  it('liveExecutionAllowed true + signal UNKNOWN + provider missing emits ADR-0477 inconsistency', () => {
    const logger = testLogger();
    const result = emitInvestorFlowRouterEventAdr0477({
      engineMode: 'NORMAL',
      status: 'MISSING',
      signal: 'UNKNOWN',
      selectedProvider: 'NONE',
      executionImpact: 'NONE',
      liveExecutionAllowed: true,
      providerIssue: true,
    }, { logger, nowMs: 1_000 });

    expect(result.adr0477).toBe(true);
    expect(result.reasonCodes).toContain('ADR_0477_LIVE_EXECUTION_INCONSISTENCY');
    expect(logger.warn).toHaveBeenCalledWith(expect.stringContaining('ADR_0477_LIVE_EXECUTION_INCONSISTENCY'));
  });

  it('deduplicates 10 identical no-action observations to one detail and one suppressed summary', () => {
    const logger = testLogger();
    const state = {
      engineMode: 'SHADOW_ONLY' as const,
      status: 'OBSERVING',
      signal: 'UNKNOWN',
      selectedProvider: 'CACHE',
      executionImpact: 'NONE' as const,
      liveExecutionAllowed: false,
    };

    emitInvestorFlowRouterEventAdr0477(state, { logger, nowMs: 1_000 });
    for (let i = 0; i < 8; i += 1) {
      emitInvestorFlowRouterEventAdr0477(state, { logger, nowMs: 2_000 + i });
    }
    const summaryResult = emitInvestorFlowRouterEventAdr0477(state, { logger, nowMs: 3_000, summaryTtlMs: 0 });

    expect(summaryResult.summaryEmitted).toBe(true);
    expect(logger.debug).toHaveBeenCalledTimes(1);
    expect(logger.info).toHaveBeenCalledTimes(1);
    expect(logger.info).toHaveBeenCalledWith(expect.stringContaining('[InvestorFlowRouterObservationSummary] suppressedCount=9'));
    expect(logger.info).toHaveBeenCalledWith(expect.stringContaining('lastState=SHADOW_ONLY/OBSERVING/UNKNOWN/CACHE'));
    expect(logger.warn).not.toHaveBeenCalled();
  });
});
