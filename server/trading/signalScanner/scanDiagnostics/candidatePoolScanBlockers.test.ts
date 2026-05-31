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
    expect(text).toContain('Candidate Pool Counts:');
    expect(text).toContain('candidateDiagnosticScorePositive=');
    expect(text).not.toContain('diagnosticSurvivors=');
    expect(text).toContain('shadowEligible=1');
    expect(text).toContain('universeCounterfactualRowsCreated=1');
    expect(text).toContain('Candidate evaluation active');
    expect(text).toContain('Live order permission separated');
    expect(text).toContain('Missing features scored as confidence penalty');
    // P2 truth-consistency: universe rows recorded (=1) while entries=0 must NOT surface a
    // scope-less `counterfactualRecorded=false` that contradicts the universe count. All
    // counterfactual counts are scope-prefixed (universe/gate/entry), never a bare false.
    expect(text).not.toContain('counterfactualRecorded=false');
    expect(text).not.toContain('counterfactualRecorded: false');
  });

  it('renders Gate1 hard survivors preserved into the Gate2 soft leadership lane', () => {
    const candidatePool = buildCandidatePool({
      sourceSnapshotId: 'scan-eval:paper-lane',
      existingWatchlist: [
        { symbol: '000660', name: 'SK hynix', price: 180_000, volume: 1_000_000, turnover: 180_000_000_000 },
        { symbol: '002960', name: 'Hankook Shell', price: 250_000, volume: 30_000, turnover: 7_500_000_000 },
        { symbol: '003230', name: 'Samyang Foods', price: 520_000, volume: 50_000, turnover: 26_000_000_000 },
      ],
      liveOrderAllowed: false,
      emitLogs: false,
    });
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
      candidatePool,
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
    expect(text).toContain('- counterfactualLedgerRowsCreated=3');
    expect(text).toContain('- paperEntryCandidateCount=3 paperExecutableCreatedCount=0 paperObservationalCreatedCount=3 paperEntrySkippedCount=0');
    expect(text).toContain('- paperCreatedTotal=3 paperCounterfactualCreatedCount=0');
    expect(text).toContain('- PaperEntry: executableCreated=0 observationalCreated=3 skipped=0 executionImpact=NONE note=observational paper entries are not executable paper trades');
    expect(text).toContain('- paperEntrySkipReasonDistribution={}');
    expect(text).toContain('- paperEntrySoftLabelDistribution={"SCORE_BELOW_THRESHOLD":3,"GATE2_PENDING":3,"GATE3_PRE_BREAKOUT":3,"SIZING_BLOCKED":3}');
    expect(text).toContain('- paperEntryCandidateSymbols=000660,003230,002960');
    expect(text).toContain('- paperEntryCreatedSymbols=000660,003230,002960');
    expect(text).toContain('- paperExecutableSymbols=-');
    expect(text).toContain('- paperObservationalSymbols=000660,003230,002960');
    expect(text).toContain('- paperEntrySkippedSymbols=-');
    expect(text).toContain('- paperEntryForensicStatus=VALID');
    expect(text).toContain('- paperEntryInvariantValid=true');
    expect(text).toContain('- paperEntrySemanticInvariantValid=true');
    expect(text).toContain('- paperEntryRecommendedAction=NONE');
    expect(text).toContain('- paperEntryRealSkipReasonResolvedCount=0');
    expect(text).toContain('- paperEntryForensicFallbackReasonCount=0');
    expect(text).toContain('000660:CREATED:kind=OBSERVATIONAL_PAPER_ENTRY:primary=OBSERVATIONAL_PAPER_ENTRY_CREATED:secondary=SCORE_BELOW_THRESHOLD,GATE2_PENDING,GATE3_PRE_BREAKOUT,SIZING_BLOCKED:score=FAIL:gate1=PASS:gate2=PENDING:gate3=BLOCK:sizing=BLOCKED:executable=false:promotionAllowed=false:liveOrderAllowed=false:learningAllowed=true:executionImpact=NONE');
    expect(text).toContain('paperStatisticsSeparation=observationalExcludedFromExecutablePnL:true');
    expect(text).toContain('- Entry Lane Split:');
    expect(text).toContain('  liveCandidates=0');
    expect(text).toContain('  liveOrderCreated=0');
    expect(text).toContain('  liveBlockedByPolicy=0');
    expect(text).toContain('  paperExecutableCreated=0');
    expect(text).toContain('  paperObservationalCreated=3');
    expect(text).toContain('GATE1_HARD_SURVIVOR_GATE2_PENDING');
    expect(text).toContain('shadowObservablePreserved=true');
    expect(text).toContain('gateCounterfactualRecorded=true');
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
            existingOpenShadowPosition: false, existingPendingPaperOrder: false, resolvedEntryPrice: 75_000, priceSource: 'TEST_QUOTE', sizingAllowed: true,
          },
          {
            symbol: '000660', gate1HardSurvivor: true, minSignalLivePass: true, gate2PendingPreserved: true,
            shadowObservableStrict: true, shadowObservableSoft: true, paperEntryEligible: true, paperEntryDecision: 'SKIPPED',
            paperEntrySkipReason: 'DUPLICATE_OPEN_POSITION', existingOpenShadowPosition: true, existingPendingPaperOrder: false, resolvedEntryPrice: 180_000, priceSource: 'TEST_QUOTE', sizingAllowed: true,
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
    expect(text).toContain('- paperEntryCandidateCount=3 paperExecutableCreatedCount=0 paperObservationalCreatedCount=1 paperEntrySkippedCount=2');
    expect(text).toContain('- paperCreatedTotal=1 paperCounterfactualCreatedCount=0');
    expect(text).toContain('- paperEntrySkipReasonDistribution={\"DUPLICATE_OPEN_POSITION\":1,\"STALE_PRICE\":1}');
    expect(text).toContain('- paperEntryCandidateSymbols=005930,000660,035420');
    expect(text).toContain('- paperEntryCreatedSymbols=005930');
    expect(text).toContain('- paperObservationalSymbols=005930');
    expect(text).toContain('- paperEntrySkippedSymbols=000660,035420');
    expect(text).toContain('- paperEntryTopSkipReason=DUPLICATE_OPEN_POSITION');
    expect(text).toContain('- paperEntryForensicStatus=VALID');
    expect(text).toContain('- paperEntryInvariantValid=true');
    expect(text).toContain('- paperEntryRecommendedAction=NONE');
    expect(text).toContain('[PaperEntry Forensic]');
  });

  it('separates executable paper entries from observational paper entries', () => {
    const summary = {
      time: '12:08 KST',
      candidates: 1,
      trackB: 0,
      swing: 0,
      catalyst: 0,
      momentum: 0,
      yahooFails: 0,
      gateMisses: 0,
      rrrMisses: 0,
      entries: 0,
      paperEntryForensic: {
        decisionRecords: [
          {
            symbol: '005930',
            sourceSnapshotId: 'scan-eval:exec',
            candidateSetId: 'candidateSet:exec',
            gateScoreInputSnapshotId: 'gateScoreInput:exec',
            scanId: 'scan-eval:exec',
            decision: 'CREATED',
            stage: 'ORDER_CREATION',
            skipReason: 'NONE',
            gate1HardSurvivor: true,
            minSignalLivePass: true,
            gate2PendingPreserved: false,
            shadowObservableStrict: true,
            shadowObservableSoft: true,
            paperEntryEligible: true,
            existingOpenShadowPosition: false,
            existingPendingPaperOrder: false,
            resolvedEntryPrice: 75_000,
            priceSource: 'TEST_QUOTE',
            sizingAllowed: true,
            executionPermission: 'ALLOW',
          },
        ],
        executionImpact: 'NONE',
      },
    } satisfies ScanSummary;

    const text = formatScanBlockersMessage(summary);

    expect(text).toContain('- paperEntryCandidateCount=1 paperExecutableCreatedCount=1 paperObservationalCreatedCount=0 paperEntrySkippedCount=0');
    expect(text).toContain('- paperExecutableSymbols=005930');
    expect(text).toContain('- paperObservationalSymbols=-');
    expect(text).toContain('005930:CREATED:kind=EXECUTABLE_PAPER_ENTRY:primary=EXECUTABLE_PAPER_ENTRY_CREATED:secondary=NONE:score=PASS:gate1=PASS:gate2=PASS:gate3=PASS:sizing=PASS:executable=true:promotionAllowed=true:liveOrderAllowed=false:learningAllowed=true:executionImpact=NONE');
  });

  it('renders SHADOW_ONLY entries as diagnostic lanes, not live buy creation', () => {
    const paperRecords = Array.from({ length: 5 }, (_, idx) => {
      const symbol = String(100000 + idx).slice(0, 6);
      return {
        symbol,
        sourceSnapshotId: 'scan-eval:shadow-only-night',
        candidateSetId: 'candidateSet:shadow-only-night',
        gateScoreInputSnapshotId: 'gateScoreInput:shadow-only-night',
        scanId: 'scan-eval:shadow-only-night',
        decision: 'CREATED' as const,
        stage: 'ORDER_CREATION' as const,
        skipReason: 'NONE' as const,
        gate1HardSurvivor: true,
        minSignalLivePass: false,
        gate2PendingPreserved: true,
        shadowObservableStrict: true,
        shadowObservableSoft: true,
        paperEntryEligible: true,
        existingOpenShadowPosition: false,
        existingPendingPaperOrder: false,
        resolvedEntryPrice: 50_000 + idx,
        priceSource: 'TEST_QUOTE',
        sizingAllowed: false,
        executionPermission: 'PAPER_OBSERVATION_ALLOWED',
      };
    });
    const summary = {
      time: '22:55 KST',
      candidates: 43,
      trackB: 9,
      swing: 0,
      catalyst: 0,
      momentum: 0,
      yahooFails: 0,
      gateMisses: 0,
      rrrMisses: 0,
      entries: 2,
      liveEligibleCount: 9,
      macroGateState: {
        emergencyStop: false,
        autoTradeEnabled: true,
        regime: 'R3_EARLY',
        macroRegimeRaw: 'R3_EARLY',
        macroRegimeEffective: 'R3_EARLY',
        displayRegime: 'SHADOW_ONLY',
        riskOverride: 'SHADOW_ONLY',
        engineMode: 'SHADOW_ONLY',
        kellyMultiplierFromRegime: 0.7,
        fomcPhase: 'NORMAL',
        fomcKellyMultiplier: 1,
        finalKellyMultiplier: 0,
        vixGatingActive: false,
        bearDefenseMode: false,
        mhsBelow30: false,
        watchlistEmpty: false,
        sellOnlyMode: false,
        liveEntryAllowed: false,
        liveExitAllowed: true,
        shadowBuyAllowed: true,
        shadowSellAllowed: true,
        shadowLearningAllowed: true,
        counterfactualAllowed: true,
        brokerOrderAllowed: true,
        brokerLiveOrderAllowed: false,
      },
      scanEvaluation: {
        scanId: 'scan-eval:shadow-only-night',
        asOf: '2026-05-25T22:55:00.000Z',
        evaluationState: 'EVALUATED_WITH_SURVIVORS',
        marketSessionState: 'BUY_ALLOWED',
        engineMode: 'SHADOW_ONLY',
        effectiveRegime: 'R3_EARLY',
        totalCandidates: 43,
        evaluated: 43,
        skipped: 0,
        rejected: 0,
        survivors: 2,
        quoteHydrated: 43,
        quoteHydrationFailed: 0,
        blockReason: 'NONE',
        breakPoint: 'NONE',
        sourcePath: 'test',
        executionImpact: 'NONE',
        shadowLearningAllowed: true,
      },
      gate2SoftLeadershipLane: {
        gate1HardSurvivors: 5,
        minSignalLivePass: 5,
        gate2PendingPreserved: 5,
        labels: [],
        shadowObservablePreserved: true,
        watchPreserved: true,
        counterfactualRecorded: true,
        executionImpact: 'NONE',
      },
      paperEntryForensic: {
        decisionRecords: paperRecords,
        executionImpact: 'NONE',
      },
      entryLaneSplit: {
        counterfactualCreated: 43,
      },
    } satisfies ScanSummary;

    const text = formatScanBlockersMessage(summary);

    expect(text).toContain('🧪 Shadow diagnostic entry: <b>2개</b>');
    expect(text).toContain('실거래 주문: <b>0개</b> (실거래 없음)');
    expect(text).toContain('- Shadow diagnostic entry: 2개');
    expect(text).toContain('- 실거래 주문: 0개 (실거래 없음)');
    expect(text).toContain('  liveCandidates=9');
    expect(text).toContain('  liveOrderCreated=0');
    expect(text).toContain('  liveBlockedByPolicy=9');
    expect(text).toContain('  shadowDiagnosticCreated=2');
    expect(text).toContain('  shadowOrderCreated=0');
    expect(text).toContain('  paperExecutableCreated=0');
    expect(text).toContain('  paperObservationalCreated=5');
    expect(text).toContain('  counterfactualCreated=43');
    expect(text).toContain('Permission Resolution: canonicalSession=CLOSED displaySession=CLOSED_SHADOW_OBSERVE liveEntryAllowed=false liveOrderAllowed=false engineMode=SHADOW_ONLY brokerRouteAlive=true brokerLiveOrderAllowed=false');
    expect(text).toContain('marketSessionState=CLOSED');
    expect(text).not.toContain('매수 발생');
    expect(text).not.toContain('liveCreated=');
    expect(text).not.toContain('canonicalSession=REGULAR_OPEN');
    expect(text).not.toContain('marketSessionState=BUY_ALLOWED');
    expect(text).not.toContain('CRITICAL_PERMISSION_BREACH');

    const breachText = formatScanBlockersMessage({
      ...summary,
      entryLaneSplit: { ...summary.entryLaneSplit, liveOrderCreated: 1 },
    });
    expect(breachText).toContain('CRITICAL_PERMISSION_BREACH');
    expect(breachText).toContain('  liveOrderCreated=0');
  });

  it('renders SHADOW_ONLY holiday permission as paper/shadow allowed but live broker blocked', () => {
    const summary = {
      time: '2026-05-23T13:38:00.000Z',
      candidates: 0,
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
        macroRegimeEffective: 'R3_EARLY',
        displayRegime: 'SHADOW_ONLY',
        riskOverride: 'SHADOW_ONLY',
        engineMode: 'SHADOW_ONLY',
        kellyMultiplierFromRegime: 0.7,
        fomcPhase: 'NORMAL',
        fomcKellyMultiplier: 1,
        finalKellyMultiplier: 0,
        vixGatingActive: false,
        bearDefenseMode: false,
        mhsBelow30: false,
        watchlistEmpty: false,
        sellOnlyMode: false,
        liveEntryAllowed: true,
        liveExitAllowed: true,
        shadowBuyAllowed: true,
        shadowSellAllowed: true,
        shadowLearningAllowed: true,
        counterfactualAllowed: true,
        brokerOrderAllowed: true,
      },
      scanEvaluation: {
        scanId: 'scan-eval:test-holiday',
        asOf: '2026-05-23T13:38:00.000Z',
        evaluationState: 'EVALUATED_WITH_SURVIVORS',
        marketSessionState: 'BUY_ALLOWED',
        engineMode: 'SHADOW_ONLY',
        effectiveRegime: 'R3_EARLY',
        totalCandidates: 0,
        evaluated: 0,
        skipped: 0,
        rejected: 0,
        survivors: 0,
        quoteHydrated: 0,
        quoteHydrationFailed: 0,
        blockReason: 'NONE',
        breakPoint: 'NONE',
        sourcePath: 'test',
        executionImpact: 'NONE',
        shadowLearningAllowed: true,
      },
    } satisfies ScanSummary;

    const text = formatScanBlockersMessage(summary);

    expect(text).toContain('liveEntryAllowed: false');
    expect(text).toContain('brokerRouteAlive: true');
    expect(text).toContain('brokerLiveOrderAllowed: false');
    expect(text).toContain('paperOrderAllowed: true');
    expect(text).toContain('Permission Resolution: canonicalSession=HOLIDAY displaySession=HOLIDAY_SHADOW_OBSERVE liveEntryAllowed=false liveOrderAllowed=false engineMode=SHADOW_ONLY brokerRouteAlive=true brokerLiveOrderAllowed=false');
    expect(text).toContain('watchAllowed=true');
    expect(text).toContain('executionImpact=NONE note=Holiday blocks live broker orders; paper/shadow observation remains allowed.');
    expect(text).not.toContain('displaySession=BUY_ALLOWED');
    expect(text).not.toContain('brokerOrderAllowed: true');
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

    // ADR-0535: 권위 위계 블록이 raw/effective/display/policy + legacy(deprecated) 를 노출.
    expect(text).toContain('🧭 Market Raw: R3_EARLY');
    expect(text).toContain('🎚 Scoring Effective: R3_EARLY');
    expect(text).toContain('🛡 Display/Policy: SHADOW_ONLY (riskOverride=SHADOW_ONLY)');
    expect(text).toContain('legacyEffectiveRegime=R6_DEFENSE deprecated=true usedForDecision=false');
    expect(text).toContain('Regime: raw=R3_EARLY effective=R3_EARLY display=SHADOW_ONLY riskOverride=SHADOW_ONLY');
  });
});
