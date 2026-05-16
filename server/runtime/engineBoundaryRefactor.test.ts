import { describe, expect, it } from 'vitest';
import { normalizeDataSignal, canUseDataSignalInCore } from '../data/dataConfidenceRouter.js';
import { classifyDiagnosticIsolation } from '../diagnostics/diagnosticIsolationPolicy.js';
import { InMemoryShadowCaseLedger } from '../shadow/shadowCaseLedger.js';
import { recordShadowCaseForRuntimePolicy } from '../shadow/shadowCaseRecordingPolicy.js';
import { resolveTelegramCommandPolicy } from '../telegram/telegramCommandPolicy.js';
import { resolveFinalDecision, type GateResult } from '../trading/gates/finalDecisionResolver.js';
import {
  applyProviderSignalToEngineState,
  buildEngineState,
  resolveEngineRuntimePolicy,
} from './engineRuntimePolicy.js';

function gate(overrides: Partial<GateResult>): GateResult {
  return {
    gateName: 'Gate0Macro',
    passed: true,
    score: 1,
    maxScore: 1,
    confidence: 'VERIFIED',
    blockers: [],
    warnings: [],
    evidence: [],
    ...overrides,
  };
}

describe('engine boundary refactor policy contracts', () => {
  it('keeps the engine alive when KIS returns a provider 500', () => {
    const signal = normalizeDataSignal({
      source: 'KIS',
      rawStatus: 'HTTP_500',
      requestedMarketSignal: true,
      promotionStage: 'CORE',
    });
    const engineState = buildEngineState({ engineMode: 'NORMAL', liveBuyGateAllowed: true });
    const next = applyProviderSignalToEngineState({
      current: engineState,
      providerIssue: signal.providerIssue,
      reasonCode: signal.reasonCode,
    });

    expect(next.engineAlive).toBe(true);
    expect(next.reasonCodes).toContain('PROVIDER_ERROR_IS_NOT_MARKET_SIGNAL');
  });

  it('classifies KIS provider 500 as providerIssue, not marketSignal', () => {
    const signal = normalizeDataSignal({ source: 'KIS', rawStatus: 'HTTP_500', requestedMarketSignal: true });

    expect(signal.providerIssue).toBe(true);
    expect(signal.marketSignal).toBe(false);
    expect(signal.executionImpact).toBe('NONE');
  });

  it('keeps SELL_ONLY live sells and shadow learning available while blocking live buys', () => {
    const policy = resolveEngineRuntimePolicy({ engineMode: 'SELL_ONLY' });

    expect(policy.liveBuyAllowed).toBe(false);
    expect(policy.liveSellAllowed).toBe(true);
    expect(policy.shadowAllowed).toBe(true);
    expect(policy.learningAllowed).toBe(true);
  });

  it('records SHADOW_ONLY cases with executionImpact NONE', () => {
    const ledger = new InMemoryShadowCaseLedger();
    const runtimePolicy = resolveEngineRuntimePolicy({ engineMode: 'SHADOW_ONLY', reasonCodes: ['MANUAL_SHADOW'] });

    const shadowCase = recordShadowCaseForRuntimePolicy(ledger, {
      runtimePolicy,
      caseId: 'case-shadow-only',
      symbol: '005930',
      marketSession: 'OPEN',
      learningTag: 'SHADOW_ONLY_POLICY_BLOCK',
      dataHealth: 'VERIFIED',
      entryPriceVirtual: 70000,
      stopPriceVirtual: 67900,
      targetPriceVirtual: 74200,
      horizon1d: { outcomeLabel: 'ACTIVE', returnPct: 0.3, checkedAt: '2026-05-16T00:00:00.000Z' },
    });

    expect(shadowCase.engineMode).toBe('SHADOW_ONLY');
    expect(shadowCase.executionImpact).toBe('NONE');
    expect(shadowCase.brokerOrdersCreated).toBe(0);
    expect(shadowCase.virtualOutcome1d).toBe('ACTIVE');
  });

  it('caps AI_ESTIMATED data before CORE use', () => {
    const signal = normalizeDataSignal({
      source: 'AI_MODEL',
      confidence: 'AI_ESTIMATED',
      promotionStage: 'CORE',
      requestedMarketSignal: true,
    });

    expect(signal.confidence).toBe('AI_ESTIMATED');
    expect(signal.promotionStage).toBe('ADVISORY');
    expect(canUseDataSignalInCore(signal)).toBe(false);
  });

  it('isolates P3 diagnostic budget overflow from data vacuum and blocking', () => {
    const result = classifyDiagnosticIsolation({
      phase: 'P3_SCAN_DIAGNOSTIC',
      budgetExceeded: true,
      coreDataMissing: true,
    });

    expect(result.diagnosticSuppressed).toBe(true);
    expect(result.blocking).toBe(false);
    expect(result.dataVacuum).toBe(false);
    expect(result.executionImpact).toBe('NONE');
  });

  it('forbids Telegram commands from re-running gate evaluation', () => {
    const policy = resolveTelegramCommandPolicy('RECOMPUTE_GATE');

    expect(policy.allowed).toBe(false);
    expect(policy.gateEvaluationAllowed).toBe(false);
    expect(policy.providerCallAllowed).toBe(false);
    expect(policy.engineModeMutationAllowed).toBe(false);
  });

  it('does not convert ACCEPTED_EMPTY into a bearish market signal', () => {
    const signal = normalizeDataSignal({
      source: 'KIS_PROGRAM',
      rawStatus: 'ACCEPTED_EMPTY',
      requestedMarketSignal: true,
    });

    expect(signal.providerIssue).toBe(false);
    expect(signal.marketSignal).toBe(false);
    expect(signal.reasonCode).toBe('EMPTY_VALID_NOT_BEARISH');
  });

  it('prevents Gate 1 failure from resolving to BUY or STRONG_BUY', () => {
    const runtimePolicy = resolveEngineRuntimePolicy({ engineMode: 'NORMAL', liveBuyGateAllowed: true });
    const result = resolveFinalDecision({
      runtimePolicy,
      requestedDecision: 'STRONG_BUY',
      gateResults: [gate({ gateName: 'Gate1Survival', passed: false, blockers: ['GATE1_MINIMUM_SIGNAL_FAILED'] })],
    });

    expect(result.decision).toBe('HOLD');
    expect(result.liveBuyAllowed).toBe(false);
    expect(result.reasonCodes).toContain('GATE1_SURVIVAL_FAILED');
  });

  it('downgrades STRONG_BUY when the enemy checklist has at least two warnings', () => {
    const runtimePolicy = resolveEngineRuntimePolicy({ engineMode: 'NORMAL', liveBuyGateAllowed: true });
    const result = resolveFinalDecision({
      runtimePolicy,
      requestedDecision: 'STRONG_BUY',
      enemyWarningCount: 2,
      gateResults: [gate({ gateName: 'Gate1Survival', passed: true })],
    });

    expect(result.decision).toBe('BUY');
    expect(result.downgraded).toBe(true);
    expect(result.warnings).toContain('ENEMY_CHECKLIST_STRONG_BUY_DOWNGRADE');
  });
});
