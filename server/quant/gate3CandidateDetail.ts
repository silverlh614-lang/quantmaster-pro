// @responsibility Gate3 per-symbol timing forensic detail builder; diagnostic/read-only only.

import type { Gate3ShadowPolicy } from './gate3ShadowPolicy.js';

export type Gate3Readiness = 'READY' | 'WAIT' | 'BLOCKED' | 'DATA_INCOMPLETE';

export type Gate3Issue =
  | 'FIRED'
  | 'RRR_MISSING'
  | 'RRR_FAIL'
  | 'RRR_WATCH'
  | 'PRICE_NOT_CONFIRMED'
  | 'NEAR_BREAKOUT_DRY_UP'
  | 'PULLBACK_ENTRY_PARTIAL_VOLUME'
  | 'OVEREXTENDED'
  | 'VOLUME_WEAK'
  | 'FALSE_BREAKOUT_HIGH'
  | 'LAST_TRIGGER_NOT_FIRED'
  | 'DATA_UNAVAILABLE';

type Gate3CandidatePriceStatus =
  | 'BREAKOUT_CONFIRMED'
  | 'NEAR_BREAKOUT'
  | 'PULLBACK_ENTRY'
  | 'NOT_CONFIRMED'
  | 'OVEREXTENDED'
  | 'DATA_UNAVAILABLE';

type Gate3CandidateVolumeStatus =
  | 'CONFIRMED'
  | 'PARTIAL'
  | 'DRY_UP'
  | 'WEAK'
  | 'SPIKE_RISK'
  | 'DATA_UNAVAILABLE';

type Gate3CandidateLastTriggerStatus =
  | 'FIRED'
  | 'WAIT'
  | 'THRESHOLD_NOT_MET'
  | 'DATA_UNAVAILABLE';

export interface Gate3CandidateDetail {
  symbol: string;
  name?: string;
  sourceSnapshotId: string;
  asOf: string;
  readiness: Gate3Readiness;
  issue: Gate3Issue;
  priceFreshness: 'VERIFIED' | 'FRESH' | 'STALE' | 'MISSING';
  rrr: {
    value: number | null;
    status: 'PASS' | 'WATCH' | 'FAIL' | 'MISSING';
    source: string;
    entryPrice: number | null;
    stopLoss: number | null;
    targetPrice: number | null;
  };
  priceConfirmation: {
    status: Gate3CandidatePriceStatus;
    distanceToHigh20dPct: number | null;
    extensionFromMa20Pct: number | null;
  };
  volumeConfirmation: {
    status: Gate3CandidateVolumeStatus;
    volumeRatio20d: number | null;
  };
  falseBreakoutRisk: 'LOW' | 'WATCH' | 'HIGH' | 'UNKNOWN';
  lastTriggerStatus: Gate3CandidateLastTriggerStatus;
  permissions: {
    liveBuyAllowed: boolean;
    shadowAllowed: boolean;
    counterfactualAllowed: boolean;
    executionImpact: 'NONE' | 'DIAGNOSTIC_ONLY' | 'LIVE_BUY_BLOCKED_ONLY';
  };
  shadowPolicy?: Gate3ShadowPolicy;
  compactText: string;
  marketSignal: false;
}

export interface Gate3CandidateDetailGroups {
  ready: Gate3CandidateDetail[];
  wait: Gate3CandidateDetail[];
  blocked: Gate3CandidateDetail[];
  dataIncomplete: Gate3CandidateDetail[];
  detailTruncated: boolean;
  hiddenReadyCount: number;
  hiddenWaitCount: number;
  hiddenBlockedCount: number;
  hiddenDataIncompleteCount: number;
}

export interface BuildGate3CandidateDetailInput {
  symbol: string;
  name?: string;
  sourceSnapshotId?: string;
  asOf?: string;
  consolidatedDiagnostic: Record<string, unknown>;
}

const DEFAULT_SOURCE_SNAPSHOT_ID = 'SOURCE_SNAPSHOT_UNKNOWN';
const DEFAULT_AS_OF = 'AS_OF_UNKNOWN';

function asRecord(value: unknown): Record<string, unknown> {
  return value != null && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {};
}

function asString(value: unknown): string | null {
  return typeof value === 'string' && value.trim() ? value.trim() : null;
}

function asNumber(value: unknown): number | null {
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  if (typeof value === 'string' && value.trim()) {
    const parsed = Number(value.replace(/,/g, ''));
    if (Number.isFinite(parsed)) return parsed;
  }
  return null;
}

function normalizeReadiness(value: unknown, lastTriggerStatus: string): Gate3Readiness {
  const raw = String(value ?? '').toUpperCase();
  if (raw === 'READY' || raw === 'WAIT' || raw === 'BLOCKED' || raw === 'DATA_INCOMPLETE') {
    return raw as Gate3Readiness;
  }
  if (lastTriggerStatus === 'FIRED') return 'READY';
  if (lastTriggerStatus === 'DATA_UNAVAILABLE') return 'DATA_INCOMPLETE';
  if (lastTriggerStatus === 'THRESHOLD_NOT_MET' || lastTriggerStatus === 'SANITY_REJECTED') return 'BLOCKED';
  return 'WAIT';
}

function normalizePriceFreshness(value: unknown): Gate3CandidateDetail['priceFreshness'] {
  const raw = String(value ?? '').toUpperCase();
  return raw === 'VERIFIED' || raw === 'FRESH' || raw === 'STALE' || raw === 'MISSING' ? raw : 'MISSING';
}

function normalizeRrrStatus(value: unknown): Gate3CandidateDetail['rrr']['status'] {
  const raw = String(value ?? '').toUpperCase();
  return raw === 'PASS' || raw === 'WATCH' || raw === 'FAIL' || raw === 'MISSING' ? raw : 'MISSING';
}

function normalizePriceStatus(value: unknown): Gate3CandidatePriceStatus {
  const raw = String(value ?? '').toUpperCase();
  if (
    raw === 'BREAKOUT_CONFIRMED' ||
    raw === 'NEAR_BREAKOUT' ||
    raw === 'PULLBACK_ENTRY' ||
    raw === 'NOT_CONFIRMED' ||
    raw === 'OVEREXTENDED' ||
    raw === 'DATA_UNAVAILABLE'
  ) {
    return raw;
  }
  if (raw === 'CONFIRMED') return 'BREAKOUT_CONFIRMED';
  return 'DATA_UNAVAILABLE';
}

function normalizeVolumeStatus(value: unknown): Gate3CandidateVolumeStatus {
  const raw = String(value ?? '').toUpperCase();
  if (raw === 'CONFIRMED' || raw === 'PARTIAL' || raw === 'DRY_UP' || raw === 'WEAK' || raw === 'SPIKE_RISK' || raw === 'DATA_UNAVAILABLE') {
    return raw;
  }
  if (raw === 'MISSING') return 'DATA_UNAVAILABLE';
  return 'DATA_UNAVAILABLE';
}

function normalizeFalseBreakoutRisk(value: unknown): Gate3CandidateDetail['falseBreakoutRisk'] {
  const raw = String(value ?? '').toUpperCase();
  if (raw === 'LOW' || raw === 'WATCH' || raw === 'HIGH') return raw;
  return 'UNKNOWN';
}

function normalizeExecutionImpact(value: unknown): Gate3CandidateDetail['permissions']['executionImpact'] {
  const raw = String(value ?? '').toUpperCase();
  if (raw === 'NONE' || raw === 'DIAGNOSTIC_ONLY' || raw === 'LIVE_BUY_BLOCKED_ONLY') return raw;
  return 'DIAGNOSTIC_ONLY';
}

function normalizeLastTriggerStatus(rawStatus: string, readiness: Gate3Readiness): Gate3CandidateLastTriggerStatus {
  if (rawStatus === 'FIRED') return 'FIRED';
  if (rawStatus === 'DATA_UNAVAILABLE') return 'DATA_UNAVAILABLE';
  if (readiness === 'WAIT') return 'WAIT';
  return 'THRESHOLD_NOT_MET';
}

function issueFor(input: {
  readiness: Gate3Readiness;
  rawLastTriggerStatus: string;
  rrrStatus: Gate3CandidateDetail['rrr']['status'];
  priceStatus: Gate3CandidatePriceStatus;
  volumeStatus: Gate3CandidateVolumeStatus;
  falseBreakoutRisk: Gate3CandidateDetail['falseBreakoutRisk'];
}): Gate3Issue {
  if (input.rrrStatus === 'MISSING') return 'RRR_MISSING';
  if (input.rawLastTriggerStatus === 'FIRED') return 'FIRED';
  if (input.falseBreakoutRisk === 'HIGH') return 'FALSE_BREAKOUT_HIGH';
  if (input.rrrStatus === 'FAIL') return 'RRR_FAIL';
  if (input.priceStatus === 'OVEREXTENDED') return 'OVEREXTENDED';
  if (input.volumeStatus === 'WEAK') return 'VOLUME_WEAK';
  if (input.priceStatus === 'NOT_CONFIRMED') return 'PRICE_NOT_CONFIRMED';
  if (input.priceStatus === 'NEAR_BREAKOUT' && input.volumeStatus === 'DRY_UP') return 'NEAR_BREAKOUT_DRY_UP';
  if (input.priceStatus === 'PULLBACK_ENTRY' && (input.volumeStatus === 'PARTIAL' || input.volumeStatus === 'DRY_UP')) {
    return 'PULLBACK_ENTRY_PARTIAL_VOLUME';
  }
  if (input.rrrStatus === 'WATCH') return 'RRR_WATCH';
  if (input.readiness === 'DATA_INCOMPLETE' || input.rawLastTriggerStatus === 'DATA_UNAVAILABLE') return 'DATA_UNAVAILABLE';
  return 'LAST_TRIGGER_NOT_FIRED';
}

function displayName(detail: Pick<Gate3CandidateDetail, 'symbol' | 'name'>): string {
  return detail.name ? `${detail.name}(${detail.symbol})` : detail.symbol;
}

function rrrText(detail: Pick<Gate3CandidateDetail, 'rrr'>): string {
  return detail.rrr.value == null ? (detail.rrr.status === 'MISSING' ? 'MISSING' : detail.rrr.status) : `${detail.rrr.value.toFixed(2)} ${detail.rrr.status}`;
}

function volumeText(detail: Pick<Gate3CandidateDetail, 'volumeConfirmation'>): string {
  const ratio = detail.volumeConfirmation.volumeRatio20d;
  return ratio == null
    ? detail.volumeConfirmation.status
    : `${detail.volumeConfirmation.status} ${ratio.toFixed(2)}x`;
}

function liveText(policy: Gate3ShadowPolicy): string {
  return policy.liveBuyAllowed
    ? 'live=true'
    : `live=false${policy.liveBlockReason ? `(${policy.liveBlockReason})` : ''}`;
}

function shadowPolicyText(policy: Gate3ShadowPolicy | undefined): string {
  if (!policy) return '';
  return [
    `route=${policy.route}`,
    `shadowEntry=${policy.shadowEntryAllowed}`,
    `paper=${policy.paperOrderAllowed}`,
    `watchUpgrade=${policy.watchlistUpgrade}`,
    `counterfactual=${policy.counterfactualAllowed}`,
    liveText(policy),
    `label=${policy.learningLabel}`,
  ].join(' | ');
}

function iconFor(readiness: Gate3Readiness): string {
  if (readiness === 'READY') return '🟢';
  if (readiness === 'WAIT') return '🟡';
  if (readiness === 'BLOCKED') return '🔴';
  return '⚪';
}

function formatGate3CandidateCompactText(detail: Gate3CandidateDetail): string {
  const common = `${iconFor(detail.readiness)} ${displayName(detail)} ${detail.readiness}`;
  const policy = shadowPolicyText(detail.shadowPolicy);
  const policySegment = policy ? ` | ${policy}` : '';
  if (detail.readiness === 'READY') {
    return `${common}${policySegment} | RRR ${rrrText(detail)} | Price ${detail.priceConfirmation.status} | Vol ${volumeText(detail)} | Trigger FIRED | live=${detail.permissions.liveBuyAllowed} shadow=${detail.permissions.shadowAllowed} | marketSignal=false`;
  }
  if (detail.readiness === 'WAIT') {
    return `${common} | issue=${detail.issue}${policySegment} | RRR ${rrrText(detail)} | Price ${detail.priceConfirmation.status} | Vol ${volumeText(detail)} | Trigger ${detail.lastTriggerStatus} | shadow=${detail.permissions.shadowAllowed} | marketSignal=false`;
  }
  if (detail.readiness === 'BLOCKED') {
    return `${common} | issue=${detail.issue}${policySegment} | RRR ${rrrText(detail)} | Price ${detail.priceConfirmation.status} | Vol ${volumeText(detail)} | Trigger ${detail.lastTriggerStatus} | marketSignal=false`;
  }
  return `${common} | issue=${detail.issue}${policySegment} | RRR ${rrrText(detail)} | Price ${detail.priceConfirmation.status} | Vol ${volumeText(detail)} | Trigger ${detail.lastTriggerStatus} | executionImpact=${detail.permissions.executionImpact} | marketSignal=false`;
}

export function buildGate3CandidateDetail(input: BuildGate3CandidateDetailInput): Gate3CandidateDetail {
  const diagnostic = input.consolidatedDiagnostic;
  const lastTrigger = asRecord(diagnostic.lastTrigger);
  const entryPriceGuard = asRecord(diagnostic.entryPriceGuard);
  const rrrCheck = asRecord(diagnostic.rrrCheck);
  const timingAlignment = asRecord(diagnostic.timingAlignment);
  const priceConfirmation = asRecord(lastTrigger.priceConfirmation);
  const volumeConfirmationDetail = asRecord(lastTrigger.volumeConfirmationDetail);
  const rawLastTriggerStatus = String(lastTrigger.status ?? 'UNKNOWN').toUpperCase();
  const readiness = normalizeReadiness(diagnostic.timingReadiness, rawLastTriggerStatus);
  const priceStatus = normalizePriceStatus(priceConfirmation.status ?? timingAlignment.priceBreakout);
  const volumeStatus = normalizeVolumeStatus(volumeConfirmationDetail.status ?? timingAlignment.volume);
  const rrrStatus = normalizeRrrStatus(rrrCheck.status);
  const falseBreakoutRisk = normalizeFalseBreakoutRisk(diagnostic.falseBreakoutRisk ?? timingAlignment.falseBreakoutRisk);
  const issue = issueFor({
    readiness,
    rawLastTriggerStatus,
    rrrStatus,
    priceStatus,
    volumeStatus,
    falseBreakoutRisk,
  });

  const detail: Gate3CandidateDetail = {
    symbol: input.symbol || 'UNKNOWN',
    ...(input.name ? { name: input.name } : {}),
    sourceSnapshotId: input.sourceSnapshotId ?? DEFAULT_SOURCE_SNAPSHOT_ID,
    asOf: input.asOf ?? DEFAULT_AS_OF,
    readiness,
    issue,
    priceFreshness: normalizePriceFreshness(entryPriceGuard.priceFreshness),
    rrr: {
      value: asNumber(rrrCheck.rrr),
      status: rrrStatus,
      source: asString(rrrCheck.source) ?? 'MISSING',
      entryPrice: asNumber(rrrCheck.entryPrice),
      stopLoss: asNumber(rrrCheck.stopLoss),
      targetPrice: asNumber(rrrCheck.targetPrice),
    },
    priceConfirmation: {
      status: priceStatus,
      distanceToHigh20dPct: asNumber(priceConfirmation.distanceToHigh20dPct),
      extensionFromMa20Pct: asNumber(priceConfirmation.extensionFromMa20Pct),
    },
    volumeConfirmation: {
      status: volumeStatus,
      volumeRatio20d: asNumber(volumeConfirmationDetail.volumeRatio20d),
    },
    falseBreakoutRisk,
    lastTriggerStatus: normalizeLastTriggerStatus(rawLastTriggerStatus, readiness),
    permissions: {
      liveBuyAllowed: lastTrigger.liveBuyAllowed === true,
      shadowAllowed: lastTrigger.shadowObservableAllowed !== false,
      counterfactualAllowed: lastTrigger.counterfactualAllowed !== false,
      executionImpact: normalizeExecutionImpact(lastTrigger.executionImpact ?? diagnostic.executionImpact),
    },
    compactText: '',
    marketSignal: false,
  };
  return {
    ...detail,
    compactText: formatGate3CandidateCompactText(detail),
  };
}

function rankReady(a: Gate3CandidateDetail, b: Gate3CandidateDetail): number {
  return (b.rrr.value ?? -1) - (a.rrr.value ?? -1)
    || (b.volumeConfirmation.volumeRatio20d ?? -1) - (a.volumeConfirmation.volumeRatio20d ?? -1)
    || Number(b.priceConfirmation.status === 'BREAKOUT_CONFIRMED') - Number(a.priceConfirmation.status === 'BREAKOUT_CONFIRMED')
    || a.symbol.localeCompare(b.symbol);
}

function rankWait(a: Gate3CandidateDetail, b: Gate3CandidateDetail): number {
  const near = Number(b.priceConfirmation.status === 'NEAR_BREAKOUT') - Number(a.priceConfirmation.status === 'NEAR_BREAKOUT');
  const dry = Number(b.volumeConfirmation.status === 'DRY_UP') - Number(a.volumeConfirmation.status === 'DRY_UP');
  const pass = Number(b.rrr.status === 'PASS') - Number(a.rrr.status === 'PASS');
  const distanceA = Math.abs(a.priceConfirmation.distanceToHigh20dPct ?? 999);
  const distanceB = Math.abs(b.priceConfirmation.distanceToHigh20dPct ?? 999);
  return near || dry || pass || distanceA - distanceB || a.symbol.localeCompare(b.symbol);
}

function rankBlocked(a: Gate3CandidateDetail, b: Gate3CandidateDetail): number {
  const priority: Record<Gate3Issue, number> = {
    FALSE_BREAKOUT_HIGH: 0,
    OVEREXTENDED: 1,
    RRR_FAIL: 2,
    VOLUME_WEAK: 3,
    PRICE_NOT_CONFIRMED: 4,
    RRR_WATCH: 5,
    RRR_MISSING: 6,
    NEAR_BREAKOUT_DRY_UP: 7,
    PULLBACK_ENTRY_PARTIAL_VOLUME: 8,
    LAST_TRIGGER_NOT_FIRED: 9,
    DATA_UNAVAILABLE: 10,
    FIRED: 11,
  };
  return priority[a.issue] - priority[b.issue] || a.symbol.localeCompare(b.symbol);
}

function rankDataIncomplete(a: Gate3CandidateDetail, b: Gate3CandidateDetail): number {
  const priority: Record<Gate3Issue, number> = {
    RRR_MISSING: 0,
    DATA_UNAVAILABLE: 1,
    PRICE_NOT_CONFIRMED: 2,
    VOLUME_WEAK: 3,
    RRR_FAIL: 4,
    RRR_WATCH: 5,
    FALSE_BREAKOUT_HIGH: 6,
    OVEREXTENDED: 7,
    NEAR_BREAKOUT_DRY_UP: 8,
    PULLBACK_ENTRY_PARTIAL_VOLUME: 9,
    LAST_TRIGGER_NOT_FIRED: 10,
    FIRED: 11,
  };
  return priority[a.issue] - priority[b.issue] || a.symbol.localeCompare(b.symbol);
}

export function groupGate3CandidateDetails(
  details: readonly Gate3CandidateDetail[],
  limits: { ready?: number; wait?: number; blocked?: number; dataIncomplete?: number } = {},
): Gate3CandidateDetailGroups {
  const readyLimit = limits.ready ?? 5;
  const waitLimit = limits.wait ?? 10;
  const blockedLimit = limits.blocked ?? 10;
  const dataIncompleteLimit = limits.dataIncomplete ?? 10;
  const readyAll = details.filter(detail => detail.readiness === 'READY').sort(rankReady);
  const waitAll = details.filter(detail => detail.readiness === 'WAIT').sort(rankWait);
  const blockedAll = details.filter(detail => detail.readiness === 'BLOCKED').sort(rankBlocked);
  const dataIncompleteAll = details.filter(detail => detail.readiness === 'DATA_INCOMPLETE').sort(rankDataIncomplete);

  const hiddenReadyCount = Math.max(0, readyAll.length - readyLimit);
  const hiddenWaitCount = Math.max(0, waitAll.length - waitLimit);
  const hiddenBlockedCount = Math.max(0, blockedAll.length - blockedLimit);
  const hiddenDataIncompleteCount = Math.max(0, dataIncompleteAll.length - dataIncompleteLimit);

  return {
    ready: readyAll.slice(0, readyLimit),
    wait: waitAll.slice(0, waitLimit),
    blocked: blockedAll.slice(0, blockedLimit),
    dataIncomplete: dataIncompleteAll.slice(0, dataIncompleteLimit),
    detailTruncated: hiddenReadyCount + hiddenWaitCount + hiddenBlockedCount + hiddenDataIncompleteCount > 0,
    hiddenReadyCount,
    hiddenWaitCount,
    hiddenBlockedCount,
    hiddenDataIncompleteCount,
  };
}

export function normalizeGate3CandidateDetailSnapshot(
  detail: Gate3CandidateDetail,
  input: { sourceSnapshotId?: string; asOf?: string },
): Gate3CandidateDetail {
  const sourceSnapshotId = input.sourceSnapshotId ?? detail.sourceSnapshotId;
  const normalized = {
    ...detail,
    sourceSnapshotId,
    asOf: input.asOf ?? detail.asOf,
    ...(detail.shadowPolicy
      ? { shadowPolicy: { ...detail.shadowPolicy, sourceSnapshotId } }
      : {}),
  };
  return {
    ...normalized,
    compactText: formatGate3CandidateCompactText(normalized),
  };
}

export function withGate3ShadowPolicy(
  detail: Gate3CandidateDetail,
  shadowPolicy: Gate3ShadowPolicy,
): Gate3CandidateDetail {
  const withPolicy = {
    ...detail,
    shadowPolicy,
  };
  return {
    ...withPolicy,
    compactText: formatGate3CandidateCompactText(withPolicy),
  };
}

function sectionLines(title: string, details: readonly Gate3CandidateDetail[]): string[] {
  if (details.length === 0) return [];
  return [title, ...details.map(detail => `- ${detail.compactText}`)];
}

export function formatGate3CandidateDetailTable(input: {
  detailsByReadiness?: Gate3CandidateDetailGroups | null;
  candidateDetails?: readonly Gate3CandidateDetail[];
}): string | null {
  const groups = input.detailsByReadiness ?? groupGate3CandidateDetails(input.candidateDetails ?? []);
  const lines = [
    'Gate3 Candidate Detail',
    '━━━━━━━━━━━━━━━━',
    ...sectionLines('🟢 READY', groups.ready),
    ...sectionLines('🟡 WAIT', groups.wait),
    ...sectionLines('🔴 BLOCKED', groups.blocked),
    ...sectionLines('⚪ DATA_INCOMPLETE', groups.dataIncomplete),
  ];
  if (groups.detailTruncated) {
    lines.push(
      `detailTruncated=true hiddenReadyCount=${groups.hiddenReadyCount} hiddenWaitCount=${groups.hiddenWaitCount} hiddenBlockedCount=${groups.hiddenBlockedCount} hiddenDataIncompleteCount=${groups.hiddenDataIncompleteCount}`,
    );
  }
  return lines.length > 2 ? lines.join('\n') : null;
}
