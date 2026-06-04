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

// ADR-0567(patch): holiday-aware wall-clock stale 교정 — default OFF byte-equal.
// 평일 장중(11:00) 인데 상류 macro 가 stale CLOSED/POST_CLOSE 를 주는 케이스에서,
// flag OFF=현행유지(CLOSED 고착), flag ON=REGULAR_OPEN 교정. 공휴일/주말/장외는 교정 안 함.
describe('scanEvaluationState — ADR-0567 holiday-aware wall-clock stale correction', () => {
  const FLAG = 'SCAN_SESSION_WALLCLOCK_CORRECTION_ENABLED';
  const withFlag = <T>(value: string | undefined, fn: () => T): T => {
    const prev = process.env[FLAG];
    if (value === undefined) delete process.env[FLAG];
    else process.env[FLAG] = value;
    try {
      return fn();
    } finally {
      if (prev === undefined) delete process.env[FLAG];
      else process.env[FLAG] = prev;
    }
  };

  // 2026-06-04 (Thu) 11:00 KST — 평일 장중, KRX 거래일. macro 가 stale CLOSED.
  const weekdayIntradayStaleClosed = {
    explicitMarketSessionState: 'BUY_ALLOWED',
    macroGateState: { displaySession: 'CLOSED', canonicalSession: 'CLOSED' } as never,
    asOf: '2026-06-04T11:00:00.000Z',
  };

  it('flag OFF: weekday intraday stale CLOSED stays CLOSED (byte-equal to legacy)', () => {
    const session = withFlag(undefined, () => resolveScanMarketSessionView(weekdayIntradayStaleClosed));
    expect(session.canonicalSession).toBe('CLOSED');
    expect(session.marketSessionState).toBe('CLOSED');
    expect(session.displaySession).toBe('CLOSED_SHADOW_OBSERVE');
  });

  it('flag OFF (=false): explicit false also keeps legacy CLOSED', () => {
    const session = withFlag('false', () => resolveScanMarketSessionView(weekdayIntradayStaleClosed));
    expect(session.canonicalSession).toBe('CLOSED');
  });

  it('flag ON: weekday intraday stale CLOSED corrected to REGULAR_OPEN', () => {
    const session = withFlag('true', () => resolveScanMarketSessionView(weekdayIntradayStaleClosed));
    expect(session.canonicalSession).toBe('REGULAR_OPEN');
    expect(session.marketSessionState).toBe('BUY_ALLOWED');
    expect(session.displaySession).toBe('REGULAR_OPEN');
  });

  it('flag ON: weekday intraday stale POST_CLOSE corrected to REGULAR_OPEN', () => {
    const session = withFlag('true', () =>
      resolveScanMarketSessionView({
        explicitMarketSessionState: 'BUY_ALLOWED',
        macroGateState: { displaySession: 'POST_CLOSE', canonicalSession: 'POST_CLOSE' } as never,
        asOf: '2026-06-04T11:00:00.000Z',
      }),
    );
    expect(session.canonicalSession).toBe('REGULAR_OPEN');
  });

  it('flag ON: KRX holiday (2026-06-03 election) intraday stale CLOSED stays CLOSED (trading-day SSOT blocks)', () => {
    const session = withFlag('true', () =>
      resolveScanMarketSessionView({
        explicitMarketSessionState: 'BUY_ALLOWED',
        macroGateState: { displaySession: 'CLOSED', canonicalSession: 'CLOSED' } as never,
        asOf: '2026-06-03T11:00:00.000Z',
      }),
    );
    expect(session.canonicalSession).toBe('CLOSED');
    expect(session.displaySession).toBe('CLOSED_SHADOW_OBSERVE');
  });

  it('flag ON: weekend (2026-06-06 Sat) resolves HOLIDAY regardless', () => {
    const session = withFlag('true', () =>
      resolveScanMarketSessionView({
        explicitMarketSessionState: 'BUY_ALLOWED',
        macroGateState: { displaySession: 'CLOSED', canonicalSession: 'CLOSED' } as never,
        asOf: '2026-06-06T11:00:00.000Z',
      }),
    );
    expect(session.canonicalSession).toBe('HOLIDAY');
    expect(session.displaySession).toBe('HOLIDAY_SHADOW_OBSERVE');
  });

  it('flag ON: real after-market (wallClock POST_CLOSE) keeps stale CLOSED, no correction', () => {
    // 2026-06-04 16:30 KST → wallClock POST_CLOSE. macro stale CLOSED must NOT be corrected.
    const session = withFlag('true', () =>
      resolveScanMarketSessionView({
        explicitMarketSessionState: 'BUY_ALLOWED',
        macroGateState: { displaySession: 'CLOSED', canonicalSession: 'CLOSED' } as never,
        asOf: '2026-06-04T16:30:00.000Z',
      }),
    );
    expect(session.canonicalSession).toBe('CLOSED');
  });

  it('flag ON: real pre-market (wallClock CLOSED) keeps stale POST_CLOSE, no correction', () => {
    // 2026-06-04 08:30 KST → wallClock CLOSED. macro stale POST_CLOSE must NOT be corrected.
    const session = withFlag('true', () =>
      resolveScanMarketSessionView({
        explicitMarketSessionState: 'BUY_ALLOWED',
        macroGateState: { displaySession: 'POST_CLOSE', canonicalSession: 'POST_CLOSE' } as never,
        asOf: '2026-06-04T08:30:00.000Z',
      }),
    );
    expect(session.canonicalSession).toBe('POST_CLOSE');
  });

  it('flag ON: genuine REGULAR_OPEN macro session unchanged (no spurious correction path)', () => {
    const session = withFlag('true', () =>
      resolveScanMarketSessionView({
        explicitMarketSessionState: 'BUY_ALLOWED',
        macroGateState: { displaySession: 'REGULAR_OPEN', canonicalSession: 'REGULAR_OPEN' } as never,
        timeLabel: '11:00',
        asOf: '2026-06-04T11:00:00.000Z',
      }),
    );
    expect(session.canonicalSession).toBe('REGULAR_OPEN');
    expect(session.marketSessionState).toBe('BUY_ALLOWED');
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
