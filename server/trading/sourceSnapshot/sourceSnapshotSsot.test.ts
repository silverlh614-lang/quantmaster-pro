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

  it('ignores AFTERMARKET + R6/SELL_ONLY execution blocks while preserving policy diagnostics', () => {
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
      realOrderAllowed: true,
      diagnosticAllowed: true,
      shadowAllowed: true,
      counterfactualAllowed: true,
      entryBlockMode: 'NORMAL',
      sessionOverlay: 'NONE',
      executionImpact: 'NONE',
    });
    expect(policy.blockReasons).toEqual([]);
    expect(policy.legacyIgnoredReasons).toEqual(expect.arrayContaining([
      'AFTERMARKET_BUY_BLOCK_IGNORED_BY_ROLLBACK',
      'AFTERMARKET_SELL_ONLY_IGNORED_BY_ROLLBACK',
      'R6_DEFENSE_IGNORED_BY_ROLLBACK',
      'R6_DEFENSE_SELL_ONLY_IGNORED_BY_ROLLBACK',
    ]));
    expect(formatPolicyDiag(policy)).toContain('LIVE_ALLOWED');
    expect(formatPolicyDiag(policy)).toContain('entryBlockMode=NORMAL');
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
