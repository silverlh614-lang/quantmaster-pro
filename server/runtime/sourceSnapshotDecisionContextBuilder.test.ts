/**
 * @responsibility ADR-0535 read-model builder/renderer + invariant assertion regression (INV-1..INV-8).
 *
 * READ-MODEL ONLY: builder projects canonical regime/execution/scoring authorities into one
 * operator object. Tests assert the projection preserves the authority hierarchy and renders
 * the user's spec-D 7-line block.
 */
import { describe, expect, it } from 'vitest';

import {
  assertDecisionContextInvariants,
  buildDecisionContextFromScanSummaryView,
  buildSourceSnapshotDecisionContext,
  formatDecisionContextAuthorityBlock,
  toFinalExecutionPolicyDisplayLabel,
  type ScanSummaryDecisionContextInput,
} from './sourceSnapshotDecisionContextBuilder.js';
import type { SourceSnapshotExecutionPolicyInput } from './sourceSnapshotDecisionContext.js';
import type { EngineRuntimePolicy } from './engineRuntimePolicy.js';
import type { ResolvedRegimeSnapshot } from '../trading/regime/effectiveRegimeSnapshot.js';
import type { Gate0RegimeView } from '../../src/types/gate0Regime.js';
import type { RegimePositionPolicy } from '../trading/sizing/regimePositionPolicy.js';

// ── Fixtures (canonical SHADOW_ONLY / R3_EARLY / legacy-R5 from user spec-D) ──

function makeRegimeSnapshot(overrides: Partial<ResolvedRegimeSnapshot> = {}): ResolvedRegimeSnapshot {
  return {
    snapshotId: 'snap-001',
    asOf: '2026-05-27T01:00:00.000Z',
    ttlSec: 300,
    detectedRegime: 'R3_EARLY',
    effectiveRegime: 'R3_EARLY',
    displayRegime: 'SHADOW_ONLY',
    riskOverride: 'SHADOW_ONLY',
    engineMode: 'SHADOW_ONLY',
    biasScore: null,
    mhs: 62,
    dataHealth: {},
    sourceHealth: 'VERIFIED',
    stale: false,
    providerIssue: false,
    marketSignal: false,
    conflicts: [],
    diagnostics: { rawRegime: 'R3_EARLY' } as ResolvedRegimeSnapshot['diagnostics'],
    ...overrides,
  } as ResolvedRegimeSnapshot;
}

function makeGate0View(overrides: Partial<Gate0RegimeView> = {}): Gate0RegimeView {
  return {
    source: 'REGIME_RESOLVER_SNAPSHOT',
    effectiveRegime: 'R3_EARLY',
    displayRegime: 'SHADOW_ONLY',
    detectedRegime: 'R3_EARLY',
    riskOverride: 'SHADOW_ONLY',
    providerIssue: false,
    marketSignal: false,
    legacy: {
      legacyEffective: 'R5_CAUTION',
      deprecated: true,
      notUsedForDecision: true,
      source: 'REGIME_BRIDGE_TRANSITION_STATE',
    },
    ...overrides,
  } as Gate0RegimeView;
}

function makeRuntimePolicy(overrides: Partial<EngineRuntimePolicy> = {}): EngineRuntimePolicy {
  return {
    engineMode: 'SHADOW_ONLY',
    liveEntryAllowed: false,
    liveExitAllowed: true,
    brokerOrderAllowed: false,
    shadowBuyAllowed: true,
    shadowSellAllowed: true,
    shadowLearningAllowed: true,
    counterfactualAllowed: true,
    diagnosticAllowed: true,
    liveBlockReason: 'SHADOW_ONLY_POLICY',
    executionPermissionReason: 'SHADOW_ONLY_POLICY',
    finalExecutionPolicy: 'SHADOW_AND_DIAGNOSTIC_ONLY',
    executionImpact: 'NONE',
    scorePenalty: 1,
    sizingMultiplier: 0.7,
    ...overrides,
  } as EngineRuntimePolicy;
}

const POSITION_POLICY: RegimePositionPolicy = {
  regime: 'R3_EARLY',
  maxPositions: 5,
  maxGrossExposurePct: 50,
  perPositionPct: 10,
};

// ── toFinalExecutionPolicyDisplayLabel: all 4 branches ───────────────────────

describe('toFinalExecutionPolicyDisplayLabel (ADR-0535 4-value mapping)', () => {
  it('SELL_ONLY engineMode → SELL_ONLY', () => {
    expect(toFinalExecutionPolicyDisplayLabel('SELL_ONLY', 'R4_NEUTRAL', 'LIVE_ORDER_ALLOWED')).toBe('SELL_ONLY');
  });
  it('SELL_ONLY displayRegime → SELL_ONLY', () => {
    expect(toFinalExecutionPolicyDisplayLabel('NORMAL', 'SELL_ONLY', 'LIVE_ORDER_ALLOWED')).toBe('SELL_ONLY');
  });
  it('OBSERVE_ONLY engineMode → OBSERVE_ONLY', () => {
    expect(toFinalExecutionPolicyDisplayLabel('OBSERVE_ONLY', 'R4_NEUTRAL', 'SHADOW_AND_DIAGNOSTIC_ONLY')).toBe('OBSERVE_ONLY');
  });
  it('2-value LIVE_ORDER_ALLOWED → LIVE_ALLOWED', () => {
    expect(toFinalExecutionPolicyDisplayLabel('NORMAL', 'R2_BULL', 'LIVE_ORDER_ALLOWED')).toBe('LIVE_ALLOWED');
  });
  it('2-value SHADOW_AND_DIAGNOSTIC_ONLY → SHADOW_AND_DIAGNOSTIC_ONLY', () => {
    expect(toFinalExecutionPolicyDisplayLabel('SHADOW_ONLY', 'SHADOW_ONLY', 'SHADOW_AND_DIAGNOSTIC_ONLY')).toBe('SHADOW_AND_DIAGNOSTIC_ONLY');
  });
});

// ── buildSourceSnapshotDecisionContext: projection mapping ────────────────────

describe('buildSourceSnapshotDecisionContext (projection, no recompute)', () => {
  it('maps canonical SHADOW_ONLY/R3_EARLY/legacy-R5 fixture', () => {
    const ctx = buildSourceSnapshotDecisionContext({
      regimeSnapshot: makeRegimeSnapshot(),
      gate0View: makeGate0View(),
      executionPolicy: makeRuntimePolicy(),
      regimePositionPolicy: POSITION_POLICY,
    });
    expect(ctx.snapshotId).toBe('snap-001');
    expect(ctx.ttlSec).toBe(300);
    expect(ctx.marketRegime.rawRegime).toBe('R3_EARLY');
    expect(ctx.marketRegime.effectiveRegime).toBe('R3_EARLY');
    expect(ctx.marketRegime.displayRegime).toBe('SHADOW_ONLY');
    expect(ctx.marketRegime.riskOverride).toBe('SHADOW_ONLY');
    expect(ctx.marketRegime.policyView).toBe('SHADOW_ONLY');
    expect(ctx.marketRegime.legacyEffectiveRegime).toBe('R5_CAUTION');
    expect(ctx.marketRegime.legacyDeprecated).toBe(true);
    expect(ctx.marketRegime.legacyUsedForDecision).toBe(false);
    expect(ctx.marketRegime.source).toBe('RegimeResolver.canonicalOutput');
    expect(ctx.executionPolicy.finalExecutionPolicy).toBe('SHADOW_AND_DIAGNOSTIC_ONLY');
    expect(ctx.executionPolicy.liveEntryAllowed).toBe(false);
    expect(ctx.executionPolicy.brokerOrderAllowed).toBe(false);
    expect(ctx.executionPolicy.shadowLearningAllowed).toBe(true);
    expect(ctx.executionPolicy.executionImpact).toBe('NONE');
    expect(ctx.scoringPolicy.scorePenalty).toBe(1);
    expect(ctx.scoringPolicy.sizingMultiplier).toBe(0.7);
    expect(ctx.scoringPolicy.kellyMultiplier).toBe(1);
    expect(ctx.scoringPolicy.exposureCap).toBe(50);
    expect(ctx.scoringPolicy.maxPositions).toBe(5);
    expect(ctx.scoringPolicy.positionCap).toBe(10);
  });

  it('riskOverride NONE → riskOverride null and policyView = displayRegime', () => {
    const ctx = buildSourceSnapshotDecisionContext({
      regimeSnapshot: makeRegimeSnapshot({ riskOverride: 'NONE', displayRegime: 'R2_BULL', effectiveRegime: 'R2_BULL', detectedRegime: 'R2_BULL', engineMode: 'NORMAL' }),
      gate0View: makeGate0View({ displayRegime: 'R2_BULL', effectiveRegime: 'R2_BULL', riskOverride: 'NONE', legacy: undefined }),
      executionPolicy: makeRuntimePolicy({ engineMode: 'NORMAL', liveEntryAllowed: true, brokerOrderAllowed: true, finalExecutionPolicy: 'LIVE_ORDER_ALLOWED', executionImpact: 'LIVE_ORDER_ALLOWED' }),
      regimePositionPolicy: { regime: 'R2_BULL', maxPositions: 6, maxGrossExposurePct: 60, perPositionPct: 10 },
      kellyMultiplier: 0.85,
    });
    expect(ctx.marketRegime.riskOverride).toBeNull();
    expect(ctx.marketRegime.policyView).toBe('R2_BULL');
    expect(ctx.marketRegime.legacyEffectiveRegime).toBeUndefined();
    expect(ctx.executionPolicy.finalExecutionPolicy).toBe('LIVE_ALLOWED');
    expect(ctx.executionPolicy.executionImpact).toBe('NONE'); // LIVE_ORDER_ALLOWED display-normalized to NONE
    expect(ctx.scoringPolicy.kellyMultiplier).toBe(0.85);
  });
});

// ── formatDecisionContextAuthorityBlock: exact spec-D 7 lines + legacy + diff ─

describe('formatDecisionContextAuthorityBlock (shared renderer)', () => {
  it('renders the user spec-D 7 lines + legacy line', () => {
    const ctx = buildSourceSnapshotDecisionContext({
      regimeSnapshot: makeRegimeSnapshot(),
      gate0View: makeGate0View(),
      executionPolicy: makeRuntimePolicy(),
      regimePositionPolicy: POSITION_POLICY,
    });
    const lines = formatDecisionContextAuthorityBlock(ctx);
    expect(lines).toEqual([
      '🧭 Market Raw: R3_EARLY',
      '🎚 Scoring Effective: R3_EARLY',
      '🛡 Display/Policy: SHADOW_ONLY (riskOverride=SHADOW_ONLY)',
      '🚦 Execution: SHADOW_AND_DIAGNOSTIC_ONLY',
      '🔴 Live Buy: BLOCKED',
      '🟢 Shadow/Learning: ON',
      'snapshotId=snap-001 asOf=2026-05-27T01:00:00.000Z ttlSec=300',
      'legacyEffectiveRegime=R5_CAUTION deprecated=true usedForDecision=false',
    ]);
  });

  it('LIVE_ALLOWED renders 🟢 Live Buy ALLOWED and no riskOverride suffix when null', () => {
    const ctx = buildSourceSnapshotDecisionContext({
      regimeSnapshot: makeRegimeSnapshot({ riskOverride: 'NONE', displayRegime: 'R2_BULL', effectiveRegime: 'R2_BULL', detectedRegime: 'R2_BULL', engineMode: 'NORMAL' }),
      gate0View: makeGate0View({ displayRegime: 'R2_BULL', effectiveRegime: 'R2_BULL', riskOverride: 'NONE', legacy: undefined }),
      executionPolicy: makeRuntimePolicy({ engineMode: 'NORMAL', liveEntryAllowed: true, brokerOrderAllowed: true, finalExecutionPolicy: 'LIVE_ORDER_ALLOWED' }),
      regimePositionPolicy: POSITION_POLICY,
    });
    const lines = formatDecisionContextAuthorityBlock(ctx);
    expect(lines).toContain('🛡 Display/Policy: R2_BULL');
    expect(lines).toContain('🚦 Execution: LIVE_ALLOWED');
    expect(lines).toContain('🟢 Live Buy: ALLOWED');
    expect(lines.some(l => l.startsWith('legacyEffectiveRegime='))).toBe(false);
  });

  it('different comparison snapshotId → DIFFERENT_SNAPSHOT marker', () => {
    const ctx = buildSourceSnapshotDecisionContext({
      regimeSnapshot: makeRegimeSnapshot(),
      gate0View: makeGate0View(),
      executionPolicy: makeRuntimePolicy(),
      regimePositionPolicy: POSITION_POLICY,
    });
    const lines = formatDecisionContextAuthorityBlock(ctx, { comparisonSnapshotId: 'snap-OTHER' });
    expect(lines).toContain('⚠️ DIFFERENT_SNAPSHOT: this=snap-001 other=snap-OTHER');
  });

  it('same comparison snapshotId → NO DIFFERENT_SNAPSHOT marker (INV-5 parity)', () => {
    const ctx = buildSourceSnapshotDecisionContext({
      regimeSnapshot: makeRegimeSnapshot(),
      gate0View: makeGate0View(),
      executionPolicy: makeRuntimePolicy(),
      regimePositionPolicy: POSITION_POLICY,
    });
    const lines = formatDecisionContextAuthorityBlock(ctx, { comparisonSnapshotId: 'snap-001' });
    expect(lines.some(l => l.includes('DIFFERENT_SNAPSHOT'))).toBe(false);
  });
});

// ── INV-5: cross-screen parity (macro card vs scan_blockers, same snapshot) ───

describe('cross-screen parity (INV-5): macro-card builder vs scan-summary builder', () => {
  const sharedExecutionPolicy: SourceSnapshotExecutionPolicyInput = {
    finalExecutionPolicy: 'SHADOW_AND_DIAGNOSTIC_ONLY',
    liveEntryAllowed: false,
    liveExitAllowed: true,
    brokerOrderAllowed: false,
    shadowBuyAllowed: true,
    shadowSellAllowed: true,
    shadowLearningAllowed: true,
    counterfactualAllowed: true,
    diagnosticAllowed: true,
    liveBlockReason: 'SHADOW_ONLY_POLICY',
    executionPermissionReason: 'SHADOW_ONLY_POLICY',
    executionImpact: 'NONE',
    engineMode: 'SHADOW_ONLY',
    scorePenalty: 1,
    sizingMultiplier: 0.7,
  };

  it('same snapshotId ⟹ structurally equal {raw,effective,display,riskOverride,executionPolicy}', () => {
    const macroCtx = buildSourceSnapshotDecisionContext({
      regimeSnapshot: makeRegimeSnapshot(),
      gate0View: makeGate0View(),
      executionPolicy: makeRuntimePolicy(),
      regimePositionPolicy: POSITION_POLICY,
    });
    const scanInput: ScanSummaryDecisionContextInput = {
      snapshotId: 'snap-001',
      asOf: '2026-05-27T01:00:00.000Z',
      ttlSec: 300,
      rawRegime: 'R3_EARLY',
      effectiveRegime: 'R3_EARLY',
      displayRegime: 'SHADOW_ONLY',
      riskOverride: 'SHADOW_ONLY',
      legacyEffectiveRegime: 'R5_CAUTION',
      executionPolicy: sharedExecutionPolicy,
      exposureCap: 50,
      maxPositions: 5,
      positionCap: 10,
    };
    const scanCtx = buildDecisionContextFromScanSummaryView(scanInput);
    expect(scanCtx.marketRegime).toEqual(macroCtx.marketRegime);
    expect(scanCtx.executionPolicy).toEqual(macroCtx.executionPolicy);
    expect(formatDecisionContextAuthorityBlock(scanCtx)).toEqual(formatDecisionContextAuthorityBlock(macroCtx));
  });
});

// ── assertDecisionContextInvariants: valid + crafted violations ───────────────

describe('assertDecisionContextInvariants (INV-1..INV-7 diagnostic)', () => {
  it('returns [] for the canonical SHADOW_ONLY/R3_EARLY/legacy-R5 fixture', () => {
    const ctx = buildSourceSnapshotDecisionContext({
      regimeSnapshot: makeRegimeSnapshot(),
      gate0View: makeGate0View(),
      executionPolicy: makeRuntimePolicy(),
      regimePositionPolicy: POSITION_POLICY,
    });
    expect(assertDecisionContextInvariants(ctx)).toEqual([]);
  });

  it('INV-2: liveEntry true under SHADOW_AND_DIAGNOSTIC_ONLY → ["INV-2"]', () => {
    const ctx = buildSourceSnapshotDecisionContext({
      regimeSnapshot: makeRegimeSnapshot(),
      gate0View: makeGate0View(),
      executionPolicy: makeRuntimePolicy({ liveEntryAllowed: true }),
      regimePositionPolicy: POSITION_POLICY,
    });
    expect(assertDecisionContextInvariants(ctx)).toContain('INV-2');
  });

  it('INV-3: brokerOrderAllowed true under displayRegime=SHADOW_ONLY → ["INV-3"]', () => {
    const ctx = buildSourceSnapshotDecisionContext({
      regimeSnapshot: makeRegimeSnapshot(),
      gate0View: makeGate0View(),
      executionPolicy: makeRuntimePolicy({ brokerOrderAllowed: true }),
      regimePositionPolicy: POSITION_POLICY,
    });
    expect(assertDecisionContextInvariants(ctx)).toContain('INV-3');
  });

  it('INV-7: SHADOW_ONLY in effectiveRegime slot → ["INV-7"]', () => {
    const ctx = buildSourceSnapshotDecisionContext({
      regimeSnapshot: makeRegimeSnapshot({ effectiveRegime: 'SHADOW_ONLY' }),
      gate0View: makeGate0View(),
      executionPolicy: makeRuntimePolicy(),
      regimePositionPolicy: POSITION_POLICY,
    });
    expect(assertDecisionContextInvariants(ctx)).toContain('INV-7');
  });

  it('INV-4: legacyUsedForDecision is literally false in every build', () => {
    const ctx = buildSourceSnapshotDecisionContext({
      regimeSnapshot: makeRegimeSnapshot(),
      gate0View: makeGate0View(),
      executionPolicy: makeRuntimePolicy(),
      regimePositionPolicy: POSITION_POLICY,
    });
    expect(ctx.marketRegime.legacyUsedForDecision).toBe(false);
    expect(assertDecisionContextInvariants(ctx)).not.toContain('INV-4');
  });
});
