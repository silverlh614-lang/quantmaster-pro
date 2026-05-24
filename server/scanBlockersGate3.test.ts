import { describe, expect, it } from 'vitest';
import { formatScanBlockersGate3Section } from './telegram/commands/system/scanBlockersGate3.cmd.js';
import { buildGate3CandidateDetail, groupGate3CandidateDetails, withGate3ShadowPolicy } from './quant/gate3CandidateDetail.js';
import { buildGate3ShadowPolicy, summarizeGate3ShadowPolicies } from './quant/gate3ShadowPolicy.js';
import { buildGate3OutcomeSeeds, summarizeGate3OutcomeSeeds } from './quant/gate3OutcomeSeed.js';
import { buildGate3EvidenceScore } from './quant/gate3EvidenceScore.js';
import { buildGate3CompletionScore } from './quant/gate3CompletionScore.js';
import { buildLiveReadinessScore } from './quant/liveReadinessScore.js';
import { accumulateGateLayerSummary, buildGateLayerAuditSummary, createScanCounters } from './trading/signalScanner/scanDiagnostics.js';
import type { GateLayerSummary } from './quantFilter.js';

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

describe('scan_blockers_gate3 RRR counters', () => {
  it('separates rrrMissing from rrrFail and preserves safe-degrade labels', () => {
    const rawCandidateDetails = [
      buildGate3CandidateDetail({
        symbol: '204320',
        name: 'HL만도',
        sourceSnapshotId: 'scan-eval:test',
        asOf: '2026-05-24T09:00:00.000Z',
        consolidatedDiagnostic: {
          timingReadiness: 'WAIT',
          falseBreakoutRisk: 'LOW',
          executionImpact: 'DIAGNOSTIC_ONLY',
          entryPriceGuard: { priceFreshness: 'VERIFIED' },
          rrrCheck: { rrr: 1.72, status: 'WATCH', source: 'FALLBACK_PERCENT', entryPrice: 10_000, stopLoss: 9_300, targetPrice: 11_500 },
          lastTrigger: {
            status: 'THRESHOLD_NOT_MET',
            fired: false,
            liveBuyAllowed: false,
            shadowObservableAllowed: true,
            counterfactualAllowed: true,
            executionImpact: 'DIAGNOSTIC_ONLY',
            priceConfirmation: { status: 'NEAR_BREAKOUT' },
            volumeConfirmationDetail: { status: 'DRY_UP', volumeRatio20d: 0.42 },
          },
        },
      }),
    ];
    const shadowPolicies = rawCandidateDetails.map(detail => buildGate3ShadowPolicy(detail));
    const candidateDetails = rawCandidateDetails.map((detail, index) =>
      withGate3ShadowPolicy(detail, shadowPolicies[index]),
    );
    const outcomeSeeds = buildGate3OutcomeSeeds(candidateDetails, shadowPolicies, {
      tradeDate: '2026-05-24',
      asOf: '2026-05-24T09:00:00.000Z',
    });
    const text = formatScanBlockersGate3Section({
      gate1PassCount: 0,
      gate2PassCount: 0,
      gate3PassCount: 0,
      strongBuySuppressedByDataUnavailableCount: 0,
      topGate1BlockReasons: [],
      topGate2BlockReasons: [],
      topGate3BlockReasons: [],
      gate3Consolidated: {
        samples: 3,
        health: { DATA_INCOMPLETE: 1, TIMING_NOT_CONFIRMED: 2 },
        primaryIssue: { RRR_MISSING: 1, RRR_FAIL: 1, RRR_WATCH: 1 },
        compactText: {
          'Gate3: WAIT | issue=RRR_WATCH | priceFresh=VERIFIED | rrr=1.72 WATCH | rrrSource=FALLBACK_PERCENT | stopLoss=9300 | targetPrice=11500 | price=NEAR_BREAKOUT | volume=DRY_UP 0.42x | executionImpact=DIAGNOSTIC_ONLY | marketSignal=false': 1,
        },
        timingReadiness: { DATA_INCOMPLETE: 1, WAIT: 2 },
        lastTriggerStatus: { DATA_UNAVAILABLE: 1, THRESHOLD_NOT_MET: 2 },
        priceFreshness: { VERIFIED: 3 },
        executionImpact: { DIAGNOSTIC_ONLY: 3 },
        priceConfirmationStatus: { NEAR_BREAKOUT: 1, NOT_CONFIRMED: 2 },
        volumeConfirmationStatus: { DRY_UP: 1, WEAK: 2 },
        lastTriggerPassCount: 0,
        lastTriggerFiredCount: 0,
        lastTriggerWaitCount: 3,
        lastTriggerThresholdNotMetCount: 2,
        lastTriggerDataUnavailableCount: 1,
        entryPriceStaleCount: 0,
        priceBreakoutConfirmedCount: 0,
        priceNearBreakoutCount: 1,
        pricePullbackEntryCount: 0,
        priceNotConfirmedCount: 2,
        priceOverextendedCount: 0,
        volumeConfirmedCount: 0,
        volumePartialCount: 0,
        volumeDryUpCount: 1,
        volumeWeakCount: 2,
        volumeSpikeRiskCount: 0,
        rrrPassCount: 0,
        rrrWatchCount: 1,
        rrrFailCount: 1,
        rrrMissingCount: 1,
        rrrFallbackUsedCount: 1,
        falseBreakoutHighCount: 0,
        executionReadyCount: 0,
        candidateDetails,
        detailsByReadiness: groupGate3CandidateDetails(candidateDetails),
        shadowPolicies,
        shadowRouting: summarizeGate3ShadowPolicies(shadowPolicies),
        outcomeSeeds,
        outcomeTracking: summarizeGate3OutcomeSeeds(outcomeSeeds, {
          tradeDate: '2026-05-24',
          seedCreatedToday: outcomeSeeds.length,
        }),
        thresholdEvidence: buildGate3EvidenceScore(outcomeSeeds),
      },
    });

    expect(text).toContain('rrrWatch: 1');
    expect(text).toContain('rrrFail: 1');
    expect(text).toContain('rrrMissing: 1');
    expect(text).toContain('rrrFallbackUsed: 1');
    expect(text).toContain('rrrSource=FALLBACK_PERCENT');
    expect(text).toContain('price=NEAR_BREAKOUT');
    expect(text).toContain('volume=DRY_UP 0.42x');
    expect(text).toContain('priceNearBreakout: 1');
    expect(text).toContain('volumeDryUp: 1');
    expect(text).toContain('lastTriggerDataUnavailable: 1');
    expect(text).toContain('candidateDetails: 1');
    expect(text).toContain('shadowEntryAllowed: 0');
    expect(text).toContain('nearEntryTracking: 1');
    expect(text).toContain('watchlistUpgrade: 1');
    expect(text).toContain('outcomeSeedCreatedToday: 1');
    expect(text).toContain('outcomePending: 1');
    expect(text).toContain('thresholdEvidenceSampleSize: 0');
    expect(text).toContain('thresholdSuggestions: 0');
    expect(text).toContain('completionStatus: N/A');
    expect(text).toContain('marketSignal=false');
    expect(text).toContain('shadowLearning=true');
    expect(text).toContain('counterfactualRecorded=true');
  });

  it('keeps aggregate counters and candidate detail counters invariant', () => {
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
    const audit = buildGateLayerAuditSummary(counters, {
      sourceSnapshotId: 'scan-eval:invariant',
      asOf: '2026-05-24T09:00:00.000Z',
    });
    const gate3 = audit.gate3Consolidated!;

    expect(gate3.candidateDetails).toHaveLength(gate3.samples);
    expect(gate3.candidateDetails.filter(detail => detail.readiness === 'READY')).toHaveLength(gate3.timingReadiness.READY);
    expect(gate3.candidateDetails.filter(detail => detail.lastTriggerStatus === 'FIRED')).toHaveLength(gate3.lastTriggerPassCount);
    expect(gate3.candidateDetails.filter(detail => detail.rrr.status === 'FAIL')).toHaveLength(gate3.rrrFailCount);
    expect(gate3.candidateDetails.filter(detail => detail.rrr.status === 'MISSING')).toHaveLength(gate3.rrrMissingCount);
    expect(gate3.candidateDetails.filter(detail => detail.falseBreakoutRisk === 'HIGH')).toHaveLength(gate3.falseBreakoutHighCount);
    expect(gate3.candidateDetails.every(detail => detail.sourceSnapshotId === 'scan-eval:invariant')).toBe(true);
    expect(gate3.candidateDetails.every(detail => detail.marketSignal === false)).toBe(true);
    expect(gate3.shadowPolicies).toHaveLength(gate3.candidateDetails.length);
    expect(gate3.shadowPolicies.filter(policy => policy.route === 'SHADOW_ENTRY_ALLOWED')).toHaveLength(gate3.candidateDetails.filter(detail => detail.readiness === 'READY').length);
    expect(gate3.shadowPolicies.filter(policy => policy.route === 'NEAR_ENTRY_TRACKING')).toHaveLength(gate3.candidateDetails.filter(detail => detail.readiness === 'WAIT').length);
    expect(gate3.shadowPolicies.filter(policy => policy.route === 'COUNTERFACTUAL_ONLY')).toHaveLength(gate3.candidateDetails.filter(detail => detail.readiness === 'BLOCKED').length);
    expect(gate3.shadowPolicies.filter(policy => policy.route === 'DIAGNOSTIC_ONLY')).toHaveLength(gate3.candidateDetails.filter(detail => detail.readiness === 'DATA_INCOMPLETE').length);
    expect(gate3.shadowPolicies.every(policy => policy.sourceSnapshotId === 'scan-eval:invariant')).toBe(true);
    expect(gate3.shadowPolicies.every(policy => policy.counterfactualAllowed === true)).toBe(true);
    expect(gate3.candidateDetails.every(detail => detail.shadowPolicy?.marketSignal === false)).toBe(true);
    expect(gate3.outcomeSeeds).toHaveLength(gate3.candidateDetails.length);
    expect(gate3.outcomeSeeds.every(seed => seed.sourceSnapshotId === 'scan-eval:invariant')).toBe(true);
    expect(gate3.outcomeSeeds.every(seed => seed.marketSignal === false)).toBe(true);
    expect(gate3.thresholdEvidence?.sampleSize).toBe(0);
    expect(gate3.thresholdEvidence?.suggestions.every(item => item.applyMode === 'SUGGEST_ONLY')).toBe(true);
    expect(gate3.completionScore?.status).toBe('PARTIAL');
    expect(gate3.liveReadinessScore?.status).toBe('SHADOW_READY');
    expect(formatScanBlockersGate3Section(audit)).toContain('completionStatus: PARTIAL');
  });

  it('prints Gate3 finalization and LiveReadiness contribution when completion score is carried', () => {
    const rawCandidateDetails = [
      buildGate3CandidateDetail({
        symbol: '204320',
        sourceSnapshotId: 'scan-eval:final',
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
            liveBuyAllowed: true,
            shadowObservableAllowed: true,
            counterfactualAllowed: true,
            executionImpact: 'NONE',
            priceConfirmation: { status: 'BREAKOUT_CONFIRMED' },
            volumeConfirmationDetail: { status: 'CONFIRMED', volumeRatio20d: 1.8 },
          },
        },
      }),
    ];
    const shadowPolicies = rawCandidateDetails.map(detail => buildGate3ShadowPolicy(detail));
    const candidateDetails = rawCandidateDetails.map((detail, index) =>
      withGate3ShadowPolicy(detail, shadowPolicies[index]),
    );
    const outcomeSeeds = buildGate3OutcomeSeeds(candidateDetails, shadowPolicies, {
      tradeDate: '2026-05-24',
      asOf: '2026-05-24T09:00:00.000Z',
    }).map(seed => ({
      ...seed,
      outcomeStatus: 'LABELED' as const,
      outcomeLabel: 'GATE3_READY_FOLLOW_THROUGH' as const,
      forwardReturns: { ...seed.forwardReturns, d5: 3 },
      maxForwardReturnPct: 3,
      minForwardReturnPct: 1,
    }));
    const gate3Consolidated = {
      samples: 1,
      health: { OK: 1 },
      primaryIssue: { none: 1 },
      compactText: { 'Gate3: READY': 1 },
      timingReadiness: { READY: 1 },
      lastTriggerStatus: { FIRED: 1 },
      priceFreshness: { VERIFIED: 1 },
      executionImpact: { NONE: 1 },
      priceConfirmationStatus: { BREAKOUT_CONFIRMED: 1 },
      volumeConfirmationStatus: { CONFIRMED: 1 },
      lastTriggerPassCount: 1,
      lastTriggerFiredCount: 1,
      lastTriggerWaitCount: 0,
      lastTriggerThresholdNotMetCount: 0,
      lastTriggerDataUnavailableCount: 0,
      entryPriceStaleCount: 0,
      priceBreakoutConfirmedCount: 1,
      priceNearBreakoutCount: 0,
      pricePullbackEntryCount: 0,
      priceNotConfirmedCount: 0,
      priceOverextendedCount: 0,
      volumeConfirmedCount: 1,
      volumePartialCount: 0,
      volumeDryUpCount: 0,
      volumeWeakCount: 0,
      volumeSpikeRiskCount: 0,
      rrrPassCount: 1,
      rrrWatchCount: 0,
      rrrFailCount: 0,
      rrrMissingCount: 0,
      rrrFallbackUsedCount: 1,
      falseBreakoutHighCount: 0,
      executionReadyCount: 1,
      candidateDetails,
      detailsByReadiness: groupGate3CandidateDetails(candidateDetails),
      shadowPolicies,
      shadowRouting: summarizeGate3ShadowPolicies(shadowPolicies),
      outcomeSeeds,
      outcomeTracking: summarizeGate3OutcomeSeeds(outcomeSeeds, {
        tradeDate: '2026-05-24',
        seedCreatedToday: outcomeSeeds.length,
      }),
      thresholdEvidence: buildGate3EvidenceScore(outcomeSeeds),
    };
    const completionScore = buildGate3CompletionScore(gate3Consolidated, { sourceSnapshotId: 'scan-eval:final' });
    const liveReadinessScore = buildLiveReadinessScore({ gate3Completion: completionScore, policy: { shadowOnlyMode: true } });
    const text = formatScanBlockersGate3Section({
      gate1PassCount: 1,
      gate2PassCount: 1,
      gate3PassCount: 1,
      strongBuySuppressedByDataUnavailableCount: 0,
      topGate1BlockReasons: [],
      topGate2BlockReasons: [],
      topGate3BlockReasons: [],
      gate3Consolidated: {
        ...gate3Consolidated,
        completionScore,
        liveReadinessScore,
      },
    });

    expect(text).toContain('completionStatus: COMPLETE');
    expect(text).toContain('completionScore: 100/100');
    expect(text).toContain('liveReadinessStatus: SHADOW_READY');
  });
});
