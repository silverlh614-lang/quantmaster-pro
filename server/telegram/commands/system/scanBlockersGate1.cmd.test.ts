// @responsibility /scan_blockers_gate1 compact Gate1 survival / forensic command tests.
import { beforeEach, describe, expect, it, vi } from 'vitest';

let mockSummary: any;

vi.mock('../../commandRegistry.js', async () => {
  const actual = await vi.importActual<typeof import('../../commandRegistry.js')>('../../commandRegistry.js');
  return actual;
});

vi.mock('../../../trading/signalScanner/scanDiagnostics.js', () => ({
  getLastScanSummary: () => mockSummary,
}));

describe('/scan_blockers_gate1 command', () => {
  beforeEach(async () => {
    vi.resetModules();
    mockSummary = {
      time: '2026-05-24T09:00:00.000Z',
      snapshotId: 'scan-eval:gate1',
      candidates: 11,
      trackB: 0,
      swing: 0,
      catalyst: 0,
      momentum: 0,
      yahooFails: 0,
      gateMisses: 8,
      rrrMisses: 0,
      entries: 0,
      gatePassDistribution: { gate1Pass: 3, gate2Pass: 1, gate3Pass: 0, lastTriggerPass: 0 },
      gateLayerAudit: {
        gate1PassCount: 3,
        gate2PassCount: 1,
        gate3PassCount: 0,
        strongBuySuppressedByDataUnavailableCount: 0,
        topGate1BlockReasons: [{ reason: 'THRESHOLD_NOT_MET:min_signal', count: 8 }],
        topGate2BlockReasons: [],
        topGate3BlockReasons: [],
        gate1Survival: {
          samples: 11,
          quoteFreshness: { VERIFIED: 10, STALE: 1 },
          quoteCoverageConfidence: { VERIFIED: 11 },
          liquidityStatus: { PASS: 9, FAIL: 2 },
          marketSession: { REGULAR_OPEN: 11 },
          shadowMode: { COUNTERFACTUAL_ONLY: 8, SHADOW_ALLOWED: 3 },
          shadowExecutionImpact: { NONE: 11 },
          consolidatedHealth: { OK: 3, DEGRADED: 8 },
          consolidatedPrimaryIssue: { MIN_SIGNAL_BELOW_THRESHOLD: 8, none: 3 },
          consolidatedOperatorAction: { OBSERVE: 8, NONE: 3 },
          consolidatedExecutionImpact: { NONE: 11 },
          consolidatedCompactText: {
            'Gate1: DEGRADED | inputs=OK | quote=VERIFIED | liquidity=PASS | shadow=COUNTERFACTUAL_ONLY': 8,
          },
          liveBuyBlockedCount: 0,
          shadowAllowedCount: 11,
        },
      },
      gate1MinimumSignalForensicAdr0505: {
        totalCandidates: 11,
        evaluatedCandidateCount: 11,
        traceOnlyCandidateCount: 0,
        failedCandidates: 8,
        requiredScoreAvg: 70,
        actualScoreAvg: 54.2,
        avgScoreGap: -15.8,
        evaluationState: 'EVALUATED',
        dominantFailureDistribution: { POSITIVE_SCORE_STARVATION: 8 },
        missingPositiveSourceCounts: { relativeStrengthMissing: 5, breakoutStructureMissing: 3 },
        penaltyCounts: { supplyUnknownPenalty: 4 },
        supplyScopeWarnings: { KIS_FLOW_SEMANTIC_UNAVAILABLE: 4 },
        watchlistScoreImportedCount: 7,
        watchlistScoreNormalizedCount: 7,
        watchlistScoreScaleDistributionBefore: { '0~27': 5, '0~100': 2 },
        watchlistScoreScaleDistributionAfter: { '0~100': 7, missing: 4 },
        watchlistScoreScaleFixedCount: 5,
        watchlistScoreNormalizationBreakPoint: { SCALE_FIXED_TO_NORMALIZED_100: 5, SCALE_ALREADY_NORMALIZED_100: 2 },
        rsScoreUsableCount: 6,
        rsComputedFromReturn20dCount: 6,
        rsIndexFallbackUsedCount: 2,
        breakoutScoreUsableCount: 4,
        technicalProjectedCount: 9,
        technicalProjectionCoverage: { aboveMA20: 9, aboveMA60: 9, return5d: 9, return20d: 9 },
        maAlignmentPolicy: 'ADVISORY_DAMPENER',
        maAlignmentDampenerCount: 11,
        maAlignmentHardBlockCount: 1,
        technicalTrendDeathCount: 1,
        topGate1BlockReasonAfter: 'TECHNICAL_MA_ALIGNMENT_DAMPENER',
        supplyMissingNeutralizedCount: 2,
        supplyRowMissingLearningTagCount: 2,
        supplySemanticAvailable: 5,
        foreignNetBuyAvailable: 4,
        institutionalNetBuyAvailable: 3,
        executionImpact: 'NONE',
        liveExecutionAllowed: false,
      },
    };
    const registry = await import('../../commandRegistry.js');
    registry.commandRegistry.__resetForTests();
  });

  it('registers aliases and replies with Gate1 survival and minimum-signal diagnostics only', async () => {
    const registry = await import('../../commandRegistry.js');
    await import('./scanBlockersGate1.cmd.js');

    const command = registry.commandRegistry.resolve('/scan_blockers_gate1');
    expect(command).toBeDefined();
    expect(registry.commandRegistry.resolve('/gate1_survival')).toBe(command);
    expect(registry.commandRegistry.resolve('/gate1_min_signal')).toBe(command);

    const replies: string[] = [];
    await command!.execute({ args: [], reply: async message => { replies.push(message); } });
    const text = replies.join('\n');

    expect(text).toContain('[scan_blockers_gate1] Gate1 Survival / Minimum Signal Forensics');
    expect(text).toContain('Gate1 Survival / Minimum Signal');
    expect(text).toContain('evaluated: 11/11');
    expect(text).toContain('gate1Pass: 3');
    expect(text).toContain('topGate1BlockReason: THRESHOLD_NOT_MET:min_signal');
    expect(text).toContain('quoteFreshness: VERIFIED:10');
    expect(text).toContain('liquidityFloor: PASS:9');
    expect(text).toContain('forensicStatus=EMITTED');
    expect(text).toContain('evaluationState=EVALUATED');
    expect(text).toContain('dominantFailure=POSITIVE_SCORE_STARVATION');
    expect(text).toContain('missingPositiveTop=relativeStrengthMissing');
    expect(text).toContain('watchlistScoreScaleDistributionAfter=0~100:7');
    expect(text).toContain('Gate1 Runtime Calibration');
    expect(text).toContain('scoreNormalized: 7/11');
    expect(text).toContain('technicalProjected: 9/11');
    expect(text).toContain('rsUsable: 6/11');
    expect(text).toContain('maAlignmentPolicy: DAMPENER');
    expect(text).toContain('shadowLearning=true');
    expect(text).toContain('counterfactualRecorded=true');
    expect(text).toContain('providerIssue=false');
    expect(text).toContain('no scan execution');
    expect(text).toContain('no broker order');
  }, 15000);
});
