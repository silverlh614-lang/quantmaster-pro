import { describe, expect, it } from 'vitest';
import {
  formatExecutionPermissionLog,
  resolveExecutionPermission,
} from './executionPermissionResolver.js';

describe('resolveExecutionPermission P0 contract', () => {
  it('operationMode=SELL_ONLY 가 평가(gate/shadow/counterfactual)를 계속 허용함 (R6/SELL_ONLY 제거됨)', () => {
    const policy = resolveExecutionPermission({
      sourceSnapshotId: 'snap-sell-only',
      asOf: '2026-05-23T02:00:00.000Z',
      ttlSec: 30,
      operationMode: 'SELL_ONLY',
    });

    expect(policy.gateEvaluationAllowed).toBe(true);
    expect(policy.diagnosticGateEvaluationAllowed).toBe(true);
    expect(policy.shadowEvaluationAllowed).toBe(true);
    expect(policy.counterfactualAllowed).toBe(true);
    expect(policy.paperFillAllowed).toBe(true);
    // R6/SELL_ONLY 제거됨 — live order 차단 없음
    expect(policy.liveOrderAllowed).toBe(true);
    expect(policy.liveBlockReason).toBe('NONE');
    expect(policy.policyLabels).not.toContain('SELL_ONLY_EVALUATION_CONTINUED');
  });

  it('R6_DEFENSE 레짐 및 Kelly=0 — 사이징 0 유지, score penalty 없음 (R6 제거됨)', () => {
    const policy = resolveExecutionPermission({
      sourceSnapshotId: 'snap-r6',
      effectiveRegime: 'R6_DEFENSE',
      kellyFraction: 0,
      r6ScorePenalty: 3,
    });

    expect(policy.gateEvaluationAllowed).toBe(true);
    expect(policy.shadowEvaluationAllowed).toBe(true);
    expect(policy.liveOrderAllowed).toBe(true);
    // R6 제거됨 — scorePenalty 항상 0
    expect(policy.scorePenalty).toBe(0);
    // Kelly=0 이므로 sizingMultiplier=0 유지
    expect(policy.sizingMultiplier).toBe(0);
    // R6 policyLabels 제거됨
    expect(policy.policyLabels).not.toContain('R6_SCORE_PENALTY_ONLY');
    expect(policy.policyLabels).toContain('KELLY_ADVISORY_ONLY');
    expect(policy.logTags).not.toContain('[R6_SCORE_PENALTY_ONLY]');
    expect(policy.logTags).toContain('[KELLY_ADVISORY_ONLY]');
  });

  it('isolates providerIssue from marketSignal', () => {
    const policy = resolveExecutionPermission({
      sourceSnapshotId: 'snap-provider',
      providerIssue: true,
      marketSignal: true,
    });

    expect(policy.providerIssueIsolated).toBe(true);
    expect(policy.marketSignal).toBe(false);
    expect(policy.confidenceAdjustments).toContain('PROVIDER_ISSUE_CONFIDENCE_DOWNGRADE_ONLY');
    expect(policy.logTags).toEqual(expect.arrayContaining([
      '[PROVIDER_ISSUE_ISOLATED]',
      '[PROVIDER_HEALTH_SEPARATED_FROM_MARKET_SIGNAL]',
    ]));
  });

  it('blocks live/broker order usage for EOD snapshots while keeping learning lanes alive', () => {
    const policy = resolveExecutionPermission({
      sourceSnapshotId: 'snap-eod',
      asOf: '2026-05-26T06:57:15.433Z',
      ttlSec: 300,
      sourceFreshness: 'EOD_SNAPSHOT_VALID',
      snapshotAgeSec: 22680,
      engineMode: 'NORMAL',
      marketSessionState: 'REGULAR',
      brokerOrderAllowed: true,
      operatorOrderAllowed: true,
      realTradingEnabled: true,
    });

    expect(policy.usableForLiveOrder).toBe(false);
    expect(policy.usableForBrokerOrder).toBe(false);
    expect(policy.snapshotFreshnessForLive).toBe('STALE');
    expect(policy.snapshotFreshnessForShadow).toBe('EOD_VALID');
    expect(policy.liveOrderAllowed).toBe(false);
    expect(policy.liveBlockReason).toBe('EOD_SNAPSHOT_NOT_LIVE_TRADABLE');
    expect(policy.shadowEvaluationAllowed).toBe(true);
    expect(policy.counterfactualAllowed).toBe(true);
    expect(policy.executionImpact).toBe('NONE');
  });

  it('treats SHADOW_ONLY policy as a live-only block even when R3 would otherwise allow live', () => {
    const policy = resolveExecutionPermission({
      sourceSnapshotId: 'snap-shadow',
      sourceFreshness: 'FRESH',
      engineMode: 'NORMAL',
      effectiveRegime: 'R3_EARLY',
      macroPolicy: 'SHADOW_ONLY',
      brokerOrderAllowed: true,
      operatorOrderAllowed: true,
      realTradingEnabled: true,
    });

    expect(policy.liveOrderAllowed).toBe(false);
    expect(policy.liveBlockReason).toBe('SHADOW_ONLY_POLICY');
    expect(policy.shadowOrderAllowed).toBe(true);
    expect(policy.executionImpact).toBe('NONE');
  });
});
