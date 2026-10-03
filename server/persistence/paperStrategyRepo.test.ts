// @responsibility Verify durable empirical Shadow strategy storage.
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { emptyStrategyLedger, legacyStrategyLedger, matureStrategySamples, strategyTestCost, strategyTestSnapshot } from '../trading/paper/paperStrategyFixtures.js';
import { evaluatePaperStrategyScan } from '../trading/paper/paperStrategyPolicy.js';
import { paperEvidenceDigest } from '../trading/paper/paperStrategyEvidence.js';
import { adaptiveTestSnapshot, matureAdaptiveSamples } from '../trading/paper/paperAdaptiveFixtures.js';
import { selectPaperAdaptiveState } from '../trading/paper/paperAdaptiveSelection.js';
import { capturePaperTradeMeasurements } from '../trading/paper/paperTradeMeasurements.js';

const compactExpected = <T>(value: T): T => JSON.parse(JSON.stringify(value, (_key, item) =>
  item && Array.isArray(item.experimentIds)
    ? { ...item, experimentIds: undefined, experimentIdsDigest: paperEvidenceDigest(item.experimentIds) } : item));

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
    let ledger = legacyStrategyLedger();
    repo.savePaperStrategyLedger(ledger);
    expect(repo.loadPaperStrategyLedger()).toEqual(ledger);
    vi.resetModules();
    repo = await import('./paperStrategyRepo.js');
    const snapshot = strategyTestSnapshot();
    snapshot.asOf = '2026-09-23T07:00:00Z'; snapshot.tradingDate = '2026-09-23'; snapshot.marketOpen = false;
    snapshot.observations[0].dailyCloses = [{ tradingDate: '2026-09-23', close: 11000, availableAt: snapshot.asOf }];
    ledger = evaluatePaperStrategyScan(repo.loadPaperStrategyLedger(), snapshot, strategyTestCost,
      selectPaperAdaptiveState(undefined, [], snapshot.asOf));
    repo.savePaperStrategyLedger(ledger);
    expect(repo.loadPaperStrategyLedger()).toEqual(compactExpected(ledger));
    expect(fs.readdirSync(testDataDir)).toEqual(['paper-strategy.json']);
  });

  it('preserves the existing bytes when a new ledger is inconsistent', () => {
    const before = fs.readFileSync(repo.PAPER_STRATEGY_FILE, 'utf8');
    const ledger = repo.loadPaperStrategyLedger();
    ledger.trades[0].exit!.netPnl = 12345;
    expect(() => repo.savePaperStrategyLedger(ledger)).toThrow('PAPER_STRATEGY_INVALID');
    expect(fs.readFileSync(repo.PAPER_STRATEGY_FILE, 'utf8')).toBe(before);
  });

  it('round-trips adaptive state and frozen entry evidence through restart, disconnection and scheduled exit', async () => {
    const samples = matureAdaptiveSamples(), snapshot = adaptiveTestSnapshot();
    const adaptive = selectPaperAdaptiveState(undefined, samples, snapshot.asOf);
    const entered = evaluatePaperStrategyScan(emptyStrategyLedger(), snapshot, strategyTestCost, adaptive);
    entered.trades[0].policy.exitModel = 'SCHEDULED_CLOSE'; delete entered.trades[0].exitPolicy; delete entered.trades[0].exitResearch;
    const originalEntry = structuredClone(entered);
    const frozenEntry = compactExpected(entered.trades[0].entryDecision.adaptiveEvidence!);
    repo.savePaperStrategyLedger(entered);
    expect(entered).toEqual(originalEntry);
    expect(fs.existsSync(repo.PAPER_STRATEGY_EVIDENCE_ARCHIVE_FILE)).toBe(false);
    vi.resetModules();
    repo = await import('./paperStrategyRepo.js');
    const restored = repo.loadPaperStrategyLedger();
    expect(restored).toEqual(compactExpected(entered));
    expect(restored.adaptive).toEqual(compactExpected(adaptive));
    expect(restored.trades[0].entryDecision.adaptiveEvidence).toEqual(frozenEntry);

    const heldSnapshot = adaptiveTestSnapshot();
    heldSnapshot.id = 'adaptive-hold'; heldSnapshot.asOf = '2026-09-21T01:00:00Z'; heldSnapshot.tradingDate = '2026-09-21';
    heldSnapshot.observations[0].observedAt = heldSnapshot.asOf;
    heldSnapshot.observations[0].features!.asOf = heldSnapshot.asOf;
    const disconnected = selectPaperAdaptiveState(restored.adaptive, [], heldSnapshot.asOf);
    const held = evaluatePaperStrategyScan(restored, heldSnapshot, strategyTestCost, disconnected);
    expect(held.adaptive!.candidates.some(candidate => candidate.active)).toBe(false);
    expect(held.trades[0]).toEqual(restored.trades[0]);
    repo.savePaperStrategyLedger(held);
    expect(repo.loadPaperStrategyLedger()).toEqual(compactExpected(held));

    const exitSnapshot = adaptiveTestSnapshot();
    exitSnapshot.id = 'adaptive-exit'; exitSnapshot.asOf = '2026-09-23T07:00:00Z';
    exitSnapshot.tradingDate = '2026-09-23'; exitSnapshot.marketOpen = false;
    exitSnapshot.observations[0].dailyCloses = [{ tradingDate: '2026-09-23', close: 11000, availableAt: exitSnapshot.asOf }];
    const retired = selectPaperAdaptiveState(disconnected, [], exitSnapshot.asOf);
    const closed = evaluatePaperStrategyScan(repo.loadPaperStrategyLedger(), exitSnapshot, strategyTestCost, retired);
    repo.savePaperStrategyLedger(closed);
    vi.resetModules();
    repo = await import('./paperStrategyRepo.js');
    const restoredClosed = repo.loadPaperStrategyLedger();
    expect(restoredClosed).toEqual(compactExpected(closed));
    expect(restoredClosed.trades[0].exit!.decision.adaptiveEvidence).toEqual(frozenEntry);
    expect(restoredClosed.trades[0].exit).toMatchObject({ effectiveAt: '2026-09-23T06:30:00.000Z', price: 11000, netPnl: 1000 });
    expect(fs.readFileSync(repo.PAPER_STRATEGY_FILE, 'utf8')).not.toContain('\n');
    expect(fs.readFileSync(repo.PAPER_STRATEGY_FILE, 'utf8')).not.toContain('experimentIds"');
  });

  it('compacts exploratory trial and frozen entry evidence through storage, holding and scheduled exit', async () => {
    const snapshot = adaptiveTestSnapshot();
    const registration = structuredClone(snapshot);
    registration.asOf = '2026-09-18T00:59:00Z';
    registration.observations[0].observedAt = registration.asOf;
    registration.observations[0].features!.asOf = registration.asOf;
    const adaptive = selectPaperAdaptiveState(undefined, matureAdaptiveSamples({ entryDateCount: 4 }),
      registration.asOf, registration.observations);
    const entered = evaluatePaperStrategyScan(emptyStrategyLedger(), snapshot, strategyTestCost, adaptive);
    entered.trades[0].policy.exitModel = 'SCHEDULED_CLOSE'; delete entered.trades[0].exitPolicy; delete entered.trades[0].exitResearch;
    expect(entered.trades).toHaveLength(1);
    expect(entered.trades[0].entryDecision.explorationEvidence).toBeDefined();
    expect(adaptive.exploration!.rules[0].candidate.training.experimentIds!.length).toBeGreaterThan(0);
    repo.savePaperStrategyLedger(entered);
    vi.resetModules(); repo = await import('./paperStrategyRepo.js');
    const restored = repo.loadPaperStrategyLedger();
    expect(restored).toEqual(compactExpected(entered));
    expect(fs.readFileSync(repo.PAPER_STRATEGY_FILE, 'utf8')).not.toContain('experimentIds"');
    const held = evaluatePaperStrategyScan(restored, snapshot, strategyTestCost, adaptive);
    repo.savePaperStrategyLedger(held);
    expect(repo.loadPaperStrategyLedger().latestDecisions[0].explorationEvidence)
      .toEqual(restored.trades[0].entryDecision.explorationEvidence);
    const exitDate = entered.trades[0].scheduledExitDate;
    snapshot.tradingDate = exitDate; snapshot.asOf = `${exitDate}T07:00:00Z`; snapshot.marketOpen = false;
    snapshot.observations[0].dailyCloses = [{ tradingDate: exitDate, close: 11000, availableAt: snapshot.asOf }];
    const closed = evaluatePaperStrategyScan(repo.loadPaperStrategyLedger(), snapshot, strategyTestCost,
      selectPaperAdaptiveState(undefined, [], snapshot.asOf));
    repo.savePaperStrategyLedger(closed);
    vi.resetModules(); repo = await import('./paperStrategyRepo.js');
    expect(repo.loadPaperStrategyLedger()).toEqual(compactExpected(closed));
    expect(repo.loadPaperStrategyLedger().trades[0].exit!.decision.explorationEvidence)
      .toEqual(restored.trades[0].entryDecision.explorationEvidence);
  });

  it('round-trips the real observed-exit policy, research and frozen trigger through restart', async () => {
    const snapshot = adaptiveTestSnapshot();
    const adaptive = selectPaperAdaptiveState(undefined, matureAdaptiveSamples(), snapshot.asOf);
    let ledger = evaluatePaperStrategyScan(emptyStrategyLedger(), snapshot, strategyTestCost, adaptive);
    capturePaperTradeMeasurements(ledger, snapshot);
    const frozenPolicy = structuredClone(ledger.trades[0].exitPolicy);
    repo.savePaperStrategyLedger(ledger);
    vi.resetModules(); repo = await import('./paperStrategyRepo.js');
    ledger = repo.loadPaperStrategyLedger();
    expect(ledger.trades[0].exitPolicy).toEqual(frozenPolicy);
    for (const [at, price] of [['2026-09-18T01:01:00Z', 10050], ['2026-09-18T01:02:00Z', 9400]] as const) {
      snapshot.id = `observed-${at}`; snapshot.asOf = at;
      snapshot.observations[0].observedAt = at; snapshot.observations[0].features!.asOf = at; snapshot.observations[0].price = price;
      ledger = evaluatePaperStrategyScan(ledger, snapshot, strategyTestCost, adaptive);
      expect(capturePaperTradeMeasurements(ledger, snapshot)).toHaveLength(1);
      repo.savePaperStrategyLedger(ledger);
      vi.resetModules(); repo = await import('./paperStrategyRepo.js');
      expect(repo.loadPaperStrategyLedger()).toEqual(compactExpected(ledger));
      ledger = repo.loadPaperStrategyLedger();
    }
    expect(ledger.trades[0].exitPolicy).toEqual(frozenPolicy);
    expect(ledger.trades[0].exit).toMatchObject({ model: 'ADAPTIVE_OBSERVED', price: 9400,
      observedTrigger: { reason: 'ADAPTIVE_STOP_LOSS', peakNetReturnPct: 0.5 }, observedQuote: { price: 9400 } });
    expect(ledger.trades[0].exitResearch!.quoteCount).toBe(2);
    expect(ledger.trades[0].measurement).toMatchObject({ pointCount: 3, latest: { kind: 'ADAPTIVE_EXIT' }, highest: { price: 10050 } });
  });

  it('preserves captured measurements through restart, later holding extrema and confirmed exit', async () => {
    const snapshot = adaptiveTestSnapshot();
    snapshot.observations[0].observedAt = '2026-09-18T00:59:55Z';
    const adaptive = selectPaperAdaptiveState(undefined, matureAdaptiveSamples(), snapshot.asOf);
    const cost = { version: 'entry-frozen', buyFeeRate: 0.001, sellFeeRate: 0.002, sellTaxRate: 0.003, slippageRate: 0.004 };
    let ledger = evaluatePaperStrategyScan(emptyStrategyLedger(), snapshot, () => cost, adaptive);
    ledger.trades[0].policy.exitModel = 'SCHEDULED_CLOSE'; delete ledger.trades[0].exitPolicy; delete ledger.trades[0].exitResearch;
    expect(capturePaperTradeMeasurements(ledger, snapshot)).toHaveLength(1);
    const entry = structuredClone(ledger.trades[0].measurement);
    const frozenDecision = compactExpected(ledger.trades[0].entryDecision);
    repo.savePaperStrategyLedger(ledger);
    vi.resetModules(); repo = await import('./paperStrategyRepo.js');
    ledger = repo.loadPaperStrategyLedger();
    expect(ledger.trades[0].measurement).toEqual(entry);
    expect(entry).toMatchObject({ fromEntry: true, pointCount: 1, latest: { kind: 'ENTRY', netPnl: -140 } });

    for (const [at, price] of [['2026-09-18T01:01:00Z', 11000], ['2026-09-18T01:02:00Z', 9000]] as const) {
      snapshot.id = `measured-${at}`; snapshot.asOf = at;
      snapshot.observations[0].observedAt = at; snapshot.observations[0].price = price;
      snapshot.observations[0].features!.asOf = at;
      ledger = evaluatePaperStrategyScan(ledger, snapshot, strategyTestCost, adaptive);
      expect(capturePaperTradeMeasurements(ledger, snapshot)).toHaveLength(1);
      const expected = compactExpected(ledger);
      repo.savePaperStrategyLedger(ledger);
      ledger = repo.loadPaperStrategyLedger();
      expect(ledger).toEqual(expected);
    }
    expect(ledger.trades[0].measurement).toMatchObject({ pointCount: 3, latest: { kind: 'QUOTE', price: 9000 },
      highest: { price: 11000, observedAt: '2026-09-18T01:01:00Z', netPnl: 851 },
      lowest: { price: 9000, observedAt: '2026-09-18T01:02:00Z', netPnl: -1131 } });

    snapshot.id = 'measured-close'; snapshot.tradingDate = ledger.trades[0].scheduledExitDate;
    snapshot.asOf = `${snapshot.tradingDate}T07:00:00Z`; snapshot.marketOpen = false;
    snapshot.observations[0].dailyCloses = [{ tradingDate: snapshot.tradingDate, close: 10500, availableAt: snapshot.asOf }];
    ledger = evaluatePaperStrategyScan(ledger, snapshot, strategyTestCost, selectPaperAdaptiveState(undefined, [], snapshot.asOf));
    expect(capturePaperTradeMeasurements(ledger, snapshot)).toHaveLength(1);
    repo.savePaperStrategyLedger(ledger);
    vi.resetModules(); repo = await import('./paperStrategyRepo.js');
    const restored = repo.loadPaperStrategyLedger();
    expect(restored).toEqual(compactExpected(ledger));
    expect(restored.trades[0].entryDecision).toEqual(frozenDecision);
    expect(restored.trades[0].measurement).toMatchObject({ fromEntry: true, pointCount: 4,
      latest: { kind: 'SCHEDULED_CLOSE', price: 10500, effectiveAt: restored.trades[0].scheduledExitAt,
        observedAt: snapshot.asOf, recordedAt: snapshot.asOf, netPnl: 355.5 },
      highest: { price: 11000 }, lowest: { price: 9000 } });
    expect(restored.trades[0].exit!.netPnl).toBe(355.5);
  });

  it('keeps pre-ADR-0680 evidence ID lists once in the cold archive and stores only their digest', () => {
    const samples = matureStrategySamples();
    const ids = samples.map(item => item.id);
    const ledger = legacyStrategyLedger();
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
    const ledger = legacyStrategyLedger();
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

  it('archives existing adaptive ID lists once while preserving their compact state and decision evidence', () => {
    const samples = matureAdaptiveSamples(), snapshot = adaptiveTestSnapshot();
    const adaptive = selectPaperAdaptiveState(undefined, samples, snapshot.asOf);
    const ledger = evaluatePaperStrategyScan(emptyStrategyLedger(), snapshot, strategyTestCost, adaptive);
    fs.writeFileSync(repo.PAPER_STRATEGY_FILE, JSON.stringify(ledger));
    const loaded = repo.loadPaperStrategyLedger();
    expect(loaded).toEqual(compactExpected(ledger));
    repo.savePaperStrategyLedger(loaded);
    const archive = JSON.parse(fs.readFileSync(repo.PAPER_STRATEGY_EVIDENCE_ARCHIVE_FILE, 'utf8'));
    const active = adaptive.candidates.find(candidate => candidate.active)!;
    for (const stats of [active.training, active.validation]) {
      expect(archive.lists[paperEvidenceDigest(stats.experimentIds!)]).toEqual([...stats.experimentIds!].sort());
    }
    expect(repo.loadPaperStrategyLedger()).toEqual(loaded);
    expect(fs.readFileSync(repo.PAPER_STRATEGY_FILE, 'utf8')).not.toContain('experimentIds"');
    const archived = fs.readFileSync(repo.PAPER_STRATEGY_EVIDENCE_ARCHIVE_FILE, 'utf8');
    repo.savePaperStrategyLedger(repo.loadPaperStrategyLedger());
    expect(fs.readFileSync(repo.PAPER_STRATEGY_EVIDENCE_ARCHIVE_FILE, 'utf8')).toBe(archived);
  });

  it('rejects overlapping adaptive training and validation IDs before disk evidence is compacted', () => {
    const samples = matureAdaptiveSamples(), snapshot = adaptiveTestSnapshot();
    const ledger = evaluatePaperStrategyScan(emptyStrategyLedger(), snapshot, strategyTestCost,
      selectPaperAdaptiveState(undefined, samples, snapshot.asOf));
    const candidate = ledger.trades[0].entryDecision.adaptiveEvidence!.candidate;
    candidate.validation.experimentIds![0] = candidate.training.experimentIds![0];
    const bytes = JSON.stringify(ledger);
    fs.writeFileSync(repo.PAPER_STRATEGY_FILE, bytes);
    expect(() => repo.loadPaperStrategyLedger()).toThrow('PAPER_STRATEGY_UNREADABLE');
    expect(() => repo.savePaperStrategyLedger(emptyStrategyLedger())).toThrow('PAPER_STRATEGY_UNREADABLE');
    expect(fs.readFileSync(repo.PAPER_STRATEGY_FILE, 'utf8')).toBe(bytes);
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
