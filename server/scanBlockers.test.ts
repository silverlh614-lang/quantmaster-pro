import { describe, expect, it } from 'vitest';
import {
  formatGateDiagPayloadCarryDebugSection,
  formatScanBlockersCompactMessage,
  resolveScanBlockersGateDiagCompactLookup,
  resolveScanBlockersTopReason,
} from './telegram/commands/system/scanBlockersCompactAdr0506.js';
import { buildGateDiagnosticCarrySummary } from './trading/signalScanner/scanDiagnostics/gateLayerDiagnostics.js';
import type { ScanSummary } from './trading/signalScanner/scanDiagnostics.js';

function baseSummary(overrides: Partial<ScanSummary> = {}): ScanSummary {
  return {
    time: '2026-05-20T12:30:00.000Z',
    candidates: 10,
    trackB: 10,
    swing: 0,
    catalyst: 0,
    momentum: 0,
    quoteFails: 0,
    gateMisses: 10,
    rrrMisses: 0,
    entries: 0,
    gatePassDistribution: { gate1Pass: 0, gate2Pass: 0, gate3Pass: 0, lastTriggerPass: 0 },
    ...overrides,
  };
}

describe('Patch-SCAN-BLOCKERS-GATEDIAG-CARRY-AND-TOPREASON-010', () => {
  it('builds ScanSummary gateDiagnostics carry payload from consolidated audit compact text', () => {
    const carry = buildGateDiagnosticCarrySummary({
      gate1PassCount: 0,
      gate2PassCount: 0,
      gate3PassCount: 0,
      strongBuySuppressedByDataUnavailableCount: 0,
      topGate1BlockReasons: [],
      topGate2BlockReasons: [],
      topGate3BlockReasons: [],
      gate1Survival: {
        samples: 1,
        quoteFreshness: {},
        quoteCoverageConfidence: {},
        liquidityStatus: {},
        marketSession: {},
        shadowMode: {},
        shadowExecutionImpact: {},
        consolidatedHealth: { LIVE_BLOCKED_ONLY: 1 },
        consolidatedPrimaryIssue: { LIVE_BUY_BLOCKED_BUT_SHADOW_ALLOWED: 1 },
        consolidatedOperatorAction: {},
        consolidatedExecutionImpact: {},
        consolidatedCompactText: { 'Gate1: LIVE_BLOCKED_ONLY | session=AFTERMARKET | shadow=ON': 1 },
        liveBuyBlockedCount: 1,
        shadowAllowedCount: 1,
      },
      gate2Coverage: {
        samples: 1,
        inputState: { DATA_INCOMPLETE: 1 },
        kisStatus: {},
        dartStatus: {},
        benchmarkStatus: {},
        programTradeStatus: {},
        sectorCycleStatus: {},
        leaderCyclePhase: {},
        primaryIssue: { DART_FINANCIALS_UNAVAILABLE: 1 },
        compactText: { 'Gate2: DATA_INCOMPLETE | issue=DART_FINANCIALS_UNAVAILABLE | marketSignal=false': 1 },
        kisFlowCompactText: {},
        dartCompactText: {},
        benchmarkCompactText: {},
        programTradeCompactText: {},
        sectorCycleCompactText: {},
        leaderCycleCompactText: {},
        providerIssueCount: 0,
      },
    });

    expect(carry).toMatchObject({
      gate1CompactText: 'gateStatus=DATA_INCOMPLETE | sessionAgnostic=true | inputs=UNKNOWN | quote=UNKNOWN | tradable=UNKNOWN | liquidity=UNKNOWN | technicalStatus=UNKNOWN | dataIssues=none',
      gate2CompactText: 'Gate2: DATA_INCOMPLETE | issue=DART_FINANCIALS_UNAVAILABLE | marketSignal=false',
      gate1Health: 'OK',
      gate2PrimaryIssue: 'DART_FINANCIALS_UNAVAILABLE',
      marketSignal: false,
      diagnosticOnly: true,
      source: 'consolidatedDiagnostic',
    });
  });

  it('prints Gate1/Gate2 compactText from fullDiagnostic/current gate diagnostics when basic summary lacks direct diagnostics', () => {
    const summary = baseSummary({
      gate1SurvivalDiagnostic: {
        compactText: 'Gate1: LIVE_BLOCKED_ONLY | inputs=OK | quote=VERIFIED | tradable=TRADABLE | liquidity=PASS | session=AFTERMARKET | shadow=ON',
      } as unknown as Record<string, unknown>,
      fullDiagnostic: {
        gateLayerSummary: {
          gate2: {
            consolidatedDiagnostic: {
              compactText: 'Gate2: DATA_INCOMPLETE | issue=DART_FINANCIALS_UNAVAILABLE | KIS=OK | DART=MISSING | BM=OK | supply=NEUTRAL | fin=UNAVAILABLE | RS=BEARISH | marketSignal=false',
            },
          },
        },
      },
    } as unknown as Partial<ScanSummary>);

    const text = formatScanBlockersCompactMessage(summary);

    expect(text).toContain('Gate1Diag: gateStatus=OK | sessionAgnostic=true');
    expect(text).toContain('PolicyDiag: LIVE_ALLOWED');
    expect(text).not.toContain('PolicyDiag: LIVE_BLOCKED_ONLY');
    expect(text).toContain('displaySession: REGULAR');
    expect(text).not.toContain('AFTERMARKET_SELL_ONLY');
    expect(text).toContain('Gate2Diag: Gate2: DATA_INCOMPLETE');
  });

  it('adds an explicit Gate3 fallback reason when compactText is not carried', () => {
    const summary = baseSummary();

    const text = formatScanBlockersCompactMessage(summary);

    expect(text).toContain('Gate3Diag: UNAVAILABLE | reason=GATE3_CONSOLIDATED_DIAGNOSTIC_NOT_CARRIED | fallback=true | marketSignal=false');
  });

  it('renders R6 SELL_ONLY Gate3 diagnostic fallback and does not throw when compact lookup misses', () => {
    const summary = baseSummary({
      emptyScanReason: 'MARKET_WEAK',
      macroGateState: {
        emergencyStop: false,
        autoTradeEnabled: true,
        regime: 'R2_BULL',
        macroRegimeRaw: 'R2_BULL',
        macroRegimeEffective: 'R6_DEFENSE',
        riskOverride: 'R6_DEFENSE',
        engineMode: 'SELL_ONLY',
        kellyMultiplierFromRegime: 0,
        fomcPhase: 'NONE',
        fomcKellyMultiplier: 1,
        finalKellyMultiplier: 0,
        vixGatingActive: false,
        bearDefenseMode: false,
        mhsBelow30: false,
        watchlistEmpty: false,
        sellOnlyMode: true,
        liveEntryAllowed: false,
        shadowLearningAllowed: true,
        counterfactualAllowed: true,
      },
      scanEvaluation: {
        scanId: 'scan-eval-test',
        asOf: '2026-05-20T12:30:00.000Z',
        evaluationState: 'NOT_EVALUATED_SELL_ONLY',
        marketSessionState: 'AFTERMARKET',
        engineMode: 'SELL_ONLY',
        effectiveRegime: 'R6_DEFENSE',
        totalCandidates: 10,
        evaluated: 10,
        skipped: 0,
        rejected: 10,
        survivors: 0,
        quoteHydrated: 10,
        quoteHydrationFailed: 0,
        blockReason: 'R6_DEFENSE_SELL_ONLY',
        breakPoint: 'PRE_FLIGHT_SELL_ONLY',
        sourcePath: 'test',
        executionImpact: 'NEW_BUY_BLOCKED_ONLY',
        shadowLearningAllowed: true,
      },
    });

    expect(() => formatScanBlockersCompactMessage(summary)).not.toThrow();
    expect(formatScanBlockersCompactMessage(summary)).toContain('Gate3Diag: UNAVAILABLE | reason=GATE3_CONSOLIDATED_DIAGNOSTIC_NOT_CARRIED | fallback=true | marketSignal=false');
    expect(formatScanBlockersCompactMessage(summary)).toContain('Legacy defense policy input detected - executionImpact=NONE');
    expect(formatScanBlockersCompactMessage(summary)).toContain('removedPolicy: LEGACY_DEFENSE_POLICY_REMOVED');
  });

  it('labels R6 SELL_ONLY compact summary as diagnostic-only without making Gate1 pass look live', () => {
    const summary = baseSummary({
      candidates: 16,
      gateMisses: 13,
      gatePassDistribution: { gate1Pass: 3, gate2Pass: 0, gate3Pass: 0, lastTriggerPass: 0 },
      rawScore: 7.5,
      gateScore: 7.5,
      signalType: 'SKIP',
      positionPct: 0,
      macroGateState: {
        emergencyStop: false,
        autoTradeEnabled: true,
        regime: 'R2_BULL',
        macroRegimeRaw: 'R2_BULL',
        macroRegimeEffective: 'R6_DEFENSE',
        riskOverride: 'R6_DEFENSE',
        engineMode: 'SELL_ONLY',
        kellyMultiplierFromRegime: 0,
        fomcPhase: 'NONE',
        fomcKellyMultiplier: 1,
        finalKellyMultiplier: 0,
        vixGatingActive: false,
        bearDefenseMode: false,
        mhsBelow30: false,
        watchlistEmpty: false,
        sellOnlyMode: true,
        liveEntryAllowed: false,
        shadowLearningAllowed: true,
        counterfactualAllowed: true,
      },
      scanEvaluation: {
        scanId: 'scan-eval-label-cleanup',
        asOf: '2026-05-20T12:30:00.000Z',
        evaluationState: 'NOT_EVALUATED_SELL_ONLY',
        marketSessionState: 'SELL_ONLY',
        engineMode: 'SELL_ONLY',
        effectiveRegime: 'R6_DEFENSE',
        totalCandidates: 16,
        evaluated: 16,
        skipped: 0,
        rejected: 13,
        survivors: 3,
        quoteHydrated: 16,
        quoteHydrationFailed: 0,
        blockReason: 'R6_DEFENSE_SELL_ONLY',
        breakPoint: 'PRE_FLIGHT_SELL_ONLY',
        sourcePath: 'test',
        executionImpact: 'NEW_BUY_BLOCKED_ONLY',
        shadowLearningAllowed: true,
      },
      gate1MinimumSignalForensicAdr0505: {
        totalCandidates: 16,
        failedCandidates: 13,
        evaluationState: 'NOT_EVALUATED_SELL_ONLY',
        requiredScoreAvg: 70,
        actualScoreAvg: 37,
        avgScoreGap: -33,
        dominantFailureDistribution: { MIXED: 2 },
        missingPositiveSourceCounts: {},
        penaltyCounts: { softFailPenalty: 1 },
        supplyScopeWarnings: {},
        executionImpact: 'NONE',
        liveExecutionAllowed: false,
        policyPromotionMode: 'SHADOW_ONLY',
      } as unknown as ScanSummary['gate1MinimumSignalForensicAdr0505'],
      gate1SurvivalDiagnostic: {
        compactText: 'Gate1: LIVE_BLOCKED_ONLY | inputs=OK | quote=VERIFIED | tradable=TRADABLE | liquidity=PASS | session=CLOSED | shadow=ON',
      } as unknown as Record<string, unknown>,
      gateDiagnostics: {
        gate1CompactText: 'Gate1: LIVE_BLOCKED_ONLY | inputs=OK | quote=VERIFIED | tradable=TRADABLE | liquidity=PASS | session=CLOSED | shadow=ON',
        gate2CompactText: 'Gate2: DATA_INCOMPLETE | issue=DART_FINANCIALS_UNAVAILABLE | marketSignal=false',
        gate3CompactText: 'Gate3: DIAGNOSTIC_ONLY | marketSignal=false',
        marketSignal: false,
        diagnosticOnly: true,
        source: 'consolidatedDiagnostic',
      },
    } as unknown as Partial<ScanSummary>);
    const before = {
      rawScore: (summary as unknown as Record<string, unknown>).rawScore,
      gateScore: (summary as unknown as Record<string, unknown>).gateScore,
      signalType: (summary as unknown as Record<string, unknown>).signalType,
      positionPct: (summary as unknown as Record<string, unknown>).positionPct,
    };

    const text = formatScanBlockersCompactMessage(summary);

    expect(text).toContain('session: CLOSED / REGULAR');
    expect(text).toContain('marketSession: CLOSED');
    expect(text).toContain('displaySession: REGULAR');
    expect(text).toContain('entryBlockMode: NORMAL');
    expect(text).toContain('Legacy defense policy input detected - executionImpact=NONE');
    expect(text).toContain('removedPolicy: LEGACY_DEFENSE_POLICY_REMOVED');
    expect(text).not.toContain('R6_DEFENSE_SELL_ONLY');
    expect(text).not.toContain('NOT_EVALUATED_SELL_ONLY');
    expect(text).not.toContain('PRE_FLIGHT_SELL_ONLY');
    expect(text).toContain('Gate1: 3/16');
    expect(text).toContain('MinScore: 37.0 / 70.0');
    expect(text).toContain('dominant: MIXED (2)');
    expect(text).toContain('penalty: softFailPenalty (1)');
    expect(text).toContain('Shadow: ON | learning=true | counterfactual=true | executionImpact=NONE');
    expect(text).toContain('Gate1Diag: gateStatus=OK | sessionAgnostic=true');
    expect(text).toContain('PolicyDiag: LIVE_ALLOWED');
    expect(text).not.toContain('PolicyDiag: LIVE_BLOCKED_ONLY');
    expect(text).toContain('Gate2Diag: Gate2: DATA_INCOMPLETE');
    expect(text).toContain('Gate3Diag: Gate3: DIAGNOSTIC_ONLY');
    expect({
      rawScore: (summary as unknown as Record<string, unknown>).rawScore,
      gateScore: (summary as unknown as Record<string, unknown>).gateScore,
      signalType: (summary as unknown as Record<string, unknown>).signalType,
      positionPct: (summary as unknown as Record<string, unknown>).positionPct,
    }).toEqual(before);
  });

  it('maps R6 live-entry blocks away from MARKET_WEAK', () => {
    const summary = baseSummary({
      emptyScanReason: 'MARKET_WEAK',
      macroGateState: {
        emergencyStop: false,
        autoTradeEnabled: true,
        regime: 'R2_BULL',
        macroRegimeRaw: 'R2_BULL',
        macroRegimeEffective: 'R6_DEFENSE',
        riskOverride: 'R6_DEFENSE',
        engineMode: 'SELL_ONLY',
        kellyMultiplierFromRegime: 0,
        fomcPhase: 'NONE',
        fomcKellyMultiplier: 1,
        finalKellyMultiplier: 0,
        vixGatingActive: false,
        bearDefenseMode: false,
        mhsBelow30: false,
        watchlistEmpty: false,
        sellOnlyMode: false,
        liveEntryAllowed: false,
      },
      scanEvaluation: {
        scanId: 'scan-eval-r6',
        asOf: '2026-05-20T12:30:00.000Z',
        evaluationState: 'NOT_EVALUATED_R6_LIVE_BLOCKED',
        marketSessionState: 'BUY_ALLOWED',
        engineMode: 'NORMAL',
        effectiveRegime: 'R6_DEFENSE',
        totalCandidates: 10,
        evaluated: 10,
        skipped: 0,
        rejected: 10,
        survivors: 0,
        quoteHydrated: 10,
        quoteHydrationFailed: 0,
        blockReason: 'R6_DEFENSE',
        breakPoint: 'REGIME_GUARD',
        sourcePath: 'test',
        executionImpact: 'NEW_BUY_BLOCKED_ONLY',
        shadowLearningAllowed: true,
      },
    });

    expect(resolveScanBlockersTopReason(summary)).toBe('MARKET_WEAK');
    expect(formatScanBlockersCompactMessage(summary)).toContain('topReason: MARKET_WEAK');
  });

  it('reports GateDiag Payload Carry source details for full mode debug', () => {
    const summary = baseSummary({
      gate1SurvivalDiagnostic: {
        compactText: 'Gate1: LIVE_BLOCKED_ONLY | quote=VERIFIED | shadow=ON',
        quoteCoverageConfidence: 'VERIFIED',
        missingFields: [],
        shadowMode: 'NORMAL_SHADOW',
      } as unknown as Record<string, unknown>,
      gateDiagnostics: {
        gate2CompactText: 'Gate2: DATA_INCOMPLETE',
        marketSignal: false,
        diagnosticOnly: true,
        source: 'consolidatedDiagnostic',
      },
    } as unknown as Partial<ScanSummary>);

    const lookup = resolveScanBlockersGateDiagCompactLookup(summary);
    const debug = formatGateDiagPayloadCarryDebugSection(summary);

    expect(lookup.gate1.source).toBe('summary.gate1SurvivalDiagnostic');
    expect(debug).toContain('gate1CompactCarried=true');
    expect(debug).toContain('gate2CompactSource=summary.gateDiagnostics');
    expect(debug).toContain('gate3CompactSource=fallback');
    expect(debug).toContain('selectedSource=summary.gate1SurvivalDiagnostic');
    expect(debug).toContain('quoteCoverageConfidence=VERIFIED');
    expect(debug).toContain('missingFields=none');
  });

  it('removes quote coverage degraded issue when missing is none and quote coverage is verified', () => {
    const summary = baseSummary({
      gateLayerSummary: {
        gate1: {
          consolidatedDiagnostic: {
            compactText: 'Gate1: DEGRADED | issue=QUOTE_COVERAGE_DEGRADED | missing=none | quote=VERIFIED | shadow=COUNTERFACTUAL_ONLY',
          },
        },
      },
      gate1SurvivalDiagnostic: {
        quoteCoverageConfidence: 'VERIFIED',
        missingFields: [],
        shadowMode: 'NORMAL_SHADOW',
      } as unknown as Record<string, unknown>,
      scanEvaluation: {
        gate1Pass: 3,
      } as unknown as ScanSummary['scanEvaluation'],
      macroGateState: ({
        shadowLearningAllowed: true,
        liveEntryBlockedReason: 'R6_DEFENSE_SELL_ONLY',
      } as unknown as ScanSummary['macroGateState']),
    } as unknown as Partial<ScanSummary>);

    const text = formatScanBlockersCompactMessage(summary);
    expect(text).not.toContain('issue=QUOTE_COVERAGE_DEGRADED');
    expect(text).toContain('shadow=ON');
  });

  it('prefers live blocked only label under sell-only closed session with shadow on', () => {
    const summary = baseSummary({
      gateLayerSummary: {
        gate1: {
          consolidatedDiagnostic: {
            compactText: 'Gate1: DEGRADED | inputs=OK | quote=VERIFIED | tradable=TRADABLE | liquidity=PASS | session=CLOSED | shadow=COUNTERFACTUAL_ONLY',
          },
        },
      },
      macroGateState: ({ shadowLearningAllowed: true } as unknown as ScanSummary['macroGateState']),
      gate1SurvivalDiagnostic: {
        quoteCoverageConfidence: 'VERIFIED',
        missingFields: [],
        shadowMode: 'NORMAL_SHADOW',
      } as unknown as Record<string, unknown>,
    } as unknown as Partial<ScanSummary>);

    const text = formatScanBlockersCompactMessage(summary);
    expect(text).toContain('Gate1Diag: Gate1: DEGRADED');
    expect(text).not.toContain('Gate1Diag: Gate1: LIVE_BLOCKED_ONLY');
    expect(text).not.toContain('shadow=COUNTERFACTUAL_ONLY');
  });


  it('keeps R6 live block in PolicyDiag instead of Gate1Diag', () => {
    const summary = baseSummary({
      gateLayerSummary: {
        gate1: {
          consolidatedDiagnostic: {
            compactText: 'Gate1: DEGRADED | missing=none | shadow=ON',
          },
        },
      },
      scanEvaluation: {
        entryBlockMode: 'R6_DEFENSE_SELL_ONLY',
        liveEvaluated: 0,
      } as unknown as ScanSummary['scanEvaluation'],
      gate1SurvivalDiagnostic: {
        quoteCoverageConfidence: 'VERIFIED',
        missingFields: [],
      } as unknown as Record<string, unknown>,
      gateDiagnostics: { marketSignal: false } as unknown as ScanSummary['gateDiagnostics'],
      macroGateState: ({ shadowLearningAllowed: true } as unknown as ScanSummary['macroGateState']),
    } as unknown as Partial<ScanSummary>);

    const text = formatScanBlockersCompactMessage(summary);
    expect(text).toContain('Gate1Diag: Gate1: DEGRADED');
    expect(text).not.toContain('Gate1Diag: Gate1: LIVE_BLOCKED_ONLY');
    expect(text).toContain('PolicyDiag: LIVE_ALLOWED');
    expect(text).toContain('legacyPolicyInputs=[LEGACY_DEFENSE_POLICY_REMOVED]');
    expect(text).not.toContain('R6_DEFENSE_SELL_ONLY');
  });

  it('keeps DEGRADED when missing includes currentPrice', () => {
    const summary = baseSummary({
      gateLayerSummary: {
        gate1: {
          consolidatedDiagnostic: {
            compactText: 'Gate1: DEGRADED | missing=currentPrice | shadow=ON',
          },
        },
      },
      gate1SurvivalDiagnostic: {
        quoteCoverageConfidence: 'VERIFIED',
        missingFields: ['currentPrice'],
      } as unknown as Record<string, unknown>,
      macroGateState: ({ shadowLearningAllowed: true } as unknown as ScanSummary['macroGateState']),
    } as unknown as Partial<ScanSummary>);

    const text = formatScanBlockersCompactMessage(summary);
    expect(text).toContain('Gate1Diag: Gate1: DEGRADED');
  });

  it('does not mutate score or execution decision fields while formatting', () => {
    const summary = baseSummary({
      rawScore: 7.5,
      gateScore: 7.5,
      signalType: 'SKIP',
      positionPct: 0,
    } as unknown as Partial<ScanSummary>);
    const before = {
      rawScore: (summary as unknown as Record<string, unknown>).rawScore,
      gateScore: (summary as unknown as Record<string, unknown>).gateScore,
      signalType: (summary as unknown as Record<string, unknown>).signalType,
      positionPct: (summary as unknown as Record<string, unknown>).positionPct,
    };

    formatScanBlockersCompactMessage(summary);

    expect({
      rawScore: (summary as unknown as Record<string, unknown>).rawScore,
      gateScore: (summary as unknown as Record<string, unknown>).gateScore,
      signalType: (summary as unknown as Record<string, unknown>).signalType,
      positionPct: (summary as unknown as Record<string, unknown>).positionPct,
    }).toEqual(before);
  });
});
