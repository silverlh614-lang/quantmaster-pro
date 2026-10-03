// @responsibility Verify invented indicator validation and frozen durable trade evidence.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import type { PaperAdaptiveCandidate, PaperAdaptiveEvidence, PaperAdaptiveState, PaperIndicatorInvention } from '../../../src/types/paperAdaptive.js';
import { createPaperIndicatorFormula, paperIndicatorFormulaId, PAPER_MAX_INVENTIONS } from '../../../src/types/paperIndicatorFormula.js';
import { adaptiveEvidenceSchema, adaptiveStateSchema, sameAdaptiveEvidence } from './paperAdaptiveValidation.js';
import { adaptiveTestSnapshot, matureAdaptiveSamples } from './paperAdaptiveFixtures.js';
import { selectPaperAdaptiveState } from './paperAdaptiveSelection.js';
import { paperIndicatorFormulaUniverse } from './paperIndicatorDiscovery.js';
import { emptyStrategyLedger, strategyTestCost } from './paperStrategyFixtures.js';
import { evaluatePaperStrategyScan } from './paperStrategyPolicy.js';
import { assertPaperStrategyLedger } from './paperStrategyValidation.js';
import { paperEvidenceDigest } from './paperStrategyEvidence.js';

const asOf = '2026-09-18T01:00:00Z';
const createdAt = '2026-08-03T01:00:00Z';
const compact = <T>(value: T): T => JSON.parse(JSON.stringify(value, (_key, item) =>
  item && Array.isArray(item.experimentIds)
    ? { ...item, experimentIds: undefined, experimentIdsDigest: paperEvidenceDigest(item.experimentIds) } : item));
const invented = (state: PaperAdaptiveState) => state.candidates.find(item => item.rule.invention)!;

/** The learner's forward behavior is tested separately; this fixture isolates the persisted contract. */
function inventedState(): PaperAdaptiveState {
  const earlier = selectPaperAdaptiveState(undefined,
    matureAdaptiveSamples({ startDate: '2026-06-01', entryDateCount: 32 }), createdAt);
  const state = selectPaperAdaptiveState(undefined, matureAdaptiveSamples(), asOf);
  const base = state.candidates.find(item => item.rule.feature === 'rsi14')!;
  const training = structuredClone(earlier.candidates.find(item => item.rule.feature === 'rsi14')!.training);
  const formula = createPaperIndicatorFormula('MEAN', 'rsi14', 'volumeRatio20');
  const definition: PaperIndicatorInvention = { id: paperIndicatorFormulaId(formula), formula,
    createdAt, discoveryCutoffAt: '2026-08-02T15:00:00.000Z', rule: { bucket: 1, horizon: 3 }, training };
  const candidate: PaperAdaptiveCandidate = { rule: { feature: definition.id, ...definition.rule, invention: structuredClone(definition) },
    training: structuredClone(training), validation: structuredClone(base.validation), active: true, reason: 'ACTIVE' };
  base.active = false; base.reason = 'RANKED_OUT';
  state.candidates.unshift(candidate);
  state.discovery = { version: 'indicator-discovery-v1', round: 1, roundStartedAt: createdAt,
    roundTrainingEndDate: '2026-07-01', attemptedIds: [definition.id], inventions: [definition] };
  state.changes = [{ at: createdAt, feature: definition.id, from: null, to: structuredClone(candidate.rule), reason: 'FORWARD_OBSERVATION' },
    { at: asOf, feature: definition.id, from: null, to: structuredClone(candidate.rule), reason: 'ACTIVE' }];
  return state;
}
function entryLedger() {
  const snapshot = adaptiveTestSnapshot();
  snapshot.observations[0].features!.values.volumeRatio20 = 1;
  return evaluatePaperStrategyScan(emptyStrategyLedger(), snapshot, strategyTestCost, inventedState());
}
function evidence(): PaperAdaptiveEvidence {
  return entryLedger().trades[0].entryDecision.adaptiveEvidence!;
}

describe('invented indicator persisted contracts', () => {
  it('accepts self-contained frozen evidence and pre-discovery base states', () => {
    const state = inventedState(), ledger = entryLedger();
    expect(adaptiveStateSchema.safeParse(state).success).toBe(true);
    expect(adaptiveEvidenceSchema.safeParse(evidence()).success).toBe(true);
    expect(ledger.trades).toHaveLength(1);
    expect(ledger.trades[0].entryDecision.adaptiveEvidence!.candidate.rule.invention).toEqual(state.discovery!.inventions[0]);
    delete ledger.adaptive;
    expect(() => assertPaperStrategyLedger(ledger)).not.toThrow();
    const oldState = selectPaperAdaptiveState(undefined, matureAdaptiveSamples(), asOf);
    delete oldState.discovery;
    expect(adaptiveStateSchema.safeParse(oldState).success).toBe(true);
  });

  it('rejects missing definitions, malformed identities and unsafe formulas without executing anything', () => {
    const original = evidence();
    const mutations: Array<(value: any) => void> = [
      value => { delete value.candidate.rule.invention; },
      value => { value.candidate.rule.feature = 'invented:mean:rsi14:unknown'; },
      value => { value.candidate.rule.invention.id = 'invented:product:rsi14:volumeRatio20'; },
      value => { value.candidate.rule.invention.formula.operation = 'EVAL'; },
      value => { value.candidate.rule.invention.formula.left.scale = 0; },
      value => { value.candidate.rule.invention.formula.left.center = 49; },
      value => { value.candidate.rule.invention.formula.left.feature = 'constructor'; },
      value => { value.candidate.rule.invention.formula.left = structuredClone(value.candidate.rule.invention.formula); },
      value => { value.candidate.rule.invention.formula.right = structuredClone(value.candidate.rule.invention.formula.left); },
      value => { value.candidate.rule.bucket = 0; },
      value => { value.candidate.rule.horizon = 5; },
    ];
    for (const mutate of mutations) {
      const changed = structuredClone(original); mutate(changed);
      expect(adaptiveEvidenceSchema.safeParse(changed).success).toBe(false);
    }
  });

  it('rejects candidate training inconsistent with the frozen discovery evidence', () => {
    const changed = evidence(); changed.candidate.training.meanDailyExcessPct! += 0.1;
    expect(adaptiveEvidenceSchema.safeParse(changed).success).toBe(false);
    const state = inventedState(); state.discovery!.inventions[0].training.meanNetReturnPct! += 0.1;
    expect(adaptiveStateSchema.safeParse(state).success).toBe(false);
    const mismatch = evidence(); mismatch.candidate.validation.experimentIds![0] = mismatch.candidate.training.experimentIds![0];
    expect(adaptiveEvidenceSchema.safeParse(mismatch).success).toBe(false);
  });

  it('requires discovery before evaluation and entry validation strictly after creation', () => {
    const state = inventedState();
    for (const definition of [state.discovery!.inventions[0], invented(state).rule.invention!]) {
      definition.createdAt = '2026-09-19T01:00:00Z'; definition.discoveryCutoffAt = '2026-09-18T15:00:00.000Z';
    }
    expect(adaptiveStateSchema.safeParse(state).success).toBe(false);
    const beforeCreation = evidence(); beforeCreation.validationStartDate = '2026-08-03';
    expect(adaptiveEvidenceSchema.safeParse(beforeCreation).success).toBe(false);
    const futureRound = inventedState(); futureRound.discovery!.roundStartedAt = '2026-09-19T01:00:00Z';
    expect(adaptiveStateSchema.safeParse(futureRound).success).toBe(false);
  });

  it('rejects duplicate definitions, repeated attempts and an oversized research pool', () => {
    const duplicate = inventedState(); duplicate.discovery!.inventions.push(structuredClone(duplicate.discovery!.inventions[0]));
    expect(adaptiveStateSchema.safeParse(duplicate).success).toBe(false);
    const attempts = inventedState(); attempts.discovery!.attemptedIds.push(attempts.discovery!.attemptedIds[0]);
    expect(adaptiveStateSchema.safeParse(attempts).success).toBe(false);
    const oversized = inventedState(), source = invented(oversized);
    oversized.candidates = oversized.candidates.filter(item => !item.rule.invention);
    oversized.discovery!.inventions = paperIndicatorFormulaUniverse().slice(0, PAPER_MAX_INVENTIONS + 1).map(formula => ({
      ...structuredClone(source.rule.invention!), id: paperIndicatorFormulaId(formula), formula }));
    oversized.discovery!.attemptedIds = oversized.discovery!.inventions.map(item => item.id);
    for (const definition of oversized.discovery!.inventions) oversized.candidates.push({ ...structuredClone(source), active: false,
      reason: 'RANKED_OUT', rule: { feature: definition.id, ...definition.rule, invention: structuredClone(definition) } });
    expect(adaptiveStateSchema.safeParse(oversized).success).toBe(false);
  });

  it('compares full and compact nested training evidence while detecting changed formulas', () => {
    const full = evidence(), saved = compact(full);
    expect(sameAdaptiveEvidence(full, saved)).toBe(true);
    saved.candidate.rule.invention!.formula.operation = 'PRODUCT';
    expect(sameAdaptiveEvidence(full, saved)).toBe(false);
  });

  it('rejects a frozen entry whose observation is missing an operand or no longer matches its formula', () => {
    const missing = entryLedger(); missing.trades[0].entryObservation.features!.values.volumeRatio20 = null;
    expect(() => assertPaperStrategyLedger(missing)).toThrow('PAPER_STRATEGY_INVALID');
    const altered = entryLedger(); altered.trades[0].entryObservation.features!.values.volumeRatio20 = 10;
    expect(() => assertPaperStrategyLedger(altered)).toThrow('PAPER_STRATEGY_INVALID');
  });
});

let repo: typeof import('../../persistence/paperStrategyRepo.js');
let temporaryRoot: string, testDataDir: string;
beforeAll(async () => {
  temporaryRoot = path.resolve(os.tmpdir());
  testDataDir = fs.mkdtempSync(path.join(temporaryRoot, 'indicator-repo-'));
  vi.stubEnv('PERSIST_DATA_DIR', testDataDir);
  vi.resetModules();
  repo = await import('../../persistence/paperStrategyRepo.js');
});
beforeEach(() => {
  for (const file of [repo.PAPER_STRATEGY_FILE, repo.PAPER_STRATEGY_EVIDENCE_ARCHIVE_FILE]) {
    if (fs.existsSync(file)) fs.unlinkSync(file);
  }
});
afterAll(() => {
  vi.unstubAllEnvs();
  if (testDataDir && path.dirname(path.resolve(testDataDir)) === temporaryRoot) fs.rmSync(testDataDir, { recursive: true, force: true });
});

describe('invented indicator durable trade lifecycle', () => {
  it('compacts every nested invention without mutating the caller or duplicating fresh IDs into the archive', () => {
    const ledger = entryLedger(), original = structuredClone(ledger);
    repo.savePaperStrategyLedger(ledger);
    expect(ledger).toEqual(original);
    expect(repo.loadPaperStrategyLedger()).toEqual(compact(ledger));
    expect(fs.readFileSync(repo.PAPER_STRATEGY_FILE, 'utf8')).not.toContain('experimentIds"');
    expect(fs.existsSync(repo.PAPER_STRATEGY_EVIDENCE_ARCHIVE_FILE)).toBe(false);
    const restored = repo.loadPaperStrategyLedger();
    const digest = paperEvidenceDigest(invented(ledger.adaptive!).training.experimentIds!);
    expect(restored.adaptive!.discovery!.inventions[0].training.experimentIdsDigest).toBe(digest);
    expect(invented(restored.adaptive!).rule.invention!.training.experimentIdsDigest).toBe(digest);
    expect(restored.adaptive!.changes[0].to!.invention!.training.experimentIdsDigest).toBe(digest);
    expect(restored.trades[0].entryDecision.adaptiveEvidence!.candidate.rule.invention!.training.experimentIdsDigest).toBe(digest);
  });

  it('archives existing full discovery and historical-change evidence once before compaction', () => {
    const ledger = entryLedger();
    const retiredRule = structuredClone(invented(ledger.adaptive!).rule);
    retiredRule.invention!.formula = createPaperIndicatorFormula('PRODUCT', 'rsi14', 'volumeRatio20');
    retiredRule.feature = retiredRule.invention!.id = paperIndicatorFormulaId(retiredRule.invention!.formula);
    const historicalIds = retiredRule.invention!.training.experimentIds!.map(id => `retired-${id}`);
    retiredRule.invention!.training.experimentIds = historicalIds;
    ledger.adaptive!.changes.push({ at: asOf, feature: retiredRule.feature, from: retiredRule, to: null, reason: 'DISCOVERY_RETIRED' });
    fs.writeFileSync(repo.PAPER_STRATEGY_FILE, JSON.stringify(ledger));
    const loaded = repo.loadPaperStrategyLedger();
    expect(loaded).toEqual(compact(ledger));
    repo.savePaperStrategyLedger(loaded);
    const archived = fs.readFileSync(repo.PAPER_STRATEGY_EVIDENCE_ARCHIVE_FILE, 'utf8');
    const archive = JSON.parse(archived);
    const ids = ledger.adaptive!.discovery!.inventions[0].training.experimentIds!;
    expect(archive.lists[paperEvidenceDigest(ids)]).toEqual([...ids].sort());
    expect(archive.lists[paperEvidenceDigest(historicalIds)]).toEqual([...historicalIds].sort());
    repo.savePaperStrategyLedger(repo.loadPaperStrategyLedger());
    expect(fs.readFileSync(repo.PAPER_STRATEGY_EVIDENCE_ARCHIVE_FILE, 'utf8')).toBe(archived);
    expect(fs.readFileSync(repo.PAPER_STRATEGY_FILE, 'utf8')).not.toContain('experimentIds"');
  });

  it('preserves entry arithmetic through restart, definition retirement, a new research round, HOLD and EXIT', async () => {
    const entered = entryLedger(), frozen = compact(entered.trades[0].entryDecision.adaptiveEvidence!);
    repo.savePaperStrategyLedger(entered);
    vi.resetModules(); repo = await import('../../persistence/paperStrategyRepo.js');
    const snapshot = adaptiveTestSnapshot();
    snapshot.id = 'invented-hold'; snapshot.asOf = '2026-09-21T01:00:00Z'; snapshot.tradingDate = '2026-09-21';
    snapshot.observations[0].observedAt = snapshot.asOf; snapshot.observations[0].features!.asOf = snapshot.asOf;
    const retired = selectPaperAdaptiveState(undefined, [], snapshot.asOf);
    retired.discovery = { version: 'indicator-discovery-v1', round: 2, roundStartedAt: snapshot.asOf,
      roundTrainingEndDate: null, attemptedIds: [], inventions: [] };
    retired.changes = [{ at: snapshot.asOf, feature: frozen.candidate.rule.feature,
      from: structuredClone(frozen.candidate.rule), to: null, reason: 'DISCOVERY_RETIRED' }];
    const held = evaluatePaperStrategyScan(repo.loadPaperStrategyLedger(), snapshot, strategyTestCost, retired);
    expect(held.latestDecisions[0]).toMatchObject({ action: 'HOLD', adaptiveEvidence: frozen });
    expect(held.adaptive!.discovery!.inventions).toHaveLength(0);
    repo.savePaperStrategyLedger(held);

    snapshot.id = 'invented-exit'; snapshot.asOf = '2026-09-23T07:00:00Z'; snapshot.tradingDate = '2026-09-23'; snapshot.marketOpen = false;
    snapshot.observations[0].dailyCloses = [{ tradingDate: '2026-09-23', close: 11000, availableAt: snapshot.asOf }];
    const current = selectPaperAdaptiveState(retired, [], snapshot.asOf);
    const closed = evaluatePaperStrategyScan(repo.loadPaperStrategyLedger(), snapshot, strategyTestCost, current);
    repo.savePaperStrategyLedger(closed);
    vi.resetModules(); repo = await import('../../persistence/paperStrategyRepo.js');
    const restored = repo.loadPaperStrategyLedger();
    expect(restored.trades[0].status).toBe('CLOSED');
    expect(restored.trades[0].entryDecision.adaptiveEvidence).toEqual(frozen);
    expect(restored.trades[0].exit!.decision.adaptiveEvidence).toEqual(frozen);
    expect(restored.trades[0].exit).toMatchObject({ effectiveAt: '2026-09-23T06:30:00.000Z', price: 11000, netPnl: 1000 });
    expect(restored).toEqual(compact(closed));
  });

  it('keeps durable bytes intact when a nested discovery definition is corrupted', () => {
    const ledger = entryLedger(); repo.savePaperStrategyLedger(ledger);
    const before = fs.readFileSync(repo.PAPER_STRATEGY_FILE, 'utf8');
    ledger.adaptive!.discovery!.inventions[0].formula.left.scale = 123;
    expect(() => repo.savePaperStrategyLedger(ledger)).toThrow('PAPER_STRATEGY_INVALID');
    expect(fs.readFileSync(repo.PAPER_STRATEGY_FILE, 'utf8')).toBe(before);
    const corrupt = JSON.parse(before); corrupt.trades[0].entryDecision.adaptiveEvidence.candidate.rule.invention.formula.left.scale = 123;
    fs.writeFileSync(repo.PAPER_STRATEGY_FILE, JSON.stringify(corrupt));
    const corruptBytes = fs.readFileSync(repo.PAPER_STRATEGY_FILE, 'utf8');
    expect(() => repo.loadPaperStrategyLedger()).toThrow('PAPER_STRATEGY_UNREADABLE');
    expect(() => repo.savePaperStrategyLedger(emptyStrategyLedger())).toThrow('PAPER_STRATEGY_UNREADABLE');
    expect(fs.readFileSync(repo.PAPER_STRATEGY_FILE, 'utf8')).toBe(corruptBytes);
  });
});
