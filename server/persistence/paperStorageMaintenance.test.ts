// @responsibility Verify safe Shadow retention with restart recovery.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { gzipSync, gunzipSync } from 'node:zlib';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { legacyStrategyLedger, matureStrategySamples, strategyTestSnapshot } from '../trading/paper/paperStrategyFixtures.js';
import { capturePaperTradeMeasurements } from '../trading/paper/paperTradeMeasurements.js';
import { buildPaperExperimentView } from '../trading/paper/paperExperimentPolicy.js';
import { selectPaperAdaptiveState } from '../trading/paper/paperAdaptiveSelection.js';
import { matureAdaptiveSamples } from '../trading/paper/paperAdaptiveFixtures.js';
import type { PaperExperimentLedger } from '../../src/types/paperExperiment.js';

let maintenance: typeof import('./paperStorageMaintenance.js');
let experiments: typeof import('./paperExperimentRepo.js');
let measurements: typeof import('./paperTradeMeasurementRepo.js');
let directory: string;
const root = path.resolve(os.tmpdir());
const now = new Date('2027-06-01T10:00:00.000Z');
const baseline = (): PaperExperimentLedger => ({ schemaVersion: 1, lastRun: null, experiments: matureStrategySamples() });
beforeEach(async () => {
  directory = fs.mkdtempSync(path.join(root, 'qmp-retention-'));
  vi.stubEnv('PERSIST_DATA_DIR', directory);
  vi.resetModules();
  maintenance = await import('./paperStorageMaintenance.js');
  experiments = await import('./paperExperimentRepo.js');
  measurements = await import('./paperTradeMeasurementRepo.js');
  vi.spyOn(console, 'error').mockImplementation(() => undefined);
});
afterEach(() => {
  vi.restoreAllMocks(); vi.unstubAllEnvs();
  if (directory && path.dirname(path.resolve(directory)) === root) fs.rmSync(directory, { recursive: true, force: true });
});

function historicalBatch() {
  const ledger = legacyStrategyLedger();
  const rows = capturePaperTradeMeasurements(ledger, strategyTestSnapshot());
  measurements.savePaperTradeMeasurementBatch(rows, ledger.trades);
  const trade = ledger.trades[0];
  trade.status = 'CLOSED';
  trade.exit = { model: 'SCHEDULED_CLOSE', snapshotId: 'exit', effectiveAt: '2026-09-23T06:30:00Z',
    observedAt: '2026-09-23T06:30:00Z', decisionAt: '2026-09-23T06:30:00Z', price: 11000,
    grossReturnPct: 10, netReturnPct: 10, netPnl: 1000,
    decision: { ...trade.entryDecision, snapshotId: 'exit', decisionAt: '2026-09-23T06:30:00Z', action: 'EXIT' } };
  // Sixty later entry dates move the old trade outside the protected window.
  for (let i = 0; i < 60; i++) {
    const date = new Date(Date.UTC(2026, 9, 1 + i)).toISOString().slice(0, 10);
    const snapshot = strategyTestSnapshot();
    snapshot.id = `later-${date}`; snapshot.tradingDate = date; snapshot.asOf = `${date}T01:00:00Z`;
    snapshot.observations[0].observedAt = snapshot.asOf;
    ledger.trades.push(...legacyStrategyLedger(snapshot).trades);
  }
  const day = path.join(measurements.PAPER_TRADE_MEASUREMENT_DIR, '2026-09-18');
  return { ledger, trade, file: path.join(day, fs.readdirSync(day)[0]) };
}

describe('Shadow storage maintenance', () => {
  it('compresses losslessly across restart, preserving learned selection and cumulative outcomes', async () => {
    experiments.savePaperExperimentLedger({ ...baseline(), experiments: matureAdaptiveSamples() });
    const before = experiments.loadPaperExperimentLedger();
    const view = buildPaperExperimentView(before);
    const selection = selectPaperAdaptiveState(undefined, before.experiments, now.toISOString());
    expect(selection.candidates.some(candidate => candidate.active)).toBe(true);
    const result = experiments.compressPaperExperimentMonths('2027-06');
    expect(result.months).toBeGreaterThan(0); expect(result.bytesSaved).toBeGreaterThan(0);
    vi.resetModules(); experiments = await import('./paperExperimentRepo.js');
    const restored = experiments.loadPaperExperimentLedger();
    expect(restored).toEqual(before);
    expect(buildPaperExperimentView(restored)).toEqual(view);
    expect(selectPaperAdaptiveState(undefined, restored.experiments, now.toISOString())).toEqual(selection);
    experiments.savePaperExperimentLedger(restored);
    expect(experiments.loadPaperExperimentLedger()).toEqual(before);
    experiments.compressPaperExperimentMonths('2027-06');
    expect(experiments.loadPaperExperimentLedger()).toEqual(before);
  });

  it('recovers identical compression copies but refuses conflicting archives', () => {
    experiments.savePaperExperimentLedger(baseline());
    const plain = path.join(directory, 'paper-experiments-completed-2026-09.json');
    fs.writeFileSync(`${plain}.gz`, gzipSync(fs.readFileSync(plain)));
    expect(experiments.loadPaperExperimentLedger().experiments).toHaveLength(12);
    experiments.savePaperExperimentLedger(experiments.loadPaperExperimentLedger());
    expect(fs.existsSync(plain)).toBe(false);
    fs.writeFileSync(plain, gunzipSync(fs.readFileSync(`${plain}.gz`)));
    fs.writeFileSync(`${plain}.gz`, gzipSync('{"schemaVersion":1,"experiments":[]}'));
    expect(() => experiments.compressPaperExperimentMonths('2027-06')).toThrow('COMPRESSION_CONFLICT');
    expect(fs.existsSync(plain)).toBe(true);
  });

  it('retires only aged completed detail, preserving core history and idempotent daily accounting', async () => {
    const { ledger, file } = historicalBatch();
    const core = structuredClone(ledger), history = measurements.readPaperTradeMeasurementHistory(ledger);
    maintenance.runPaperStorageMaintenance(baseline(), ledger, now, false);
    expect(fs.existsSync(file)).toBe(false);
    expect(ledger).toEqual(core);
    expect(measurements.readPaperTradeMeasurementHistory(ledger)).toEqual(history);
    expect(maintenance.readPaperStorageMaintenance()).toMatchObject({ deletedBatches: 1, deletedPoints: 1, errors: [] });
    vi.resetModules(); maintenance = await import('./paperStorageMaintenance.js');
    maintenance.runPaperStorageMaintenance(baseline(), ledger, now, false);
    expect(maintenance.readPaperStorageMaintenance().deletedBatches).toBe(1);
  });

  it.each(['open', 'recent', 'window', 'research', 'unknown', 'corrupt', 'missing'] as const)('protects %s detail', kind => {
    const { ledger, trade, file } = historicalBatch();
    if (kind === 'open') { trade.status = 'OPEN'; trade.exit = null; }
    if (kind === 'recent') trade.exit!.decisionAt = '2027-05-01T01:00:00Z';
    if (kind === 'window') ledger.trades = [trade];
    if (kind === 'research') trade.policy.exitModel = 'ADAPTIVE_OBSERVED';
    if (kind === 'unknown') ledger.trades = ledger.trades.slice(1);
    if (kind === 'corrupt') fs.writeFileSync(file, 'corrupt');
    if (kind === 'missing') fs.unlinkSync(measurements.PAPER_TRADE_MEASUREMENT_STATUS_FILE);
    const before = fs.readFileSync(file);
    maintenance.runPaperStorageMaintenance(baseline(), ledger, now, false);
    expect(fs.readFileSync(file)).toEqual(before);
    expect(maintenance.readPaperStorageMaintenance().deletedBatches).toBe(0);
  });

  it('does no maintenance while the market is open or before 90 days have elapsed', () => {
    const { ledger, file } = historicalBatch();
    maintenance.runPaperStorageMaintenance(baseline(), ledger, now, true);
    expect(maintenance.readPaperStorageMaintenance().lastRunAt).toBeNull();
    maintenance.runPaperStorageMaintenance(baseline(), ledger, new Date('2026-10-03T10:00:00Z'), false);
    expect(fs.existsSync(file)).toBe(true);
    expect(maintenance.readPaperStorageMaintenance().checkedBatches).toBe(0);
  });

  it('reconciles an interrupted deletion once without changing recording diagnostics', () => {
    const { ledger, file } = historicalBatch();
    maintenance.runPaperStorageMaintenance(baseline(), ledger, new Date('2026-10-03T10:00:00Z'), false);
    const statusFile = path.join(directory, 'paper-storage-maintenance.json');
    const state = JSON.parse(fs.readFileSync(statusFile, 'utf8'));
    state.pending = { file: path.relative(measurements.PAPER_TRADE_MEASUREMENT_DIR, file).split(path.sep).join('/'),
      bytes: fs.statSync(file).size, points: 1 };
    fs.writeFileSync(statusFile, JSON.stringify(state)); fs.unlinkSync(file);
    maintenance.runPaperStorageMaintenance(baseline(), ledger, now, false);
    expect(maintenance.readPaperStorageMaintenance()).toMatchObject({ deletedBatches: 1, deletedPoints: 1, errors: [] });
    expect(measurements.readPaperTradeMeasurementHistory(ledger).unrecordedPointCount).toBe(0);
  });

  it('does not follow a linked archive directory', () => {
    const { ledger, file } = historicalBatch();
    const day = path.dirname(file), moved = path.join(directory, 'protected-original');
    // Both resolved paths are direct children of this isolated test workspace.
    expect(path.dirname(path.resolve(moved))).toBe(path.resolve(directory));
    expect(path.resolve(day).startsWith(`${path.resolve(directory)}${path.sep}`)).toBe(true);
    fs.renameSync(day, moved); fs.symlinkSync(moved, day, 'junction');
    maintenance.runPaperStorageMaintenance(baseline(), ledger, now, false);
    expect(fs.existsSync(path.join(moved, path.basename(file)))).toBe(true);
    expect(maintenance.readPaperStorageMaintenance().deletedBatches).toBe(0);
  });

  it('bounds daily work and advances past protected or damaged batches the next day', () => {
    const { ledger, file } = historicalBatch();
    const day = path.dirname(file);
    for (let index = 0; index < 1001; index++) {
      fs.writeFileSync(path.join(day, `${index.toString(16).padStart(64, '0')}.json.gz`), 'damaged');
    }
    maintenance.runPaperStorageMaintenance(baseline(), ledger, now, false);
    expect(maintenance.readPaperStorageMaintenance()).toMatchObject({ checkedBatches: 1000, deletedBatches: 0 });
    expect(fs.existsSync(file)).toBe(true);
    maintenance.runPaperStorageMaintenance(baseline(), ledger, new Date('2027-06-02T10:00:00Z'), false);
    expect(fs.existsSync(file)).toBe(false);
    expect(maintenance.readPaperStorageMaintenance()).toMatchObject({ checkedBatches: 1000, deletedBatches: 1 });
    expect(fs.readdirSync(day)).toHaveLength(1001);
  }, 30_000);

  it('preserves an entire mixed batch when one trade remains open', () => {
    const { ledger, file } = historicalBatch();
    const open = legacyStrategyLedger();
    open.trades[0].id += ':mixed';
    open.trades[0].entryDecision.tradeId = open.trades[0].id;
    open.latestDecisions[0].tradeId = open.trades[0].id;
    const rows = capturePaperTradeMeasurements(open, strategyTestSnapshot());
    expect(rows).toHaveLength(1);
    const batch = JSON.parse(gunzipSync(fs.readFileSync(file)).toString('utf8'));
    batch.rows.push(...rows); ledger.trades.push(...open.trades);
    fs.writeFileSync(file, gzipSync(JSON.stringify(batch)));
    const status = JSON.parse(fs.readFileSync(measurements.PAPER_TRADE_MEASUREMENT_STATUS_FILE, 'utf8'));
    status.accountedPointCount = 2;
    fs.writeFileSync(measurements.PAPER_TRADE_MEASUREMENT_STATUS_FILE, JSON.stringify(status));
    maintenance.runPaperStorageMaintenance(baseline(), ledger, now, false);
    expect(fs.existsSync(file)).toBe(true);
    expect(maintenance.readPaperStorageMaintenance()).toMatchObject({ deletedBatches: 0, protectedBatches: 1, errors: [] });
  });
});
