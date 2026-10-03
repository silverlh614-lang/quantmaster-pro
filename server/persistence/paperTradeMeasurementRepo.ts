// @responsibility Preserve sampled Shadow trade paths outside the hot strategy ledger.
import fs from 'node:fs';
import path from 'node:path';
import { createHash, randomUUID } from 'node:crypto';
import { gzipSync, gunzipSync } from 'node:zlib';
import { isDeepStrictEqual } from 'node:util';
import { z } from 'zod';
import type { PaperStrategyLedger, PaperStrategyTrade, PaperTradeMeasurementHistory, PaperTradeMeasurementRow } from '../../src/types/paperStrategy.js';
import { DATA_DIR } from './paths.js';
import { toKstDateKey } from '../calendar/krxTradingCalendar.js';
import { assertPaperTradeMeasurementRows } from '../trading/paper/paperTradeMeasurementValidation.js';

export const PAPER_TRADE_MEASUREMENT_DIR = path.join(DATA_DIR, 'paper-trade-observations');
export const PAPER_TRADE_MEASUREMENT_STATUS_FILE = path.join(DATA_DIR, 'paper-trade-observation-status.json');
const timestamp = z.string().refine(value => Number.isFinite(Date.parse(value)));
const statusSchema = z.object({ schemaVersion: z.literal(1), lastRecordedAt: timestamp.nullable(),
  failedBatchCount: z.number().int().nonnegative(),
  accountedPointCount: z.number().int().nonnegative(), unconfirmedPointCount: z.number().int().nonnegative(),
  missingBatches: z.record(z.string(), z.object({ at: timestamp, pointCount: z.number().int().nonnegative() })),
  error: z.string().optional() });
type Status = z.infer<typeof statusSchema>;
const emptyStatus = (): Status => ({ schemaVersion: 1, lastRecordedAt: null, failedBatchCount: 0,
  accountedPointCount: 0, unconfirmedPointCount: 0, missingBatches: {} });
let volatileError: string | undefined;

function atomicWrite(filename: string, bytes: string | Buffer): void {
  fs.mkdirSync(path.dirname(filename), { recursive: true });
  const temporary = `${filename}.${randomUUID()}.tmp`;
  try {
    fs.writeFileSync(temporary, bytes);
    fs.renameSync(temporary, filename);
  } finally {
    if (fs.existsSync(temporary)) fs.unlinkSync(temporary);
  }
}

function loadStatus(): Status {
  if (!fs.existsSync(PAPER_TRADE_MEASUREMENT_STATUS_FILE)) return emptyStatus();
  return statusSchema.parse(JSON.parse(fs.readFileSync(PAPER_TRADE_MEASUREMENT_STATUS_FILE, 'utf8')));
}

const batchId = (snapshotId: string) => createHash('sha256').update(snapshotId).digest('hex');
const rowId = (row: PaperTradeMeasurementRow) => `${row.tradeId}:${row.entrySnapshotId}:${row.kind}`;
const pointCount = (trades: PaperStrategyTrade[]) => trades.reduce((sum, trade) => sum + (trade.measurement?.pointCount ?? 0), 0);

/** One immutable compressed batch per snapshot; retries cannot duplicate or replace a recorded path. */
export function savePaperTradeMeasurementBatch(rows: PaperTradeMeasurementRow[], trades: PaperStrategyTrade[]): void {
  if (!rows.length) return;
  assertPaperTradeMeasurementRows(rows, trades);
  const { snapshotId, recordedAt } = rows[0];
  if (rows.some(row => row.snapshotId !== snapshotId || row.recordedAt !== recordedAt)
    || new Set(rows.map(rowId)).size !== rows.length) throw new Error('PAPER_TRADE_MEASUREMENT_BATCH_INVALID');
  const id = batchId(snapshotId);
  const filename = path.join(PAPER_TRADE_MEASUREMENT_DIR, toKstDateKey(new Date(recordedAt)), `${id}.json.gz`);
  const batch = { schemaVersion: 1, snapshotId, recordedAt, rows: [...rows].sort((a, b) => rowId(a).localeCompare(rowId(b))) };
  const serialized = JSON.stringify(batch);
  if (fs.existsSync(filename)) {
    const saved = gunzipSync(fs.readFileSync(filename)).toString('utf8');
    if (saved !== serialized && !isDeepStrictEqual(JSON.parse(saved), batch)) throw new Error('PAPER_TRADE_MEASUREMENT_BATCH_CONFLICT');
  } else atomicWrite(filename, gzipSync(serialized));
  const status = loadStatus();
  const expected = pointCount(trades);
  const unconfirmed = Math.max(0, expected - status.accountedPointCount - rows.length);
  const newer = !status.lastRecordedAt || Date.parse(recordedAt) > Date.parse(status.lastRecordedAt);
  const changed = unconfirmed > 0 || expected > status.accountedPointCount || newer
    || status.missingBatches[id] !== undefined || status.error !== undefined;
  // A crash after the core save but before this recorder must remain visible after subsequent successes.
  status.unconfirmedPointCount += unconfirmed;
  status.accountedPointCount = Math.max(status.accountedPointCount, expected);
  if (newer) status.lastRecordedAt = recordedAt;
  delete status.missingBatches[id];
  delete status.error;
  if (changed) atomicWrite(PAPER_TRADE_MEASUREMENT_STATUS_FILE, JSON.stringify(status));
  volatileError = undefined;
}

/** Recording diagnostics must not change an already committed virtual BUY or EXIT. */
export function recordPaperTradeMeasurementFailure(snapshotId: string, at: string, count: number, error: unknown, trades: PaperStrategyTrade[]): void {
  const message = `상세 관측 기록 실패: ${error instanceof Error ? error.message : String(error)}`;
  volatileError = message;
  console.error('[PaperTradeMeasurement]', message);
  try {
    const status = loadStatus(), id = batchId(snapshotId);
    const expected = pointCount(trades);
    status.unconfirmedPointCount += Math.max(0, expected - status.accountedPointCount - count);
    status.accountedPointCount = Math.max(status.accountedPointCount, expected);
    if (!status.missingBatches[id]) status.failedBatchCount++;
    status.missingBatches[id] = { at, pointCount: count };
    status.error = message;
    atomicWrite(PAPER_TRADE_MEASUREMENT_STATUS_FILE, JSON.stringify(status));
  } catch (statusError) {
    console.error('[PaperTradeMeasurement] 기록 실패 상태 저장 불가:', statusError instanceof Error ? statusError.message : String(statusError));
  }
}

export function readPaperTradeMeasurementHistory(ledger: PaperStrategyLedger): PaperTradeMeasurementHistory {
  try {
    const status = loadStatus();
    let latest = 0, expected = 0;
    for (const trade of ledger.trades) {
      if (!trade.measurement) continue;
      latest = Math.max(latest, Date.parse(trade.measurement.latest.recordedAt) || 0);
      expected += trade.measurement.pointCount;
    }
    const behind = latest > (Date.parse(status.lastRecordedAt ?? '') || 0);
    const error = volatileError ?? status.error ?? (behind ? '최근 거래 관측의 상세 기록 저장을 확인해야 합니다.' : undefined);
    return { lastRecordedAt: status.lastRecordedAt, failedBatchCount: status.failedBatchCount,
      unrecordedPointCount: status.unconfirmedPointCount + Math.max(0, expected - status.accountedPointCount)
        + Object.values(status.missingBatches).reduce((sum, item) => sum + item.pointCount, 0),
      ...(error ? { error } : {}) };
  } catch (error) {
    console.error('[PaperTradeMeasurement] 기록 상태 조회 실패:', error instanceof Error ? error.message : String(error));
    return { lastRecordedAt: null, failedBatchCount: null, unrecordedPointCount: null, error: '상세 관측 기록 상태를 읽을 수 없습니다.' };
  }
}
