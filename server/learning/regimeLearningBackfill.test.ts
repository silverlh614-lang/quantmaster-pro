import { describe, expect, it } from 'vitest';
import {
  regimeLearningBackfillDryRun,
  regimeLearningBackfillRun,
} from './regimeLearningBackfill.js';
import type { LearningGhostCase } from './learningTypes.js';
import type { CounterfactualEntry } from './counterfactualShadow.js';

function ghost(patch: Partial<LearningGhostCase>): LearningGhostCase {
  return {
    id: 'g1',
    stockCode: '005930',
    stockName: 'Samsung',
    signalPriceKrw: 100,
    signalDate: '2026-05-17',
    rejectionReason: 'GATE_UNDER',
    trackUntil: '2026-06-17',
    closed: true,
    outcomeLabel: 'WIN',
    ...patch,
  };
}

function counterfactual(patch: Partial<CounterfactualEntry>): CounterfactualEntry {
  return {
    id: 'cf1',
    stockCode: '000660',
    stockName: 'SK Hynix',
    signalDate: '2026-05-17',
    signalTime: '2026-05-17T01:00:00.000Z',
    priceAtSignal: 100,
    gateScore: 5,
    regime: 'UNKNOWN',
    conditionKeys: [],
    skipReason: 'GATE_UNDER',
    ...patch,
  };
}

describe('Regime Learning backfill', () => {
  it('dryrun reports recoverable legacy rows without mutating data', () => {
    const ghosts = [
      ghost({ id: 'r6-ghost', rejectionReason: 'R6_DEFENSE_BLOCK' }),
      ghost({ id: 'unknown-ghost', rejectionReason: 'NO_SNAPSHOT', signalDate: '2026-01-01' }),
    ];
    const cfs = [counterfactual({ id: 'cf-r3', regime: 'R3_EARLY' })];

    const dry = regimeLearningBackfillDryRun({ ghosts, counterfactuals: cfs, attributionRecords: [] });

    expect(dry.scannedTotal).toBe(3);
    expect(dry.missingRegimePhase).toBe(3);
    expect(dry.expectedByRegime.R6_DEFENSE).toBe(1);
    expect(dry.expectedByRegime.R3_EXPANSION).toBe(1);
    expect(dry.expectedUnknown).toBeGreaterThanOrEqual(1);
    expect(ghosts[0].regimePhase).toBeUndefined();
    expect(dry.executionImpact).toBe('NONE');
    expect(dry.brokerOrdersCreated).toBe(0);
  });

  it('run writes recovered regime fields while keeping promotion disabled', () => {
    const ghosts = [
      ghost({ id: 'r6-ghost', rejectionReason: 'R6_SHOCK_LATCH' }),
      ghost({ id: 'unknown-ghost', rejectionReason: 'NO_SNAPSHOT', signalDate: '2026-01-01' }),
    ];

    const result = regimeLearningBackfillRun({ ghosts, counterfactuals: [], attributionRecords: [], now: new Date('2026-05-17T00:00:00.000Z') });

    expect(result.updated).toBe(2);
    expect(result.byRegime.R6_DEFENSE).toBe(1);
    expect(result.unknownCount).toBe(1);
    expect(ghosts[0].regimePhase).toBe('R6_DEFENSE');
    expect(ghosts[0].regimeRecoverySource).toBe('R6_TRIGGER_BY_TIMESTAMP');
    expect(ghosts[1].regimePhase).toBe('UNKNOWN');
    expect(ghosts[1].regimeRecoveryConfidence).toBe('UNKNOWN');
    expect(result.executionImpact).toBe('NONE');
    expect(result.brokerOrdersCreated).toBe(0);
    expect(result.promotionAllowed).toBe(false);
  });
});
