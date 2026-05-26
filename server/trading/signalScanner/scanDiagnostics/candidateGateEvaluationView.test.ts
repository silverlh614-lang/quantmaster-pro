// @responsibility ADR-0526 Phase 1a equivalence safety net — View status/readiness/aggregate must equal the canonical sources formatters read today (so 1b is a pure swap).

import { describe, expect, it } from 'vitest';
import {
  buildCandidateGateEvaluationViews,
  aggregateCandidateGateEvaluationViews,
} from './candidateGateEvaluationView.js';
import { buildGate2ConfluenceSummary } from '../../../quant/gate2ConfluenceScore.js';
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

// gate2 PASS_STRONG/PASS_WEAK 를 산출하는 bullish trace (gate2ConfluenceScore.test.ts 패턴 재사용).
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

// Gate1 hard-fail trace → gate2 SKIPPED_BY_GATE1 + gate1 FAIL.
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

// 정본 gate3Consolidated (Phase0 source) 를 실제 누적 경로로 빌드: READY(005930) + BLOCKED(000660).
function buildFixtureSummary(): ScanSummary {
  const counters = createScanCounters();
  accumulateGateLayerSummary(counters, gateLayer(READY_DIAGNOSTIC), 'BUY', { symbol: '005930', name: 'Samsung' });
  accumulateGateLayerSummary(counters, gateLayer(BLOCKED_DIAGNOSTIC), 'BUY', { symbol: '000660', name: 'Hynix' });
  const gateLayerAudit = buildGateLayerAuditSummary(counters, {
    sourceSnapshotId: 'scan-eval:cgev',
    asOf: '2026-05-25T09:00:00.000Z',
  });

  const candidateTraces = [
    bullishCandidateTrace('005930', 'Samsung'),
    gate1HardFailTrace('000660', 'Hynix'),
  ];
  return {
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
    snapshotId: 'scan-eval:cgev',
    scanEvaluation: {
      scanId: 'scan-eval:cgev',
      asOf: '2026-05-25T09:00:00.000Z',
      effectiveRegime: 'GREEN',
    } as ScanSummary['scanEvaluation'],
    entryFilterDecomposition: {
      candidateTraces,
      gate1CandidateTraces: [
        { symbol: '005930', name: 'Samsung', gate1Passed: true, hardFailCount: 0, softFailCount: 0 },
        { symbol: '000660', name: 'Hynix', gate1Passed: false, hardFailCount: 1, softFailCount: 0, primaryFailCode: 'MIN_SIGNAL_SCORE_PASS' },
      ],
    } as unknown as ScanSummary['entryFilterDecomposition'],
    gateLayerAudit,
  };
}

describe('ADR-0526 buildCandidateGateEvaluationViews equivalence', () => {
  it('gate2 View status equals buildGate2ConfluenceSummary status for the same symbol', () => {
    const summary = buildFixtureSummary();
    const views = buildCandidateGateEvaluationViews(summary);
    const confluence = buildGate2ConfluenceSummary({
      traces: summary.entryFilterDecomposition!.candidateTraces as unknown as readonly Record<string, unknown>[],
      sourceSnapshotId: 'scan-eval:cgev',
    });
    const statusBySymbol = new Map(confluence.results.map(r => [r.symbol, r.gate2Status]));

    const samsung = views.find(v => v.symbol === '005930')!;
    const hynix = views.find(v => v.symbol === '000660')!;

    // 동치: bullish → PASS/PASS_WEAK; gate1 hard fail → SKIPPED.
    expect(['GATE2_PASS_STRONG', 'GATE2_PASS_WEAK']).toContain(statusBySymbol.get('005930'));
    expect(['PASS', 'PASS_WEAK']).toContain(samsung.gate2.status);
    expect(statusBySymbol.get('000660')).toBe('SKIPPED_BY_GATE1');
    expect(hynix.gate2.status).toBe('SKIPPED');
  });

  it('gate3 View readiness equals gate3Consolidated.candidateDetails readiness for the same symbol', () => {
    const summary = buildFixtureSummary();
    const views = buildCandidateGateEvaluationViews(summary);
    const details = summary.gateLayerAudit!.gate3Consolidated!.candidateDetails;
    const readinessBySymbol = new Map(details.map(d => [d.symbol, d.readiness]));

    const samsung = views.find(v => v.symbol === '005930')!;
    const hynix = views.find(v => v.symbol === '000660')!;

    expect(readinessBySymbol.get('005930')).toBe('READY');
    expect(samsung.gate3.readiness).toBe('READY');
    expect(samsung.gate3.timingReadyPermission).toBe(true);
    expect(readinessBySymbol.get('000660')).toBe('BLOCKED');
    expect(hynix.gate3.readiness).toBe('TIMING_FAIL');
    expect(hynix.gate3.timingReadyPermission).toBe(false);
  });

  it('gate1 View status reflects gate1CandidateTrace pass/hardFail (PASS vs FAIL)', () => {
    const views = buildCandidateGateEvaluationViews(buildFixtureSummary());
    const samsung = views.find(v => v.symbol === '005930')!;
    const hynix = views.find(v => v.symbol === '000660')!;

    expect(samsung.gate1.status).toBe('PASS');
    expect(samsung.gate1.passPermission).toBe(true);
    expect(hynix.gate1.status).toBe('FAIL');
    expect(hynix.gate1.passPermission).toBe(false);
  });

  it('aggregate gate3ReadyCount matches Phase0 gate3Consolidated (same candidateDetails, numeric equivalence)', () => {
    const summary = buildFixtureSummary();
    const views = buildCandidateGateEvaluationViews(summary);
    const aggregate = aggregateCandidateGateEvaluationViews(views);
    const consolidated = summary.gateLayerAudit!.gate3Consolidated!;

    // gate3ReadyCount == candidateDetails(readiness===READY) == Phase0 executionReadyCount (fixture 정렬).
    const readyDetails = consolidated.candidateDetails.filter(d => d.readiness === 'READY').length;
    expect(aggregate.gate3ReadyCount.value).toBe(readyDetails);
    expect(aggregate.gate3ReadyCount.value).toBe(consolidated.executionReadyCount);
    expect(aggregate.gate3TimingFailCount.value).toBe(
      consolidated.candidateDetails.filter(d => d.readiness === 'BLOCKED').length,
    );
    expect(aggregate.evaluatedCount.value).toBe(2);
  });

  it('is deterministic — same summary built twice is deep-equal', () => {
    const a = buildCandidateGateEvaluationViews(buildFixtureSummary());
    const b = buildCandidateGateEvaluationViews(buildFixtureSummary());
    expect(a).toEqual(b);
    expect(aggregateCandidateGateEvaluationViews(a)).toEqual(aggregateCandidateGateEvaluationViews(b));
  });

  it('combined topBlockReason follows priority registry — gate1-fail candidate carries gate1 reason', () => {
    const views = buildCandidateGateEvaluationViews(buildFixtureSummary());
    const hynix = views.find(v => v.symbol === '000660')!;
    // gate1 FAIL → gate0 pass 이후 첫 fail 게이트(gate1) 사유 채택.
    expect(hynix.gate1.status).toBe('FAIL');
    expect(hynix.topBlockReason).toBe(hynix.gate1.topBlockReason);
    expect(hynix.topBlockReason).not.toBe('NONE');

    const samsung = views.find(v => v.symbol === '005930')!;
    // gate0/1/2/3 모두 통과 → NONE.
    expect(samsung.topBlockReason).toBe('NONE');
  });

  it('returns empty array (no throw) and logs SDS-safely when summary/traces missing', () => {
    expect(buildCandidateGateEvaluationViews(null)).toEqual([]);
    expect(
      buildCandidateGateEvaluationViews({ time: 't', candidates: 0 } as unknown as ScanSummary),
    ).toEqual([]);
  });
});
