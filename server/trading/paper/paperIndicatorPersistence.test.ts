// @responsibility Verify invented indicator validation and frozen durable trade evidence.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import type { PaperAdaptiveCandidate, PaperAdaptiveEvidence, PaperAdaptiveState, PaperIndicatorInvention } from '../../../src/types/paperAdaptive.js';
import { createPaperIndicatorFormula, paperIndicatorFormulaId, PAPER_MAX_INVENTIONS } from '../../../src/types/paperIndicatorFormula.js';
import { adaptiveEvidenceSchema, adaptiveStateSchema, sameAdaptiveEvidence, explorationEvidenceSchema, sameExplorationEvidence } from './paperAdaptiveValidation.js';
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
function explorationLedger() {
  const snapshot = adaptiveTestSnapshot();
  const state = selectPaperAdaptiveState(undefined, [], snapshot.asOf, snapshot.observations);
  snapshot.id = 'exploration-entry'; snapshot.asOf = '2026-09-18T01:01:00Z';
  snapshot.observations[0].observedAt = snapshot.asOf;
  snapshot.observations[0].features!.asOf = snapshot.asOf;
  return evaluatePaperStrategyScan(emptyStrategyLedger(), snapshot, strategyTestCost, state);
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
    delete oldState.policy.maturityModel;
    delete oldState.horizonSamples;
    expect(adaptiveStateSchema.safeParse(oldState).success).toBe(true);
  });

  it('preserves per-horizon diagnostics and rejects invalid maturity models or inconsistent counts', () => {
    const state = inventedState();
    state.policy.maturityModel = 'per-horizon-v1';
    state.horizonSamples = [
      { horizon: 1, matureSampleCount: 100, matureDateCount: 20, trainingSampleCount: 60, trainingDateCount: 12, validationSampleCount: 20, validationDateCount: 4 },
      { horizon: 3, matureSampleCount: 80, matureDateCount: 16, trainingSampleCount: 40, trainingDateCount: 8, validationSampleCount: 20, validationDateCount: 4 },
      { horizon: 5, matureSampleCount: 0, matureDateCount: 0, trainingSampleCount: 0, trainingDateCount: 0, validationSampleCount: 0, validationDateCount: 0 },
    ];
    const before = structuredClone(state), parsed = adaptiveStateSchema.parse(state);
    expect(parsed.policy.maturityModel).toBe('per-horizon-v1');
    expect(parsed.horizonSamples).toEqual(state.horizonSamples);
    expect(state).toEqual(before);
    const mutations: Array<(value: any) => void> = [
      value => { value.policy.maturityModel = 'unknown-model'; },
      value => { value.horizonSamples.pop(); },
      value => { value.horizonSamples[1].horizon = 1; },
      value => { value.horizonSamples[0].trainingSampleCount = -1; },
      value => { value.horizonSamples[0].validationDateCount = 21; },
      value => { value.horizonSamples[0].trainingSampleCount = 90; },
      value => { value.horizonSamples[0].matureSampleCount = state.matureSampleCount + 1; },
    ];
    for (const mutate of mutations) {
      const changed = structuredClone(state); mutate(changed);
      expect(adaptiveStateSchema.safeParse(changed).success).toBe(false);
    }
  });

  it('retains the maturity model in new frozen evidence without adding it to older evidence', () => {
    const current = evidence(); current.policy.maturityModel = 'per-horizon-v1';
    const saved = compact(current), old = structuredClone(current);
    delete old.policy.maturityModel;
    expect(adaptiveEvidenceSchema.parse(current).policy.maturityModel).toBe('per-horizon-v1');
    expect(adaptiveEvidenceSchema.parse(saved).policy.maturityModel).toBe('per-horizon-v1');
    expect(adaptiveEvidenceSchema.parse(old).policy).not.toHaveProperty('maturityModel');
    expect(sameAdaptiveEvidence(current, saved)).toBe(true);
    expect(sameAdaptiveEvidence(current, old)).toBe(false);
    expect(adaptiveEvidenceSchema.safeParse({ ...current, policy: { ...current.policy, maturityModel: 'unknown-model' } }).success).toBe(false);
  });

  it('accepts a registered zero-sample exploration without weakening validated evidence', () => {
    const ledger = explorationLedger(), trial = ledger.adaptive!.exploration!.rules[0];
    const frozen = ledger.trades[0].entryDecision.explorationEvidence!;
    expect(trial.candidate.active).toBe(false);
    expect(trial.candidate.training.sampleCount).toBe(0);
    expect(adaptiveStateSchema.parse(ledger.adaptive).exploration).toEqual(ledger.adaptive!.exploration);
    expect(explorationEvidenceSchema.parse(frozen)).toEqual(frozen);
    expect(frozen.validationStartDate).toBeNull();
    expect(adaptiveEvidenceSchema.safeParse(frozen).success).toBe(false);
    expect(sameExplorationEvidence(frozen, compact(frozen))).toBe(true);
    expect(explorationEvidenceSchema.safeParse({ ...frozen, evaluatedAt: '2026-09-18T00:30:00Z' }).success).toBe(true);
    expect(adaptiveStateSchema.safeParse({ ...ledger.adaptive, exploration: { ...ledger.adaptive!.exploration,
      rules: [{ ...trial, registeredAt: '2026-09-18T01:02:00Z' }] } }).success).toBe(true);
    expect(() => assertPaperStrategyLedger(ledger)).not.toThrow();
  });

  it('rejects malformed exploration stages, identities and registration boundaries', () => {
    const original = explorationLedger();
    const mutations: Array<(value: any) => void> = [
      value => { value.adaptive.exploration.rules[0].candidate.active = true; },
      value => { value.adaptive.exploration.rules[0].candidate.reason = 'NO_VALIDATION_EDGE'; },
      value => { value.adaptive.exploration.rules.push(value.adaptive.exploration.rules[0]); },
      value => { value.adaptive.exploration.sequence = 0; },
      value => { value.adaptive.exploration.rules[0].id = 'arbitrary'; },
      value => { value.trades[0].entryDecision.explorationEvidence.registeredAt = value.trades[0].entryAt; },
      value => { value.trades[0].entryDecision.explorationEvidence.trialId += ':other'; },
      value => { value.trades[0].entryDecision.explorationEvidence.trialId = value.trades[0].entryDecision.explorationEvidence.trialId.replace(':1:', ':1:extra:'); },
      value => { value.trades[0].entryObservation.features.asOf = value.trades[0].entryDecision.explorationEvidence.registeredAt; },
      value => { value.trades[0].entryObservation.observedAt = value.trades[0].entryDecision.explorationEvidence.registeredAt; },
      value => { value.trades[0].entryDecision.adaptiveEvidence = evidence(); },
      value => { value.trades[0].entryDecision.reasonCode = 'ADAPTIVE_FEATURE_SELECTED'; },
    ];
    for (const mutate of mutations) {
      const changed = structuredClone(original); mutate(changed);
      expect(() => assertPaperStrategyLedger(changed)).toThrow('PAPER_STRATEGY_INVALID');
    }
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
  it('preserves exploration purpose and zero-sample evidence through restart, trial rotation, HOLD and EXIT', () => {
    const entered = explorationLedger();
    entered.trades[0].policy.exitModel = 'SCHEDULED_CLOSE';
    delete entered.trades[0].exitPolicy; delete entered.trades[0].exitResearch;
    const before = structuredClone(entered);
    repo.savePaperStrategyLedger(entered);
    expect(entered).toEqual(before);
    const restored = repo.loadPaperStrategyLedger(), frozen = compact(entered.trades[0].entryDecision.explorationEvidence!);
    expect(restored.adaptive!.exploration!.rules[0].candidate.training.experimentIds).toBeUndefined();
    expect(restored.trades[0].entryDecision.explorationEvidence).toEqual(frozen);
    const snapshot = adaptiveTestSnapshot();
    snapshot.id = 'exploration-hold'; snapshot.asOf = '2026-09-18T02:00:00Z';
    const next = selectPaperAdaptiveState(undefined, [], snapshot.asOf);
    const held = evaluatePaperStrategyScan(restored, snapshot, strategyTestCost, next);
    expect(held.latestDecisions[0].explorationEvidence).toEqual(frozen);
    repo.savePaperStrategyLedger(held);
    const changed = structuredClone(held);
    changed.latestDecisions[0].explorationEvidence!.trialId = changed.latestDecisions[0].explorationEvidence!.trialId.replace(':1:', ':2:');
    expect(() => assertPaperStrategyLedger(changed)).toThrow('PAPER_STRATEGY_INVALID');
    snapshot.id = 'exploration-exit'; snapshot.tradingDate = '2026-09-21'; snapshot.asOf = '2026-09-21T07:00:00Z'; snapshot.marketOpen = false;
    snapshot.observations[0].dailyCloses = [{ tradingDate: snapshot.tradingDate, close: 11000, availableAt: snapshot.asOf }];
    const closed = evaluatePaperStrategyScan(repo.loadPaperStrategyLedger(), snapshot, strategyTestCost, selectPaperAdaptiveState(next, [], snapshot.asOf));
    repo.savePaperStrategyLedger(closed);
    const result = repo.loadPaperStrategyLedger();
    expect(result.trades[0].status).toBe('CLOSED');
    expect(result.trades[0].exit!.decision.explorationEvidence).toEqual(frozen);
    expect(result.trades[0].entryDecision.adaptiveEvidence).toBeUndefined();
    result.trades[0].exit!.decision.explorationEvidence!.registeredAt = '2026-09-18T00:59:00Z';
    expect(() => assertPaperStrategyLedger(result)).toThrow('PAPER_STRATEGY_INVALID');
  });
  it('round-trips older ledgers without adding new maturity metadata to frozen entries', () => {
    const ledger = JSON.parse(JSON.stringify(entryLedger(), (key, value) =>
      key === 'maturityModel' || key === 'horizonSamples' ? undefined : value));
    const before = structuredClone(ledger);
    repo.savePaperStrategyLedger(ledger);
    const restored = repo.loadPaperStrategyLedger();
    expect(restored).toEqual(compact(ledger));
    expect(restored.adaptive!.policy).not.toHaveProperty('maturityModel');
    expect(restored.adaptive).not.toHaveProperty('horizonSamples');
    expect(restored.trades[0].entryDecision.adaptiveEvidence!.policy).not.toHaveProperty('maturityModel');
    expect(ledger).toEqual(before);
  });

  it('compacts every nested invention without mutating the caller or duplicating fresh IDs into the archive', () => {
    const ledger = entryLedger(), original = structuredClone(ledger);
    repo.savePaperStrategyLedger(ledger);
    expect(ledger).toEqual(original);
    expect(repo.loadPaperStrategyLedger()).toEqual(compact(ledger));
    expect(fs.readFileSync(repo.PAPER_STRATEGY_FILE, 'utf8')).not.toContain('experimentIds"');
    expect(fs.existsSync(repo.PAPER_STRATEGY_EVIDENCE_ARCHIVE_FILE)).toBe(false);
    const restored = repo.loadPaperStrategyLedger();
    expect(restored.adaptive!.policy.maturityModel).toBe('per-horizon-v1');
    expect(restored.adaptive!.horizonSamples).toEqual(ledger.adaptive!.horizonSamples);
    expect(restored.trades[0].entryDecision.adaptiveEvidence!.policy.maturityModel).toBe('per-horizon-v1');
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
    entered.trades[0].policy.exitModel = 'SCHEDULED_CLOSE';
    delete entered.trades[0].exitPolicy; delete entered.trades[0].exitResearch;
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
