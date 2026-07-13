// @responsibility Twice-daily per-stock program-flow auto capture scheduler (diagnostic-only producer).
/**
 * Patch-PER-STOCK-PROGRAM-AUTO-CAPTURE-SCHEDULER-001
 *
 * Producer-only KIS stock program-flow population for latestIntradayProgramFlowSnapshot.
 * Invariants:
 * - diagnosticOnly=true / executionImpact=NONE
 * - no live decision, Strong Buy, FinalGate, order path, or normal_supply_preview provider call wiring
 * - raw KIS payload and sensitive data are never persisted; only sanitized snapshot rows are stored
 */

import fs from 'node:fs';
import path from 'node:path';
import { sendTelegramAlert } from '../alerts/telegramClient.js';
import { emitDiagnosticWarn } from '../observability/diagnosticWarn.js';
import { compactError, emitProviderWarn } from '../observability/providerWarn.js';
import { fetchKisStockProgramTrade } from '../clients/kisClient/index.js';
import { loadWatchlist, type WatchlistEntry } from '../persistence/watchlistRepo.js';
import { loadOpenPositions } from '../persistence/positionTruth.js';
import { REPLAY_DIR, ensureReplayDir } from '../persistence/paths.js';
import {
  buildIntradayProgramFlowSnapshotFromRuntimeContext,
  captureLatestIntradayProgramFlowSnapshotFromRuntimeContext,
  loadLatestIntradayProgramFlowSnapshot,
  saveLatestIntradayProgramFlowSnapshot,
  type IntradayProgramFlowSnapshot,
  type IntradayProgramFlowStockRow,
} from '../replay/intradayProgramFlowSnapshotRepo.js';
import { getEmergencyStop } from '../state.js';
import { classifyProgramFlowSession, type ProgramFlowMarketSession } from '../trading/signalScanner/programFlowSessionGuard.js';
import { getLastNormalSupplyPreview } from '../trading/signalScanner/normalSupplyPreview/previewStore.js';
import { scheduledJob } from './scheduleGuard.js';

type ProgramAutoCaptureSlot = 'MORNING' | 'AFTERNOON';
type ProgramAutoCaptureRunMode = 'DIAGNOSTIC_ONLY' | 'MANUAL_RUN_NOW';
type ProgramAutoCaptureMode = 'PRIORITY_ROTATION';
export type ProgramAutoCaptureTargetMode = 'DEFAULT' | 'BEARISH' | 'ACCUMULATING';
type ProgramDeltaDirection =
  | 'PROGRAM_BUY_ACCELERATING'
  | 'PROGRAM_BUY_DECELERATING'
  | 'PROGRAM_SELL_ACCELERATING'
  | 'PROGRAM_SELL_DECELERATING'
  | 'PROGRAM_REVERSAL_TO_BUY'
  | 'PROGRAM_REVERSAL_TO_SELL'
  | 'PROGRAM_STABLE';

export interface ProgramAutoCaptureRunOptions {
  limit?: number;
  targetMode?: ProgramAutoCaptureTargetMode;
  runMode?: ProgramAutoCaptureRunMode;
  minIntervalMsOverride?: number;
}

export interface ProgramManualCaptureAvailability {
  manualRunAvailable: boolean;
  manualRunBlockedReason?: string;
  currentSession: ProgramFlowMarketSession;
  currentKstTime: string;
  currentWindowAllowed: boolean;
  executionImpact: 'NONE';
}

export interface ProgramAutoCaptureStatus {
  schedulerEnabled: boolean;
  disabled: boolean;
  mode: ProgramAutoCaptureMode;
  watchlistTargetSize: number;
  watchlistSize: number;
  todayCoverage: number;
  morningCoverage: number;
  afternoonCoverage: number;
  dailyProviderCalls: number;
  dailyProviderHardCap: number;
  providerCallLimitPerRun: number;
  providerHardCapPerRun: number;
  lastMorningCaptureAt?: string;
  lastAfternoonCaptureAt?: string;
  lastCapturedCount: number;
  lastFailedCount: number;
  latestSnapshotRowsWithValue: number;
  nextScheduledCapture?: string;
  lastRun?: ProgramAutoCaptureRunSummary;
  failureCooldownBySymbol: Record<string, string>;
  completedSlots: Record<string, string[]>;
  manualCooldownBySymbolSlot: Record<string, string>;
  dailyProviderCallsByDate: Record<string, number>;
  executionImpact: 'NONE';
}

export interface ProgramAutoCaptureRunSummary {
  slot: ProgramAutoCaptureSlot;
  marketDate: string;
  startedAt: string;
  finishedAt: string;
  mode: ProgramAutoCaptureMode;
  runMode: ProgramAutoCaptureRunMode;
  limit: number;
  providerHardCapPerRun: number;
  dailyProviderHardCap: number;
  targetMode: ProgramAutoCaptureTargetMode;
  session: ProgramFlowMarketSession;
  kstTime: string;
  watchlistSize: number;
  watchlistTargetSize: number;
  target: number;
  captured: number;
  emptyValid: number;
  failed: number;
  skipped: number;
  cooldownSkipped: number;
  providerCallsAdded: number;
  dailyProviderCalls: number;
  todayCoverage: number;
  morningCoverage: number;
  afternoonCoverage: number;
  newlyCaptured: number;
  recaptured: number;
  remainingNotCaptured: number;
  snapshotRowsWithValue: number;
  executionImpact: 'NONE';
  liveDecision: false;
  programFlowUsedForLiveDecision: false;
  passiveProxyUsedForLiveDecision: false;
  strongBuyAllowed: false;
  programPenaltyApplied: false;
  programMissingAsBearish: false;
  deltas: ProgramAutoCaptureDelta[];
  topProgramBuy: Array<{ symbol: string; name?: string; programNetBuyAmount: number }>;
  topProgramSell: Array<{ symbol: string; name?: string; programNetBuyAmount: number }>;
}

interface ProgramAutoCaptureDelta {
  symbol: string;
  previousSlotValue: number | null;
  currentSlotValue: number | null;
  deltaProgramNetBuyAmount: number | null;
  deltaDirection: ProgramDeltaDirection;
  diagnosticOnly: true;
  executionImpact: 'NONE';
}

const DEFAULT_WATCHLIST_TARGET_SIZE = 50;
const DEFAULT_LIMIT = 30;
const DEFAULT_MAX_LIMIT = 50;
const DEFAULT_DAILY_HARD_CAP = 100;
const DEFAULT_MIN_INTERVAL_MS = 400;
const FAILURE_COOLDOWN_MS = 10 * 60 * 1000;
const MANUAL_RUN_TTL_MS = 5 * 60 * 1000;
const STATUS_FILE = path.join(REPLAY_DIR, 'program-auto-capture-status.json');

function envFlag(key: string): boolean {
  return process.env[key] === 'true';
}

function isProgramAutoCaptureDisabled(): boolean {
  if (envFlag('PROGRAM_AUTO_CAPTURE_DISABLED')) return true;
  return process.env.PROGRAM_AUTO_CAPTURE_ENABLED !== 'true';
}

function configuredMode(): ProgramAutoCaptureMode {
  return process.env.PROGRAM_AUTO_CAPTURE_MODE === 'PRIORITY_ROTATION'
    ? 'PRIORITY_ROTATION'
    : 'PRIORITY_ROTATION';
}

function configuredWatchlistTargetSize(): number {
  const raw = Number.parseInt(process.env.PROGRAM_AUTO_CAPTURE_WATCHLIST_TARGET_SIZE ?? String(DEFAULT_WATCHLIST_TARGET_SIZE), 10);
  return Number.isFinite(raw) ? Math.max(1, Math.min(DEFAULT_WATCHLIST_TARGET_SIZE, raw)) : DEFAULT_WATCHLIST_TARGET_SIZE;
}

function configuredProviderHardCapPerRun(): number {
  const raw = Number.parseInt(process.env.PROGRAM_AUTO_CAPTURE_MAX_LIMIT ?? String(DEFAULT_MAX_LIMIT), 10);
  return Number.isFinite(raw) ? Math.max(1, Math.min(DEFAULT_MAX_LIMIT, raw)) : DEFAULT_MAX_LIMIT;
}

function configuredDailyHardCap(): number {
  const raw = Number.parseInt(process.env.PROGRAM_AUTO_CAPTURE_DAILY_HARD_CAP ?? String(DEFAULT_DAILY_HARD_CAP), 10);
  return Number.isFinite(raw) ? Math.max(1, Math.min(DEFAULT_DAILY_HARD_CAP, raw)) : DEFAULT_DAILY_HARD_CAP;
}

function normalizeCaptureLimit(value: unknown, fallback = DEFAULT_LIMIT): number {
  const parsed = Number.parseInt(String(value ?? ''), 10);
  const base = Number.isFinite(parsed) ? parsed : fallback;
  return Math.max(1, Math.min(configuredProviderHardCapPerRun(), base));
}

function configuredLimit(): number {
  const limitRaw = Number.parseInt(process.env.PROGRAM_AUTO_CAPTURE_LIMIT ?? String(DEFAULT_LIMIT), 10);
  const limit = Number.isFinite(limitRaw) ? Math.max(1, limitRaw) : DEFAULT_LIMIT;
  return Math.min(configuredProviderHardCapPerRun(), limit);
}

function minIntervalMs(): number {
  const raw = Number.parseInt(process.env.PROGRAM_AUTO_CAPTURE_MIN_INTERVAL_MS ?? String(DEFAULT_MIN_INTERVAL_MS), 10);
  if (!Number.isFinite(raw)) return DEFAULT_MIN_INTERVAL_MS;
  return Math.max(DEFAULT_MIN_INTERVAL_MS, Math.min(1_000, raw));
}

function statusFilePath(): string {
  return process.env.PROGRAM_AUTO_CAPTURE_STATUS_FILE
    ? path.resolve(process.env.PROGRAM_AUTO_CAPTURE_STATUS_FILE)
    : STATUS_FILE;
}

function emptyStatus(now = new Date()): ProgramAutoCaptureStatus {
  return refreshProgramAutoCaptureStatusCoverage({
    schedulerEnabled: !isProgramAutoCaptureDisabled(),
    disabled: isProgramAutoCaptureDisabled(),
    mode: configuredMode(),
    watchlistTargetSize: configuredWatchlistTargetSize(),
    watchlistSize: 0,
    todayCoverage: 0,
    morningCoverage: 0,
    afternoonCoverage: 0,
    dailyProviderCalls: 0,
    dailyProviderHardCap: configuredDailyHardCap(),
    providerCallLimitPerRun: configuredLimit(),
    providerHardCapPerRun: configuredProviderHardCapPerRun(),
    lastCapturedCount: 0,
    lastFailedCount: 0,
    latestSnapshotRowsWithValue: loadLatestIntradayProgramFlowSnapshot()?.summary.stockRowsWithProgramValue ?? 0,
    nextScheduledCapture: computeNextProgramAutoCaptureKst(now),
    failureCooldownBySymbol: {},
    completedSlots: {},
    manualCooldownBySymbolSlot: {},
    dailyProviderCallsByDate: {},
    executionImpact: 'NONE',
  }, now);
}

export function loadProgramAutoCaptureStatus(now = new Date()): ProgramAutoCaptureStatus {
  ensureReplayDir();
  try {
    const filePath = statusFilePath();
    if (!fs.existsSync(filePath)) return emptyStatus(now);
    const parsed = JSON.parse(fs.readFileSync(filePath, 'utf-8')) as Partial<ProgramAutoCaptureStatus>;
    return refreshProgramAutoCaptureStatusCoverage({
      ...emptyStatus(now),
      ...parsed,
      schedulerEnabled: !isProgramAutoCaptureDisabled(),
      disabled: isProgramAutoCaptureDisabled(),
      mode: configuredMode(),
      latestSnapshotRowsWithValue: loadLatestIntradayProgramFlowSnapshot()?.summary.stockRowsWithProgramValue ?? parsed.latestSnapshotRowsWithValue ?? 0,
      nextScheduledCapture: computeNextProgramAutoCaptureKst(now),
      failureCooldownBySymbol: parsed.failureCooldownBySymbol ?? {},
      completedSlots: parsed.completedSlots ?? {},
      manualCooldownBySymbolSlot: parsed.manualCooldownBySymbolSlot ?? {},
      dailyProviderCallsByDate: parsed.dailyProviderCallsByDate ?? {},
      dailyProviderHardCap: configuredDailyHardCap(),
      providerCallLimitPerRun: configuredLimit(),
      providerHardCapPerRun: configuredProviderHardCapPerRun(),
      executionImpact: 'NONE',
    }, now);
  } catch {
    return emptyStatus(now);
  }
}

function saveProgramAutoCaptureStatus(status: ProgramAutoCaptureStatus, now = new Date()): ProgramAutoCaptureStatus {
  ensureReplayDir();
  const filePath = statusFilePath();
  const sanitized: ProgramAutoCaptureStatus = refreshProgramAutoCaptureStatusCoverage({
    ...status,
    mode: configuredMode(),
    dailyProviderHardCap: configuredDailyHardCap(),
    providerCallLimitPerRun: configuredLimit(),
    providerHardCapPerRun: configuredProviderHardCapPerRun(),
    executionImpact: 'NONE',
  }, now);
  fs.writeFileSync(`${filePath}.tmp`, JSON.stringify(sanitized, null, 2));
  fs.renameSync(`${filePath}.tmp`, filePath);
  return sanitized;
}

function kstParts(now: Date): { marketDate: string; time: string; minutes: number } {
  const kst = new Date(now.getTime() + 9 * 60 * 60 * 1000);
  const marketDate = kst.toISOString().slice(0, 10);
  const hh = kst.getUTCHours();
  const mm = kst.getUTCMinutes();
  return { marketDate, time: `${String(hh).padStart(2, '0')}:${String(mm).padStart(2, '0')}`, minutes: hh * 60 + mm };
}

function currentWatchlistSymbols(): Set<string> {
  const symbols = new Set<string>();
  for (const entry of loadWatchlist()) {
    const symbol = normalizeSymbol((entry as unknown as Record<string, unknown>).code ?? (entry as unknown as Record<string, unknown>).stockCode ?? (entry as unknown as Record<string, unknown>).symbol);
    if (symbol) symbols.add(symbol);
  }
  return symbols;
}

function symbolsForSlot(status: Pick<ProgramAutoCaptureStatus, 'completedSlots'>, marketDate: string, slot: ProgramAutoCaptureSlot): Set<string> {
  return new Set(status.completedSlots[completedKey(marketDate, slot)] ?? []);
}

function symbolsCapturedToday(status: Pick<ProgramAutoCaptureStatus, 'completedSlots'>, marketDate: string): Set<string> {
  return new Set([
    ...symbolsForSlot(status, marketDate, 'MORNING'),
    ...symbolsForSlot(status, marketDate, 'AFTERNOON'),
  ]);
}

function countWatchlistIntersection(symbols: Set<string>, watchlistSymbols: Set<string>): number {
  let count = 0;
  for (const symbol of symbols) if (watchlistSymbols.has(symbol)) count += 1;
  return count;
}

function refreshProgramAutoCaptureStatusCoverage(
  status: ProgramAutoCaptureStatus,
  now: Date,
): ProgramAutoCaptureStatus {
  const { marketDate } = kstParts(now);
  const watchlistSymbols = currentWatchlistSymbols();
  const morningSymbols = symbolsForSlot(status, marketDate, 'MORNING');
  const afternoonSymbols = symbolsForSlot(status, marketDate, 'AFTERNOON');
  const todaySymbols = symbolsCapturedToday(status, marketDate);
  const dailyProviderCallsByDate = status.dailyProviderCallsByDate ?? {};
  const dailyProviderCalls = dailyProviderCallsByDate[marketDate] ?? status.dailyProviderCalls ?? 0;
  return {
    ...status,
    mode: configuredMode(),
    watchlistTargetSize: configuredWatchlistTargetSize(),
    watchlistSize: watchlistSymbols.size,
    todayCoverage: countWatchlistIntersection(todaySymbols, watchlistSymbols),
    morningCoverage: countWatchlistIntersection(morningSymbols, watchlistSymbols),
    afternoonCoverage: countWatchlistIntersection(afternoonSymbols, watchlistSymbols),
    dailyProviderCalls,
    dailyProviderCallsByDate,
    dailyProviderHardCap: configuredDailyHardCap(),
    providerCallLimitPerRun: configuredLimit(),
    providerHardCapPerRun: configuredProviderHardCapPerRun(),
    executionImpact: 'NONE',
  };
}

function computeNextProgramAutoCaptureKst(now = new Date()): string {
  const morning = process.env.PROGRAM_AUTO_CAPTURE_MORNING_KST ?? '09:20';
  const afternoon = process.env.PROGRAM_AUTO_CAPTURE_AFTERNOON_KST ?? '13:40';
  const { marketDate, minutes } = kstParts(now);
  const [mh, mm] = morning.split(':').map(Number);
  const [ah, am] = afternoon.split(':').map(Number);
  const morningMinutes = mh * 60 + mm;
  const afternoonMinutes = ah * 60 + am;
  if (minutes < morningMinutes) return `${marketDate} ${morning} KST`;
  if (minutes < afternoonMinutes) return `${marketDate} ${afternoon} KST`;
  return `next trading day ${morning} KST`;
}

function normalizeSymbol(value: unknown): string | null {
  const digits = String(value ?? '').replace(/[^0-9]/g, '');
  if (!digits) return null;
  const symbol = digits.slice(-6).padStart(6, '0');
  return /^\d{6}$/.test(symbol) ? symbol : null;
}

function numeric(value: unknown): number {
  const n = Number(value);
  return Number.isFinite(n) ? n : 0;
}

function scoreWatchlist(entry: WatchlistEntry): number {
  const anyEntry = entry as unknown as Record<string, unknown>;
  return Math.max(
    numeric(anyEntry.watchlistPriorityBoost),
    numeric(entry.watchlistPriorityScore),
    numeric(entry.stage2Score),
    numeric(entry.totalGateScore),
    numeric(entry.gateScore),
    numeric(entry.symbolFeatures?.watchlistPriorityScore),
    numeric(entry.symbolFeatures?.stage2Score),
    numeric(entry.symbolFeatures?.gateScore),
  );
}

function classifySupplyBucket(value: unknown): string {
  return String(value ?? '').toUpperCase();
}

function targetModeBoost(bucket: string, targetMode: ProgramAutoCaptureTargetMode): number {
  if (targetMode === 'BEARISH' && bucket.includes('BEARISH')) return 5000;
  if (targetMode === 'ACCUMULATING' && bucket.includes('ACCUMULATING')) return 5000;
  return 0;
}

interface ProgramAutoCaptureTarget {
  symbol: string;
  name?: string;
  rank: number;
  reasons: string[];
  alreadyCapturedToday: boolean;
  recaptureAllowed: boolean;
}

interface ProgramAutoCaptureTargetSelectionOptions {
  targetMode?: ProgramAutoCaptureTargetMode;
  slot?: ProgramAutoCaptureSlot;
  status?: ProgramAutoCaptureStatus;
  marketDate?: string;
  previousSnapshot?: IntradayProgramFlowSnapshot | null;
}

function recordSignals(record: Record<string, unknown>): {
  bucket: string;
  supplyScore: number;
  foreignNetBuy: number;
  institutionNetBuy: number;
  priorityBoost: number;
  shadowTracking: boolean;
  highVolatility: boolean;
  activePassiveConfirmed: boolean;
} {
  const bucket = classifySupplyBucket(
    record.supplySignal
      ?? record.supplyBucket
      ?? record.supplyStatus
      ?? record.semanticSignal
      ?? record.signal
      ?? record.state,
  );
  const supplyScore = numeric(record.supplyScore ?? record.supplyConfluenceScore ?? record.totalSmartMoneyNetBuy);
  const foreignNetBuy = numeric(record.foreignNetBuy ?? record.foreignNetBuyAmount ?? record.foreign);
  const institutionNetBuy = numeric(record.institutionNetBuy ?? record.institutionNetBuyAmount ?? record.institution);
  const priorityBoost = numeric(record.watchlistPriorityBoost ?? record.watchlistPriorityScore);
  const volatility = Math.max(
    Math.abs(numeric(record.volatility)),
    Math.abs(numeric(record.atrPct)),
    Math.abs(numeric(record.atrRate)),
    Math.abs(numeric((record.symbolFeatures as Record<string, unknown> | undefined)?.atrPct)),
  );
  return {
    bucket,
    supplyScore,
    foreignNetBuy,
    institutionNetBuy,
    priorityBoost,
    shadowTracking: record.shadowTracking === true,
    highVolatility: volatility >= 5,
    activePassiveConfirmed: bucket.includes('ACTIVE') || bucket.includes('PASSIVE') || bucket.includes('CONFIRMED'),
  };
}

function addSignalReasons(
  row: { rank: number; reasons: Set<string> },
  signals: ReturnType<typeof recordSignals>,
  targetMode: ProgramAutoCaptureTargetMode,
): void {
  if (signals.bucket.includes('BEARISH')) {
    row.rank += 900_000 + targetModeBoost(signals.bucket, targetMode);
    row.reasons.add('BEARISH');
  }
  if (signals.bucket.includes('ACCUMULATING')) {
    row.rank += 800_000 + targetModeBoost(signals.bucket, targetMode);
    row.reasons.add('ACCUMULATING');
  }
  if (signals.foreignNetBuy !== 0 && signals.institutionNetBuy !== 0 && Math.sign(signals.foreignNetBuy) === Math.sign(signals.institutionNetBuy)) {
    row.rank += 700_000 + Math.min(99_999, Math.abs(signals.foreignNetBuy) + Math.abs(signals.institutionNetBuy));
    row.reasons.add('DUAL_ACTIVE_FLOW');
  }
  if (Math.abs(signals.supplyScore) >= 70) {
    row.rank += 600_000 + Math.min(99_999, Math.abs(signals.supplyScore));
    row.reasons.add('SUPPLY_SCORE_EXTREME');
  }
  if (signals.shadowTracking) {
    row.rank += 500_000;
    row.reasons.add('SHADOW_TRACKING');
  }
  if (signals.priorityBoost > 0) {
    row.rank += 400_000 + Math.min(99_999, signals.priorityBoost);
    row.reasons.add('WATCHLIST_PRIORITY_BOOST');
  }
  if (signals.activePassiveConfirmed) {
    row.rank += 250_000;
    row.reasons.add('ACTIVE_PASSIVE_CONFIRMED');
  }
  if (signals.highVolatility) {
    row.rank += 200_000;
    row.reasons.add('HIGH_VOLATILITY');
  }
}

function previousExtremeSymbols(snapshot: IntradayProgramFlowSnapshot | null | undefined): Set<string> {
  return new Set((snapshot?.stockRows ?? [])
    .filter((row) => typeof row.programNetBuyAmount === 'number')
    .sort((a, b) => Math.abs((b.programNetBuyAmount as number) ?? 0) - Math.abs((a.programNetBuyAmount as number) ?? 0))
    .slice(0, 10)
    .map((row) => row.symbol));
}

function previousDeltaExtremeSymbols(status: ProgramAutoCaptureStatus | undefined): Set<string> {
  return new Set((status?.lastRun?.deltas ?? [])
    .filter((delta) => typeof delta.deltaProgramNetBuyAmount === 'number')
    .sort((a, b) => Math.abs((b.deltaProgramNetBuyAmount as number) ?? 0) - Math.abs((a.deltaProgramNetBuyAmount as number) ?? 0))
    .slice(0, 10)
    .map((delta) => delta.symbol));
}

function selectProgramAutoCaptureTargets(
  limit = configuredLimit(),
  options: ProgramAutoCaptureTargetSelectionOptions = {},
): ProgramAutoCaptureTarget[] {
  const targetMode = options.targetMode ?? 'DEFAULT';
  const slot = options.slot ?? 'MORNING';
  const status = options.status;
  const marketDate = options.marketDate ?? kstParts(new Date()).marketDate;
  const watchlist = loadWatchlist();
  const openPositions = loadOpenPositions();
  const latestPreview = getLastNormalSupplyPreview();
  const previousSnapshot = options.previousSnapshot ?? loadLatestIntradayProgramFlowSnapshot();
  const previousExtremes = previousExtremeSymbols(previousSnapshot);
  const deltaExtremes = previousDeltaExtremeSymbols(status);
  const capturedToday = status ? symbolsCapturedToday(status, marketDate) : new Set<string>();
  const sameSlotCaptured = status ? symbolsForSlot(status, marketDate, slot) : new Set<string>();
  const bySymbol = new Map<string, { symbol: string; name?: string; rank: number; seq: number; reasons: Set<string> }>();
  let seq = 0;
  const add = (symbolRaw: unknown, name: unknown, rank: number, reasons: string[] = []): void => {
    const symbol = normalizeSymbol(symbolRaw);
    if (!symbol) return;
    const current = bySymbol.get(symbol);
    const row = current ?? { symbol, name: typeof name === 'string' ? name : undefined, rank: 0, seq: seq++, reasons: new Set<string>() };
    row.rank = Math.max(row.rank, rank);
    if (!row.name && typeof name === 'string') row.name = name;
    for (const reason of reasons) row.reasons.add(reason);
    bySymbol.set(symbol, row);
  };

  for (const p of openPositions) add(p.stockCode, p.stockName, 1_000_000, ['HELD_POSITION']);

  for (const entry of watchlist) {
    const anyEntry = entry as unknown as Record<string, unknown>;
    const symbol = normalizeSymbol(anyEntry.code ?? anyEntry.stockCode ?? anyEntry.symbol);
    if (!symbol) continue;
    add(symbol, anyEntry.name ?? anyEntry.stockName, scoreWatchlist(entry), ['WATCHLIST']);
    const row = bySymbol.get(symbol);
    if (row) addSignalReasons(row, recordSignals(anyEntry), targetMode);
  }

  const previewCandidates = Array.isArray((latestPreview as unknown as { candidates?: unknown[] } | null)?.candidates)
    ? ((latestPreview as unknown as { candidates: unknown[] }).candidates)
    : [];
  for (const item of previewCandidates) {
    const record = item as Record<string, unknown>;
    const symbol = normalizeSymbol(record.symbol ?? record.code ?? record.stockCode);
    if (!symbol) continue;
    add(
      symbol,
      record.name ?? record.stockName,
      300_000 + numeric(record.supplyScore),
      ['LATEST_PREVIEW_CANDIDATE'],
    );
    const row = bySymbol.get(symbol);
    if (row) addSignalReasons(row, recordSignals(record), targetMode);
  }

  for (const [symbol, row] of bySymbol) {
    if (previousExtremes.has(symbol)) {
      row.rank += 350_000;
      row.reasons.add('PREVIOUS_PROGRAM_FLOW_EXTREME');
    }
    if (deltaExtremes.has(symbol)) {
      row.rank += 300_000;
      row.reasons.add('PREVIOUS_SLOT_DELTA_ABS_TOP');
    }
    if (!capturedToday.has(symbol)) {
      row.rank += slot === 'AFTERNOON' ? 2_000_000 : 100_000;
      row.reasons.add('NOT_CAPTURED_TODAY');
    }
  }

  const normalizedLimit = normalizeCaptureLimit(limit, configuredLimit());
  const rows = [...bySymbol.values()]
    .filter((row) => !sameSlotCaptured.has(row.symbol))
    .map((row): ProgramAutoCaptureTarget => {
      const alreadyCapturedToday = capturedToday.has(row.symbol);
      const recaptureAllowed = row.reasons.has('HELD_POSITION')
        || row.reasons.has('PREVIOUS_PROGRAM_FLOW_EXTREME')
        || row.reasons.has('PREVIOUS_SLOT_DELTA_ABS_TOP')
        || row.reasons.has('ACTIVE_PASSIVE_CONFIRMED')
        || row.reasons.has('HIGH_VOLATILITY')
        || row.reasons.has('SHADOW_TRACKING');
      return {
        symbol: row.symbol,
        name: row.name,
        rank: row.rank,
        reasons: [...row.reasons].sort(),
        alreadyCapturedToday,
        recaptureAllowed,
      };
    });

  const byRank = (a: ProgramAutoCaptureTarget, b: ProgramAutoCaptureTarget): number =>
    b.rank - a.rank || a.symbol.localeCompare(b.symbol);
  if (slot !== 'AFTERNOON') {
    return rows.sort(byRank).slice(0, normalizedLimit);
  }

  const held = rows.filter((row) => row.reasons.includes('HELD_POSITION')).sort(byRank);
  const notCaptured = rows
    .filter((row) => !row.alreadyCapturedToday && !row.reasons.includes('HELD_POSITION'))
    .sort(byRank);
  const recapture = rows
    .filter((row) => row.alreadyCapturedToday && row.recaptureAllowed && !row.reasons.includes('HELD_POSITION'))
    .sort(byRank);
  const selected = new Map<string, ProgramAutoCaptureTarget>();
  for (const group of [held, notCaptured, recapture]) {
    for (const row of group) {
      if (selected.size >= normalizedLimit) break;
      selected.set(row.symbol, row);
    }
    if (selected.size >= normalizedLimit) break;
  }
  return [...selected.values()];
}

function isInFailureCooldown(symbol: string, status: ProgramAutoCaptureStatus, now: Date): boolean {
  const until = status.failureCooldownBySymbol[symbol];
  return Boolean(until && Date.parse(until) > now.getTime());
}

function completedKey(marketDate: string, slot: ProgramAutoCaptureSlot): string {
  return `${marketDate}:${slot}`;
}

function manualCooldownKey(marketDate: string, slot: ProgramAutoCaptureSlot, symbol: string): string {
  return `${marketDate}:${slot}:${symbol}`;
}

function hasCompletedSlotSymbol(status: ProgramAutoCaptureStatus, marketDate: string, slot: ProgramAutoCaptureSlot, symbol: string): boolean {
  return (status.completedSlots[completedKey(marketDate, slot)] ?? []).includes(symbol);
}

function isInManualCooldown(status: ProgramAutoCaptureStatus, marketDate: string, slot: ProgramAutoCaptureSlot, symbol: string, now: Date): boolean {
  const until = status.manualCooldownBySymbolSlot[manualCooldownKey(marketDate, slot, symbol)];
  return Boolean(until && Date.parse(until) > now.getTime());
}

function markCompletedSlotSymbols(status: ProgramAutoCaptureStatus, marketDate: string, slot: ProgramAutoCaptureSlot, symbols: string[]): void {
  const key = completedKey(marketDate, slot);
  status.completedSlots[key] = [...new Set([...(status.completedSlots[key] ?? []), ...symbols])].sort();
}

function markManualCooldownSymbols(status: ProgramAutoCaptureStatus, marketDate: string, slot: ProgramAutoCaptureSlot, symbols: string[], now: Date): void {
  const until = new Date(now.getTime() + MANUAL_RUN_TTL_MS).toISOString();
  for (const symbol of symbols) status.manualCooldownBySymbolSlot[manualCooldownKey(marketDate, slot, symbol)] = until;
}

function classifyDelta(previous: number | null, current: number | null): ProgramDeltaDirection {
  if (previous === null || current === null || Math.abs(current - previous) < 1) return 'PROGRAM_STABLE';
  if (previous < 0 && current > 0) return 'PROGRAM_REVERSAL_TO_BUY';
  if (previous > 0 && current < 0) return 'PROGRAM_REVERSAL_TO_SELL';
  if (current > 0 && previous >= 0) return current > previous ? 'PROGRAM_BUY_ACCELERATING' : 'PROGRAM_BUY_DECELERATING';
  if (current < 0 && previous <= 0) return current < previous ? 'PROGRAM_SELL_ACCELERATING' : 'PROGRAM_SELL_DECELERATING';
  return 'PROGRAM_STABLE';
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function stockRowHasProgramValue(row: IntradayProgramFlowStockRow): boolean {
  return typeof row.programNetBuyAmount === 'number'
    || typeof row.programBuyAmount === 'number'
    || typeof row.programSellAmount === 'number'
    || typeof row.programNetVolume === 'number'
    || typeof row.programNetValue === 'number';
}

function saveProgramAutoCaptureRows(rows: Array<Record<string, unknown>>, now: Date): IntradayProgramFlowSnapshot | null {
  const captureResult = captureLatestIntradayProgramFlowSnapshotFromRuntimeContext({ stockRows: rows }, now);
  if (captureResult.snapshot) return captureResult.snapshot;

  const incoming = buildIntradayProgramFlowSnapshotFromRuntimeContext({ stockRows: rows }, now);
  const existing = loadLatestIntradayProgramFlowSnapshot();
  if (!existing) return saveLatestIntradayProgramFlowSnapshot(incoming);
  const stockRowsBySymbol = new Map<string, IntradayProgramFlowStockRow>();
  for (const row of existing.stockRows) stockRowsBySymbol.set(row.symbol, row);
  for (const row of incoming.stockRows) {
    const current = stockRowsBySymbol.get(row.symbol);
    if (!current || stockRowHasProgramValue(row) || !stockRowHasProgramValue(current)) stockRowsBySymbol.set(row.symbol, row);
  }
  return saveLatestIntradayProgramFlowSnapshot({
    ...incoming,
    stockRows: [...stockRowsBySymbol.values()],
    marketProgram: incoming.marketProgram.available || !existing.marketProgram.available ? incoming.marketProgram : existing.marketProgram,
  });
}

export function resolveProgramAutoCaptureManualAvailability(now = new Date()): ProgramManualCaptureAvailability {
  const guard = classifyProgramFlowSession(now);
  let manualRunBlockedReason: string | undefined;
  if (isProgramAutoCaptureDisabled()) manualRunBlockedReason = 'PROGRAM_AUTO_CAPTURE_DISABLED';
  else if (getEmergencyStop()) manualRunBlockedReason = 'HARD_BLOCK';
  else if (!guard.isTradingDay) manualRunBlockedReason = `NON_TRADING_DAY:${guard.marketSession}`;
  else if (guard.marketSession !== 'REGULAR_SESSION' || !guard.programFlowExpected) {
    manualRunBlockedReason = `SESSION_BLOCKED:${guard.marketSession}`;
  }
  const currentWindowAllowed = guard.isTradingDay && guard.marketSession === 'REGULAR_SESSION' && guard.programFlowExpected;
  return {
    manualRunAvailable: manualRunBlockedReason === undefined,
    manualRunBlockedReason,
    currentSession: guard.marketSession,
    currentKstTime: guard.kstTime,
    currentWindowAllowed,
    executionImpact: 'NONE',
  };
}

function resolveProgramAutoCaptureSlotForNow(now = new Date()): ProgramAutoCaptureSlot {
  return kstParts(now).minutes < 12 * 60 ? 'MORNING' : 'AFTERNOON';
}

export async function runProgramAutoCaptureManual(
  options: Omit<ProgramAutoCaptureRunOptions, 'runMode'> = {},
  now = new Date(),
): Promise<ProgramAutoCaptureRunSummary> {
  const availability = resolveProgramAutoCaptureManualAvailability(now);
  if (!availability.manualRunAvailable) {
    throw new Error(`PROGRAM_CAPTURE_MANUAL_BLOCKED:${availability.manualRunBlockedReason ?? 'UNKNOWN'}`);
  }
  return runProgramAutoCapture(resolveProgramAutoCaptureSlotForNow(now), now, {
    ...options,
    runMode: 'MANUAL_RUN_NOW',
  });
}

function isKisThrottleOrCircuitBreaker(error: unknown): boolean {
  const message = String(error instanceof Error ? error.message : error).toLowerCase();
  return message.includes('429')
    || message.includes('rate limit')
    || message.includes('throttle')
    || message.includes('circuit')
    || message.includes('blacklist')
    || message.includes('too many');
}

async function runProgramAutoCapture(
  slot: ProgramAutoCaptureSlot,
  now = new Date(),
  options: ProgramAutoCaptureRunOptions = {},
): Promise<ProgramAutoCaptureRunSummary> {
  const startedAt = now.toISOString();
  const guard = classifyProgramFlowSession(now);
  const { marketDate } = kstParts(now);
  const status = loadProgramAutoCaptureStatus(now);
  const runMode = options.runMode ?? 'DIAGNOSTIC_ONLY';
  const requestedLimit = normalizeCaptureLimit(options.limit ?? configuredLimit(), configuredLimit());
  const dailyProviderHardCap = configuredDailyHardCap();
  const providerHardCapPerRun = configuredProviderHardCapPerRun();
  const dailyCallsBefore = status.dailyProviderCallsByDate[marketDate] ?? status.dailyProviderCalls ?? 0;
  const remainingDailyCalls = Math.max(0, dailyProviderHardCap - dailyCallsBefore);
  const limit = Math.min(requestedLimit, providerHardCapPerRun, remainingDailyCalls);
  const targetMode = options.targetMode ?? 'DEFAULT';

  if (isProgramAutoCaptureDisabled()) throw new Error('PROGRAM_AUTO_CAPTURE_DISABLED');
  if (getEmergencyStop()) throw new Error('HARD_BLOCK_EMERGENCY_STOP_SKIP');
  if (!guard.isTradingDay || guard.marketSession !== 'REGULAR_SESSION' || !guard.programFlowExpected) {
    throw new Error(`PROGRAM_CAPTURE_SESSION_BLOCKED:${guard.marketSession}`);
  }

  const previousSnapshot = loadLatestIntradayProgramFlowSnapshot();
  const previousBySymbol = new Map<string, IntradayProgramFlowStockRow>();
  for (const row of previousSnapshot?.stockRows ?? []) previousBySymbol.set(row.symbol, row);

  const coverageBefore = symbolsCapturedToday(status, marketDate);
  const watchlistSymbols = currentWatchlistSymbols();
  const allTargets = limit > 0
    ? selectProgramAutoCaptureTargets(limit, { targetMode, slot, status, marketDate, previousSnapshot })
    : [];
  let completedSlotSkipped = 0;
  let cooldownSkipped = 0;
  const targets = allTargets
    .filter((t) => {
      if (hasCompletedSlotSymbol(status, marketDate, slot, t.symbol)) {
        completedSlotSkipped += 1;
        return false;
      }
      return true;
    })
    .filter((t) => {
      if (runMode === 'MANUAL_RUN_NOW' && isInManualCooldown(status, marketDate, slot, t.symbol, now)) {
        cooldownSkipped += 1;
        return false;
      }
      if (isInFailureCooldown(t.symbol, status, now)) {
        cooldownSkipped += 1;
        return false;
      }
      return true;
    });

  const rows: Array<Record<string, unknown>> = [];
  const deltas: ProgramAutoCaptureDelta[] = [];
  let providerCallsAdded = 0;
  let captured = 0;
  let emptyValid = 0;
  let failed = 0;
  const failedSymbols: string[] = [];
  const attemptedSymbols: string[] = [];
  let providerAbortReason = '';

  for (const target of targets) {
    providerCallsAdded += 1;
    attemptedSymbols.push(target.symbol);
    let data: Awaited<ReturnType<typeof fetchKisStockProgramTrade>> | null = null;
    try {
      data = await fetchKisStockProgramTrade(target.symbol, 'LOW');
    } catch (error) {
      failed += 1;
      failedSymbols.push(target.symbol);
      status.failureCooldownBySymbol[target.symbol] = new Date(now.getTime() + FAILURE_COOLDOWN_MS).toISOString();
      if (isKisThrottleOrCircuitBreaker(error)) {
        providerAbortReason = error instanceof Error ? error.message : String(error);
        emitProviderWarn({ source: 'KIS_AUX', code: 'P2_SCHEDULER_DIAGNOSTIC_DEGRADED', message: 'Program auto-capture provider circuit/throttle abort.', dedupKey: `p2:provider:KIS_AUX:program-autocapture-abort:${target.symbol}`, fallbackUsed: true, details: { symbol: target.symbol, reason: providerAbortReason } });
        break;
      }
      emitProviderWarn({ source: 'KIS_AUX', code: 'P2_SCHEDULER_DIAGNOSTIC_DEGRADED', message: 'Program auto-capture provider failure.', dedupKey: `p2:provider:KIS_AUX:program-autocapture-failure:${target.symbol}`, fallbackUsed: true, details: { symbol: target.symbol, compactError: compactError(error) } });
    }

    if (!data) {
      if (!failedSymbols.includes(target.symbol)) {
        failed += 1;
        failedSymbols.push(target.symbol);
        status.failureCooldownBySymbol[target.symbol] = new Date(now.getTime() + FAILURE_COOLDOWN_MS).toISOString();
      }
    } else {
      const current = data.programNetBuyAmount ?? null;
      if (current === null) emptyValid += 1;
      else captured += 1;
      rows.push({
        symbol: data.stockCode,
        normalizedSymbol: data.stockCode,
        name: target.name,
        programNetBuyAmount: current,
        programNetVolume: data.programNetBuyQty ?? null,
        programBuyAmount: null,
        programSellAmount: null,
        sourceProvider: 'KIS_API',
        dataStatus: current !== null ? 'VERIFIED' : 'EMPTY_VALID',
        providerIssue: false,
        marketSignal: current !== null,
        capturedAt: data.fetchedAt,
        reason: current !== null ? 'PROGRAM_FLOW_AVAILABLE_DIAGNOSTIC_ONLY' : 'PROGRAM_VALUE_NULL_DIAGNOSTIC_ONLY',
        captureSlot: slot,
        captureMode: runMode,
        diagnosticOnly: true,
        executionImpact: 'NONE',
      });
      const previous = previousBySymbol.get(data.stockCode)?.programNetBuyAmount ?? null;
      deltas.push({
        symbol: data.stockCode,
        previousSlotValue: previous,
        currentSlotValue: current,
        deltaProgramNetBuyAmount: previous !== null && current !== null ? current - previous : null,
        deltaDirection: classifyDelta(previous, current),
        diagnosticOnly: true,
        executionImpact: 'NONE',
      });
    }
    if (providerCallsAdded >= limit || providerAbortReason) break;
    await sleep(options.minIntervalMsOverride ?? minIntervalMs());
  }

  let savedSnapshot: IntradayProgramFlowSnapshot | null = null;
  if (rows.length > 0) {
    savedSnapshot = saveProgramAutoCaptureRows(rows, now);
  }
  if (runMode === 'MANUAL_RUN_NOW' && attemptedSymbols.length > 0) {
    markManualCooldownSymbols(status, marketDate, slot, attemptedSymbols, now);
  }
  if (attemptedSymbols.length > 0) {
    markCompletedSlotSymbols(status, marketDate, slot, attemptedSymbols);
  }

  const latest = savedSnapshot ?? loadLatestIntradayProgramFlowSnapshot();
  const valuedRows = rows.filter((r) => typeof r.programNetBuyAmount === 'number') as Array<{ symbol: string; name?: string; programNetBuyAmount: number }>;
  const topProgramBuy = [...valuedRows].filter((r) => r.programNetBuyAmount > 0).sort((a, b) => b.programNetBuyAmount - a.programNetBuyAmount).slice(0, 5);
  const topProgramSell = [...valuedRows].filter((r) => r.programNetBuyAmount < 0).sort((a, b) => a.programNetBuyAmount - b.programNetBuyAmount).slice(0, 5);
  const finishedAt = new Date().toISOString();
  status.dailyProviderCallsByDate[marketDate] = dailyCallsBefore + providerCallsAdded;
  const coverageAfter = symbolsCapturedToday(status, marketDate);
  const newlyCaptured = attemptedSymbols.filter((symbol) => !coverageBefore.has(symbol)).length;
  const recaptured = attemptedSymbols.filter((symbol) => coverageBefore.has(symbol)).length;
  const todayCoverage = countWatchlistIntersection(coverageAfter, watchlistSymbols);
  const morningCoverage = countWatchlistIntersection(symbolsForSlot(status, marketDate, 'MORNING'), watchlistSymbols);
  const afternoonCoverage = countWatchlistIntersection(symbolsForSlot(status, marketDate, 'AFTERNOON'), watchlistSymbols);
  const summary: ProgramAutoCaptureRunSummary = {
    slot,
    marketDate,
    startedAt,
    finishedAt,
    mode: configuredMode(),
    runMode,
    limit,
    providerHardCapPerRun,
    dailyProviderHardCap,
    targetMode,
    session: guard.marketSession,
    kstTime: guard.kstTime,
    watchlistSize: watchlistSymbols.size,
    watchlistTargetSize: configuredWatchlistTargetSize(),
    target: targets.length,
    captured,
    emptyValid,
    failed,
    skipped: completedSlotSkipped + cooldownSkipped,
    cooldownSkipped,
    providerCallsAdded,
    dailyProviderCalls: dailyCallsBefore + providerCallsAdded,
    todayCoverage,
    morningCoverage,
    afternoonCoverage,
    newlyCaptured,
    recaptured,
    remainingNotCaptured: Math.max(0, watchlistSymbols.size - todayCoverage),
    snapshotRowsWithValue: latest?.summary.stockRowsWithProgramValue ?? 0,
    executionImpact: 'NONE',
    liveDecision: false,
    programFlowUsedForLiveDecision: false,
    passiveProxyUsedForLiveDecision: false,
    strongBuyAllowed: false,
    programPenaltyApplied: false,
    programMissingAsBearish: false,
    deltas,
    topProgramBuy,
    topProgramSell,
  };

  status.lastRun = summary;
  status.lastCapturedCount = captured + emptyValid;
  status.lastFailedCount = failed;
  status.latestSnapshotRowsWithValue = summary.snapshotRowsWithValue;
  if (runMode !== 'MANUAL_RUN_NOW') {
    if (slot === 'MORNING') status.lastMorningCaptureAt = finishedAt;
    else status.lastAfternoonCaptureAt = finishedAt;
  }
  status.schedulerEnabled = !isProgramAutoCaptureDisabled();
  status.disabled = isProgramAutoCaptureDisabled();
  status.nextScheduledCapture = computeNextProgramAutoCaptureKst(new Date());
  saveProgramAutoCaptureStatus(status, now);

  console.log(`[ProgramAutoCapture] mode=${runMode} slot=${slot} target=${summary.target} captured=${captured} emptyValid=${emptyValid} failed=${failed} cooldownSkipped=${cooldownSkipped} providerCallsAdded=${providerCallsAdded} executionImpact=NONE failedSymbols=${failedSymbols.join(',') || 'NONE'} abort=${providerAbortReason || 'NONE'}`);
  if (runMode !== 'MANUAL_RUN_NOW') {
    await sendTelegramAlert(formatProgramAutoCaptureSummary(summary), {
      tier: 'T2_REPORT',
      category: 'program_auto_capture',
      dedupeKey: `program-auto-capture-${marketDate}-${slot}`,
      noiseEvent: {
        eventType: 'PROGRAM_AUTO_CAPTURE',
        channel: 'CH4_JOURNAL',
        executionImpact: 'NONE',
        dedupeHint: `${marketDate}:${slot}`,
      },
    }).catch((err) => emitDiagnosticWarn({ code: 'P2_SCHEDULER_DIAGNOSTIC_DEGRADED', message: 'Program auto-capture telegram summary failed.', dedupKey: `p2:scheduler:program-autocapture-telegram:${marketDate}:${slot}`, error: err }));
  }
  return summary;
}

function formatAmount(amount: number): string {
  const eok = amount / 100_000_000;
  const sign = eok > 0 ? '+' : '';
  return `${sign}${Math.round(eok)}억`;
}

function formatProgramAutoCaptureSummary(summary: ProgramAutoCaptureRunSummary): string {
  const buy = summary.topProgramBuy.length > 0
    ? summary.topProgramBuy.map((r, i) => `${i + 1}. ${r.symbol} ${r.name ?? ''} ${formatAmount(r.programNetBuyAmount)}`.trim()).join('\n')
    : '없음';
  const sell = summary.topProgramSell.length > 0
    ? summary.topProgramSell.map((r, i) => `${i + 1}. ${r.symbol} ${r.name ?? ''} ${formatAmount(r.programNetBuyAmount)}`.trim()).join('\n')
    : '없음';
  return [
    '📡 <b>[Program Flow Auto Capture]</b>',
    `slot=${summary.slot}`,
    `mode=${summary.mode}`,
    `runMode=${summary.runMode}`,
    `watchlistSize=${summary.watchlistSize}`,
    `limit=${summary.limit}`,
    `targetMode=${summary.targetMode}`,
    `target=${summary.target}`,
    `captured=${summary.captured}`,
    `emptyValid=${summary.emptyValid}`,
    `failed=${summary.failed}`,
    `todayCoverage=${summary.todayCoverage}/${summary.watchlistSize}`,
    `dailyProviderCalls=${summary.dailyProviderCalls}/${summary.dailyProviderHardCap}`,
    `cooldownSkipped=${summary.cooldownSkipped}`,
    `providerCallsAdded=${summary.providerCallsAdded}`,
    `snapshotRowsWithValue=${summary.snapshotRowsWithValue}`,
    `executionImpact=${summary.executionImpact}`,
    '',
    'Coverage:',
    `newlyCaptured=${summary.newlyCaptured}`,
    `recaptured=${summary.recaptured}`,
    `remainingNotCaptured=${summary.remainingNotCaptured}`,
    '',
    'Delta:',
    `buyAccelerating=${summary.deltas.filter((d) => d.deltaDirection === 'PROGRAM_BUY_ACCELERATING').length}`,
    `sellAccelerating=${summary.deltas.filter((d) => d.deltaDirection === 'PROGRAM_SELL_ACCELERATING').length}`,
    `reversalToBuy=${summary.deltas.filter((d) => d.deltaDirection === 'PROGRAM_REVERSAL_TO_BUY').length}`,
    `reversalToSell=${summary.deltas.filter((d) => d.deltaDirection === 'PROGRAM_REVERSAL_TO_SELL').length}`,
    '',
    'Top Program Buy:',
    buy,
    '',
    'Top Program Sell:',
    sell,
    '',
    'Safety:',
    `liveDecision=${summary.liveDecision}`,
    `programFlowUsedForLiveDecision=${summary.programFlowUsedForLiveDecision}`,
    `passiveProxyUsedForLiveDecision=${summary.passiveProxyUsedForLiveDecision}`,
    `strongBuyAllowed=${summary.strongBuyAllowed}`,
    `programPenaltyApplied=${summary.programPenaltyApplied}`,
    `programMissingAsBearish=${summary.programMissingAsBearish}`,
    'normal_supply_preview_providerCalls=0',
    '',
    'nextAction=/normal_supply_preview full',
  ].join('\n');
}


async function runProgramAutoCaptureScheduled(slot: ProgramAutoCaptureSlot, now = new Date()): Promise<string> {
  if (isProgramAutoCaptureDisabled()) return `program_auto_capture_${slot}:disabled executionImpact=NONE`;
  if (getEmergencyStop()) return `program_auto_capture_${slot}:hard_block_skip executionImpact=NONE`;
  const guard = classifyProgramFlowSession(now);
  if (!guard.isTradingDay || guard.marketSession !== 'REGULAR_SESSION' || !guard.programFlowExpected) {
    return `program_auto_capture_${slot}:session_skip:${guard.marketSession} executionImpact=NONE`;
  }
  const summary = await runProgramAutoCapture(slot, now, { runMode: 'DIAGNOSTIC_ONLY' });
  return `program_auto_capture_${slot}:captured=${summary.captured} emptyValid=${summary.emptyValid} failed=${summary.failed} executionImpact=NONE`;
}

export function registerProgramAutoCaptureJobs(): void {
  const morning = process.env.PROGRAM_AUTO_CAPTURE_MORNING_KST ?? '09:20';
  const afternoon = process.env.PROGRAM_AUTO_CAPTURE_AFTERNOON_KST ?? '13:40';
  const toCron = (hhmm: string): string => {
    const [hh, mm] = hhmm.split(':').map((v) => Number.parseInt(v, 10));
    return `${Number.isFinite(mm) ? mm : 20} ${Number.isFinite(hh) ? hh : 9} * * 1-5`;
  };
  scheduledJob(toCron(morning), 'TRADING_DAY_ONLY', 'program_auto_capture_morning', () => runProgramAutoCaptureScheduled('MORNING'), { timezone: 'Asia/Seoul' });
  scheduledJob(toCron(afternoon), 'TRADING_DAY_ONLY', 'program_auto_capture_afternoon', () => runProgramAutoCaptureScheduled('AFTERNOON'), { timezone: 'Asia/Seoul' });
}
