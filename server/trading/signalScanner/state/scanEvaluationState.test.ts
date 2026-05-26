// @responsibility P1-2 scan evaluation state machine regression tests.

import { describe, expect, it } from 'vitest';
import { createScanCounters } from '../scanDiagnostics.js';
import { recordPipelineStage } from '../scanDiagnostics/pipelineStageDiagnostics.js';
import { buildScanEvaluationId, buildScanEvaluationResult, formatScanEvaluationCompactLine, formatScanEvaluationSection, resolveScanMarketSessionView } from './scanEvaluationState.js';

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

  it('rebases stale BUY_ALLOWED at 22:55 KST to CLOSED shadow observe display', () => {
    const session = resolveScanMarketSessionView({
      explicitMarketSessionState: 'BUY_ALLOWED',
      asOf: '2026-05-25T22:55:00.000Z',
    });

    expect(session.marketSessionState).toBe('CLOSED');
    expect(session.canonicalSession).toBe('CLOSED');
    expect(session.displaySession).toBe('CLOSED_SHADOW_OBSERVE');
  });
});

// ADR-0528 a1/a2 완결: scan-cycle 단일 canonical id 통일 가드.
// a1/a2 POSITION_POLICY 로그에 주입되는 context.sourceSnapshotId(= buildScanEvaluationId(scanAsOf))
// 와 소비자 fallback(scanEvaluation.scanId = buildScanEvaluationResult({asOf:scanAsOf}).scanId)
// 가 byte-identical 임을 단언 — 통일의 핵심(불일치 시 operator cross-grep 깨짐).
describe('scanEvaluationState — ADR-0528 canonical scan id unification', () => {
  it('builds identical id from buildScanEvaluationId and buildScanEvaluationResult for the same scanAsOf', () => {
    const scanAsOf = '2026-05-25T09:01:23.456Z';
    const counters = createScanCounters();

    const ctxInjectedId = buildScanEvaluationId(scanAsOf);
    const consumerFallbackId = buildScanEvaluationResult({
      asOf: scanAsOf,
      counters,
      totalCandidates: 0,
      sourcePath: 'test',
    }).scanId;

    expect(ctxInjectedId).toBe(consumerFallbackId);
    expect(ctxInjectedId).toBe('scan-eval-20260525090123');
    expect(ctxInjectedId).not.toBe('NA');
  });

  it('is deterministic — same scanAsOf yields the same canonical id', () => {
    const scanAsOf = '2026-05-25T14:30:00.000Z';
    expect(buildScanEvaluationId(scanAsOf)).toBe(buildScanEvaluationId(scanAsOf));
    const counters = createScanCounters();
    const first = buildScanEvaluationResult({ asOf: scanAsOf, counters, totalCandidates: 3, sourcePath: 'test' }).scanId;
    const second = buildScanEvaluationResult({ asOf: scanAsOf, counters, totalCandidates: 3, sourcePath: 'test' }).scanId;
    expect(first).toBe(second);
    expect(first).toBe(buildScanEvaluationId(scanAsOf));
  });

  it('produces a single canonical id across the carry channel and persist derivation (same scanAsOf both sides)', () => {
    // index.ts: scanAsOf 1회 산출 → context.sourceSnapshotId 주입 + persistScanResults(scanAsOf) thread.
    const scanAsOf = '2026-05-25T01:05:07.000Z';
    const contextSourceSnapshotId = buildScanEvaluationId(scanAsOf); // (a) a1/a2 로그 경로

    // (b) persistScanResults 내부 scanEvaluation derivation (scanAsOf 전달 시 동일 asOf 사용)
    const persistScanEvaluationId = buildScanEvaluationResult({
      asOf: scanAsOf,
      counters: createScanCounters(),
      totalCandidates: 5,
      sourcePath: 'scanDiagnosticsCore.persistScanResults',
    }).scanId;

    expect(contextSourceSnapshotId).toBe(persistScanEvaluationId);
  });
});
