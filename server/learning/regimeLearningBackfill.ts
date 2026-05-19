// @responsibility Regime Learning Bank backfill diagnostics for legacy learning samples.
import { loadMacroState } from '../persistence/macroStateRepo.js';
import { loadRegimeTransitionState } from '../persistence/regimeTransitionStateRepo.js';
import { loadGhostPortfolio, saveGhostPortfolio } from '../persistence/reflectionRepo.js';
import {
  loadAttributionRecords,
  saveAttributionRecords,
  type ServerAttributionRecord,
} from '../persistence/attributionRepo.js';
import {
  loadCounterfactuals,
  saveCounterfactuals,
  type CounterfactualEntry,
} from './counterfactualShadow.js';
import {
  deriveRegimePhase,
  normalizeRegimeContext,
  type RegimePhase,
} from '../shadow/regimeContext.js';
import type {
  LearningGhostCase,
  RegimeRecoveryConfidence,
  RegimeRecoverySource,
} from './learningTypes.js';

export type RegimeLearningBackfillTarget =
  | 'GHOST_REPAIR'
  | 'BACKLOG_REPAIR'
  | 'FRESH_SHADOW'
  | 'COUNTERFACTUAL'
  | 'OUTCOME'
  | 'ATTRIBUTION'
  | 'OPEN_UNRESOLVED'
  | 'QUARANTINED';

type RegimeBackfillRow = {
  target: RegimeLearningBackfillTarget;
  row: RegimeWritableRow;
  createdAt?: string;
};

type RegimeWritableRow = {
  id?: string;
  caseId?: string;
  signalId?: string;
  tradeId?: string;
  counterfactualKey?: string;
  symbol?: string;
  stockCode?: string;
  cohortType?: string;
  sourceType?: string;
  rawRegime?: string;
  effectiveRegime?: string;
  regime?: string;
  entryRegime?: string;
  regimePhase?: RegimePhase;
  originalRegimePhase?: RegimePhase;
  regimeAtSignal?: RegimePhase | string;
  regimeAtEntry?: RegimePhase | string;
  regimeAtExit?: RegimePhase | string;
  regimeAtOutcome?: RegimePhase | string;
  r6Trigger?: string;
  engineMode?: string;
  marketSession?: string;
  sellOnlyActive?: boolean;
  hardBlockActive?: boolean;
  sourceFreshness?: string;
  regimeConfidence?: string;
  regimeRecovered?: boolean;
  regimeRecoverySource?: RegimeRecoverySource;
  regimeRecoveryConfidence?: RegimeRecoveryConfidence;
  regimeRecoveredAt?: string;
  blockedReason?: string;
  rejectionReason?: string;
  skipReason?: string;
  closeReason?: string;
  outcomeLabel?: string;
  closed?: boolean;
  closedAt?: string;
  createdAt?: string;
  detectedAt?: string;
  updatedAt?: string;
  entryAt?: string;
  entryPrice?: number;
  entryPriceVirtual?: number;
  hypotheticalEntryPrice?: number;
  priceAtSignal?: number;
  signalTime?: string;
  signalDate?: string;
  lastUpdatedAt?: string;
  quarantinedReason?: string;
};

interface RecoveredRegime {
  rawRegime: string;
  effectiveRegime: string;
  regimePhase: RegimePhase;
  regimeRecovered: boolean;
  regimeRecoverySource: RegimeRecoverySource;
  regimeRecoveryConfidence: RegimeRecoveryConfidence;
}

export interface RegimeLearningBackfillInput {
  ghosts?: LearningGhostCase[];
  counterfactuals?: CounterfactualEntry[];
  attributionRecords?: ServerAttributionRecord[];
  macroSnapshots?: RegimeTimestampSnapshot[];
  transitionSnapshots?: RegimeTimestampSnapshot[];
  shadowCases?: RegimeWritableRow[];
  now?: Date;
  write?: boolean;
}

export type RegimeBackfillFailureReason =
  | 'NO_SNAPSHOT_IN_WINDOW'
  | 'MISSING_SAMPLE_TIMESTAMP'
  | 'SNAPSHOT_REPO_EMPTY'
  | 'TIMEZONE_MISMATCH_SUSPECT'
  | 'INVALID_TIMESTAMP'
  | 'DUPLICATE_SUPPRESSED_BEFORE_BACKFILL'
  | 'SOURCE_LANE_EXCLUDED'
  | 'UNKNOWN_ERROR';

export type RegimeBackfillTimestampSource =
  | 'SIGNAL_TIME'
  | 'ENTRY_AT'
  | 'DETECTED_AT'
  | 'CREATED_AT'
  | 'CLOSED_AT'
  | 'UPDATED_AT'
  | 'LAST_UPDATED_AT'
  | 'SIGNAL_DATE'
  | 'MISSING';

export type RegimeUnknownReason =
  | 'MISSING_CREATED_AT'
  | 'NO_MACRO_SNAPSHOT'
  | 'NO_TRANSITION_STATE'
  | 'PRE_REGIME_TRACKING_SAMPLE'
  | 'AMBIGUOUS_SESSION'
  | 'CORRUPTED_TIMESTAMP'
  | 'CASE_TYPE_NOT_SUPPORTED'
  | 'UNKNOWN_FALLBACK_USED';

export interface RegimeTimestampSnapshot {
  at: string;
  rawRegime: string;
  effectiveRegime?: string;
}

export interface RegimeUnknownAnalysisResult {
  unknownTotal: number;
  unknownBySource: Record<string, number>;
  unknownByCaseType: Record<string, number>;
  unknownByDate: Record<string, number>;
  unknownReasonBreakdown: Record<RegimeUnknownReason, number>;
  missingTimestampCount: number;
  missingMacroSnapshotCount: number;
  missingTransitionStateCount: number;
  recoverableByNearestSnapshot: number;
  recoverableByTradingDayRegime: number;
  recoverableByR6Trigger: number;
  unrecoverableCount: number;
  recommendedFix: string;
  executionImpact: 'NONE';
  brokerOrdersCreated: 0;
  promotionAllowed: false;
}

export interface RegimeUnknownRepairResult {
  scannedUnknown: number;
  attemptedUnique: number;
  attemptedDuplicates: number;
  repaired: number;
  stillUnknown: number;
  byRecoveredRegime: Record<string, number>;
  recoverySourceBreakdown: Record<string, number>;
  recoveryConfidenceBreakdown: Record<string, number>;
  failureReasonBreakdown: Record<RegimeBackfillFailureReason, number>;
  failureBySourceLane: Record<string, number>;
  failureByTimestampSource: Record<RegimeBackfillTimestampSource, number>;
  failureSampleKeys: string[];
  executionImpact: 'NONE';
  brokerOrdersCreated: 0;
  promotionAllowed: false;
}

export interface RegimeLearningBackfillDryRunResult {
  scannedTotal: number;
  missingRegimePhase: number;
  recoverableByStoredSnapshot: number;
  recoverableByTimestampMacroState: number;
  recoverableByRegimeTransitionState: number;
  recoverableByR6Trigger: number;
  recoverableByCurrentRegimeFallback: 0;
  unrecoverable: number;
  expectedByRegime: Record<string, number>;
  expectedUnknown: number;
  executionImpact: 'NONE';
  brokerOrdersCreated: 0;
}

export interface RegimeLearningBackfillRunResult extends RegimeLearningBackfillDryRunResult {
  updated: number;
  byRegime: Record<string, number>;
  unknownCount: number;
  recoverySourceBreakdown: Record<string, number>;
  recoveryConfidenceBreakdown: Record<string, number>;
  promotionAllowed: false;
}

function inc(record: Record<string, number>, key: string | undefined, amount = 1): void {
  const safeKey = key || 'UNKNOWN';
  record[safeKey] = (record[safeKey] ?? 0) + amount;
}

function timestampOf(row: RegimeWritableRow): string | undefined {
  return row.signalTime
    ?? row.entryAt
    ?? row.detectedAt
    ?? row.createdAt
    ?? row.closedAt
    ?? row.updatedAt
    ?? row.lastUpdatedAt
    ?? (row.signalDate ? `${row.signalDate}T00:00:00.000Z` : undefined);
}

function timestampSourceOf(row: RegimeWritableRow): RegimeBackfillTimestampSource {
  if (row.signalTime) return 'SIGNAL_TIME';
  if (row.entryAt) return 'ENTRY_AT';
  if (row.detectedAt) return 'DETECTED_AT';
  if (row.createdAt) return 'CREATED_AT';
  if (row.closedAt) return 'CLOSED_AT';
  if (row.updatedAt) return 'UPDATED_AT';
  if (row.lastUpdatedAt) return 'LAST_UPDATED_AT';
  if (row.signalDate) return 'SIGNAL_DATE';
  return 'MISSING';
}

function isClosedOutcome(row: RegimeWritableRow): boolean {
  return row.closed === true
    || !!row.closedAt
    || ['WIN', 'LOSS', 'BREAKEVEN', 'EXPIRED'].includes(String(row.outcomeLabel ?? ''));
}

function ghostTarget(row: LearningGhostCase): RegimeLearningBackfillTarget {
  if (row.quarantinedReason || row.outcomeLabel === 'QUARANTINED') return 'QUARANTINED';
  if (row.cohortType === 'BACKLOG_REPAIR') return 'BACKLOG_REPAIR';
  if (row.cohortType === 'FRESH_SHADOW') return 'FRESH_SHADOW';
  if (row.cohortType === 'GHOST_REPAIR') return 'GHOST_REPAIR';
  if (isClosedOutcome(row)) return row.caseKind === 'shadow' ? 'FRESH_SHADOW' : 'GHOST_REPAIR';
  return 'OPEN_UNRESOLVED';
}

function shadowTarget(row: RegimeWritableRow): RegimeLearningBackfillTarget {
  const cohort = String(row.cohortType ?? row.sourceType ?? '').toUpperCase();
  if (cohort === 'BACKLOG_REPAIR') return 'BACKLOG_REPAIR';
  if (cohort === 'GHOST_REPAIR') return 'GHOST_REPAIR';
  if (cohort === 'FRESH_SHADOW') return 'FRESH_SHADOW';
  if (cohort === 'QUARANTINED') return 'QUARANTINED';
  if (cohort.includes('COUNTERFACTUAL')) return 'COUNTERFACTUAL';
  if (isClosedOutcome(row)) return 'OUTCOME';
  return 'OPEN_UNRESOLVED';
}

function rowsFromInputs(input: RegimeLearningBackfillInput): {
  ghosts: LearningGhostCase[];
  counterfactuals: CounterfactualEntry[];
  attributionRecords: ServerAttributionRecord[];
  rows: RegimeBackfillRow[];
} {
  const ghosts = input.ghosts ?? (loadGhostPortfolio() as LearningGhostCase[]);
  const counterfactuals = input.counterfactuals ?? loadCounterfactuals();
  const attributionRecords = input.attributionRecords ?? loadAttributionRecords();
  const shadowCases = input.shadowCases ?? [];
  const rows: RegimeBackfillRow[] = [
    ...shadowCases.map((row) => ({ target: shadowTarget(row), row, createdAt: timestampOf(row) })),
    ...ghosts.map((row) => ({ target: ghostTarget(row), row, createdAt: timestampOf(row) })),
    ...counterfactuals.map((row) => ({ target: 'COUNTERFACTUAL' as const, row, createdAt: timestampOf(row) })),
    ...attributionRecords.map((row) => ({ target: 'ATTRIBUTION' as const, row, createdAt: timestampOf(row) })),
  ];
  return { ghosts, counterfactuals, attributionRecords, rows };
}

function sameDate(a?: string, b?: string): boolean {
  if (!a || !b) return false;
  return a.slice(0, 10) === b.slice(0, 10);
}

function containsR6Signal(row: RegimeWritableRow): boolean {
  return [
    row.r6Trigger,
    row.rawRegime,
    row.effectiveRegime,
    row.regime,
    row.entryRegime,
    row.blockedReason,
    row.rejectionReason,
    row.skipReason,
    row.closeReason,
  ].some((value) => String(value ?? '').toUpperCase().includes('R6'));
}

function storedRegime(row: RegimeWritableRow): RecoveredRegime | undefined {
  if (!row.regimePhase && !row.rawRegime && !row.effectiveRegime && !row.regime && !row.entryRegime) {
    return undefined;
  }
  const context = normalizeRegimeContext({
    rawRegime: row.rawRegime ?? row.regime ?? row.entryRegime,
    effectiveRegime: row.effectiveRegime ?? row.regime ?? row.entryRegime,
    regimePhase: row.regimePhase,
    regimeAtSignal: row.regimeAtSignal,
    engineMode: row.engineMode,
    marketSession: row.marketSession,
    sellOnlyActive: row.sellOnlyActive,
    hardBlockActive: row.hardBlockActive,
    blockedReason: row.blockedReason ?? row.rejectionReason ?? row.skipReason ?? row.closeReason,
    sourceFreshness: row.sourceFreshness,
    regimeConfidence: row.regimeConfidence,
  });
  return {
    rawRegime: context.rawRegime,
    effectiveRegime: context.effectiveRegime,
    regimePhase: context.regimePhase,
    regimeRecovered: false,
    regimeRecoverySource: 'STORED_CASE_REGIME',
    regimeRecoveryConfidence: 'HIGH',
  };
}

function transitionRegime(createdAt?: string): RecoveredRegime | undefined {
  const state = loadRegimeTransitionState();
  if (!createdAt) return undefined;
  const createdMs = new Date(createdAt).getTime();
  const enteredR6 = state.enteredR6At ? new Date(state.enteredR6At).getTime() : NaN;
  const exitedR6 = state.exitedR6At ? new Date(state.exitedR6At).getTime() : NaN;
  if (Number.isFinite(createdMs) && Number.isFinite(enteredR6) && createdMs >= enteredR6 && (!Number.isFinite(exitedR6) || createdMs <= exitedR6)) {
    return {
      rawRegime: 'R6_DEFENSE',
      effectiveRegime: 'R6_DEFENSE',
      regimePhase: 'R6_DEFENSE',
      regimeRecovered: true,
      regimeRecoverySource: 'REGIME_TRANSITION_STATE_BY_TIMESTAMP',
      regimeRecoveryConfidence: 'MEDIUM',
    };
  }
  if (sameDate(createdAt, state.lastTransitionAt)) {
    const phase = deriveRegimePhase({ rawRegime: state.rawRegime, effectiveRegime: state.effectiveRegime });
    return {
      rawRegime: state.rawRegime,
      effectiveRegime: state.effectiveRegime,
      regimePhase: phase,
      regimeRecovered: true,
      regimeRecoverySource: 'REGIME_TRANSITION_STATE_BY_TIMESTAMP',
      regimeRecoveryConfidence: 'MEDIUM',
    };
  }
  return undefined;
}

function macroSnapshotRegime(createdAt?: string): RecoveredRegime | undefined {
  const macro = loadMacroState();
  if (!macro?.regime || !sameDate(createdAt, macro.updatedAt)) return undefined;
  const phase = deriveRegimePhase({ rawRegime: macro.regime, effectiveRegime: macro.regime });
  return {
    rawRegime: macro.regime,
    effectiveRegime: macro.regime,
    regimePhase: phase,
    regimeRecovered: true,
    regimeRecoverySource: 'MACRO_SNAPSHOT_BY_TIMESTAMP',
    regimeRecoveryConfidence: 'MEDIUM',
  };
}

function recoverRegime(row: RegimeWritableRow, createdAt?: string): RecoveredRegime {
  const stored = storedRegime(row);
  if (stored) return stored;
  if (containsR6Signal(row)) {
    return {
      rawRegime: 'R6_DEFENSE',
      effectiveRegime: 'R6_DEFENSE',
      regimePhase: 'R6_DEFENSE',
      regimeRecovered: true,
      regimeRecoverySource: 'R6_TRIGGER_BY_TIMESTAMP',
      regimeRecoveryConfidence: 'MEDIUM',
    };
  }
  const macro = macroSnapshotRegime(createdAt);
  if (macro) return macro;
  const transition = transitionRegime(createdAt);
  if (transition) return transition;
  return {
    rawRegime: 'UNKNOWN',
    effectiveRegime: 'UNKNOWN',
    regimePhase: 'UNKNOWN',
    regimeRecovered: true,
    regimeRecoverySource: 'UNKNOWN_FALLBACK',
    regimeRecoveryConfidence: 'UNKNOWN',
  };
}

function phaseFromSnapshot(snapshot: RegimeTimestampSnapshot): RecoveredRegime {
  const rawRegime = snapshot.rawRegime || snapshot.effectiveRegime || 'UNKNOWN';
  const effectiveRegime = snapshot.effectiveRegime || rawRegime;
  return {
    rawRegime,
    effectiveRegime,
    regimePhase: deriveRegimePhase({ rawRegime, effectiveRegime }),
    regimeRecovered: true,
    regimeRecoverySource: 'NEAREST_MACRO_SNAPSHOT',
    regimeRecoveryConfidence: 'LOW',
  };
}

function defaultMacroSnapshots(input: RegimeLearningBackfillInput): RegimeTimestampSnapshot[] {
  if (input.macroSnapshots) return input.macroSnapshots;
  const macro = loadMacroState();
  return macro?.regime && macro.updatedAt
    ? [{ at: macro.updatedAt, rawRegime: macro.regime, effectiveRegime: macro.regime }]
    : [];
}

function defaultTransitionSnapshots(input: RegimeLearningBackfillInput): RegimeTimestampSnapshot[] {
  if (input.transitionSnapshots) return input.transitionSnapshots;
  const state = loadRegimeTransitionState();
  const rows: RegimeTimestampSnapshot[] = [];
  if (state.lastTransitionAt) {
    rows.push({ at: state.lastTransitionAt, rawRegime: state.rawRegime, effectiveRegime: state.effectiveRegime });
  }
  if (state.enteredR6At) {
    rows.push({ at: state.enteredR6At, rawRegime: 'R6_DEFENSE', effectiveRegime: 'R6_DEFENSE' });
  }
  return rows;
}

function parseMillis(iso?: string): number {
  const t = iso ? new Date(iso).getTime() : NaN;
  return Number.isFinite(t) ? t : NaN;
}

function dateKey(iso?: string): string {
  const t = parseMillis(iso);
  if (!Number.isFinite(t)) return iso ? 'CORRUPTED_TIMESTAMP' : 'MISSING_CREATED_AT';
  return new Date(t).toISOString().slice(0, 10);
}

function nearestSnapshot(createdAt: string | undefined, snapshots: RegimeTimestampSnapshot[]): { snapshot: RegimeTimestampSnapshot; exactDate: boolean } | undefined {
  const createdMs = parseMillis(createdAt);
  if (!Number.isFinite(createdMs) || snapshots.length === 0) return undefined;
  const valid = snapshots
    .map((snapshot) => ({ snapshot, delta: Math.abs(parseMillis(snapshot.at) - createdMs) }))
    .filter((row) => Number.isFinite(row.delta))
    .sort((a, b) => a.delta - b.delta);
  const best = valid[0];
  if (!best) return undefined;
  return { snapshot: best.snapshot, exactDate: sameDate(createdAt, best.snapshot.at) };
}

function sameTradingDaySnapshot(createdAt: string | undefined, snapshots: RegimeTimestampSnapshot[]): RegimeTimestampSnapshot | undefined {
  return snapshots.find((snapshot) => sameDate(createdAt, snapshot.at));
}

function marketSessionPhase(row: RegimeWritableRow): RecoveredRegime | undefined {
  const session = String(row.marketSession ?? row.engineMode ?? '').toUpperCase();
  const reason = String(row.blockedReason ?? row.rejectionReason ?? row.skipReason ?? row.closeReason ?? '').toUpperCase();
  if (row.sellOnlyActive === true || session.includes('SELL_ONLY') || reason.includes('SELL_ONLY')) {
    return {
      rawRegime: 'SELL_ONLY',
      effectiveRegime: 'SELL_ONLY',
      regimePhase: 'SELL_ONLY',
      regimeRecovered: true,
      regimeRecoverySource: 'MARKET_SESSION_PHASE',
      regimeRecoveryConfidence: 'MEDIUM',
    };
  }
  if (row.hardBlockActive === true || session.includes('HARD_BLOCK') || reason.includes('HARD_BLOCK')) {
    return {
      rawRegime: 'HARD_BLOCK',
      effectiveRegime: 'HARD_BLOCK',
      regimePhase: 'HARD_BLOCK',
      regimeRecovered: true,
      regimeRecoverySource: 'MARKET_SESSION_PHASE',
      regimeRecoveryConfidence: 'MEDIUM',
    };
  }
  if (session.includes('MARKET_CLOSED') || session === 'CLOSED' || session === 'NON_TRADING_DAY') {
    return {
      rawRegime: 'MARKET_CLOSED',
      effectiveRegime: 'MARKET_CLOSED',
      regimePhase: 'MARKET_CLOSED',
      regimeRecovered: true,
      regimeRecoverySource: 'MARKET_SESSION_PHASE',
      regimeRecoveryConfidence: 'MEDIUM',
    };
  }
  return undefined;
}

function isUnknownRow(row: RegimeWritableRow): boolean {
  const phase = String(row.regimePhase ?? '').toUpperCase();
  return !phase || phase === 'UNKNOWN';
}

function unknownReason(item: RegimeBackfillRow, macroSnapshots: RegimeTimestampSnapshot[], transitionSnapshots: RegimeTimestampSnapshot[]): RegimeUnknownReason {
  if (item.row.regimeRecoverySource === 'UNKNOWN_FALLBACK') return 'UNKNOWN_FALLBACK_USED';
  if (!item.createdAt) return 'MISSING_CREATED_AT';
  if (!Number.isFinite(parseMillis(item.createdAt))) return 'CORRUPTED_TIMESTAMP';
  if (String(item.createdAt).slice(0, 4) < '2026') return 'PRE_REGIME_TRACKING_SAMPLE';
  if (item.target === 'ATTRIBUTION' && !item.row.closedAt) return 'CASE_TYPE_NOT_SUPPORTED';
  if (!sameTradingDaySnapshot(item.createdAt, macroSnapshots) && !nearestSnapshot(item.createdAt, macroSnapshots)) return 'NO_MACRO_SNAPSHOT';
  if (!sameTradingDaySnapshot(item.createdAt, transitionSnapshots)) return 'NO_TRANSITION_STATE';
  const session = String(item.row.marketSession ?? '').toUpperCase();
  if (!session || session === 'UNKNOWN') return 'AMBIGUOUS_SESSION';
  return 'UNKNOWN_FALLBACK_USED';
}

function caseTypeName(item: RegimeBackfillRow): string {
  if (item.target === 'FRESH_SHADOW') return 'freshShadow';
  if (item.target === 'GHOST_REPAIR') return 'ghostRepair';
  if (item.target === 'BACKLOG_REPAIR') return 'backlogRepair';
  if (item.target === 'COUNTERFACTUAL') return 'counterfactual';
  if (item.target === 'ATTRIBUTION') return 'attribution';
  if (item.target === 'OPEN_UNRESOLVED') return 'openUnresolved';
  if (item.target === 'QUARANTINED') return 'quarantined';
  if (item.target === 'OUTCOME') return 'outcome';
  return 'unknown';
}

function recoverUnknownRegime(
  row: RegimeWritableRow,
  createdAt: string | undefined,
  macroSnapshots: RegimeTimestampSnapshot[],
  transitionSnapshots: RegimeTimestampSnapshot[],
): RecoveredRegime {
  if (containsR6Signal(row)) {
    return {
      rawRegime: 'R6_DEFENSE',
      effectiveRegime: 'R6_DEFENSE',
      regimePhase: 'R6_DEFENSE',
      regimeRecovered: true,
      regimeRecoverySource: 'R6_TRIGGER_BY_TIMESTAMP',
      regimeRecoveryConfidence: 'MEDIUM',
    };
  }
  const nearest = nearestSnapshot(createdAt, macroSnapshots);
  if (nearest) {
    const recovered = phaseFromSnapshot(nearest.snapshot);
    recovered.regimeRecoveryConfidence = nearest.exactDate ? 'HIGH' : 'LOW';
    recovered.regimeRecoverySource = nearest.exactDate ? 'MACRO_SNAPSHOT_BY_TIMESTAMP' : 'NEAREST_MACRO_SNAPSHOT';
    return recovered;
  }
  const tradingDay = sameTradingDaySnapshot(createdAt, transitionSnapshots);
  if (tradingDay) {
    const rawRegime = tradingDay.rawRegime || tradingDay.effectiveRegime || 'UNKNOWN';
    const effectiveRegime = tradingDay.effectiveRegime || rawRegime;
    return {
      rawRegime,
      effectiveRegime,
      regimePhase: deriveRegimePhase({ rawRegime, effectiveRegime }),
      regimeRecovered: true,
      regimeRecoverySource: 'TRADING_DAY_REGIME',
      regimeRecoveryConfidence: 'MEDIUM',
    };
  }
  const session = marketSessionPhase(row);
  if (session) return session;
  return {
    rawRegime: 'UNKNOWN',
    effectiveRegime: 'UNKNOWN',
    regimePhase: 'UNKNOWN',
    regimeRecovered: true,
    regimeRecoverySource: 'UNKNOWN_FALLBACK',
    regimeRecoveryConfidence: 'UNKNOWN',
  };
}

function normalizedTimestamp(iso: string | undefined): string {
  const t = parseMillis(iso);
  return Number.isFinite(t) ? new Date(t).toISOString() : (iso ? 'INVALID_TIMESTAMP' : 'MISSING_TIMESTAMP');
}

function entryPriceForKey(row: RegimeWritableRow): string {
  const value = row.entryPriceVirtual ?? row.hypotheticalEntryPrice ?? row.entryPrice ?? row.priceAtSignal;
  return typeof value === 'number' && Number.isFinite(value) ? String(value) : 'NO_ENTRY_PRICE';
}

function originalCaseId(row: RegimeWritableRow): string {
  return String(row.caseId ?? row.id ?? row.tradeId ?? row.counterfactualKey ?? row.signalId ?? 'NO_CASE_ID');
}

function backfillAttemptKey(item: RegimeBackfillRow): string {
  return [
    item.row.symbol ?? item.row.stockCode ?? 'NO_SYMBOL',
    item.target,
    normalizedTimestamp(item.createdAt),
    entryPriceForKey(item.row),
    originalCaseId(item.row),
  ].join('|');
}

function snapshotRepoEmpty(macroSnapshots: RegimeTimestampSnapshot[], transitionSnapshots: RegimeTimestampSnapshot[]): boolean {
  return macroSnapshots.length === 0 && transitionSnapshots.length === 0;
}

function classifyBackfillFailure(
  item: RegimeBackfillRow,
  macroSnapshots: RegimeTimestampSnapshot[],
  transitionSnapshots: RegimeTimestampSnapshot[],
): RegimeBackfillFailureReason {
  const reason = unknownReason(item, macroSnapshots, transitionSnapshots);
  if (reason === 'MISSING_CREATED_AT') return 'MISSING_SAMPLE_TIMESTAMP';
  if (reason === 'CORRUPTED_TIMESTAMP') return 'INVALID_TIMESTAMP';
  if (reason === 'CASE_TYPE_NOT_SUPPORTED') return 'SOURCE_LANE_EXCLUDED';
  if (reason === 'AMBIGUOUS_SESSION') return 'TIMEZONE_MISMATCH_SUSPECT';
  if (reason === 'NO_MACRO_SNAPSHOT' || reason === 'NO_TRANSITION_STATE' || reason === 'PRE_REGIME_TRACKING_SAMPLE') {
    return snapshotRepoEmpty(macroSnapshots, transitionSnapshots) ? 'SNAPSHOT_REPO_EMPTY' : 'NO_SNAPSHOT_IN_WINDOW';
  }
  if (reason === 'UNKNOWN_FALLBACK_USED') return 'NO_SNAPSHOT_IN_WINDOW';
  return 'UNKNOWN_ERROR';
}

function recordFailure(
  item: RegimeBackfillRow,
  failureReason: RegimeBackfillFailureReason,
  failureReasonBreakdown: Record<RegimeBackfillFailureReason, number>,
  failureBySourceLane: Record<string, number>,
  failureByTimestampSource: Record<RegimeBackfillTimestampSource, number>,
  failureSampleKeys: string[],
): void {
  inc(failureReasonBreakdown as Record<string, number>, failureReason);
  inc(failureBySourceLane, item.target);
  inc(failureByTimestampSource as Record<string, number>, timestampSourceOf(item.row));
  if (failureSampleKeys.length < 10) {
    failureSampleKeys.push(`${failureReason}:${backfillAttemptKey(item)}`);
  }
}

function summarize(input: RegimeLearningBackfillInput, write: boolean): RegimeLearningBackfillRunResult {
  const now = input.now ?? new Date();
  const { ghosts, counterfactuals, attributionRecords, rows } = rowsFromInputs(input);
  const expectedByRegime: Record<string, number> = {};
  const byRegime: Record<string, number> = {};
  const recoverySourceBreakdown: Record<string, number> = {};
  const recoveryConfidenceBreakdown: Record<string, number> = {};
  let missingRegimePhase = 0;
  let recoverableByStoredSnapshot = 0;
  let recoverableByTimestampMacroState = 0;
  let recoverableByRegimeTransitionState = 0;
  let recoverableByR6Trigger = 0;
  let unrecoverable = 0;
  let updated = 0;

  for (const item of rows) {
    const recovered = recoverRegime(item.row, item.createdAt);
    if (!item.row.regimePhase) missingRegimePhase++;
    if (recovered.regimeRecoverySource === 'STORED_CASE_REGIME') recoverableByStoredSnapshot++;
    if (recovered.regimeRecoverySource === 'MACRO_SNAPSHOT_BY_TIMESTAMP') recoverableByTimestampMacroState++;
    if (recovered.regimeRecoverySource === 'REGIME_TRANSITION_STATE_BY_TIMESTAMP') recoverableByRegimeTransitionState++;
    if (recovered.regimeRecoverySource === 'R6_TRIGGER_BY_TIMESTAMP') recoverableByR6Trigger++;
    if (recovered.regimeRecoverySource === 'UNKNOWN_FALLBACK') unrecoverable++;
    inc(expectedByRegime, recovered.regimePhase);
    inc(byRegime, recovered.regimePhase);
    inc(recoverySourceBreakdown, recovered.regimeRecoverySource);
    inc(recoveryConfidenceBreakdown, recovered.regimeRecoveryConfidence);

    if (write) {
      const before = JSON.stringify({
        rawRegime: item.row.rawRegime,
        effectiveRegime: item.row.effectiveRegime,
        regimePhase: item.row.regimePhase,
        regimeRecovered: item.row.regimeRecovered,
        regimeRecoverySource: item.row.regimeRecoverySource,
        regimeRecoveryConfidence: item.row.regimeRecoveryConfidence,
      });
      item.row.rawRegime = item.row.rawRegime ?? recovered.rawRegime;
      item.row.effectiveRegime = item.row.effectiveRegime ?? recovered.effectiveRegime;
      item.row.regimePhase = item.row.regimePhase ?? recovered.regimePhase;
      item.row.regimeAtSignal = item.row.regimeAtSignal ?? recovered.regimePhase;
      item.row.regimeRecovered = recovered.regimeRecovered;
      item.row.regimeRecoverySource = recovered.regimeRecoverySource;
      item.row.regimeRecoveryConfidence = recovered.regimeRecoveryConfidence;
      item.row.regimeRecoveredAt = now.toISOString();
      const after = JSON.stringify({
        rawRegime: item.row.rawRegime,
        effectiveRegime: item.row.effectiveRegime,
        regimePhase: item.row.regimePhase,
        regimeRecovered: item.row.regimeRecovered,
        regimeRecoverySource: item.row.regimeRecoverySource,
        regimeRecoveryConfidence: item.row.regimeRecoveryConfidence,
      });
      if (before !== after) updated++;
    }
  }

  if (write && !input.ghosts) saveGhostPortfolio(ghosts);
  if (write && !input.counterfactuals) saveCounterfactuals(counterfactuals);
  if (write && !input.attributionRecords) saveAttributionRecords(attributionRecords);

  const expectedUnknown = expectedByRegime.UNKNOWN ?? 0;
  return {
    scannedTotal: rows.length,
    missingRegimePhase,
    recoverableByStoredSnapshot,
    recoverableByTimestampMacroState,
    recoverableByRegimeTransitionState,
    recoverableByR6Trigger,
    recoverableByCurrentRegimeFallback: 0,
    unrecoverable,
    expectedByRegime,
    expectedUnknown,
    updated: write ? updated : 0,
    byRegime,
    unknownCount: expectedUnknown,
    recoverySourceBreakdown,
    recoveryConfidenceBreakdown,
    executionImpact: 'NONE',
    brokerOrdersCreated: 0,
    promotionAllowed: false,
  };
}

export function regimeLearningBackfillDryRun(input: RegimeLearningBackfillInput = {}): RegimeLearningBackfillDryRunResult {
  const result = summarize(input, false);
  const { updated: _updated, byRegime: _byRegime, unknownCount: _unknownCount, recoverySourceBreakdown: _source, recoveryConfidenceBreakdown: _confidence, promotionAllowed: _promotionAllowed, ...dry } = result;
  return dry;
}

export function regimeLearningBackfillRun(input: RegimeLearningBackfillInput = {}): RegimeLearningBackfillRunResult {
  return summarize(input, true);
}

export function regimeUnknownAnalysis(input: RegimeLearningBackfillInput = {}): RegimeUnknownAnalysisResult {
  const { rows } = rowsFromInputs(input);
  const macroSnapshots = defaultMacroSnapshots(input);
  const transitionSnapshots = defaultTransitionSnapshots(input);
  const unknownBySource: Record<string, number> = {};
  const unknownByCaseType: Record<string, number> = {
    freshShadow: 0,
    ghostRepair: 0,
    backlogRepair: 0,
    counterfactual: 0,
    outcome: 0,
    attribution: 0,
    openUnresolved: 0,
    quarantined: 0,
  };
  const unknownByDate: Record<string, number> = {};
  const unknownReasonBreakdown = {} as Record<RegimeUnknownReason, number>;
  let unknownTotal = 0;
  let missingTimestampCount = 0;
  let missingMacroSnapshotCount = 0;
  let missingTransitionStateCount = 0;
  let recoverableByNearestSnapshot = 0;
  let recoverableByTradingDayRegime = 0;
  let recoverableByR6Trigger = 0;
  let unrecoverableCount = 0;

  for (const item of rows) {
    if (!isUnknownRow(item.row)) continue;
    unknownTotal++;
    inc(unknownBySource, item.target);
    inc(unknownByCaseType, caseTypeName(item));
    if (isClosedOutcome(item.row)) inc(unknownByCaseType, 'outcome');
    inc(unknownByDate, dateKey(item.createdAt));
    const reason = unknownReason(item, macroSnapshots, transitionSnapshots);
    inc(unknownReasonBreakdown as Record<string, number>, reason);
    if (!item.createdAt || !Number.isFinite(parseMillis(item.createdAt))) missingTimestampCount++;
    if (!nearestSnapshot(item.createdAt, macroSnapshots)) missingMacroSnapshotCount++;
    if (!sameTradingDaySnapshot(item.createdAt, transitionSnapshots)) missingTransitionStateCount++;
    const recovered = recoverUnknownRegime(item.row, item.createdAt, macroSnapshots, transitionSnapshots);
    if (recovered.regimeRecoverySource === 'NEAREST_MACRO_SNAPSHOT' || recovered.regimeRecoverySource === 'MACRO_SNAPSHOT_BY_TIMESTAMP') recoverableByNearestSnapshot++;
    if (recovered.regimeRecoverySource === 'TRADING_DAY_REGIME') recoverableByTradingDayRegime++;
    if (recovered.regimeRecoverySource === 'R6_TRIGGER_BY_TIMESTAMP') recoverableByR6Trigger++;
    if (recovered.regimePhase === 'UNKNOWN') unrecoverableCount++;
  }

  const recommendedFix = unrecoverableCount > 0 && missingTimestampCount > 0
    ? 'BACKFILL_CREATED_AT_OR_SIGNAL_TIME'
    : missingMacroSnapshotCount > 0
      ? 'LOAD_REGIME_SNAPSHOT_HISTORY'
      : missingTransitionStateCount > 0
        ? 'LOAD_TRADING_DAY_REGIME_TRANSITIONS'
        : recoverableByNearestSnapshot + recoverableByTradingDayRegime + recoverableByR6Trigger > 0
          ? 'RUN_REGIME_UNKNOWN_REPAIR'
          : 'NO_ACTION';

  return {
    unknownTotal,
    unknownBySource,
    unknownByCaseType,
    unknownByDate,
    unknownReasonBreakdown,
    missingTimestampCount,
    missingMacroSnapshotCount,
    missingTransitionStateCount,
    recoverableByNearestSnapshot,
    recoverableByTradingDayRegime,
    recoverableByR6Trigger,
    unrecoverableCount,
    recommendedFix,
    executionImpact: 'NONE',
    brokerOrdersCreated: 0,
    promotionAllowed: false,
  };
}

function regimeUnknownRepair(input: RegimeLearningBackfillInput, write: boolean): RegimeUnknownRepairResult {
  const now = input.now ?? new Date();
  const { ghosts, counterfactuals, attributionRecords, rows } = rowsFromInputs(input);
  const macroSnapshots = defaultMacroSnapshots(input);
  const transitionSnapshots = defaultTransitionSnapshots(input);
  const byRecoveredRegime: Record<string, number> = {};
  const recoverySourceBreakdown: Record<string, number> = {};
  const recoveryConfidenceBreakdown: Record<string, number> = {};
  const failureReasonBreakdown = {} as Record<RegimeBackfillFailureReason, number>;
  const failureBySourceLane: Record<string, number> = {};
  const failureByTimestampSource = {} as Record<RegimeBackfillTimestampSource, number>;
  const failureSampleKeys: string[] = [];
  const seenAttemptKeys = new Set<string>();
  let scannedUnknown = 0;
  let attemptedUnique = 0;
  let attemptedDuplicates = 0;
  let repaired = 0;
  let stillUnknown = 0;

  for (const item of rows) {
    if (!isUnknownRow(item.row)) continue;
    scannedUnknown++;
    const attemptKey = backfillAttemptKey(item);
    if (seenAttemptKeys.has(attemptKey)) {
      attemptedDuplicates++;
      stillUnknown++;
      recordFailure(
        item,
        'DUPLICATE_SUPPRESSED_BEFORE_BACKFILL',
        failureReasonBreakdown,
        failureBySourceLane,
        failureByTimestampSource,
        failureSampleKeys,
      );
      continue;
    }
    seenAttemptKeys.add(attemptKey);
    attemptedUnique++;
    const recovered = recoverUnknownRegime(item.row, item.createdAt, macroSnapshots, transitionSnapshots);
    inc(byRecoveredRegime, recovered.regimePhase);
    inc(recoverySourceBreakdown, recovered.regimeRecoverySource);
    inc(recoveryConfidenceBreakdown, recovered.regimeRecoveryConfidence);
    if (recovered.regimePhase === 'UNKNOWN') {
      stillUnknown++;
      recordFailure(
        item,
        classifyBackfillFailure(item, macroSnapshots, transitionSnapshots),
        failureReasonBreakdown,
        failureBySourceLane,
        failureByTimestampSource,
        failureSampleKeys,
      );
      continue;
    }
    repaired++;
    if (!write) continue;
    item.row.originalRegimePhase = item.row.regimePhase ?? 'UNKNOWN';
    item.row.rawRegime = recovered.rawRegime;
    item.row.effectiveRegime = recovered.effectiveRegime;
    item.row.regimePhase = recovered.regimePhase;
    item.row.regimeAtSignal = item.row.regimeAtSignal ?? recovered.regimePhase;
    item.row.regimeRecovered = true;
    item.row.regimeRecoverySource = recovered.regimeRecoverySource;
    item.row.regimeRecoveryConfidence = recovered.regimeRecoveryConfidence;
    item.row.regimeRecoveredAt = now.toISOString();
  }

  if (write && !input.ghosts) saveGhostPortfolio(ghosts);
  if (write && !input.counterfactuals) saveCounterfactuals(counterfactuals);
  if (write && !input.attributionRecords) saveAttributionRecords(attributionRecords);

  return {
    scannedUnknown,
    attemptedUnique,
    attemptedDuplicates,
    repaired,
    stillUnknown,
    byRecoveredRegime,
    recoverySourceBreakdown,
    recoveryConfidenceBreakdown,
    failureReasonBreakdown,
    failureBySourceLane,
    failureByTimestampSource,
    failureSampleKeys,
    executionImpact: 'NONE',
    brokerOrdersCreated: 0,
    promotionAllowed: false,
  };
}

export function regimeUnknownRepairDryRun(input: RegimeLearningBackfillInput = {}): RegimeUnknownRepairResult {
  return regimeUnknownRepair(input, false);
}

export function regimeUnknownRepairRun(input: RegimeLearningBackfillInput = {}): RegimeUnknownRepairResult {
  return regimeUnknownRepair(input, true);
}

export function formatRegimeLearningBackfillDryRun(s: RegimeLearningBackfillDryRunResult): string {
  return [
    '<b>[Regime Learning Backfill Dryrun]</b>',
    `scannedTotal=${s.scannedTotal} missingRegimePhase=${s.missingRegimePhase}`,
    `recoverableByStoredSnapshot=${s.recoverableByStoredSnapshot} recoverableByTimestampMacroState=${s.recoverableByTimestampMacroState} recoverableByRegimeTransitionState=${s.recoverableByRegimeTransitionState} recoverableByCurrentRegimeFallback=${s.recoverableByCurrentRegimeFallback} recoverableByR6Trigger=${s.recoverableByR6Trigger}`,
    `unrecoverable=${s.unrecoverable} expectedByRegime=${JSON.stringify(s.expectedByRegime)} expectedUnknown=${s.expectedUnknown}`,
    `executionImpact=${s.executionImpact} brokerOrdersCreated=${s.brokerOrdersCreated}`,
  ].join('\n');
}

export function formatRegimeLearningBackfillRun(s: RegimeLearningBackfillRunResult): string {
  return [
    '<b>[Regime Learning Backfill Run]</b>',
    `scannedTotal=${s.scannedTotal} updated=${s.updated} missingRegimePhase=${s.missingRegimePhase}`,
    `byRegime=${JSON.stringify(s.byRegime)} unknownCount=${s.unknownCount}`,
    `recoverySourceBreakdown=${JSON.stringify(s.recoverySourceBreakdown)}`,
    `recoveryConfidenceBreakdown=${JSON.stringify(s.recoveryConfidenceBreakdown)}`,
    `executionImpact=${s.executionImpact} brokerOrdersCreated=${s.brokerOrdersCreated} promotionAllowed=${s.promotionAllowed}`,
  ].join('\n');
}

export function formatRegimeUnknownAnalysis(s: RegimeUnknownAnalysisResult): string {
  return [
    '<b>[Regime UNKNOWN Analysis]</b>',
    `unknownTotal=${s.unknownTotal}`,
    `unknownBySource=${JSON.stringify(s.unknownBySource)}`,
    `unknownByCaseType=${JSON.stringify(s.unknownByCaseType)}`,
    `unknownByDate=${JSON.stringify(s.unknownByDate)}`,
    `unknownReasonBreakdown=${JSON.stringify(s.unknownReasonBreakdown)}`,
    `missingTimestampCount=${s.missingTimestampCount} missingMacroSnapshotCount=${s.missingMacroSnapshotCount} missingTransitionStateCount=${s.missingTransitionStateCount}`,
    `recoverableByNearestSnapshot=${s.recoverableByNearestSnapshot} recoverableByTradingDayRegime=${s.recoverableByTradingDayRegime} recoverableByR6Trigger=${s.recoverableByR6Trigger} unrecoverableCount=${s.unrecoverableCount}`,
    `recommendedFix=${s.recommendedFix}`,
    `executionImpact=${s.executionImpact} brokerOrdersCreated=${s.brokerOrdersCreated} promotionAllowed=${s.promotionAllowed}`,
  ].join('\n');
}

export function formatRegimeUnknownRepair(s: RegimeUnknownRepairResult, mode: 'dryrun' | 'run'): string {
  return [
    `<b>[Regime UNKNOWN Repair ${mode}]</b>`,
    `scannedUnknown=${s.scannedUnknown} attemptedUnique=${s.attemptedUnique} attemptedDuplicates=${s.attemptedDuplicates} repaired=${s.repaired} stillUnknown=${s.stillUnknown}`,
    `byRecoveredRegime=${JSON.stringify(s.byRecoveredRegime)}`,
    `recoverySourceBreakdown=${JSON.stringify(s.recoverySourceBreakdown)}`,
    `recoveryConfidenceBreakdown=${JSON.stringify(s.recoveryConfidenceBreakdown)}`,
    `failureReasonBreakdown=${JSON.stringify(s.failureReasonBreakdown)}`,
    `failureBySourceLane=${JSON.stringify(s.failureBySourceLane)}`,
    `failureByTimestampSource=${JSON.stringify(s.failureByTimestampSource)}`,
    `failureSampleKeys=${JSON.stringify(s.failureSampleKeys)}`,
    `executionImpact=${s.executionImpact} brokerOrdersCreated=${s.brokerOrdersCreated} promotionAllowed=${s.promotionAllowed}`,
  ].join('\n');
}
