import { describe, expect, it } from 'vitest';
import { buildCandidatePool } from '../../candidatePoolBuilder.js';
import { formatScanBlockersMessage } from './scanBlockersFormatter.js';
import type { ScanSummary } from './scanSummaryTypes.js';

describe('scan_blockers candidate pool section', () => {
  it('renders broad candidate pool diagnostics and separated live permission', () => {
    const candidatePool = buildCandidatePool({
      sourceSnapshotId: 'scan-eval:test',
      existingWatchlist: [
        {
          symbol: '005930',
          name: 'Samsung Electronics',
          price: 75_000,
          volume: 10_000_000,
          turnover: 750_000_000_000,
          relativeStrengthScore: 10,
          breakoutScore: null,
          return20d: 5,
        },
      ],
      liveOrderAllowed: false,
      emitLogs: false,
    });
    const summary = {
      time: '12:00 KST',
      candidates: 1,
      trackB: 1,
      swing: 1,
      catalyst: 0,
      momentum: 0,
      yahooFails: 0,
      gateMisses: 1,
      rrrMisses: 0,
      entries: 0,
      waitDistribution: {
        dataHold: 0,
        preBreakout: 0,
        gateFail: 1,
        sizingBlocked: 0,
        driftRemove: 0,
        corpAction: 0,
        volumeDrop: 0,
        other: 0,
      },
      candidatePool,
    } satisfies ScanSummary;

    const text = formatScanBlockersMessage(summary);

    expect(text).toContain('[Candidate Pool Runtime]');
    expect(text).toContain('Runtime Wiring Summary');
    expect(text).toContain('- GateScoreInput candidates: 1');
    expect(text).toContain('- PriceMomentum applied: 0/1');
    expect(text).toContain('- RS rawComputed=0/1 fallbackUsable=0/1 applied=0/1 fallbackIncluded=false');
    expect(text).toContain('- counterfactualLedgerRowsCreated=1');
    expect(text).toContain('- Provider penalty: DIAGNOSTIC_ONLY');
    expect(text).toContain('- legacyR6Path: notUsed');
    expect(text).toContain('importedCandidates=1');
    expect(text).toContain('gateEvaluated=1');
    expect(text).toContain('shadowEligible=1');
    expect(text).toContain('counterfactualRecorded=1');
    expect(text).toContain('Candidate evaluation active');
    expect(text).toContain('Live order permission separated');
    expect(text).toContain('Missing features scored as confidence penalty');
  });

  it('renders Gate1 hard survivors preserved into the Gate2 soft leadership lane', () => {
    const summary = {
      time: '12:05 KST',
      candidates: 3,
      trackB: 0,
      swing: 0,
      catalyst: 0,
      momentum: 0,
      yahooFails: 0,
      gateMisses: 0,
      rrrMisses: 0,
      entries: 0,
      shadowObservableCount: 3,
      liveEligibleCount: 0,
      dataUnavailableBlockedCount: 3,
      gate2SoftLeadershipLane: {
        gate1HardSurvivors: 3,
        minSignalLivePass: 4,
        gate2PendingPreserved: 3,
        labels: [
          'GATE1_HARD_SURVIVOR_GATE2_PENDING',
          'GATE1_PASS_PRE_BREAKOUT_WAIT',
          'R3_PROVISIONAL_LEADER_GATE2_NOT_CONFIRMED',
        ],
        shadowObservablePreserved: true,
        watchPreserved: true,
        counterfactualRecorded: true,
        executionImpact: 'NONE',
      },
    } satisfies ScanSummary;

    const text = formatScanBlockersMessage(summary);

    expect(text).toContain('Gate1 hard survivors: 3');
    expect(text).toContain('MinSignal live pass: 4');
    expect(text).toContain('- MinSignal live pass: 4');
    expect(text).toContain('Gate2 pending preserved: 3');
    expect(text).toContain('- counterfactualLedgerRowsCreated=0');
    expect(text).toContain('- paperEntryCandidateCount=3 paperEntryCreatedCount=0 paperEntrySkippedCount=3');
    expect(text).toContain('- paperEntrySkipReasonDistribution={"MIN_SIGNAL_SCORE_BELOW_ENTRY_THRESHOLD":3}');
    expect(text).toContain('- paperEntryCandidateSymbols=UNKNOWN_1,UNKNOWN_2,UNKNOWN_3');
    expect(text).toContain('- paperEntrySkippedSymbols=UNKNOWN_1,UNKNOWN_2,UNKNOWN_3');
    expect(text).toContain('- paperEntryForensicStatus=VALID');
    expect(text).toContain('- paperEntryInvariantValid=true');
    expect(text).toContain('- paperEntrySemanticInvariantValid=true');
    expect(text).toContain('- paperEntryRecommendedAction=NONE');
    expect(text).toContain('- paperEntryRealSkipReasonResolvedCount=3');
    expect(text).toContain('- paperEntryForensicFallbackReasonCount=0');
    expect(text).toContain('GATE1_HARD_SURVIVOR_GATE2_PENDING');
    expect(text).toContain('shadowObservablePreserved=true');
    expect(text).toContain('counterfactualRecorded=true');
    expect(text).toContain('executionImpact=NONE');
  });

  it('emits paper-entry forensic details when skip reasons are available', () => {
    const summary = {
      time: '12:07 KST',
      candidates: 3,
      trackB: 0,
      swing: 0,
      catalyst: 0,
      momentum: 0,
      yahooFails: 0,
      gateMisses: 0,
      rrrMisses: 0,
      entries: 0,
      gate2SoftLeadershipLane: {
        gate1HardSurvivors: 3,
        minSignalLivePass: 3,
        gate2PendingPreserved: 3,
        labels: [],
        shadowObservablePreserved: true,
        watchPreserved: true,
        counterfactualRecorded: true,
        executionImpact: 'NONE',
      },
      paperEntryForensic: {
        candidates: [
          {
            symbol: '005930', gate1HardSurvivor: true, minSignalLivePass: true, gate2PendingPreserved: true,
            shadowObservableStrict: true, shadowObservableSoft: true, paperEntryEligible: true, paperEntryDecision: 'CREATED',
            existingOpenShadowPosition: false, existingPendingPaperOrder: false, sizingAllowed: true,
          },
          {
            symbol: '000660', gate1HardSurvivor: true, minSignalLivePass: true, gate2PendingPreserved: true,
            shadowObservableStrict: true, shadowObservableSoft: true, paperEntryEligible: true, paperEntryDecision: 'SKIPPED',
            paperEntrySkipReason: 'DUPLICATE_OPEN_POSITION', existingOpenShadowPosition: true, existingPendingPaperOrder: false, sizingAllowed: true,
          },
          {
            symbol: '035420', gate1HardSurvivor: true, minSignalLivePass: true, gate2PendingPreserved: true,
            shadowObservableStrict: true, shadowObservableSoft: true, paperEntryEligible: true, paperEntryDecision: 'SKIPPED',
            paperEntrySkipReason: 'STALE_PRICE', existingOpenShadowPosition: false, existingPendingPaperOrder: false, sizingAllowed: true,
          },
        ],
        topSkipReason: 'DUPLICATE_OPEN_POSITION',
        executionImpact: 'NONE',
      },
    } satisfies ScanSummary;

    const text = formatScanBlockersMessage(summary);
    expect(text).toContain('- paperEntryCandidateCount=3 paperEntryCreatedCount=1 paperEntrySkippedCount=2');
    expect(text).toContain('- paperEntrySkipReasonDistribution={\"DUPLICATE_OPEN_POSITION\":1,\"STALE_PRICE\":1}');
    expect(text).toContain('- paperEntryCandidateSymbols=005930,000660,035420');
    expect(text).toContain('- paperEntryCreatedSymbols=005930');
    expect(text).toContain('- paperEntrySkippedSymbols=000660,035420');
    expect(text).toContain('- paperEntryTopSkipReason=DUPLICATE_OPEN_POSITION');
    expect(text).toContain('- paperEntryForensicStatus=VALID');
    expect(text).toContain('- paperEntryInvariantValid=true');
    expect(text).toContain('- paperEntryRecommendedAction=NONE');
    expect(text).toContain('[PaperEntry Forensic]');
  });

  it('prints stale legacy R6 as deprecated-only while keeping canonical effective regime', () => {
    const summary = {
      time: '12:10 KST',
      candidates: 1,
      trackB: 0,
      swing: 0,
      catalyst: 0,
      momentum: 0,
      yahooFails: 0,
      gateMisses: 0,
      rrrMisses: 0,
      entries: 0,
      macroGateState: {
        emergencyStop: false,
        autoTradeEnabled: true,
        regime: 'R3_EARLY',
        macroRegimeRaw: 'R3_EARLY',
        macroRegimeEffective: 'R6_DEFENSE',
        displayRegime: 'SHADOW_ONLY',
        riskOverride: 'SHADOW_ONLY',
        kellyMultiplierFromRegime: 0.7,
        fomcPhase: 'NORMAL',
        fomcKellyMultiplier: 1,
        finalKellyMultiplier: 0.7,
        vixGatingActive: false,
        bearDefenseMode: false,
        mhsBelow30: false,
        watchlistEmpty: false,
        sellOnlyMode: false,
      },
    } satisfies ScanSummary;

    const text = formatScanBlockersMessage(summary);

    expect(text).toContain('레짐: display=SHADOW_ONLY effective=R3_EARLY');
    expect(text).toContain('raw/effective/display/riskOverride: R3_EARLY → R3_EARLY / SHADOW_ONLY / SHADOW_ONLY');
    expect(text).toContain('legacyR6Path: deprecated=true notUsedForDecision=true');
    expect(text).toContain('Regime: raw=R3_EARLY effective=R3_EARLY display=SHADOW_ONLY riskOverride=SHADOW_ONLY');
  });
});
