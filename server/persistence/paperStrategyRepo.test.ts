// @responsibility Verify durable empirical Shadow strategy storage.
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { emptyStrategyLedger, matureStrategySamples, strategyTestCost, strategyTestSnapshot } from '../trading/paper/paperStrategyFixtures.js';
import { evaluatePaperStrategyScan } from '../trading/paper/paperStrategyPolicy.js';

let repo: typeof import('./paperStrategyRepo.js');
let temporaryRoot: string;
let testDataDir: string;
beforeAll(async () => {
  temporaryRoot = path.resolve(process.env.PERSIST_DATA_DIR ?? os.tmpdir());
  fs.mkdirSync(temporaryRoot, { recursive: true });
  testDataDir = fs.mkdtempSync(path.join(temporaryRoot, 'strategy-repo-'));
  vi.stubEnv('PERSIST_DATA_DIR', testDataDir);
  vi.resetModules();
  repo = await import('./paperStrategyRepo.js');
});
afterAll(() => {
  vi.unstubAllEnvs();
  if (testDataDir && path.dirname(path.resolve(testDataDir)) === temporaryRoot) fs.rmSync(testDataDir, { recursive: true, force: true });
});

describe('strategy ledger persistence', () => {
  it('loads an absent ledger as empty and round-trips frozen open and closed trades', async () => {
    expect(repo.loadPaperStrategyLedger()).toEqual(emptyStrategyLedger());
    let ledger = evaluatePaperStrategyScan(emptyStrategyLedger(), matureStrategySamples(), strategyTestSnapshot(), strategyTestCost);
    repo.savePaperStrategyLedger(ledger);
    expect(repo.loadPaperStrategyLedger()).toEqual(ledger);
    vi.resetModules();
    repo = await import('./paperStrategyRepo.js');
    const snapshot = strategyTestSnapshot();
    snapshot.asOf = '2026-09-23T07:00:00Z'; snapshot.tradingDate = '2026-09-23'; snapshot.marketOpen = false;
    snapshot.observations[0].dailyCloses = [{ tradingDate: '2026-09-23', close: 11000, availableAt: snapshot.asOf }];
    ledger = evaluatePaperStrategyScan(repo.loadPaperStrategyLedger(), matureStrategySamples(), snapshot, strategyTestCost);
    repo.savePaperStrategyLedger(ledger);
    expect(repo.loadPaperStrategyLedger()).toEqual(ledger);
    expect(fs.readdirSync(testDataDir)).toEqual(['paper-strategy.json']);
  });

  it('preserves the existing bytes when a new ledger is inconsistent', () => {
    const before = fs.readFileSync(repo.PAPER_STRATEGY_FILE, 'utf8');
    const ledger = repo.loadPaperStrategyLedger();
    ledger.trades[0].exit!.netPnl = 12345;
    expect(() => repo.savePaperStrategyLedger(ledger)).toThrow('PAPER_STRATEGY_INVALID');
    expect(fs.readFileSync(repo.PAPER_STRATEGY_FILE, 'utf8')).toBe(before);
  });

  it('does not reconstruct or overwrite a corrupt strategy ledger', () => {
    for (const bytes of ['{broken', JSON.stringify({ ...emptyStrategyLedger(), trades: [{ id: 'invalid' }] })]) {
      fs.writeFileSync(repo.PAPER_STRATEGY_FILE, bytes);
      expect(() => repo.loadPaperStrategyLedger()).toThrow('PAPER_STRATEGY_UNREADABLE');
      expect(() => repo.savePaperStrategyLedger(emptyStrategyLedger())).toThrow('PAPER_STRATEGY_UNREADABLE');
      expect(fs.readFileSync(repo.PAPER_STRATEGY_FILE, 'utf8')).toBe(bytes);
    }
  });
});
