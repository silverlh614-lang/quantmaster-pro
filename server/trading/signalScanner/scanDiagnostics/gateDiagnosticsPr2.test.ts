// @responsibility scanDiagnostics PR-2 gate score and stage diagnostics smoke tests
import { describe, expect, it } from 'vitest';
import type { GateLayerSummary } from '../../../quantFilter.js';
import {
  accumulateGateLayerSummary,
  accumulateGateScoreCandidateBucket,
  accumulateGateScoreHealth,
  buildGateLayerAuditSummary,
  buildGateScoreCandidateBucketSummary,
  buildGateScoreHealthSummary,
  buildPerStageDropoffSummary,
  createScanCounters,
  formatGateScoreCandidateBucketSection,
  formatGateScoreHealthSection,
  recordPipelineStage,
} from '../scanDiagnostics.js';

function gateLayer(overrides: Partial<GateLayerSummary> = {}): GateLayerSummary {
  return {
    gate1: {
      fired: ['G1_OK'],
      unavailable: ['SUPPLY'],
      thresholdNotMet: ['PRICE'],
      providerDegraded: ['SECTOR'],
      passed: true,
      score: 3,
      availableMaxScore: 4,
    },
    gate2: {
      fired: [],
      unavailable: [],
      thresholdNotMet: ['LEADERSHIP'],
      providerDegraded: [],
      passed: false,
      score: 1,
      availableMaxScore: 2,
    },
    gate3: {
      fired: ['G3_OK'],
      unavailable: [],
      thresholdNotMet: [],
      providerDegraded: ['RISK'],
      passed: true,
      score: 2,
      availableMaxScore: 2,
    },
    finalPath: 'SHADOW_OBSERVABLE',
    ...overrides,
  };
}

describe('scanDiagnostics PR-2 gate diagnostics modules', () => {
  it('accumulates gate score health averages and top counts', () => {
    const counters = createScanCounters();

    accumulateGateScoreHealth(counters, {
      gateScore: 8,
      availableMaxScore: 10,
      normalizedGateScore: 0.8,
      unavailableConditions: ['SUPPLY', 'SUPPLY'],
      thresholdNotMetConditions: ['PRICE'],
      providerDegradedConditions: ['SECTOR'],
    });
    accumulateGateScoreHealth(counters, {
      rawScore: 6,
      availableMaxScore: 8,
      normalizedGateScore: 0.75,
      unavailableConditions: ['SUPPLY'],
      thresholdNotMetConditions: ['PRICE', 'VOLUME'],
      providerDegradedConditions: ['SECTOR', 'SECTOR'],
    });

    const summary = buildGateScoreHealthSummary(counters);
    expect(summary).toMatchObject({
      samples: 2,
      rawScoreAvg: 7,
      availableMaxScoreAvg: 9,
      normalizedGateScoreAvg: 0.775,
    });
    expect(summary.unavailableTop[0]).toEqual({ condition: 'SUPPLY', count: 3 });
    expect(summary.thresholdNotMetTop[0]).toEqual({ condition: 'PRICE', count: 2 });
    expect(summary.providerDegradedTop[0]).toEqual({ condition: 'SECTOR', count: 3 });
    expect(formatGateScoreHealthSection(summary)).toContain('Gate Score Health');
  });

  it('accumulates gate layer pass counts and block reason counts', () => {
    const counters = createScanCounters();

    accumulateGateLayerSummary(counters, gateLayer(), 'STRONG');

    const summary = buildGateLayerAuditSummary(counters);
    expect(summary).toMatchObject({
      gate1PassCount: 1,
      gate2PassCount: 0,
      gate3PassCount: 1,
      strongBuySuppressedByDataUnavailableCount: 1,
    });
    expect(summary.topGate1BlockReasons).toEqual([
      { reason: 'DATA_UNAVAILABLE:SUPPLY', count: 1 },
      { reason: 'PROVIDER_DEGRADED:SECTOR', count: 1 },
      { reason: 'THRESHOLD_NOT_MET:PRICE', count: 1 },
    ]);
    expect(summary.topGate2BlockReasons).toEqual([{ reason: 'THRESHOLD_NOT_MET:LEADERSHIP', count: 1 }]);
    expect(summary.topGate3BlockReasons).toEqual([{ reason: 'PROVIDER_DEGRADED:RISK', count: 1 }]);
  });

  it('records all pipeline stage dropoff statuses', () => {
    const counters = createScanCounters();

    for (const status of ['PASS', 'FAIL', 'BLOCKED', 'SHADOW_ONLY', 'DATA_UNAVAILABLE', 'PROVIDER_DEGRADED'] as const) {
      recordPipelineStage(counters, 'PRICE_FETCH', status);
    }

    expect(buildPerStageDropoffSummary(counters)).toEqual([{
      stage: 'PRICE_FETCH',
      pass: 1,
      fail: 1,
      blocked: 1,
      skipped: 0,
      shadowOnly: 1,
      dataUnavailable: 1,
      providerDegraded: 1,
    }]);
  });

  it('accumulates diagnostic candidate buckets with executionImpact NONE only', () => {
    const counters = createScanCounters();

    const decision = accumulateGateScoreCandidateBucket(counters, {
      gateScore: 9.6,
      rawScore: 9.6,
      availableMaxScore: 12,
      normalizedGateScore: 0.8,
      unavailableConditions: ['SUPPLY'],
      thresholdNotMetConditions: ['PRICE'],
      providerDegradedConditions: [],
    }, 10);

    expect(decision).toMatchObject({
      bucket: 'DATA_BLOCKED_NEAR_MISS',
      executionImpact: 'NONE',
    });
    const summary = buildGateScoreCandidateBucketSummary(counters);
    expect(summary.counts.DATA_BLOCKED_NEAR_MISS).toBe(1);
    expect(summary.dataBlockedNearMissTopUnavailable).toEqual([{ condition: 'SUPPLY', count: 1 }]);
    expect(formatGateScoreCandidateBucketSection(summary)).toContain('executionImpact: NONE');
  });

  it('keeps compatibility exports on the legacy scanDiagnostics path', () => {
    expect(typeof accumulateGateScoreHealth).toBe('function');
    expect(typeof buildGateScoreHealthSummary).toBe('function');
    expect(typeof accumulateGateLayerSummary).toBe('function');
    expect(typeof buildGateLayerAuditSummary).toBe('function');
    expect(typeof recordPipelineStage).toBe('function');
    expect(typeof buildPerStageDropoffSummary).toBe('function');
    expect(typeof accumulateGateScoreCandidateBucket).toBe('function');
    expect(typeof buildGateScoreCandidateBucketSummary).toBe('function');
    expect(typeof formatGateScoreCandidateBucketSection).toBe('function');
  });
});
