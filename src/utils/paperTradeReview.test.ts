// @responsibility Verify connection-cohort attribution without inferring missing activation history.
import { describe, expect, it } from 'vitest';
import type { PaperAdaptiveRule, PaperAdaptiveState } from '../types/paperAdaptive';
import type { PaperStrategyTradeSummary } from '../types/paperStrategy';
import { buildSignalReview } from './paperTradeReview';

const rule: PaperAdaptiveRule = { feature: 'rsi14', bucket: 1, horizon: 3 };
const at = (day: number) => `2026-09-${String(day).padStart(2, '0')}T01:00:00Z`;
const change = (day: number, from: PaperAdaptiveRule | null, to: PaperAdaptiveRule | null,
  reason: PaperAdaptiveState['changes'][number]['reason']): PaperAdaptiveState['changes'][number] =>
  ({ at: at(day), feature: rule.feature, from, to, reason });
function state(changes: PaperAdaptiveState['changes'], active = true): PaperAdaptiveState {
  return { candidates: [{ rule, active }], changes } as PaperAdaptiveState;
}
function trade(day: number, net: number | null = 1): PaperStrategyTradeSummary {
  return { id: `trade-${day}`, strategyVersion: 'adaptive-features-v1', symbol: 'TEST', name: '테스트',
    status: net === null ? 'OPEN' : 'CLOSED', entryAt: at(day), tradingDate: at(day).slice(0, 10), horizon: 3,
    costModel: { version: 'test', buyFeeRate: 0, sellFeeRate: 0, sellTaxRate: 0, slippageRate: 0 },
    policy: { exitModel: 'ADAPTIVE_OBSERVED' }, entryDecision: { cohort: null, adaptiveEvidence: { candidate: { rule } } },
    exit: net === null ? null : { netReturnPct: net } };
}

describe('validated signal connection periods', () => {
  it('separates reconnections with inclusive starts and exclusive ends, retaining later exits in their entry cohort', () => {
    const input = [trade(9, 99), trade(10, -4), trade(11, 2), trade(12, 88), trade(14, 6), trade(15, null)];
    const history = state([change(14, null, rule, 'ACTIVE'), change(10, null, rule, 'ACTIVE'),
      change(12, rule, null, 'NO_VALIDATION_EDGE')]);
    const before = JSON.stringify([input, history]);
    const [result] = buildSignalReview(input, history);
    expect(result.connections?.unassignedCount).toBe(2);
    expect(result.connections?.periods).toMatchObject([
      { startedAt: at(14), endedAt: null, totalCount: 2, closedCount: 1, openCount: 1, meanNetReturnPct: 6, complete: false },
      { startedAt: at(10), endedAt: at(12), totalCount: 2, closedCount: 2, meanNetReturnPct: -1, complete: true },
    ]);
    expect(JSON.stringify([input, history])).toBe(before);
  });

  it('does not treat formula registration, a first trade, or an unmatched deactivation as an activation', () => {
    const input = [trade(10), trade(13)];
    const [result] = buildSignalReview(input, state([change(9, null, rule, 'FORWARD_OBSERVATION'),
      change(12, rule, null, 'NO_VALIDATION_EDGE')], false));
    expect(result.connections).toEqual({ periods: [], unassignedCount: 2 });
    expect(buildSignalReview(input, state([]))[0].connections).toEqual({ periods: [], unassignedCount: 2 });
    expect(buildSignalReview(input)[0].connections).toEqual({ periods: [], unassignedCount: 2 });
  });

  it('closes an old range at replacement and keeps a closed cohort even when the rule is no longer connected', () => {
    const replacement = { ...rule, bucket: 2 };
    const history = state([change(10, null, rule, 'ACTIVE'), change(12, rule, replacement, 'ACTIVE')], false);
    const [result] = buildSignalReview([trade(10), trade(12)], history);
    expect(result.connections).toMatchObject({ unassignedCount: 1,
      periods: [{ startedAt: at(10), endedAt: at(12), totalCount: 1 }] });
  });

  it('withholds an unclosed interval when current state contradicts the retained history', () => {
    const [result] = buildSignalReview([trade(11)], state([change(10, null, rule, 'ACTIVE')], false));
    expect(result.connections).toEqual({ periods: [], unassignedCount: 1 });
  });

  it('keeps exploration outside validated connection history', () => {
    const input = trade(11);
    input.entryDecision.explorationEvidence = input.entryDecision.adaptiveEvidence;
    delete input.entryDecision.adaptiveEvidence;
    expect(buildSignalReview([input], state([change(10, null, rule, 'ACTIVE')]))[0].connections).toBeNull();
  });
});
