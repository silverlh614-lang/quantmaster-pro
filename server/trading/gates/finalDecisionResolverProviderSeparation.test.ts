import { describe, expect, it } from 'vitest';
import {
  buildFinalDecisionRuntimeAuditSummary,
  resolveFinalExecutionDecision,
  type FinalDecisionResolverRuntimeInput,
} from './finalDecisionResolver.js';

const base: FinalDecisionResolverRuntimeInput = {
  sourceSnapshotId: 'scan:provider',
  symbol: '000002',
  gate1Status: 'PASS',
  gate2Status: 'GATE2_PASS_WEAK',
  gate3Readiness: 'EXECUTION_READY',
  entryTimingSignal: 'ENTRY_READY',
  engineMode: 'DEGRADED',
  marketSession: 'REGULAR',
  effectiveRegime: 'GREEN',
  providerHealth: { quote: 'DEGRADED', supply: 'VERIFIED', dart: 'VERIFIED', macro: 'VERIFIED' },
  dataConfidenceCeiling: 'MEDIUM',
  marketSignal: true,
  providerIssue: true,
  shadowMode: 'NORMAL',
  requestedSide: 'BUY',
  isDiagnosticOnly: false,
};

describe('ADR-0521 provider issue separation', () => {
  it('keeps providerIssue separate from marketSignal', () => {
    const decision = resolveFinalExecutionDecision(base);

    expect(decision.marketSignal).toBe(false);
    expect(decision.providerIssueSeparated).toBe(true);
    expect(decision.advisoryReasons).toContain('PROVIDER_ISSUE_ISOLATED');
    expect(decision.confidenceAdjustment).toBe('DOWNGRADE_MEDIUM');
  });

  it('keeps evidence summary provider market signal conversion at zero', () => {
    const decision = resolveFinalExecutionDecision(base);
    const summary = buildFinalDecisionRuntimeAuditSummary({
      sourceSnapshotId: base.sourceSnapshotId,
      decisions: [decision],
      inputs: [base],
    });

    expect(summary.providerIssueSeparated).toBe(1);
    expect(summary.providerIssueConvertedToMarketSignalCount).toBe(0);
  });

  it('blocks DEGRADED live buy only when confidence ceiling is LOW', () => {
    const decision = resolveFinalExecutionDecision({ ...base, dataConfidenceCeiling: 'LOW' });

    expect(decision.finalAction).toBe('SHADOW_BUY_ALLOWED');
    expect(decision.liveBuyAllowed).toBe(false);
    expect(decision.blockReasons).toContain('DEGRADED_LOW_CONFIDENCE_LIVE_BUY_BLOCKED');
    expect(decision.shadowBuyAllowed).toBe(true);
  });
});
