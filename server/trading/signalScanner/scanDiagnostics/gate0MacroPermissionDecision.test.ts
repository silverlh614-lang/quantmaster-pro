// @responsibility Gate0 macro signal validity plus permission resolver tests.
import { describe, expect, it } from 'vitest';
import {
  buildGate0Decision,
  resolveMacroSnapshotFreshness,
  resolveMacroSignalValidity,
  resolveScoringEffectiveRegime,
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
    quoteFails: 0,
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

  it('keeps EOD snapshots report/shadow-valid but blocks live and broker order permission', () => {
    const decision = buildGate0Decision(summary(macro({
      sourceHealth: 'VERIFIED',
      sourceFreshness: 'EOD_SNAPSHOT_VALID',
      regimeSnapshotAsOf: '2026-05-26T06:57:15.433Z',
      regimeSnapshotAgeSec: 22680,
      mhs: 58,
      kospi20dReturn: 3.2,
      liveEntryBlockedReason: 'R3_SANITY_GUARD',
    })), NOW);

    expect(decision.usableForReport).toBe(true);
    expect(decision.usableForShadow).toBe(true);
    expect(decision.usableForCounterfactual).toBe(true);
    expect(decision.usableForDiagnostic).toBe(true);
    expect(decision.usableForLiveOrder).toBe(false);
    expect(decision.usableForBrokerOrder).toBe(false);
    expect(decision.snapshotFreshnessForLive).toBe('STALE');
    expect(decision.snapshotFreshnessForShadow).toBe('EOD_VALID');
    expect(decision.liveEntryAllowed).toBe(false);
    expect(decision.brokerOrderAllowed).toBe(false);
    expect(decision.liveBlockReason).toBe('EOD_SNAPSHOT_NOT_LIVE_TRADABLE');
    expect(decision.liveBlockSubReason).toBe('SHADOW_ONLY_POLICY');
    expect(decision.executionImpact).toBe('NONE');
  });

  it('marks implausible VKOSPI as diagnostic-only and excludes it from scoring', () => {
    const decision = buildGate0Decision(summary(macro({
      engineMode: 'NORMAL',
      displayRegime: 'R3_EARLY',
      riskOverride: 'NONE',
      mhs: 58,
      kospi20dReturn: 3.2,
      vkospi: 67,
      vkospiTrustState: 'UNTRUSTED_IMPLAUSIBLE',
      vkospiSanityReasons: ['VKOSPI_UNTRUSTED_IMPLAUSIBLE_PROVIDER_SANITY'],
    })), NOW);

    expect(decision.vkospiValue).toBe(67);
    expect(decision.vkospiConfidence).toBe('UNTRUSTED');
    expect(decision.vkospiUsableForRegime).toBe(false);
    expect(decision.vkospiUsableForR6Trigger).toBe(false);
    expect(decision.vkospiUsableForRecovery).toBe(false);
    expect(decision.vkospiDisplayMode).toBe('DIAGNOSTIC_ONLY');
    expect(decision.scorePenaltyReason).toBe('VKOSPI_UNTRUSTED_EXCLUDED_FROM_SCORING');
    expect(decision.macroMarketSignal).toBe(false);
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

describe('resolveScoringEffectiveRegime — scoring SSOT (ADR-0531 정합)', () => {
  // persistScanResults Gate1 dry-run 관측 row(:1350/:1352/:1514/:1516)가 폐기된 bare
  // `macroRegimeEffective ?? regime ?? 'UNKNOWN'` 에서 이 함수로 통일됐다. 아래 케이스가
  // 비-R6·genuine R6 에서 byte-equivalent 이고 stale-R6 누출만 차단함을 잠근다(swap 안전성 회귀).
  const legacyExpr = (mg: MacroGateState): string =>
    mg.macroRegimeEffective ?? mg.regime ?? 'UNKNOWN';

  it('non-R6: scoring SSOT 가 폐기 표현식과 동일 (byte-equivalent)', () => {
    const mg = macro({ regime: 'R3_EARLY', macroRegimeRaw: 'R3_EARLY', macroRegimeEffective: 'R3_EARLY' });
    expect(resolveScoringEffectiveRegime(mg)).toBe('R3_EARLY');
    expect(resolveScoringEffectiveRegime(mg)).toBe(legacyExpr(mg));
  });

  it('genuine R6(raw=effective=R6, regime=R4 sanitize): R6_DEFENSE 보존 (byte-equivalent)', () => {
    const mg = macro({
      regime: 'R4_NEUTRAL',
      macroRegimeRaw: 'R6_DEFENSE',
      macroRegimeEffective: 'R6_DEFENSE',
      displayRegime: 'SHADOW_ONLY',
      riskOverride: 'SHADOW_ONLY',
    });
    expect(resolveScoringEffectiveRegime(mg)).toBe('R6_DEFENSE');
    expect(resolveScoringEffectiveRegime(mg)).toBe(legacyExpr(mg));
  });

  it('stale-R6 누출(legacy effective 만 R6, raw 는 회복): raw 로 차단 → 폐기 표현식과 갈라짐', () => {
    const mg = macro({
      regime: 'R4_NEUTRAL',
      macroRegimeRaw: 'R4_NEUTRAL',
      macroRegimeEffective: 'R6_DEFENSE',
      displayRegime: 'SHADOW_ONLY',
      riskOverride: 'SHADOW_ONLY',
    });
    expect(resolveScoringEffectiveRegime(mg)).toBe('R4_NEUTRAL');
    // 폐기 표현식은 stale R6 를 그대로 누출했었다 — 이 패치가 차단하는 버그.
    expect(legacyExpr(mg)).toBe('R6_DEFENSE');
    expect(resolveScoringEffectiveRegime(mg)).not.toBe(legacyExpr(mg));
  });

  it('null/undefined macro: UNKNOWN 반환 (Gate2 outcome seed 의 undefined 계약 가드 근거)', () => {
    // resolveScoringEffectiveRegime 는 절대 undefined 를 반환하지 않는다 → persistScanResults
    // Gate2 outcome seed(:1691)는 `macroGateState ? resolve(...) : undefined` 가드로 기존
    // undefined 계약을 보존한다(byte-equivalent). no-entry display(:1814)는 'UNKNOWN' fallback 동일.
    expect(resolveScoringEffectiveRegime(null)).toBe('UNKNOWN');
    expect(resolveScoringEffectiveRegime(undefined)).toBe('UNKNOWN');
  });
});
