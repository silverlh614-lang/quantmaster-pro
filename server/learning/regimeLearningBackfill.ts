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
  rawRegime?: string;
  effectiveRegime?: string;
  regime?: string;
  entryRegime?: string;
  regimePhase?: RegimePhase;
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
  entryAt?: string;
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
  now?: Date;
  write?: boolean;
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
    ?? row.closedAt
    ?? row.lastUpdatedAt
    ?? (row.signalDate ? `${row.signalDate}T00:00:00.000Z` : undefined);
}

function isClosedOutcome(row: RegimeWritableRow): boolean {
  return row.closed === true
    || !!row.closedAt
    || ['WIN', 'LOSS', 'BREAKEVEN', 'EXPIRED'].includes(String(row.outcomeLabel ?? ''));
}

function ghostTarget(row: LearningGhostCase): RegimeLearningBackfillTarget {
  if (row.quarantinedReason || row.outcomeLabel === 'QUARANTINED') return 'QUARANTINED';
  if (isClosedOutcome(row)) return row.caseKind === 'shadow' ? 'FRESH_SHADOW' : 'GHOST_REPAIR';
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
  const rows: RegimeBackfillRow[] = [
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
