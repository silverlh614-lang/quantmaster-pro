import { describe, expect, it } from 'vitest';
import { normalizeShadowEligibilityForGate1 } from './gate1ShadowEligibility.js';

const regularSession = {
  session: 'REGULAR',
  liveBuyAllowed: true,
  shadowAllowed: true,
};

const verifiedQuote = {
  confidence: 'VERIFIED',
  providerIssue: false,
  marketSignal: false,
};

const tradable = {
  status: 'TRADABLE',
  providerIssue: false,
};

describe('Gate1 Always-On shadow eligibility normalizer', () => {
  it('keeps normal shadow lanes enabled in NORMAL mode', () => {
    const result = normalizeShadowEligibilityForGate1({
      engineMode: 'NORMAL',
      marketSessionCompatibility: regularSession,
      quoteCoverage: verifiedQuote,
      tradability: tradable,
    });

    expect(result).toMatchObject({
      allowed: true,
      mode: 'NORMAL_SHADOW',
      shadowScanAllowed: true,
      shadowSignalAllowed: true,
      paperOrderAllowed: true,
      virtualFillAllowed: true,
      positionLifecycleAllowed: true,
      counterfactualLearningAllowed: true,
      caseRecordingAllowed: true,
      liveExecutionImpact: 'NONE',
      shadowExecutionImpact: 'NONE',
      marketSignal: false,
    });
  });

  it('normalizes removed SELL_ONLY while keeping live and shadow lanes open', () => {
    const result = normalizeShadowEligibilityForGate1({
      engineMode: 'SELL_ONLY',
      marketSessionCompatibility: { session: 'SELL_ONLY', liveBuyAllowed: false, shadowAllowed: true },
      quoteCoverage: verifiedQuote,
      tradability: tradable,
    });

    expect(result).toMatchObject({
      allowed: true,
      mode: 'NORMAL_SHADOW',
      shadowScanAllowed: true,
      shadowSignalAllowed: true,
      paperOrderAllowed: true,
      virtualFillAllowed: true,
      positionLifecycleAllowed: true,
      counterfactualLearningAllowed: true,
      caseRecordingAllowed: true,
      reason: null,
      liveExecutionImpact: 'NONE',
      shadowExecutionImpact: 'NONE',
    });
  });

  it('keeps shadow signal lanes enabled in SHADOW_ONLY while live execution is blocked', () => {
    const result = normalizeShadowEligibilityForGate1({
      engineMode: 'SHADOW_ONLY',
      marketSessionCompatibility: regularSession,
      quoteCoverage: verifiedQuote,
      tradability: tradable,
    });

    expect(result.liveExecutionImpact).toBe('LIVE_EXECUTION_BLOCKED');
    expect(result.shadowExecutionImpact).toBe('NONE');
    expect(result.shadowScanAllowed).toBe(true);
    expect(result.shadowSignalAllowed).toBe(true);
    expect(result.paperOrderAllowed).toBe(true);
  });

  it('keeps counterfactual and case recording enabled in OBSERVE_ONLY', () => {
    const result = normalizeShadowEligibilityForGate1({
      engineMode: 'OBSERVE_ONLY',
      marketSessionCompatibility: { session: 'CLOSED', liveBuyAllowed: false, shadowAllowed: true },
      quoteCoverage: verifiedQuote,
      tradability: tradable,
    });

    expect(result.mode).toBe('OBSERVE_ONLY');
    expect(result.counterfactualLearningAllowed).toBe(true);
    expect(result.caseRecordingAllowed).toBe(true);
    expect(result.paperOrderAllowed).toBe(false);
    expect(result.virtualFillAllowed).toBe(false);
    expect(result.shadowExecutionImpact).toBe('NONE');
  });

  it('quote missing downgrades to counterfactual-only without market signal', () => {
    const result = normalizeShadowEligibilityForGate1({
      engineMode: 'NORMAL',
      marketSessionCompatibility: regularSession,
      quoteCoverage: { confidence: 'MISSING', providerIssue: true },
      quoteFreshness: { status: 'MISSING', providerIssue: true },
      tradability: tradable,
    });

    expect(result.allowed).toBe(true);
    expect(result.mode).toBe('COUNTERFACTUAL_ONLY');
    expect(result.blockers).toContain('QUOTE_MISSING');
    expect(result.degradedReasons).toContain('QUOTE_COVERAGE_MISSING');
    expect(result.paperOrderAllowed).toBe(false);
    expect(result.virtualFillAllowed).toBe(false);
    expect(result.counterfactualLearningAllowed).toBe(true);
    expect(result.caseRecordingAllowed).toBe(true);
    expect(result.marketSignal).toBe(false);
  });

  it('halted tradability becomes observe-only while preserving learning records', () => {
    const result = normalizeShadowEligibilityForGate1({
      engineMode: 'NORMAL',
      marketSessionCompatibility: regularSession,
      quoteCoverage: verifiedQuote,
      tradability: { status: 'HALTED', providerIssue: false },
    });

    expect(result.allowed).toBe(true);
    expect(result.mode).toBe('OBSERVE_ONLY');
    expect(result.blockers).toContain('TRADABILITY_HALTED');
    expect(result.paperOrderAllowed).toBe(false);
    expect(result.virtualFillAllowed).toBe(false);
    expect(result.counterfactualLearningAllowed).toBe(true);
    expect(result.caseRecordingAllowed).toBe(true);
    expect(result.marketSignal).toBe(false);
  });
});
