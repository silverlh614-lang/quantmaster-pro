// @responsibility Source Snapshot SSOT follow-up regression tests.

import { describe, expect, it } from 'vitest';
import { evaluateCommonGate } from './commonGateEvaluator.js';
import { formatPolicyDiag, resolvePolicy } from './policyResolver.js';
import {
  buildDiagnosticPenaltyBreakdown,
  buildSourceSnapshotDataHealth,
  classifyTechnicalTrendMissing,
  emptyTechnicalTrendMissingClassification,
} from './sourceSnapshotDataHealth.js';
import { detectSnapshotMismatches } from './snapshotMismatchDetector.js';

describe('Source Snapshot SSOT common gate and policy split', () => {
  it('keeps CommonGateResult identical across session and R6 policy contexts', () => {
    const source = {
      snapshotId: 'snap-1',
      candidate: {
        symbol: '005930',
        quoteStatus: 'VERIFIED' as const,
        tradabilityStatus: 'TRADABLE' as const,
        liquidityStatus: 'PASS' as const,
      },
      feature: {
        technicalIndicators: {
          status: 'COMPUTED' as const,
          ma20: 100,
          ma60: 90,
          rsi14: 55,
          atr14: 2,
        },
      },
    };

    const regular = evaluateCommonGate(source);
    const aftermarketR6 = evaluateCommonGate(source);

    expect(aftermarketR6).toEqual(regular);
    expect(regular).toMatchObject({ gateStatus: 'OK', sessionAgnostic: true });
  });

  it('ignores removed AFTERMARKET display + R6/SELL_ONLY execution blocks while preserving policy diagnostics', () => {
    const commonGateResult = evaluateCommonGate({
      snapshotId: 'snap-r6',
      candidate: { symbol: '005930', quoteStatus: 'VERIFIED', tradabilityStatus: 'TRADABLE', liquidityStatus: 'PASS' },
      feature: { technicalIndicators: { status: 'COMPUTED', ma20: 100, ma60: 90, rsi14: 55, atr14: 2 } },
    });
    const before = structuredClone(commonGateResult);

    const policy = resolvePolicy({
      snapshotId: 'snap-r6',
      commonGateResult,
      marketSession: 'AFTERMARKET',
      displaySession: 'AFTERMARKET_SELL_ONLY',
      effectiveRegime: 'R6_DEFENSE',
      engineMode: 'SELL_ONLY',
      operationMode: 'R6_DEFENSE_SELL_ONLY',
    });

    expect(commonGateResult).toEqual(before);
    expect(policy).toMatchObject({
      policyStatus: 'LIVE_ALLOWED',
      liveBuyAllowed: true,
      liveSellAllowed: true,
      realOrderAllowed: false,
      liveOrderAllowed: false,
      liveBlockReason: 'SELL_ONLY_MODE',
      gateEvaluationAllowed: true,
      diagnosticGateEvaluationAllowed: true,
      shadowEvaluationAllowed: true,
      paperFillAllowed: true,
      diagnosticAllowed: true,
      shadowAllowed: true,
      counterfactualAllowed: true,
      displaySession: 'REGULAR',
      entryBlockMode: 'NORMAL',
      sessionOverlay: 'NONE',
      executionImpact: 'NEW_BUY_BLOCKED_ONLY',
      legacyPolicyIgnored: true,
    });
    expect(policy.blockReasons).toEqual([]);
    expect(policy.legacyPolicyInputs).toEqual(expect.arrayContaining([
      'AFTERMARKET_SELL_ONLY_REMOVED',
      'R6_DEFENSE_REMOVED',
      'R6_DEFENSE_SELL_ONLY_REMOVED',
      'SELL_ONLY_REMOVED',
    ]));
    expect(formatPolicyDiag(policy)).toContain('LIVE_ALLOWED');
    expect(formatPolicyDiag(policy)).toContain('entryBlockMode=NORMAL');
    expect(formatPolicyDiag(policy)).toContain('liveOrderAllowed=false');
    expect(formatPolicyDiag(policy)).toContain('shadowEvaluationAllowed=true');
    expect(formatPolicyDiag(policy)).not.toContain('R6_DEFENSE_SELL_ONLY');
    expect(formatPolicyDiag(policy)).not.toContain('AFTERMARKET_SELL_ONLY');
  });

  it('keeps provider issue and Kelly advisory isolated from evaluation permission', () => {
    const commonGateResult = evaluateCommonGate({
      snapshotId: 'snap-provider',
      candidate: { symbol: '005930', quoteStatus: 'VERIFIED', tradabilityStatus: 'TRADABLE', liquidityStatus: 'PASS' },
      feature: { technicalIndicators: { status: 'COMPUTED', ma20: 100, ma60: 90, rsi14: 55, atr14: 2 } },
    });

    const policy = resolvePolicy({
      snapshotId: 'snap-provider',
      commonGateResult,
      marketSession: 'REGULAR',
      providerIssue: true,
      marketSignal: true,
      kellyFraction: 0,
    });

    expect(policy.gateEvaluationAllowed).toBe(true);
    expect(policy.shadowEvaluationAllowed).toBe(true);
    expect(policy.counterfactualAllowed).toBe(true);
    expect(policy.providerIssueIsolated).toBe(true);
    expect(policy.marketSignal).toBe(false);
    expect(policy.sizingMultiplier).toBe(0);
    expect(policy.policyLabels).toEqual(expect.arrayContaining([
      'KELLY_ADVISORY_ONLY',
      'PROVIDER_ISSUE_ISOLATED',
    ]));
    expect(policy.executionPermissionLogTags).toEqual(expect.arrayContaining([
      '[KELLY_ADVISORY_ONLY]',
      '[PROVIDER_ISSUE_ISOLATED]',
    ]));
  });

  it('blocks failed common gate only with gate quality reason', () => {
    const policy = resolvePolicy({
      snapshotId: 'snap-fail',
      commonGateResult: {
        snapshotId: 'snap-fail',
        gateStatus: 'DATA_INCOMPLETE',
        qualityDecision: 'FAIL',
        reasons: ['R6_DEFENSE_SELL_ONLY'],
      },
      marketSession: 'AFTERMARKET',
      displaySession: 'AFTERMARKET_SELL_ONLY',
      effectiveRegime: 'R6_DEFENSE',
      engineMode: 'SELL_ONLY',
      operationMode: 'SELL_ONLY',
    });

    expect(policy.liveBuyAllowed).toBe(false);
    expect(policy.realOrderAllowed).toBe(false);
    expect(policy.blockReasons).toEqual(['COMMON_GATE_QUALITY_FAIL']);
    expect(policy.blockReasons.join(',')).not.toMatch(/SELL_ONLY|R6_DEFENSE|AFTERMARKET_BUY_BLOCKED/);
    expect(policy.legacyPolicyInputs).toEqual(expect.arrayContaining([
      'AFTERMARKET_SELL_ONLY_REMOVED',
      'SELL_ONLY_REMOVED',
      'R6_DEFENSE_REMOVED',
    ]));
  });

  it('keeps technical layer missing as WARN instead of Data Gate hard fail', () => {
    const commonGateResult = evaluateCommonGate({
      snapshotId: 'snap-tech-warn',
      candidate: { symbol: '005930', quoteStatus: 'VERIFIED', tradabilityStatus: 'TRADABLE', liquidityStatus: 'PASS' },
      feature: { technicalIndicators: { status: 'NOT_COMPUTED' } },
    });
    const policy = resolvePolicy({
      snapshotId: 'snap-tech-warn',
      commonGateResult,
      marketSession: 'REGULAR',
    });

    expect(commonGateResult.gateStatus).toBe('WARN');
    expect(commonGateResult.dataIssues).toContain('technicalIndicators=NOT_COMPUTED:diagnosticOnly');
    expect(policy.liveBuyAllowed).toBe(true);
    expect(policy.blockReasons).toEqual([]);
  });

  it('classifies quote-verified technical missing as data pipeline, not soft fail', () => {
    const reason = classifyTechnicalTrendMissing({
      quoteVerified: true,
      ohlcvFetched: false,
      indicatorComputed: false,
      featureSnapshotPresent: false,
      gateMappingPresent: false,
    });
    const classification = emptyTechnicalTrendMissingClassification();
    classification.total = 43;
    classification.reasons[reason] = 43;

    expect(reason).toBe('KIS_QUOTE_VERIFIED_BUT_OHLCV_NOT_FETCHED');
    expect(buildDiagnosticPenaltyBreakdown(classification)).toEqual({
      softFailPenalty: 0,
      dataPipelineIssue: 43,
      wiringDiagnosticOnly: 0,
      scoreImpactNotApplied: 43,
    });
  });

  it('does not promote quote VERIFIED to technicalIndicators COMPUTED', () => {
    const health = buildSourceSnapshotDataHealth({
      totalCandidates: 43,
      quoteVerifiedRows: 43,
      ohlcvDailyRows: 0,
      technicalIndicatorRowsComputed: 0,
    });

    expect(health.quote).toMatchObject({ source: 'KIS_API', status: 'VERIFIED', rows: '43/43' });
    expect(health.ohlcvDaily).toMatchObject({ source: 'NONE', status: 'NOT_FETCHED' });
    expect(health.technicalIndicators).toMatchObject({ status: 'NOT_COMPUTED', source: 'NOT_COMPUTED' });
  });

  it('flags quote verified but technical layer missing as forensic only', () => {
    expect(detectSnapshotMismatches({
      quoteStatus: 'VERIFIED',
      featureTechnicalIndicatorsStatus: 'MISSING',
    })).toEqual([{
      reason: 'QUOTE_VERIFIED_BUT_TECHNICAL_LAYER_NOT_READY',
      executionImpact: 'NONE',
      detail: 'KIS quote is verified but technical indicator layer is missing.',
    }]);
  });

  it('emits snapshot pollution alerts as forensic executionImpact=NONE only', () => {
    const alerts = detectSnapshotMismatches({
      gate1DiagText: 'Gate1: LIVE_BLOCKED_ONLY | inputs=OK',
      commonGateReadKeys: ['marketSession'],
      featureTechnicalIndicatorsStatus: 'COMPUTED',
      gateTechnicalTrendMissing: true,
      quoteStatus: 'VERIFIED',
      gateResultSnapshotId: 'gate-1',
      policyResultSnapshotId: 'policy-2',
      telegramSummarySnapshotId: 'telegram-1',
      decisionContextSnapshotId: 'decision-2',
    });

    expect(alerts.map((alert) => alert.reason)).toEqual([
      'GATE_POLICY_POLLUTION',
      'COMMON_GATE_SESSION_LEAKAGE',
      'FEATURE_COMPUTED_BUT_GATE_MAPPING_DROPPED',
      'SNAPSHOT_MISMATCH_GATE_POLICY',
      'SNAPSHOT_MISMATCH_TELEGRAM_DECISION',
    ]);
    expect(alerts.every((alert) => alert.executionImpact === 'NONE')).toBe(true);
  });
});
