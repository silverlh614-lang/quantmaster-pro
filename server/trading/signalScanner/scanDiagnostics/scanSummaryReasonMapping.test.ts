// @responsibility Regression tests for scan summary reason mapping.

import { describe, expect, it } from 'vitest';
import {
  formatScanSummaryCausalArrowAllowedLog,
  formatScanSummaryReasonMappedLog,
  formatScanSummaryWordingPolicyLogs,
  formatScanSummaryZeroReasonSuppressedLog,
  mapScanSummaryDisplayReasons,
} from './scanSummaryReasonMapping.js';

describe('scanSummaryReasonMapping', () => {
  it('maps zero Yahoo failures to a neutral data-failure line', () => {
    const mapping = mapScanSummaryDisplayReasons({
      scanCycleId: 'scan-zero',
      providerFailureCount: 0,
      providerFailureExecutionImpact: 'NONE',
      dominantNoEntryReason: 'PRE_BREAKOUT_WAIT_DOMINANT',
      gateMissCount: 13,
      rrrFailCount: 0,
      actionRequired: false,
      executionImpact: 'NONE',
    });

    expect(mapping.providerLine).toBe('데이터 실패: 없음');
    expect(mapping.providerFailureCausedEntryHold).toBe(false);
    expect(mapping.entryHoldReason).toBe('NONE');
    expect(mapping.causalArrowAllowed).toBe(false);
    expect(mapping.suppressedZeroCountReasons).toContain('YAHOO_FAILURE');
    expect(mapping.providerLine).not.toContain('진입 보류');
  });

  it('keeps provider failures diagnostic-only when execution impact is none', () => {
    const mapping = mapScanSummaryDisplayReasons({
      scanCycleId: 'scan-diagnostic',
      providerFailureCount: 3,
      providerFailureExecutionImpact: 'NONE',
      dominantNoEntryReason: 'GATE3_RRR_FAIL',
      gateMissCount: 0,
      rrrFailCount: 2,
      actionRequired: false,
      executionImpact: 'NONE',
    });

    expect(mapping.providerLine).toBe('데이터 이슈: 3개 (매매 영향 없음, diagnosticOnly=true)');
    expect(mapping.providerFailureCausedEntryHold).toBe(false);
    expect(mapping.causalArrowAllowed).toBe(false);
  });

  it('allows the causal arrow only for actual provider entry holds', () => {
    const mapping = mapScanSummaryDisplayReasons({
      scanCycleId: 'scan-provider-block',
      providerFailureCount: 8,
      providerFailureExecutionImpact: 'LIVE_BLOCKED',
      providerFailureCausedEntryHold: true,
      dominantNoEntryReason: 'PROVIDER_FAILURE_WITH_EXECUTION_IMPACT',
      gateMissCount: 0,
      rrrFailCount: 0,
      actionRequired: true,
      executionImpact: 'LIVE_BLOCKED',
    });
    const log = formatScanSummaryCausalArrowAllowedLog(mapping);

    expect(mapping.providerLine).toBe('데이터 실패: 8개 → 진입 보류');
    expect(mapping.entryHoldReason).toBe('YAHOO_FAILURE');
    expect(mapping.causalArrowAllowed).toBe(true);
    expect(log).toContain('[SCAN_SUMMARY_CAUSAL_ARROW_ALLOWED]');
    expect(log).toContain('providerSelectionChanged=false');
  });

  it('emits display-only safety logs for mapped and suppressed reasons', () => {
    const mapping = mapScanSummaryDisplayReasons({
      scanCycleId: 'scan-log',
      providerFailureCount: 0,
      gateMissCount: 0,
      rrrFailCount: 0,
      dominantNoEntryReason: 'GATE3_ENTRY_TIMING_NOT_READY',
      executionImpact: 'NONE',
    });
    const mappedLog = formatScanSummaryReasonMappedLog(mapping);
    const zeroLog = formatScanSummaryZeroReasonSuppressedLog(mapping, 'YAHOO_FAILURE');

    expect(mappedLog).toContain('[SCAN_SUMMARY_REASON_MAPPED]');
    expect(mappedLog).toContain('executionImpact=NONE');
    expect(mappedLog).toContain('tradingLogicChanged=false');
    expect(mappedLog).toContain('gateLogicChanged=false');
    expect(mappedLog).toContain('orderLogicChanged=false');
    expect(mappedLog).toContain('providerSelectionChanged=false');
    expect(mappedLog).toContain('displayOnly=true');
    expect(zeroLog).toContain('causalArrowSuppressed=true');
    expect(zeroLog).toContain('telegramSentField=false');
  });

  it('emits common wording policy logs for user action and causal suppression', () => {
    const mapping = mapScanSummaryDisplayReasons({
      scanCycleId: 'scan-wording',
      providerFailureCount: 0,
      gateMissCount: 0,
      rrrFailCount: 0,
      executionImpact: 'NONE',
    });
    const logs = formatScanSummaryWordingPolicyLogs(mapping).join('\n');

    expect(logs).toContain('[MESSAGE_WORDING_MAPPED]');
    expect(logs).toContain('[USER_ACTION_LABEL_RESOLVED]');
    expect(logs).toContain('[CAUSAL_REASON_SUPPRESSED]');
    expect(logs).toContain('notificationOnly=true');
    expect(logs).toContain('displayOnly=true');
  });
});
