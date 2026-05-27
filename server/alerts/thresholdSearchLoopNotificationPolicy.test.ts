// @responsibility Regression tests for Threshold Search Loop Telegram suppression policy.

import { beforeEach, describe, expect, it } from 'vitest';
import {
  _resetThresholdLoopNotificationState,
  buildThresholdLoopDiagnostic,
  buildThresholdProposalApprovalMessage,
  evaluateThresholdLoopTelegramDelivery,
  formatThresholdLoopEvaluatedLog,
  recordThresholdLoopTelegramSent,
} from './thresholdSearchLoopNotificationPolicy.js';

describe('thresholdSearchLoopNotificationPolicy', () => {
  beforeEach(() => {
    _resetThresholdLoopNotificationState();
  });

  it('suppresses threshold lowering push when Gate pass candidates already exist', () => {
    const diagnostic = buildThresholdLoopDiagnostic({
      tradeDate: '2026-05-27',
      regime: 'R3_EARLY',
      gateThreshold: 4,
      noEntryStreak: 5,
      gateScores: [3.8, 4.1, 5.2],
      gate1ThresholdMissCount: 6,
    });
    const delivery = evaluateThresholdLoopTelegramDelivery(diagnostic);

    expect(diagnostic.gatePassCount).toBe(2);
    expect(diagnostic.thresholdLoweringEligible).toBe(false);
    expect(diagnostic.recommendation).toBe('OBSERVE');
    expect(delivery.shouldSend).toBe(false);
    expect(delivery.reason).toBe('OBSERVE_PUSH_SUPPRESSED');
  });

  it('uses Gate3 RRR fail as dominant reason before Gate1 threshold', () => {
    const diagnostic = buildThresholdLoopDiagnostic({
      tradeDate: '2026-05-27',
      regime: 'R3_EARLY',
      gateThreshold: 4,
      noEntryStreak: 6,
      gateScores: [3.7, 3.8],
      gate3EvaluatedCount: 3,
      gate3RrrFailCount: 3,
      gate1ThresholdMissCount: 5,
    });

    expect(diagnostic.dominantNoEntryReason).toBe('GATE3_RRR_FAIL');
    expect(diagnostic.thresholdProposalGenerated).toBe(false);
    expect(evaluateThresholdLoopTelegramDelivery(diagnostic).shouldSend).toBe(false);
  });

  it('allows approval-required proposal only when Gate1 threshold miss is dominant', () => {
    const diagnostic = buildThresholdLoopDiagnostic({
      tradeDate: '2026-05-27',
      regime: 'R3_EARLY',
      gateThreshold: 4,
      noEntryStreak: 7,
      gateScores: [3.5, 3.6, 3.7],
      gate1ThresholdMissCount: 6,
    });
    const delivery = evaluateThresholdLoopTelegramDelivery(diagnostic);
    const message = buildThresholdProposalApprovalMessage(diagnostic, delivery);

    expect(diagnostic.thresholdProposalGenerated).toBe(true);
    expect(diagnostic.operatorApprovalRequired).toBe(true);
    expect(diagnostic.thresholdAutoChanged).toBe(false);
    expect(diagnostic.actualThresholdChanged).toBe(false);
    expect(delivery.shouldSend).toBe(true);
    expect(message).toContain('actualThresholdChanged=false');
    expect(message).toContain('executionImpact=NONE');
  });

  it('dedups the same threshold proposal for the session', () => {
    const diagnostic = buildThresholdLoopDiagnostic({
      tradeDate: '2026-05-27',
      regime: 'R3_EARLY',
      gateThreshold: 4,
      noEntryStreak: 5,
      gateScores: [3.5],
      gate1ThresholdMissCount: 5,
    });

    expect(evaluateThresholdLoopTelegramDelivery(diagnostic, 1000).shouldSend).toBe(true);
    recordThresholdLoopTelegramSent(diagnostic, 1000);
    const duplicate = evaluateThresholdLoopTelegramDelivery(diagnostic, 2000);

    expect(duplicate.shouldSend).toBe(false);
    expect(duplicate.reason).toBe('COOLDOWN_ACTIVE');
  });

  it('logs notification-only safety fields', () => {
    const diagnostic = buildThresholdLoopDiagnostic({
      tradeDate: '2026-05-27',
      noEntryStreak: 5,
      gateThreshold: 4,
      gatePassCount: 1,
    });
    const line = formatThresholdLoopEvaluatedLog(diagnostic);

    expect(line).toContain('executionImpact=NONE');
    expect(line).toContain('tradingLogicChanged=false');
    expect(line).toContain('gateLogicChanged=false');
    expect(line).toContain('orderLogicChanged=false');
    expect(line).toContain('thresholdChanged=false');
    expect(line).toContain('notificationOnly=true');
    expect(line).toContain('diagnosticOnly=true');
  });
});
