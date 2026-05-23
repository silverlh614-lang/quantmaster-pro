import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { formatPositiveScoreStarvationReport } from './gate1PositiveScoreStarvation.js';
import { formatPenaltyDeduplicationReport } from './gate1PenaltyDeduplication.js';
import { formatInvestorFlowProviderRouterAdr0477 } from './investorFlowProviderRouterAdr0477.js';
import {
  buildCanonicalRuntimeResolutionStep27,
  formatGatePositiveRuntimeAlignmentSection,
  rebindGate1ForensicSummaryToCanonicalStep27,
  rebindGate1ScoringAlignmentReportToCanonicalStep27,
  rebindPositiveScoreStarvationReportToCanonicalStep27,
} from './runtimeResolverTraceStep26.js';
import type { ScanSummary } from './scanDiagnostics/scanSummaryTypes.js';

function makeConflictingSummary(): ScanSummary {
  return {
    time: '2026-05-21T22:30:00.000+09:00',
    snapshotId: 'scan_step27',
    candidates: 43,
    trackB: 0,
    swing: 0,
    catalyst: 0,
    momentum: 0,
    yahooFails: 0,
    gateMisses: 0,
    rrrMisses: 0,
    entries: 0,
    waitDistribution: {
      dataHold: 0,
      preBreakout: 0,
      gateFail: 0,
      sizingBlocked: 1,
      driftRemove: 0,
      corpAction: 0,
      volumeDrop: 0,
      other: 0,
    },
    gate1MinimumSignalForensicAdr0505: {
      totalCandidates: 43,
      rawInvestorRowAvailableCount: 31,
      kisNormalizedRowsMaterialized: 31,
      kisSemanticRowsMaterialized: 31,
      semanticRowAvailableCount: 31,
      foreignNetBuyAvailable: 31,
      institutionalNetBuyAvailable: 31,
      selectedCandidateCarriesActualRowCount: 31,
      selectedProviderActualRowCount: 0,
      diagnosticActualInvestorRowCarriedCount: 43,
      actualInvestorRowUseScopeDistribution: {
        DIAGNOSTIC_ONLY: 43,
      },
      scoreUsageDistribution: {
        SHADOW_ONLY: 43,
      },
      watchlistScoreImportedCount: 0,
      adr0467WatchlistVerifiedCount: 0,
      adr0505WatchlistImportedCount: 0,
      watchlistScoreAvg: 0,
      topHydrationMissingFields: ['return20d', 'return5d', 'relativeReturn20d', 'marketRelativeReturn', 'supply'],
      quoteFeatureFieldCoverage: {},
    } as unknown as ScanSummary['gate1MinimumSignalForensicAdr0505'],
    scoreCeilingRepair: {
      watchlistScoreVerified: 42,
      watchlistScoreMissing: 0,
      watchlistScoreImports: Array.from({ length: 42 }, (_, index) => ({
        symbol: `S${index}`,
        importedScore: 8.1,
        maxImportScore: 10,
        importApplied: true,
        importMode: 'SCORE_BASED',
        executionImpact: 'NONE',
      })),
    } as ScanSummary['scoreCeilingRepair'],
    freshGate2Attribution: { total: 43 } as never,
    penaltyDeduplication: {
      providerIssuePenaltyAvg: 20,
      unknownPenaltyAvg: 20,
    } as ScanSummary['penaltyDeduplication'],
    investorFlowProviderRouter: {
      selectedProvider: 'KIS_API',
      providerStatuses: { KIS_API: 'VERIFIED' },
      status: 'VERIFIED',
      selectedReason: 'blockedReason=NOT_ROUTER_USABLE',
      materialized: true,
      normalizedRowAvailable: true,
      semanticRowAvailable: true,
      actualInvestorFlowRowCount: 31,
      gateSemanticFlatRow: {
        foreignNetBuy: 1,
        institutionNetBuy: 1,
      },
      freshness: {
        cacheState: 'FRESH',
        sourceState: 'FRESH',
        oldestSourceAgeTradingDays: 0,
        sourceAgeTradingDays: 0,
      },
    } as unknown as ScanSummary['investorFlowProviderRouter'],
    sectorEnergySupplyUnknownAdr0488: {
      supplyUnknownPolicy: {
        unknownPolicyActive: false,
        marketSignal: false,
      },
    } as ScanSummary['sectorEnergySupplyUnknownAdr0488'],
  };
}

describe('Step27 canonical runtime report rebinding', () => {
  it('keeps scan blocker Gate report sections wired to canonical runtime rebinding', () => {
    const source = fs.readFileSync(
      path.resolve(process.cwd(), 'server/trading/signalScanner/scanDiagnostics/scanBlockersFormatter.ts'),
      'utf8',
    );

    expect(source).toContain('buildCanonicalRuntimeResolutionStep27');
    expect(source).toContain('rebindGate1ForensicSummaryToCanonicalStep27');
    expect(source).toContain('rebindPositiveScoreStarvationReportToCanonicalStep27');
    expect(source).toContain('rebindGate1ScoreCeilingRepairReportToCanonicalStep27');
    expect(source).toContain('rebindGate1ScoringAlignmentReportToCanonicalStep27');
    expect(source).toContain('formatCanonicalRuntimeResolutionAdoptionSection(canonicalRuntimeResolution)');
    expect(source).toContain('formatGatePositiveRuntimeAlignmentSection(summary, canonicalRuntimeResolution)');
    expect(source).toContain('formatPenaltyDeduplicationReport(');
    expect(source).toContain('canonicalRuntimeResolution,');
  });

  it('builds one canonical truth for KIS, watchlist, momentum, penalty, and sizing', () => {
    const canonical = buildCanonicalRuntimeResolutionStep27(makeConflictingSummary());

    expect(canonical.kisInvestorFlow.finalRouterUsable).toBe(true);
    expect(canonical.kisInvestorFlow.finalGateScoreEligible).toBe(true);
    expect(canonical.kisInvestorFlow.gateEligibleRows).toBe(31);
    expect(canonical.kisInvestorFlow.shadowOnlyRows).toBe(12);
    expect(canonical.kisInvestorFlow.failedCriteria).toEqual([]);
    expect(canonical.watchlist).toMatchObject({ verified: 42, missing: 0, avg: 8.1, conflict: false });
    expect(canonical.momentum).toMatchObject({
      return5dCount: 43,
      return20dCount: 43,
      priceMomentumComputedCount: 43,
      projectedToGate1: true,
    });
    expect(canonical.providerPenalty).toMatchObject({
      providerIssuePenaltyApplied: false,
      unknownPenaltyApplied: false,
      effectiveProviderPenaltyAvg: 0,
      effectiveUnknownPenaltyAvg: 0,
    });
    expect(canonical.sizing).toMatchObject({ hardBlockCount: 0, advisoryCount: 1 });
  });

  it('rebinds forensic and ADR-0467 report payloads away from stale legacy fields', () => {
    const summary = makeConflictingSummary();
    const canonical = buildCanonicalRuntimeResolutionStep27(summary);
    const forensic = rebindGate1ForensicSummaryToCanonicalStep27(summary.gate1MinimumSignalForensicAdr0505, canonical);
    expect(forensic?.actualInvestorRowUseScopeDistribution?.GATE_SCORE_ELIGIBLE).toBe(31);
    expect(forensic?.actualInvestorRowUseScopeDistribution?.SHADOW_ONLY_NEUTRAL_UNKNOWN).toBe(12);
    expect(forensic?.topHydrationMissingFields).toEqual(['supply']);

    const report = rebindPositiveScoreStarvationReportToCanonicalStep27({
      totalCandidates: 43,
      requiredScoreAvg: 70,
      actualScoreAvg: 40,
      grossPositiveScoreAvg: 10,
      totalPenaltyScoreAvg: 20,
      netScoreAvg: 20,
      positiveUtilizationAvg: 10,
      actualScoreMin: 0,
      actualScoreMax: 40,
      actualScoreRange: 40,
      rangeCompressionReport: { compressed: true, suspectedCauses: ['WATCHLIST_SCORE_NOT_IMPORTED'] },
      topPositiveContributors: [],
      zeroContributionComponents: [],
      missingPositiveComponents: [{ code: 'WATCHLIST_UPSTREAM_SCORE', count: 11 }],
      currentPathComponentStatus: [
        { code: 'WATCHLIST_UPSTREAM_SCORE', verified: 0, missing: 11, avgContribution: 0 },
        { code: 'PRICE_MOMENTUM', verified: 0, missing: 43, avgContribution: 0 },
      ],
      scoreCeilingAudit: {
        configuredPositiveMaxScore: 100,
        observedPositiveMaxScore: 50,
        requiredScoreReachable: true,
        scoreCeilingBelowThreshold: false,
      },
      calibrationResults: [],
      recommendedAction: 'CHECK_FEATURE_WIRING',
    } as never, canonical);
    const text = formatPositiveScoreStarvationReport(report, canonical) ?? '';

    expect(text).toContain('WATCHLIST_UPSTREAM_SCORE: verified 42 / missing 0 / avg +8.1');
    expect(text).toContain('PRICE_MOMENTUM: computedCount 43');
    expect(text).not.toContain('WATCHLIST_SCORE_NOT_IMPORTED');
    expect(text).not.toContain('WATCHLIST_UPSTREAM_SCORE 11');
  });

  it('reports Gate positive runtime alignment from Gate1Trace raw values, not weighted score only', () => {
    const summary = {
      ...makeConflictingSummary(),
      candidates: 2,
      entryFilterDecomposition: {
        candidateTraces: [
          {
            symbol: 'A1',
            gate1Trace: {
              minSignalScoreTrace: {
                components: [
                  { code: 'PRICE_MOMENTUM', rawValue: { return5d: 5, return20d: 12 }, weightedScore: 4, confidence: 'VERIFIED' },
                  { code: 'RELATIVE_STRENGTH', rawValue: { relativeReturn20d: 8 }, weightedScore: 5, confidence: 'VERIFIED' },
                  { code: 'BREAKOUT_STRUCTURE', rawValue: { breakoutScore: 6 }, weightedScore: 6, confidence: 'VERIFIED' },
                ],
              },
            },
          },
          {
            symbol: 'A2',
            gate1Trace: {
              minSignalScoreTrace: {
                components: [
                  { code: 'PRICE_MOMENTUM', rawValue: { return5d: 1, return20d: 4 }, weightedScore: 1, confidence: 'VERIFIED' },
                  { code: 'RELATIVE_STRENGTH', rawValue: { relativeReturn20d: -2 }, weightedScore: 2, confidence: 'VERIFIED' },
                ],
              },
            },
          },
        ],
      },
    } as unknown as ScanSummary;
    const text = formatGatePositiveRuntimeAlignmentSection(summary, buildCanonicalRuntimeResolutionStep27(summary)) ?? '';

    expect(text).toContain('[Gate Positive Runtime Alignment]');
    expect(text).toContain('- quoteFeatureCoverageRaw:');
    expect(text).toContain('return5dRaw 0/2');
    expect(text).toContain('- gateTraceAppliedCoverage:');
    expect(text).toContain('priceMomentumAppliedCount 2/2');
    expect(text).toContain('watchlistAppliedCount 0/2');
    expect(text).toContain('coverageConflict=false');
    expect(text).toContain('conflictReason=NONE');
    expect(text).toContain('inputConnected 2/2');
    expect(text).toContain('rsRankPctComputed 2/2');
    expect(text).toContain('relativeStrengthScoreComputed 2/2');
    expect(text).toContain('missingByMappingSymbols A2:FEATURE_PACK_MISSING');
  });

  it('counts Gate2/Gate3 materialized runtime fields and treats stale R6 as deprecated-only display', () => {
    const summary = {
      ...makeConflictingSummary(),
      candidates: 2,
      macroGateState: {
        regime: 'R3_EARLY',
        macroRegimeEffective: 'R6_DEFENSE',
        displayRegime: 'SHADOW_ONLY',
      },
      entryFilterDecomposition: {
        candidateTraces: [
          {
            symbol: 'G1',
            gateLayerSummary: {
              gate2: { externalDataCoverage: { benchmark: { values: { stockReturn20d: 0.12, benchmarkReturn20d: 0.03, relativeReturn20d: 0.09 } } } },
              gate3: {
                externalDataCoverage: {
                  priceStructure: { values: { high5d: 105, high20d: 110 }, turtle: { status: 'PASS' }, breakout: { status: 'FAIL' } },
                  momentumIndicators: { values: { return5d: 0.04, return20d: 0.12 }, shortMomentum: { status: 'PASS' } },
                  volumeTiming: { breakoutVolume: { status: 'FAIL' }, vcp: { status: 'FAIL' } },
                },
              },
            },
          },
          {
            symbol: 'G2',
            gateLayerSummary: {
              gate2: { externalDataCoverage: { benchmark: { values: { stockReturn20d: 0.04, benchmarkReturn20d: 0.03, relativeReturn20d: 0.01 } } } },
              gate3: {
                externalDataCoverage: {
                  priceStructure: { values: { high5d: 101, high20d: 104 }, turtle: { status: 'FAIL' }, breakout: { status: 'FAIL' } },
                  momentumIndicators: { values: { return5d: 0.01, return20d: 0.04 }, shortMomentum: { status: 'FAIL' } },
                  volumeTiming: { breakoutVolume: { status: 'FAIL' }, vcp: { status: 'FAIL' } },
                },
              },
            },
          },
        ],
      },
    } as unknown as ScanSummary;
    const text = formatGatePositiveRuntimeAlignmentSection(summary, buildCanonicalRuntimeResolutionStep27(summary)) ?? '';

    expect(text).toContain('return5dRaw 2/2');
    expect(text).toContain('return20dRaw 2/2');
    expect(text).toContain('relativeReturn20dRaw 2/2');
    expect(text).toContain('marketRelativeReturnRaw 2/2');
    expect(text).toContain('high5dRaw 2/2');
    expect(text).toContain('high20dRaw 2/2');
    expect(text).toContain('priceMomentumAppliedCount 0/2');
    expect(text).toContain('rsRankPctComputed 2/2');
    expect(text).toContain('missingByMapping 0/2');
    expect(text).toContain('regimeDisplayConflict=false');
    expect(text).toContain('legacyPathUsed=false');
  });

  it('removes resolved watchlist from Gate1 scoring alignment missing components', () => {
    const summary = makeConflictingSummary();
    const canonical = buildCanonicalRuntimeResolutionStep27(summary);
    const report = rebindGate1ScoringAlignmentReportToCanonicalStep27({
      missingComponents: ['WATCHLIST_UPSTREAM_SCORE', 'BREAKOUT_STRUCTURE'],
      componentSetAligned: false,
    } as never, canonical);

    expect(report?.missingComponents).toEqual(['BREAKOUT_STRUCTURE']);
    expect(report?.componentSetAligned).toBe(false);
  });

  it('renders provider penalties and router selectedReason from canonical output', () => {
    const summary = makeConflictingSummary();
    const canonical = buildCanonicalRuntimeResolutionStep27(summary);
    const penalty = formatPenaltyDeduplicationReport({
      totalCandidates: 43,
      scenarioResults: [],
      duplicateGroups: [],
      originalPenaltyAvg: 20,
      dedupedPenaltyAvg: 20,
      removedPenaltyAvg: 0,
      originalNetScoreAvg: 40,
      dedupedNetScoreAvg: 40,
      avgScoreDelta: 0,
      providerIssuePenaltyAvg: 20,
      marketSignalPenaltyAvg: 0,
      unknownPenaltyAvg: 20,
      bearishPenaltyAvg: 0,
      riskPenaltyAudit: {
        signalRiskPenalty: 0,
        riskMultiplier: 1,
        doubleCountWarning: false,
      },
      survivorsAfterDedup: 0,
      survivorsAfterDedupAndPositiveRepair: 0,
      recommendedAction: 'OBSERVE',
    } as never, canonical) ?? '';
    expect(penalty).toContain('originalDiagnosticProviderPenaltyAvg: 20.0');
    expect(penalty).toContain('effectiveProviderPenaltyAvg: 0.0');
    expect(penalty).toContain('gateScoreImpact: 0.0');
    expect(penalty).not.toContain('providerIssuePenaltyAvg: 20.0');

    const router = formatInvestorFlowProviderRouterAdr0477({
      route: 'KIS_FIRST',
      selectedProvider: 'KIS_API',
      status: 'VERIFIED',
      signal: 'NEUTRAL',
      coverage: { available: 31, total: 43, notWired: 0 },
      freshness: { cacheState: 'FRESH', sourceState: 'FRESH', oldestSourceAgeTradingDays: 0 },
      selectedReason: 'blockedReason=NOT_ROUTER_USABLE',
      selectedDiagnosticProvider: 'KIS_API',
      selectedDiagnosticReason: 'KIS_API materialized=true usableForRouter=false blockedReason=NOT_ROUTER_USABLE',
      inputSources: ['KIS_API'],
      fallbackChain: [],
      rejectedProviders: ['KIS_API'],
      rejectedReasonByProvider: {
        KIS_API: 'KIS_API materialized=true usableForRouter=false blockedReason=NOT_ROUTER_USABLE',
      },
      providerStatuses: { KIS_API: 'VERIFIED' },
      providerTried: ['KIS_API'],
      providerReasons: {
        KIS_API: 'KIS_API materialized=true usableForRouter=false blockedReason=NOT_ROUTER_USABLE',
      },
      executionImpact: 'NONE',
      liveExecutionAllowed: false,
    } as never, canonical) ?? '';
    expect(router).toContain('- selectedReason: CANONICAL_ROUTER_USABLE');
    expect(router).toContain('replacedBy=canonicalRuntimeResolution.kisInvestorFlow');
    expect(router).not.toContain('NOT_ROUTER_USABLE');
  });
});
