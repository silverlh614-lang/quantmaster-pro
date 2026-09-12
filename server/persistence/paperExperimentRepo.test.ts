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
});
