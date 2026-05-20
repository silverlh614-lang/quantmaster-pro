// @responsibility ADR-0367 preflightBlockedScanSummary 회귀 테스트 — preflight blocked scan summary SSOT.

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import {
  __resetPreflightBlockedScanSummaryForTests,
  attachPreflightBlockedPerSymbolSupplyInjection,
  clearPreflightBlockedScanSummary,
  formatPreflightBlockedScanSection,
  getLastPreflightBlockedScanSummary,
  recordPreflightBlockedScanSummary,
} from './preflightBlockedScanSummary.js';
import { formatScanBlockersMessage } from './scanDiagnostics.js';

const moduleDir = dirname(fileURLToPath(import.meta.url));

describe('preflightBlockedScanSummary (ADR-0367)', () => {
  afterEach(() => {
    __resetPreflightBlockedScanSummaryForTests();
  });

  // 테스트 1: candidateSummaryCount=48, buyListLoopEntered=false 인 경우 preflightBlockedScanSummary 가 저장되는가
  it('records a preflight blocked scan summary with candidateSummaryCount=48 and buyListLoopEntered=false', () => {
    const recorded = recordPreflightBlockedScanSummary({
      blockedBy: 'HARD_BLOCK',
      hardBlockSource: 'R3_SANITY_LATCH',
      hardBlockModule: 'r3SanityBlockRepo',
      hardBlockReason: 'GATE1_PASS_ZERO (R3_EARLY)',
      preflightDecision: 'ABORT_HARD_BLOCK',
      candidateSummaryCount: 48,
      universeSnapshotRecorded: true,
      counterfactualRecorded: true,
    });

    expect(recorded.candidateSummaryCount).toBe(48);
    expect(recorded.buyListLoopEntered).toBe(false);
    expect(recorded.gateSamples).toBe(0);
    expect(recorded.stage).toBe('BEFORE_BUYLIST_LOOP');

    const stored = getLastPreflightBlockedScanSummary();
    expect(stored).not.toBeNull();
    expect(stored?.candidateSummaryCount).toBe(48);
    expect(stored?.buyListLoopEntered).toBe(false);
    expect(stored?.scanId).toMatch(/^pbs-/);
  });

  // 테스트 2: /scan_blockers 가 "진단 데이터 없음" 대신 preflight blocked scan 을 표시하는가
  it('formatScanBlockersMessage shows preflight blocked scan instead of "진단 데이터 없음"', () => {
    // 차단 기록 전: summary=null → 진단 데이터 없음
    expect(formatScanBlockersMessage(null)).toContain('진단 데이터 없음');

    recordPreflightBlockedScanSummary({
      blockedBy: 'HARD_BLOCK',
      hardBlockSource: 'R3_VIOLATION_STREAK',
      hardBlockModule: 'r3ViolationStreakRepo',
      hardBlockReason: 'GATE1_PASS_ZERO streak=3/3',
      preflightDecision: 'ABORT_SHADOW_ONLY_EPHEMERAL',
      candidateSummaryCount: 48,
      universeSnapshotRecorded: true,
      counterfactualRecorded: true,
    });

    const msg = formatScanBlockersMessage(null);
    expect(msg).toContain('Preflight blocked scan detected');
    expect(msg).not.toContain('진단 데이터 없음');
    expect(msg).toContain('latestStage=BEFORE_BUYLIST_LOOP');
    expect(msg).toContain('blockedBy=HARD_BLOCK');
    expect(msg).toContain('candidateSummaryCount=48');
    expect(msg).toContain('universeSnapshotRecorded=true');
    expect(msg).toContain('counterfactualRecorded=true');
    expect(msg).toContain('buyListLoopEntered=false');
  });

  // 테스트 3: hardBlockSource / hardBlockModule / hardBlockReason 이 존재하는가
  it('shows per-symbol supply injection as skipped when preflight stops before buyList loop', () => {
    const recorded = recordPreflightBlockedScanSummary({
      blockedBy: 'PRE_FLIGHT_BLOCK',
      preflightDecision: 'ABORT_R6_DEFENSE',
      candidateSummaryCount: 41,
      universeSnapshotRecorded: false,
      counterfactualRecorded: true,
    });

    const section = formatPreflightBlockedScanSection(recorded);
    expect(section).toContain('Per-Symbol Supply Injection');
    expect(section).toContain('status: SKIPPED_PRE_FLIGHT_BLOCK');
    expect(section).toContain('reason: buyListLoopEntered=false / ABORT_R6_DEFENSE');
    expect(section).toContain('candidateSummaryCount: 41');
    expect(section).toContain('candidates: 0');
    expect(section).toContain('requested: 0');
    expect(section).toContain('injected: 0');
    expect(section).toContain('unknown: 0');
    expect(section).toContain('routerConnected: false');
    expect(section).toContain('gateContextConnected: false');
  });

  it('shows collected per-symbol supply diagnostics even when preflight blocks live entry', () => {
    recordPreflightBlockedScanSummary({
      blockedBy: 'PRE_FLIGHT_BLOCK',
      preflightDecision: 'ABORT_R6_DEFENSE',
      candidateSummaryCount: 41,
      universeSnapshotRecorded: false,
      counterfactualRecorded: true,
    });
    attachPreflightBlockedPerSymbolSupplyInjection({
      totalCandidates: 41,
      requestedSymbols: 41,
      receivedResults: 41,
      injected: 35,
      verified: 35,
      degraded: 3,
      stale: 1,
      missing: 2,
      unknown: 0,
      routerConnected: true,
      gateContextConnected: true,
    });

    const section = formatPreflightBlockedScanSection(getLastPreflightBlockedScanSummary()!);
    expect(section).toContain('status: DIAGNOSTIC_COLLECTED_PRE_FLIGHT_BLOCK');
    expect(section).toContain('candidates: 41');
    expect(section).toContain('requested: 41');
    expect(section).toContain('receivedResults: 41');
    expect(section).toContain('verified: 35');
    expect(section).toContain('degraded: 3');
    expect(section).toContain('stale: 1');
    expect(section).toContain('missing: 2');
    expect(section).toContain('unknown: 0');
    expect(section).toContain('routerConnected: true');
    expect(section).toContain('gateContextConnected: true');
  });

  it('preserves hardBlockSource / hardBlockModule / hardBlockReason / preflightDecision fields', () => {
    const recorded = recordPreflightBlockedScanSummary({
      blockedBy: 'HARD_BLOCK',
      hardBlockSource: 'R3_SANITY_LATCH',
      hardBlockModule: 'r3SanityBlockRepo',
      hardBlockReason: 'GATE1_PASS_ZERO (R3_EARLY)',
      preflightDecision: 'ABORT_HARD_BLOCK',
      candidateSummaryCount: 12,
      universeSnapshotRecorded: true,
      counterfactualRecorded: true,
    });

    expect(recorded.hardBlockSource).toBe('R3_SANITY_LATCH');
    expect(recorded.hardBlockModule).toBe('r3SanityBlockRepo');
    expect(recorded.hardBlockReason).toBe('GATE1_PASS_ZERO (R3_EARLY)');
    expect(recorded.preflightDecision).toBe('ABORT_HARD_BLOCK');

    const section = formatPreflightBlockedScanSection(recorded);
    expect(section).toContain('hardBlockSource=R3_SANITY_LATCH');
    expect(section).toContain('hardBlockModule=r3SanityBlockRepo');
    expect(section).toContain('hardBlockReason=GATE1_PASS_ZERO (R3_EARLY)');
    expect(section).toContain('preflightDecision=ABORT_HARD_BLOCK');
  });

  // 테스트 4: ADR-460 not installed / SectorEnergy STALE 가 hardBlockSource 로 승격되지 않는가
  it('drops forbidden hardBlockSource patterns (ADR-460 not installed, SectorEnergy STALE)', () => {
    const adr460 = recordPreflightBlockedScanSummary({
      blockedBy: 'HARD_BLOCK',
      hardBlockSource: 'ADR-460 not installed',
      candidateSummaryCount: 5,
      universeSnapshotRecorded: true,
      counterfactualRecorded: true,
    });
    expect(adr460.hardBlockSource).toBeUndefined();

    const adr460Underscore = recordPreflightBlockedScanSummary({
      blockedBy: 'HARD_BLOCK',
      hardBlockSource: 'ADR_460 diagnostic overlay missing',
      candidateSummaryCount: 5,
      universeSnapshotRecorded: true,
      counterfactualRecorded: true,
    });
    expect(adr460Underscore.hardBlockSource).toBeUndefined();

    const sectorEnergy = recordPreflightBlockedScanSummary({
      blockedBy: 'HARD_BLOCK',
      hardBlockSource: 'SectorEnergy STALE',
      candidateSummaryCount: 5,
      universeSnapshotRecorded: true,
      counterfactualRecorded: true,
    });
    expect(sectorEnergy.hardBlockSource).toBeUndefined();

    // 정상 source 는 유지된다.
    const ok = recordPreflightBlockedScanSummary({
      blockedBy: 'HARD_BLOCK',
      hardBlockSource: 'R3_SANITY_LATCH',
      candidateSummaryCount: 5,
      universeSnapshotRecorded: true,
      counterfactualRecorded: true,
    });
    expect(ok.hardBlockSource).toBe('R3_SANITY_LATCH');
  });

  // 테스트 5: executionImpact=NONE / liveExecutionAllowed=false literal 이 유지되는가
  it('always keeps executionImpact=NONE and liveExecutionAllowed=false literal invariants', () => {
    const recorded = recordPreflightBlockedScanSummary({
      blockedBy: 'SELL_ONLY',
      preflightDecision: 'ABORT_SELL_ONLY',
      candidateSummaryCount: 30,
      universeSnapshotRecorded: false,
      counterfactualRecorded: false,
    });
    expect(recorded.executionImpact).toBe('NONE');
    expect(recorded.liveExecutionAllowed).toBe(false);
    expect(formatPreflightBlockedScanSection(recorded)).toContain('executionImpact=NONE');
  });

  // 테스트 6: universeSnapshotRecorded / counterfactualRecorded 가 propagate 되는가 (shadow/counterfactual 기록 유지)
  it('propagates universeSnapshotRecorded / counterfactualRecorded flags', () => {
    const both = recordPreflightBlockedScanSummary({
      blockedBy: 'HARD_BLOCK',
      candidateSummaryCount: 48,
      universeSnapshotRecorded: true,
      counterfactualRecorded: true,
    });
    expect(both.universeSnapshotRecorded).toBe(true);
    expect(both.counterfactualRecorded).toBe(true);

    const neither = recordPreflightBlockedScanSummary({
      blockedBy: 'HARD_BLOCK',
      candidateSummaryCount: 0,
      universeSnapshotRecorded: false,
      counterfactualRecorded: false,
    });
    expect(neither.universeSnapshotRecorded).toBe(false);
    expect(neither.counterfactualRecorded).toBe(false);
  });

  // 테스트 7: 외부 API 호출 수가 증가하지 않는가 — 모듈이 KIS/KRX/Yahoo/Naver/fetch import 0건 (순수 모듈)
  it('does not import any external API client (KIS/KRX/Yahoo/Naver/fetch/axios)', () => {
    const src = readFileSync(join(moduleDir, 'preflightBlockedScanSummary.ts'), 'utf-8');
    expect(src).not.toMatch(/from ['"][^'"]*kisClient/i);
    expect(src).not.toMatch(/from ['"][^'"]*krxClient/i);
    expect(src).not.toMatch(/from ['"][^'"]*yahoo/i);
    expect(src).not.toMatch(/from ['"][^'"]*naver/i);
    expect(src).not.toMatch(/from ['"]axios/);
    expect(src).not.toMatch(/\bfetch\s*\(/);
    // 순수 in-memory 모듈 — import 문 자체가 0건.
    expect(src).not.toMatch(/^import /m);
  });

  // clear 동작: 정상 스캔 1회가 "직전 스캔 = preflight 차단" 의미를 무효화한다.
  it('clearPreflightBlockedScanSummary resets state so formatScanBlockersMessage falls back', () => {
    recordPreflightBlockedScanSummary({
      blockedBy: 'HARD_BLOCK',
      candidateSummaryCount: 10,
      universeSnapshotRecorded: true,
      counterfactualRecorded: true,
    });
    expect(getLastPreflightBlockedScanSummary()).not.toBeNull();

    clearPreflightBlockedScanSummary();
    expect(getLastPreflightBlockedScanSummary()).toBeNull();
    expect(formatScanBlockersMessage(null)).toContain('진단 데이터 없음');
  });

  // 입력 sanitize: candidateSummaryCount 음수/NaN → 0 으로 강등.
  it('sanitizes candidateSummaryCount — negative or NaN falls back to 0', () => {
    const negative = recordPreflightBlockedScanSummary({
      blockedBy: 'PRE_FLIGHT_BLOCK',
      candidateSummaryCount: -5,
      universeSnapshotRecorded: false,
      counterfactualRecorded: false,
    });
    expect(negative.candidateSummaryCount).toBe(0);

    const nan = recordPreflightBlockedScanSummary({
      blockedBy: 'PRE_FLIGHT_BLOCK',
      candidateSummaryCount: Number.NaN,
      universeSnapshotRecorded: false,
      counterfactualRecorded: false,
    });
    expect(nan.candidateSummaryCount).toBe(0);
  });
});

describe('preflight blocked display relabel patch', () => {
  afterEach(() => {
    __resetPreflightBlockedScanSummaryForTests();
  });

  it('separates REGULAR session from R6 defense mode and prints Gate3 fallback states', () => {
    const regularR6 = recordPreflightBlockedScanSummary({
      blockedBy: 'PRE_FLIGHT_BLOCK',
      preflightDecision: 'ABORT_R6_DEFENSE',
      candidateSummaryCount: 11,
      universeSnapshotRecorded: true,
      counterfactualRecorded: true,
      scanEvaluation: {
        scanId: 'scan-r6',
        asOf: '2026-05-20T04:00:00.000Z',
        evaluationState: 'NOT_EVALUATED_R6_LIVE_BLOCKED',
        marketSessionState: 'REGULAR',
        engineMode: 'SELL_ONLY',
        effectiveRegime: 'R6_DEFENSE',
        totalCandidates: 11,
        evaluated: 11,
        skipped: 0,
        rejected: 10,
        survivors: 1,
        quoteHydrated: 11,
        quoteHydrationFailed: 0,
        blockReason: 'R6_DEFENSE_SELL_ONLY',
        breakPoint: 'PRE_FLIGHT_SELL_ONLY',
        sourcePath: 'test',
        executionImpact: 'NEW_BUY_BLOCKED_ONLY',
        shadowLearningAllowed: true,
        diagnostics: { rawRegime: 'R2_BULL', gate3CompactText: 'G3 OK' },
      },
    });

    const regularSection = formatPreflightBlockedScanSection(regularR6);
    expect(regularSection).toContain('marketSessionState=REGULAR');
    expect(regularSection).toContain('entryBlockMode=R6_DEFENSE');
    expect(regularSection).toContain('engineModeDisplay=DEFENSE_LIVE_BLOCK');
    expect(regularSection).toContain('liveEntryAllowed=false');
    expect(regularSection).toContain('displayEvaluationState=LIVE_ENTRY_SKIPPED_R6_DEFENSE');
    expect(regularSection).toContain('displayBreakPoint=PRE_FLIGHT_R6_DEFENSE');
    expect(regularSection).toContain('liveEntryEvaluation=SKIPPED_R6_DEFENSE');
    expect(regularSection).toContain('topReason=LIVE_ENTRY_BLOCKED_BY_R6_DEFENSE');
    expect(regularSection).not.toContain('topReason=MARKET_WEAK');
    expect(regularSection).toContain('  • Gate3Diag: G3 OK');

    const sellOnly = recordPreflightBlockedScanSummary({
      blockedBy: 'PRE_FLIGHT_BLOCK',
      preflightDecision: 'ABORT_SELL_ONLY',
      candidateSummaryCount: 11,
      universeSnapshotRecorded: true,
      counterfactualRecorded: true,
      scanEvaluation: {
        ...regularR6.scanEvaluation!,
        marketSessionState: 'SELL_ONLY',
        effectiveRegime: 'R2_BULL',
        blockReason: 'SELL_ONLY',
        diagnostics: { rawRegime: 'R2_BULL' },
      },
    });
    const sellOnlySection = formatPreflightBlockedScanSection(sellOnly);
    expect(sellOnlySection).toContain('entryBlockMode=SELL_ONLY');
    expect(sellOnlySection).toContain('displayEvaluationState=NOT_EVALUATED_SELL_ONLY');
    expect(sellOnlySection).toContain('displayBreakPoint=PRE_FLIGHT_SELL_ONLY');
    expect(sellOnlySection).toContain('topReason=SELL_ONLY_TIME_WINDOW');
    expect(sellOnlySection).toContain('  • Gate3Diag: NOT_EVALUATED_SELL_ONLY | timingDiagnosticPreserved=true | marketSignal=false');

    const sellOnlyR6 = recordPreflightBlockedScanSummary({
      blockedBy: 'PRE_FLIGHT_BLOCK',
      preflightDecision: 'ABORT_R6_DEFENSE',
      candidateSummaryCount: 11,
      universeSnapshotRecorded: true,
      counterfactualRecorded: true,
      scanEvaluation: {
        ...regularR6.scanEvaluation!,
        marketSessionState: 'SELL_ONLY',
        effectiveRegime: 'R6_DEFENSE',
        diagnostics: { rawRegime: 'R2_BULL' },
      },
    });
    const sellOnlyR6Section = formatPreflightBlockedScanSection(sellOnlyR6);
    expect(sellOnlyR6Section).toContain('entryBlockMode=R6_DEFENSE_SELL_ONLY');
    expect(sellOnlyR6Section).toContain('displayEvaluationState=LIVE_ENTRY_SKIPPED_R6_SELL_ONLY');
    expect(sellOnlyR6Section).toContain('displayBreakPoint=PRE_FLIGHT_R6_SELL_ONLY');
    expect(sellOnlyR6Section).toContain('topReason=R6_DEFENSE_SELL_ONLY');
  });
});
