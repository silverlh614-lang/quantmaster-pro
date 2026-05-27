// @responsibility Regression tests for notification wording tone policy.

import { describe, expect, it } from 'vitest';
import {
  buildMessageWordingDecision,
  canUseRestrictedIncidentWords,
  formatCausalReasonSuppressedLog,
  formatDiagnosticWordingDowngradedLog,
  formatMessageWordingMappedLog,
  formatUserActionLabelResolvedLog,
} from './messageWordingPolicy.js';

describe('messageWordingPolicy', () => {
  it('downgrades no-impact diagnostics away from warning tone', () => {
    const decision = buildMessageWordingDecision({
      eventType: 'NO_ENTRY_STREAK',
      originalTone: 'WARNING',
      executionImpact: 'NONE',
      actionRequired: false,
      diagnosticOnly: true,
      displayTextType: 'NO_ENTRY_DIAGNOSTIC',
    });
    const mapped = formatMessageWordingMappedLog(decision);
    const downgraded = formatDiagnosticWordingDowngradedLog(decision, 'executionImpact_NONE');

    expect(decision.mappedTone).toBe('DIAGNOSTIC');
    expect(decision.userActionText).toBe('조치 필요: 없음');
    expect(decision.impactText).toBe('실행 영향: 없음');
    expect(canUseRestrictedIncidentWords(decision)).toBe(false);
    expect(mapped).toContain('[MESSAGE_WORDING_MAPPED]');
    expect(downgraded).toContain('toTone=DIAGNOSTIC');
    expect(downgraded).toContain('tradingLogicChanged=false');
  });

  it('keeps action-required incidents eligible for strong wording', () => {
    const decision = buildMessageWordingDecision({
      eventType: 'WATCHLIST_HARD_CAP',
      originalTone: 'WARNING',
      executionImpact: 'LIVE_BLOCKED',
      actionRequired: true,
      displayTextType: 'HARD_CAP_SUMMARY',
    });

    expect(decision.mappedTone).toBe('ACTION_REQUIRED');
    expect(decision.userActionText).toBe('조치 필요: 있음');
    expect(canUseRestrictedIncidentWords(decision)).toBe(true);
  });

  it('logs zero-count causal suppression as display only', () => {
    const decision = buildMessageWordingDecision({
      eventType: 'SCAN_SUMMARY',
      executionImpact: 'NONE',
      actionRequired: false,
      diagnosticOnly: true,
    });
    const action = formatUserActionLabelResolvedLog(decision);
    const causal = formatCausalReasonSuppressedLog(decision, 'YAHOO_FAILURE', 0);

    expect(action).toContain('[USER_ACTION_LABEL_RESOLVED]');
    expect(action).toContain('조치_필요:_없음');
    expect(causal).toContain('[CAUSAL_REASON_SUPPRESSED]');
    expect(causal).toContain('count=0');
    expect(causal).toContain('causalArrowSuppressed=true');
    expect(causal).toContain('providerSelectionChanged=false');
  });
});
