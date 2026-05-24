import { describe, expect, it } from 'vitest';
import { buildGate3CandidateDetail } from './gate3CandidateDetail.js';
import {
  buildGate3ShadowPolicy,
  formatGate3ShadowRoutingAuditSection,
  summarizeGate3ShadowPolicies,
} from './gate3ShadowPolicy.js';

function diagnostic(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    timingReadiness: 'READY',
    falseBreakoutRisk: 'LOW',
    executionImpact: 'NONE',
    entryPriceGuard: { priceFreshness: 'VERIFIED' },
    rrrCheck: {
      rrr: 2.4,
      status: 'PASS',
      source: 'FALLBACK_PERCENT',
      entryPrice: 10_000,
      stopLoss: 9_300,
      targetPrice: 11_500,
    },
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
    ...overrides,
  };
}

function detail(overrides: Record<string, unknown> = {}) {
  return buildGate3CandidateDetail({
    symbol: '204320',
    name: 'HL만도',
    sourceSnapshotId: 'scan-eval:test',
    asOf: '2026-05-24T09:00:00.000Z',
    consolidatedDiagnostic: diagnostic(overrides),
  });
}

describe('Gate3 shadow policy', () => {
  it('routes READY to shadow entry allowed', () => {
    const policy = buildGate3ShadowPolicy(detail());

    expect(policy.route).toBe('SHADOW_ENTRY_ALLOWED');
    expect(policy.shadowEntryAllowed).toBe(true);
    expect(policy.paperOrderAllowed).toBe(true);
    expect(policy.counterfactualAllowed).toBe(true);
    expect(policy.learningLabel).toBe('GATE3_READY_FIRED');
    expect(policy.liveBuyAllowed).toBe(true);
    expect(policy.executionImpact).toBe('NONE');
    expect(policy.marketSignal).toBe(false);
    expect(policy.providerIssue).toBe(false);
  });

  it('keeps READY shadow allowed while SHADOW_ONLY blocks live', () => {
    const policy = buildGate3ShadowPolicy(detail(), {
      engineMode: 'SHADOW_ONLY',
      livePolicyAllowed: false,
    });

    expect(policy.route).toBe('SHADOW_ENTRY_ALLOWED');
    expect(policy.shadowEntryAllowed).toBe(true);
    expect(policy.liveBuyAllowed).toBe(false);
    expect(policy.liveBlockReason).toBe('SHADOW_ONLY');
    expect(policy.executionImpact).toBe('LIVE_BUY_BLOCKED_ONLY');
  });

  it('routes WAIT to near-entry tracking and maps dry-up/pullback labels', () => {
    const dryUp = buildGate3ShadowPolicy(detail({
      timingReadiness: 'WAIT',
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
    }));
    const pullback = buildGate3ShadowPolicy(detail({
      timingReadiness: 'WAIT',
      lastTrigger: {
        status: 'THRESHOLD_NOT_MET',
        fired: false,
        liveBuyAllowed: false,
        shadowObservableAllowed: true,
        counterfactualAllowed: true,
        executionImpact: 'DIAGNOSTIC_ONLY',
        priceConfirmation: { status: 'PULLBACK_ENTRY' },
        volumeConfirmationDetail: { status: 'PARTIAL', volumeRatio20d: 1.2 },
      },
    }));

    expect(dryUp.route).toBe('NEAR_ENTRY_TRACKING');
    expect(dryUp.nearEntryTracking).toBe(true);
    expect(dryUp.watchlistUpgrade).toBe(true);
    expect(dryUp.learningLabel).toBe('GATE3_WAIT_DRY_UP');
    expect(pullback.learningLabel).toBe('GATE3_WAIT_PULLBACK');
  });

  it('routes BLOCKED to counterfactual only with issue labels', () => {
    const policy = buildGate3ShadowPolicy(detail({
      timingReadiness: 'BLOCKED',
      falseBreakoutRisk: 'LOW',
      rrrCheck: { rrr: 1.2, status: 'FAIL', source: 'EXPLICIT' },
      lastTrigger: {
        status: 'THRESHOLD_NOT_MET',
        fired: false,
        liveBuyAllowed: false,
        shadowObservableAllowed: true,
        counterfactualAllowed: true,
        executionImpact: 'DIAGNOSTIC_ONLY',
        priceConfirmation: { status: 'NOT_CONFIRMED' },
        volumeConfirmationDetail: { status: 'PARTIAL', volumeRatio20d: 1.2 },
      },
    }));

    expect(policy.route).toBe('COUNTERFACTUAL_ONLY');
    expect(policy.shadowEntryAllowed).toBe(false);
    expect(policy.counterfactualAllowed).toBe(true);
    expect(policy.learningLabel).toBe('GATE3_BLOCKED_RRR_FAIL');
    expect(policy.executionImpact).toBe('DIAGNOSTIC_ONLY');
  });

  it('routes DATA_INCOMPLETE to diagnostic only with missing labels', () => {
    const policy = buildGate3ShadowPolicy(detail({
      timingReadiness: 'DATA_INCOMPLETE',
      rrrCheck: { rrr: null, status: 'MISSING', source: 'MISSING' },
      lastTrigger: {
        status: 'DATA_UNAVAILABLE',
        fired: false,
        liveBuyAllowed: false,
        shadowObservableAllowed: true,
        counterfactualAllowed: true,
        executionImpact: 'DIAGNOSTIC_ONLY',
        priceConfirmation: { status: 'NEAR_BREAKOUT' },
        volumeConfirmationDetail: { status: 'DRY_UP', volumeRatio20d: 0.42 },
      },
    }));

    expect(policy.route).toBe('DIAGNOSTIC_ONLY');
    expect(policy.diagnosticOnly).toBe(true);
    expect(policy.counterfactualAllowed).toBe(true);
    expect(policy.learningLabel).toBe('GATE3_DATA_INCOMPLETE_RRR_MISSING');
  });

  it('summarizes routing counts and learning labels', () => {
    const policies = [
      buildGate3ShadowPolicy(detail()),
      buildGate3ShadowPolicy(detail({
        timingReadiness: 'WAIT',
        lastTrigger: {
          status: 'THRESHOLD_NOT_MET',
          fired: false,
          liveBuyAllowed: false,
          shadowObservableAllowed: true,
          counterfactualAllowed: true,
          priceConfirmation: { status: 'NEAR_BREAKOUT' },
          volumeConfirmationDetail: { status: 'DRY_UP', volumeRatio20d: 0.42 },
        },
      })),
    ];
    const summary = summarizeGate3ShadowPolicies(policies);
    const text = formatGate3ShadowRoutingAuditSection(summary);

    expect(summary.shadowEntryAllowedCount).toBe(1);
    expect(summary.nearEntryTrackingCount).toBe(1);
    expect(summary.counterfactualAllowedCount).toBe(2);
    expect(summary.learningLabels.GATE3_READY_FIRED).toBe(1);
    expect(summary.learningLabels.GATE3_WAIT_DRY_UP).toBe(1);
    expect(text).toContain('Gate3 Shadow Entry Routing');
    expect(text).toContain('GATE3_READY_FIRED: 1');
  });
});
