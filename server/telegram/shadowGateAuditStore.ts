/**
 * @responsibility Patch-SHADOW-GATE-AUDIT-001 — Shadow Gate vs Live minimum signal gate diagnostic audit.
 *
 * Diagnostic/audit only: thresholds, score weights, live order routing, KIS order calls,
 * and Shadow approval semantics are intentionally unchanged.
 */

import { loadGate1ForensicTrace } from '../persistence/gate1MinimumSignalForensicTraceRepo.js';
import type { Gate1MinimumSignalForensicAuditAdr0505 } from '../trading/signalScanner/gate1MinimumSignalForensicAuditAdr0505.js';
import type { ShadowApprovalSourceLane, ShadowApprovalState } from './shadowApprovalDedupeStore.js';

export type ShadowGateAuditApprovalState = ShadowApprovalState;

export type ShadowGateAuditTriggerSource =
  | 'DECISION_BROKER_MANUAL_APPROVAL'
  | 'SHADOW_APPROVAL_CARD'
  | 'PROVISIONAL_SHADOW'
  | 'COUNTERFACTUAL'
  | 'UNKNOWN';

export type ShadowGateDivergenceReason =
  | 'LIVE_MIN_SIGNAL_FEATURE_MISSING'
  | 'SHADOW_GATE_USES_RAW_SCORE'
  | 'SHADOW_APPROVAL_MANUAL'
  | 'PROVIDER_ISSUE_SOFTENED'
  | 'PRE_BREAKOUT_SHADOW_ALLOWED'
  | 'UNKNOWN';

export interface ShadowGateAuditRecord {
  symbol: string;
  name?: string;
  tradeDate: string;
  marketSession: string;
  dedupeKey?: string;
  warning?: 'LIVE_FORENSIC_NOT_FOUND_FOR_SHADOW_SIGNAL';

  shadow: {
    scoreSystem: 'SHADOW_GATE_RAW';
    rawGateScore: number | null;
    availableMaxScore: number | null;
    gateBandNormal: number | null;
    gateBandStrong: number | null;
    signalType: string | null;
    mtas: number | null;
    compressionScore: number | null;
    rrr: number | null;
    approvalCardEmitted: boolean;
    approvalState?: ShadowGateAuditApprovalState;
    shadowRecorded: boolean;
    liveOrderPlaced: false;
    triggerSource: ShadowGateAuditTriggerSource;
  };

  liveMinimum: {
    scoreSystem: 'MINIMUM_SIGNAL_SCORE_100_SCALE';
    requiredScore: number | null;
    actualScore: number | null;
    scoreGap: number | null;
    gate1Pass: boolean | null;
    minSignalPass: boolean | null;
    missingPositiveSources: string[];
    penaltyTop: string[];
  };

  divergence: {
    shadowAllowedButLiveFailed: boolean;
    reason: ShadowGateDivergenceReason;
    severity: 'INFO' | 'WARN' | 'BLOCK';
  };

  executionImpact: 'NONE';
  liveExecutionAllowed: false;
  createdAtIso: string;
  updatedAtIso: string;
}

interface ShadowGateAuditInput {
  symbol: string;
  name?: string;
  tradeDate: string;
  marketSession: string;
  rawGateScore?: number;
  availableMaxScore?: number | null;
  gateBandNormal?: number;
  gateBandStrong?: number;
  signalType?: string;
  mtas?: number;
  compressionScore?: number;
  rrr?: number;
  approvalCardEmitted: boolean;
  approvalState?: ShadowGateAuditApprovalState;
  shadowRecorded?: boolean;
  triggerSource?: ShadowGateAuditTriggerSource;
  dedupeKey?: string;
  now?: string;
}

const _records = new Map<string, ShadowGateAuditRecord>();

function finiteOrNull(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

function sourceLaneToTriggerSource(lane?: ShadowApprovalSourceLane): ShadowGateAuditTriggerSource {
  switch (lane) {
    case 'DECISION_BROKER': return 'DECISION_BROKER_MANUAL_APPROVAL';
    case 'PROVISIONAL': return 'PROVISIONAL_SHADOW';
    case 'COUNTERFACTUAL': return 'COUNTERFACTUAL';
    case 'SHADOW': return 'SHADOW_APPROVAL_CARD';
    default: return 'UNKNOWN';
  }
}

export function mapShadowApprovalSourceLaneToAuditTriggerSource(
  lane?: ShadowApprovalSourceLane,
): ShadowGateAuditTriggerSource {
  return sourceLaneToTriggerSource(lane);
}

function buildAuditKey(input: { dedupeKey?: string; tradeDate: string; marketSession: string; symbol: string }): string {
  return input.dedupeKey ?? `SHADOW_GATE_AUDIT:${input.tradeDate}:${input.marketSession}:${input.symbol}`;
}

function emptyLiveMinimum(): ShadowGateAuditRecord['liveMinimum'] {
  return {
    scoreSystem: 'MINIMUM_SIGNAL_SCORE_100_SCALE',
    requiredScore: null,
    actualScore: null,
    scoreGap: null,
    gate1Pass: null,
    minSignalPass: null,
    missingPositiveSources: [],
    penaltyTop: [],
  };
}

function computeDivergence(record: ShadowGateAuditRecord): ShadowGateAuditRecord['divergence'] {
  const liveFailed = record.liveMinimum.gate1Pass === false || record.liveMinimum.minSignalPass === false;
  const shadowAllowed = record.shadow.approvalCardEmitted || record.shadow.approvalState === 'APPROVED';
  const diverged = shadowAllowed && liveFailed;
  if (!diverged) {
    return { shadowAllowedButLiveFailed: false, reason: 'UNKNOWN', severity: 'INFO' };
  }

  const missing = record.liveMinimum.missingPositiveSources.join('|').toUpperCase();
  if (missing.includes('RS') || missing.includes('RELATIVE_STRENGTH') || missing.includes('BREAKOUT') || missing.includes('WATCHLIST')) {
    return { shadowAllowedButLiveFailed: true, reason: 'LIVE_MIN_SIGNAL_FEATURE_MISSING', severity: 'WARN' };
  }
  if (record.shadow.triggerSource === 'DECISION_BROKER_MANUAL_APPROVAL') {
    return { shadowAllowedButLiveFailed: true, reason: 'SHADOW_APPROVAL_MANUAL', severity: 'WARN' };
  }
  if (record.liveMinimum.penaltyTop.some((p) => p.toUpperCase().includes('PROVIDER') || p.toUpperCase().includes('SOFT'))) {
    return { shadowAllowedButLiveFailed: true, reason: 'PROVIDER_ISSUE_SOFTENED', severity: 'WARN' };
  }
  if ((record.shadow.signalType ?? '').toUpperCase().includes('PRE_BREAKOUT')) {
    return { shadowAllowedButLiveFailed: true, reason: 'PRE_BREAKOUT_SHADOW_ALLOWED', severity: 'WARN' };
  }
  if (
    record.shadow.rawGateScore !== null &&
    record.shadow.gateBandNormal !== null &&
    record.shadow.rawGateScore >= record.shadow.gateBandNormal
  ) {
    return { shadowAllowedButLiveFailed: true, reason: 'SHADOW_GATE_USES_RAW_SCORE', severity: 'WARN' };
  }
  return { shadowAllowedButLiveFailed: true, reason: 'UNKNOWN', severity: 'WARN' };
}

function attachLiveMinimum(record: ShadowGateAuditRecord, live?: Gate1MinimumSignalForensicAuditAdr0505): ShadowGateAuditRecord {
  if (!live) {
    return {
      ...record,
      warning: 'LIVE_FORENSIC_NOT_FOUND_FOR_SHADOW_SIGNAL',
      liveMinimum: emptyLiveMinimum(),
      divergence: computeDivergence({ ...record, liveMinimum: emptyLiveMinimum() }),
    };
  }
  const liveMinimum: ShadowGateAuditRecord['liveMinimum'] = {
    scoreSystem: 'MINIMUM_SIGNAL_SCORE_100_SCALE',
    requiredScore: finiteOrNull(live.requiredScore),
    actualScore: finiteOrNull(live.actualScore),
    scoreGap: finiteOrNull(live.scoreGap),
    gate1Pass: live.passed,
    minSignalPass: live.passed,
    missingPositiveSources: [...(live.missingPositiveSources ?? [])],
    penaltyTop: Object.keys(live.penaltyComponents ?? {}).slice(0, 5),
  };
  const next = { ...record, liveMinimum, warning: undefined };
  return { ...next, divergence: computeDivergence(next) };
}

function findNearestLiveForensic(record: ShadowGateAuditRecord): Gate1MinimumSignalForensicAuditAdr0505 | undefined {
  const entries = loadGate1ForensicTrace()
    .filter((entry) => entry.audit?.symbol === record.symbol)
    .sort((a, b) => Date.parse(b.capturedAtIso) - Date.parse(a.capturedAtIso));
  const sameDate = entries.find((entry) => entry.capturedAtIso.slice(0, 10) === record.tradeDate);
  return (sameDate ?? entries[0])?.audit;
}

export function recordShadowApprovalCardAudit(input: ShadowGateAuditInput): ShadowGateAuditRecord {
  const now = input.now ?? new Date().toISOString();
  const key = buildAuditKey(input);
  const existing = _records.get(key);
  const base: ShadowGateAuditRecord = existing ?? {
    symbol: input.symbol,
    ...(input.name !== undefined ? { name: input.name } : {}),
    tradeDate: input.tradeDate,
    marketSession: input.marketSession,
    ...(input.dedupeKey !== undefined ? { dedupeKey: input.dedupeKey } : {}),
    shadow: {
      scoreSystem: 'SHADOW_GATE_RAW',
      rawGateScore: null,
      availableMaxScore: null,
      gateBandNormal: null,
      gateBandStrong: null,
      signalType: null,
      mtas: null,
      compressionScore: null,
      rrr: null,
      approvalCardEmitted: input.approvalCardEmitted,
      approvalState: input.approvalState,
      shadowRecorded: input.shadowRecorded ?? false,
      liveOrderPlaced: false,
      triggerSource: input.triggerSource ?? 'SHADOW_APPROVAL_CARD',
    },
    liveMinimum: emptyLiveMinimum(),
    divergence: { shadowAllowedButLiveFailed: false, reason: 'UNKNOWN', severity: 'INFO' },
    executionImpact: 'NONE',
    liveExecutionAllowed: false,
    createdAtIso: now,
    updatedAtIso: now,
  };

  const next: ShadowGateAuditRecord = {
    ...base,
    ...(input.name !== undefined ? { name: input.name } : {}),
    ...(input.dedupeKey !== undefined ? { dedupeKey: input.dedupeKey } : {}),
    shadow: {
      ...base.shadow,
      rawGateScore: finiteOrNull(input.rawGateScore) ?? base.shadow.rawGateScore,
      availableMaxScore: finiteOrNull(input.availableMaxScore) ?? base.shadow.availableMaxScore,
      gateBandNormal: finiteOrNull(input.gateBandNormal) ?? base.shadow.gateBandNormal,
      gateBandStrong: finiteOrNull(input.gateBandStrong) ?? base.shadow.gateBandStrong,
      signalType: input.signalType ?? base.shadow.signalType,
      mtas: finiteOrNull(input.mtas) ?? base.shadow.mtas,
      compressionScore: finiteOrNull(input.compressionScore) ?? base.shadow.compressionScore,
      rrr: finiteOrNull(input.rrr) ?? base.shadow.rrr,
      approvalCardEmitted: input.approvalCardEmitted,
      ...(input.approvalState !== undefined ? { approvalState: input.approvalState } : {}),
      shadowRecorded: input.shadowRecorded ?? base.shadow.shadowRecorded,
      liveOrderPlaced: false,
      triggerSource: input.triggerSource ?? base.shadow.triggerSource,
    },
    executionImpact: 'NONE',
    liveExecutionAllowed: false,
    updatedAtIso: now,
  };
  const hydrated = attachLiveMinimum(next, findNearestLiveForensic(next));
  _records.set(key, hydrated);
  return hydrated;
}

export function markShadowGateAuditApprovalState(input: {
  dedupeKey: string;
  approvalState: ShadowGateAuditApprovalState;
  shadowRecorded: boolean;
  triggerSource?: ShadowGateAuditTriggerSource;
  now?: string;
}): ShadowGateAuditRecord | undefined {
  const existing = _records.get(input.dedupeKey);
  if (!existing) return undefined;
  const now = input.now ?? new Date().toISOString();
  const next: ShadowGateAuditRecord = {
    ...existing,
    shadow: {
      ...existing.shadow,
      approvalState: input.approvalState,
      shadowRecorded: input.shadowRecorded,
      liveOrderPlaced: false,
      triggerSource: input.triggerSource ?? existing.shadow.triggerSource,
    },
    executionImpact: 'NONE',
    liveExecutionAllowed: false,
    updatedAtIso: now,
  };
  const hydrated = attachLiveMinimum(next, findNearestLiveForensic(next));
  _records.set(input.dedupeKey, hydrated);
  return hydrated;
}

export function listShadowGateAuditRecords(opts?: { hydrateLiveMinimum?: boolean }): ShadowGateAuditRecord[] {
  const records = Array.from(_records.values()).sort((a, b) => Date.parse(b.updatedAtIso) - Date.parse(a.updatedAtIso));
  if (!opts?.hydrateLiveMinimum) return records;
  return records.map((record) => attachLiveMinimum(record, findNearestLiveForensic(record)));
}

export function getShadowGateAuditStats(): {
  shadowSignals: number;
  approved: number;
  deduped: number;
  liveOrderPlaced: false;
  shadowAllowedButLiveFailed: number;
  latest?: ShadowGateAuditRecord;
  executionImpact: 'NONE';
} {
  const records = listShadowGateAuditRecords({ hydrateLiveMinimum: true });
  return {
    shadowSignals: records.filter((r) => r.shadow.approvalCardEmitted).length,
    approved: records.filter((r) => r.shadow.approvalState === 'APPROVED').length,
    deduped: records.filter((r) => r.shadow.approvalState === 'DEDUPED' || !r.shadow.approvalCardEmitted).length,
    liveOrderPlaced: false,
    shadowAllowedButLiveFailed: records.filter((r) => r.divergence.shadowAllowedButLiveFailed).length,
    latest: records[0],
    executionImpact: 'NONE',
  };
}

function fmt(value: number | null, digits = 1): string {
  return value === null ? 'n/a' : value.toFixed(digits);
}

export function formatShadowGateAuditSection(recordsInput?: ShadowGateAuditRecord[]): string {
  const records = recordsInput ?? listShadowGateAuditRecords({ hydrateLiveMinimum: true });
  const latest = records.slice(0, 3);
  const approved = records.filter((r) => r.shadow.approvalState === 'APPROVED').length;
  const deduped = records.filter((r) => r.shadow.approvalState === 'DEDUPED' || !r.shadow.approvalCardEmitted).length;
  const diverged = records.filter((r) => r.divergence.shadowAllowedButLiveFailed).length;
  const lines = [
    '🧪 Shadow Gate Audit [PATCH-RUNTIME]',
    `• shadowSignals: ${records.filter((r) => r.shadow.approvalCardEmitted).length}`,
    `• approved: ${approved} / deduped: ${deduped}`,
    '• liveOrderPlaced=false',
    `• divergence: shadowAllowedButLiveFailed=${diverged}`,
  ];
  for (const record of latest) {
    lines.push(`• latest: ${record.symbol}${record.name ? ` ${record.name}` : ''}`);
    lines.push(`  - Shadow Gate ${fmt(record.shadow.rawGateScore, 1)} / MTAS ${fmt(record.shadow.mtas, 0)} / RRR ${fmt(record.shadow.rrr, 2)}`);
    lines.push(`  - Live MinScore ${fmt(record.liveMinimum.actualScore, 1)} / ${fmt(record.liveMinimum.requiredScore, 1)}`);
    lines.push(`  - reason: ${record.divergence.reason}`);
    if (record.warning) lines.push(`  - warning: ${record.warning}`);
  }
  lines.push('• executionImpact=NONE');
  return lines.join('\n');
}

export function __resetShadowGateAuditStoreForTests(): void {
  _records.clear();
}
