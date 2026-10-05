// @responsibility Propose bounded indicator formulas before their forward observations exist.
import { PAPER_FEATURES, type PaperFeatureKey } from '../../../src/types/paperObservationFeatures.js';
import { createPaperIndicatorFormula, paperIndicatorFormulaId, PAPER_MAX_INVENTIONS,
  type PaperIndicatorFormula, type PaperIndicatorComposition } from '../../../src/types/paperIndicatorFormula.js';
import type { PaperAdaptiveCandidate, PaperAdaptiveState, PaperAdaptiveStats, PaperIndicatorDiscovery,
  PaperIndicatorInvention } from '../../../src/types/paperAdaptive.js';
import { paperEvidenceDigest } from './paperStrategyEvidence.js';

export const PAPER_DISCOVERY_DAILY_ATTEMPTS = 24;
export const PAPER_DISCOVERY_DAILY_PROPOSALS = 2;
export const PAPER_DISCOVERY_RETIREMENT_DATES = 20;
export const PAPER_DISCOVERY_REFRESH_DATES = 20;
const features = (Object.keys(PAPER_FEATURES) as PaperFeatureKey[]).sort();
const formulas = features.flatMap((left, index) => features.slice(index + 1).flatMap(right =>
  (['MEAN', 'DIFFERENCE', 'PRODUCT'] as const).map(operation => createPaperIndicatorFormula(operation, left, right))));

export function paperIndicatorFormulaUniverse(): PaperIndicatorComposition[] { return structuredClone(formulas); }

interface DiscoveryInput {
  previous: PaperAdaptiveState | undefined; asOf: string; cutoffAt: string;
  candidates: PaperAdaptiveCandidate[]; trainingDates: string[];
  sufficientInputs: (formula: PaperIndicatorFormula) => boolean;
  evaluateTraining: (formula: PaperIndicatorFormula) => PaperAdaptiveCandidate | null;
  forwardDateCount: (invention: PaperIndicatorInvention) => number;
}

export function discoverPaperIndicators(input: DiscoveryInput): {
  discovery: PaperIndicatorDiscovery; created: PaperIndicatorInvention[]; retired: PaperIndicatorInvention[];
} {
  const discovery: PaperIndicatorDiscovery = structuredClone(input.previous?.discovery
    ?? { version: 'indicator-discovery-v1', attemptedIds: [], inventions: [], round: 1,
      roundStartedAt: input.asOf, roundTrainingEndDate: input.trainingDates.at(-1) ?? null });
  if (!discovery.roundTrainingEndDate && input.trainingDates.length) {
    discovery.roundTrainingEndDate = input.trainingDates.at(-1)!; discovery.roundStartedAt = input.asOf;
  }
  const available = formulas.filter(formula => input.sufficientInputs(formula));
  const retainedAtStart = new Set(discovery.inventions.map(item => item.id));
  let attempted = new Set(discovery.attemptedIds);
  // A retained formula already completed discovery; an entirely retained search space can still begin a fresh round.
  if (available.length && available.every(formula => attempted.has(paperIndicatorFormulaId(formula)) || retainedAtStart.has(paperIndicatorFormulaId(formula)))
    && discovery.roundTrainingEndDate && input.trainingDates.filter(date => date > discovery.roundTrainingEndDate!).length >= PAPER_DISCOVERY_REFRESH_DATES) {
    discovery.round++; discovery.roundStartedAt = input.asOf;
    discovery.roundTrainingEndDate = input.trainingDates.at(-1)!;
    discovery.attemptedIds = []; attempted = new Set();
  }
  const retired: PaperIndicatorInvention[] = [];
  const removable = discovery.inventions.filter(invention => {
    const current = input.candidates.find(item => item.rule.feature === invention.id);
    // Retire proven failures even before the registry fills; missing inputs or ranking alone are not failures.
    return current?.reason === 'NO_VALIDATION_EDGE' && !current.active
      && current.validation.sampleCount >= 10 && current.validation.dateCount >= 3
      && !input.previous?.candidates.some(item => item.active && item.rule.feature === invention.id)
      && input.forwardDateCount(invention) >= PAPER_DISCOVERY_RETIREMENT_DATES;
  });
  if (removable.length) {
    removable.sort((a, b) => {
      const validation = (id: string) => input.candidates.find(item => item.rule.feature === id)?.validation.meanDailyExcessPct ?? -Infinity;
      return validation(a.id) - validation(b.id) || a.createdAt.localeCompare(b.createdAt) || a.id.localeCompare(b.id);
    });
    retired.push(...removable.slice(0, PAPER_DISCOVERY_DAILY_PROPOSALS));
    const removed = new Set(retired.map(item => item.id));
    discovery.inventions = discovery.inventions.filter(item => !removed.has(item.id));
  }
  const room = Math.min(PAPER_DISCOVERY_DAILY_PROPOSALS, PAPER_MAX_INVENTIONS - discovery.inventions.length);
  if (!room) return { discovery, created: [], retired };
  const retainedIds = new Set(discovery.inventions.map(item => item.id));
  const eligible = available.filter(formula => !retainedIds.has(paperIndicatorFormulaId(formula)));
  const evaluated: PaperAdaptiveCandidate[] = [];
  let inspected = 0;
  for (const formula of eligible) {
    const id = paperIndicatorFormulaId(formula);
    if (attempted.has(id)) continue;
    attempted.add(id); discovery.attemptedIds.push(id);
    const candidate = input.evaluateTraining(formula);
    if (candidate) evaluated.push(candidate);
    if (++inspected === PAPER_DISCOVERY_DAILY_ATTEMPTS) break;
  }
  // The callback contains only the purged training period; forward evidence cannot select a new formula.
  const ranked = evaluated.filter(item => item.training.sampleCount >= 10 && item.training.dateCount >= 3
    && (item.training.meanNetReturnPct ?? 0) > 0 && (item.training.meanDailyExcessPct ?? 0) > 0)
    .sort((a, b) => b.training.meanDailyExcessPct! - a.training.meanDailyExcessPct!
      || a.rule.horizon - b.rule.horizon || a.rule.feature.localeCompare(b.rule.feature));
  const sampleKey = (item: { rule: { horizon: number }; training: PaperAdaptiveStats }) => `${item.rule.horizon}:${item.training.experimentIdsDigest
    ?? paperEvidenceDigest(item.training.experimentIds ?? [])}`;
  const selectedKeys = new Set(discovery.inventions.map(item => sampleKey(item)));
  const distinct: PaperAdaptiveCandidate[] = [];
  for (const candidate of ranked) {
    const key = sampleKey(candidate);
    if (selectedKeys.has(key)) continue;
    selectedKeys.add(key); distinct.push(candidate);
    if (distinct.length === room) break;
  }
  const created = distinct.map(item => {
    const formula = formulas.find(value => paperIndicatorFormulaId(value) === item.rule.feature)!;
    return { id: paperIndicatorFormulaId(formula), formula: structuredClone(formula), createdAt: input.asOf,
      discoveryCutoffAt: input.cutoffAt, rule: { bucket: item.rule.bucket, horizon: item.rule.horizon },
      training: structuredClone(item.training) };
  });
  discovery.inventions.push(...created);
  return { discovery, created, retired };
}
