// @responsibility Regression tests for canonical QMP Gate Detail header rebinding.

import { describe, expect, it, vi } from 'vitest';
import type { ScanSummary } from '../../trading/signalScanner/scanDiagnostics/scanSummaryTypes.js';
import { buildSnapshotBundleFromScanSummary } from './snapshotBundle.js';
import { renderGateDetailSummary } from './gateDetailRenderer.js';
import {
  buildQmpGateDetailHeaderView,
  renderQmpGateDetailHeaderView,
} from './qmpGateDetailHeaderCanonical.js';

function shadowClosedSummary(): ScanSummary {
  return {
    time: '2026-05-25 23:43:52 KST',
    snapshotId: 'scan-eval-20260525234352',
    candidates: 43,
    trackB: 0,
    swing: 0,
    catalyst: 0,
    momentum: 0,
    yahooFails: 0,
    gateMisses: 0,
    rrrMisses: 0,
    entries: 3,
    scanEvaluation: {
      scanId: 'scan-eval-20260525234352',
      asOf: '2026-05-25 23:43:52 KST',
      evaluationState: 'EVALUATED_PARTIAL',
      marketSessionState: 'BUY_ALLOWED',
      engineMode: 'SHADOW_ONLY',
      effectiveRegime: 'R3_EARLY',
      totalCandidates: 43,
      evaluated: 43,
      skipped: 0,
      rejected: 38,
      survivors: 5,
      quoteHydrated: 43,
      quoteHydrationFailed: 0,
      sourcePath: 'test',
      executionImpact: 'NONE',
      shadowLearningAllowed: true,
    },
    macroGateState: {
      emergencyStop: false,
      autoTradeEnabled: true,
      regime: 'R3_EARLY',
      kellyMultiplierFromRegime: 1,
      fomcPhase: 'NONE',
      fomcKellyMultiplier: 1,
      finalKellyMultiplier: 1,
      vixGatingActive: false,
      bearDefenseMode: false,
      mhsBelow30: false,
      watchlistEmpty: false,
      sellOnlyMode: false,
      engineMode: 'SHADOW_ONLY',
      displayRegime: 'SHADOW_ONLY',
      macroRegimeRaw: 'R3_EARLY',
      macroRegimeEffective: 'R3_EARLY',
      riskOverride: 'SHADOW_ONLY',
      canonicalSession: 'BUY_ALLOWED',
      displaySession: 'BUY_ALLOWED',
      brokerRouteAlive: true,
      brokerLiveOrderAllowed: false,
      brokerExitOrderAllowed: false,
      paperOrderAllowed: true,
      shadowAllowed: true,
      shadowBuyAllowed: true,
      shadowLearningAllowed: true,
      counterfactualAllowed: true,
    },
    gate1MinimumSignalForensicAdr0505: {
      totalCandidates: 43,
      evaluatedCandidateCount: 43,
      actualScoreAvg: 43.7,
      requiredScoreAvg: 70,
      dominantFailureDistribution: { THRESHOLD_NOT_MET: 38 },
    } as unknown as ScanSummary['gate1MinimumSignalForensicAdr0505'],
    gate2SoftLeadershipLane: {
      gate1HardSurvivors: 5,
      minSignalLivePass: 5,
      gate2PendingPreserved: 5,
      labels: ['NO_LEADERSHIP'],
      shadowObservablePreserved: true,
      watchPreserved: true,
      counterfactualRecorded: true,
      executionImpact: 'NONE',
    },
    freshGate2Attribution: {
      candidates: 43,
      gate1Pass: 5,
      gate2Pass: 0,
      gate3Pass: 0,
      entries: 0,
      lastTriggerPass: 0,
      buckets: [],
      conditionGaps: [],
      nearMissConditions: [],
      topUnavailableCondition: { conditionKey: 'per', unavailable: 6 },
      gate2TrueFailedCount: 5,
      gate2UnavailableCount: 32,
      gate2WatchPreservedCount: 6,
      gate2ShadowPreservedCount: 5,
      recommendedDiagnosis: 'TRUE_NO_LEADERSHIP',
      leadershipAttribution: {
        officialIndex: {
          status: 'PARTIAL',
          coverage: 0.733,
          verifiedIndexCodeCoverage: 0,
          blocker: 'OFFICIAL_INDEX_COVERAGE_BELOW_THRESHOLD',
          promotionAllowed: false,
          impact: 'NO_LIVE_PROMOTION_ONLY',
        },
        shadowSector: {
          status: 'AVAILABLE',
          sourceTier: 'INTERNAL_GROUPED_SNAPSHOT',
          shadowLeadershipAllowed: true,
          confidence: 'SHADOW_ONLY',
          counterfactualAllowed: true,
        },
        breakoutMomentum: {
          status: 'NOT_CONFIRMED',
          blocker: 'BREAKOUT_MOMENTUM_NOT_CONFIRMED',
        },
        final: {
          liveLeadership: false,
          shadowLeadership: false,
          noLeadershipReason: 'LIVE_PROMOTION_DISABLED_AND_BREAKOUT_NOT_CONFIRMED',
          executionImpact: 'NONE',
        },
        blockers: ['OFFICIAL_INDEX_COVERAGE_BELOW_THRESHOLD', 'BREAKOUT_MOMENTUM_FAIL'],
      },
    } as unknown as ScanSummary['freshGate2Attribution'],
    gateLayerAudit: {
      gate1PassCount: 37,
      gate2PassCount: 0,
      gate3PassCount: 0,
      strongBuySuppressedByDataUnavailableCount: 0,
      topGate1BlockReasons: [{ reason: 'THRESHOLD_NOT_MET:weekly_rsi_zone', count: 38 }],
      topGate2BlockReasons: [{ reason: 'NO_LEADERSHIP', count: 5 }],
      topGate3BlockReasons: [{ reason: 'PRE_BREAKOUT_WAIT', count: 9 }],
      gate3Consolidated: {
        samples: 9,
        health: { TIMING_NOT_CONFIRMED: 9 },
        primaryIssue: { PRE_BREAKOUT_WAIT: 9 },
        compactText: { PRE_BREAKOUT_WAIT: 9 },
        timingReadiness: { BLOCKED: 9 },
        lastTriggerStatus: { THRESHOLD_NOT_MET: 9 },
        priceFreshness: { VERIFIED: 9 },
        executionImpact: { NONE: 9 },
        priceConfirmationStatus: { NOT_CONFIRMED: 7, NEAR_BREAKOUT: 2 },
        volumeConfirmationStatus: { VOLUME_WEAK: 4 },
        lastTriggerPassCount: 0,
        lastTriggerFiredCount: 0,
        lastTriggerWaitCount: 9,
        lastTriggerThresholdNotMetCount: 9,
        lastTriggerDataUnavailableCount: 0,
        entryPriceStaleCount: 0,
        rrrPassCount: 1,
        rrrWatchCount: 3,
        rrrFailCount: 5,
        rrrMissingCount: 0,
        rrrFallbackUsedCount: 0,
        priceBreakoutConfirmedCount: 0,
        priceNearBreakoutCount: 2,
        pricePullbackEntryCount: 0,
        priceNotConfirmedCount: 7,
        priceOverextendedCount: 0,
        volumeConfirmedCount: 0,
        volumePartialCount: 0,
        volumeDryUpCount: 0,
        volumeWeakCount: 4,
        volumeSpikeRiskCount: 0,
        falseBreakoutHighCount: 0,
        executionReadyCount: 0,
        candidateDetails: [],
        detailsByReadiness: { READY: [], WAIT: [], BLOCKED: [], DATA_INCOMPLETE: [] },
        shadowPolicies: [],
        shadowRouting: {
          samples: 0,
          diagnosticOnlyCount: 0,
          paperTradeAllowedCount: 0,
          liveTradeBlockedCount: 0,
          labelDistribution: {},
        },
        outcomeSeeds: [],
        outcomeTracking: {
          total: 0,
          ready: 0,
          wait: 0,
          blocked: 0,
          dataIncomplete: 0,
          routeDistribution: {},
          issueDistribution: {},
        },
      },
    } as unknown as ScanSummary['gateLayerAudit'],
    canonicalRuntimeResolution: {
      sizing: {
        hardBlockCount: 9,
        advisoryCount: 0,
        finalKelly: 0,
      },
    } as unknown as ScanSummary['canonicalRuntimeResolution'],
    sectorEnergySupplyUnknownAdr0488: {
      sectorEnergyMaster: {
        promotionAllowed: false,
        shadowLeadershipAllowed: true,
      },
    } as unknown as ScanSummary['sectorEnergySupplyUnknownAdr0488'],
    paperEntryForensic: {
      decisionRecords: ['000660', '033640', '066570', '069500', '336260', '006345'].map((symbol) => ({
        symbol,
        sourceSnapshotId: 'scan-eval-20260525234352',
        candidateSetId: 'candidates-20260525234352',
        gateScoreInputSnapshotId: 'gate-score-20260525234352',
        scanId: 'scan-eval-20260525234352',
        decision: 'CREATED',
        stage: 'ORDER_CREATION',
        skipReason: 'NONE',
        gate1HardSurvivor: true,
        minSignalLivePass: true,
        gate2PendingPreserved: true,
        shadowObservableStrict: true,
        shadowObservableSoft: true,
        paperEntryEligible: true,
        existingOpenShadowPosition: false,
        existingPendingPaperOrder: false,
        resolvedEntryPrice: 10000,
        priceSource: 'KIS',
        quoteFreshness: 'VERIFIED',
        sizingAllowed: false,
        sizingReason: 'SIZING_ADVISORY_ONLY',
        executionPermission: 'PAPER_OBSERVATION_ALLOWED',
        paperEntryKind: 'OBSERVATIONAL_PAPER_ENTRY',
        paperExecutable: false,
        promotionAllowed: false,
        learningAllowed: true,
      })),
      executionImpact: 'NONE',
    },
    entryLaneSplit: {
      liveCandidates: 9,
      liveOrderCreated: 2,
      liveBlockedByPolicy: 9,
      shadowDiagnosticCreated: 3,
      shadowOrderCreated: 0,
      paperExecutableCreated: 0,
      paperObservationalCreated: 0,
      counterfactualCreated: 43,
      watchOnlyPreserved: 5,
    },
  } as unknown as ScanSummary;
}

describe('ADR-536a-3 QMP Gate Detail header field source correction', () => {
  it('rebases session, Gate3 top block, and entry lanes to canonical forensic slices', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    try {
      const view = buildQmpGateDetailHeaderView(shadowClosedSummary());

      expect(view.session.marketSessionState).toBe('CLOSED');
      expect(view.session.displaySession).toBe('CLOSED_SHADOW_OBSERVE');
      expect(view.policy.engineMode).toBe('SHADOW_ONLY');
      expect(view.policy.liveOrderAllowed).toBe(false);
      expect(view.policy.brokerLiveOrderAllowed).toBe(false);
      expect(view.policy.executionImpact).toBe('NONE');
      expect(view.gate3.lastTriggerWait).toBe(9);
      expect(view.gate3.lastTriggerDataUnavailable).toBe(0);
      expect(view.gate3.rrrMissing).toBe(0);
      expect(view.gate3.topBlockReason).toBe('PRE_BREAKOUT_WAIT');
      expect(view.entryLane.liveOrderCreated).toBe(0);
      expect(view.entryLane.shadowDiagnosticCreated).toBe(3);
      expect(view.entryLane.paperObservationalCreated).toBe(6);
      expect(view.entryLane.counterfactualCreated).toBe(43);
      expect(view.gate2.shadowLeadership).toBe(true);
      expect(view.gate2.topMissingAxis).toBe('SECTOR_LEADERSHIP,per');
      expect(view.topBlocks).toEqual(expect.arrayContaining([
        'SHADOW_ONLY_POLICY',
        'BROKER_LIVE_ORDER_BLOCKED',
        'NO_LEADERSHIP',
        'PRE_BREAKOUT_WAIT',
        'RISK_SIZING_ZERO',
        'SECTOR_OFFICIAL_PROMOTION_DISABLED',
      ]));
      expect(view.topBlocks).not.toContain('GATE3_DATA_INCOMPLETE');
      expect(warn).toHaveBeenCalledWith(expect.stringContaining('[QMP_GATE_HEADER_CANONICAL_MISMATCH] raw liveOrderCreated=2 clamped'));
    } finally {
      warn.mockRestore();
    }
  });

  it('renders the header without legacy execution or Gate3 data-incomplete wording', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    try {
      const view = buildQmpGateDetailHeaderView(shadowClosedSummary());
      const text = renderQmpGateDetailHeaderView(view);

      expect(text).toContain('session/mode/regime: CLOSED_SHADOW_OBSERVE / SHADOW_ONLY / R3_EARLY');
      expect(text).toContain('policy: liveOrderAllowed=false brokerLiveOrderAllowed=false shadowAllowed=true counterfactualAllowed=true executionImpact=NONE');
      expect(text).toContain('G2: liveLeadership=false shadowLeadershipAllowed=true pending=5 topMissing=SECTOR_LEADERSHIP,per');
      expect(text).toContain('G3: ready=0 wait=9 dataUnavailable=0 rrrMissing=0 rrr=1/3/5 priceNotConfirmed=7 volumeWeak=4');
      expect(text).toContain('Entry: liveOrderCreated=0 shadowDiagnostic=3 paperObservational=6 counterfactual=43 liveBlockedByPolicy=9');
      expect(text).toContain('Safety: 실거래 주문 0개 - Shadow/Watch/Learning only');
      expect(text).toContain('TopBlocks: SHADOW_ONLY_POLICY, BROKER_LIVE_ORDER_BLOCKED, NO_LEADERSHIP, PRE_BREAKOUT_WAIT, RISK_SIZING_ZERO, SECTOR_OFFICIAL_PROMOTION_DISABLED');
      expect(text).not.toContain('TopBlock: GATE3_DATA_INCOMPLETE');
      expect(text).not.toContain('Execution: entryReady');
      expect(text).not.toContain('live 0 shadow 0 observe');
      expect(text).not.toContain('매수 발생');
      expect(text).not.toContain('liveCreated');
    } finally {
      warn.mockRestore();
    }
  });

  it('lets /gate_full and /gate_detail wrapper prefer the canonical header view', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    try {
      const summary = shadowClosedSummary();
      const view = buildQmpGateDetailHeaderView(summary);
      const bundle = {
        ...buildSnapshotBundleFromScanSummary(summary),
        qmpGateDetailHeader: view,
      };

      const text = renderGateDetailSummary(bundle);
      expect(text).toContain('TopBlocks: SHADOW_ONLY_POLICY');
      expect(text).toContain('Entry: liveOrderCreated=0 shadowDiagnostic=3');
      expect(text).not.toContain('TopBlock: GATE3_DATA_INCOMPLETE');
    } finally {
      warn.mockRestore();
    }
  });
});
