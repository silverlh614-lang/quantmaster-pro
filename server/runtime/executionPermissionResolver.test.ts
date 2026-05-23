import { describe, expect, it } from 'vitest';
import {
  formatExecutionPermissionLog,
  resolveExecutionPermission,
} from './executionPermissionResolver.js';

describe('resolveExecutionPermission P0 contract', () => {
  it('keeps gate, diagnostic, shadow, and counterfactual evaluation alive in SELL_ONLY', () => {
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
    expect(policy.liveOrderAllowed).toBe(false);
    expect(policy.liveBlockReason).toBe('SELL_ONLY_MODE');
    expect(policy.policyLabels).toContain('SELL_ONLY_EVALUATION_CONTINUED');
    expect(formatExecutionPermissionLog(policy)).toContain('[SELL_ONLY_EVALUATION_CONTINUED]');
  });

  it('treats R6 and Kelly as score/sizing advisory without blocking evaluation', () => {
    const policy = resolveExecutionPermission({
      sourceSnapshotId: 'snap-r6',
      effectiveRegime: 'R6_DEFENSE',
      kellyFraction: 0,
      r6ScorePenalty: 3,
    });

    expect(policy.gateEvaluationAllowed).toBe(true);
    expect(policy.shadowEvaluationAllowed).toBe(true);
    expect(policy.liveOrderAllowed).toBe(true);
    expect(policy.scorePenalty).toBe(3);
    expect(policy.sizingMultiplier).toBe(0);
    expect(policy.policyLabels).toEqual(expect.arrayContaining([
      'R6_SCORE_PENALTY_ONLY',
      'KELLY_ADVISORY_ONLY',
    ]));
    expect(policy.logTags).toEqual(expect.arrayContaining([
      '[R6_SCORE_PENALTY_ONLY]',
      '[KELLY_ADVISORY_ONLY]',
    ]));
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
});
