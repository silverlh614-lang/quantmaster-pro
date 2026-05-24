// @responsibility Gate3 readiness to shadow-entry routing; diagnostic/read-only only.

import type { Gate3CandidateDetail, Gate3Issue, Gate3Readiness } from './gate3CandidateDetail.js';

export type Gate3ShadowRoute =
  | 'SHADOW_ENTRY_ALLOWED'
  | 'NEAR_ENTRY_TRACKING'
  | 'COUNTERFACTUAL_ONLY'
  | 'DIAGNOSTIC_ONLY';

export type Gate3LearningLabel =
  | 'GATE3_READY_FIRED'
  | 'GATE3_WAIT_NEAR_BREAKOUT'
  | 'GATE3_WAIT_DRY_UP'
  | 'GATE3_WAIT_PULLBACK'
  | 'GATE3_BLOCKED_RRR_FAIL'
  | 'GATE3_BLOCKED_RRR_WATCH'
  | 'GATE3_BLOCKED_PRICE_NOT_CONFIRMED'
  | 'GATE3_BLOCKED_VOLUME_WEAK'
  | 'GATE3_BLOCKED_OVEREXTENDED'
  | 'GATE3_BLOCKED_FALSE_BREAKOUT'
  | 'GATE3_DATA_INCOMPLETE_RRR_MISSING'
  | 'GATE3_DATA_INCOMPLETE_PRICE_MISSING'
  | 'GATE3_DATA_INCOMPLETE_VOLUME_MISSING'
  | 'GATE3_DATA_INCOMPLETE_UNKNOWN';

export interface Gate3ShadowPolicy {
  symbol: string;
  sourceSnapshotId: string;
  readiness: Gate3Readiness;
  route: Gate3ShadowRoute;
  shadowEntryAllowed: boolean;
  paperOrderAllowed: boolean;
  nearEntryTracking: boolean;
  watchlistUpgrade: boolean;
  counterfactualAllowed: boolean;
  diagnosticOnly: boolean;
  learningLabel: Gate3LearningLabel;
  liveBuyAllowed: boolean;
  liveBlockReason?: string;
  executionImpact: 'NONE' | 'DIAGNOSTIC_ONLY' | 'LIVE_BUY_BLOCKED_ONLY';
  reason: string;
  marketSignal: false;
  providerIssue: false;
}

export interface Gate3ShadowPolicyExecutionContext {
  livePolicyAllowed?: boolean;
  engineMode?: string | null;
  policyPromotionMode?: string | null;
  macroRegime?: string | null;
  effectiveRegime?: string | null;
  riskOverride?: string | null;
  sellOnlyMode?: boolean;
  shadowOnlyMode?: boolean;
  brokerLiveOrderAllowed?: boolean | null;
}

export interface Gate3ShadowRoutingSummary {
  samples: number;
  routeCounts: Record<Gate3ShadowRoute, number>;
  learningLabels: Record<Gate3LearningLabel, number>;
  shadowEntryAllowedCount: number;
  nearEntryTrackingCount: number;
  counterfactualOnlyCount: number;
  diagnosticOnlyCount: number;
  watchlistUpgradeCount: number;
  paperOrderAllowedCount: number;
  livePolicyBlockedCount: number;
  counterfactualAllowedCount: number;
}

const ROUTES: Gate3ShadowRoute[] = [
  'SHADOW_ENTRY_ALLOWED',
  'NEAR_ENTRY_TRACKING',
  'COUNTERFACTUAL_ONLY',
  'DIAGNOSTIC_ONLY',
];

const LEARNING_LABELS: Gate3LearningLabel[] = [
  'GATE3_READY_FIRED',
  'GATE3_WAIT_NEAR_BREAKOUT',
  'GATE3_WAIT_DRY_UP',
  'GATE3_WAIT_PULLBACK',
  'GATE3_BLOCKED_RRR_FAIL',
  'GATE3_BLOCKED_RRR_WATCH',
  'GATE3_BLOCKED_PRICE_NOT_CONFIRMED',
  'GATE3_BLOCKED_VOLUME_WEAK',
  'GATE3_BLOCKED_OVEREXTENDED',
  'GATE3_BLOCKED_FALSE_BREAKOUT',
  'GATE3_DATA_INCOMPLETE_RRR_MISSING',
  'GATE3_DATA_INCOMPLETE_PRICE_MISSING',
  'GATE3_DATA_INCOMPLETE_VOLUME_MISSING',
  'GATE3_DATA_INCOMPLETE_UNKNOWN',
];

function emptyRouteCounts(): Record<Gate3ShadowRoute, number> {
  return Object.fromEntries(ROUTES.map(route => [route, 0])) as Record<Gate3ShadowRoute, number>;
}

function emptyLearningLabels(): Record<Gate3LearningLabel, number> {
  return Object.fromEntries(LEARNING_LABELS.map(label => [label, 0])) as Record<Gate3LearningLabel, number>;
}

export function emptyGate3ShadowRoutingSummary(): Gate3ShadowRoutingSummary {
  return {
    samples: 0,
    routeCounts: emptyRouteCounts(),
    learningLabels: emptyLearningLabels(),
    shadowEntryAllowedCount: 0,
    nearEntryTrackingCount: 0,
    counterfactualOnlyCount: 0,
    diagnosticOnlyCount: 0,
    watchlistUpgradeCount: 0,
    paperOrderAllowedCount: 0,
    livePolicyBlockedCount: 0,
    counterfactualAllowedCount: 0,
  };
}

function upper(value: unknown): string {
  return typeof value === 'string' ? value.trim().toUpperCase() : '';
}

function hasR6(value: unknown): boolean {
  const normalized = upper(value);
  return normalized === 'R6' || normalized === 'R6_DEFENSE';
}

function resolveLivePolicyBlockReason(context: Gate3ShadowPolicyExecutionContext): string | undefined {
  const engineMode = upper(context.engineMode);
  const promotionMode = upper(context.policyPromotionMode);
  if (context.shadowOnlyMode === true || engineMode === 'SHADOW_ONLY' || promotionMode === 'SHADOW_ONLY') return 'SHADOW_ONLY';
  if (context.sellOnlyMode === true || engineMode === 'SELL_ONLY') return 'SELL_ONLY';
  if (engineMode === 'OBSERVE_ONLY' || promotionMode === 'OBSERVE') return 'OBSERVE_ONLY';
  if (hasR6(context.macroRegime) || hasR6(context.effectiveRegime) || hasR6(context.riskOverride)) return 'R6_DEFENSE';
  if (engineMode === 'MACRO_LIVE_BLOCK') return 'MACRO_LIVE_BLOCK';
  if (context.livePolicyAllowed === false) return 'LIVE_POLICY_BLOCKED';
  if (context.brokerLiveOrderAllowed === false) return 'BROKER_LIVE_ORDER_BLOCKED';
  return undefined;
}

function waitLearningLabel(detail: Gate3CandidateDetail): Gate3LearningLabel {
  if (detail.issue === 'NEAR_BREAKOUT_DRY_UP' || detail.volumeConfirmation.status === 'DRY_UP') return 'GATE3_WAIT_DRY_UP';
  if (detail.issue === 'PULLBACK_ENTRY_PARTIAL_VOLUME' || detail.priceConfirmation.status === 'PULLBACK_ENTRY') return 'GATE3_WAIT_PULLBACK';
  return 'GATE3_WAIT_NEAR_BREAKOUT';
}

function blockedLearningLabel(issue: Gate3Issue): Gate3LearningLabel {
  if (issue === 'RRR_FAIL') return 'GATE3_BLOCKED_RRR_FAIL';
  if (issue === 'RRR_WATCH') return 'GATE3_BLOCKED_RRR_WATCH';
  if (issue === 'VOLUME_WEAK') return 'GATE3_BLOCKED_VOLUME_WEAK';
  if (issue === 'OVEREXTENDED') return 'GATE3_BLOCKED_OVEREXTENDED';
  if (issue === 'FALSE_BREAKOUT_HIGH') return 'GATE3_BLOCKED_FALSE_BREAKOUT';
  return 'GATE3_BLOCKED_PRICE_NOT_CONFIRMED';
}

function dataIncompleteLearningLabel(detail: Gate3CandidateDetail): Gate3LearningLabel {
  if (detail.issue === 'RRR_MISSING' || detail.rrr.status === 'MISSING') return 'GATE3_DATA_INCOMPLETE_RRR_MISSING';
  if (detail.priceConfirmation.status === 'DATA_UNAVAILABLE') return 'GATE3_DATA_INCOMPLETE_PRICE_MISSING';
  if (detail.volumeConfirmation.status === 'DATA_UNAVAILABLE') return 'GATE3_DATA_INCOMPLETE_VOLUME_MISSING';
  return 'GATE3_DATA_INCOMPLETE_UNKNOWN';
}

export function buildGate3ShadowPolicy(
  candidateDetail: Gate3CandidateDetail,
  executionContext: Gate3ShadowPolicyExecutionContext = {},
): Gate3ShadowPolicy {
  if (candidateDetail.readiness === 'READY') {
    const policyBlockReason = resolveLivePolicyBlockReason(executionContext);
    const detailBlockReason = candidateDetail.permissions.liveBuyAllowed ? undefined : 'GATE3_LIVE_PERMISSION_BLOCKED';
    const liveBlockReason = policyBlockReason ?? detailBlockReason;
    const liveBuyAllowed = liveBlockReason === undefined;
    return {
      symbol: candidateDetail.symbol,
      sourceSnapshotId: candidateDetail.sourceSnapshotId,
      readiness: candidateDetail.readiness,
      route: 'SHADOW_ENTRY_ALLOWED',
      shadowEntryAllowed: true,
      paperOrderAllowed: true,
      nearEntryTracking: false,
      watchlistUpgrade: false,
      counterfactualAllowed: true,
      diagnosticOnly: false,
      learningLabel: 'GATE3_READY_FIRED',
      liveBuyAllowed,
      ...(liveBlockReason ? { liveBlockReason } : {}),
      executionImpact: liveBuyAllowed ? 'NONE' : 'LIVE_BUY_BLOCKED_ONLY',
      reason: liveBuyAllowed ? 'READY_SHADOW_ENTRY_ALLOWED' : `READY_SHADOW_ENTRY_ALLOWED_LIVE_BLOCKED:${liveBlockReason}`,
      marketSignal: false,
      providerIssue: false,
    };
  }

  if (candidateDetail.readiness === 'WAIT') {
    return {
      symbol: candidateDetail.symbol,
      sourceSnapshotId: candidateDetail.sourceSnapshotId,
      readiness: candidateDetail.readiness,
      route: 'NEAR_ENTRY_TRACKING',
      shadowEntryAllowed: false,
      paperOrderAllowed: false,
      nearEntryTracking: true,
      watchlistUpgrade: true,
      counterfactualAllowed: true,
      diagnosticOnly: false,
      learningLabel: waitLearningLabel(candidateDetail),
      liveBuyAllowed: false,
      liveBlockReason: 'GATE3_WAIT',
      executionImpact: 'DIAGNOSTIC_ONLY',
      reason: `WAIT:${candidateDetail.issue}`,
      marketSignal: false,
      providerIssue: false,
    };
  }

  if (candidateDetail.readiness === 'BLOCKED') {
    return {
      symbol: candidateDetail.symbol,
      sourceSnapshotId: candidateDetail.sourceSnapshotId,
      readiness: candidateDetail.readiness,
      route: 'COUNTERFACTUAL_ONLY',
      shadowEntryAllowed: false,
      paperOrderAllowed: false,
      nearEntryTracking: false,
      watchlistUpgrade: false,
      counterfactualAllowed: true,
      diagnosticOnly: false,
      learningLabel: blockedLearningLabel(candidateDetail.issue),
      liveBuyAllowed: false,
      liveBlockReason: 'GATE3_BLOCKED',
      executionImpact: 'DIAGNOSTIC_ONLY',
      reason: `BLOCKED:${candidateDetail.issue}`,
      marketSignal: false,
      providerIssue: false,
    };
  }

  return {
    symbol: candidateDetail.symbol,
    sourceSnapshotId: candidateDetail.sourceSnapshotId,
    readiness: candidateDetail.readiness,
    route: 'DIAGNOSTIC_ONLY',
    shadowEntryAllowed: false,
    paperOrderAllowed: false,
    nearEntryTracking: false,
    watchlistUpgrade: false,
    counterfactualAllowed: true,
    diagnosticOnly: true,
    learningLabel: dataIncompleteLearningLabel(candidateDetail),
    liveBuyAllowed: false,
    liveBlockReason: 'GATE3_DATA_INCOMPLETE',
    executionImpact: 'DIAGNOSTIC_ONLY',
    reason: `DATA_INCOMPLETE:${candidateDetail.issue}`,
    marketSignal: false,
    providerIssue: false,
  };
}

export function summarizeGate3ShadowPolicies(
  policies: readonly Gate3ShadowPolicy[],
): Gate3ShadowRoutingSummary {
  const summary = emptyGate3ShadowRoutingSummary();
  summary.samples = policies.length;
  for (const policy of policies) {
    summary.routeCounts[policy.route] += 1;
    summary.learningLabels[policy.learningLabel] += 1;
    if (policy.shadowEntryAllowed) summary.shadowEntryAllowedCount += 1;
    if (policy.nearEntryTracking) summary.nearEntryTrackingCount += 1;
    if (policy.route === 'COUNTERFACTUAL_ONLY') summary.counterfactualOnlyCount += 1;
    if (policy.diagnosticOnly) summary.diagnosticOnlyCount += 1;
    if (policy.watchlistUpgrade) summary.watchlistUpgradeCount += 1;
    if (policy.paperOrderAllowed) summary.paperOrderAllowedCount += 1;
    if (policy.readiness === 'READY' && !policy.liveBuyAllowed && policy.liveBlockReason) summary.livePolicyBlockedCount += 1;
    if (policy.counterfactualAllowed) summary.counterfactualAllowedCount += 1;
  }
  return summary;
}

export function formatGate3ShadowRoutingAuditSection(
  summary: Gate3ShadowRoutingSummary | null | undefined,
): string | null {
  if (!summary || summary.samples <= 0) return null;
  const labelLines = Object.entries(summary.learningLabels)
    .filter(([, count]) => count > 0)
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
    .map(([label, count]) => `  ${label}: ${count}`);
  return [
    'Gate3 Shadow Entry Routing',
    '--------------------------',
    `shadowEntryAllowed: ${summary.shadowEntryAllowedCount}`,
    `nearEntryTracking: ${summary.nearEntryTrackingCount}`,
    `counterfactualOnly: ${summary.counterfactualOnlyCount}`,
    `diagnosticOnly: ${summary.diagnosticOnlyCount}`,
    `watchlistUpgrade: ${summary.watchlistUpgradeCount}`,
    `paperOrderAllowed: ${summary.paperOrderAllowedCount}`,
    `livePolicyBlocked: ${summary.livePolicyBlockedCount}`,
    `counterfactualAllowed: ${summary.counterfactualAllowedCount}`,
    'learningLabels:',
    ...(labelLines.length > 0 ? labelLines : ['  none: 0']),
    'marketSignal=false; shadowLearning=true; counterfactualRecorded=true',
  ].join('\n');
}
