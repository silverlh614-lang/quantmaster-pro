import { describe, expect, it } from 'vitest';
import { resolveEngineRuntimePolicy } from './engineRuntimePolicy.js';

describe('Shadow Always-On Across Regimes Patch v1', () => {
  it('keeps Shadow buy/sell/learning and counterfactuals enabled in R6_DEFENSE', () => {
    const policy = resolveEngineRuntimePolicy({
      engineMode: 'NORMAL',
      macroRegime: 'R6_DEFENSE',
      liveBuyGateAllowed: true,
      reasonCodes: ['R6_DEFENSE'],
    });

    expect(policy.liveEntryAllowed).toBe(true);
    expect(policy.liveExitAllowed).toBe(true);
    expect(policy.liveBuyAllowed).toBe(true);
    expect(policy.shadowBuyAllowed).toBe(true);
    expect(policy.shadowSellAllowed).toBe(true);
    expect(policy.shadowLearningAllowed).toBe(true);
    expect(policy.counterfactualAllowed).toBe(true);
    expect(policy.diagnosticAllowed).toBe(true);
    expect(policy.brokerOrderAllowed).toBe(true);
    expect(policy.executionImpact).toBe('LIVE_ORDER_ALLOWED');
    expect(policy.reasonCodes).not.toContain('R6_DEFENSE');
  });

  it('SELL_ONLY blocks live entry permission only and keeps Shadow always-on', () => {
    const policy = resolveEngineRuntimePolicy({ engineMode: 'SELL_ONLY', liveBuyGateAllowed: true });

    expect(policy.engineMode).toBe('NORMAL');
    expect(policy.gateEvaluationAllowed).toBe(true);
    expect(policy.shadowEvaluationAllowed).toBe(true);
    expect(policy.liveEntryAllowed).toBe(false);
    expect(policy.liveBlockReason).toBe('SELL_ONLY_MODE');
    expect(policy.brokerOrderAllowed).toBe(false);
    expect(policy.shadowLearningAllowed).toBe(true);
  });

  it.each(['SHADOW_ONLY', 'OBSERVE_ONLY'] as const)('%s blocks live entry but keeps Shadow always-on', (engineMode) => {
    const policy = resolveEngineRuntimePolicy({ engineMode, liveBuyGateAllowed: true });

    expect(policy.liveEntryAllowed).toBe(false);
    expect(policy.liveExitAllowed).toBe(true);
    expect(policy.shadowBuyAllowed).toBe(true);
    expect(policy.shadowSellAllowed).toBe(true);
    expect(policy.shadowLearningAllowed).toBe(true);
    expect(policy.counterfactualAllowed).toBe(true);
    expect(policy.brokerOrderAllowed).toBe(false);
  });

  it('HARD_BLOCK blocks live entry only and leaves learning/counterfactual lanes available', () => {
    const policy = resolveEngineRuntimePolicy({
      engineMode: 'NORMAL',
      hardBlock: true,
      liveBuyGateAllowed: true,
      reasonCodes: ['HARD_BLOCK'],
    });

    expect(policy.liveEntryAllowed).toBe(false);
    expect(policy.liveExitAllowed).toBe(true);
    expect(policy.shadowBuyAllowed).toBe(true);
    expect(policy.shadowSellAllowed).toBe(true);
    expect(policy.shadowLearningAllowed).toBe(true);
    expect(policy.counterfactualAllowed).toBe(true);
    expect(policy.brokerOrderAllowed).toBe(false);
  });
});
