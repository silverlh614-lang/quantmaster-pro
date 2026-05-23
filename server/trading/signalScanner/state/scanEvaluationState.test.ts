// @responsibility P1-2 scan evaluation state machine regression tests.

import { describe, expect, it } from 'vitest';
import { createScanCounters } from '../scanDiagnostics.js';
import { recordPipelineStage } from '../scanDiagnostics/pipelineStageDiagnostics.js';
import { buildScanEvaluationResult, formatScanEvaluationCompactLine, formatScanEvaluationSection } from './scanEvaluationState.js';

describe('scanEvaluationState', () => {
  it('does not let legacy SELL_ONLY skip Gate evaluation', () => {
    const counters = createScanCounters();
    counters.gateMisses = 12;
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

    expect(result.evaluationState).not.toBe('NOT_EVALUATED_SELL_ONLY');
    expect(result.executionImpact).not.toBe('NEW_BUY_BLOCKED_ONLY');
    expect(result.shadowLearningAllowed).toBe(true);
    expect(result.skipped).toBe(0);
  });

  it('does not let legacy R6 live block state skip Gate evaluation', () => {
    const counters = createScanCounters();
    const result = buildScanEvaluationResult({
      counters,
      totalCandidates: 5,
      macroGateState: {
        emergencyStop: false,
        autoTradeEnabled: true,
        regime: 'R2_BULL',
        macroRegimeEffective: 'R2_BULL',
        riskOverride: 'NONE',
        engineMode: 'NORMAL',
        diagnosticLiveEntryBlocked: false,
        kellyMultiplierFromRegime: 1,
        fomcPhase: 'NONE',
        fomcKellyMultiplier: 1,
        finalKellyMultiplier: 1,
        vixGatingActive: false,
        bearDefenseMode: false,
        mhsBelow30: false,
        watchlistEmpty: false,
        sellOnlyMode: false,
        shadowLearningAllowed: true,
      },
      sourcePath: 'test',
    });

    expect(result.evaluationState).not.toBe('NOT_EVALUATED_R6_LIVE_BLOCKED');
    expect(result.blockReason).not.toBe('R6_DEFENSE');
    expect(result.executionImpact).not.toBe('NEW_BUY_BLOCKED_ONLY');
    expect(result.shadowLearningAllowed).toBe(true);
  });

  it('prints stale legacy R6 as deprecated instead of decision effectiveRegime', () => {
    const counters = createScanCounters();
    const result = buildScanEvaluationResult({
      counters,
      totalCandidates: 43,
      effectiveRegime: 'R6_DEFENSE',
      macroGateState: {
        emergencyStop: false,
        autoTradeEnabled: true,
        regime: 'R3_EARLY',
        macroRegimeEffective: 'R6_DEFENSE',
        displayRegime: 'SHADOW_ONLY',
        riskOverride: 'SHADOW_ONLY',
        engineMode: 'SHADOW_ONLY',
        diagnosticLiveEntryBlocked: false,
        kellyMultiplierFromRegime: 1,
        fomcPhase: 'NONE',
        fomcKellyMultiplier: 1,
        finalKellyMultiplier: 1,
        vixGatingActive: false,
        bearDefenseMode: false,
        mhsBelow30: false,
        watchlistEmpty: false,
        sellOnlyMode: false,
        shadowLearningAllowed: true,
      },
      sourcePath: 'test',
    });

    expect(result.effectiveRegime).toBe('R3_EARLY');
    const section = formatScanEvaluationSection(result) ?? '';
    expect(section).toContain('effectiveRegime=R3_EARLY');
    expect(section).toContain('displayRegime=SHADOW_ONLY');
    expect(section).toContain('riskOverride=SHADOW_ONLY');
    expect(section).toContain('legacyEffectiveRegime=R6_DEFENSE deprecated=true notUsedForDecision=true');
    expect(section).not.toContain('\n  effectiveRegime=R6_DEFENSE');
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
    expect(line).toContain('diagnosticGateSurvivors=');
    expect(line).toContain('liveGateSurvivors=');
    expect(line).not.toContain('diagnosticSurvivors=');
  });

  it('renders Gate Evaluation Counts without ambiguous diagnosticSurvivors label', () => {
    const counters = createScanCounters();
    counters.gateMisses = 2;
    counters.waitGateFail = 2;
    const result = buildScanEvaluationResult({
      counters,
      totalCandidates: 2,
      sourcePath: 'test.source',
    });

    const section = formatScanEvaluationSection(result) ?? '';
    expect(section).toContain('Gate Evaluation Counts:');
    expect(section).toContain('diagnosticGateSurvivors=');
    expect(section).toContain('liveGateSurvivors=');
    expect(section).not.toContain('diagnosticSurvivors=');
  });
});
