// @responsibility ADR-0527 Phase 2a safety net — unified per-candidate resolution must be byte-equivalent to A (resolveExecutionPermission), separate permission(boolean) from count, and stay deterministic (no dummy-time dependence).

import { describe, expect, it } from 'vitest';
import {
  buildCandidateExecutionResolutions,
  aggregateUnifiedExecutionPermission,
} from './candidateExecutionResolution.js';
import { buildCandidateGateEvaluationViews } from './candidateGateEvaluationView.js';
import { resolveExecutionPermission } from '../../../runtime/executionPermissionResolver.js';
import { toUnifiedExecutionPermission } from '../../gates/unifiedExecutionContract.js';
import {
  accumulateGateLayerSummary,
  buildGateLayerAuditSummary,
  createScanCounters,
} from '../scanDiagnostics.js';
import type { ScanSummary } from './scanSummaryTypes.js';
import type { GateLayerSummary } from '../../../quantFilter.js';

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
    gate3: { ...bucket, consolidatedDiagnostic: consolidatedDiagnostic as never },
    finalPath: 'SHADOW_OBSERVABLE',
  };
}

function bullishCandidateTrace(symbol: string, name: string): Record<string, unknown> {
  return {
    symbol,
    name,
    gate1Passed: true,
    blockers: [],
    symbolFeatures: {
      rsScore: 100,
      maAlignmentStatus: 'NEUTRAL',
      aboveMA20: true,
      aboveMA60: true,
      return20d: 4,
    },
    gate2ExternalDataCoverage: {
      kisInvestorFlow: { status: 'VERIFIED', foreignNetBuy: 1200, institutionalNetBuy: 900 },
      sectorCycle: {
        status: 'VERIFIED',
        values: { sectorRelativeReturn20d: 8, stockVsSectorReturn20d: 4, sectorPercentile20d: 82 },
      },
      leaderCycle: { isCurrentLeadingSector: true, isSectorLeader: true, attentionPhase: 'EARLY' },
    },
  };
}

function gate1HardFailTrace(symbol: string, name: string): Record<string, unknown> {
  return {
    symbol,
    name,
    gate1Passed: false,
    blockers: [
      { category: 'GATE1', code: 'MIN_SIGNAL_SCORE_FAIL', severity: 'HARD_BLOCK', message: 'x', executionBlocking: true, learningBlocking: false },
    ],
    gate1Trace: { hardFailCount: 1, gate1Passed: false },
  };
}

const READY_DIAGNOSTIC = {
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

const BLOCKED_DIAGNOSTIC = {
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

/**
 * Phase1 candidateGateViews 까지 채운 fixture summary 빌드 (producer 가 읽는 입력 정합).
 * macroGateState 로 A 입력 컨텍스트(engineMode/broker/operator/provider) 지정 가능.
 */
function buildFixtureSummary(macroOverride: Record<string, unknown> = {}): ScanSummary {
  const counters = createScanCounters();
  accumulateGateLayerSummary(counters, gateLayer(READY_DIAGNOSTIC), 'BUY', { symbol: '005930', name: 'Samsung' });
  accumulateGateLayerSummary(counters, gateLayer(BLOCKED_DIAGNOSTIC), 'BUY', { symbol: '000660', name: 'Hynix' });
  const gateLayerAudit = buildGateLayerAuditSummary(counters, {
    sourceSnapshotId: 'scan-eval:cexr',
    asOf: '2026-05-25T09:00:00.000Z',
  });

  const candidateTraces = [
    bullishCandidateTrace('005930', 'Samsung'),
    gate1HardFailTrace('000660', 'Hynix'),
  ];
  const summary: ScanSummary = {
    time: '2026-05-25T09:00:00.000Z',
    candidates: 2,
    trackB: 0,
    swing: 0,
    catalyst: 0,
    momentum: 0,
    yahooFails: 0,
    gateMisses: 0,
    rrrMisses: 0,
    entries: 0,
    snapshotId: 'scan-eval:cexr',
    macroGateState: {
      engineMode: 'LIVE',
      regime: 'GREEN',
      brokerOrderAllowed: true,
      liveEntryAllowed: true,
      autoTradeEnabled: true,
      finalKellyMultiplier: 1,
      ...macroOverride,
    } as unknown as ScanSummary['macroGateState'],
    scanEvaluation: {
      scanId: 'scan-eval:cexr',
      asOf: '2026-05-25T09:00:00.000Z',
      effectiveRegime: 'GREEN',
    } as ScanSummary['scanEvaluation'],
    entryFilterDecomposition: {
      candidateTraces,
      gate1CandidateTraces: [
        { symbol: '005930', name: 'Samsung', gate1Passed: true, hardFailCount: 0, softFailCount: 0 },
        { symbol: '000660', name: 'Hynix', gate1Passed: false, hardFailCount: 1, softFailCount: 0, primaryFailCode: 'MIN_SIGNAL_SCORE_FAIL' },
      ],
    } as unknown as ScanSummary['entryFilterDecomposition'],
    gateLayerAudit,
  };
  // Phase1 정본 View 채움 (producer 가 gate quality 정본으로 읽음).
  summary.candidateGateViews = buildCandidateGateEvaluationViews(summary);
  return summary;
}

describe('ADR-0527 buildCandidateExecutionResolutions — A byte-equivalence', () => {
  it('per-candidate liveOrderAllowed equals resolveExecutionPermission(same input).liveOrderAllowed', () => {
    const summary = buildFixtureSummary();
    const resolutions = buildCandidateExecutionResolutions(summary);
    expect(resolutions.length).toBe(2);

    // Samsung: gate quality PASS + LIVE engine + broker/operator allowed → live order allowed (A=NONE block).
    const samsung = resolutions.find(r => r.sourceSnapshotId === 'scan-eval:cexr' && r.liveOrderAllowed === true);
    expect(samsung).toBeDefined();

    // 직접 A 를 동일 입력으로 호출하여 byte-equivalent 확인 (Samsung: 모든 권한 통과).
    const aSamsung = resolveExecutionPermission({
      sourceSnapshotId: 'scan-eval:cexr',
      asOf: '2026-05-25T09:00:00.000Z',
      gateQualityPassed: true,
      engineMode: 'NORMAL',
      operationMode: 'NORMAL',
      effectiveRegime: 'GREEN',
      marketSessionState: 'UNKNOWN',
      brokerOrderAllowed: true,
      operatorOrderAllowed: true,
      realTradingEnabled: true,
      providerIssue: false,
      marketSignal: false,
      kellyFraction: null,
      kellySizingMultiplier: 1,
    });
    expect(samsung!.liveOrderAllowed).toBe(aSamsung.liveOrderAllowed);
    expect(samsung!.executionImpact).toBe(aSamsung.executionImpact);
    expect(samsung!.liveBlockReason).toBe(aSamsung.liveBlockReason);
    expect(samsung!.sizingMultiplier).toBe(aSamsung.sizingMultiplier);
  });

  it('SHADOW_ONLY engine blocks live but keeps shadow permission (invariant #8)', () => {
    const summary = buildFixtureSummary({ engineMode: 'SHADOW_ONLY' });
    const resolutions = buildCandidateExecutionResolutions(summary);
    expect(resolutions.length).toBe(2);
    for (const r of resolutions) {
      // 모든 후보 live 차단(SHADOW_ONLY).
      expect(r.liveOrderAllowed).toBe(false);
      // 실거래 차단 ≠ Shadow 차단 — shadow/counterfactual/paper/learning 권한은 유지.
      expect(r.shadowPermissionAllowed).toBe(true);
      expect(r.counterfactualAllowed).toBe(true);
      expect(r.paperFillAllowed).toBe(true);
      expect(r.learningAllowed).toBe(true);
    }
    // gate-quality 통과 후보(Samsung)는 SHADOW_ONLY_POLICY 사유 — A 우선순위에서 POLICY_BLOCK 이 아님.
    // (gate-quality 실패 후보는 A 가 POLICY_BLOCK 을 먼저 반환 = byte-equivalent 우선순위 보존.)
    const reasons = new Set(resolutions.map(r => r.liveBlockReason));
    expect(reasons.has('SHADOW_ONLY_POLICY')).toBe(true);
  });

  it('providerIssue isolates marketSignal to false (invariant #6) without becoming bearish', () => {
    const summary = buildFixtureSummary({ providerIssue: true, marketSignal: true });
    const resolutions = buildCandidateExecutionResolutions(summary);
    for (const r of resolutions) {
      expect(r.providerIssueIsolated).toBe(true);
      expect(r.marketSignal).toBe(false);
    }
  });
});

describe('ADR-0527 aggregateUnifiedExecutionPermission — permission(boolean) vs count(number) separation', () => {
  it('shadowPermissionAllowed(boolean) and shadowOrderCreated(count) are different types and names', () => {
    const summary = buildFixtureSummary();
    const resolutions = buildCandidateExecutionResolutions(summary);
    const aggregate = aggregateUnifiedExecutionPermission(resolutions);

    // per-candidate 는 boolean 권한.
    for (const r of resolutions) {
      expect(typeof r.shadowPermissionAllowed).toBe('boolean');
    }
    // aggregate 는 scope 태그된 count (다른 이름, 다른 타입).
    expect(typeof aggregate.shadowOrderCreated.value).toBe('number');
    expect(aggregate.shadowOrderCreated).toHaveProperty('scope');
    // 컴파일/런타임 상 다른 이름임을 명시 — count 객체에 boolean 권한 필드가 없다.
    expect((aggregate.shadowOrderCreated as unknown as Record<string, unknown>).shadowPermissionAllowed).toBeUndefined();
  });

  it('aggregate counts reflect per-candidate decisions deterministically', () => {
    const summary = buildFixtureSummary();
    const a = aggregateUnifiedExecutionPermission(buildCandidateExecutionResolutions(summary));
    const b = aggregateUnifiedExecutionPermission(buildCandidateExecutionResolutions(buildFixtureSummary()));
    expect(a).toEqual(b);
  });
});

describe('ADR-0527 toUnifiedExecutionPermission — B labels merge without mutating A permission', () => {
  it('B decision/conviction/reasonCodes merge while A permission booleans stay byte-equivalent', () => {
    const permission = resolveExecutionPermission({
      sourceSnapshotId: 'scan-eval:cexr',
      asOf: '2026-05-25T09:00:00.000Z',
      gateQualityPassed: true,
      engineMode: 'NORMAL',
      brokerOrderAllowed: true,
      operatorOrderAllowed: true,
      realTradingEnabled: true,
    });
    const merged = toUnifiedExecutionPermission(permission, {
      decision: 'BLOCK',
      convictionLabel: 'WATCH',
      reasonCodes: ['SOME_LABEL'],
    });

    // permission boolean 은 A 에서만 — B 의 BLOCK 라벨이 liveOrderAllowed 를 덮어쓰지 않음.
    expect(merged.liveOrderAllowed).toBe(permission.liveOrderAllowed);
    expect(merged.liveSellAllowed).toBe(permission.liveOrderAllowed);
    expect(merged.shadowPermissionAllowed).toBe(permission.shadowOrderAllowed);
    expect(merged.executionImpact).toBe(permission.executionImpact);
    expect(merged.sizingMultiplier).toBe(permission.sizingMultiplier);
    // B 라벨은 그대로 병합.
    expect(merged.decision).toBe('BLOCK');
    expect(merged.convictionLabel).toBe('WATCH');
    expect(merged.reasonCodes).toContain('SOME_LABEL');
    expect(merged.strongBuyAsLabelOnly).toBe(true);
  });
});

describe('ADR-0527 determinism — no dummy-time dependence', () => {
  it('same summary built twice is deep-equal (resolution list)', () => {
    const a = buildCandidateExecutionResolutions(buildFixtureSummary());
    const b = buildCandidateExecutionResolutions(buildFixtureSummary());
    expect(a).toEqual(b);
  });

  it('returns empty array (no throw) when summary/traces missing', () => {
    expect(buildCandidateExecutionResolutions(null)).toEqual([]);
    expect(
      buildCandidateExecutionResolutions({ time: 't', candidates: 0 } as unknown as ScanSummary),
    ).toEqual([]);
  });
});
