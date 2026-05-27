// @responsibility Scan summary display reason mapping policy.

import {
  buildMessageWordingDecision,
  formatCausalReasonSuppressedLog,
  formatMessageWordingMappedLog,
  formatUserActionLabelResolvedLog,
} from '../../../alerts/messageWordingPolicy.js';

export type ScanSummaryZeroCountReason =
  | 'YAHOO_FAILURE'
  | 'GATE_MISS'
  | 'RRR_FAIL';

export interface ScanSummaryReasonMappingInput {
  scanCycleId: string;
  providerFailureCount: number;
  providerFailureExecutionImpact?: 'NONE' | string;
  providerFailureCausedEntryHold?: boolean;
  dominantNoEntryReason?: string;
  gateMissCount?: number;
  rrrFailCount?: number;
  actionRequired?: boolean;
  executionImpact?: 'NONE' | string;
}

export interface ScanSummaryReasonMapping {
  scanCycleId: string;
  providerFailureCount: number;
  providerFailureExecutionImpact: 'NONE' | string;
  providerFailureCausedEntryHold: boolean;
  entryHoldReason: 'YAHOO_FAILURE' | 'NONE';
  dominantNoEntryReason: string;
  displayedReasons: string[];
  suppressedZeroCountReasons: ScanSummaryZeroCountReason[];
  providerLine: string;
  gateLine: string;
  rrrLine: string;
  causalArrowAllowed: boolean;
  executionImpact: 'NONE' | string;
  actionRequired: boolean;
  marketSignal: false;
  providerIssue: boolean;
  tradingLogicChanged: false;
  gateLogicChanged: false;
  orderLogicChanged: false;
  providerSelectionChanged: false;
  thresholdChanged: false;
  notificationOnly: true;
  displayOnly: true;
}

function boolText(value: boolean): 'true' | 'false' {
  return value ? 'true' : 'false';
}

function safeCount(value: number | undefined): number {
  if (!Number.isFinite(value)) return 0;
  return Math.max(0, Math.trunc(value ?? 0));
}

function isProviderDominant(reason: string | undefined): boolean {
  return reason === 'PROVIDER_FAILURE_WITH_EXECUTION_IMPACT';
}

function allowsProviderCausalArrow(input: ScanSummaryReasonMappingInput): boolean {
  const count = safeCount(input.providerFailureCount);
  const providerImpact = input.providerFailureExecutionImpact ?? 'NONE';
  const causedEntryHold = input.providerFailureCausedEntryHold ?? isProviderDominant(input.dominantNoEntryReason);
  return count > 0
    && causedEntryHold
    && providerImpact !== 'NONE'
    && (input.actionRequired === true || input.executionImpact !== 'NONE' || isProviderDominant(input.dominantNoEntryReason));
}

export function mapScanSummaryDisplayReasons(input: ScanSummaryReasonMappingInput): ScanSummaryReasonMapping {
  const providerFailureCount = safeCount(input.providerFailureCount);
  const gateMissCount = safeCount(input.gateMissCount);
  const rrrFailCount = safeCount(input.rrrFailCount);
  const providerFailureExecutionImpact = input.providerFailureExecutionImpact ?? 'NONE';
  const causalArrowAllowed = allowsProviderCausalArrow(input);
  const providerFailureCausedEntryHold = providerFailureCount > 0 && causalArrowAllowed;
  const displayedReasons: string[] = [];
  const suppressedZeroCountReasons: ScanSummaryZeroCountReason[] = [];
  let providerLine = '데이터 실패: 없음';

  if (providerFailureCount === 0) {
    suppressedZeroCountReasons.push('YAHOO_FAILURE');
  } else if (providerFailureCausedEntryHold) {
    providerLine = `데이터 실패: ${providerFailureCount}개 → 진입 보류`;
    displayedReasons.push('YAHOO_FAILURE');
  } else {
    providerLine = `데이터 이슈: ${providerFailureCount}개 (매매 영향 없음, diagnosticOnly=true)`;
    displayedReasons.push('YAHOO_FAILURE_DIAGNOSTIC_ONLY');
  }

  if (gateMissCount > 0) {
    displayedReasons.push('GATE_MISS');
  } else {
    suppressedZeroCountReasons.push('GATE_MISS');
  }

  if (rrrFailCount > 0) {
    displayedReasons.push('RRR_FAIL');
  } else {
    suppressedZeroCountReasons.push('RRR_FAIL');
  }

  return {
    scanCycleId: input.scanCycleId,
    providerFailureCount,
    providerFailureExecutionImpact,
    providerFailureCausedEntryHold,
    entryHoldReason: providerFailureCausedEntryHold ? 'YAHOO_FAILURE' : 'NONE',
    dominantNoEntryReason: input.dominantNoEntryReason ?? 'UNKNOWN',
    displayedReasons,
    suppressedZeroCountReasons,
    providerLine,
    gateLine: `Gate 미달: ${gateMissCount}개`,
    rrrLine: `RRR 미달: ${rrrFailCount}개`,
    causalArrowAllowed,
    executionImpact: input.executionImpact ?? 'NONE',
    actionRequired: input.actionRequired === true,
    marketSignal: false,
    providerIssue: providerFailureCount > 0,
    tradingLogicChanged: false,
    gateLogicChanged: false,
    orderLogicChanged: false,
    providerSelectionChanged: false,
    thresholdChanged: false,
    notificationOnly: true,
    displayOnly: true,
  };
}

function safetyFields(mapping: ScanSummaryReasonMapping): string {
  return [
    `executionImpact=${mapping.executionImpact}`,
    'marketSignal=false',
    `providerIssue=${boolText(mapping.providerIssue)}`,
    'tradingLogicChanged=false',
    'gateLogicChanged=false',
    'orderLogicChanged=false',
    'providerSelectionChanged=false',
    'thresholdChanged=false',
    'notificationOnly=true',
    'displayOnly=true',
  ].join(' ');
}

export function formatScanSummaryReasonMappedLog(mapping: ScanSummaryReasonMapping): string {
  return [
    '[SCAN_SUMMARY_REASON_MAPPED]',
    `scanCycleId=${mapping.scanCycleId}`,
    `providerFailureCount=${mapping.providerFailureCount}`,
    `providerFailureExecutionImpact=${mapping.providerFailureExecutionImpact}`,
    `providerFailureCausedEntryHold=${boolText(mapping.providerFailureCausedEntryHold)}`,
    `dominantNoEntryReason=${mapping.dominantNoEntryReason}`,
    `displayedReasons=${mapping.displayedReasons.join(',') || 'NONE'}`,
    `suppressedZeroCountReasons=${mapping.suppressedZeroCountReasons.join(',') || 'NONE'}`,
    safetyFields(mapping),
  ].join(' ');
}

export function formatScanSummaryZeroReasonSuppressedLog(
  mapping: ScanSummaryReasonMapping,
  reason: ScanSummaryZeroCountReason,
): string {
  return [
    '[SCAN_SUMMARY_ZERO_REASON_SUPPRESSED]',
    `reason=${reason}`,
    'count=0',
    'causalArrowSuppressed=true',
    'telegramSentField=false',
    safetyFields(mapping),
  ].join(' ');
}

export function formatScanSummaryCausalArrowAllowedLog(mapping: ScanSummaryReasonMapping): string {
  return [
    '[SCAN_SUMMARY_CAUSAL_ARROW_ALLOWED]',
    'reason=YAHOO_FAILURE',
    `count=${mapping.providerFailureCount}`,
    `causedEntryHold=${boolText(mapping.providerFailureCausedEntryHold)}`,
    `executionImpact=${mapping.providerFailureExecutionImpact}`,
    `displayText=${mapping.providerLine.replace(/\s+/g, '_')}`,
    safetyFields(mapping),
  ].join(' ');
}

export function formatScanSummaryWordingPolicyLogs(mapping: ScanSummaryReasonMapping): string[] {
  const decision = buildMessageWordingDecision({
    eventType: 'SCAN_SUMMARY',
    originalTone: mapping.actionRequired ? 'ACTION_REQUIRED' : 'DIAGNOSTIC',
    executionImpact: mapping.executionImpact,
    actionRequired: mapping.actionRequired,
    diagnosticOnly: mapping.executionImpact === 'NONE',
    displayTextType: 'SCAN_SUMMARY_REASON_MAPPING',
  });
  return [
    formatMessageWordingMappedLog(decision),
    formatUserActionLabelResolvedLog(decision),
    ...mapping.suppressedZeroCountReasons.map((reason) =>
      formatCausalReasonSuppressedLog(decision, reason, 0),
    ),
  ];
}
