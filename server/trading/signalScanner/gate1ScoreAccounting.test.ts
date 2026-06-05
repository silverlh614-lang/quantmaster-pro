// @responsibility Gate1 score accounting diagnostic consistency regression tests.

import { describe, expect, it } from 'vitest';
import {
  buildGate1ScoreAccountingReport,
  formatGate1ScoreHealthSection,
} from './gate1ScoreAccounting.js';
import {
  buildPenaltyDeduplicationReport,
  formatPenaltyDeduplicationReport,
} from './gate1PenaltyDeduplication.js';
import type { PositiveScoreStarvationReport } from './gate1PositiveScoreStarvation.js';
import type { CanonicalRuntimeResolutionStep27 } from './runtimeResolverTraceStep26.js';
import type { ScanSummary } from './scanDiagnostics/scanSummaryTypes.js';

function positiveReport(): PositiveScoreStarvationReport {
  return {
    timestamp: '2026-05-29T07:56:00.000Z',
    forDate: '2026-05-29',
    regime: 'R3_EARLY',
    marketSession: 'POST_CLOSE',
    totalCandidates: 22,
    requiredScoreAvg: 70,
    actualScoreAvg: 53.5,
    grossPositiveScoreAvg: 31.9,
    totalPenaltyScoreAvg: 0,
    netScoreAvg: 31.9,
    positiveUtilizationAvg: 27.5,
    actualScoreMin: 35.5,
    actualScoreMax: 80.8,
    actualScoreRange: 45.3,
    actualScoreStdDev: 5,
    topPositiveContributors: [],
    zeroContributionComponents: [],
    missingPositiveComponents: [],
    verifiedZeroComponents: [],
    currentPathComponentStatus: [],
    scoreCeilingAudit: {
      requiredScoreAvg: 70,
      theoreticalMaxScore: 116,
      configuredPositiveMaxScore: 116,
      observedPositiveMaxScore: 60.8,
      observedNetMaxScore: 80.8,
      scoreCeilingBelowThreshold: false,
      requiredScoreReachable: true,
      message: 'test',
    },
    rangeCompressionReport: {
      totalCandidates: 22,
      actualScoreMin: 35.5,
      actualScoreMax: 80.8,
      actualScoreRange: 45.3,
      actualScoreStdDev: 5,
      grossPositiveScoreRange: 28.9,
      positiveScoreStdDev: 4,
      penaltyScoreRange: 0,
      compressed: false,
      compressionReason: [],
      suspectedCauses: ['SCORE_CEILING_TOO_LOW'],
    },
    wouldPassIfWatchlistScoreImported: 0,
    wouldPassIfPositiveFeaturesRestored: 0,
    wouldPassIfPenaltyNotAppliedBeforePositive: 0,
    wouldPassIfScoreCeilingFixed: 0,
    calibrationResults: [],
    recommendedAction: 'CHECK_SCORE_CEILING',
  };
}

function canonical(): CanonicalRuntimeResolutionStep27 {
  return {
    scanId: 'scan-20260529',
    sourceSnapshotId: 'snap-20260529',
    gateScoreInputSnapshotId: 'gateScoreInput:snap-20260529',
    kisInvestorFlow: {
      selectedProvider: 'KIS_API',
      selectedProviderStatus: 'VERIFIED',
      rawRows: 21,
      semanticRows: 21,
      totalRows: 22,
      finalRouterUsable: true,
      finalGateScoreEligible: true,
      gateEligibleRows: 21,
      shadowOnlyRows: 1,
      failedCriteria: [],
      providerIssue: false,
      marketSignal: false,
      apiPath: '/uapi/domestic-stock/v1/quotations/investor-trade-by-stock-daily',
      trId: 'FHPTJ04160001',
      traceBreakPoint: 'NONE',
      metadataCarryInvariant: 'OK',
    },
    watchlist: {
      verified: 21,
      missing: 0,
      avg: 8,
      selectedInputPath: 'gateScoreInputSnapshot.watchlist.watchlistScore',
      conflict: false,
    },
    momentum: {
      return5dCount: 22,
      return20dCount: 22,
      relativeReturn20dCount: 22,
      marketRelativeReturnCount: 22,
      priceMomentumComputedCount: 22,
      projectedToGate1: true,
    },
    breakout: {
      traceAvailable: 22,
      scoreComputed: 22,
      scoreMapped: 22,
      zeroByCondition: 0,
      missingByMapping: 0,
      waitFeatureMissing: 0,
      waitEntryPriceNotReached: 0,
    },
    providerPenalty: {
      providerIssuePenaltyApplied: false,
      unknownPenaltyApplied: false,
      penaltyScope: 'DIAGNOSTIC_ONLY',
      originalDiagnosticProviderPenaltyAvg: 23,
      effectiveProviderPenaltyAvg: 0,
      originalDiagnosticUnknownPenaltyAvg: 23,
      effectiveUnknownPenaltyAvg: 0,
    },
    sizing: {
      hardBlockCount: 0,
      advisoryCount: 0,
      finalKelly: 0.7,
    },
  };
}

describe('Gate1 score accounting diagnostic consistency', () => {
  it('separates final, raw positive, effective penalty, diagnostic penalty, and utilization scopes', () => {
    const penalty = {
      totalCandidates: 22,
      originalPenaltyAvg: 0,
      dedupedPenaltyAvg: 0,
      removedPenaltyAvg: 0,
      effectiveOriginalPenaltyAvg: 0,
      effectiveDedupedPenaltyAvg: 0,
      effectiveRemovedPenaltyAvg: 0,
      diagnosticOriginalPenaltyAvg: 23,
      diagnosticDedupedPenaltyAvg: 10,
      diagnosticRemovedPenaltyAvg: 13,
      effectiveGateScoreImpact: 0,
      diagnosticOnly: true,
      originalNetScoreAvg: 31.9,
      dedupedNetScoreAvg: 31.9,
      avgScoreDelta: 0,
      duplicateGroups: [{
        groupKey: 'SUPPLY_UNKNOWN',
        rootCause: 'SUPPLY_PROVIDER_UNKNOWN',
        affectedCount: 22,
        avgOriginalPenalty: 23,
        avgDedupedPenalty: 10,
        avgRemovedPenalty: 13,
        components: ['SUPPLY_CONFLUENCE', 'INVESTOR_FLOW', 'SOFT_FAIL_PENALTY'],
      }],
      providerIssuePenaltyAvg: 23,
      marketSignalPenaltyAvg: 0,
      unknownPenaltyAvg: 23,
      bearishPenaltyAvg: 0,
      survivorsAfterDedup: 0,
      survivorsAfterDedupAndPositiveRepair: 0,
      survivorExamples: [],
      scenarioResults: [],
      combinedCalibrationResults: [],
      riskPenaltyAudit: { signalRiskPenalty: 0, riskMultiplier: 1, doubleCountWarning: false },
      softFailPenaltyAudit: { symbol: 'AGG', softFailPenalty: 0, softFailSources: [], duplicateWithOtherPenalty: false },
      recommendedAction: 'DIAGNOSTIC_ONLY',
      executionImpact: 'NONE',
    } as const;
    const summary = {
      time: '2026-05-29T07:56:00.000Z',
      candidates: 22,
      entries: 0,
      trackB: 0,
      swing: 0,
      catalyst: 0,
      momentum: 0,
      yahooFails: 0,
      gateMisses: 21,
      rrrMisses: 0,
      positiveScoreStarvation: positiveReport(),
      penaltyDeduplication: penalty,
      gate2SoftLeadershipLane: {
        gate1HardSurvivors: 0,
        minSignalLivePass: 1,
        gate2PendingPreserved: 7,
        labels: [],
        shadowObservablePreserved: true,
        watchPreserved: true,
        counterfactualRecorded: true,
        executionImpact: 'NONE',
      },
      liveEligibleCount: 2,
      shadowObservableCount: 3,
      entryFilterDecomposition: {
        counterfactualRecorded: 22,
        gate1DecompositionReport: { gate1Passed: 7 },
      },
      candidateGate2Confluence: {
        results: [{
          gate1Status: 'FAIL_HARD',
          finalGate2: 'NOT_EVALUATED_DUE_TO_GATE1_FAIL',
          upstreamBlocker: 'GATE1_FAIL',
        }],
      },
    } as unknown as ScanSummary;

    const accounting = buildGate1ScoreAccountingReport({
      positive: summary.positiveScoreStarvation,
      penalty: summary.penaltyDeduplication,
      canonical: canonical(),
      summary,
    });
    expect(accounting?.finalGate1ScoreAvg).toBe(53.5);
    expect(accounting?.rawPositiveScoreAvg).toBe(31.9);
    expect(accounting?.effectivePenaltyScoreAvg).toBe(0);
    expect(accounting?.penalty.diagnosticRemovedPenaltyAvg).toBe(13);
    expect(accounting?.penalty.effectiveGateScoreImpact).toBe(0);
    expect(accounting?.utilizationByMaxPct).toBe(52.4);
    expect(accounting?.utilizationByAvgPct).toBe(27.5);
    expect(accounting?.scaleMismatch).toBe(true);
    expect(accounting?.scaleObservationMode).toBe('SCALE_OBSERVATION_ONLY');
    expect(accounting?.thresholdAutoChanged).toBe(false);
    expect(accounting?.operatorApprovalRequired).toBe(true);
    expect(accounting?.survivor.liveCandidateAfterGate1).toBe(1);
    expect(accounting?.survivor.diagnosticSurvivor).toBe(7);
    expect(accounting?.invariants.every((item) => item.status === 'OK')).toBe(true);

    const text = formatGate1ScoreHealthSection(summary, canonical()) ?? '';
    expect(text).toContain('finalScoreAvg=53.5 / required=70.0 / gap=-16.5');
    expect(text).toContain('diagnosticPenaltyAvg=23.0, diagnosticRemoved=13.0, gateScoreImpact=0.0');
    expect(text).toContain('utilizationByMax=52.4%');
    expect(text).toContain('scaleObservationMode=SCALE_OBSERVATION_ONLY');
    expect(text).toContain('thresholdAutoChanged=false');
    expect(text).toContain('operatorApprovalRequired=true');
    expect(text).toContain('scaleMismatch=true observationOnly=true');
    expect(text).toContain('[OK] GATE1_OBSERVATION_LEDGER_NON_EXECUTIONAL');
    expect(text).toContain('[OK] PENALTY_ACCOUNTING_CONSISTENCY');
    expect(text).toContain('[OK] GATE2_NOT_EVALUATED_WHEN_GATE1_FAIL');
  });

  it('reports the actual counterfactual ledger rows, not the entry-filter block-distribution count', () => {
    // Regression: Survivor Taxonomy printed counterfactualRecorded=0 (from the entry-filter block
    // distribution) while Candidate Pool / Entry Lane Split reported the 21 ledger rows actually created.
    // 0 is not nullish, so the old `decomposition?.counterfactualRecorded ?? laneCount` chain never reached
    // the lane count. The taxonomy must agree with the canonical entryLaneSplit.counterfactualCreated.
    const summary = {
      time: '2026-05-29T07:56:00.000Z',
      candidates: 21,
      entries: 0,
      positiveScoreStarvation: positiveReport(),
      gate2SoftLeadershipLane: {
        gate1HardSurvivors: 0,
        minSignalLivePass: 1,
        gate2PendingPreserved: 0,
        labels: [],
        shadowObservablePreserved: false,
        watchPreserved: false,
        counterfactualRecorded: false,
        executionImpact: 'NONE',
      },
      entryLaneSplit: {
        liveCandidates: 2,
        liveOrderCreated: 0,
        counterfactualCreated: 21,
      },
      entryFilterDecomposition: {
        counterfactualRecorded: 0,
        ledgerRowsCreated: 21,
        gate1DecompositionReport: { gate1Passed: 6 },
      },
    } as unknown as ScanSummary;

    const accounting = buildGate1ScoreAccountingReport({
      positive: summary.positiveScoreStarvation,
      summary,
    });
    expect(accounting?.survivor.counterfactualRecorded).toBe(21);
    expect(accounting?.invariants.every((item) => item.status === 'OK')).toBe(true);

    const text = formatGate1ScoreHealthSection(summary) ?? '';
    // P2 후속 (scanblockers-truth-consistency followup): entry-scope scope-prefix 라벨.
    expect(text).toContain('entryCounterfactualRecorded=21');
    // universe-scope(universeCounterfactualRowsCreated)와 혼동되는 bare 라벨은 출력되지 않는다.
    expect(text).not.toMatch(/(?<![A-Za-z])counterfactualRecorded=/);
  });

  it('keeps dry-run duplicate penalty removal out of effective penalty accounting', () => {
    const report = buildPenaltyDeduplicationReport({
      positiveStarvationReport: positiveReport(),
      timestamp: '2026-05-29T07:56:00.000Z',
      forDate: '2026-05-29',
      regime: 'R3_EARLY',
      marketSession: 'POST_CLOSE',
    });

    expect(report?.originalPenaltyAvg).toBe(0);
    expect(report?.removedPenaltyAvg).toBe(0);
    expect(report?.effectiveOriginalPenaltyAvg).toBe(0);
    expect(report?.effectiveRemovedPenaltyAvg).toBe(0);
    expect(report?.diagnosticOriginalPenaltyAvg).toBe(23);
    expect(report?.diagnosticRemovedPenaltyAvg).toBe(13);
    expect(report?.diagnosticOnly).toBe(true);
    expect(report?.recommendedAction).toBe('DIAGNOSTIC_ONLY');

    const text = formatPenaltyDeduplicationReport(report, canonical()) ?? '';
    expect(text).toContain('effectiveOriginalPenaltyAvg: 0.0');
    expect(text).toContain('effectiveRemovedPenaltyAvg: 0.0');
    expect(text).toContain('diagnosticOriginalPenaltyAvg: 23.0');
    expect(text).toContain('diagnosticRemovedPenaltyAvg: 13.0');
    expect(text).toContain('scope: DIAGNOSTIC_SIMULATION');
    expect(text).toContain('effectiveGateScoreImpact: 0.0');
  });
});

describe('LEGACY_R6_NOT_USED_FOR_DECISION invariant — genuine raw R6 정정 (2026-06-05)', () => {
  function legacyR6Status(macroGateState: Record<string, unknown>): string | undefined {
    const summary = {
      time: '2026-06-05T10:00:00.000Z',
      candidates: 22,
      entries: 0,
      positiveScoreStarvation: positiveReport(),
      macroGateState,
    } as unknown as ScanSummary;
    const accounting = buildGate1ScoreAccountingReport({
      positive: summary.positiveScoreStarvation,
      summary,
    });
    return accounting?.invariants.find((i) => i.code === 'LEGACY_R6_NOT_USED_FOR_DECISION')?.status;
  }

  it('genuine raw=R6 (raw=effective=R6 실제 방어장) 는 통과한다 — 직전 false-positive FAIL 제거', () => {
    expect(legacyR6Status({
      macroRegimeRaw: 'R6_DEFENSE',
      macroRegimeEffective: 'R6_DEFENSE',
      regime: 'R6_DEFENSE',
      displayRegime: 'SHADOW_ONLY',
      riskOverride: 'SHADOW_ONLY',
    })).toBe('OK');
  });

  it('stale R6 누출 (raw=R4 인데 effective=R6 + regime/display 표면에 R6) 은 FAIL', () => {
    expect(legacyR6Status({
      macroRegimeRaw: 'R4_NEUTRAL',
      macroRegimeEffective: 'R6_DEFENSE',
      regime: 'R6_DEFENSE',
      displayRegime: 'R6_DEFENSE',
    })).toBe('FAIL');
  });

  it('stale R6 가 raw 로 정상 복귀 (raw=R4, effective=R6, regime/display 비-R6) 면 통과', () => {
    expect(legacyR6Status({
      macroRegimeRaw: 'R4_NEUTRAL',
      macroRegimeEffective: 'R6_DEFENSE',
      regime: 'R4_NEUTRAL',
      displayRegime: 'SHADOW_ONLY',
    })).toBe('OK');
  });

  it('R6 미존재 → 통과', () => {
    expect(legacyR6Status({
      macroRegimeRaw: 'R4_NEUTRAL',
      macroRegimeEffective: 'R4_NEUTRAL',
      regime: 'R4_NEUTRAL',
      displayRegime: 'R4_NEUTRAL',
    })).toBe('OK');
  });
});
