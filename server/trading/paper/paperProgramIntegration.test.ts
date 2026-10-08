// @responsibility Verify generated programs enter prospective Shadow research with frozen evidence.
import { describe, expect, it } from 'vitest';
import { sealPaperProgram } from './paperIndicatorProgram.js';
import { selectPaperAdaptiveState } from './paperAdaptiveSelection.js';
import { adaptiveTestSnapshot, matureAdaptiveSamples } from './paperAdaptiveFixtures.js';
import { evaluatePaperStrategyScan } from './paperStrategyPolicy.js';
import { assertPaperStrategyLedger } from './paperStrategyValidation.js';
import { emptyStrategyLedger, strategyTestCost } from './paperStrategyFixtures.js';
import { adaptiveStateSchema } from './paperAdaptiveValidation.js';

const feature = (key: string) => ({ op: 'feature', key });
const formula = sealPaperProgram({ title: '거래량과 가격 힘의 방향 일치', hypothesis: '두 힘이 같은 방향일 때 이후 성과를 시험합니다.',
  interpretation: '두 환산값의 부호가 같으면 RSI 이탈 폭, 다르면 그 음수입니다.', limitation: '둘 다 낮아도 양수가 됩니다.',
  expression: { op: 'ifPositive', condition: { op: 'multiply', left: feature('rsi14'), right: feature('volumeRatio20') },
    positive: { op: 'abs', value: feature('rsi14') }, otherwise: { op: 'negate', value: { op: 'abs', value: feature('rsi14') } } } });
const proposal = { formula, generatedAt: '2026-09-17T08:00:00Z', model: 'test-model', inputDigest: 'a'.repeat(64) };
const asOf = '2026-09-18T01:00:00Z';
function samples(startDate?: string, entryDateCount?: number, symbolCount?: number) {
  return matureAdaptiveSamples({ startDate, entryDateCount, symbolCount }).map(row => {
    const index = (Number(row.symbol) - 100) % 8;
    row.entryObservation.features!.values.rsi14 = index % 4 < 2 ? 20 : 80;
    row.entryObservation.features!.values.volumeRatio20 = [0, 1, 6, 7].includes(index) ? 0.25 : 1.75;
    return row;
  });
}
describe('generated program integration', () => {
  it('registers for exploration without borrowing historical validation and preserves entry code', () => {
    const snapshot = adaptiveTestSnapshot(); snapshot.observations[0].features!.values.volumeRatio20 = 0.25;
    const state = selectPaperAdaptiveState(undefined, samples(), asOf, snapshot.observations, [proposal]);
    expect(adaptiveStateSchema.safeParse(state).success).toBe(true);
    const candidate = state.candidates.find(item => item.rule.invention?.formula.version === 'feature-program-v1')!;
    expect(state.discovery!.programReviews).toContainEqual(expect.objectContaining({ id: candidate.rule.feature, status: 'REGISTERED' }));
    expect(candidate).toMatchObject({ active: false, reason: 'FORWARD_OBSERVATION', validation: { sampleCount: 0 } });
    expect(state.exploration!.rules.some(item => item.candidate.rule.feature === candidate.rule.feature)).toBe(true);
    snapshot.id = 'program-entry'; snapshot.asOf = '2026-09-18T01:01:00Z';
    snapshot.observations[0].observedAt = snapshot.asOf; snapshot.observations[0].features!.asOf = snapshot.asOf;
    snapshot.observations = Array.from({ length: 8 }, (_, index) => ({ ...structuredClone(snapshot.observations[0]), symbol: `00010${index}` }));
    const ledger = evaluatePaperStrategyScan(emptyStrategyLedger(), snapshot, strategyTestCost, state);
    const trade = ledger.trades.find(item => item.entryDecision.explorationEvidence?.candidate.rule.feature === candidate.rule.feature)!;
    expect(trade).toBeDefined(); expect(trade.exitPolicy).toBeDefined();
    expect(trade.entryDecision.explorationEvidence!.candidate.rule.invention!.formula).toEqual(formula);
    expect(() => assertPaperStrategyLedger(ledger)).not.toThrow();
    const broken = structuredClone(ledger), saved = broken.trades.find(item => item.id === trade.id)!.entryDecision.explorationEvidence!.candidate.rule.invention!.formula;
    if (saved.version === 'feature-program-v1') saved.digest = '0'.repeat(64);
    expect(() => assertPaperStrategyLedger(broken)).toThrow();
    const quote = structuredClone(snapshot); quote.id = 'program-exit'; quote.asOf = '2026-09-18T01:03:00Z'; quote.quoteOnly = true;
    quote.observations.forEach(item => { item.price = trade.entryPrice * 0.9; item.observedAt = quote.asOf; delete item.features; });
    const closed = evaluatePaperStrategyScan(ledger, quote, strategyTestCost, state);
    const exited = closed.trades.find(item => item.id === trade.id)!;
    expect(exited.exit?.decision.reasonCode).toBe('ADAPTIVE_STOP_LOSS');
    expect(exited.exit?.decision.explorationEvidence).toEqual(trade.entryDecision.explorationEvidence);
    expect(() => assertPaperStrategyLedger(closed)).not.toThrow();
  });
  it('ignores future proposals and holds the current day rules unchanged', () => {
    const state = selectPaperAdaptiveState(undefined, samples(), asOf, [], [{ ...proposal, generatedAt: '2026-09-19T08:00:00Z' }]);
    expect(state.discovery!.inventions.some(item => item.formula.version === 'feature-program-v1')).toBe(false);
    expect(selectPaperAdaptiveState(state, samples(), '2026-09-18T02:00:00Z', [], [proposal])).toEqual(state);
  });
  it('activates only from later observations while freezing the generated definition', () => {
    const state = selectPaperAdaptiveState(undefined, samples(), asOf, [], [proposal]);
    const later = samples('2026-09-21', 8, 16);
    const after = selectPaperAdaptiveState(state, [...samples(), ...later], '2026-10-15T01:00:00Z');
    const candidate = after.candidates.find(item => item.rule.invention?.formula.version === 'feature-program-v1')!;
    expect(candidate.active).toBe(true);
    expect(candidate.rule.invention!.formula).toEqual(formula);
    expect(candidate.validation.experimentIds!.every(id => later.some(row => row.id === id))).toBe(true);
    expect(adaptiveStateSchema.safeParse(after).success).toBe(true);
  });
});
