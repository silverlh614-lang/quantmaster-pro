// @responsibility Verify immutable trade-path storage survives failures or restarts.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { gzipSync, gunzipSync } from 'node:zlib';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { PaperStrategyLedger } from '../../src/types/paperStrategy.js';
import { legacyStrategyLedger, strategyTestCost, strategyTestSnapshot } from '../trading/paper/paperStrategyFixtures.js';
import { evaluatePaperStrategyScan } from '../trading/paper/paperStrategyPolicy.js';
import { selectPaperAdaptiveState } from '../trading/paper/paperAdaptiveSelection.js';
import { capturePaperTradeMeasurements } from '../trading/paper/paperTradeMeasurements.js';

let repo: typeof import('./paperTradeMeasurementRepo.js');
let dataDir: string;
const temporaryRoot = path.resolve(os.tmpdir());
beforeEach(async () => {
  dataDir = fs.mkdtempSync(path.join(temporaryRoot, 'qmp-trade-path-'));
  vi.stubEnv('PERSIST_DATA_DIR', dataDir);
  vi.resetModules();
  repo = await import('./paperTradeMeasurementRepo.js');
  vi.spyOn(console, 'error').mockImplementation(() => undefined);
});
afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllEnvs();
  if (dataDir && path.dirname(path.resolve(dataDir)) === temporaryRoot) fs.rmSync(dataDir, { recursive: true, force: true });
});

function entry() {
  const ledger = legacyStrategyLedger(), snapshot = strategyTestSnapshot();
  return { ledger, rows: capturePaperTradeMeasurements(ledger, snapshot) };
}
function observe(ledger: PaperStrategyLedger, minute: number, price: number) {
  const snapshot = strategyTestSnapshot();
  snapshot.id = `holding-${minute}`;
  snapshot.asOf = `2026-09-18T01:${String(minute).padStart(2, '0')}:00Z`;
  snapshot.observations[0].observedAt = snapshot.asOf;
  snapshot.observations[0].price = price;
  const next = evaluatePaperStrategyScan(ledger, snapshot, strategyTestCost,
    selectPaperAdaptiveState(ledger.adaptive, [], snapshot.asOf));
  return { ledger: next, rows: capturePaperTradeMeasurements(next, snapshot) };
}
function batchFiles(): string[] {
  return fs.readdirSync(repo.PAPER_TRADE_MEASUREMENT_DIR, { recursive: true, encoding: 'utf8' })
    .filter(name => name.endsWith('.json.gz')).map(name => path.join(repo.PAPER_TRADE_MEASUREMENT_DIR, name));
}

describe('durable trade measurement batches', () => {
  it('stores immutable compressed observations linked to frozen entries and survives restart', async () => {
    const first = entry();
    repo.savePaperTradeMeasurementBatch(first.rows, first.ledger.trades);
    const filename = batchFiles()[0], bytes = fs.readFileSync(filename);
    const decoded = JSON.parse(gunzipSync(bytes).toString('utf8'));
    expect(decoded).toEqual({ schemaVersion: 1, snapshotId: 'test-scan', recordedAt: '2026-09-18T01:00:00Z', rows: first.rows });
    expect(decoded.rows[0]).toMatchObject({ tradeId: first.ledger.trades[0].id, entrySnapshotId: 'test-scan', kind: 'ENTRY' });
    const second = observe(first.ledger, 5, 11000);
    repo.savePaperTradeMeasurementBatch(second.rows, second.ledger.trades);
    expect(fs.readFileSync(filename)).toEqual(bytes);
    expect(batchFiles()).toHaveLength(2);
    vi.resetModules(); repo = await import('./paperTradeMeasurementRepo.js');
    expect(repo.readPaperTradeMeasurementHistory(second.ledger)).toEqual({
      lastRecordedAt: '2026-09-18T01:05:00Z', failedBatchCount: 0, unrecordedPointCount: 0,
    });
  });

  it('accepts identical retries without replacing bytes and rejects a conflicting observation', () => {
    const first = entry(), second = observe(first.ledger, 5, 11000);
    repo.savePaperTradeMeasurementBatch(first.rows, first.ledger.trades);
    repo.savePaperTradeMeasurementBatch(second.rows, second.ledger.trades);
    const before = batchFiles().map(filename => [filename, fs.readFileSync(filename)] as const);
    repo.savePaperTradeMeasurementBatch(second.rows, second.ledger.trades);
    expect(() => repo.savePaperTradeMeasurementBatch([{ ...second.rows[0], source: 'OTHER_CONFIRMED_SOURCE' }], second.ledger.trades))
      .toThrow('PAPER_TRADE_MEASUREMENT_BATCH_CONFLICT');
    for (const [filename, bytes] of before) expect(fs.readFileSync(filename)).toEqual(bytes);
    expect(repo.readPaperTradeMeasurementHistory(second.ledger).unrecordedPointCount).toBe(0);
  });

  it('does not attempt another disk write for an already confirmed identical retry', () => {
    const first = entry();
    repo.savePaperTradeMeasurementBatch(first.rows, first.ledger.trades);
    const before = fs.readFileSync(repo.PAPER_TRADE_MEASUREMENT_STATUS_FILE, 'utf8');
    const write = vi.spyOn(fs, 'writeFileSync').mockImplementation(() => { throw new Error('no space for unnecessary writes'); });
    expect(() => repo.savePaperTradeMeasurementBatch(first.rows, first.ledger.trades)).not.toThrow();
    expect(write).not.toHaveBeenCalled();
    expect(fs.readFileSync(repo.PAPER_TRADE_MEASUREMENT_STATUS_FILE, 'utf8')).toBe(before);
    expect(repo.readPaperTradeMeasurementHistory(first.ledger)).toMatchObject({ failedBatchCount: 0, unrecordedPointCount: 0 });
  });

  it('accepts semantically identical legacy JSON formatting without replacing its bytes', () => {
    const first = entry();
    repo.savePaperTradeMeasurementBatch(first.rows, first.ledger.trades);
    const filename = batchFiles()[0];
    const stored = JSON.parse(gunzipSync(fs.readFileSync(filename)).toString('utf8'));
    const reordered = { rows: stored.rows, recordedAt: stored.recordedAt, snapshotId: stored.snapshotId, schemaVersion: stored.schemaVersion };
    const bytes = gzipSync(JSON.stringify(reordered, null, 2));
    fs.writeFileSync(filename, bytes);
    expect(() => repo.savePaperTradeMeasurementBatch(first.rows, first.ledger.trades)).not.toThrow();
    expect(fs.readFileSync(filename)).toEqual(bytes);
    expect(repo.readPaperTradeMeasurementHistory(first.ledger).unrecordedPointCount).toBe(0);
  });

  it('rejects bad accounting or duplicate observations before creating files', () => {
    const first = entry();
    expect(() => repo.savePaperTradeMeasurementBatch([{ ...first.rows[0], netPnl: 100 }], first.ledger.trades))
      .toThrow('PAPER_TRADE_MEASUREMENT_INVALID');
    expect(() => repo.savePaperTradeMeasurementBatch([...first.rows, ...first.rows], first.ledger.trades))
      .toThrow('PAPER_TRADE_MEASUREMENT_INVALID');
    expect(fs.existsSync(repo.PAPER_TRADE_MEASUREMENT_DIR)).toBe(false);
  });

  it('keeps a crash gap visible through restart and later successful scans', async () => {
    const first = entry(); // Core summary was committed, but the process stopped before writing the batch.
    expect(repo.readPaperTradeMeasurementHistory(first.ledger)).toMatchObject({ unrecordedPointCount: 1, error: expect.any(String) });
    vi.resetModules(); repo = await import('./paperTradeMeasurementRepo.js');
    const second = observe(first.ledger, 5, 11000);
    repo.savePaperTradeMeasurementBatch(second.rows, second.ledger.trades);
    const third = observe(second.ledger, 10, 10500);
    repo.savePaperTradeMeasurementBatch(third.rows, third.ledger.trades);
    vi.resetModules(); repo = await import('./paperTradeMeasurementRepo.js');
    expect(repo.readPaperTradeMeasurementHistory(third.ledger)).toMatchObject({
      lastRecordedAt: '2026-09-18T01:10:00Z', unrecordedPointCount: 1, failedBatchCount: 0,
    });
  });

  it('persists known recording failures once and clears a missing batch only after a verified retry', async () => {
    const first = entry(), row = first.rows[0];
    for (let attempt = 0; attempt < 2; attempt++) repo.recordPaperTradeMeasurementFailure(
      row.snapshotId, row.recordedAt, first.rows.length, new Error('disk full'), first.ledger.trades);
    vi.resetModules(); repo = await import('./paperTradeMeasurementRepo.js');
    expect(repo.readPaperTradeMeasurementHistory(first.ledger)).toMatchObject({
      failedBatchCount: 1, unrecordedPointCount: 1, error: expect.stringContaining('disk full'),
    });
    repo.savePaperTradeMeasurementBatch(first.rows, first.ledger.trades);
    expect(repo.readPaperTradeMeasurementHistory(first.ledger)).toEqual({
      lastRecordedAt: row.recordedAt, failedBatchCount: 1, unrecordedPointCount: 0,
    });
  });

  it('does not erase an older failed batch when newer observations are saved', async () => {
    const first = entry();
    repo.recordPaperTradeMeasurementFailure('test-scan', first.rows[0].recordedAt, 1, new Error('disk full'), first.ledger.trades);
    const second = observe(first.ledger, 5, 11000);
    repo.savePaperTradeMeasurementBatch(second.rows, second.ledger.trades);
    vi.resetModules(); repo = await import('./paperTradeMeasurementRepo.js');
    expect(repo.readPaperTradeMeasurementHistory(second.ledger)).toMatchObject({
      lastRecordedAt: second.rows[0].recordedAt, failedBatchCount: 1, unrecordedPointCount: 1,
    });
  });

  it('preserves corrupt status bytes and reports unconfirmed storage without throwing from diagnostics', () => {
    const first = entry(), bytes = '{broken-status';
    fs.writeFileSync(repo.PAPER_TRADE_MEASUREMENT_STATUS_FILE, bytes);
    expect(() => repo.savePaperTradeMeasurementBatch(first.rows, first.ledger.trades)).toThrow();
    expect(() => repo.recordPaperTradeMeasurementFailure('test-scan', first.rows[0].recordedAt, 1, new Error('status unreadable'), first.ledger.trades))
      .not.toThrow();
    expect(fs.readFileSync(repo.PAPER_TRADE_MEASUREMENT_STATUS_FILE, 'utf8')).toBe(bytes);
    expect(repo.readPaperTradeMeasurementHistory(first.ledger)).toMatchObject({
      failedBatchCount: null, unrecordedPointCount: null, error: expect.stringContaining('읽을 수 없습니다'),
    });
    expect(batchFiles()).toHaveLength(1);
  });

  it('leaves legacy unmeasured trades explicitly without an invented history', () => {
    expect(repo.readPaperTradeMeasurementHistory(legacyStrategyLedger())).toEqual({
      lastRecordedAt: null, failedBatchCount: 0, unrecordedPointCount: 0,
    });
    repo.savePaperTradeMeasurementBatch([], legacyStrategyLedger().trades);
    expect(fs.readdirSync(dataDir)).toEqual([]);
  });
});
