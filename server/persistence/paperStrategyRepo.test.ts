// @responsibility Verify durable empirical Shadow strategy storage.
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { emptyStrategyLedger, matureStrategySamples, strategyTestCost, strategyTestSnapshot } from '../trading/paper/paperStrategyFixtures.js';
import { evaluatePaperStrategyScan } from '../trading/paper/paperStrategyPolicy.js';
import { paperEvidenceDigest } from '../trading/paper/paperStrategyEvidence.js';

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

  it('keeps pre-ADR-0680 evidence ID lists once in the cold archive and stores only their digest', () => {
    const samples = matureStrategySamples();
    const ids = samples.map(item => item.id);
    const ledger = evaluatePaperStrategyScan(emptyStrategyLedger(), samples, strategyTestSnapshot(), strategyTestCost);
    expect(ledger.trades[0].entryDecision.evidence!.experimentIdsDigest).toBe(paperEvidenceDigest(ids));
    const legacy = JSON.parse(JSON.stringify(ledger));
    for (const decision of [...legacy.latestDecisions, legacy.trades[0].entryDecision]) {
      delete decision.evidence.experimentIdsDigest;
      decision.evidence.experimentIds = [...ids].reverse();
    }
    fs.writeFileSync(repo.PAPER_STRATEGY_FILE, JSON.stringify(legacy, null, 2));
    const loaded = repo.loadPaperStrategyLedger();
    expect(loaded).toEqual(ledger);
    repo.savePaperStrategyLedger(loaded);
    const archive = JSON.parse(fs.readFileSync(repo.PAPER_STRATEGY_EVIDENCE_ARCHIVE_FILE, 'utf8'));
    expect(archive).toEqual({ schemaVersion: 1, lists: { [paperEvidenceDigest(ids)]: [...ids].sort() } });
    const stored = fs.readFileSync(repo.PAPER_STRATEGY_FILE, 'utf8');
    expect(stored).not.toContain('experimentIds"');
    expect(stored).not.toContain('\n');
    const archived = fs.readFileSync(repo.PAPER_STRATEGY_EVIDENCE_ARCHIVE_FILE, 'utf8');
    repo.savePaperStrategyLedger(repo.loadPaperStrategyLedger());
    expect(fs.readFileSync(repo.PAPER_STRATEGY_EVIDENCE_ARCHIVE_FILE, 'utf8')).toBe(archived);
  });

  it('keeps a legacy ledger untouched when the evidence archive is unreadable', () => {
    const samples = matureStrategySamples();
    const ledger = evaluatePaperStrategyScan(emptyStrategyLedger(), samples, strategyTestSnapshot(), strategyTestCost);
    const legacy = JSON.parse(JSON.stringify(ledger));
    delete legacy.trades[0].entryDecision.evidence.experimentIdsDigest;
    legacy.trades[0].entryDecision.evidence.experimentIds = samples.map(item => item.id);
    const bytes = JSON.stringify(legacy);
    fs.writeFileSync(repo.PAPER_STRATEGY_FILE, bytes);
    fs.writeFileSync(repo.PAPER_STRATEGY_EVIDENCE_ARCHIVE_FILE, JSON.stringify({ schemaVersion: 2 }));
    expect(() => repo.savePaperStrategyLedger(ledger)).toThrow('PAPER_STRATEGY_EVIDENCE_ARCHIVE_INVALID');
    expect(fs.readFileSync(repo.PAPER_STRATEGY_FILE, 'utf8')).toBe(bytes);
    fs.rmSync(repo.PAPER_STRATEGY_EVIDENCE_ARCHIVE_FILE);
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
