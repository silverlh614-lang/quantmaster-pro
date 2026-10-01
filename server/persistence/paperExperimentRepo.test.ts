// @responsibility Verify durable paper experiment storage.
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
let repo: typeof import('./paperExperimentRepo.js');
let testDataDir: string;
beforeAll(async () => {
  const base = process.env.PERSIST_DATA_DIR ?? os.tmpdir();
  fs.mkdirSync(base, { recursive: true });
  testDataDir = fs.mkdtempSync(path.join(base, 'paper-repo-'));
  vi.stubEnv('PERSIST_DATA_DIR', testDataDir);
  vi.resetModules();
  repo = await import('./paperExperimentRepo.js');
});
afterAll(() => {
  vi.unstubAllEnvs();
  if (testDataDir) fs.rmSync(testDataDir, { recursive: true, force: true });
});

describe('paper ledger repository', () => {
  it('round-trips an atomic ledger without leaving temporary files', () => {
    const ledger = { schemaVersion: 1 as const, experiments: [], lastRun: null };
    repo.savePaperExperimentLedger(ledger);
    expect(repo.loadPaperExperimentLedger()).toEqual(ledger);
    expect(fs.readdirSync(path.dirname(repo.PAPER_EXPERIMENT_FILE))).toEqual(['paper-experiments.json']);
  });

  it('surfaces malformed or corrupt persisted data and preserves its bytes', () => {
    for (const bytes of ['{broken', JSON.stringify({ schemaVersion: 1, experiments: [{ id: 'invalid' }], lastRun: null })]) {
      fs.writeFileSync(repo.PAPER_EXPERIMENT_FILE, bytes);
      expect(() => repo.loadPaperExperimentLedger()).toThrow('PAPER_LEDGER_UNREADABLE');
      expect(() => repo.savePaperExperimentLedger({ schemaVersion: 1, experiments: [], lastRun: null })).toThrow('PAPER_LEDGER_UNREADABLE');
      expect(fs.readFileSync(repo.PAPER_EXPERIMENT_FILE, 'utf8')).toBe(bytes);
    }
  });

  const record = (symbol: string, tradingDate: string, status: 'OPEN' | 'COMPLETED') => ({
    id: `shadow-baseline-v1:${tradingDate}:${symbol}`, strategyVersion: 'shadow-baseline-v1' as const, snapshotId: 's', symbol, name: symbol,
    entryAt: `${tradingDate}T01:00:00.000Z`, tradingDate, entryPrice: 1000, quantity: 1 as const,
    entryObservation: { symbol, name: symbol, price: 1000, observedAt: `${tradingDate}T01:00:00.000Z`, source: 'KIS_REST_REQUEST_OBSERVED',
      return1dPct: null, return5dPct: null, aboveMa20: null, news: [], dailyCloses: [] },
    costModel: { version: 'v', buyFeeRate: 0, sellFeeRate: 0, sellTaxRate: 0, slippageRate: 0 }, status,
    outcomes: status === 'COMPLETED' ? [{ horizon: 5 as const, tradingDate, availableAt: `${tradingDate}T07:00:00.000Z`, exitPrice: 1010, grossReturnPct: 1, netReturnPct: 1, netPnl: 10 }] : [],
  });
  const reset = () => { for (const name of fs.readdirSync(testDataDir)) fs.rmSync(path.join(testDataDir, name)); };
  const lastRun = (asOf: string) => ({ snapshotId: asOf, asOf, candidateCount: 1, durationMs: 1, observedCount: 1, openedCount: 0,
    completedCount: 0, missingPriceCount: 0, marketOpen: true, issues: [] });

  it('keeps completed experiments in monthly files and rewrites only what changed', () => {
    reset();
    const ledger = { schemaVersion: 1 as const, lastRun: lastRun('2026-09-30T01:00:00.000Z'),
      experiments: [record('000001', '2026-08-31', 'COMPLETED'), record('000002', '2026-09-01', 'COMPLETED'), record('000003', '2026-09-30', 'OPEN')] };
    repo.savePaperExperimentLedger(ledger);
    expect(fs.readdirSync(testDataDir).sort()).toEqual(['paper-experiments-completed-2026-08.json', 'paper-experiments-completed-2026-09.json',
      'paper-experiments-run.json', 'paper-experiments.json']);
    expect(JSON.parse(fs.readFileSync(repo.PAPER_EXPERIMENT_FILE, 'utf8')).experiments.map((item: { symbol: string }) => item.symbol)).toEqual(['000003']);
    expect(repo.loadPaperExperimentLedger()).toEqual(ledger);
    const bytes = (name: string) => fs.readFileSync(path.join(testDataDir, name), 'utf8');
    const before = { open: bytes('paper-experiments.json'), august: bytes('paper-experiments-completed-2026-08.json') };
    // A minute later only the scan summary changes.
    const next = repo.loadPaperExperimentLedger();
    next.lastRun = lastRun('2026-09-30T01:01:00.000Z');
    repo.savePaperExperimentLedger(next);
    expect(bytes('paper-experiments.json')).toBe(before.open);
    expect(bytes('paper-experiments-completed-2026-08.json')).toBe(before.august);
    expect(repo.loadPaperExperimentLedger().lastRun?.asOf).toBe('2026-09-30T01:01:00.000Z');
    // The open record completes: it moves to its month and leaves the open file.
    const done = repo.loadPaperExperimentLedger();
    done.experiments = done.experiments.map((item) => item.symbol === '000003' ? record('000003', '2026-09-30', 'COMPLETED') : item);
    repo.savePaperExperimentLedger(done);
    expect(JSON.parse(fs.readFileSync(repo.PAPER_EXPERIMENT_FILE, 'utf8')).experiments).toEqual([]);
    expect(bytes('paper-experiments-completed-2026-08.json')).toBe(before.august);
    expect(repo.loadPaperExperimentLedger().experiments.map((item) => [item.symbol, item.status])).toEqual([
      ['000001', 'COMPLETED'], ['000002', 'COMPLETED'], ['000003', 'COMPLETED']]);
  });

  it('reads a pre-ADR-0681 single file and splits it on the next save', () => {
    reset();
    const legacy = { schemaVersion: 1, lastRun: lastRun('2026-09-30T01:00:00.000Z'),
      experiments: [record('000001', '2026-08-31', 'COMPLETED'), record('000003', '2026-09-30', 'OPEN')] };
    fs.writeFileSync(repo.PAPER_EXPERIMENT_FILE, JSON.stringify(legacy, null, 2));
    const loaded = repo.loadPaperExperimentLedger();
    expect(loaded).toEqual(legacy);
    repo.savePaperExperimentLedger(loaded);
    expect(JSON.parse(fs.readFileSync(repo.PAPER_EXPERIMENT_FILE, 'utf8')).experiments.map((item: { symbol: string }) => item.symbol)).toEqual(['000003']);
    expect(repo.loadPaperExperimentLedger()).toEqual(legacy);
  });

  it('prefers the completed copy after an interrupted move and never drops stored completed records', () => {
    reset();
    const completed = record('000001', '2026-08-31', 'COMPLETED');
    fs.writeFileSync(path.join(testDataDir, 'paper-experiments-completed-2026-08.json'),
      JSON.stringify({ schemaVersion: 1, month: '2026-08', experiments: [completed, record('000009', '2026-08-03', 'COMPLETED')] }));
    fs.writeFileSync(repo.PAPER_EXPERIMENT_FILE, JSON.stringify({ schemaVersion: 1, lastRun: null, experiments: [record('000001', '2026-08-31', 'OPEN')] }));
    const loaded = repo.loadPaperExperimentLedger();
    expect(loaded.experiments.map((item) => [item.symbol, item.status])).toEqual([['000009', 'COMPLETED'], ['000001', 'COMPLETED']]);
    repo.savePaperExperimentLedger({ ...loaded, experiments: loaded.experiments.filter((item) => item.symbol === '000001') });
    expect(repo.loadPaperExperimentLedger().experiments).toHaveLength(2);
  });

  it('refuses to save over an unreadable monthly file and keeps its bytes', () => {
    reset();
    const file = path.join(testDataDir, 'paper-experiments-completed-2026-08.json');
    fs.writeFileSync(file, '{broken');
    expect(() => repo.loadPaperExperimentLedger()).toThrow('PAPER_LEDGER_UNREADABLE');
    expect(() => repo.savePaperExperimentLedger({ schemaVersion: 1, experiments: [record('000001', '2026-08-31', 'COMPLETED')], lastRun: null }))
      .toThrow('PAPER_LEDGER_UNREADABLE');
    expect(fs.readFileSync(file, 'utf8')).toBe('{broken');
  });
});
