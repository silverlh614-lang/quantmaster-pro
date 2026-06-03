import { describe, expect, it } from 'vitest';
import {
  buildSnapshotBundleFromScanSummary,
  executionSummaryFromAudit,
  gate2SummaryFromAggregate,
  gate2SummaryFromConfluence,
  gate3SummaryFromRuntimeClosure,
} from './snapshotBundle.js';

describe('ADR-0523 Telegram snapshot bundle', () => {
  it('extracts one sourceSnapshotId and compact Gate1 fields from scan summary', () => {
    const bundle = buildSnapshotBundleFromScanSummary({
      snapshotId: 'scan-eval-0523',
      time: '2026-05-24T09:00:00.000Z',
      candidates: 43,
      macroGateState: { engineMode: 'SHADOW_ONLY', macroRegimeEffective: 'R6_DEFENSE', canonicalSession: 'REGULAR' },
      gateLayerAudit: { gate1PassCount: 18 },
      gate1MinimumSignalForensicAdr0505: {
        totalCandidates: 43,
        evaluatedCandidateCount: 39,
        actualScoreAvg: 68.4,
        requiredScoreAvg: 70,
        watchlistScoreNormalizedCount: 38,
        technicalProjectedCount: 39,
        rsScoreUsableCount: 36,
        dominantFailureDistribution: { RS_WEAK: 12 },
      },
    });

    expect(bundle.sourceSnapshotId).toBe('scan-eval-0523');
    expect(bundle.gate1?.pass).toBe(18);
    expect(bundle.gate1?.mainIssue).toBe('RS_WEAK');
    expect(bundle.engineMode).toBe('SHADOW_ONLY');
    expect(bundle.effectiveRegime).toBe('R6_DEFENSE');
  });

  it('prefers canonical scanEvaluation.effectiveRegime over stale legacy macroRegimeEffective', () => {
    const bundle = buildSnapshotBundleFromScanSummary({
      snapshotId: 'scan-eval-regime',
      time: '2026-05-25T09:00:00.000Z',
      candidates: 12,
      // 폐기된 R6 transition machine 잔재 — 상단 JSON 을 오염시키면 안 된다.
      macroGateState: {
        engineMode: 'SHADOW_ONLY',
        macroRegimeEffective: 'R6_DEFENSE',
        macroRegimeRaw: 'R3_EARLY',
        regime: 'R3_EARLY',
        displayRegime: 'SHADOW_ONLY',
        canonicalSession: 'REGULAR',
      },
      // 정본: buildCanonicalRegimeDiagnostics 가 staleLegacyR6 를 R3_EARLY 로 정정한 결과.
      scanEvaluation: { scanId: 'scan-eval-regime', effectiveRegime: 'R3_EARLY' },
    });

    expect(bundle.effectiveRegime).toBe('R3_EARLY');
  });

  it('maps Gate2, Gate3, and execution summaries into compact fields', () => {
    expect(gate2SummaryFromConfluence({
      evaluated: 18,
      gate2PassStrong: 4,
      gate2PassWeak: 9,
      gate2Watch: 3,
      gate2Fail: 2,
      rsUsable: 16,
      supplyUsable: 14,
      sectorUsable: 12,
      technicalUsable: 18,
      fundamentalUsable: 9,
      topPositiveAxis: 'SUPPLY_CONFLUENCE',
      topMissingAxis: 'FUNDAMENTAL_QUALITY',
    }).nextAction).toBe('Gate3 timing for 13 candidates');
    expect(gate3SummaryFromRuntimeClosure({
      evaluated: 13,
      gate3Ready: 1,
      triggerWait: 8,
      rrrComputed: 11,
      lastTriggerTriggered: 1,
      lastTriggerWait: 8,
      priceConfirmed: 11,
    }).ready).toBe(1);
    expect(executionSummaryFromAudit({
      entryReady: 3,
      liveBuyAllowed: 0,
      liveBuyBlocked: 3,
      shadowBuyAllowed: 3,
      observeOnly: 20,
      blockReasonDistribution: { R6_DEFENSE_LIVE_BUY_BLOCKED: 3 },
      executionImpactDistribution: { LIVE_BUY_BLOCKED: 3 },
      providerIssueConvertedToMarketSignalCount: 0,
    }).topBlockReason).toBe('R6_DEFENSE_LIVE_BUY_BLOCKED');
  });

  // ADR-0526 Phase 1b: gate2 표시 status 정본 = 스캔-시점 View aggregate(ScopedCount), 캐시 아님.
  it('gate2SummaryFromAggregate reads scan-time View status counts + display coverage', () => {
    const gate2 = gate2SummaryFromAggregate({
      evaluatedCount: { scope: 'ALL_CANDIDATES', value: 18 },
      gate2PassStrongCount: { scope: 'GATE2_COVERAGE_SAMPLE', value: 4 },
      gate2PassWeakCount: { scope: 'GATE2_COVERAGE_SAMPLE', value: 9 },
      gate2WatchCount: { scope: 'GATE2_COVERAGE_SAMPLE', value: 3 },
      gate2FailCount: { scope: 'GATE2_COVERAGE_SAMPLE', value: 2 },
      gate2DataIncompleteCount: { scope: 'GATE2_COVERAGE_SAMPLE', value: 0 },
      gate2Coverage: {
        rsUsable: 16, supplyUsable: 14, sectorUsable: 12, technicalUsable: 18, fundamentalUsable: 9,
        topPositiveAxis: 'SUPPLY_CONFLUENCE', topMissingAxis: 'FUNDAMENTAL_QUALITY',
      },
    });
    expect(gate2.passStrong).toBe(4);
    expect(gate2.passWeak).toBe(9);
    expect(gate2.evaluated).toBe(18);
    expect(gate2.topPositiveAxis).toBe('SUPPLY_CONFLUENCE');
    expect(gate2.nextAction).toBe('Gate3 timing for 13 candidates');
  });

  // P2 묶음2 (V5b): providerHealth 는 정본 스캔 요약 필드의 *pass-through projection* 이다 —
  // 렌더 시점 provider 직접 조회/재계산/재추론 0 (불변식 #3, ADR-0525/0526). 본 테스트는
  // 입력 summary 의 providerIssue/marketSignal/providerIssueDistribution 가 byte-equivalent 로
  // 그대로 투영됨을 잠가, 향후 누군가 렌더 시점 재계산을 끼워넣는 회귀를 차단한다.
  it('projects providerHealth as canonical pass-through (no render-time re-inference)', () => {
    const bundle = buildSnapshotBundleFromScanSummary({
      snapshotId: 'scan-eval-providerhealth',
      time: '2026-06-03T09:00:00.000Z',
      candidates: 7,
      providerIssue: true,
      marketSignal: false,
      providerIssueDistribution: { DART_STALE: 3, KIS_SUPPLY_EMPTY: 1 },
    });
    expect(bundle.providerHealth?.providerIssue).toBe(true);
    expect(bundle.providerHealth?.marketSignal).toBe(false);
    expect(bundle.providerHealth?.topProviderIssue).toBe('DART_STALE');
  });

  // 불변식 #6: providerIssue 가 있어도 marketSignal 은 격리되어 bearish 로 승격되지 않는다.
  // snapshotBundle 은 정본 marketSignal 을 그대로 투영할 뿐 providerIssue 로부터 재구성하지 않는다.
  it('does not derive marketSignal from providerIssue (invariant #6 isolation preserved in projection)', () => {
    const bundle = buildSnapshotBundleFromScanSummary({
      snapshotId: 'scan-eval-isolation',
      time: '2026-06-03T09:00:00.000Z',
      candidates: 0,
      providerIssue: true,
      // 정본이 marketSignal=false 로 격리 → 투영도 false (provider 장애 ≠ market signal).
      marketSignal: false,
    });
    expect(bundle.providerHealth?.providerIssue).toBe(true);
    expect(bundle.providerHealth?.marketSignal).toBe(false);
  });

  // 정본에 provider 필드가 전부 부재하면 graceful default(false/none) — 렌더가 죽지 않음(불변식 #1).
  it('defaults providerHealth gracefully when canonical provider fields absent', () => {
    const bundle = buildSnapshotBundleFromScanSummary({
      snapshotId: 'scan-eval-noprovider',
      time: '2026-06-03T09:00:00.000Z',
      candidates: 3,
    });
    expect(bundle.providerHealth?.providerIssue).toBe(false);
    expect(bundle.providerHealth?.marketSignal).toBe(false);
    expect(bundle.providerHealth?.topProviderIssue).toBe('none');
  });

  it('buildSnapshotBundleFromScanSummary projects gate2 from candidateGateAggregate (View), not undefined', () => {
    const bundle = buildSnapshotBundleFromScanSummary({
      snapshotId: 'scan-eval-gate2view',
      time: '2026-05-25T09:00:00.000Z',
      candidates: 5,
      candidateGateAggregate: {
        evaluatedCount: { scope: 'ALL_CANDIDATES', value: 5 },
        gate2PassStrongCount: { scope: 'GATE2_COVERAGE_SAMPLE', value: 1 },
        gate2PassWeakCount: { scope: 'GATE2_COVERAGE_SAMPLE', value: 2 },
        gate2WatchCount: { scope: 'GATE2_COVERAGE_SAMPLE', value: 1 },
        gate2FailCount: { scope: 'GATE2_COVERAGE_SAMPLE', value: 1 },
        gate2DataIncompleteCount: { scope: 'GATE2_COVERAGE_SAMPLE', value: 0 },
      },
    });
    expect(bundle.gate2?.passStrong).toBe(1);
    expect(bundle.gate2?.passWeak).toBe(2);
    expect(bundle.gate2?.fail).toBe(1);
  });
});
