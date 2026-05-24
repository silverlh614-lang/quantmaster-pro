import { beforeEach, describe, expect, it, vi } from 'vitest';
import { buildGate3CandidateDetail, groupGate3CandidateDetails, withGate3ShadowPolicy } from '../../../quant/gate3CandidateDetail.js';
import { buildGate3ShadowPolicy, summarizeGate3ShadowPolicies } from '../../../quant/gate3ShadowPolicy.js';
import { buildGate3OutcomeSeeds, summarizeGate3OutcomeSeeds } from '../../../quant/gate3OutcomeSeed.js';
import { buildGate3EvidenceScore } from '../../../quant/gate3EvidenceScore.js';
import { buildGate3EvidenceWarmupStatus } from '../../../quant/gate3EvidenceWarmup.js';
import { buildGate3CompletionScore } from '../../../quant/gate3CompletionScore.js';
import { buildLiveReadinessScore } from '../../../quant/liveReadinessScore.js';

let mockSummary: any;

vi.mock('../../commandRegistry.js', async () => {
  const actual = await vi.importActual<typeof import('../../commandRegistry.js')>('../../commandRegistry.js');
  return actual;
});

vi.mock('../../../trading/signalScanner/scanDiagnostics.js', () => ({
  getLastScanSummary: () => mockSummary,
}));

vi.mock('../../../trading/gate2/gate2ExternalCache.js', () => ({
  loadGate2ExternalCache: () => ({
    version: 1,
    updatedAt: '2026-05-24T09:00:00.000Z',
    records: [],
  }),
}));

describe('/scan_blockers_gate3 command', () => {
  beforeEach(async () => {
    vi.resetModules();
    const rawCandidateDetails = [
      buildGate3CandidateDetail({
        symbol: '204320',
        name: 'HL Mando',
        sourceSnapshotId: 'scan-eval:test',
        asOf: '2026-05-24T09:00:00.000Z',
        consolidatedDiagnostic: {
          timingReadiness: 'READY',
          falseBreakoutRisk: 'LOW',
          executionImpact: 'NONE',
          entryPriceGuard: { priceFreshness: 'VERIFIED' },
          rrrCheck: { rrr: 2.31, status: 'PASS', source: 'FALLBACK_PERCENT', entryPrice: 10_000, stopLoss: 9_300, targetPrice: 11_500 },
          lastTrigger: {
            status: 'FIRED',
            fired: true,
            liveBuyAllowed: false,
            shadowObservableAllowed: true,
            counterfactualAllowed: true,
            executionImpact: 'NONE',
            priceConfirmation: { status: 'BREAKOUT_CONFIRMED' },
            volumeConfirmationDetail: { status: 'CONFIRMED', volumeRatio20d: 1.8 },
          },
        },
      }),
    ];
    const shadowPolicies = rawCandidateDetails.map(detail => buildGate3ShadowPolicy(detail, {
      engineMode: 'SHADOW_ONLY',
      livePolicyAllowed: false,
    }));
    const candidateDetails = rawCandidateDetails.map((detail, index) =>
      withGate3ShadowPolicy(detail, shadowPolicies[index]),
    );
    const outcomeSeeds = buildGate3OutcomeSeeds(candidateDetails, shadowPolicies, {
      tradeDate: '2026-05-24',
      asOf: '2026-05-24T09:00:00.000Z',
    });
    const outcomeTracking = summarizeGate3OutcomeSeeds(outcomeSeeds, {
      tradeDate: '2026-05-24',
      seedCreatedToday: outcomeSeeds.length,
    });
    const thresholdEvidence = buildGate3EvidenceScore(outcomeSeeds);
    mockSummary = {
      sourceSnapshotId: 'scan-eval:test',
      entryFilterDecomposition: {
        candidateTraces: [
          {
            symbol: '204320',
            name: 'HL Mando',
            gate1Passed: true,
            gate2Status: 'GATE2_PASS_STRONG',
            currentPrice: 10_000,
            high20d: 9_900,
            volume: 2_000_000,
            avgVolume20d: 1_000_000,
            rsi14: 58,
            macdHistogram: 0.2,
            priceFreshness: 'VERIFIED',
            entryPriceAgeSec: 20,
            stopLoss: 9_300,
            targetPrice: 11_500,
            falseBreakoutRisk: 'LOW',
          },
        ],
      },
      gateLayerAudit: {
        gate1PassCount: 3,
        gate2PassCount: 2,
        gate3PassCount: 1,
        strongBuySuppressedByDataUnavailableCount: 0,
        topGate1BlockReasons: [],
        topGate2BlockReasons: [],
        topGate3BlockReasons: [],
        gate3Consolidated: {
          samples: 2,
          health: { TIMING_NOT_CONFIRMED: 1, OK: 1 },
          primaryIssue: { RRR_BELOW_2_0: 1, none: 1 },
          compactText: {
            'Gate3: WAIT | issue=RRR_FAIL | priceFresh=VERIFIED | rrr=1.20 FAIL | rrrSource=FALLBACK_PERCENT | price=NOT_CONFIRMED | volume=WEAK 0.80x | falseBreakout=LOW | executionImpact=NONE | marketSignal=false': 1,
          },
          timingReadiness: { WAIT: 1, READY: 1 },
          lastTriggerStatus: { THRESHOLD_NOT_MET: 1, FIRED: 1 },
          priceFreshness: { VERIFIED: 2 },
          executionImpact: { NONE: 2 },
          priceConfirmationStatus: { BREAKOUT_CONFIRMED: 1, NOT_CONFIRMED: 1 },
          volumeConfirmationStatus: { CONFIRMED: 1, WEAK: 1 },
          lastTriggerPassCount: 1,
          lastTriggerFiredCount: 1,
          lastTriggerWaitCount: 1,
          lastTriggerThresholdNotMetCount: 1,
          lastTriggerDataUnavailableCount: 0,
          entryPriceStaleCount: 0,
          priceBreakoutConfirmedCount: 1,
          priceNearBreakoutCount: 0,
          pricePullbackEntryCount: 0,
          priceNotConfirmedCount: 1,
          priceOverextendedCount: 0,
          volumeConfirmedCount: 1,
          volumePartialCount: 0,
          volumeDryUpCount: 0,
          volumeWeakCount: 1,
          volumeSpikeRiskCount: 0,
          rrrPassCount: 1,
          rrrWatchCount: 0,
          rrrFailCount: 1,
          rrrMissingCount: 0,
          rrrFallbackUsedCount: 1,
          falseBreakoutHighCount: 0,
          executionReadyCount: 1,
          candidateDetails,
          detailsByReadiness: groupGate3CandidateDetails(candidateDetails),
          shadowPolicies,
          shadowRouting: summarizeGate3ShadowPolicies(shadowPolicies),
          outcomeSeeds,
          outcomeTracking,
          thresholdEvidence,
          evidenceWarmup: buildGate3EvidenceWarmupStatus(outcomeSeeds, {
            now: new Date('2026-05-24T09:00:00.000Z'),
            outcomeTracking,
            thresholdEvidenceSampleSize: thresholdEvidence.sampleSize,
          }),
        },
      },
    };
    const gate3 = mockSummary.gateLayerAudit.gate3Consolidated;
    gate3.completionScore = buildGate3CompletionScore(gate3, { sourceSnapshotId: 'scan-eval:test' });
    gate3.liveReadinessScore = buildLiveReadinessScore({
      gate3Completion: gate3.completionScore,
      policy: { shadowOnlyMode: true, allowsLive: false },
    });
    const registry = await import('../../commandRegistry.js');
    registry.commandRegistry.__resetForTests();
  });

  it('registers aliases and replies with Gate3 timing readiness only', async () => {
    const registry = await import('../../commandRegistry.js');
    await import('./scanBlockersGate3.cmd.js');

    const command = registry.commandRegistry.resolve('/scan_blockers_gate3');
    expect(command).toBeDefined();
    expect(registry.commandRegistry.resolve('/gate3_timing')).toBe(command);
    expect(registry.commandRegistry.resolve('/blockers_gate3')).toBe(command);

    const replies: string[] = [];
    await command!.execute({
      args: ['full'],
      reply: async (message) => {
        replies.push(message);
      },
    });

    const text = replies.join('\n');
    expect(text).toContain('[scan_blockers_gate3] Gate3 Entry Timing / LastTrigger / Price & Volume Guard');
    expect(text).toContain('Gate3 Timing Readiness');
    expect(text).toContain('Gate3 Regression & LastTrigger Closure');
    expect(text).toContain('gate3Ready: 1');
    expect(text).toContain('rrrComputed: 1/1');
    expect(text).toContain('LastTrigger states: TRIGGERED:1');
    expect(text).toContain('livePermissionNotEvaluatedHere=true');
    expect(text).toContain('gate3Pass: 1');
    expect(text).toContain('lastTriggerPass: 1');
    expect(text).toContain('lastTriggerWait: 1');
    expect(text).toContain('lastTriggerThresholdNotMet: 1');
    expect(text).toContain('priceBreakoutConfirmed: 1');
    expect(text).toContain('volumeWeak: 1');
    expect(text).toContain('rrrPass: 1');
    expect(text).toContain('rrrFail: 1');
    expect(text).toContain('rrrMissing: 0');
    expect(text).toContain('rrrSource=FALLBACK_PERCENT');
    expect(text).toContain('price=NOT_CONFIRMED');
    expect(text).toContain('volume=WEAK 0.80x');
    expect(text).toContain('Gate3 Candidate Detail');
    expect(text).toContain('HL Mando(204320) READY');
    expect(text).toContain('Gate3 Shadow Entry Routing');
    expect(text).toContain('shadowEntryAllowed: 1');
    expect(text).toContain('livePolicyBlocked: 1');
    expect(text).toContain('Gate3 Outcome Tracking');
    expect(text).toContain('seedCreatedToday: 1');
    expect(text).toContain('READY: pending 1 / labeled 0');
    expect(text).toContain('Gate3 Evidence Warm-up');
    expect(text).toContain('schedulerHealthy: true');
    expect(text).toContain('Gate3 Threshold Evidence');
    expect(text).toContain('sampleSize: 0');
    expect(text).toContain('applyMode=SUGGEST_ONLY');
    expect(text).toContain('Gate3 Finalization');
    expect(text).toContain('completionStatus: BROKEN');
    expect(text).toContain('Gate3 LiveReadiness Contribution');
    expect(text).toContain('route=SHADOW_ENTRY_ALLOWED');
    expect(text).toContain('label=GATE3_READY_FIRED');
    expect(text).toContain('marketSignal=false');
    expect(text).toContain('no scan execution');
  }, 15000);
});
