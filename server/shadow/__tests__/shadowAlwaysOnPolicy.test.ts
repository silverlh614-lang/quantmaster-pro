// @responsibility Verify Shadow Always-On policy invariants for defensive and diagnostic modes.
import { describe, expect, it } from 'vitest';
import { resolveMarketStateShadowPolicy } from '../../trading/marketStateResolver.js';
import { resolveShadowAlwaysOnPolicy } from '../shadowAlwaysOnPolicy.js';

describe('resolveShadowAlwaysOnPolicy', () => {
  it('keeps Shadow and counterfactual lanes alive in R6_DEFENSE', () => {
    const policy = resolveShadowAlwaysOnPolicy({
      engineMode: 'R6_DEFENSE',
      effectiveRegime: 'R6_DEFENSE',
      liveExecutionAllowed: true,
      realOrderAllowed: true,
    });

    expect(policy.liveBuyAllowed).toBe(true);
    expect(policy.liveSellAllowed).toBe(true);
    expect(policy.shadowScanAllowed).toBe(true);
    expect(policy.shadowSignalAllowed).toBe(true);
    expect(policy.shadowPaperFillAllowed).toBe(true);
    expect(policy.shadowPositionManagementAllowed).toBe(true);
    expect(policy.shadowExitAllowed).toBe(true);
    expect(policy.shadowLearningAllowed).toBe(true);
    expect(policy.counterfactualAllowed).toBe(true);
    expect(policy.executionImpact).toBe('NONE');
  });

  it('ignores removed SELL_ONLY while preserving Shadow learning', () => {
    const policy = resolveShadowAlwaysOnPolicy({ engineMode: 'SELL_ONLY', liveExecutionAllowed: true });

    expect(policy.liveBuyAllowed).toBe(true);
    expect(policy.liveSellAllowed).toBe(true);
    expect(policy.shadowLearningAllowed).toBe(true);
    expect(policy.counterfactualAllowed).toBe(true);
    expect(policy.executionImpact).toBe('NONE');
  });

  it('keeps paper fill and learning available in SHADOW_ONLY', () => {
    const policy = resolveShadowAlwaysOnPolicy({ engineMode: 'SHADOW_ONLY' });

    expect(policy.liveBuyAllowed).toBe(false);
    expect(policy.shadowPaperFillAllowed).toBe(true);
    expect(policy.shadowLearningAllowed).toBe(true);
  });

  it('keeps Shadow learning available in OBSERVE_ONLY', () => {
    const policy = resolveShadowAlwaysOnPolicy({ engineMode: 'OBSERVE_ONLY' });

    expect(policy.liveBuyAllowed).toBe(false);
    expect(policy.shadowLearningAllowed).toBe(true);
    expect(policy.counterfactualAllowed).toBe(true);
  });

  it('does not turn providerIssue into a market signal or stop Shadow learning', () => {
    const policy = resolveShadowAlwaysOnPolicy({
      engineMode: 'NORMAL',
      providerIssue: true,
      liveExecutionAllowed: true,
    });

    expect(policy.invariant.providerIssueDoesNotBecomeMarketSignal).toBe(true);
    expect(policy.shadowLearningAllowed).toBe(true);
    expect(policy.counterfactualAllowed).toBe(true);
  });

  it('keeps learning and counterfactual lanes available in HARD_BLOCK', () => {
    const policy = resolveShadowAlwaysOnPolicy({ engineMode: 'HARD_BLOCK', liveExecutionAllowed: true });

    expect(policy.liveBuyAllowed).toBe(false);
    expect(policy.shadowLearningAllowed).toBe(true);
    expect(policy.counterfactualAllowed).toBe(true);
    expect(policy.invariant.shadowLearningAlwaysOn).toBe(true);
  });

  it('reports live-blocked-does-not-block-shadow invariant as true', () => {
    const policy = resolveShadowAlwaysOnPolicy({ engineMode: 'SELL_ONLY' });

    expect(policy.invariant.liveBlockedDoesNotBlockShadow).toBe(true);
    expect(policy.invariant.shadowLearningAlwaysOn).toBe(true);
  });

  it('keeps NOW snapshot shadow flags consistent with the policy result', () => {
    const snapshot = {
      effectiveRegime: 'R6_DEFENSE' as const,
      riskOverride: 'BLACK_SWAN' as const,
      executionMode: 'SELL_ONLY' as const,
      liveNewBuyAllowed: false,
      liveSellAllowed: true,
      shadowScanAllowed: true,
      shadowSignalAllowed: true,
      shadowLearningAllowed: true,
      shadowPaperFillAllowed: true,
    };
    const policy = resolveMarketStateShadowPolicy(snapshot);

    expect(snapshot.shadowScanAllowed).toBe(policy.shadowScanAllowed);
    expect(snapshot.shadowSignalAllowed).toBe(policy.shadowSignalAllowed);
    expect(snapshot.shadowLearningAllowed).toBe(policy.shadowLearningAllowed);
    expect(snapshot.shadowPaperFillAllowed).toBe(policy.shadowPaperFillAllowed);
  });
});
