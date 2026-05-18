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

export type ProgramAutoCaptureSlot = 'MORNING' | 'AFTERNOON';
export type ProgramAutoCaptureRunMode = 'DIAGNOSTIC_ONLY' | 'MANUAL_RUN_NOW';
export type ProgramAutoCaptureTargetMode = 'DEFAULT' | 'BEARISH' | 'ACCUMULATING';
export type ProgramDeltaDirection =
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
  executionImpact: 'NONE';
}

export interface ProgramAutoCaptureRunSummary {
  slot: ProgramAutoCaptureSlot;
  marketDate: string;
  startedAt: string;
  finishedAt: string;
  mode: ProgramAutoCaptureRunMode;
  limit: number;
  targetMode: ProgramAutoCaptureTargetMode;
  session: ProgramFlowMarketSession;
  kstTime: string;
  target: number;
  captured: number;
  emptyValid: number;
  failed: number;
  skipped: number;
  cooldownSkipped: number;
  providerCallsAdded: number;
  snapshotRowsWithValue: number;
  executionImpact: 'NONE';
  liveDecision: false;
  strongBuyAllowed: false;
  programPenaltyApplied: false;
  programMissingAsBearish: false;
  deltas: ProgramAutoCaptureDelta[];
  topProgramBuy: Array<{ symbol: string; name?: string; programNetBuyAmount: number }>;
  topProgramSell: Array<{ symbol: string; name?: string; programNetBuyAmount: number }>;
}

export interface ProgramAutoCaptureDelta {
  symbol: string;
  previousSlotValue: number | null;
  currentSlotValue: number | null;
  deltaProgramNetBuyAmount: number | null;
  deltaDirection: ProgramDeltaDirection;
  diagnosticOnly: true;
  executionImpact: 'NONE';
}

const DEFAULT_LIMIT = 10;
const DEFAULT_MAX_LIMIT = 15;
const DEFAULT_MIN_INTERVAL_MS = 400;
const FAILURE_COOLDOWN_MS = 10 * 60 * 1000;
const MANUAL_RUN_TTL_MS = 5 * 60 * 1000;
const STATUS_FILE = path.join(REPLAY_DIR, 'program-auto-capture-status.json');

function envFlag(key: string): boolean {
  return process.env[key] === 'true';
}

export function isProgramAutoCaptureDisabled(): boolean {
  if (envFlag('PROGRAM_AUTO_CAPTURE_DISABLED')) return true;
  return process.env.PROGRAM_AUTO_CAPTURE_ENABLED !== 'true';
}

function normalizeCaptureLimit(value: unknown, fallback = DEFAULT_LIMIT): number {
  const parsed = Number.parseInt(String(value ?? ''), 10);
  const base = Number.isFinite(parsed) ? parsed : fallback;
  return Math.max(1, Math.min(DEFAULT_MAX_LIMIT, base));
}

function configuredLimit(): number {
  const maxRaw = Number.parseInt(process.env.PROGRAM_AUTO_CAPTURE_MAX_LIMIT ?? String(DEFAULT_MAX_LIMIT), 10);
  const max = Number.isFinite(maxRaw) ? Math.max(1, Math.min(DEFAULT_MAX_LIMIT, maxRaw)) : DEFAULT_MAX_LIMIT;
  const limitRaw = Number.parseInt(process.env.PROGRAM_AUTO_CAPTURE_LIMIT ?? String(DEFAULT_LIMIT), 10);
  const limit = Number.isFinite(limitRaw) ? Math.max(1, limitRaw) : DEFAULT_LIMIT;
  return Math.min(max, limit);
}

function minIntervalMs(): number {
  const raw = Number.parseInt(process.env.PROGRAM_AUTO_CAPTURE_MIN_INTERVAL_MS ?? String(DEFAULT_MIN_INTERVAL_MS), 10);
  if (!Number.isFinite(raw)) return DEFAULT_MIN_INTERVAL_MS;
  return Math.max(300, Math.min(500, raw));
}

function emptyStatus(now = new Date()): ProgramAutoCaptureStatus {
  return {
    schedulerEnabled: !isProgramAutoCaptureDisabled(),
    disabled: isProgramAutoCaptureDisabled(),
    lastCapturedCount: 0,
    lastFailedCount: 0,
    latestSnapshotRowsWithValue: loadLatestIntradayProgramFlowSnapshot()?.summary.stockRowsWithProgramValue ?? 0,
    nextScheduledCapture: computeNextProgramAutoCaptureKst(now),
    failureCooldownBySymbol: {},
    completedSlots: {},
    manualCooldownBySymbolSlot: {},
    executionImpact: 'NONE',
  };
}

export function loadProgramAutoCaptureStatus(now = new Date()): ProgramAutoCaptureStatus {
  ensureReplayDir();
  try {
    if (!fs.existsSync(STATUS_FILE)) return emptyStatus(now);
    const parsed = JSON.parse(fs.readFileSync(STATUS_FILE, 'utf-8')) as Partial<ProgramAutoCaptureStatus>;
    return {
      ...emptyStatus(now),
      ...parsed,
      schedulerEnabled: !isProgramAutoCaptureDisabled(),
      disabled: isProgramAutoCaptureDisabled(),
      latestSnapshotRowsWithValue: loadLatestIntradayProgramFlowSnapshot()?.summary.stockRowsWithProgramValue ?? parsed.latestSnapshotRowsWithValue ?? 0,
      nextScheduledCapture: computeNextProgramAutoCaptureKst(now),
      failureCooldownBySymbol: parsed.failureCooldownBySymbol ?? {},
      completedSlots: parsed.completedSlots ?? {},
      manualCooldownBySymbolSlot: parsed.manualCooldownBySymbolSlot ?? {},
      executionImpact: 'NONE',
    };
  } catch {
    return emptyStatus(now);
  }
}

function saveProgramAutoCaptureStatus(status: ProgramAutoCaptureStatus): ProgramAutoCaptureStatus {
  ensureReplayDir();
  const sanitized: ProgramAutoCaptureStatus = { ...status, executionImpact: 'NONE' };
  fs.writeFileSync(`${STATUS_FILE}.tmp`, JSON.stringify(sanitized, null, 2));
  fs.renameSync(`${STATUS_FILE}.tmp`, STATUS_FILE);
  return sanitized;
}

function kstParts(now: Date): { marketDate: string; time: string; minutes: number } {
  const kst = new Date(now.getTime() + 9 * 60 * 60 * 1000);
  const marketDate = kst.toISOString().slice(0, 10);
  const hh = kst.getUTCHours();
  const mm = kst.getUTCMinutes();
  return { marketDate, time: `${String(hh).padStart(2, '0')}:${String(mm).padStart(2, '0')}`, minutes: hh * 60 + mm };
}

export function computeNextProgramAutoCaptureKst(now = new Date()): string {
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

export function selectProgramAutoCaptureTargets(
  limit = configuredLimit(),
  options: { targetMode?: ProgramAutoCaptureTargetMode } = {},
): Array<{ symbol: string; name?: string }> {
  const targetMode = options.targetMode ?? 'DEFAULT';
  const watchlist = loadWatchlist();
  const openPositions = loadOpenPositions();
  const latestPreview = getLastNormalSupplyPreview();
  const bySymbol = new Map<string, { symbol: string; name?: string; rank: number; seq: number }>();
  let seq = 0;
  const add = (symbolRaw: unknown, name: unknown, rank: number): void => {
    const symbol = normalizeSymbol(symbolRaw);
    if (!symbol) return;
    const current = bySymbol.get(symbol);
    const row = { symbol, name: typeof name === 'string' ? name : undefined, rank, seq: seq++ };
    if (!current || row.rank > current.rank) bySymbol.set(symbol, row);
  };

  for (const p of openPositions) add(p.stockCode, p.stockName, 10000);

  for (const entry of watchlist) {
    const anyEntry = entry as unknown as Record<string, unknown>;
    const bucket = classifySupplyBucket(anyEntry.supplySignal ?? anyEntry.supplyBucket ?? anyEntry.supplyStatus);
    const shadowTracking = anyEntry.shadowTracking === true ? 400 : 0;
    const priorityBoost = numeric(anyEntry.watchlistPriorityBoost) > 0 ? 300 + numeric(anyEntry.watchlistPriorityBoost) : 0;
    const supplyScore = numeric(anyEntry.supplyScore);
    const bucketRank = bucket.includes('BEARISH') ? 9000 : bucket.includes('ACCUMULATING') ? 8000 : 0;
    add(
      anyEntry.code ?? anyEntry.stockCode ?? anyEntry.symbol,
      anyEntry.name ?? anyEntry.stockName,
      bucketRank + targetModeBoost(bucket, targetMode) + shadowTracking + priorityBoost + supplyScore + scoreWatchlist(entry),
    );
  }

  const previewCandidates = Array.isArray((latestPreview as unknown as { candidates?: unknown[] } | null)?.candidates)
    ? ((latestPreview as unknown as { candidates: unknown[] }).candidates)
    : [];
  for (const item of previewCandidates) {
    const row = item as Record<string, unknown>;
    const bucket = classifySupplyBucket(row.supplySignal ?? row.supplyBucket ?? row.supplyStatus);
    const bucketRank = bucket.includes('BEARISH') ? 7000 : bucket.includes('ACCUMULATING') ? 6500 : 6000;
    add(
      row.symbol ?? row.code ?? row.stockCode,
      row.name ?? row.stockName,
      bucketRank + targetModeBoost(bucket, targetMode) + numeric(row.supplyScore),
    );
  }

  return [...bySymbol.values()]
    .sort((a, b) => b.rank - a.rank || a.seq - b.seq || a.symbol.localeCompare(b.symbol))
    .slice(0, normalizeCaptureLimit(limit, configuredLimit()))
    .map(({ symbol, name }) => ({ symbol, name }));
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

export function resolveProgramAutoCaptureSlotForNow(now = new Date()): ProgramAutoCaptureSlot {
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

export async function runProgramAutoCapture(
  slot: ProgramAutoCaptureSlot,
  now = new Date(),
  options: ProgramAutoCaptureRunOptions = {},
): Promise<ProgramAutoCaptureRunSummary> {
  const startedAt = now.toISOString();
  const guard = classifyProgramFlowSession(now);
  const { marketDate } = kstParts(now);
  const status = loadProgramAutoCaptureStatus(now);
  const runMode = options.runMode ?? 'DIAGNOSTIC_ONLY';
  const limit = normalizeCaptureLimit(options.limit ?? configuredLimit(), configuredLimit());
  const targetMode = options.targetMode ?? 'DEFAULT';

  if (isProgramAutoCaptureDisabled()) throw new Error('PROGRAM_AUTO_CAPTURE_DISABLED');
  if (getEmergencyStop()) throw new Error('HARD_BLOCK_EMERGENCY_STOP_SKIP');
  if (!guard.isTradingDay || guard.marketSession !== 'REGULAR_SESSION' || !guard.programFlowExpected) {
    throw new Error(`PROGRAM_CAPTURE_SESSION_BLOCKED:${guard.marketSession}`);
  }

  const previousSnapshot = loadLatestIntradayProgramFlowSnapshot();
  const previousBySymbol = new Map<string, IntradayProgramFlowStockRow>();
  for (const row of previousSnapshot?.stockRows ?? []) previousBySymbol.set(row.symbol, row);

  const allTargets = selectProgramAutoCaptureTargets(limit, { targetMode });
  let completedSlotSkipped = 0;
  let cooldownSkipped = 0;
  const targets = allTargets
    .filter((t) => {
      if (runMode !== 'MANUAL_RUN_NOW' && hasCompletedSlotSymbol(status, marketDate, slot, t.symbol)) {
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
  let providerAbortReason = '';

  for (const target of targets) {
    providerCallsAdded += 1;
    let data: Awaited<ReturnType<typeof fetchKisStockProgramTrade>> | null = null;
    try {
      data = await fetchKisStockProgramTrade(target.symbol, 'LOW');
    } catch (error) {
      failed += 1;
      failedSymbols.push(target.symbol);
      status.failureCooldownBySymbol[target.symbol] = new Date(now.getTime() + FAILURE_COOLDOWN_MS).toISOString();
      if (isKisThrottleOrCircuitBreaker(error)) {
        providerAbortReason = error instanceof Error ? error.message : String(error);
        console.warn(`[ProgramAutoCapture] provider circuit/throttle abort symbol=${target.symbol} reason=${providerAbortReason}`);
        break;
      }
      console.warn(`[ProgramAutoCapture] provider failure symbol=${target.symbol}`, error instanceof Error ? error.message : error);
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
    await sleep(minIntervalMs());
  }

  let savedSnapshot: IntradayProgramFlowSnapshot | null = null;
  if (rows.length > 0) {
    savedSnapshot = saveProgramAutoCaptureRows(rows, now);
    const savedSymbols = rows.map((r) => String(r.symbol));
    if (runMode === 'MANUAL_RUN_NOW') {
      markManualCooldownSymbols(status, marketDate, slot, savedSymbols, now);
    } else {
      markCompletedSlotSymbols(status, marketDate, slot, savedSymbols);
    }
  }

  const latest = savedSnapshot ?? loadLatestIntradayProgramFlowSnapshot();
  const valuedRows = rows.filter((r) => typeof r.programNetBuyAmount === 'number') as Array<{ symbol: string; name?: string; programNetBuyAmount: number }>;
  const topProgramBuy = [...valuedRows].filter((r) => r.programNetBuyAmount > 0).sort((a, b) => b.programNetBuyAmount - a.programNetBuyAmount).slice(0, 2);
  const topProgramSell = [...valuedRows].filter((r) => r.programNetBuyAmount < 0).sort((a, b) => a.programNetBuyAmount - b.programNetBuyAmount).slice(0, 2);
  const finishedAt = new Date().toISOString();
  const summary: ProgramAutoCaptureRunSummary = {
    slot,
    marketDate,
    startedAt,
    finishedAt,
    mode: runMode,
    limit,
    targetMode,
    session: guard.marketSession,
    kstTime: guard.kstTime,
    target: targets.length,
    captured,
    emptyValid,
    failed,
    skipped: completedSlotSkipped + cooldownSkipped,
    cooldownSkipped,
    providerCallsAdded,
    snapshotRowsWithValue: latest?.summary.stockRowsWithProgramValue ?? 0,
    executionImpact: 'NONE',
    liveDecision: false,
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
  saveProgramAutoCaptureStatus(status);

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
    }).catch((err) => console.warn('[ProgramAutoCapture] telegram summary failed:', err instanceof Error ? err.message : err));
  }
  return summary;
}

function formatAmount(amount: number): string {
  const eok = amount / 100_000_000;
  const sign = eok > 0 ? '+' : '';
  return `${sign}${Math.round(eok)}억`;
}

export function formatProgramAutoCaptureSummary(summary: ProgramAutoCaptureRunSummary): string {
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
    `limit=${summary.limit}`,
    `targetMode=${summary.targetMode}`,
    `target=${summary.target}`,
    `captured=${summary.captured}`,
    `emptyValid=${summary.emptyValid}`,
    `failed=${summary.failed}`,
    `cooldownSkipped=${summary.cooldownSkipped}`,
    `providerCallsAdded=${summary.providerCallsAdded}`,
    `snapshotRowsWithValue=${summary.snapshotRowsWithValue}`,
    `executionImpact=${summary.executionImpact}`,
    '',
    'Top Program Buy:',
    buy,
    '',
    'Top Program Sell:',
    sell,
    '',
    'Safety:',
    `liveDecision=${summary.liveDecision}`,
    `strongBuyAllowed=${summary.strongBuyAllowed}`,
    `programPenaltyApplied=${summary.programPenaltyApplied}`,
    `programMissingAsBearish=${summary.programMissingAsBearish}`,
    '',
    'nextAction=/normal_supply_preview full',
  ].join('\n');
}


export async function runProgramAutoCaptureScheduled(slot: ProgramAutoCaptureSlot, now = new Date()): Promise<string> {
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
