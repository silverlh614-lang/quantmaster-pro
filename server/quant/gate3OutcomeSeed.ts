// @responsibility Gate3 outcome seed creation and tracking summary; read/record only.

import type { Gate3CandidateDetail, Gate3Readiness } from './gate3CandidateDetail.js';
import type { Gate3LearningLabel, Gate3ShadowPolicy, Gate3ShadowRoute } from './gate3ShadowPolicy.js';

export type Gate3OutcomeStatus =
  | 'PENDING'
  | 'PARTIAL'
  | 'LABELED'
  | 'EXPIRED'
  | 'DATA_INSUFFICIENT';

export type Gate3OutcomeLabel =
  | 'GATE3_READY_WIN'
  | 'GATE3_READY_LOSS'
  | 'GATE3_READY_BREAKEVEN'
  | 'GATE3_READY_FAILED_BREAKOUT'
  | 'GATE3_READY_FOLLOW_THROUGH'
  | 'GATE3_WAIT_BECAME_READY'
  | 'GATE3_WAIT_MISSED_BREAKOUT'
  | 'GATE3_WAIT_CORRECT_PATIENCE'
  | 'GATE3_WAIT_FAILED_SETUP'
  | 'GATE3_BLOCKED_CORRECT'
  | 'GATE3_BLOCKED_FALSE_NEGATIVE'
  | 'GATE3_BLOCKED_OVERSTRICT_RRR'
  | 'GATE3_BLOCKED_OVERSTRICT_VOLUME'
  | 'GATE3_BLOCKED_OVERSTRICT_PRICE'
  | 'GATE3_DATA_INCOMPLETE_RESOLVED'
  | 'GATE3_DATA_INCOMPLETE_MISSED_OPPORTUNITY'
  | 'GATE3_DATA_INCOMPLETE_NO_SIGNAL'
  | 'GATE3_DATA_INCOMPLETE_PROVIDER_GAP';

export interface Gate3ForwardReturns {
  d1: number | null;
  d3: number | null;
  d5: number | null;
  d10: number | null;
}

export interface Gate3OutcomeSeed {
  id: string;
  symbol: string;
  name?: string;
  sourceSnapshotId: string;
  gate3SnapshotId: string;
  asOf: string;
  tradeDate: string;
  /** counterfacture_gate Phase F — ROC 레짐 stratify 키. 미보유(구 seed) → 투영 시 'UNKNOWN'. */
  regime?: string;
  readiness: Gate3Readiness;
  issue: string;
  route: Gate3ShadowRoute;
  entryReferencePrice: number | null;
  stopLoss: number | null;
  targetPrice: number | null;
  rrr: number | null;
  priceConfirmation: string;
  volumeConfirmation: string;
  falseBreakoutRisk: string;
  lastTriggerStatus: string;
  learningLabel: Gate3LearningLabel;
  forwardReturns: Gate3ForwardReturns;
  maxForwardReturnPct: number | null;
  minForwardReturnPct: number | null;
  hitTarget: boolean | null;
  hitStop: boolean | null;
  outcomeStatus: Gate3OutcomeStatus;
  outcomeLabel: Gate3OutcomeLabel | null;
  executionImpact: 'NONE' | 'DIAGNOSTIC_ONLY' | 'LIVE_BUY_BLOCKED_ONLY';
  marketSignal: false;
  providerIssue: false;
}

export interface Gate3OutcomeSeedContext {
  gate3SnapshotId?: string;
  asOf?: string;
  tradeDate?: string;
  regime?: string;
}

export interface Gate3OutcomeTrackingSummary {
  seedCreatedToday: number;
  pending: number;
  partial: number;
  labeled: number;
  expired: number;
  dataInsufficient: number;
  duplicateSuppressed: number;
  byReadiness: Record<Gate3Readiness, { pending: number; labeled: number }>;
  recentLabels: Partial<Record<Gate3OutcomeLabel, number>>;
  marketSignal: false;
  providerIssue: false;
  executionImpact: 'NONE';
}

const READINESS_VALUES: Gate3Readiness[] = ['READY', 'WAIT', 'BLOCKED', 'DATA_INCOMPLETE'];

function safeKey(value: string): string {
  return value.replace(/[^A-Za-z0-9_-]/g, '_').slice(0, 80) || 'UNKNOWN';
}

function fallbackTradeDate(asOf: string): string {
  return asOf.slice(0, 10) || new Date().toISOString().slice(0, 10);
}

function round4(value: number): number {
  return Math.round(value * 10_000) / 10_000;
}

function finiteNumber(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

function buildGate3OutcomeSeedId(input: {
  symbol: string;
  tradeDate: string;
  sourceSnapshotId: string;
  readiness: Gate3Readiness;
  issue: string;
}): string {
  return [
    'gate3-outcome',
    safeKey(input.tradeDate),
    safeKey(input.symbol),
    safeKey(input.sourceSnapshotId),
    input.readiness,
    safeKey(input.issue),
  ].join(':').slice(0, 220);
}

export function gate3OutcomeDuplicateKey(seed: Pick<Gate3OutcomeSeed, 'symbol' | 'tradeDate' | 'sourceSnapshotId' | 'readiness' | 'issue'>): string {
  return `${seed.symbol}|${seed.tradeDate}|${seed.sourceSnapshotId}|${seed.readiness}|${seed.issue}`;
}

export function buildGate3OutcomeSeed(
  candidateDetail: Gate3CandidateDetail,
  shadowPolicy: Gate3ShadowPolicy,
  context: Gate3OutcomeSeedContext = {},
): Gate3OutcomeSeed {
  const asOf = context.asOf ?? candidateDetail.asOf;
  const tradeDate = context.tradeDate ?? fallbackTradeDate(asOf);
  const gate3SnapshotId = context.gate3SnapshotId ?? `${candidateDetail.sourceSnapshotId}:gate3`;
  const entryReferencePrice = finiteNumber(candidateDetail.rrr.entryPrice);
  const seedBase = {
    symbol: candidateDetail.symbol,
    tradeDate,
    sourceSnapshotId: candidateDetail.sourceSnapshotId,
    readiness: candidateDetail.readiness,
    issue: candidateDetail.issue,
  };
  return {
    id: buildGate3OutcomeSeedId(seedBase),
    symbol: candidateDetail.symbol,
    ...(candidateDetail.name ? { name: candidateDetail.name } : {}),
    sourceSnapshotId: candidateDetail.sourceSnapshotId,
    gate3SnapshotId,
    asOf,
    tradeDate,
    ...(context.regime ? { regime: context.regime } : {}),
    readiness: candidateDetail.readiness,
    issue: candidateDetail.issue,
    route: shadowPolicy.route,
    entryReferencePrice,
    stopLoss: finiteNumber(candidateDetail.rrr.stopLoss),
    targetPrice: finiteNumber(candidateDetail.rrr.targetPrice),
    rrr: finiteNumber(candidateDetail.rrr.value),
    priceConfirmation: candidateDetail.priceConfirmation.status,
    volumeConfirmation: candidateDetail.volumeConfirmation.status,
    falseBreakoutRisk: candidateDetail.falseBreakoutRisk,
    lastTriggerStatus: candidateDetail.lastTriggerStatus,
    learningLabel: shadowPolicy.learningLabel,
    forwardReturns: { d1: null, d3: null, d5: null, d10: null },
    maxForwardReturnPct: null,
    minForwardReturnPct: null,
    hitTarget: null,
    hitStop: null,
    outcomeStatus: entryReferencePrice === null ? 'DATA_INSUFFICIENT' : 'PENDING',
    outcomeLabel: null,
    executionImpact: shadowPolicy.executionImpact,
    marketSignal: false,
    providerIssue: false,
  };
}

export function buildGate3OutcomeSeeds(
  candidateDetails: readonly Gate3CandidateDetail[],
  shadowPolicies: readonly Gate3ShadowPolicy[],
  context: Gate3OutcomeSeedContext = {},
): Gate3OutcomeSeed[] {
  const seeds: Gate3OutcomeSeed[] = [];
  candidateDetails.forEach((detail, index) => {
    const policy = shadowPolicies[index] ?? detail.shadowPolicy;
    if (policy) seeds.push(buildGate3OutcomeSeed(detail, policy, context));
  });
  return seeds;
}

function emptyReadinessSummary(): Record<Gate3Readiness, { pending: number; labeled: number }> {
  return {
    READY: { pending: 0, labeled: 0 },
    WAIT: { pending: 0, labeled: 0 },
    BLOCKED: { pending: 0, labeled: 0 },
    DATA_INCOMPLETE: { pending: 0, labeled: 0 },
  };
}

export function summarizeGate3OutcomeSeeds(
  seeds: readonly Gate3OutcomeSeed[],
  input: {
    tradeDate?: string;
    seedCreatedToday?: number;
    duplicateSuppressed?: number;
  } = {},
): Gate3OutcomeTrackingSummary {
  const tradeDate = input.tradeDate ?? new Date().toISOString().slice(0, 10);
  const byReadiness = emptyReadinessSummary();
  const recentLabels: Partial<Record<Gate3OutcomeLabel, number>> = {};
  let pending = 0;
  let partial = 0;
  let labeled = 0;
  let expired = 0;
  let dataInsufficient = 0;
  for (const seed of seeds) {
    if (seed.outcomeStatus === 'PENDING') pending += 1;
    if (seed.outcomeStatus === 'PARTIAL') partial += 1;
    if (seed.outcomeStatus === 'LABELED') labeled += 1;
    if (seed.outcomeStatus === 'EXPIRED') expired += 1;
    if (seed.outcomeStatus === 'DATA_INSUFFICIENT') dataInsufficient += 1;
    if (seed.outcomeStatus === 'LABELED') byReadiness[seed.readiness].labeled += 1;
    if (seed.outcomeStatus === 'PENDING' || seed.outcomeStatus === 'PARTIAL') byReadiness[seed.readiness].pending += 1;
    if (seed.outcomeLabel) recentLabels[seed.outcomeLabel] = (recentLabels[seed.outcomeLabel] ?? 0) + 1;
  }
  return {
    seedCreatedToday: input.seedCreatedToday ?? seeds.filter(seed => seed.tradeDate === tradeDate).length,
    pending,
    partial,
    labeled,
    expired,
    dataInsufficient,
    duplicateSuppressed: input.duplicateSuppressed ?? 0,
    byReadiness,
    recentLabels,
    marketSignal: false,
    providerIssue: false,
    executionImpact: 'NONE',
  };
}

function recentLabelLines(labels: Partial<Record<Gate3OutcomeLabel, number>>): string[] {
  const entries = Object.entries(labels)
    .filter(([, count]) => Number.isFinite(count) && (count ?? 0) > 0)
    .sort((a, b) => (b[1] ?? 0) - (a[1] ?? 0) || a[0].localeCompare(b[0]));
  if (entries.length === 0) return ['N/A - pending forward returns'];
  return entries.map(([label, count]) => `${label}: ${count}`);
}

export function formatGate3OutcomeTrackingSummary(
  summary: Gate3OutcomeTrackingSummary | null | undefined,
): string | null {
  if (!summary) return null;
  const readinessLine = (readiness: Gate3Readiness): string => {
    const item = summary.byReadiness[readiness];
    return `${readiness}: pending ${item.pending} / labeled ${item.labeled}`;
  };
  return [
    'Gate3 Outcome Tracking',
    '----------------------',
    `seedCreatedToday: ${summary.seedCreatedToday}`,
    `pending: ${summary.pending}`,
    `partial: ${summary.partial}`,
    `labeled: ${summary.labeled}`,
    `expired: ${summary.expired}`,
    `dataInsufficient: ${summary.dataInsufficient}`,
    `duplicateSuppressed: ${summary.duplicateSuppressed}`,
    '',
    'By Readiness:',
    ...READINESS_VALUES.map(readinessLine),
    '',
    'Recent Labels:',
    ...recentLabelLines(summary.recentLabels),
    'marketSignal=false; shadowLearning=true; counterfactualRecorded=true',
  ].join('\n');
}

export { round4 as roundGate3OutcomePct };
