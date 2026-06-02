import { describe, expect, it } from 'vitest';
import {
  GATE_OUTCOME_WIN_RETURN_PCT,
  classifyGateOutcome,
  collectGateScoredOutcomes,
  groupScoredOutcomesByGateRegime,
  projectGate1ScoredOutcomes,
  projectGate2ScoredOutcomes,
  projectGate3ScoredOutcomes,
  type GateScoredOutcome,
} from './gateScoredOutcomeProjection.js';
import type { Gate1DryRunObservationRow } from '../trading/signalScanner/gate1DryRunObservationLedgerAdr0476.js';
import type { Gate3OutcomeSeed } from '../quant/gate3OutcomeSeed.js';

function gate1Row(partial: Partial<Gate1DryRunObservationRow>): Gate1DryRunObservationRow {
  return {
    symbol: '005930',
    forDate: '2026-05-09',
    createdAt: '2026-05-09T07:00:00.000Z',
    source: 'GATE1_NEAR_MISS',
    ...partial,
  } as unknown as Gate1DryRunObservationRow;
}

function gate3Seed(partial: Partial<Gate3OutcomeSeed>): Gate3OutcomeSeed {
  return {
    id: 'seed-1',
    symbol: '000660',
    forwardReturns: { d1: null, d3: null, d5: null, d10: null },
    ...partial,
  } as unknown as Gate3OutcomeSeed;
}

describe('counterfacture_gate Phase B — gateScoredOutcomeProjection', () => {
  it('classifyGateOutcome: WIN at threshold, LOSS below, null when immature', () => {
    expect(classifyGateOutcome(GATE_OUTCOME_WIN_RETURN_PCT)).toBe('WIN');
    expect(classifyGateOutcome(5)).toBe('WIN');
    expect(classifyGateOutcome(2.9)).toBe('LOSS');
    expect(classifyGateOutcome(-4)).toBe('LOSS');
    expect(classifyGateOutcome(null)).toBeNull();
    expect(classifyGateOutcome(undefined)).toBeNull();
  });

  it('projects Gate1 rows to (scalar ×10, WIN/LOSS, regime) and excludes immature/unscored', () => {
    const projected = projectGate1ScoredOutcomes([
      gate1Row({ symbol: 'A', dryRunScore: 66, forwardReturn5D: 5, effectiveRegime: 'R3_EARLY' }), // WIN
      gate1Row({ symbol: 'B', dryRunScore: 62, forwardReturn5D: -2, regime: 'R4_NEUTRAL' }), // LOSS
      gate1Row({ symbol: 'C', dryRunScore: 64 }), // immature (no D5) → excluded
      gate1Row({ symbol: 'D', forwardReturn5D: 8 }), // unscored → excluded
    ]);
    expect(projected).toHaveLength(2);
    expect(projected[0]).toMatchObject({ gate: 'GATE1', scalar: 66, scale: 10, outcome: 'WIN', regime: 'R3_EARLY', symbol: 'A' });
    expect(projected[1]).toMatchObject({ gate: 'GATE1', outcome: 'LOSS', regime: 'R4_NEUTRAL', symbol: 'B' });
  });

  it('projects Gate3 seeds to (scalar=rrr ×1, regime=seed.regime; 미보유→UNKNOWN) and excludes no-rrr', () => {
    const projected = projectGate3ScoredOutcomes([
      gate3Seed({ symbol: 'X', rrr: 3.2, regime: 'R2_BULL', forwardReturns: { d1: 1, d3: 2, d5: 4, d10: null } }), // WIN, regime 보유(Phase F)
      gate3Seed({ symbol: 'Y', rrr: 1.5, forwardReturns: { d1: null, d3: null, d5: 0, d10: null } }), // LOSS, 구 seed(regime 미보유) → UNKNOWN
      gate3Seed({ symbol: 'Z', rrr: null, forwardReturns: { d1: null, d3: null, d5: 9, d10: null } }), // no scalar → excluded
    ]);
    expect(projected).toHaveLength(2);
    expect(projected[0]).toMatchObject({ gate: 'GATE3', scalar: 3.2, scale: 1, outcome: 'WIN', regime: 'R2_BULL', symbol: 'X' });
    expect(projected[1]).toMatchObject({ gate: 'GATE3', outcome: 'LOSS', regime: 'UNKNOWN', symbol: 'Y' });
  });

  it('Gate2 projection is an empty extension point', () => {
    expect(projectGate2ScoredOutcomes()).toEqual([]);
  });

  it('collectGateScoredOutcomes bundles injected gate1/gate3 sources without disk I/O', async () => {
    const bundle = await collectGateScoredOutcomes({
      gate1Rows: [gate1Row({ symbol: 'A', dryRunScore: 66, forwardReturn5D: 5, effectiveRegime: 'R3_EARLY' })],
      gate3Seeds: [gate3Seed({ symbol: 'X', rrr: 3.2, forwardReturns: { d1: null, d3: null, d5: 4, d10: null } })],
    });
    expect(bundle.gate1).toHaveLength(1);
    expect(bundle.gate3).toHaveLength(1);
    expect(bundle.gate2).toHaveLength(0);
    expect(bundle.all).toHaveLength(2);
  });

  it('groups by gate×regime for the ROC adapter', () => {
    const outcomes: GateScoredOutcome[] = [
      { gate: 'GATE1', scalar: 66, scale: 10, outcome: 'WIN', regime: 'R3_EARLY', forwardReturnD5Pct: 5, symbol: 'A' },
      { gate: 'GATE1', scalar: 62, scale: 10, outcome: 'LOSS', regime: 'R3_EARLY', forwardReturnD5Pct: -2, symbol: 'B' },
      { gate: 'GATE3', scalar: 3.2, scale: 1, outcome: 'WIN', regime: 'UNKNOWN', forwardReturnD5Pct: 4, symbol: 'X' },
    ];
    const grouped = groupScoredOutcomesByGateRegime(outcomes);
    expect(grouped.get('GATE1:R3_EARLY')).toHaveLength(2);
    expect(grouped.get('GATE3:UNKNOWN')).toHaveLength(1);
  });
});
