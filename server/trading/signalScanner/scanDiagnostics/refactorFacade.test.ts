import { describe, expect, it } from 'vitest';
import {
  accumulateGateEligibility,
  accumulateGateScoreHealth,
  buildGatePassDistribution,
  buildGateScoreHealthSummary,
  buildPerStageDropoffSummary,
  buildWaitDistribution,
  createScanCounters,
  persistScanResults,
  recordPipelineStage,
} from '../scanDiagnostics.js';

describe('scanDiagnostics refactor facade', () => {
  it('exports createScanCounters and persistScanResults from the legacy path', () => {
    expect(typeof createScanCounters).toBe('function');
    expect(typeof persistScanResults).toBe('function');
  });

  it('preserves createScanCounters diagnostic defaults', () => {
    const counters = createScanCounters();

    expect(counters.waitTierRestSuppressed).toBe(0);
    expect(counters.counterfactualShadowCreated).toBe(0);
    expect(counters.provisionalShadowCreated).toBe(0);
    expect(counters.shadowNearBreakoutCreated).toBe(0);
    expect(counters.nearMissOutcomeLedgerRecorded).toBe(0);
    expect(counters.gateScoreBucketCounts).toEqual({
      EXECUTABLE: 0,
      DATA_BLOCKED_NEAR_MISS: 0,
      PROBING: 0,
      SHADOW_ONLY: 0,
      REJECTED: 0,
    });
  });

  it('builds wait and gate pass distributions from counters', () => {
    const counters = createScanCounters();
    counters.waitDataHold = 1;
    counters.waitPreBreakout = 2;
    counters.waitGateFail = 3;
    counters.waitSizingBlocked = 4;
    counters.waitDriftRemove = 5;
    counters.waitDriftCorpAction = 6;
    counters.waitVolumeDrop = 7;
    counters.waitOther = 8;
    counters.gate1Pass = 9;
    counters.gate1Unknown = 10;
    counters.gate2Pass = 11;
    counters.gate3Pass = 12;
    counters.lastTriggerPass = 13;

    expect(buildWaitDistribution(counters)).toEqual({
      dataHold: 1,
      preBreakout: 2,
      gateFail: 3,
      sizingBlocked: 4,
      driftRemove: 5,
      corpAction: 6,
      volumeDrop: 7,
      other: 8,
    });
    expect(buildGatePassDistribution(counters)).toEqual({
      gate1Pass: 9,
      gate1Unknown: 10,
      gate2Pass: 11,
      gate3Pass: 12,
      lastTriggerPass: 13,
    });
  });

  it('records per-stage dropoff without changing execution policy', () => {
    const counters = createScanCounters();

    recordPipelineStage(counters, 'PRICE_FETCH', 'PASS');
    recordPipelineStage(counters, 'PRICE_FETCH', 'DATA_UNAVAILABLE');

    expect(buildPerStageDropoffSummary(counters)).toEqual([
      {
        stage: 'PRICE_FETCH',
        pass: 1,
        fail: 0,
        blocked: 0,
        skipped: 0,
        shadowOnly: 0,
        dataUnavailable: 1,
        providerDegraded: 0,
      },
    ]);
  });

  it('accumulates gate eligibility and score health diagnostics', () => {
    const counters = createScanCounters();

    accumulateGateEligibility(counters, {
      liveEligible: false,
      shadowObservable: true,
      liveBlockReasons: ['MACRO_BLOCK', 'INSUFFICIENT_SCORE'],
      dataUnavailableReasons: ['SUPPLY'],
      degradedProviderReasons: ['SECTOR'],
    });
    accumulateGateScoreHealth(counters, {
      gateScore: 72,
      availableMaxScore: 90,
      normalizedGateScore: 0.8,
      unavailableConditions: ['SUPPLY'],
      thresholdNotMetConditions: ['PRICE'],
      providerDegradedConditions: [],
    });

    expect(counters.liveEligibleCount).toBe(0);
    expect(counters.shadowObservableCount).toBe(1);
    expect(counters.dataUnavailableBlockedCount).toBe(1);
    expect(counters.providerDegradedObservableCount).toBe(1);
    expect(counters.hardRiskBlockedCount).toBe(1);
    expect(counters.trueGateFailCount).toBe(1);
    expect(buildGateScoreHealthSummary(counters)).toMatchObject({
      samples: 1,
      rawScoreAvg: 72,
      availableMaxScoreAvg: 90,
      normalizedGateScoreAvg: 0.8,
    });
  });
});
