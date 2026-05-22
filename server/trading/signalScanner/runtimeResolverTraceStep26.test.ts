import { describe, expect, it } from 'vitest';
import { formatRuntimeResolverTraceStep26, STEP26_RUNTIME_PATCH_VERSION } from './runtimeResolverTraceStep26.js';
import type { ScanSummary } from './scanDiagnostics/scanSummaryTypes.js';

function makeSummary(): ScanSummary {
  return {
    time: '2026-05-21T16:50:00.000+09:00',
    snapshotId: 'scan_step26',
    candidates: 43,
    trackB: 0,
    swing: 0,
    catalyst: 0,
    momentum: 0,
    yahooFails: 0,
    gateMisses: 0,
    rrrMisses: 0,
    entries: 0,
    gate1MinimumSignalForensicAdr0505: {
      totalCandidates: 43,
      failedCandidates: 37,
      requiredScoreAvg: 70,
      actualScoreAvg: 45,
      avgScoreGap: 25,
      dominantFailureDistribution: {} as never,
      missingPositiveSourceCounts: {
        watchlistUpstreamMissing: 0,
        relativeStrengthMissing: 0,
        breakoutStructureMissing: 0,
        priceMomentumMissing: 12,
        technicalTrendMissing: 0,
        volumeLiquidityMissing: 0,
      },
      penaltyCounts: {
        supplyUnknownPenalty: 0,
        investorFlowUnknownPenalty: 0,
        sectorEnergyPenaltyOrBlocked: 0,
        unknownDataPenalty: 0,
        softFailPenalty: 0,
        riskPenalty: 0,
      },
      rawInvestorRowAvailableCount: 31,
      kisNormalizedRowsMaterialized: 31,
      kisSemanticRowsMaterialized: 31,
      semanticRowAvailableCount: 31,
      foreignNetBuyAvailable: 31,
      institutionalNetBuyAvailable: 31,
      selectedCandidateCarriesSemanticRowCount: 31,
      selectedCandidateCarriesActualRowCount: 31,
      selectedProviderActualRowCount: 31,
      diagnosticActualInvestorRowCarriedCount: 31,
      actualInvestorRowUseScopeDistribution: {
        GATE_SCORE_ELIGIBLE: 31,
        DIAGNOSTIC_ONLY: 0,
      },
      watchlistScoreImportedCount: 11,
      adr0467WatchlistVerifiedCount: 11,
      adr0505WatchlistImportedCount: 11,
      watchlistScoreAvg: 8.8,
      quoteFeatureFieldCoverage: {
        return20d: 31,
        return5d: 31,
        relativeReturn20d: 31,
        marketRelativeReturn: 31,
      },
    } as unknown as ScanSummary['gate1MinimumSignalForensicAdr0505'],
    scoreCeilingRepair: {
      watchlistScoreVerified: 11,
      watchlistScoreMissing: 0,
      watchlistScoreImports: Array.from({ length: 11 }, (_, index) => ({
        symbol: `00${index}`,
        importedScore: 8.8,
        maxImportScore: 10,
        importApplied: true,
        importMode: 'SCORE_BASED',
        executionImpact: 'NONE',
      })),
    } as ScanSummary['scoreCeilingRepair'],
    penaltyDeduplication: {
      providerIssuePenaltyAvg: 24.5,
      unknownPenaltyAvg: 24.5,
    } as ScanSummary['penaltyDeduplication'],
    investorFlowProviderRouter: {
      selectedProvider: 'KIS_API',
      providerStatuses: {
        KIS_API: 'VERIFIED',
      },
      status: 'VERIFIED',
      materialized: true,
      normalizedRowAvailable: true,
      semanticRowAvailable: true,
      actualInvestorFlowRowCount: 31,
      gateSemanticFlatRow: {
        foreignNetBuy: 1,
        institutionNetBuy: 1,
        programNetBuy: 0,
        _source: 'ROUTER_EXTRACTED',
      },
      freshness: {
        sourceAgeTradingDays: 0,
        cacheState: 'FRESH',
        sourceState: 'FRESH',
        oldestSourceAgeTradingDays: 0,
        lastSourceDate: '20260521',
      },
      kisSelectedCandidateCarriesSemanticRow: true,
    } as unknown as ScanSummary['investorFlowProviderRouter'],
    sectorEnergySupplyUnknownAdr0488: {
      supplyUnknownPolicy: {
        unknownPolicyActive: false,
        marketSignal: false,
      },
    } as ScanSummary['sectorEnergySupplyUnknownAdr0488'],
  };
}

describe('runtimeResolverTraceStep26', () => {
  it('prints mandatory runtime resolver trace modules as called', () => {
    const output = formatRuntimeResolverTraceStep26(makeSummary());
    expect(output).toContain('[Runtime Resolver Trace]');
    expect(output).toContain(`patchVersion=${STEP26_RUNTIME_PATCH_VERSION}`);
    expect(output).toContain('scanDiagnosticsCore.persistScanResults');
    expect(output).toContain('buildGateScoreInputSnapshot');
    expect(output).toContain('watchlistScoreResolver');
    expect(output).not.toContain('called=false');
    expect(output).not.toContain('legacyPathUsed=true');
  });

  it('decomposes KIS router eligibility without opaque NOT_ROUTER_USABLE', () => {
    const output = formatRuntimeResolverTraceStep26(makeSummary());
    expect(output).toContain('KIS Router Eligibility:');
    expect(output).toContain('- failedCriteria=[]');
    expect(output).toContain('- finalRouterUsable=true');
    expect(output).toContain('- finalGateScoreEligible=true');
    expect(output).toContain('- gateEligibleRows=31/43');
    expect(output).toContain('actualInvestorRowUseScope=GATE_SCORE_ELIGIBLE=31,SHADOW_ONLY_NEUTRAL_UNKNOWN=12');
    expect(output).not.toContain('actualInvestorRowUseScope=DIAGNOSTIC_ONLY=43');
    expect(output).not.toContain('NOT_ROUTER_USABLE');
  });

  it('reports ADR-0467 watchlist resolver aligned with ADR-0468 and momentum projection', () => {
    const output = formatRuntimeResolverTraceStep26(makeSummary());
    expect(output).toContain('ADR-0467 Watchlist Resolver:');
    expect(output).toContain('- verified=11');
    expect(output).toContain('- missing=0');
    expect(output).toContain('- avg=+8.8');
    expect(output).toContain('- comparedWithADR0468=true');
    expect(output).toContain('- conflict=false');
    expect(output).toContain('Momentum Projection:');
    expect(output).toContain('- projectedToGate1=true');
    expect(output).toContain('- PRICE_MOMENTUM computedCount=31');
  });

  it('isolates provider and unknown penalties as diagnostic-only for verified KIS', () => {
    const output = formatRuntimeResolverTraceStep26(makeSummary());
    expect(output).toContain('Provider Penalty Policy:');
    expect(output).toContain('- selectedProvider=KIS_API');
    expect(output).toContain('- selectedProviderStatus=VERIFIED');
    expect(output).toContain('- providerIssuePenaltyApplied=false');
    expect(output).toContain('- unknownPenaltyApplied=false');
    expect(output).toContain('- effectivePenaltyAvg=providerIssue 0.0 / unknown 0.0');
    expect(output).toContain('- SupplyUnknownPolicy marketSignal=false unknownPolicyActive=false');
  });

  it('prints KRX MDCSTAT02401 payload validation without name key', () => {
    const output = formatRuntimeResolverTraceStep26(makeSummary());
    expect(output).toContain('KRX Payload Validation:');
    expect(output).toContain('- endpoint=MDCSTAT02401');
    expect(output).toContain('- sentPayloadKeys=bld,endDd,inqVal,isuCd,strtDd');
    expect(output).toContain('- allowedKeys=bld,endDd,inqVal,isuCd,strtDd');
    expect(output).toContain('- forbiddenKeysPresent=NONE');
    expect(output).toContain('- payloadValidation=PASS');
  });
});
