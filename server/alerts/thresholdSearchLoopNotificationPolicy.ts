// @responsibility Threshold Search Loop Telegram proposal dedup policy; diagnostic-only routing.

export type ThresholdNoEntryReason =
  | 'POLICY_LIVE_DISABLED_SHADOW_ONLY'
  | 'OPENING_OR_SESSION_GUARD'
  | 'POSITION_SLOT_OR_RESERVATION'
  | 'GATE3_RRR_FAIL'
  | 'GATE3_PRICE_TIMING_NOT_CONFIRMED'
  | 'PRICE_OVEREXTENDED'
  | 'PRE_BREAKOUT_WAIT'
  | 'GATE2_UNAVAILABLE'
  | 'GATE1_THRESHOLD_NOT_MET'
  | 'DATA_FRESHNESS_STALE'
  | 'UNKNOWN';

export type ThresholdLoopRecommendation = 'OBSERVE' | 'PROPOSAL_REQUIRES_APPROVAL';

export interface ThresholdLoopDiagnosticInput {
  tradeDate?: string;
  regime?: string;
  gateThreshold?: number;
  noEntryStreak: number;
  gateScores?: number[];
  gatePassCount?: number;
  gateScoreAtOrAboveThresholdCount?: number;
  gate3EvaluatedCount?: number;
  gate3RrrFailCount?: number;
  gate3ExecutionReadyCount?: number;
  gate3PriceTimingFailCount?: number;
  priceOverextendedCount?: number;
  preBreakoutWaitCount?: number;
  gate2UnavailableCount?: number;
  gate1ThresholdMissCount?: number;
  policyLiveDisabled?: boolean;
  shadowOnly?: boolean;
  openingGuardActive?: boolean;
  sessionGuardActive?: boolean;
  positionConstraintActive?: boolean;
  slotConstraintActive?: boolean;
  pendingReservationConstraintActive?: boolean;
  dataFreshnessIssue?: boolean;
  dominantNoEntryReason?: ThresholdNoEntryReason;
  now?: Date;
}

export interface ThresholdLoopDiagnostic {
  tradeDate: string;
  eventType: 'THRESHOLD_SEARCH_LOOP';
  regime: string;
  gateThreshold: number | undefined;
  noEntryStreak: number;
  noEntryStreakBucket: string;
  gatePassCount: number;
  dominantNoEntryReason: ThresholdNoEntryReason;
  thresholdLoweringEligible: boolean;
  thresholdProposalGenerated: boolean;
  thresholdAutoChanged: false;
  operatorApprovalRequired: boolean;
  actualThresholdChanged: false;
  thresholdChanged: false;
  executionImpact: 'NONE';
  marketSignal: false;
  providerIssue: false;
  tradingLogicChanged: false;
  gateLogicChanged: false;
  orderLogicChanged: false;
  notificationOnly: true;
  diagnosticOnly: true;
  recommendation: ThresholdLoopRecommendation;
  telegramEligible: boolean;
  dedupKey: string;
  sessionKey: string;
}

export interface ThresholdLoopDeliveryDecision {
  shouldSend: boolean;
  reason:
    | 'TELEGRAM_ELIGIBLE'
    | 'OBSERVE_PUSH_SUPPRESSED'
    | 'COOLDOWN_ACTIVE'
    | 'SESSION_THRESHOLD_PROPOSAL_ALREADY_SENT'
    | 'DAILY_OPERATOR_DECISION_LIMIT_REACHED';
  cooldownRemainingMs: number;
  proposalCountToday: number;
}

const THRESHOLD_LOOP_EVENT_TYPE = 'THRESHOLD_SEARCH_LOOP';
const THRESHOLD_PROPOSAL_COOLDOWN_MS = 60 * 60 * 1000;
const THRESHOLD_DAILY_PROPOSAL_LIMIT = 2;

const sentByDedupKey = new Map<string, number>();
const sentSessionKeys = new Set<string>();
const sentDailyProposalCounts = new Map<string, number>();

function boolText(value: boolean): 'true' | 'false' {
  return value ? 'true' : 'false';
}

function formatThreshold(value: number | undefined): string {
  return Number.isFinite(value) ? String(value) : 'NA';
}

function kstTradeDate(now: Date): string {
  return new Date(now.getTime() + 9 * 3_600_000).toISOString().slice(0, 10);
}

export function thresholdNoEntryStreakBucket(streak: number): string {
  if (streak < 3) return '0~2';
  if (streak < 5) return '3~4';
  if (streak < 8) return '5~7';
  if (streak < 11) return '8~10';
  return '10+';
}

function countGatePasses(input: ThresholdLoopDiagnosticInput): number {
  if (Number.isFinite(input.gatePassCount)) return Math.max(0, Math.trunc(input.gatePassCount ?? 0));
  if (Number.isFinite(input.gateScoreAtOrAboveThresholdCount)) {
    return Math.max(0, Math.trunc(input.gateScoreAtOrAboveThresholdCount ?? 0));
  }
  const gateThreshold = input.gateThreshold;
  if (typeof gateThreshold !== 'number' || !Number.isFinite(gateThreshold) || !input.gateScores) return 0;
  return input.gateScores.filter((score) => Number.isFinite(score) && score >= gateThreshold).length;
}

function resolveDominantNoEntryReason(input: ThresholdLoopDiagnosticInput): ThresholdNoEntryReason {
  if (input.dominantNoEntryReason) return input.dominantNoEntryReason;
  if (input.policyLiveDisabled || input.shadowOnly) return 'POLICY_LIVE_DISABLED_SHADOW_ONLY';
  if (input.openingGuardActive || input.sessionGuardActive) return 'OPENING_OR_SESSION_GUARD';
  if (input.positionConstraintActive || input.slotConstraintActive || input.pendingReservationConstraintActive) {
    return 'POSITION_SLOT_OR_RESERVATION';
  }
  if ((input.gate3EvaluatedCount ?? 0) > 0 && (input.gate3RrrFailCount ?? 0) > 0) return 'GATE3_RRR_FAIL';
  if ((input.gate3RrrFailCount ?? 0) > 0) return 'GATE3_RRR_FAIL';
  if ((input.gate3PriceTimingFailCount ?? 0) > 0) return 'GATE3_PRICE_TIMING_NOT_CONFIRMED';
  if ((input.priceOverextendedCount ?? 0) > 0) return 'PRICE_OVEREXTENDED';
  if ((input.preBreakoutWaitCount ?? 0) > 0) return 'PRE_BREAKOUT_WAIT';
  if ((input.gate2UnavailableCount ?? 0) > 0) return 'GATE2_UNAVAILABLE';
  if ((input.gate1ThresholdMissCount ?? 0) > 0) return 'GATE1_THRESHOLD_NOT_MET';
  if (input.dataFreshnessIssue) return 'DATA_FRESHNESS_STALE';
  return 'UNKNOWN';
}

export function buildThresholdLoopDiagnostic(input: ThresholdLoopDiagnosticInput): ThresholdLoopDiagnostic {
  const now = input.now ?? new Date();
  const tradeDate = input.tradeDate ?? kstTradeDate(now);
  const regime = input.regime ?? 'R4_NEUTRAL';
  const gatePassCount = countGatePasses(input);
  const dominantNoEntryReason = resolveDominantNoEntryReason(input);
  const noEntryStreakBucket = thresholdNoEntryStreakBucket(input.noEntryStreak);
  const gateThreshold = input.gateThreshold;
  const eventType = THRESHOLD_LOOP_EVENT_TYPE;
  const dedupKey = [
    tradeDate,
    `eventType=${eventType}`,
    `regime=${regime}`,
    `gateThreshold=${formatThreshold(gateThreshold)}`,
    `noEntryStreakBucket=${noEntryStreakBucket}`,
    `dominantNoEntryReason=${dominantNoEntryReason}`,
  ].join('|');
  const sessionKey = [
    tradeDate,
    `eventType=${eventType}`,
    `regime=${regime}`,
    `gateThreshold=${formatThreshold(gateThreshold)}`,
  ].join('|');
  const thresholdLoweringEligible = dominantNoEntryReason === 'GATE1_THRESHOLD_NOT_MET' && gatePassCount === 0;
  const recommendation: ThresholdLoopRecommendation = thresholdLoweringEligible
    ? 'PROPOSAL_REQUIRES_APPROVAL'
    : 'OBSERVE';

  return {
    tradeDate,
    eventType,
    regime,
    gateThreshold,
    noEntryStreak: input.noEntryStreak,
    noEntryStreakBucket,
    gatePassCount,
    dominantNoEntryReason,
    thresholdLoweringEligible,
    thresholdProposalGenerated: thresholdLoweringEligible,
    thresholdAutoChanged: false,
    operatorApprovalRequired: thresholdLoweringEligible,
    actualThresholdChanged: false,
    thresholdChanged: false,
    executionImpact: 'NONE',
    marketSignal: false,
    providerIssue: false,
    tradingLogicChanged: false,
    gateLogicChanged: false,
    orderLogicChanged: false,
    notificationOnly: true,
    diagnosticOnly: true,
    recommendation,
    telegramEligible: thresholdLoweringEligible,
    dedupKey,
    sessionKey,
  };
}

export function evaluateThresholdLoopTelegramDelivery(
  diagnostic: ThresholdLoopDiagnostic,
  nowMs = Date.now(),
): ThresholdLoopDeliveryDecision {
  const proposalCountToday = sentDailyProposalCounts.get(diagnostic.tradeDate) ?? 0;
  if (!diagnostic.telegramEligible) {
    return { shouldSend: false, reason: 'OBSERVE_PUSH_SUPPRESSED', cooldownRemainingMs: 0, proposalCountToday };
  }
  const lastSentAt = sentByDedupKey.get(diagnostic.dedupKey);
  if (lastSentAt !== undefined) {
    const elapsed = nowMs - lastSentAt;
    if (elapsed < THRESHOLD_PROPOSAL_COOLDOWN_MS) {
      return {
        shouldSend: false,
        reason: 'COOLDOWN_ACTIVE',
        cooldownRemainingMs: THRESHOLD_PROPOSAL_COOLDOWN_MS - elapsed,
        proposalCountToday,
      };
    }
  }
  if (sentSessionKeys.has(diagnostic.sessionKey)) {
    return {
      shouldSend: false,
      reason: 'SESSION_THRESHOLD_PROPOSAL_ALREADY_SENT',
      cooldownRemainingMs: 0,
      proposalCountToday,
    };
  }
  if (proposalCountToday >= THRESHOLD_DAILY_PROPOSAL_LIMIT) {
    return {
      shouldSend: false,
      reason: 'DAILY_OPERATOR_DECISION_LIMIT_REACHED',
      cooldownRemainingMs: 0,
      proposalCountToday,
    };
  }
  return { shouldSend: true, reason: 'TELEGRAM_ELIGIBLE', cooldownRemainingMs: 0, proposalCountToday };
}

export function recordThresholdLoopTelegramSent(diagnostic: ThresholdLoopDiagnostic, nowMs = Date.now()): void {
  sentByDedupKey.set(diagnostic.dedupKey, nowMs);
  sentSessionKeys.add(diagnostic.sessionKey);
  sentDailyProposalCounts.set(diagnostic.tradeDate, (sentDailyProposalCounts.get(diagnostic.tradeDate) ?? 0) + 1);
}

export function _resetThresholdLoopNotificationState(): void {
  sentByDedupKey.clear();
  sentSessionKeys.clear();
  sentDailyProposalCounts.clear();
}

function safetyFields(diagnostic: ThresholdLoopDiagnostic): string {
  return [
    `executionImpact=${diagnostic.executionImpact}`,
    `marketSignal=${boolText(diagnostic.marketSignal)}`,
    `providerIssue=${boolText(diagnostic.providerIssue)}`,
    `tradingLogicChanged=${boolText(diagnostic.tradingLogicChanged)}`,
    `gateLogicChanged=${boolText(diagnostic.gateLogicChanged)}`,
    `orderLogicChanged=${boolText(diagnostic.orderLogicChanged)}`,
    `thresholdProposalGenerated=${boolText(diagnostic.thresholdProposalGenerated)}`,
    `thresholdAutoChanged=${boolText(diagnostic.thresholdAutoChanged)}`,
    `operatorApprovalRequired=${boolText(diagnostic.operatorApprovalRequired)}`,
    `actualThresholdChanged=${boolText(diagnostic.actualThresholdChanged)}`,
    `thresholdChanged=${boolText(diagnostic.thresholdChanged)}`,
    `notificationOnly=${boolText(diagnostic.notificationOnly)}`,
    `diagnosticOnly=${boolText(diagnostic.diagnosticOnly)}`,
  ].join(' ');
}

export function formatThresholdLoopEvaluatedLog(diagnostic: ThresholdLoopDiagnostic): string {
  return [
    '[THRESHOLD_LOOP_EVALUATED]',
    `tradeDate=${diagnostic.tradeDate}`,
    `regime=${diagnostic.regime}`,
    `gateThreshold=${formatThreshold(diagnostic.gateThreshold)}`,
    `noEntryStreak=${diagnostic.noEntryStreak}`,
    `gatePassCount=${diagnostic.gatePassCount}`,
    `dominantNoEntryReason=${diagnostic.dominantNoEntryReason}`,
    `thresholdLoweringEligible=${boolText(diagnostic.thresholdLoweringEligible)}`,
    safetyFields(diagnostic),
  ].join(' ');
}

export function formatThresholdProposalSuppressedLog(
  diagnostic: ThresholdLoopDiagnostic,
  delivery: ThresholdLoopDeliveryDecision,
  counts?: { gate3RrrFailCount?: number; preBreakoutWaitCount?: number },
): string {
  return [
    '[THRESHOLD_PROPOSAL_SUPPRESSED]',
    `reason=${delivery.reason}`,
    `dedupKey=${diagnostic.dedupKey}`,
    `cooldownRemainingMs=${Math.max(0, Math.ceil(delivery.cooldownRemainingMs))}`,
    `gatePassCount=${diagnostic.gatePassCount}`,
    `gate3RrrFailCount=${counts?.gate3RrrFailCount ?? 0}`,
    `preBreakoutWaitCount=${counts?.preBreakoutWaitCount ?? 0}`,
    'telegramSent=false',
    safetyFields(diagnostic),
  ].join(' ');
}

export function formatThresholdObserveRecommendedLog(diagnostic: ThresholdLoopDiagnostic): string {
  return [
    '[THRESHOLD_OBSERVE_RECOMMENDED]',
    `dominantNoEntryReason=${diagnostic.dominantNoEntryReason}`,
    'thresholdChanged=false',
    `operatorApprovalRequired=${boolText(diagnostic.operatorApprovalRequired)}`,
    'telegramSent=false',
    safetyFields(diagnostic),
  ].join(' ');
}

export function formatThresholdProposalRequiresApprovalLog(
  diagnostic: ThresholdLoopDiagnostic,
  delivery: ThresholdLoopDeliveryDecision,
): string {
  return [
    '[THRESHOLD_PROPOSAL_REQUIRES_APPROVAL]',
    'proposal=REVIEW_GATE1_THRESHOLD_RELAXATION',
    `operatorApprovalRequired=${boolText(diagnostic.operatorApprovalRequired)}`,
    `actualThresholdChanged=${boolText(diagnostic.actualThresholdChanged)}`,
    `telegramEligible=${boolText(delivery.shouldSend)}`,
    `proposalCountToday=${delivery.proposalCountToday + 1}/${THRESHOLD_DAILY_PROPOSAL_LIMIT}`,
    safetyFields(diagnostic),
  ].join(' ');
}

export function formatThresholdTelegramSentLog(diagnostic: ThresholdLoopDiagnostic): string {
  return [
    '[THRESHOLD_TELEGRAM_SENT]',
    `dedupKey=${diagnostic.dedupKey}`,
    `messageType=${diagnostic.recommendation}`,
    'thresholdChanged=false',
    safetyFields(diagnostic),
  ].join(' ');
}

export function buildThresholdProposalApprovalMessage(
  diagnostic: ThresholdLoopDiagnostic,
  delivery: ThresholdLoopDeliveryDecision,
): string {
  return (
    `🎚️ <b>[Threshold Proposal - 승인 필요]</b>\n` +
    `진입 0회 원인: Gate1 threshold 미달 우세\n` +
    `제안: 임계치 완화 검토\n` +
    `실제 변경: 없음\n` +
    `승인 필요: true\n` +
    `오늘 제안 횟수: ${delivery.proposalCountToday + 1}/${THRESHOLD_DAILY_PROPOSAL_LIMIT}\n` +
    `Decision Broker 승인: 필요\n` +
    `forwardOutcomeEvidenceSufficient=required\n` +
    `cooldownSatisfied=true\n` +
    `rollbackPlanAvailable=true\n` +
    `thresholdProposalGenerated=${boolText(diagnostic.thresholdProposalGenerated)}\n` +
    `thresholdAutoChanged=false\n` +
    `actualThresholdChanged=false\n` +
    `executionImpact=NONE\n` +
    `marketSignal=false providerIssue=false tradingLogicChanged=false gateLogicChanged=false orderLogicChanged=false\n` +
    `thresholdChanged=false notificationOnly=true diagnosticOnly=true`
  );
}

export function buildThresholdObserveDiagnosticMessage(diagnostic: ThresholdLoopDiagnostic): string {
  const gatePassLine = diagnostic.gatePassCount > 0 ? '있음' : '없음';
  return (
    `🎚️ <b>[Threshold Diagnostic]</b>\n` +
    `진입 0회 원인: Gate 기준 문제가 아님\n` +
    `Gate 통과 후보: ${gatePassLine}\n` +
    `주 병목: ${diagnostic.dominantNoEntryReason}\n` +
    `권장 조치: 관망 유지\n` +
    `임계치 변경: 없음\n` +
    `매매 영향: 없음\n` +
    `thresholdProposalGenerated=false\n` +
    `thresholdAutoChanged=false\n` +
    `operatorApprovalRequired=false\n` +
    `actualThresholdChanged=false\n` +
    `executionImpact=NONE\n` +
    `marketSignal=false providerIssue=false tradingLogicChanged=false gateLogicChanged=false orderLogicChanged=false\n` +
    `thresholdChanged=false notificationOnly=true diagnosticOnly=true`
  );
}
