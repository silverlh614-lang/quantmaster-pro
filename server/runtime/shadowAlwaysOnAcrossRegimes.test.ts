import { describe, expect, it } from 'vitest';
import { InMemoryShadowCaseLedger } from '../shadow/shadowCaseLedger.js';
import { recordShadowCaseForRuntimePolicy } from '../shadow/shadowCaseRecordingPolicy.js';
import { resolveEngineRuntimePolicy } from './engineRuntimePolicy.js';

describe('Shadow Always-On Across Regimes Patch v1', () => {
  it('keeps Shadow buy/sell/learning and counterfactuals enabled in R6_DEFENSE', () => {
    const policy = resolveEngineRuntimePolicy({
      engineMode: 'NORMAL',
      macroRegime: 'R6_DEFENSE',
      liveBuyGateAllowed: true,
      reasonCodes: ['R6_DEFENSE'],
    });

    expect(policy.liveEntryAllowed).toBe(false);
    expect(policy.liveExitAllowed).toBe(true);
    expect(policy.shadowBuyAllowed).toBe(true);
    expect(policy.shadowSellAllowed).toBe(true);
    expect(policy.shadowLearningAllowed).toBe(true);
    expect(policy.counterfactualAllowed).toBe(true);
    expect(policy.diagnosticAllowed).toBe(true);
    expect(policy.brokerOrderAllowed).toBe(false);
    expect(policy.executionImpact).toBe('NEW_BUY_BLOCKED_ONLY');
  });

  it('records an R6 live-buy block as a Shadow/counterfactual case without broker orders', () => {
    const ledger = new InMemoryShadowCaseLedger();
    const policy = resolveEngineRuntimePolicy({
      engineMode: 'NORMAL',
      macroRegime: 'R6_DEFENSE',
      liveBuyGateAllowed: true,
      reasonCodes: ['R6_DEFENSE'],
    });

    const row = recordShadowCaseForRuntimePolicy(ledger, {
      runtimePolicy: policy,
      caseId: 'r6-blocked-buy',
      symbol: '005930',
      marketSession: 'OPEN',
      blockedReason: 'R6_DEFENSE',
      learningTag: 'LIVE_ENTRY_BLOCKED_SHADOW_ALLOWED',
      dataHealth: 'VERIFIED',
      entryPriceVirtual: 70000,
      targetPriceVirtual: 74200,
      stopPriceVirtual: 67900,
    });

    expect(row.state).toBe('LIVE_BLOCKED_SHADOW_ALLOWED');
    expect(row.actualDecision).toBe('LIVE_BUY_BLOCKED');
    expect(row.shadowDecision).toBe('SHADOW_BUY_SELL_ALLOWED');
    expect(row.counterfactualRecorded).toBe(true);
    expect(row.rawRegime).toBe('R6_DEFENSE');
    expect(row.effectiveRegime).toBe('R6_DEFENSE');
    expect(row.regimePhase).toBe('R6_DEFENSE');
    expect(row.regimeAtSignal).toBe('R6_DEFENSE');
    expect(row.executionImpact).toBe('NONE');
    expect(row.brokerOrdersCreated).toBe(0);
  });

  it.each(['SELL_ONLY', 'SHADOW_ONLY', 'OBSERVE_ONLY'] as const)('%s blocks live entry but keeps Shadow always-on', (engineMode) => {
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
