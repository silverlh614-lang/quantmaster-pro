// @responsibility Verify persisted autonomy evidence rejects inconsistent decisions.
import { describe, expect, it } from 'vitest';
import type { PaperAdaptiveRule } from '../../../src/types/paperAdaptive.js';
import type { PaperAutonomyAllocation, PaperAutonomyState, PaperAutonomyStats } from '../../../src/types/paperAutonomy.js';
import { paperEvidenceDigest } from './paperStrategyEvidence.js';
import { paperAutonomyAllocationSchema, paperAutonomyStateSchema, validPaperAutonomyAllocation } from './paperAutonomyValidation.js';

const evaluatedAt = '2026-10-06T00:05:00.000Z', cutoffAt = '2026-10-05T15:00:00.000Z';
const rule: PaperAdaptiveRule = { feature: 'rsi14', bucket: 1, horizon: 1 };
function stats(overrides: Partial<PaperAutonomyStats> = {}): PaperAutonomyStats {
  return { totalCount: 14, closedCount: 12, pendingCount: 2, sampleCount: 10, dateCount: 3,
    meanNetReturnPct: 0.5, meanDateNetReturnPct: 0.6, standardErrorPct: 0.1,
    tradeIdsDigest: paperEvidenceDigest(Array.from({ length: 14 }, (_, i) => `trade-${i}`)), ...overrides };
}
function state(): PaperAutonomyState {
  return { version: 'shadow-autonomy-v1', evaluatedAt, cutoffAt, status: 'READY',
    entries: [{ ruleKey: 'rsi14:1:D1', lastSelectedAt: evaluatedAt, reason: 'INCREASE', weight: 3, stats: stats() },
      { ruleKey: 'volumeRatio20:2:D3', lastSelectedAt: '2026-10-04T00:05:00.000Z', reason: 'REDUCE', weight: 1,
        stats: stats({ meanDateNetReturnPct: -0.6 }) }], selectedRuleKeys: ['rsi14:1:D1'] };
}
function allocation(): PaperAutonomyAllocation {
  return { version: 'shadow-autonomy-v1', evaluatedAt, cutoffAt, method: 'OUTCOME_WEIGHTED',
    selectedRuleKey: 'rsi14:1:D1', baselineRuleKey: 'volumeRatio20:2:D3', choices: [
      { ruleKey: 'rsi14:1:D1', purpose: 'EXPLORATION', reason: 'INCREASE', weight: 3, stats: stats() },
      { ruleKey: 'volumeRatio20:2:D3', purpose: 'VALIDATED', reason: 'FIXED_VALIDATED', weight: 2 },
    ] };
}
describe('autonomy state persistence', () => {
  it('accepts selected chronology, uncertain evidence, empty evidence, explicit controller fallback', () => {
    expect(paperAutonomyStateSchema.safeParse(state()).success).toBe(true);
    const next = state();
    next.entries[0] = { ...next.entries[0], reason: 'MAINTAIN', weight: 2, stats: stats({ meanDateNetReturnPct: 0.1 }) };
    expect(paperAutonomyStateSchema.safeParse(next).success).toBe(true);
    next.entries[0] = { ...next.entries[0], reason: 'EXPLORE', stats: stats({ totalCount: 0, closedCount: 0, pendingCount: 0,
      sampleCount: 0, dateCount: 0, meanNetReturnPct: null, meanDateNetReturnPct: null, standardErrorPct: null,
      tradeIdsDigest: paperEvidenceDigest([]) }) };
    expect(paperAutonomyStateSchema.safeParse(next).success).toBe(true);
    expect(paperAutonomyStateSchema.safeParse({ version: next.version, evaluatedAt, cutoffAt, status: 'FALLBACK',
      entries: [], selectedRuleKeys: [], fallbackReason: '집계 오류로 기존 배분 유지' }).success).toBe(true);
  });

  it('rejects forged counts, unfinished-day statistics, empty fingerprints, NaN, misleading weights', () => {
    const invalid: Partial<PaperAutonomyStats>[] = [
      { totalCount: 13 }, { closedCount: 5, pendingCount: 9 }, { totalCount: 12, pendingCount: 0 }, { dateCount: 11 },
      { sampleCount: 0 }, { meanNetReturnPct: null }, { meanDateNetReturnPct: null },
      { standardErrorPct: null }, { standardErrorPct: -1 }, { standardErrorPct: Infinity },
      { meanDateNetReturnPct: NaN }, { tradeIdsDigest: paperEvidenceDigest([]) }, { pendingCount: -1 },
    ];
    for (const broken of invalid) {
      const value = state(); value.entries[0].stats = stats(broken);
      expect(paperAutonomyStateSchema.safeParse(value).success, JSON.stringify(broken)).toBe(false);
    }
    for (const broken of [{ reason: 'REDUCE' as const }, { weight: 2 as const },
      { stats: stats({ sampleCount: 9 }) }, { stats: stats({ dateCount: 2 }) }]) {
      const value = state(); Object.assign(value.entries[0], broken);
      expect(paperAutonomyStateSchema.safeParse(value).success).toBe(false);
    }
  });

  it('rejects future or noncanonical chronology, duplicate keys, missing selection, unknown shapes', () => {
    const cases = [
      { cutoffAt: '2026-10-05T15:01:00.000Z' }, { cutoffAt: '2026-10-04T15:00:00.000Z' },
      { evaluatedAt: 'bad-date' }, { selectedRuleKeys: ['return5:1:D1'] },
      { selectedRuleKeys: ['rsi14:1:D1', 'rsi14:1:D1'] }, { fallbackReason: 'unexpected' }, { extra: true },
    ];
    for (const broken of cases) expect(paperAutonomyStateSchema.safeParse({ ...state(), ...broken }).success).toBe(false);
    for (const at of ['2026-10-06T00:06:00.000Z', '2026-10-05T00:05:00.000Z', null]) {
      const value = state(); value.entries[0].lastSelectedAt = at;
      expect(paperAutonomyStateSchema.safeParse(value).success).toBe(false);
    }
    const sameDayUnselected = state(); sameDayUnselected.entries[1].lastSelectedAt = evaluatedAt;
    expect(paperAutonomyStateSchema.safeParse(sameDayUnselected).success).toBe(false);
    const duplicate = state(); duplicate.entries[1] = { ...duplicate.entries[0] };
    expect(paperAutonomyStateSchema.safeParse(duplicate).success).toBe(false);
    expect(paperAutonomyStateSchema.safeParse({ ...state(), status: 'FALLBACK', fallbackReason: 'error' }).success).toBe(false);
  });

  it('requires valid known rule identities and invention birth chronology', () => {
    const programKey = `invented:program:${'a'.repeat(64)}:1:D3:born:2026-10-05T01:00:00.000Z`;
    const value = state(); value.entries[0].ruleKey = programKey; value.selectedRuleKeys = [programKey];
    expect(paperAutonomyStateSchema.safeParse(value).success).toBe(true);
    for (const key of ['unknown:1:D1', 'rsi14:4:D1', 'rsi14:01:D1', 'rsi14:1:D2',
      'rsi14:1:D1:born:2026-10-05T01:00:00.000Z', programKey.replace(':born:2026-10-05T01:00:00.000Z', ''),
      programKey.replace('2026-10-05T01:', '2026-10-07T01:')]) {
      value.entries[0].ruleKey = key; value.selectedRuleKeys = [key];
      expect(paperAutonomyStateSchema.safeParse(value).success, key).toBe(false);
    }
  });

  it('preserves rotated-rule history while rejecting forged future, duplicate, missing, mismatched selections', () => {
    const base = state();
    const selectionHistory = [
      { ruleKey: 'rsi14:1:D1', selectedAt: evaluatedAt },
      { ruleKey: 'volumeRatio20:2:D3', selectedAt: base.entries[1].lastSelectedAt! },
      { ruleKey: 'rsi14:2:D5', selectedAt: '2026-10-02T00:05:00.000Z' },
    ];
    const value = { ...base, selectionHistory };
    expect(paperAutonomyStateSchema.safeParse(value).success).toBe(true);
    for (const history of [selectionHistory.slice(1), [...selectionHistory, selectionHistory[0]],
      selectionHistory.map(item => item.ruleKey === 'rsi14:1:D1' ? { ...item, selectedAt: '2026-10-05T00:05:00.000Z' } : item),
      selectionHistory.map(item => item.ruleKey === 'rsi14:2:D5' ? { ...item, selectedAt: '2026-10-07T00:05:00.000Z' } : item),
      selectionHistory.map(item => item.ruleKey === 'rsi14:2:D5' ? { ...item, selectedAt: evaluatedAt } : item),
      [...selectionHistory, { ruleKey: `invented:program:${'a'.repeat(64)}:1:D1:born:2026-10-04T01:00:00.000Z`,
        selectedAt: '2026-10-03T00:05:00.000Z' }],
    ]) expect(paperAutonomyStateSchema.safeParse({ ...value, selectionHistory: history }).success).toBe(false);
    const fallback = { ...value, status: 'FALLBACK', entries: [], selectedRuleKeys: [], fallbackReason: '기존 배분 유지' };
    expect(paperAutonomyStateSchema.safeParse(fallback).success).toBe(false);
    const oversized = Array.from({ length: 257 }, () => selectionHistory[0]);
    expect(paperAutonomyStateSchema.safeParse({ ...value, selectionHistory: oversized }).success).toBe(false);
  });
});

describe('frozen autonomy allocation', () => {
  it('accepts valid outcomes and uniform fallback without inventing outcome evidence', () => {
    expect(paperAutonomyAllocationSchema.safeParse(allocation()).success).toBe(true);
    const legacy = allocation(); legacy.method = 'LEGACY_FALLBACK';
    legacy.choices = legacy.choices.map(item => ({ ruleKey: item.ruleKey, purpose: item.purpose, weight: 2, reason: 'FALLBACK' }));
    expect(paperAutonomyAllocationSchema.safeParse(legacy).success).toBe(true);
    legacy.choices[0].stats = stats();
    expect(paperAutonomyAllocationSchema.safeParse(legacy).success).toBe(false);
  });

  it('rejects forged selection, absent exploration evidence, reweighted validated rules, extra choices', () => {
    for (const broken of [{ selectedRuleKey: 'return5:1:D1' }, { baselineRuleKey: 'return5:1:D1' },
      { choices: [] }, { choices: [...allocation().choices, allocation().choices[0]] }, { cutoffAt: 'invalid' }]) {
      expect(paperAutonomyAllocationSchema.safeParse({ ...allocation(), ...broken }).success).toBe(false);
    }
    const missing = allocation(); delete missing.choices[0].stats;
    expect(paperAutonomyAllocationSchema.safeParse(missing).success).toBe(false);
    const weightedValidated = allocation(); weightedValidated.choices[1].weight = 3;
    expect(paperAutonomyAllocationSchema.safeParse(weightedValidated).success).toBe(false);
    const fakeValidatedEvidence = allocation(); fakeValidatedEvidence.choices[1].stats = stats();
    expect(paperAutonomyAllocationSchema.safeParse(fakeValidatedEvidence).success).toBe(false);
    const excessiveTrials = allocation();
    excessiveTrials.choices.push(...['return5:1:D1', 'return20:1:D1'].map(ruleKey => ({ ...excessiveTrials.choices[0], ruleKey })));
    expect(paperAutonomyAllocationSchema.safeParse(excessiveTrials).success).toBe(false);
  });

  it('binds a persisted allocation to the exact entry rule, purpose, decision time', () => {
    const value = allocation(), decisionAt = '2026-10-06T00:06:00.000Z';
    expect(validPaperAutonomyAllocation(value, rule, decisionAt, 'EXPLORATION')).toBe(true);
    expect(validPaperAutonomyAllocation(value, { ...rule, horizon: 3 }, decisionAt, 'EXPLORATION')).toBe(false);
    expect(validPaperAutonomyAllocation(value, rule, decisionAt, 'VALIDATED')).toBe(false);
    expect(validPaperAutonomyAllocation(value, rule, '2026-10-06T00:04:59.000Z', 'EXPLORATION')).toBe(false);
    expect(validPaperAutonomyAllocation(value, rule, '2026-10-07T00:06:00.000Z', 'EXPLORATION')).toBe(false);
    expect(validPaperAutonomyAllocation(value, rule, 'invalid', 'EXPLORATION')).toBe(false);
    expect(validPaperAutonomyAllocation(undefined, rule, decisionAt, 'EXPLORATION')).toBe(false);
  });
});
