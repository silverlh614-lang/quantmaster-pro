// @responsibility P1-2 scan evaluation state machine regression tests.

import { describe, expect, it } from 'vitest';
import { createScanCounters } from '../scanDiagnostics.js';
import { recordPipelineStage } from '../scanDiagnostics/pipelineStageDiagnostics.js';
import { buildScanEvaluationResult, formatScanEvaluationCompactLine } from './scanEvaluationState.js';

describe('scanEvaluationState', () => {
  it('classifies SELL_ONLY as not evaluated instead of zero survivor', () => {
    const counters = createScanCounters();
    const result = buildScanEvaluationResult({
      asOf: '2026-05-19T01:00:00.000Z',
      counters,
      totalCandidates: 12,
      sellOnly: true,
      macroGateState: {
        emergencyStop: false,
        autoTradeEnabled: true,
        regime: 'R3_EARLY',
        kellyMultiplierFromRegime: 1,
        fomcPhase: 'NONE',
        fomcKellyMultiplier: 1,
        finalKellyMultiplier: 1,
        vixGatingActive: false,
        bearDefenseMode: false,
        mhsBelow30: false,
        watchlistEmpty: false,
        sellOnlyMode: true,
        shadowLearningAllowed: true,
      },
      sourcePath: 'test',
    });

    expect(result.evaluationState).toBe('NOT_EVALUATED_SELL_ONLY');
    expect(result.executionImpact).toBe('NEW_BUY_BLOCKED_ONLY');
    expect(result.shadowLearningAllowed).toBe(true);
    expect(result.skipped).toBe(12);
  });

  it('classifies R6 live block as shadow-allowed not evaluated state', () => {
    const counters = createScanCounters();
    const result = buildScanEvaluationResult({
      counters,
      totalCandidates: 5,
      macroGateState: {
        emergencyStop: false,
        autoTradeEnabled: true,
        regime: 'R6_DEFENSE',
        macroRegimeEffective: 'R6_DEFENSE',
        riskOverride: 'R6_DEFENSE',
        engineMode: 'DEGRADED',
        diagnosticLiveEntryBlocked: true,
        liveEntryBlockedReason: 'R6_DEFENSE',
        kellyMultiplierFromRegime: 1,
        fomcPhase: 'NONE',
        fomcKellyMultiplier: 1,
        finalKellyMultiplier: 1,
        vixGatingActive: false,
        bearDefenseMode: true,
        mhsBelow30: true,
        watchlistEmpty: false,
        sellOnlyMode: false,
        shadowLearningAllowed: true,
      },
      sourcePath: 'test',
    });

    expect(result.evaluationState).toBe('NOT_EVALUATED_R6_LIVE_BLOCKED');
    expect(result.blockReason).toBe('R6_DEFENSE');
    expect(result.executionImpact).toBe('NEW_BUY_BLOCKED_ONLY');
    expect(result.shadowLearningAllowed).toBe(true);
  });

  it('separates quote hydration failure from gate reject', () => {
    const counters = createScanCounters();
    counters.yahooFails = 3;
    recordPipelineStage(counters, 'PRICE_FETCH', 'FAIL');
    recordPipelineStage(counters, 'PRICE_FETCH', 'FAIL');
    recordPipelineStage(counters, 'PRICE_FETCH', 'FAIL');

    const result = buildScanEvaluationResult({
      counters,
      totalCandidates: 3,
      sourcePath: 'test',
    });

    expect(result.evaluationState).toBe('EVALUATED_QUOTE_HYDRATION_FAILED');
    expect(result.breakPoint).toBe('PRICE_FETCH');
    expect(result.executionImpact).toBe('SCAN_GATE_DEGRADED');
  });

  it('formats compact state line with sourcePath and breakPoint', () => {
    const counters = createScanCounters();
    counters.gateMisses = 2;
    counters.waitGateFail = 2;
    const result = buildScanEvaluationResult({
      counters,
      totalCandidates: 2,
      sourcePath: 'test.source',
    });

    const line = formatScanEvaluationCompactLine(result);
    expect(line).toContain('evaluationState=EVALUATED_GATE_REJECTED');
    expect(line).toContain('sourcePath=test.source');
    expect(line).toContain('breakPoint=GATE_EVALUATION');
  });
});
