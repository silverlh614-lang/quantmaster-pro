// @responsibility Regime Learning Bank backfill diagnostics for legacy learning samples.
import fs from 'fs';
import { loadMacroState } from '../persistence/macroStateRepo.js';
import { loadRegimeTransitionState } from '../persistence/regimeTransitionStateRepo.js';
import { loadGhostPortfolio, saveGhostPortfolio } from '../persistence/reflectionRepo.js';
import { getRecentAlertHistory } from '../persistence/alertHistoryRepo.js';
import { scanTraceFile } from '../persistence/paths.js';
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
import type {
  DailyRegimeFallbackStatus,
  PriorityDateReconstructionStatus,
  RegimeBackfillFailureReason,
  RegimeBackfillTimestampSource,
  RegimeDailySnapshot,
  RegimeLearningBackfillDryRunResult,
  RegimeLearningBackfillInput,
  RegimeLearningBackfillRunResult,
  RegimeLearningBackfillTarget,
  RegimeSnapshotCoverage,
  RegimeSnapshotReconstructionConfidence,
  RegimeSnapshotReconstructionSource,
  RegimeSourceInventoryAuditStatus,
  RegimeSourceInventoryRow,
  RegimeTimestampSnapshot,
  RegimeUnknownAnalysisResult,
  RegimeUnknownReason,
  RegimeUnknownRepairResult,
  RegimeWritableRow,
} from './regimeLearningBackfill/types.js';

export * from './regimeLearningBackfill/types.js';
export * from './regimeLearningBackfill/formatters.js';
import { timestampOf, timestampSourceOf } from './regimeLearningBackfill/timestampResolver.js';

type RegimeBackfillRow = {
  target: RegimeLearningBackfillTarget;
  row: RegimeWritableRow;
  createdAt?: string;
};

interface RecoveredRegime {
  rawRegime: string;
  effectiveRegime: string;
  regimePhase: RegimePhase;
  regimeRecovered: boolean;
  regimeRecoverySource: RegimeRecoverySource;
  regimeRecoveryConfidence: RegimeRecoveryConfidence;
}

function inc(record: Record<string, number>, key: string | undefined, amount = 1): void {
  const safeKey = key || 'UNKNOWN';
  record[safeKey] = (record[safeKey] ?? 0) + amount;
}

// timestampOf / timestampSourceOf / idEpochTimestamp → ./regimeLearningBackfill/timestampResolver.js (ACMA 1500줄 분리).

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

const REGIME_BACKFILL_INTRADAY_WINDOW_MINUTES = 60;
const REGIME_BACKFILL_INTRADAY_WINDOW_MS = REGIME_BACKFILL_INTRADAY_WINDOW_MINUTES * 60 * 1000;

function phaseFromSnapshot(
  snapshot: RegimeTimestampSnapshot | RegimeDailySnapshot,
  source: RegimeRecoverySource = 'NEAREST_MACRO_SNAPSHOT',
  confidence: RegimeRecoveryConfidence = 'LOW',
): RecoveredRegime {
  const rawRegime = snapshot.rawRegime || snapshot.effectiveRegime || 'UNKNOWN';
  const effectiveRegime = snapshot.effectiveRegime || rawRegime;
  return {
    rawRegime,
    effectiveRegime,
    regimePhase: deriveRegimePhase({ rawRegime, effectiveRegime }),
    regimeRecovered: true,
    regimeRecoverySource: source,
    regimeRecoveryConfidence: confidence,
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

function isDateKey(value: string | undefined): value is string {
  return !!value && /^\d{4}-\d{2}-\d{2}$/.test(value);
}

function tradingDateKey(iso?: string): string | undefined {
  const key = dateKey(iso);
  return isDateKey(key) ? key : undefined;
}

function normalizeDailySnapshot(snapshot: RegimeDailySnapshot): RegimeDailySnapshot | undefined {
  const tradingDate = snapshot.tradingDate ?? snapshot.date ?? tradingDateKey(snapshot.at);
  const rawRegime = snapshot.rawRegime || snapshot.effectiveRegime;
  if (!isDateKey(tradingDate) || !rawRegime) return undefined;
  return {
    ...snapshot,
    tradingDate,
    rawRegime,
    effectiveRegime: snapshot.effectiveRegime || rawRegime,
  };
}

function uniqueDailySnapshots(snapshots: RegimeDailySnapshot[]): RegimeDailySnapshot[] {
  const byKey = new Map<string, RegimeDailySnapshot>();
  for (const snapshot of snapshots) {
    const normalized = normalizeDailySnapshot(snapshot);
    if (!normalized?.tradingDate) continue;
    const key = [
      normalized.tradingDate,
      normalized.source ?? 'DAILY',
      normalized.rawRegime,
      normalized.effectiveRegime ?? normalized.rawRegime,
    ].join('|');
    byKey.set(key, normalized);
  }
  return [...byKey.values()].sort((a, b) => {
    const dateCmp = String(a.tradingDate).localeCompare(String(b.tradingDate));
    return dateCmp || String(a.at ?? '').localeCompare(String(b.at ?? ''));
  });
}

function dailySnapshotsFromIntraday(snapshots: RegimeTimestampSnapshot[], source = 'INTRADAY_ROLLUP'): RegimeDailySnapshot[] {
  const latestByDate = new Map<string, RegimeDailySnapshot>();
  for (const snapshot of snapshots) {
    const tradingDate = tradingDateKey(snapshot.at);
    if (!tradingDate) continue;
    const previous = latestByDate.get(tradingDate);
    if (previous?.at && snapshot.at.localeCompare(previous.at) < 0) continue;
    latestByDate.set(tradingDate, {
      tradingDate,
      at: snapshot.at,
      rawRegime: snapshot.rawRegime,
      effectiveRegime: snapshot.effectiveRegime ?? snapshot.rawRegime,
      source,
    });
  }
  return [...latestByDate.values()];
}

function defaultDailyRegimeSnapshots(
  input: RegimeLearningBackfillInput,
  macroSnapshots: RegimeTimestampSnapshot[],
  transitionSnapshots: RegimeTimestampSnapshot[],
): RegimeDailySnapshot[] {
  if (input.dailyRegimeSnapshots) return uniqueDailySnapshots(input.dailyRegimeSnapshots);
  return uniqueDailySnapshots([
    ...dailySnapshotsFromIntraday(macroSnapshots, 'MACRO_SNAPSHOT_DAILY_ROLLUP'),
    ...dailySnapshotsFromIntraday(transitionSnapshots, 'REGIME_TRANSITION_DAILY_ROLLUP'),
  ]);
}

function defaultPulseArchiveSnapshots(input: RegimeLearningBackfillInput): RegimeDailySnapshot[] {
  const explicit = input.pulseArchiveSnapshots ?? input.pulseArchiveRegimeSnapshots;
  if (explicit) return uniqueDailySnapshots(explicit);
  const rows: RegimeDailySnapshot[] = [];
  for (const entry of getRecentAlertHistory(1000)) {
    const message = entry.message ?? '';
    if (!/Learning Pulse|Regime Learning/i.test(message)) continue;
    const effectiveRegime = message.match(/effectiveRegime=([A-Za-z0-9_]+)/)?.[1]
      ?? message.match(/activeRegime=([A-Za-z0-9_]+)/)?.[1];
    if (!effectiveRegime || effectiveRegime === 'UNKNOWN') continue;
    const rawRegime = message.match(/rawRegime=([A-Za-z0-9_]+)/)?.[1] ?? effectiveRegime;
    const tradingDate = message.match(/Learning Pulse[^\n]*(20\d{2}-\d{2}-\d{2})/)?.[1]
      ?? tradingDateKey(entry.at);
    if (!isDateKey(tradingDate)) continue;
    rows.push({
      tradingDate,
      at: entry.at,
      rawRegime,
      effectiveRegime,
      source: 'PULSE_ARCHIVE_ALERT_HISTORY',
    });
  }
  return uniqueDailySnapshots(rows);
}

const RECONSTRUCTION_PRIORITY_DATES = ['2026-05-13', '2026-04-30', '2026-05-15', '2026-05-19'];
const REGIME_SNAPSHOT_RECONSTRUCTION_PRIORITY_DATE = '2026-05-13';
const RECONSTRUCTION_SOURCE_PRIORITY: RegimeSnapshotReconstructionSource[] = [
  'REGIME_RESOLVER_DECISION_LOG',
  'EFFECTIVE_REGIME_TRANSITION_LOG',
  'R6_TRIGGER_LOG',
  'RISK_OVERRIDE_EVENT_LOG',
  'EXECUTION_POLICY_SNAPSHOT_LOG',
  'LEARNING_PULSE_ARCHIVE',
  'TELEGRAM_PULSE_ARCHIVE',
  'MARKET_MACRO_SNAPSHOT_LOG',
  'RAILWAY_APP_LOG_ARCHIVE',
];

const SOURCE_INVENTORY_KEYS: Array<keyof RegimeSourceInventoryRow> = [
  'telegramPulseArchive',
  'regimeResolverDecisionLog',
  'marketMacroSnapshotLog',
  'riskOverrideEventLog',
  'r6TriggerLog',
  'effectiveRegimeTransitionLog',
  'executionPolicySnapshotLog',
  'learningPulseArchive',
  'railwayAppLogArchive',
];

const SOURCE_TO_INVENTORY_KEY: Record<RegimeSnapshotReconstructionSource, keyof RegimeSourceInventoryRow> = {
  TELEGRAM_PULSE_ARCHIVE: 'telegramPulseArchive',
  REGIME_RESOLVER_DECISION_LOG: 'regimeResolverDecisionLog',
  MARKET_MACRO_SNAPSHOT_LOG: 'marketMacroSnapshotLog',
  RISK_OVERRIDE_EVENT_LOG: 'riskOverrideEventLog',
  R6_TRIGGER_LOG: 'r6TriggerLog',
  EFFECTIVE_REGIME_TRANSITION_LOG: 'effectiveRegimeTransitionLog',
  EXECUTION_POLICY_SNAPSHOT_LOG: 'executionPolicySnapshotLog',
  LEARNING_PULSE_ARCHIVE: 'learningPulseArchive',
  RAILWAY_APP_LOG_ARCHIVE: 'railwayAppLogArchive',
};

type ReconstructionCandidate = {
  tradingDate: string;
  rawRegime: string;
  effectiveRegime: string;
  riskOverride?: string;
  source: RegimeSnapshotReconstructionSource;
  confidence: RegimeSnapshotReconstructionConfidence;
  at?: string;
};

function reconstructionConfidenceForSource(source: RegimeSnapshotReconstructionSource): RegimeSnapshotReconstructionConfidence {
  return source === 'REGIME_RESOLVER_DECISION_LOG'
    || source === 'EFFECTIVE_REGIME_TRANSITION_LOG'
    || source === 'R6_TRIGGER_LOG'
    ? 'RECOVERED_MEDIUM'
    : 'RECOVERED_LOW';
}

function recoveryConfidenceFromDailySnapshot(snapshot: RegimeDailySnapshot, fallback: RegimeRecoveryConfidence): RegimeRecoveryConfidence {
  if (snapshot.confidence === 'RECOVERED_MEDIUM') return 'MEDIUM';
  if (snapshot.confidence === 'RECOVERED_LOW') return 'LOW';
  return fallback;
}

function reconstructionDateRank(date: string): number {
  const idx = RECONSTRUCTION_PRIORITY_DATES.indexOf(date);
  return idx >= 0 ? idx : RECONSTRUCTION_PRIORITY_DATES.length;
}

function sortReconstructionDates(dates: Iterable<string>): string[] {
  return [...new Set([...dates].filter(isDateKey))]
    .sort((a, b) => reconstructionDateRank(a) - reconstructionDateRank(b) || a.localeCompare(b));
}

function cleanRegimeToken(value: string | undefined): string | undefined {
  const token = String(value ?? '').trim().replace(/^["'<]+|[,"')>\]]+$/g, '').toUpperCase();
  if (!token || token === 'NONE' || token === 'UNKNOWN' || token === 'N/A' || token === 'NULL' || token === 'UNDEFINED') return undefined;
  return token;
}

function tokenFromText(text: string, keys: string[]): string | undefined {
  for (const key of keys) {
    const match = text.match(new RegExp(`${key}=([A-Za-z0-9_]+)`));
    const token = cleanRegimeToken(match?.[1]);
    if (token) return token;
  }
  return undefined;
}

function parseTelegramRegimeSignal(text: string): { rawRegime?: string; effectiveRegime?: string; riskOverride?: string; matched: boolean; failureReason?: string } {
  const normalized = text.replace(/\s+/g, ' ');
  const rawRegime = tokenFromText(normalized, ['rawRegime', 'detectedRegime']);
  const explicitEffective = tokenFromText(normalized, ['effectiveRegime', 'activeRegime', 'displayRegime', 'regime']);
  const riskOverride = tokenFromText(normalized, ['riskOverride']);
  const literalRegime = normalized.match(/\bR[1-6]_[A-Z_]+\b/)?.[0];
  const koreanDisplay = /레짐\s*GREEN/i.test(normalized) ? 'GREEN' : undefined;
  const blockDefense = /R6_DEFENSE.*(차단|BLOCK|Blocked)/i.test(normalized) ? 'R6_DEFENSE' : undefined;
  const shadowBlocked = /Shadow\s*ON\s*\/\s*Live Buy Blocked/i.test(normalized) ? 'R6_DEFENSE' : undefined;
  const effectiveRegime = explicitEffective ?? blockDefense ?? shadowBlocked ?? literalRegime ?? koreanDisplay ?? rawRegime;
  const matched = Boolean(rawRegime || explicitEffective || riskOverride || literalRegime || koreanDisplay || blockDefense || shadowBlocked);
  return {
    rawRegime: rawRegime ?? literalRegime ?? effectiveRegime,
    effectiveRegime,
    riskOverride,
    matched,
    failureReason: matched ? undefined : 'TELEGRAM_ARCHIVE_FOUND_BUT_NO_REGIME_PATTERN',
  };
}

function normalizeReconstructionSourceHint(value: string | undefined): RegimeSnapshotReconstructionSource | undefined {
  const source = String(value ?? '').trim().toUpperCase();
  if (!source) return undefined;
  if (source === 'REGIME_RESOLVER_LOG') return 'REGIME_RESOLVER_DECISION_LOG';
  if (source === 'MARKET_MACRO_SNAPSHOT') return 'MARKET_MACRO_SNAPSHOT_LOG';
  if (source === 'R6_TRIGGER_EVENT') return 'R6_TRIGGER_LOG';
  if (source === 'RISK_OVERRIDE_LOG' || source === 'RAW_REGIME_PLUS_OVERRIDE') return 'RISK_OVERRIDE_EVENT_LOG';
  if (source === 'REGIME_TRANSITION_STATE_BY_TIMESTAMP') return 'EFFECTIVE_REGIME_TRANSITION_LOG';
  if (source === 'PULSE_ARCHIVE_ALERT_HISTORY') return 'LEARNING_PULSE_ARCHIVE';
  if (source === 'TELEGRAM_ALERT_HISTORY') return 'TELEGRAM_PULSE_ARCHIVE';
  if (source in SOURCE_TO_INVENTORY_KEY) return source as RegimeSnapshotReconstructionSource;
  return undefined;
}

function dateFromText(text: string, fallback?: string): string | undefined {
  const pulseDate = text.match(/Learning Pulse[^\n]*(20\d{2}-\d{2}-\d{2})/)?.[1];
  if (isDateKey(pulseDate)) return pulseDate;
  const anyDate = text.match(/\b(20\d{2}-\d{2}-\d{2})\b/)?.[1];
  if (isDateKey(anyDate)) return anyDate;
  return tradingDateKey(fallback);
}

function sourcesFromText(text: string, hintedSource?: string): RegimeSnapshotReconstructionSource[] {
  const haystack = `${hintedSource ?? ''} ${text}`.toUpperCase();
  const sources = new Set<RegimeSnapshotReconstructionSource>();
  const hinted = normalizeReconstructionSourceHint(hintedSource);
  if (hinted) sources.add(hinted);
  if (haystack.includes('TELEGRAM')) sources.add('TELEGRAM_PULSE_ARCHIVE');
  if (haystack.includes('LEARNING PULSE') || haystack.includes('REGIME LEARNING')) sources.add('LEARNING_PULSE_ARCHIVE');
  if (haystack.includes('REGIMERESOLVER') || haystack.includes('COMMAND=/REGIME') || haystack.includes('SOURCE_QUERY_RESULT')) sources.add('REGIME_RESOLVER_DECISION_LOG');
  if (haystack.includes('EFFECTIVEREGIME TRANSITION') || haystack.includes('EFFECTIVE_REGIME_TRANSITION') || haystack.includes('LASTTRANSITIONAT') || haystack.includes('TRANSITIONDIRECTION') || haystack.includes('REGIME_TRANSITION')) sources.add('EFFECTIVE_REGIME_TRANSITION_LOG');
  if (haystack.includes('R6_TRIGGER') || haystack.includes('ACTIVER6TRIGGERS') || haystack.includes('R6SHOCKLATCH') || haystack.includes('REGIME_ALERT') || haystack.includes('R6_DEFENSE_BLOCK')) sources.add('R6_TRIGGER_LOG');
  if (haystack.includes('RISK_OVERRIDE') || haystack.includes('RISK OVERRIDE')) sources.add('RISK_OVERRIDE_EVENT_LOG');
  if (haystack.includes('ENGINE RUNTIME POLICY') || haystack.includes('EXECUTIONPOLICY') || haystack.includes('EXECUTION POLICY') || haystack.includes('LIVEBUYPOLICY') || haystack.includes('SHADOWPOLICY') || haystack.includes('EXECUTIONMODE') || haystack.includes('LIVEENTRYALLOWED')) sources.add('EXECUTION_POLICY_SNAPSHOT_LOG');
  if (haystack.includes('MACRO') || haystack.includes('MARKETSTATE') || haystack.includes('MHS') || haystack.includes('SCAN_TRACE')) sources.add('MARKET_MACRO_SNAPSHOT_LOG');
  if (haystack.includes('RAILWAY')) sources.add('RAILWAY_APP_LOG_ARCHIVE');
  return [...sources];
}

function primarySourceFromText(text: string, hintedSource?: string): RegimeSnapshotReconstructionSource | undefined {
  const sources = sourcesFromText(text, hintedSource);
  return RECONSTRUCTION_SOURCE_PRIORITY.find((source) => sources.includes(source));
}

function candidateFromText(text: string, fallbackDate?: string, hintedSource?: string): ReconstructionCandidate | undefined {
  const tradingDate = dateFromText(text, fallbackDate);
  if (!tradingDate) return undefined;
  const parsedTelegram = /TELEGRAM/i.test(`${hintedSource ?? ''} ${text}`) ? parseTelegramRegimeSignal(text) : undefined;
  const rawRegime = parsedTelegram?.rawRegime ?? tokenFromText(text, ['rawRegime', 'detectedRegime', 'macroRegimeRaw', 'raw']);
  const effectiveRegime = parsedTelegram?.effectiveRegime ?? tokenFromText(text, ['effectiveRegime', 'macroRegimeEffective', 'displayRegime', 'activeRegime', 'regime']);
  const riskOverride = parsedTelegram?.riskOverride ?? tokenFromText(text, ['riskOverride']);
  const source = primarySourceFromText(text, hintedSource)
    ?? (riskOverride ? 'RISK_OVERRIDE_EVENT_LOG' : undefined);
  if (!source) return undefined;
  const hasR6Signal = sourcesFromText(text, hintedSource).includes('R6_TRIGGER_LOG');
  const resolvedEffective = effectiveRegime ?? riskOverride ?? (hasR6Signal ? 'R6_DEFENSE' : undefined) ?? rawRegime;
  const resolvedRaw = rawRegime ?? effectiveRegime ?? riskOverride ?? (hasR6Signal ? 'R6_DEFENSE' : undefined);
  if (!resolvedRaw || !resolvedEffective) return undefined;
  return {
    tradingDate,
    rawRegime: resolvedRaw,
    effectiveRegime: resolvedEffective,
    riskOverride,
    source,
    confidence: reconstructionConfidenceForSource(source),
    at: fallbackDate,
  };
}

function candidatesFromScanTraceDate(tradingDate: string): ReconstructionCandidate[] {
  const file = scanTraceFile(tradingDate.replace(/-/g, ''));
  if (!fs.existsSync(file)) return [];
  try {
    const raw = JSON.parse(fs.readFileSync(file, 'utf8'));
    const rows = Array.isArray(raw) ? raw : [raw];
    return rows
      .map((row) => candidateFromText(JSON.stringify(row), tradingDate, 'SCAN_TRACE MARKET_MACRO_SNAPSHOT'))
      .filter((candidate): candidate is ReconstructionCandidate => !!candidate);
  } catch {
    return [];
  }
}

function emptySourceInventoryRow(): RegimeSourceInventoryRow {
  return {
    telegramPulseArchive: 0,
    regimeResolverDecisionLog: 0,
    marketMacroSnapshotLog: 0,
    riskOverrideEventLog: 0,
    r6TriggerLog: 0,
    effectiveRegimeTransitionLog: 0,
    executionPolicySnapshotLog: 0,
    learningPulseArchive: 0,
    railwayAppLogArchive: 0,
  };
}

function addSourceInventoryFromText(
  inventory: Record<string, RegimeSourceInventoryRow>,
  text: string,
  fallbackDate?: string,
  hintedSource?: string,
): void {
  const tradingDate = dateFromText(text, fallbackDate);
  if (!tradingDate) return;
  const row = inventory[tradingDate] ?? emptySourceInventoryRow();
  for (const source of sourcesFromText(text, hintedSource)) {
    row[SOURCE_TO_INVENTORY_KEY[source]] += 1;
  }
  inventory[tradingDate] = row;
}

function sourceInventoryTotal(row: RegimeSourceInventoryRow | undefined): number {
  if (!row) return 0;
  return SOURCE_INVENTORY_KEYS.reduce((sum, key) => sum + (row[key] ?? 0), 0);
}

function buildSourceInventory(input: {
  attemptedDates: string[];
  candidates: ReconstructionCandidate[];
  rawInventory: Record<string, RegimeSourceInventoryRow>;
}): {
  byDate: Record<string, RegimeSourceInventoryRow>;
  topAvailable: string[];
  missingSources: Record<string, string[]>;
  auditStatus: RegimeSourceInventoryAuditStatus;
} {
  const byDate: Record<string, RegimeSourceInventoryRow> = {};
  const attempted = new Set(input.attemptedDates);
  for (const date of input.attemptedDates) byDate[date] = { ...(input.rawInventory[date] ?? emptySourceInventoryRow()) };
  for (const candidate of input.candidates) {
    if (!attempted.has(candidate.tradingDate)) continue;
    const row = byDate[candidate.tradingDate] ?? emptySourceInventoryRow();
    const key = SOURCE_TO_INVENTORY_KEY[candidate.source];
    if ((row[key] ?? 0) === 0) row[key] = 1;
    byDate[candidate.tradingDate] = row;
  }
  const sourceTotals: Record<string, number> = {};
  const missingSources: Record<string, string[]> = {};
  for (const date of input.attemptedDates) {
    const row = byDate[date] ?? emptySourceInventoryRow();
    byDate[date] = row;
    missingSources[date] = SOURCE_INVENTORY_KEYS.filter((key) => (row[key] ?? 0) === 0);
    for (const key of SOURCE_INVENTORY_KEYS) sourceTotals[key] = (sourceTotals[key] ?? 0) + (row[key] ?? 0);
  }
  const topAvailable = Object.entries(sourceTotals)
    .filter(([, count]) => count > 0)
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
    .slice(0, 8)
    .map(([source, count]) => `${source}:${count}`);
  const priorityRow = byDate[REGIME_SNAPSHOT_RECONSTRUCTION_PRIORITY_DATE];
  const auditStatus: RegimeSourceInventoryAuditStatus = input.attemptedDates.length === 0
    ? 'NO_MISSING_DATES'
    : input.attemptedDates.includes(REGIME_SNAPSHOT_RECONSTRUCTION_PRIORITY_DATE)
      ? sourceInventoryTotal(priorityRow) > 0
        ? 'PRIORITY_SOURCE_AVAILABLE'
        : 'PRIORITY_SOURCE_MISSING'
      : topAvailable.length > 0
        ? 'PARTIAL_SOURCE_AVAILABLE'
        : 'NO_SOURCES_AVAILABLE';
  return { byDate, topAvailable, missingSources, auditStatus };
}

function reconstructionCandidatesFromInput(
  input: RegimeLearningBackfillInput,
  attemptedDates: string[],
  pulseArchiveSnapshots: RegimeDailySnapshot[],
  macroSnapshots: RegimeTimestampSnapshot[],
  transitionSnapshots: RegimeTimestampSnapshot[],
): { candidates: ReconstructionCandidate[]; rawInventory: Record<string, RegimeSourceInventoryRow> } {
  const candidates: ReconstructionCandidate[] = [];
  const rawInventory: Record<string, RegimeSourceInventoryRow> = {};
  for (const snapshot of pulseArchiveSnapshots) {
    if (!snapshot.tradingDate) continue;
    const rawRegime = cleanRegimeToken(snapshot.rawRegime);
    const effectiveRegime = cleanRegimeToken(snapshot.effectiveRegime ?? snapshot.rawRegime);
    if (!rawRegime || !effectiveRegime) continue;
    candidates.push({
      tradingDate: snapshot.tradingDate,
      rawRegime,
      effectiveRegime,
      riskOverride: snapshot.riskOverride,
      source: normalizeReconstructionSourceHint(snapshot.source) ?? 'LEARNING_PULSE_ARCHIVE',
      confidence: 'RECOVERED_LOW',
      at: snapshot.at,
    });
    addSourceInventoryFromText(rawInventory, `Learning Pulse rawRegime=${rawRegime} effectiveRegime=${effectiveRegime}`, snapshot.at ?? snapshot.tradingDate, snapshot.source ?? 'LEARNING_PULSE_ARCHIVE');
  }
  for (const entry of input.reconstructionLogEntries ?? []) {
    const text = [
      entry.message,
      entry.rawRegime ? `rawRegime=${entry.rawRegime}` : undefined,
      entry.effectiveRegime ? `effectiveRegime=${entry.effectiveRegime}` : undefined,
      entry.riskOverride ? `riskOverride=${entry.riskOverride}` : undefined,
      entry.tradingDate,
    ].filter(Boolean).join(' ');
    addSourceInventoryFromText(rawInventory, text, entry.at ?? entry.tradingDate, entry.source);
    const candidate = candidateFromText(text, entry.at ?? entry.tradingDate, entry.source);
    if (candidate) candidates.push(candidate);
  }
  for (const entry of getRecentAlertHistory(1000)) {
    addSourceInventoryFromText(rawInventory, entry.message ?? '', entry.at, 'TELEGRAM_PULSE_ARCHIVE');
    const candidate = candidateFromText(entry.message ?? '', entry.at, 'TELEGRAM_ALERT_HISTORY');
    if (candidate) candidates.push(candidate);
  }
  for (const date of attemptedDates) {
    const file = scanTraceFile(date.replace(/-/g, ''));
    if (fs.existsSync(file)) addSourceInventoryFromText(rawInventory, `scan_trace ${date} MARKET_MACRO_SNAPSHOT`, date, 'MARKET_MACRO_SNAPSHOT_LOG');
    candidates.push(...candidatesFromScanTraceDate(date));
  }
  for (const snapshot of macroSnapshots) {
    addSourceInventoryFromText(rawInventory, `macroRegimeRaw=${snapshot.rawRegime} macroRegimeEffective=${snapshot.effectiveRegime ?? snapshot.rawRegime}`, snapshot.at, 'MARKET_MACRO_SNAPSHOT_LOG');
    const candidate = candidateFromText(
      `macroRegimeRaw=${snapshot.rawRegime} macroRegimeEffective=${snapshot.effectiveRegime ?? snapshot.rawRegime}`,
      snapshot.at,
      'MARKET_MACRO_SNAPSHOT_LOG',
    );
    if (candidate) candidates.push(candidate);
  }
  for (const snapshot of transitionSnapshots) {
    addSourceInventoryFromText(rawInventory, `rawRegime=${snapshot.rawRegime} effectiveRegime=${snapshot.effectiveRegime ?? snapshot.rawRegime} lastTransitionAt=${snapshot.at}`, snapshot.at, 'EFFECTIVE_REGIME_TRANSITION_LOG');
    const candidate = candidateFromText(
      `rawRegime=${snapshot.rawRegime} effectiveRegime=${snapshot.effectiveRegime ?? snapshot.rawRegime}`,
      snapshot.at,
      'EFFECTIVE_REGIME_TRANSITION_LOG',
    );
    if (candidate) candidates.push(candidate);
  }
  return { candidates, rawInventory };
}

function bestReconstructionCandidate(candidates: ReconstructionCandidate[]): ReconstructionCandidate | undefined {
  return [...candidates].sort((a, b) => {
    const sourceRank = RECONSTRUCTION_SOURCE_PRIORITY.indexOf(a.source) - RECONSTRUCTION_SOURCE_PRIORITY.indexOf(b.source);
    return sourceRank || String(b.at ?? '').localeCompare(String(a.at ?? ''));
  })[0];
}

function reconstructDailySnapshotsForDates(input: {
  attemptedDates: string[];
  candidates: ReconstructionCandidate[];
  reconstructedAt: string;
}): {
  snapshots: RegimeDailySnapshot[];
  attemptedDates: string[];
  succeededDates: string[];
  failedDates: string[];
  sourceBreakdown: Record<string, number>;
  confidenceBreakdown: Record<string, number>;
} {
  const attemptedDates = sortReconstructionDates(input.attemptedDates);
  const snapshots: RegimeDailySnapshot[] = [];
  const succeededDates: string[] = [];
  const failedDates: string[] = [];
  const sourceBreakdown: Record<string, number> = {};
  const confidenceBreakdown: Record<string, number> = {};
  for (const date of attemptedDates) {
    const best = bestReconstructionCandidate(input.candidates.filter((candidate) => candidate.tradingDate === date));
    if (!best) {
      failedDates.push(date);
      continue;
    }
    snapshots.push({
      tradingDate: date,
      at: best.at,
      rawRegime: best.rawRegime,
      effectiveRegime: best.effectiveRegime,
      riskOverride: best.riskOverride,
      source: best.source,
      confidence: best.confidence,
      reconstructed: true,
      reconstructedAt: input.reconstructedAt,
      executionImpact: 'NONE',
    });
    succeededDates.push(date);
    inc(sourceBreakdown, best.source);
    inc(confidenceBreakdown, best.confidence);
  }
  return { snapshots, attemptedDates, succeededDates, failedDates, sourceBreakdown, confidenceBreakdown };
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

function nearestIntradaySnapshotWithin60m(
  createdAt: string | undefined,
  snapshots: RegimeTimestampSnapshot[],
): RegimeTimestampSnapshot | undefined {
  const createdMs = parseMillis(createdAt);
  if (!Number.isFinite(createdMs) || snapshots.length === 0) return undefined;
  return snapshots
    .map((snapshot) => ({ snapshot, delta: Math.abs(parseMillis(snapshot.at) - createdMs) }))
    .filter((row) => Number.isFinite(row.delta) && row.delta <= REGIME_BACKFILL_INTRADAY_WINDOW_MS)
    .sort((a, b) => a.delta - b.delta)[0]?.snapshot;
}

function sameTradingDaySnapshot(createdAt: string | undefined, snapshots: RegimeTimestampSnapshot[]): RegimeTimestampSnapshot | undefined {
  return snapshots.find((snapshot) => sameDate(createdAt, snapshot.at));
}

function sameDayDailySnapshot(createdAt: string | undefined, snapshots: RegimeDailySnapshot[]): RegimeDailySnapshot | undefined {
  const tradingDate = tradingDateKey(createdAt);
  if (!tradingDate) return undefined;
  const sameDay = snapshots.filter((snapshot) => snapshot.tradingDate === tradingDate);
  return sameDay.find((snapshot) => snapshot.reconstructed !== true) ?? sameDay[0];
}

function previousTradingDayCloseSnapshot(createdAt: string | undefined, snapshots: RegimeDailySnapshot[]): RegimeDailySnapshot | undefined {
  const tradingDate = tradingDateKey(createdAt);
  if (!tradingDate) return undefined;
  return snapshots
    .filter((snapshot) => snapshot.tradingDate && snapshot.tradingDate < tradingDate)
    .sort((a, b) => String(b.tradingDate).localeCompare(String(a.tradingDate)) || String(b.at ?? '').localeCompare(String(a.at ?? '')))[0];
}

function snapshotCoverageForTradingDate(
  tradingDate: string,
  macroSnapshots: RegimeTimestampSnapshot[],
  dailySnapshots: RegimeDailySnapshot[],
  pulseArchiveSnapshots: RegimeDailySnapshot[],
): RegimeSnapshotCoverage {
  return {
    intradayNearest60m: macroSnapshots.filter((snapshot) => tradingDateKey(snapshot.at) === tradingDate).length,
    sameDayDaily: dailySnapshots.filter((snapshot) => snapshot.tradingDate === tradingDate && snapshot.reconstructed !== true).length,
    previousTradingDayClose: dailySnapshots.some((snapshot) => snapshot.tradingDate && snapshot.tradingDate < tradingDate && snapshot.reconstructed !== true) ? 1 : 0,
    pulseArchiveSameDate: pulseArchiveSnapshots.filter((snapshot) => snapshot.tradingDate === tradingDate).length,
    reconstructedDaily: dailySnapshots.filter((snapshot) => snapshot.tradingDate === tradingDate && snapshot.reconstructed === true).length,
  };
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
  dailySnapshots: RegimeDailySnapshot[] = [],
  pulseArchiveSnapshots: RegimeDailySnapshot[] = [],
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
  const intradayNearest = nearestIntradaySnapshotWithin60m(createdAt, macroSnapshots);
  if (intradayNearest) {
    return phaseFromSnapshot(intradayNearest, 'INTRADAY_NEAREST_60M', 'MEDIUM');
  }
  const sameDayDaily = sameDayDailySnapshot(createdAt, dailySnapshots);
  if (sameDayDaily) {
    return phaseFromSnapshot(
      sameDayDaily,
      sameDayDaily.reconstructed ? 'RECONSTRUCTED_DAILY_REGIME' : 'SAME_DAY_DAILY_REGIME',
      recoveryConfidenceFromDailySnapshot(sameDayDaily, 'LOW'),
    );
  }
  const previousClose = previousTradingDayCloseSnapshot(createdAt, dailySnapshots);
  if (previousClose) {
    return phaseFromSnapshot(previousClose, 'PREVIOUS_TRADING_DAY_CLOSE', recoveryConfidenceFromDailySnapshot(previousClose, 'LOW'));
  }
  const pulseArchive = sameDayDailySnapshot(createdAt, pulseArchiveSnapshots);
  if (pulseArchive) {
    return phaseFromSnapshot(pulseArchive, 'PULSE_ARCHIVE_SAME_DATE', 'LOW');
  }
  const session = marketSessionPhase(row);
  if (session && session.regimePhase !== 'MARKET_CLOSED') return session;
  const tradingDay = sameTradingDaySnapshot(createdAt, transitionSnapshots);
  if (tradingDay) {
    return phaseFromSnapshot(tradingDay, 'TRADING_DAY_REGIME', 'MEDIUM');
  }
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

function snapshotRepoEmpty(
  macroSnapshots: RegimeTimestampSnapshot[],
  transitionSnapshots: RegimeTimestampSnapshot[],
  dailySnapshots: RegimeDailySnapshot[] = [],
  pulseArchiveSnapshots: RegimeDailySnapshot[] = [],
): boolean {
  return macroSnapshots.length === 0
    && transitionSnapshots.length === 0
    && dailySnapshots.length === 0
    && pulseArchiveSnapshots.length === 0;
}

function classifyBackfillFailure(
  item: RegimeBackfillRow,
  macroSnapshots: RegimeTimestampSnapshot[],
  transitionSnapshots: RegimeTimestampSnapshot[],
  dailySnapshots: RegimeDailySnapshot[] = [],
  pulseArchiveSnapshots: RegimeDailySnapshot[] = [],
  noReconstructionSourceDates: Set<string> = new Set(),
): RegimeBackfillFailureReason {
  const tradingDate = tradingDateKey(item.createdAt);
  if (tradingDate && noReconstructionSourceDates.has(tradingDate)) return 'NO_RECONSTRUCTION_SOURCE_FOR_DATE';
  const reason = unknownReason(item, macroSnapshots, transitionSnapshots);
  if (reason === 'MISSING_CREATED_AT') return 'MISSING_SAMPLE_TIMESTAMP';
  if (reason === 'CORRUPTED_TIMESTAMP') return 'INVALID_TIMESTAMP';
  if (reason === 'CASE_TYPE_NOT_SUPPORTED') return 'SOURCE_LANE_EXCLUDED';
  if (reason === 'AMBIGUOUS_SESSION') return 'TIMEZONE_MISMATCH_SUSPECT';
  if (reason === 'NO_MACRO_SNAPSHOT' || reason === 'NO_TRANSITION_STATE' || reason === 'PRE_REGIME_TRACKING_SAMPLE') {
    return snapshotRepoEmpty(macroSnapshots, transitionSnapshots, dailySnapshots, pulseArchiveSnapshots) ? 'SNAPSHOT_REPO_EMPTY' : 'NO_SNAPSHOT_IN_WINDOW';
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
  failureByTradingDate: Record<string, number>,
  failureSampleKeys: string[],
): void {
  inc(failureReasonBreakdown as Record<string, number>, failureReason);
  inc(failureBySourceLane, item.target);
  inc(failureByTimestampSource as Record<string, number>, timestampSourceOf(item.row));
  inc(failureByTradingDate, tradingDateKey(item.createdAt) ?? dateKey(item.createdAt));
  if (failureSampleKeys.length < 10) {
    failureSampleKeys.push(`${failureReason}:${backfillAttemptKey(item)}`);
  }
}

function recoveredConfidenceLabel(confidence: RegimeRecoveryConfidence): string {
  if (confidence === 'HIGH') return 'RECOVERED_HIGH';
  if (confidence === 'MEDIUM') return 'RECOVERED_MEDIUM';
  if (confidence === 'LOW') return 'RECOVERED_LOW';
  return 'UNKNOWN';
}

function collectInitialMissingReconstructionDates(
  rows: RegimeBackfillRow[],
  macroSnapshots: RegimeTimestampSnapshot[],
  transitionSnapshots: RegimeTimestampSnapshot[],
  dailySnapshots: RegimeDailySnapshot[],
  pulseArchiveSnapshots: RegimeDailySnapshot[],
): string[] {
  const missing = new Set<string>();
  for (const item of rows) {
    if (!isUnknownRow(item.row)) continue;
    const tradingDate = tradingDateKey(item.createdAt);
    if (!tradingDate) continue;
    const recovered = recoverUnknownRegime(
      item.row,
      item.createdAt,
      macroSnapshots,
      transitionSnapshots,
      dailySnapshots,
      pulseArchiveSnapshots,
    );
    if (recovered.regimePhase === 'UNKNOWN') missing.add(tradingDate);
  }
  return sortReconstructionDates(missing);
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
  const dailySnapshots = defaultDailyRegimeSnapshots(input, macroSnapshots, transitionSnapshots);
  const pulseArchiveSnapshots = defaultPulseArchiveSnapshots(input);
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
    if (!nearestIntradaySnapshotWithin60m(item.createdAt, macroSnapshots)) missingMacroSnapshotCount++;
    if (!sameTradingDaySnapshot(item.createdAt, transitionSnapshots)) missingTransitionStateCount++;
    const recovered = recoverUnknownRegime(item.row, item.createdAt, macroSnapshots, transitionSnapshots, dailySnapshots, pulseArchiveSnapshots);
    if (recovered.regimeRecoverySource === 'INTRADAY_NEAREST_60M'
      || recovered.regimeRecoverySource === 'NEAREST_MACRO_SNAPSHOT'
      || recovered.regimeRecoverySource === 'MACRO_SNAPSHOT_BY_TIMESTAMP') recoverableByNearestSnapshot++;
    if (recovered.regimeRecoverySource === 'SAME_DAY_DAILY_REGIME'
      || recovered.regimeRecoverySource === 'RECONSTRUCTED_DAILY_REGIME'
      || recovered.regimeRecoverySource === 'PREVIOUS_TRADING_DAY_CLOSE'
      || recovered.regimeRecoverySource === 'PULSE_ARCHIVE_SAME_DATE'
      || recovered.regimeRecoverySource === 'TRADING_DAY_REGIME') recoverableByTradingDayRegime++;
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
  const initialDailySnapshots = defaultDailyRegimeSnapshots(input, macroSnapshots, transitionSnapshots);
  const pulseArchiveSnapshots = defaultPulseArchiveSnapshots(input);
  const reconstructionAttemptDates = collectInitialMissingReconstructionDates(
    rows,
    macroSnapshots,
    transitionSnapshots,
    initialDailySnapshots,
    pulseArchiveSnapshots,
  );
  const reconstructionInputs = reconstructionCandidatesFromInput(
    input,
    reconstructionAttemptDates,
    pulseArchiveSnapshots,
    macroSnapshots,
    transitionSnapshots,
  );
  const sourceInventory = buildSourceInventory({
    attemptedDates: reconstructionAttemptDates,
    candidates: reconstructionInputs.candidates,
    rawInventory: reconstructionInputs.rawInventory,
  });
  const noReconstructionSourceDates = new Set(
    reconstructionAttemptDates.filter((date) => sourceInventoryTotal(sourceInventory.byDate[date]) === 0),
  );
  const reconstruction = reconstructDailySnapshotsForDates({
    attemptedDates: reconstructionAttemptDates,
    candidates: reconstructionInputs.candidates,
    reconstructedAt: now.toISOString(),
  });
  const dailySnapshots = uniqueDailySnapshots([...initialDailySnapshots, ...reconstruction.snapshots]);
  const byRecoveredRegime: Record<string, number> = {};
  const recoverySourceBreakdown: Record<string, number> = {};
  const recoveryConfidenceBreakdown: Record<string, number> = {};
  const recoveredBySource: Record<string, number> = {};
  const recoveredByConfidence: Record<string, number> = {};
  const failureReasonBreakdown = {} as Record<RegimeBackfillFailureReason, number>;
  const failureBySourceLane: Record<string, number> = {};
  const failureByTimestampSource = {} as Record<RegimeBackfillTimestampSource, number>;
  const failureByTradingDate: Record<string, number> = {};
  const snapshotCoverageByTradingDate: Record<string, RegimeSnapshotCoverage> = {};
  const failureSampleKeys: string[] = [];
  const telegramArchiveCountByDate: Record<string, number> = {};
  const telegramArchiveRegimePatternMatchedByDate: Record<string, number> = {};
  const telegramArchiveEffectiveRegimeExtractedByDate: Record<string, number> = {};
  const telegramArchiveRejectedNoRegimeByDate: Record<string, number> = {};
  const telegramArchiveParseFailureReasonCounts: Record<string, number> = {};
  const seenAttemptKeys = new Set<string>();
  let scannedUnknown = 0;
  let attemptedUnique = 0;
  let attemptedDuplicates = 0;
  let repaired = 0;
  let stillUnknown = 0;
  let priorityDateRecoveredSampleCount = 0;

  for (const entry of getRecentAlertHistory(1000)) {
    const date = tradingDateKey(entry.at);
    if (!date) continue;
    inc(telegramArchiveCountByDate, date);
    const parsed = parseTelegramRegimeSignal(entry.message ?? '');
    if (!parsed.matched) {
      inc(telegramArchiveRejectedNoRegimeByDate, date);
      inc(telegramArchiveParseFailureReasonCounts, parsed.failureReason ?? 'TELEGRAM_ARCHIVE_PARSE_FAILED');
      continue;
    }
    inc(telegramArchiveRegimePatternMatchedByDate, date);
    if (parsed.effectiveRegime) inc(telegramArchiveEffectiveRegimeExtractedByDate, date);
  }

  for (const item of rows) {
    if (!isUnknownRow(item.row)) continue;
    scannedUnknown++;
    const tradingDate = tradingDateKey(item.createdAt);
    if (tradingDate && !snapshotCoverageByTradingDate[tradingDate]) {
      snapshotCoverageByTradingDate[tradingDate] = snapshotCoverageForTradingDate(
        tradingDate,
        macroSnapshots,
        dailySnapshots,
        pulseArchiveSnapshots,
      );
    }
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
        failureByTradingDate,
        failureSampleKeys,
      );
      continue;
    }
    seenAttemptKeys.add(attemptKey);
    attemptedUnique++;
    const recovered = recoverUnknownRegime(
      item.row,
      item.createdAt,
      macroSnapshots,
      transitionSnapshots,
      dailySnapshots,
      pulseArchiveSnapshots,
    );
    inc(byRecoveredRegime, recovered.regimePhase);
    inc(recoverySourceBreakdown, recovered.regimeRecoverySource);
    inc(recoveryConfidenceBreakdown, recovered.regimeRecoveryConfidence);
    if (recovered.regimePhase === 'UNKNOWN') {
      stillUnknown++;
      recordFailure(
        item,
        classifyBackfillFailure(item, macroSnapshots, transitionSnapshots, dailySnapshots, pulseArchiveSnapshots, noReconstructionSourceDates),
        failureReasonBreakdown,
        failureBySourceLane,
        failureByTimestampSource,
        failureByTradingDate,
        failureSampleKeys,
      );
      continue;
    }
    repaired++;
    if (tradingDate === REGIME_SNAPSHOT_RECONSTRUCTION_PRIORITY_DATE) priorityDateRecoveredSampleCount++;
    inc(recoveredBySource, recovered.regimeRecoverySource);
    inc(recoveredByConfidence, recoveredConfidenceLabel(recovered.regimeRecoveryConfidence));
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

  const missingRegimeSnapshotDates = Object.keys(failureByTradingDate)
    .filter(isDateKey)
    .filter((date) => (snapshotCoverageByTradingDate[date]?.sameDayDaily ?? 0) === 0)
    .sort();
  const dailyFallbackRecovered = (recoveredBySource.SAME_DAY_DAILY_REGIME ?? 0)
    + (recoveredBySource.PREVIOUS_TRADING_DAY_CLOSE ?? 0)
    + (recoveredBySource.PULSE_ARCHIVE_SAME_DATE ?? 0);
  const dailyRegimeFallbackStatus: DailyRegimeFallbackStatus = scannedUnknown === 0
    ? 'NO_UNKNOWN_SAMPLES'
    : missingRegimeSnapshotDates.length > 0
      ? 'NO_DAILY_SNAPSHOT_FOR_DATE'
      : dailyFallbackRecovered > 0
        ? 'USED_DAILY_FALLBACK'
        : 'OK';
  const priorityDateReconstructionStatus: PriorityDateReconstructionStatus = !reconstruction.attemptedDates.includes(REGIME_SNAPSHOT_RECONSTRUCTION_PRIORITY_DATE)
    ? 'NOT_ATTEMPTED'
    : reconstruction.succeededDates.includes(REGIME_SNAPSHOT_RECONSTRUCTION_PRIORITY_DATE)
      ? 'SUCCESS'
      : noReconstructionSourceDates.has(REGIME_SNAPSHOT_RECONSTRUCTION_PRIORITY_DATE)
        ? 'UNRECOVERABLE'
        : 'FAILED';
  const priorityDateFailureReason = priorityDateReconstructionStatus === 'SUCCESS'
    ? 'NONE'
    : priorityDateReconstructionStatus === 'UNRECOVERABLE'
      ? 'UNRECOVERABLE_MISSING_REGIME_SOURCE'
      : priorityDateReconstructionStatus === 'NOT_ATTEMPTED'
        ? 'NOT_ATTEMPTED'
        : 'TELEGRAM_ARCHIVE_PARSE_FAILED';
  const telegramArchiveParseFailureTopReasons = Object.entries(telegramArchiveParseFailureReasonCounts)
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
    .slice(0, 5)
    .map(([reason, count]) => `${reason}:${count}`);

  return {
    scannedUnknown,
    attemptedUnique,
    attemptedDuplicates,
    repaired,
    stillUnknown,
    byRecoveredRegime,
    recoverySourceBreakdown,
    recoveryConfidenceBreakdown,
    recoveredBySource,
    recoveredByConfidence,
    failedAfterDailyFallback: stillUnknown,
    failureReasonBreakdownAfterDailyFallback: failureReasonBreakdown,
    failureReasonBreakdown,
    failureBySourceLane,
    failureByTimestampSource,
    failureByTradingDate,
    snapshotCoverageByTradingDate,
    missingRegimeSnapshotDates,
    dailyRegimeFallbackStatus,
    snapshotReconstructionAttemptedDates: reconstruction.attemptedDates,
    snapshotReconstructionSucceededDates: reconstruction.succeededDates,
    snapshotReconstructionFailedDates: reconstruction.failedDates,
    snapshotReconstructionSourceBreakdown: reconstruction.sourceBreakdown,
    snapshotReconstructionConfidenceBreakdown: reconstruction.confidenceBreakdown,
    reconstructedDailySnapshots: reconstruction.snapshots,
    sourceInventoryByDate: sourceInventory.byDate,
    sourceInventoryTopAvailable: sourceInventory.topAvailable,
    sourceInventoryMissingSources: sourceInventory.missingSources,
    sourceInventoryAuditStatus: sourceInventory.auditStatus,
    snapshotReconstructionPriorityDate: REGIME_SNAPSHOT_RECONSTRUCTION_PRIORITY_DATE,
    priorityDateReconstructionStatus,
    priorityDateRecoveredSampleCount,
    priorityDateFailureReason,
    telegramArchiveCountByDate,
    telegramArchiveRegimePatternMatchedByDate,
    telegramArchiveEffectiveRegimeExtractedByDate,
    telegramArchiveRejectedNoRegimeByDate,
    telegramArchiveParseFailureTopReasons,
    priorityDateTelegramArchiveCount: telegramArchiveCountByDate[REGIME_SNAPSHOT_RECONSTRUCTION_PRIORITY_DATE] ?? 0,
    priorityDateRegimePatternMatched: telegramArchiveRegimePatternMatchedByDate[REGIME_SNAPSHOT_RECONSTRUCTION_PRIORITY_DATE] ?? 0,
    priorityDateEffectiveRegimeExtracted: telegramArchiveEffectiveRegimeExtractedByDate[REGIME_SNAPSHOT_RECONSTRUCTION_PRIORITY_DATE] ?? 0,
    priorityDateTelegramParseFailureReason: telegramArchiveParseFailureTopReasons[0]?.split(':')[0] ?? 'NONE',
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
