// @responsibility Gate0 macro signal validity plus permission resolver tests.
import { describe, expect, it } from 'vitest';
import {
  buildGate0Decision,
  resolveMacroSnapshotFreshness,
  resolveMacroSignalValidity,
} from './gate0MacroPermissionDecision.js';
import type { MacroGateState, ScanSummary } from './scanSummaryTypes.js';

const NOW = new Date('2026-05-26T13:04:08.000Z');

function macro(overrides: Partial<MacroGateState> = {}): MacroGateState {
  return {
    emergencyStop: false,
    autoTradeEnabled: true,
    regime: 'R3_EARLY',
    kellyMultiplierFromRegime: 0.7,
    fomcPhase: 'NORMAL',
    fomcKellyMultiplier: 1,
    finalKellyMultiplier: 0,
    vixGatingActive: false,
    bearDefenseMode: false,
    mhsBelow30: false,
    watchlistEmpty: false,
    sellOnlyMode: false,
    macroRegimeRaw: 'R3_EARLY',
    macroRegimeEffective: 'R3_EARLY',
    displayRegime: 'SHADOW_ONLY',
    riskOverride: 'SHADOW_ONLY',
    engineMode: 'SHADOW_ONLY',
    sourceHealth: 'VERIFIED',
    regimeSnapshotId: 'mkt_20260526065715_1poh1cq',
    regimeSnapshotAsOf: '2026-05-26T13:02:00.000Z',
    regimeSnapshotTtlSec: 300,
    liveEntryAllowed: true,
    liveExitAllowed: true,
    brokerRouteAlive: true,
    brokerLiveOrderAllowed: true,
    paperOrderAllowed: true,
    shadowAllowed: true,
    shadowLearningAllowed: true,
    counterfactualAllowed: true,
    diagnosticAllowed: true,
    ...overrides,
  };
}

function summary(mg: MacroGateState): ScanSummary {
  return {
    time: '2026-05-26T13:04:08.000Z',
    snapshotId: 'scan-eval-20260526220408',
    candidates: 0,
    trackB: 0,
    swing: 0,
    catalyst: 0,
    momentum: 0,
    yahooFails: 0,
    gateMisses: 0,
    rrrMisses: 0,
    entries: 0,
    macroGateState: mg,
  };
}

describe('Gate0 macro signal validity / permission resolver', () => {
  it('keeps stale mhs=null snapshots out of macroMarketSignal while preserving shadow learning', () => {
    const decision = buildGate0Decision(summary(macro({
      sourceHealth: 'STALE',
      regimeSnapshotAsOf: '2026-05-26T06:57:15.433Z',
      mhs: undefined,
      kospi20dReturn: undefined,
      liveEntryBlockedReason: 'R3_SANITY_GUARD',
    })), NOW);

    expect(decision.macroSnapshotAvailable).toBe(true);
    expect(decision.macroMarketSignal).toBe(false);
    expect(decision.macroSignalConfidence).toBe('MISSING_OR_PARTIAL');
    expect(decision.macroSignalReason).toBe('MHS_OR_KOSPI20D_RETURN_MISSING');
    expect(decision.macroSignalUsableForLive).toBe(false);
    expect(decision.macroSignalUsableForShadow).toBe(true);
    expect(decision.liveEntryAllowed).toBe(false);
    expect(decision.shadowAllowed).toBe(true);
    expect(decision.executionImpact).toBe('NONE');
  });

  it('keeps stale complete snapshots diagnostic/shadow-only and macroMarketSignal=false', () => {
    const freshness = resolveMacroSnapshotFreshness(macro({
      sourceHealth: 'STALE',
      mhs: 70,
      kospi20dReturn: 2.4,
    }), NOW);
    const validity = resolveMacroSignalValidity(macro({
      sourceHealth: 'STALE',
      mhs: 70,
      kospi20dReturn: 2.4,
    }), freshness);

    expect(freshness.macroSnapshotAvailable).toBe(true);
    expect(validity.macroMarketSignal).toBe(false);
    expect(validity.macroSignalConfidence).toBe('STALE');
    expect(validity.macroSignalUsableForLive).toBe(false);
    expect(validity.macroSignalUsableForShadow).toBe(true);
  });

  it('allows verified complete macro data to produce a live-usable market signal when policy permits', () => {
    const decision = buildGate0Decision(summary(macro({
      engineMode: 'NORMAL',
      displayRegime: 'R3_EARLY',
      riskOverride: 'NONE',
      mhs: 70,
      kospi20dReturn: 2.4,
      finalKellyMultiplier: 0.7,
      brokerRouteAlive: true,
      brokerLiveOrderAllowed: true,
    })), NOW);

    expect(decision.macroSignalConfidence).toBe('VERIFIED');
    expect(decision.macroMarketSignal).toBe(true);
    expect(decision.macroSignalUsableForLive).toBe(true);
    expect(decision.liveEntryAllowed).toBe(true);
  });

  it('normalizes SHADOW_ONLY as the direct live block reason while keeping observation lanes open', () => {
    const decision = buildGate0Decision(summary(macro({
      mhs: 70,
      kospi20dReturn: 2.4,
      liveEntryBlockedReason: 'R3_SANITY_GUARD',
    })), NOW);

    expect(decision.liveEntryAllowed).toBe(false);
    expect(decision.brokerLiveOrderAllowed).toBe(false);
    expect(decision.paperOrderAllowed).toBe(true);
    expect(decision.shadowAllowed).toBe(true);
    expect(decision.counterfactualAllowed).toBe(true);
    expect(decision.diagnosticAllowed).toBe(true);
    expect(decision.executionImpact).toBe('NONE');
    expect(decision.liveBlockReason).toBe('SHADOW_ONLY_POLICY');
    expect(decision.liveBlockSubReason).toBe('R3_SANITY_GUARD');
  });

  it('isolates providerIssue from marketSignal derivation', () => {
    const decision = buildGate0Decision(summary(macro({
      providerIssue: true,
      mhs: undefined,
      kospi20dReturn: undefined,
    })), NOW);

    expect(decision.providerIssueIsolated).toBe(true);
    expect(decision.macroMarketSignal).toBe(false);
    expect(decision.macroSignalReason).toBe('MHS_OR_KOSPI20D_RETURN_MISSING');
  });

  it('keeps emergency stop as execution permission only and leaves diagnostics alive', () => {
    const decision = buildGate0Decision(summary(macro({
      emergencyStop: true,
      engineMode: 'NORMAL',
      displayRegime: 'R3_EARLY',
      riskOverride: 'NONE',
      mhs: 70,
      kospi20dReturn: 2.4,
    })), NOW);

    expect(decision.liveEntryAllowed).toBe(false);
    expect(decision.paperOrderAllowed).toBe(false);
    expect(decision.shadowAllowed).toBe(true);
    expect(decision.diagnosticAllowed).toBe(true);
    expect(decision.executionImpact).toBe('NONE');
  });
});
