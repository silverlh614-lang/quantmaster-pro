// @responsibility Regression tests for no-entry streak diagnostic notification policy.

import { beforeEach, describe, expect, it } from 'vitest';
import {
  _resetNoEntryStreakDiagnosticState,
  buildNoEntryScanSummaryMessage,
  buildNoEntryStreakDiagnostic,
  evaluateNoEntryTelegramDelivery,
  formatNoEntryPipelineHealthOkLog,
  formatNoEntryStreakEvaluatedLog,
  formatNoEntryWordingPolicyLogs,
  noEntryStreakBucket,
  recordNoEntryTelegramSent,
} from './noEntryStreakDiagnostic.js';

describe('noEntryStreakDiagnostic', () => {
  beforeEach(() => {
    _resetNoEntryStreakDiagnosticState();
  });

  it('treats normal no-entry streak as diagnostic waiting, not a pipeline failure', () => {
    const input = {
      tradeDate: '2026-05-27',
      scanCycleId: 'scan-2026-05-27T13:35',
      timeLabel: '13:35 KST',
      noEntryStreakCount: 3,
      candidateCount: 50,
      swingCount: 12,
      catalystCount: 8,
      momentumCount: 30,
      quoteFailCount: 0,
      gateMissCount: 13,
      rrrFailCount: 2,
      preBreakoutWaitCount: 9,
      gateEvaluatedCount: 50,
      gate3EvaluatedCount: 8,
      shadowLearningAllowed: true,
      counterfactualAllowed: true,
      counterfactualRecorded: true,
      regime: 'R3_EARLY',
      session: 'REGULAR',
    };
    const diagnostic = buildNoEntryStreakDiagnostic(input);
    const delivery = evaluateNoEntryTelegramDelivery(diagnostic);
    const message = buildNoEntryScanSummaryMessage(diagnostic, input);

    expect(diagnostic.pipelineHealthStatus).toBe('OK_OR_WAITING');
    expect(diagnostic.messageType).toBe('DIAGNOSTIC');
    expect(diagnostic.actionRequired).toBe(false);
    expect(diagnostic.executionImpact).toBe('NONE');
    expect(diagnostic.forceScanBlockedByNoEntryStreak).toBe(false);
    expect(diagnostic.shadowLearningBlockedByNoEntryStreak).toBe(false);
    expect(diagnostic.counterfactualBlockedByNoEntryStreak).toBe(false);
    expect(delivery.shouldSend).toBe(false);
    expect(delivery.reason).toBe('NORMAL_NO_ENTRY_DIAGNOSTIC_SUPPRESSED');
    expect(message).toContain('상태: 진입 조건 미충족 — 대기');
    expect(message).toContain('데이터 실패: 없음');
    expect(message).toContain('조치 필요: 없음');
    expect(message).toContain('Shadow learning: ON');
    expect(message).toContain('Counterfactual: ON');
    expect(message).toContain('thresholdChanged=false');
    expect(message).not.toContain('Yahoo 실패: 0개');
    expect(message).not.toContain('파이프라인 점검 필요');
  });

  it('escalates abnormal gate-evaluated-zero scans to action required', () => {
    const diagnostic = buildNoEntryStreakDiagnostic({
      tradeDate: '2026-05-27',
      scanCycleId: 'scan-abnormal',
      noEntryStreakCount: 3,
      candidateCount: 20,
      gateEvaluatedCount: 0,
      gate3EvaluatedCount: 0,
      shadowLearningAllowed: true,
      counterfactualAllowed: true,
      regime: 'R3_EARLY',
      session: 'REGULAR',
    });
    const message = buildNoEntryScanSummaryMessage(diagnostic, {
      noEntryStreakCount: 3,
      candidateCount: 20,
      gateEvaluatedCount: 0,
    });

    expect(diagnostic.pipelineFailureDetected).toBe(true);
    expect(diagnostic.pipelineHealthStatus).toBe('ACTION_REQUIRED');
    expect(diagnostic.messageType).toBe('ACTION_REQUIRED');
    expect(diagnostic.dominantNoEntryReason).toBe('PIPELINE_ACTUAL_FAILURE');
    expect(diagnostic.failureReason).toBe('GATE_EVALUATED_ZERO_ABNORMAL');
    expect(evaluateNoEntryTelegramDelivery(diagnostic).shouldSend).toBe(true);
    expect(message).toContain('[No-entry 파이프라인 확인 필요]');
    expect(message).toContain('actionRequired=true');
  });

  it('dedups action-required pipeline failure messages by key', () => {
    const diagnostic = buildNoEntryStreakDiagnostic({
      tradeDate: '2026-05-27',
      scanCycleId: 'scan-lock',
      noEntryStreakCount: 5,
      candidateCount: 10,
      gateEvaluatedCount: 5,
      scanLockStuck: true,
      regime: 'R3_EARLY',
      session: 'REGULAR',
    });

    expect(evaluateNoEntryTelegramDelivery(diagnostic, 1_000).shouldSend).toBe(true);
    recordNoEntryTelegramSent(diagnostic, 1_000);
    const duplicate = evaluateNoEntryTelegramDelivery(diagnostic, 2_000);

    expect(duplicate.shouldSend).toBe(false);
    expect(duplicate.reason).toBe('COOLDOWN_ACTIVE');
    expect(duplicate.cooldownRemainingMs).toBeGreaterThan(0);
  });

  it('logs no-entry safety fields without implying trading changes', () => {
    const diagnostic = buildNoEntryStreakDiagnostic({
      tradeDate: '2026-05-27',
      scanCycleId: 'scan-log',
      noEntryStreakCount: 4,
      candidateCount: 12,
      gateEvaluatedCount: 12,
      rrrFailCount: 4,
      shadowLearningAllowed: true,
      counterfactualAllowed: true,
    });
    const evaluated = formatNoEntryStreakEvaluatedLog(diagnostic);
    const health = formatNoEntryPipelineHealthOkLog(diagnostic);

    expect(noEntryStreakBucket(4)).toBe('3~4');
    expect(evaluated).toContain('executionImpact=NONE');
    expect(evaluated).toContain('tradingLogicChanged=false');
    expect(evaluated).toContain('gateLogicChanged=false');
    expect(evaluated).toContain('orderLogicChanged=false');
    expect(health).toContain('forceScanBlocked=false');
    expect(health).toContain('shadowLearningAllowed=true');
  });

  it('logs common wording downgrade for normal no-entry diagnostics', () => {
    const diagnostic = buildNoEntryStreakDiagnostic({
      tradeDate: '2026-05-27',
      scanCycleId: 'scan-wording',
      noEntryStreakCount: 3,
      candidateCount: 20,
      gateEvaluatedCount: 20,
      preBreakoutWaitCount: 10,
      shadowLearningAllowed: true,
      counterfactualAllowed: true,
    });
    const logs = formatNoEntryWordingPolicyLogs(diagnostic).join('\n');

    expect(logs).toContain('[MESSAGE_WORDING_MAPPED]');
    expect(logs).toContain('[DIAGNOSTIC_WORDING_DOWNGRADED]');
    expect(logs).toContain('[USER_ACTION_LABEL_RESOLVED]');
    expect(logs).toContain('toTone=DIAGNOSTIC');
    expect(logs).toContain('조치_필요:_없음');
  });
});
