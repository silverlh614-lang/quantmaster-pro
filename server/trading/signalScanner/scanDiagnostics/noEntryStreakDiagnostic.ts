// @responsibility No-entry streak diagnostic notification policy.

import {
  buildMessageWordingDecision,
  formatDiagnosticWordingDowngradedLog,
  formatMessageWordingMappedLog,
  formatUserActionLabelResolvedLog,
} from '../../../alerts/messageWordingPolicy.js';
import {
  mapScanSummaryDisplayReasons,
  type ScanSummaryReasonMapping,
} from './scanSummaryReasonMapping.js';

export type NoEntryDominantReason =
  | 'POLICY_BLOCKED'
  | 'SHADOW_ONLY'
  | 'LIVE_DISABLED'
  | 'OPENING_GUARD'
  | 'SESSION_GUARD'
  | 'POSITION_ALREADY_HELD'
  | 'PENDING_ORDER'
  | 'RESERVED_ORDER'
  | 'SLOT_LIMIT'
  | 'PRE_BREAKOUT_WAIT_DOMINANT'
  | 'GATE3_RRR_FAIL'
  | 'GATE3_ENTRY_TIMING_NOT_READY'
  | 'PRICE_OVEREXTENDED'
  | 'PRICE_NOT_CONFIRMED'
  | 'GATE2_LEADERSHIP_NOT_CONFIRMED'
  | 'GATE1_THRESHOLD_NOT_MET'
  | 'DATA_FRESHNESS_STALE'
  | 'PROVIDER_FAILURE_WITH_EXECUTION_IMPACT'
  | 'PIPELINE_ACTUAL_FAILURE'
  | 'UNKNOWN';

export type NoEntryPipelineHealthStatus = 'OK_OR_WAITING' | 'ACTION_REQUIRED';
export type NoEntryMessageType = 'DIAGNOSTIC' | 'ACTION_REQUIRED';

export interface NoEntryStreakDiagnosticInput {
  tradeDate?: string;
  scanCycleId?: string;
  timeLabel?: string;
  noEntryStreakCount: number;
  candidateCount: number;
  swingCount?: number;
  catalystCount?: number;
  momentumCount?: number;
  yahooFailCount?: number;
  gateMissCount?: number;
  rrrFailCount?: number;
  preBreakoutWaitCount?: number;
  gateEvaluatedCount?: number;
  gate3EvaluatedCount?: number;
  entryTimingNotReadyCount?: number;
  priceOverextendedCount?: number;
  priceNotConfirmedCount?: number;
  gate2LeadershipNotConfirmedCount?: number;
  gate1ThresholdMissCount?: number;
  dataFreshnessStale?: boolean;
  providerFailureWithExecutionImpact?: boolean;
  providerIssue?: boolean;
  policyBlocked?: boolean;
  shadowOnly?: boolean;
  liveDisabled?: boolean;
  openingGuardActive?: boolean;
  sessionGuardActive?: boolean;
  positionAlreadyHeld?: boolean;
  pendingOrder?: boolean;
  reservedOrder?: boolean;
  slotLimit?: boolean;
  scanCompleted?: boolean;
  scanJobFailed?: boolean;
  scanTimedOut?: boolean;
  resultRenderingFailed?: boolean;
  shadowLearningAllowed?: boolean;
  counterfactualRecorded?: boolean;
  counterfactualAllowed?: boolean;
  forceScanCompleted?: boolean;
  scanLockStuck?: boolean;
  unhandledException?: boolean;
  pipelineActualFailure?: boolean;
  regime?: string;
  session?: string;
  now?: Date;
}

export interface NoEntryStreakDiagnostic {
  eventType: 'NO_ENTRY_STREAK';
  tradeDate: string;
  scanCycleId: string;
  noEntryStreakCount: number;
  noEntryStreakBucket: string;
  noEntryDiagnosticWarning: boolean;
  dominantNoEntryReason: NoEntryDominantReason;
  pipelineFailureDetected: boolean;
  pipelineHealthStatus: NoEntryPipelineHealthStatus;
  messageType: NoEntryMessageType;
  actionRequired: boolean;
  entryBlockedByNoEntryStreak: false;
  forceScanBlockedByNoEntryStreak: false;
  shadowLearningBlockedByNoEntryStreak: false;
  counterfactualBlockedByNoEntryStreak: false;
  forceScanBlocked: false;
  thresholdChanged: false;
  shadowLearningStatus: 'ON' | 'STOPPED';
  counterfactualStatus: 'ON' | 'STOPPED';
  shadowLearningAllowed: boolean;
  counterfactualRecorded: boolean;
  executionImpact: 'NONE' | 'LIVE_BLOCKED';
  marketSignal: false;
  providerIssue: boolean;
  tradingLogicChanged: false;
  gateLogicChanged: false;
  orderLogicChanged: false;
  notificationOnly: true;
  diagnosticOnly: boolean;
  candidateCount: number;
  gateEvaluated: number;
  gate3Evaluated: number;
  failedStage?: string;
  failureReason?: string;
  correlationId: string;
  dedupKey: string;
  regime: string;
  session: string;
}

export interface NoEntryTelegramDeliveryDecision {
  shouldSend: boolean;
  reason: 'TELEGRAM_ELIGIBLE' | 'NORMAL_NO_ENTRY_DIAGNOSTIC_SUPPRESSED' | 'COOLDOWN_ACTIVE';
  cooldownRemainingMs: number;
}

const EVENT_TYPE = 'NO_ENTRY_STREAK';
const ACTION_REQUIRED_COOLDOWN_MS = 15 * 60 * 1000;
const sentByDedupKey = new Map<string, number>();

function boolText(value: boolean): 'true' | 'false' {
  return value ? 'true' : 'false';
}

function kstTradeDate(now: Date): string {
  return new Date(now.getTime() + 9 * 3_600_000).toISOString().slice(0, 10);
}

function count(value: number | undefined): number {
  if (!Number.isFinite(value)) return 0;
  return Math.max(0, Math.trunc(value ?? 0));
}

function hasCount(value: number | undefined): boolean {
  return count(value) > 0;
}

export function noEntryStreakBucket(streak: number): string {
  if (streak < 3) return '0~2';
  if (streak < 5) return '3~4';
  if (streak < 8) return '5~7';
  if (streak < 11) return '8~10';
  return '10+';
}

function detectPipelineFailure(input: NoEntryStreakDiagnosticInput): {
  detected: boolean;
  reason: NoEntryDominantReason;
  failedStage?: string;
  failureReason?: string;
} {
  if (input.providerFailureWithExecutionImpact) {
    return {
      detected: true,
      reason: 'PROVIDER_FAILURE_WITH_EXECUTION_IMPACT',
      failedStage: 'PROVIDER',
      failureReason: 'PROVIDER_FAILURE_WITH_EXECUTION_IMPACT',
    };
  }
  const explicitFailures: Array<[boolean | undefined, string]> = [
    [input.pipelineActualFailure, 'PIPELINE_ACTUAL_FAILURE'],
    [input.scanJobFailed, 'SCAN_JOB_FAILED'],
    [input.scanTimedOut, 'SCAN_RESULT_TIMEOUT'],
    [input.resultRenderingFailed, 'RESULT_RENDERING_FAILED'],
    [input.scanLockStuck, 'SCAN_LOCK_STUCK'],
    [input.unhandledException, 'UNHANDLED_EXCEPTION'],
  ];
  const explicit = explicitFailures.find(([active]) => active === true)?.[1];
  if (explicit) {
    return { detected: true, reason: 'PIPELINE_ACTUAL_FAILURE', failedStage: explicit, failureReason: explicit };
  }
  if (input.forceScanCompleted === false) {
    return {
      detected: true,
      reason: 'PIPELINE_ACTUAL_FAILURE',
      failedStage: 'FORCE_SCAN',
      failureReason: 'FORCE_SCAN_JOB_NOT_COMPLETED',
    };
  }
  if (input.shadowLearningAllowed === false) {
    return {
      detected: true,
      reason: 'PIPELINE_ACTUAL_FAILURE',
      failedStage: 'SHADOW_LEARNING',
      failureReason: 'SHADOW_LEARNING_STOPPED',
    };
  }
  if (input.counterfactualAllowed === false) {
    return {
      detected: true,
      reason: 'PIPELINE_ACTUAL_FAILURE',
      failedStage: 'COUNTERFACTUAL',
      failureReason: 'COUNTERFACTUAL_STOPPED',
    };
  }
  const candidateCount = count(input.candidateCount);
  const gateEvaluated = count(input.gateEvaluatedCount);
  const validNoCandidateReason =
    input.policyBlocked ||
    input.shadowOnly ||
    input.liveDisabled ||
    input.openingGuardActive ||
    input.sessionGuardActive ||
    input.dataFreshnessStale;
  if (candidateCount === 0 && !validNoCandidateReason) {
    return {
      detected: true,
      reason: 'PIPELINE_ACTUAL_FAILURE',
      failedStage: 'CANDIDATE_DISCOVERY',
      failureReason: 'CANDIDATE_COUNT_ZERO_UNEXPECTED',
    };
  }
  const normalGateSkipReason =
    input.policyBlocked ||
    input.shadowOnly ||
    input.liveDisabled ||
    input.openingGuardActive ||
    input.sessionGuardActive ||
    input.dataFreshnessStale ||
    input.providerIssue;
  if (candidateCount > 0 && gateEvaluated === 0 && !normalGateSkipReason) {
    return {
      detected: true,
      reason: 'PIPELINE_ACTUAL_FAILURE',
      failedStage: 'GATE',
      failureReason: 'GATE_EVALUATED_ZERO_ABNORMAL',
    };
  }
  if (input.scanCompleted === false) {
    return {
      detected: true,
      reason: 'PIPELINE_ACTUAL_FAILURE',
      failedStage: 'SCAN',
      failureReason: 'SCAN_NOT_COMPLETED',
    };
  }
  return { detected: false, reason: 'UNKNOWN' };
}

function resolveDominantReason(input: NoEntryStreakDiagnosticInput): NoEntryDominantReason {
  const failure = detectPipelineFailure(input);
  if (failure.detected) return failure.reason;
  if (input.policyBlocked) return 'POLICY_BLOCKED';
  if (input.shadowOnly) return 'SHADOW_ONLY';
  if (input.liveDisabled) return 'LIVE_DISABLED';
  if (input.openingGuardActive) return 'OPENING_GUARD';
  if (input.sessionGuardActive) return 'SESSION_GUARD';
  if (input.positionAlreadyHeld) return 'POSITION_ALREADY_HELD';
  if (input.pendingOrder) return 'PENDING_ORDER';
  if (input.reservedOrder) return 'RESERVED_ORDER';
  if (input.slotLimit) return 'SLOT_LIMIT';
  if (hasCount(input.preBreakoutWaitCount)) return 'PRE_BREAKOUT_WAIT_DOMINANT';
  if (hasCount(input.rrrFailCount)) return 'GATE3_RRR_FAIL';
  if (hasCount(input.entryTimingNotReadyCount)) return 'GATE3_ENTRY_TIMING_NOT_READY';
  if (hasCount(input.priceOverextendedCount)) return 'PRICE_OVEREXTENDED';
  if (hasCount(input.priceNotConfirmedCount)) return 'PRICE_NOT_CONFIRMED';
  if (hasCount(input.gate2LeadershipNotConfirmedCount)) return 'GATE2_LEADERSHIP_NOT_CONFIRMED';
  if (hasCount(input.gate1ThresholdMissCount) || hasCount(input.gateMissCount)) return 'GATE1_THRESHOLD_NOT_MET';
  if (input.dataFreshnessStale || hasCount(input.yahooFailCount)) return 'DATA_FRESHNESS_STALE';
  return 'UNKNOWN';
}

function reasonLabel(reason: NoEntryDominantReason): string {
  switch (reason) {
    case 'PRE_BREAKOUT_WAIT_DOMINANT': return 'Pre-breakout WAIT';
    case 'GATE3_RRR_FAIL': return 'Gate3 RRR';
    case 'GATE3_ENTRY_TIMING_NOT_READY': return 'EntryTiming';
    case 'GATE1_THRESHOLD_NOT_MET': return 'Gate1 threshold';
    case 'GATE2_LEADERSHIP_NOT_CONFIRMED': return 'Gate2 leadership';
    case 'SHADOW_ONLY': return 'SHADOW_ONLY policy';
    case 'LIVE_DISABLED': return 'live disabled';
    case 'POLICY_BLOCKED': return 'policy blocked';
    case 'OPENING_GUARD': return 'OpeningGuard';
    case 'SESSION_GUARD': return 'SessionGuard';
    case 'PROVIDER_FAILURE_WITH_EXECUTION_IMPACT': return 'provider failure with execution impact';
    case 'PIPELINE_ACTUAL_FAILURE': return 'pipeline actual failure';
    default: return reason;
  }
}

export function buildNoEntryStreakDiagnostic(input: NoEntryStreakDiagnosticInput): NoEntryStreakDiagnostic {
  const now = input.now ?? new Date();
  const tradeDate = input.tradeDate ?? kstTradeDate(now);
  const scanCycleId = input.scanCycleId ?? `scan_${tradeDate}_${input.timeLabel ?? now.toISOString()}`;
  const failure = detectPipelineFailure(input);
  const dominantNoEntryReason = failure.detected ? failure.reason : resolveDominantReason(input);
  const noEntryStreakBucketValue = noEntryStreakBucket(input.noEntryStreakCount);
  const pipelineHealthStatus: NoEntryPipelineHealthStatus = failure.detected ? 'ACTION_REQUIRED' : 'OK_OR_WAITING';
  const messageType: NoEntryMessageType = failure.detected ? 'ACTION_REQUIRED' : 'DIAGNOSTIC';
  const regime = input.regime ?? 'UNKNOWN';
  const session = input.session ?? 'REGULAR';
  const dedupKey = [
    tradeDate,
    `eventType=${EVENT_TYPE}`,
    `dominantNoEntryReason=${dominantNoEntryReason}`,
    `noEntryStreakBucket=${noEntryStreakBucketValue}`,
    `regime=${regime}`,
    `session=${session}`,
  ].join('|');

  return {
    eventType: EVENT_TYPE,
    tradeDate,
    scanCycleId,
    noEntryStreakCount: count(input.noEntryStreakCount),
    noEntryStreakBucket: noEntryStreakBucketValue,
    noEntryDiagnosticWarning: input.noEntryStreakCount >= 3,
    dominantNoEntryReason,
    pipelineFailureDetected: failure.detected,
    pipelineHealthStatus,
    messageType,
    actionRequired: failure.detected,
    entryBlockedByNoEntryStreak: false,
    forceScanBlockedByNoEntryStreak: false,
    shadowLearningBlockedByNoEntryStreak: false,
    counterfactualBlockedByNoEntryStreak: false,
    forceScanBlocked: false,
    thresholdChanged: false,
    shadowLearningStatus: input.shadowLearningAllowed === false ? 'STOPPED' : 'ON',
    counterfactualStatus: input.counterfactualAllowed === false ? 'STOPPED' : 'ON',
    shadowLearningAllowed: input.shadowLearningAllowed !== false,
    counterfactualRecorded: input.counterfactualRecorded === true,
    executionImpact: failure.detected ? 'LIVE_BLOCKED' : 'NONE',
    marketSignal: false,
    providerIssue: input.providerIssue === true,
    tradingLogicChanged: false,
    gateLogicChanged: false,
    orderLogicChanged: false,
    notificationOnly: true,
    diagnosticOnly: !failure.detected,
    candidateCount: count(input.candidateCount),
    gateEvaluated: count(input.gateEvaluatedCount),
    gate3Evaluated: count(input.gate3EvaluatedCount),
    failedStage: failure.failedStage,
    failureReason: failure.failureReason,
    correlationId: `${scanCycleId}:${EVENT_TYPE}`,
    dedupKey,
    regime,
    session,
  };
}

export function evaluateNoEntryTelegramDelivery(
  diagnostic: NoEntryStreakDiagnostic,
  nowMs = Date.now(),
): NoEntryTelegramDeliveryDecision {
  if (!diagnostic.actionRequired) {
    return {
      shouldSend: false,
      reason: 'NORMAL_NO_ENTRY_DIAGNOSTIC_SUPPRESSED',
      cooldownRemainingMs: 0,
    };
  }
  const lastSentAt = sentByDedupKey.get(diagnostic.dedupKey);
  if (lastSentAt !== undefined) {
    const remaining = ACTION_REQUIRED_COOLDOWN_MS - (nowMs - lastSentAt);
    if (remaining > 0) {
      return { shouldSend: false, reason: 'COOLDOWN_ACTIVE', cooldownRemainingMs: remaining };
    }
  }
  return { shouldSend: true, reason: 'TELEGRAM_ELIGIBLE', cooldownRemainingMs: 0 };
}

export function recordNoEntryTelegramSent(diagnostic: NoEntryStreakDiagnostic, nowMs = Date.now()): void {
  sentByDedupKey.set(diagnostic.dedupKey, nowMs);
}

export function _resetNoEntryStreakDiagnosticState(): void {
  sentByDedupKey.clear();
}

function safetyFields(diagnostic: NoEntryStreakDiagnostic): string {
  return [
    `executionImpact=${diagnostic.executionImpact}`,
    `marketSignal=${boolText(diagnostic.marketSignal)}`,
    `providerIssue=${boolText(diagnostic.providerIssue)}`,
    'tradingLogicChanged=false',
    'gateLogicChanged=false',
    'orderLogicChanged=false',
    'thresholdChanged=false',
    'forceScanBlocked=false',
    `shadowLearningBlocked=${boolText(diagnostic.shadowLearningBlockedByNoEntryStreak)}`,
    `counterfactualBlocked=${boolText(diagnostic.counterfactualBlockedByNoEntryStreak)}`,
    'notificationOnly=true',
  ].join(' ');
}

export function formatNoEntryStreakEvaluatedLog(diagnostic: NoEntryStreakDiagnostic): string {
  return [
    '[NO_ENTRY_STREAK_EVALUATED]',
    `tradeDate=${diagnostic.tradeDate}`,
    `scanCycleId=${diagnostic.scanCycleId}`,
    `noEntryStreakCount=${diagnostic.noEntryStreakCount}`,
    `dominantNoEntryReason=${diagnostic.dominantNoEntryReason}`,
    `pipelineHealthStatus=${diagnostic.pipelineHealthStatus}`,
    `actionRequired=${boolText(diagnostic.actionRequired)}`,
    safetyFields(diagnostic),
  ].join(' ');
}

export function formatNoEntryPipelineHealthOkLog(diagnostic: NoEntryStreakDiagnostic): string {
  return [
    '[NO_ENTRY_PIPELINE_HEALTH_OK]',
    `candidateCount=${diagnostic.candidateCount}`,
    `gateEvaluated=${diagnostic.gateEvaluated}`,
    `gate3Evaluated=${diagnostic.gate3Evaluated}`,
    `shadowLearningAllowed=${boolText(diagnostic.shadowLearningAllowed)}`,
    `counterfactualRecordedAnyScope=${boolText(diagnostic.counterfactualRecorded)}`,
    'forceScanBlocked=false',
    safetyFields(diagnostic),
  ].join(' ');
}

export function formatNoEntryPipelineFailureDetectedLog(diagnostic: NoEntryStreakDiagnostic): string {
  return [
    '[NO_ENTRY_PIPELINE_FAILURE_DETECTED]',
    `reason=${diagnostic.failureReason ?? diagnostic.dominantNoEntryReason}`,
    `failedStage=${diagnostic.failedStage ?? 'UNKNOWN'}`,
    `correlationId=${diagnostic.correlationId}`,
    'actionRequired=true',
    safetyFields(diagnostic),
  ].join(' ');
}

export function formatNoEntryTelegramSuppressedLog(
  diagnostic: NoEntryStreakDiagnostic,
  delivery: NoEntryTelegramDeliveryDecision,
): string {
  return [
    '[NO_ENTRY_TELEGRAM_SUPPRESSED]',
    `dedupKey=${diagnostic.dedupKey}`,
    `reason=${delivery.reason}`,
    `cooldownRemainingMs=${Math.max(0, Math.ceil(delivery.cooldownRemainingMs))}`,
    'telegramSent=false',
    safetyFields(diagnostic),
  ].join(' ');
}

export function formatNoEntryTelegramSentLog(diagnostic: NoEntryStreakDiagnostic): string {
  return [
    '[NO_ENTRY_TELEGRAM_SENT]',
    `messageType=${diagnostic.messageType}`,
    `dedupKey=${diagnostic.dedupKey}`,
    `actionRequired=${boolText(diagnostic.actionRequired)}`,
    'telegramSent=true',
    safetyFields(diagnostic),
  ].join(' ');
}

export function formatNoEntryWordingPolicyLogs(diagnostic: NoEntryStreakDiagnostic): string[] {
  const decision = buildMessageWordingDecision({
    eventType: diagnostic.eventType,
    originalTone: diagnostic.actionRequired ? 'ACTION_REQUIRED' : 'WARNING',
    executionImpact: diagnostic.executionImpact,
    actionRequired: diagnostic.actionRequired,
    diagnosticOnly: diagnostic.diagnosticOnly,
    displayTextType: diagnostic.actionRequired ? 'NO_ENTRY_ACTION_REQUIRED' : 'NO_ENTRY_DIAGNOSTIC',
  });
  const logs = [
    formatMessageWordingMappedLog(decision),
    formatUserActionLabelResolvedLog(decision),
  ];
  if (!diagnostic.actionRequired && diagnostic.executionImpact === 'NONE') {
    logs.push(formatDiagnosticWordingDowngradedLog(decision, 'normal_no_entry_waiting'));
  }
  return logs;
}

export function buildNoEntryScanSummaryMessage(
  diagnostic: NoEntryStreakDiagnostic,
  input: NoEntryStreakDiagnosticInput,
  mapping: ScanSummaryReasonMapping = mapScanSummaryDisplayReasons({
    scanCycleId: diagnostic.scanCycleId,
    providerFailureCount: input.yahooFailCount ?? 0,
    providerFailureExecutionImpact: diagnostic.dominantNoEntryReason === 'PROVIDER_FAILURE_WITH_EXECUTION_IMPACT'
      ? diagnostic.executionImpact
      : 'NONE',
    providerFailureCausedEntryHold: diagnostic.dominantNoEntryReason === 'PROVIDER_FAILURE_WITH_EXECUTION_IMPACT',
    dominantNoEntryReason: diagnostic.dominantNoEntryReason,
    gateMissCount: input.gateMissCount,
    rrrFailCount: input.rrrFailCount,
    actionRequired: diagnostic.actionRequired,
    executionImpact: diagnostic.executionImpact,
  }),
): string {
  if (diagnostic.actionRequired) {
    return [
      `⚠️ <b>[No-entry 파이프라인 확인 필요]</b> ${input.timeLabel ?? ''}`.trim(),
      '진입 0회가 반복되며 scan pipeline 이상 징후가 확인되었습니다.',
      `원인: ${diagnostic.failureReason ?? reasonLabel(diagnostic.dominantNoEntryReason)}`,
      mapping.providerLine,
      `failedStage=${diagnostic.failedStage ?? 'UNKNOWN'}`,
      `correlationId=${diagnostic.correlationId}`,
      '조치 필요: 있음',
      `pipelineHealthStatus=${diagnostic.pipelineHealthStatus}`,
      `dominantNoEntryReason=${diagnostic.dominantNoEntryReason}`,
      'actionRequired=true',
      `executionImpact=${diagnostic.executionImpact}`,
      'marketSignal=false',
      `providerIssue=${boolText(diagnostic.providerIssue)}`,
      'tradingLogicChanged=false',
      'gateLogicChanged=false',
      'orderLogicChanged=false',
      'thresholdChanged=false',
      'forceScanBlocked=false',
      'shadowLearningBlocked=false',
      'counterfactualBlocked=false',
      'notificationOnly=true',
    ].join('\n');
  }

  return [
    `📊 <b>[스캔 요약]</b> ${input.timeLabel ?? ''}`.trim(),
    `총 후보: ${count(input.candidateCount)}개`,
    '진입 성공: 0개',
    '',
    '상태: 진입 조건 미충족 — 대기',
    `주 원인: ${reasonLabel(diagnostic.dominantNoEntryReason)}`,
    `${mapping.providerLine}`,
    '매매 영향: 없음',
    '조치 필요: 없음',
    '',
    '상세:',
    `${mapping.gateLine}`,
    `${mapping.rrrLine}`,
    `Shadow learning: ${diagnostic.shadowLearningStatus}`,
    `Counterfactual: ${diagnostic.counterfactualStatus}`,
    `pipelineHealthStatus=${diagnostic.pipelineHealthStatus}`,
    `dominantNoEntryReason=${diagnostic.dominantNoEntryReason}`,
    'actionRequired=false',
    'executionImpact=NONE',
    'forceScanBlocked=false',
    'thresholdChanged=false',
    'entryBlockedByNoEntryStreak=false',
    'forceScanBlockedByNoEntryStreak=false',
    'shadowLearningBlockedByNoEntryStreak=false',
    'counterfactualBlockedByNoEntryStreak=false',
    'notificationOnly=true',
    'diagnosticOnly=true',
  ].join('\n');
}
