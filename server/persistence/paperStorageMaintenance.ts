// @responsibility Retire obsolete Shadow observation detail with durable retention accounting.
import fs from 'node:fs';
import path from 'node:path';
import { createHash, randomUUID } from 'node:crypto';
import { gunzipSync } from 'node:zlib';
import { z } from 'zod';
import type { PaperExperimentLedger, PaperStorageMaintenance } from '../../src/types/paperExperiment.js';
import type { PaperStrategyLedger, PaperStrategyTrade } from '../../src/types/paperStrategy.js';
import { DATA_DIR, ensureDataDir } from './paths.js';
import { compressPaperExperimentMonths } from './paperExperimentRepo.js';
import { PAPER_TRADE_MEASUREMENT_DIR, readPaperTradeMeasurementHistory } from './paperTradeMeasurementRepo.js';
import { toKstDateKey } from '../calendar/krxTradingCalendar.js';
import { assertPaperTradeMeasurementRows } from '../trading/paper/paperTradeMeasurementValidation.js';

const RETENTION_DAYS = 90, ENTRY_DATES = 60, MAX_BATCHES = 1000;
const STATUS_FILE = path.join(DATA_DIR, 'paper-storage-maintenance.json');
const integer = z.number().int().nonnegative();
const batchPath = /^\d{4}-\d{2}-\d{2}\/[a-f0-9]{64}\.json\.gz$/;
const schema = z.object({ schemaVersion: z.literal(1), lastRunAt: z.string().datetime().nullable(),
  compressedMonths: integer, deletedBatches: integer, deletedPoints: integer, bytesSaved: integer,
  checkedBatches: integer, protectedBatches: integer, errors: z.array(z.string()), cursor: z.string(),
  pending: z.object({ file: z.string().regex(batchPath), bytes: integer, points: integer }).optional() });
type State = z.infer<typeof schema>;
const empty = (): State => ({ schemaVersion: 1, lastRunAt: null, compressedMonths: 0, deletedBatches: 0,
  deletedPoints: 0, bytesSaved: 0, checkedBatches: 0, protectedBatches: 0, errors: [], cursor: '' });
const load = (): State => fs.existsSync(STATUS_FILE) ? schema.parse(JSON.parse(fs.readFileSync(STATUS_FILE, 'utf8'))) : empty();

function save(state: State): void {
  ensureDataDir();
  const temporary = `${STATUS_FILE}.${randomUUID()}.tmp`;
  let fd: number | undefined;
  try {
    fd = fs.openSync(temporary, 'wx');
    fs.writeFileSync(fd, JSON.stringify(schema.parse(state)));
    fs.fsyncSync(fd);
    fs.closeSync(fd);
    fd = undefined;
    fs.renameSync(temporary, STATUS_FILE);
  } finally {
    if (fd !== undefined) fs.closeSync(fd);
    if (fs.existsSync(temporary)) fs.unlinkSync(temporary);
  }
}

/** Reject symlinks/junctions at every level; never traverse outside the configured data root. */
function safePath(file: string): void {
  const root = path.resolve(DATA_DIR), relative = path.relative(root, path.resolve(file));
  if (!relative || relative.startsWith('..') || path.isAbsolute(relative)) throw new Error('UNSAFE_STORAGE_PATH');
  let current = root;
  for (const part of relative.split(path.sep)) {
    current = path.join(current, part);
    if (fs.lstatSync(current).isSymbolicLink()) throw new Error('UNSAFE_STORAGE_LINK');
    const resolved = path.relative(fs.realpathSync(root), fs.realpathSync(current));
    if (resolved.startsWith('..') || path.isAbsolute(resolved)) throw new Error('UNSAFE_STORAGE_PATH');
  }
}

export function readPaperStorageMaintenance(): PaperStorageMaintenance {
  try {
    const state = load();
    return { retentionDays: RETENTION_DAYS, protectedEntryDates: ENTRY_DATES, lastRunAt: state.lastRunAt,
      compressedMonths: state.compressedMonths, deletedBatches: state.deletedBatches, deletedPoints: state.deletedPoints,
      bytesSaved: state.bytesSaved, checkedBatches: state.checkedBatches, protectedBatches: state.protectedBatches, errors: state.errors };
  } catch (error) {
    console.error('[PaperStorage] 상태 조회 실패:', error);
    return { ...empty(), retentionDays: RETENTION_DAYS, protectedEntryDates: ENTRY_DATES, errors: ['정리 상태를 읽을 수 없습니다.'] };
  }
}

function protectedDates(baseline: PaperExperimentLedger, strategy: PaperStrategyLedger): Set<string> {
  const result = new Set<string>();
  // Preserve both complete learner windows and recent unfinished cohorts; never rank by profit.
  for (const dates of [baseline.experiments.map(row => row.tradingDate),
    ...([1, 3, 5] as const).map(horizon => baseline.experiments
      .filter(row => row.outcomes.some(outcome => outcome.horizon === horizon)).map(row => row.tradingDate)),
    strategy.trades.map(row => row.tradingDate),
    strategy.trades.filter(row => row.exitResearch?.completedAt).map(row => row.tradingDate)]) {
    [...new Set(dates)].sort().slice(-ENTRY_DATES).forEach(date => result.add(date));
  }
  return result;
}

function retireable(trade: PaperStrategyTrade, cutoff: number, dates: Set<string>): boolean {
  if (trade.status !== 'CLOSED' || !trade.exit || dates.has(trade.tradingDate)) return false;
  if (trade.policy.exitModel === 'ADAPTIVE_OBSERVED' && !trade.exitResearch?.completedAt) return false;
  if (trade.exitResearch && !trade.exitResearch.completedAt) return false;
  return [trade.entryAt, trade.exit.effectiveAt, trade.exit.observedAt, trade.exit.decisionAt,
    ...(trade.exitResearch ? [trade.exitResearch.completedAt!] : []),
    ...(trade.measurement ? [trade.measurement.latest.recordedAt] : [])]
    .every(at => Number.isFinite(Date.parse(at)) && Date.parse(at) < cutoff);
}

function candidates(cutoffDate: string): string[] {
  if (!fs.existsSync(PAPER_TRADE_MEASUREMENT_DIR)) return [];
  safePath(PAPER_TRADE_MEASUREMENT_DIR);
  const result: string[] = [];
  for (const day of fs.readdirSync(PAPER_TRADE_MEASUREMENT_DIR, { withFileTypes: true })) {
    if (!day.isDirectory() || !/^\d{4}-\d{2}-\d{2}$/.test(day.name) || day.name >= cutoffDate) continue;
    const directory = path.join(PAPER_TRADE_MEASUREMENT_DIR, day.name);
    safePath(directory);
    for (const file of fs.readdirSync(directory, { withFileTypes: true })) {
      if (file.isFile() && /^[a-f0-9]{64}\.json\.gz$/.test(file.name)) result.push(`${day.name}/${file.name}`);
    }
  }
  return result.sort();
}

function accountPending(state: State): void {
  const pending = state.pending!;
  state.deletedBatches++;
  state.deletedPoints += pending.points;
  state.bytesSaved += pending.bytes;
  delete state.pending;
  save(state);
}

function purgeBatch(relative: string, state: State, strategy: PaperStrategyLedger, cutoff: number, dates: Set<string>): void {
  const file = path.join(PAPER_TRADE_MEASUREMENT_DIR, relative);
  safePath(file);
  const bytes = fs.readFileSync(file);
  const batch = JSON.parse(gunzipSync(bytes, { maxOutputLength: 32 * 1024 * 1024 }).toString('utf8')) as {
    schemaVersion?: unknown; snapshotId?: unknown; recordedAt?: unknown; rows?: unknown;
  };
  assertPaperTradeMeasurementRows(batch.rows, strategy.trades);
  if (batch.schemaVersion !== 1 || !batch.rows.length || typeof batch.snapshotId !== 'string' || typeof batch.recordedAt !== 'string'
    || batch.rows.some(row => row.snapshotId !== batch.snapshotId || row.recordedAt !== batch.recordedAt)
    || toKstDateKey(batch.recordedAt) !== relative.split('/')[0]
    || `${createHash('sha256').update(batch.snapshotId).digest('hex')}.json.gz` !== path.basename(file)) {
    throw new Error('INVALID_MEASUREMENT_BATCH');
  }
  const byId = new Map(strategy.trades.map(trade => [trade.id, trade]));
  if (!batch.rows.every(row => retireable(byId.get(row.tradeId)!, cutoff, dates)
    && [row.recordedAt, row.observedAt, row.effectiveAt].every(at => Date.parse(at) < cutoff))) {
    state.protectedBatches++;
    return;
  }
  state.pending = { file: relative, bytes: bytes.length, points: batch.rows.length };
  save(state); // Write-ahead accounting makes an interrupted unlink visible after restart.
  fs.unlinkSync(file);
  accountPending(state);
}

/** Called only by the serialized scan; failures are reported without blocking observation or learning. */
export function runPaperStorageMaintenance(baseline: PaperExperimentLedger, strategy: PaperStrategyLedger, now: Date, marketOpen: boolean): void {
  if (marketOpen || !Number.isFinite(now.getTime())) return;
  let state: State | undefined;
  try {
    state = load();
    if (state.pending) {
      const file = path.join(PAPER_TRADE_MEASUREMENT_DIR, state.pending.file);
      safePath(path.dirname(file));
      if (!fs.existsSync(file)) accountPending(state);
      else { delete state.pending; save(state); } // Still present: revalidate on the next pass, never blindly unlink.
    }
    if (state.lastRunAt && toKstDateKey(state.lastRunAt) >= toKstDateKey(now)) return;
    state.lastRunAt = now.toISOString();
    state.checkedBatches = 0;
    state.protectedBatches = 0;
    state.errors = [];
    save(state);
    const compact = compressPaperExperimentMonths(toKstDateKey(now).slice(0, 7));
    state.compressedMonths += compact.months;
    state.bytesSaved += compact.bytesSaved;
    save(state);
    const history = readPaperTradeMeasurementHistory(strategy);
    if (history.error || history.unrecordedPointCount !== 0) throw new Error('상세 관측 저장 미확인: 자동 삭제 보류');
    const cutoff = now.getTime() - RETENTION_DAYS * 86_400_000, dates = protectedDates(baseline, strategy);
    const all = candidates(toKstDateKey(new Date(cutoff)));
    const after = all.filter(file => file > state!.cursor);
    const selected = [...after, ...all.filter(file => file <= state!.cursor)].slice(0, MAX_BATCHES);
    for (const file of selected) {
      state.checkedBatches++;
      try { purgeBatch(file, state, strategy, cutoff, dates); }
      catch (error) {
        if (state.pending) throw error; // Stop on uncertain journal/write results; recover before the next attempt.
        if (state.errors.length < 10) state.errors.push(`${file}: ${error instanceof Error ? error.message : String(error)}`);
      }
      state.cursor = file;
    }
    save(state);
  } catch (error) {
    console.error('[PaperStorage] 자동 정리 보류:', error);
    if (state) {
      state.errors.push(error instanceof Error ? error.message : String(error));
      try { save(state); } catch (writeError) { console.error('[PaperStorage] 상태 저장 실패:', writeError); }
    }
  }
}
