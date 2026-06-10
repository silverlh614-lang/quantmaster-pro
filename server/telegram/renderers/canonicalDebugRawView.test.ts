// @responsibility ADR-0525 regression — debug_raw view extracts gate3 from the same persisted source scan_blockers reads (byte-equivalent, no conflict).

import { describe, expect, it } from 'vitest';
import { buildCanonicalDebugRawView } from './canonicalDebugRawView.js';
import { buildSnapshotBundleFromScanSummary } from './snapshotBundle.js';
import {
  accumulateGateLayerSummary,
  buildGateLayerAuditSummary,
  createScanCounters,
} from '../../trading/signalScanner/scanDiagnostics.js';
import type { ScanSummary } from '../../trading/signalScanner/scanDiagnostics/scanSummaryTypes.js';
import type { GateLayerSummary } from '../../quantFilter.js';

function gateLayer(consolidatedDiagnostic: Record<string, unknown>): GateLayerSummary {
  const bucket = {
    fired: [],
    unavailable: [],
    thresholdNotMet: [],
    providerDegraded: [],
    passed: false,
    score: 0,
    availableMaxScore: 0,
  };
  return {
    gate1: { ...bucket, passed: true },
    gate2: { ...bucket },
    gate3: {
      ...bucket,
      consolidatedDiagnostic: consolidatedDiagnostic as never,
    },
    finalPath: 'SHADOW_OBSERVABLE',
  };
}

// READY(FIRED, RRR PASS, executionReady) 1건 + BLOCKED(THRESHOLD_NOT_MET, RRR FAIL) 1건 →
// 알려진 gate3Consolidated 카운터를 산출한다 (scanBlockersGate3.test.ts 의 fixture 패턴 참고).
function buildFixtureSummary(): ScanSummary {
  const counters = createScanCounters();
  const ready = {
    timingReadiness: 'READY',
    falseBreakoutRisk: 'LOW',
    executionImpact: 'NONE',
    entryPriceGuard: { priceFreshness: 'VERIFIED' },
    rrrCheck: { rrr: 2.4, status: 'PASS', source: 'FALLBACK_PERCENT' },
    lastTrigger: {
      status: 'FIRED',
      fired: true,
      executionReady: true,
      liveBuyAllowed: true,
      shadowObservableAllowed: true,
      counterfactualAllowed: true,
      priceConfirmation: { status: 'BREAKOUT_CONFIRMED' },
      volumeConfirmationDetail: { status: 'CONFIRMED', volumeRatio20d: 1.8 },
    },
  };
  const blocked = {
    timingReadiness: 'BLOCKED',
    falseBreakoutRisk: 'LOW',
    executionImpact: 'NONE',
    entryPriceGuard: { priceFreshness: 'VERIFIED' },
    rrrCheck: { rrr: 1.2, status: 'FAIL', source: 'EXPLICIT' },
    lastTrigger: {
      status: 'THRESHOLD_NOT_MET',
      fired: false,
      executionReady: false,
      liveBuyAllowed: false,
      shadowObservableAllowed: true,
      counterfactualAllowed: true,
      priceConfirmation: { status: 'NOT_CONFIRMED' },
      volumeConfirmationDetail: { status: 'WEAK', volumeRatio20d: 0.8 },
    },
  };
  accumulateGateLayerSummary(counters, gateLayer(ready), 'BUY', { symbol: '204320', name: 'HL만도' });
  accumulateGateLayerSummary(counters, gateLayer(blocked), 'BUY', { symbol: '011210', name: '현대위아' });
  const gateLayerAudit = buildGateLayerAuditSummary(counters, {
    sourceSnapshotId: 'scan-eval:debug-raw',
    asOf: '2026-05-25T09:00:00.000Z',
  });
  // gate1Survival 정본 슬라이스 (accumulate 입력에 full Gate1SurvivalDiagnostic 을 넣는 대신
  // persisted gate1Survival 요약을 직접 부여 — debug_raw 가 읽는 정본 source 와 동일 형태).
  gateLayerAudit.gate1Survival = {
    samples: 2,
    quoteFreshness: { VERIFIED: 2 },
    quoteCoverageConfidence: { HIGH: 2 },
    liquidityStatus: { PASS: 2 },
    marketSession: { REGULAR: 2 },
    shadowMode: { NORMAL: 2 },
    shadowExecutionImpact: { NONE: 2 },
    consolidatedHealth: { OK: 2 },
    consolidatedPrimaryIssue: { none: 2 },
    consolidatedOperatorAction: { OBSERVE: 2 },
    consolidatedExecutionImpact: { NONE: 2 },
    consolidatedCompactText: {},
    liveBuyBlockedCount: 1,
    shadowAllowedCount: 2,
  };
  return {
    time: '2026-05-25T09:00:00.000Z',
    candidates: 2,
    trackB: 0,
    swing: 0,
    catalyst: 0,
    momentum: 0,
    quoteFails: 0,
    gateMisses: 0,
    rrrMisses: 0,
    entries: 0,
    snapshotId: 'scan-eval:debug-raw',
    macroGateState: {
      emergencyStop: false,
      autoTradeEnabled: false,
      regime: 'GREEN',
      kellyMultiplierFromRegime: 1,
      fomcPhase: 'NONE',
      fomcKellyMultiplier: 1,
      finalKellyMultiplier: 0.42,
      vixGatingActive: false,
      bearDefenseMode: false,
      mhsBelow30: false,
      watchlistEmpty: false,
      sellOnlyMode: false,
      engineMode: 'NORMAL',
      canonicalSession: 'REGULAR',
    } as ScanSummary['macroGateState'],
    scanEvaluation: {
      scanId: 'scan-eval:debug-raw',
      asOf: '2026-05-25T09:00:00.000Z',
      evaluationState: 'EVALUATED_WITH_SURVIVORS',
      marketSessionState: 'BUY_ALLOWED',
      engineMode: 'NORMAL',
      effectiveRegime: 'GREEN',
      totalCandidates: 2,
      evaluated: 2,
      skipped: 0,
      rejected: 0,
      survivors: 2,
      quoteHydrated: 2,
      quoteHydrationFailed: 0,
      sourcePath: 'SourceSnapshot',
      executionImpact: 'NONE',
      shadowLearningAllowed: true,
    } as ScanSummary['scanEvaluation'],
    gateLayerAudit,
    canonicalRuntimeResolution: {
      scanId: 'scan-eval:debug-raw',
      sourceSnapshotId: 'scan-eval:debug-raw',
      gateScoreInputSnapshotId: 'gateScoreInput:scan-eval:debug-raw',
      sizing: { hardBlockCount: 1, advisoryCount: 3, finalKelly: 0.42 },
    } as ScanSummary['canonicalRuntimeResolution'],
  };
}

describe('ADR-0525 buildCanonicalDebugRawView gate3 byte-equivalence', () => {
  it('extracts gate3 counters straight from the persisted gate3Consolidated fixture (zero recomputation)', () => {
    const summary = buildFixtureSummary();
    const consolidated = summary.gateLayerAudit!.gate3Consolidated!;
    const view = buildCanonicalDebugRawView(summary);

    expect(view.gate3Consolidated).toBeDefined();
    const g3 = view.gate3Consolidated!;

    // fixture 가 산출한 정확한 값과 일치 (READY 1 + BLOCKED 1).
    expect(consolidated.samples).toBe(2);
    expect(consolidated.lastTriggerFiredCount).toBe(1);
    expect(consolidated.lastTriggerWaitCount).toBe(1);
    expect(consolidated.lastTriggerThresholdNotMetCount).toBe(1);
    expect(consolidated.rrrPassCount).toBe(1);
    expect(consolidated.rrrFailCount).toBe(1);
    expect(consolidated.rrrMissingCount).toBe(0);
    expect(consolidated.executionReadyCount).toBe(1);

    // view 값 == fixture(persisted) 값. 추출만 — 재계산 없음.
    expect(g3.samples.value).toBe(consolidated.samples);
    expect(g3.lastTriggerFiredCount.value).toBe(consolidated.lastTriggerFiredCount);
    expect(g3.lastTriggerWaitCount.value).toBe(consolidated.lastTriggerWaitCount);
    expect(g3.lastTriggerThresholdNotMetCount.value).toBe(consolidated.lastTriggerThresholdNotMetCount);
    expect(g3.lastTriggerDataUnavailableCount.value).toBe(consolidated.lastTriggerDataUnavailableCount);
    expect(g3.rrrPassCount.value).toBe(consolidated.rrrPassCount);
    expect(g3.rrrWatchCount.value).toBe(consolidated.rrrWatchCount);
    expect(g3.rrrFailCount.value).toBe(consolidated.rrrFailCount);
    expect(g3.rrrMissingCount.value).toBe(consolidated.rrrMissingCount);
    expect(g3.executionReadyCount.value).toBe(consolidated.executionReadyCount);
  });

  it('reads the SAME source scan_blockers reads — debug_raw vs scan_blockers gate3 cannot conflict', () => {
    const summary = buildFixtureSummary();
    // scan_blockers (formatScanBlockersMessage) 가 읽는 정본: summary.gateLayerAudit.gate3Consolidated.
    const scanBlockersSource = summary.gateLayerAudit!.gate3Consolidated!;
    const view = buildCanonicalDebugRawView(summary);
    const g3 = view.gate3Consolidated!;

    // debug_raw view 의 모든 gate3 카운터 == scan_blockers 가 읽는 동일 source 값.
    expect(g3.samples.value).toBe(scanBlockersSource.samples);
    expect(g3.lastTriggerWaitCount.value).toBe(scanBlockersSource.lastTriggerWaitCount);
    expect(g3.rrrMissingCount.value).toBe(scanBlockersSource.rrrMissingCount);
    expect(g3.executionReadyCount.value).toBe(scanBlockersSource.executionReadyCount);

    // base(snapshotBundle = scan_blockers base) 의 gate3 투영과도 정합 — 동일 정본 분기 없음.
    const base = buildSnapshotBundleFromScanSummary(summary);
    expect(base.gate3?.triggerWait).toBe(g3.lastTriggerWaitCount.value);
    expect(base.gate3?.rrrMissing).toBe(g3.rrrMissingCount.value);
    expect(base.gate3?.lastTriggerTriggered).toBe(g3.lastTriggerFiredCount.value);
  });

  it('attaches scope tags to every count and resolves canonical scan meta from scanEvaluation', () => {
    const summary = buildFixtureSummary();
    const view = buildCanonicalDebugRawView(summary);

    // scope 태그 의무 (ADR-0525 §Decision.2).
    expect(view.gate3Consolidated!.samples.scope).toBe('GATE3_TIMING_SAMPLE');
    expect(view.gate1Survival!.samples.scope).toBe('GATE1_SURVIVAL_SAMPLE');
    expect(view.sizing!.hardBlockCount.scope).toBe('SIZING_SAMPLE');

    // gate1Survival 정본 추출.
    expect(view.gate1Survival!.samples.value).toBe(2);
    expect(view.gate1Survival!.liveBuyBlockedCount.value).toBe(1);
    expect(view.gate1Survival!.shadowAllowedCount.value).toBe(2);

    // sizing 정본 추출.
    expect(view.sizing!.advisoryCount.value).toBe(3);
    expect(view.sizing!.hardBlockCount.value).toBe(1);
    expect(view.sizing!.finalKelly).toBe(0.42);

    // effectiveRegime 은 scanEvaluation.effectiveRegime(정본) — macroRegimeEffective 아님.
    expect(view.effectiveRegime).toBe('GREEN');
    expect(view.sourceSnapshotId).toBe('scan-eval:debug-raw');
    expect(view.engineMode).toBe('NORMAL');
    // ADR-0555 정합(marketSession 3출처 단일 통로): raw 세션은 이제 canonical 헤더와 동일하게
    // resolveScanMarketSessionView 를 거친다. fixture 의 timeLabel/asOf(2026-05-25T09:00:00.000Z)는
    // KST 벽시계 규약상 장외로 해석되어 CLOSED — canonical 헤더·compact 와 byte-equivalent.
    // (구 기대값 'REGULAR' 는 SSOT 우회 시절 raw 가 macro.canonicalSession 을 verbatim 투영하던
    //  drift 값이었다. 본 패치가 제거한 불일치.)
    expect(view.marketSession).toBe('CLOSED');
  });

  it('records missing slices instead of silent-dropping (SDS) when summary is null', () => {
    const view = buildCanonicalDebugRawView(null);
    expect(view.gate3Consolidated).toBeUndefined();
    expect(view.gate1Survival).toBeUndefined();
    expect(view.sizing).toBeUndefined();
    expect(view.missingSlices).toContain('gate3Consolidated: summary.gateLayerAudit.gate3Consolidated 미존재');
    expect(view.missingSlices).toContain('gate1Survival: summary.gateLayerAudit.gate1Survival 미존재');
    expect(view.missingSlices).toContain('sizing: summary.canonicalRuntimeResolution.sizing 미존재');
  });
});
