import { describe, expect, it } from 'vitest';
import {
  formatRegimeUnknownAnalysis,
  regimeLearningBackfillDryRun,
  regimeLearningBackfillRun,
  regimeUnknownAnalysis,
  regimeUnknownRepairDryRun,
  regimeUnknownRepairRun,
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

  it('analyzes UNKNOWN rows with reason breakdown without mutating data', () => {
    const ghosts = [
      ghost({ id: 'unknown-snapshot', regimePhase: 'UNKNOWN', signalDate: '2026-05-17' }),
      ghost({ id: 'unknown-missing-time', regimePhase: 'UNKNOWN', signalDate: '' }),
    ];

    const result = regimeUnknownAnalysis({
      ghosts,
      counterfactuals: [],
      attributionRecords: [],
      macroSnapshots: [{ at: '2026-05-17T01:00:00.000Z', rawRegime: 'R3_EARLY' }],
      transitionSnapshots: [],
    });
    const msg = formatRegimeUnknownAnalysis(result);

    expect(result.unknownTotal).toBe(2);
    expect(result.unknownByCaseType.ghostRepair + result.unknownByCaseType.openUnresolved).toBeGreaterThan(0);
    expect(msg).toContain('unknownReasonBreakdown=');
    expect(msg).toContain('executionImpact=NONE');
    expect(ghosts[0].regimePhase).toBe('UNKNOWN');
  });

  it('UNKNOWN repair dryrun does not mutate and run reduces recoverable UNKNOWN', () => {
    const ghosts = [
      ghost({ id: 'unknown-r3', regimePhase: 'UNKNOWN', signalDate: '2026-05-17' }),
      ghost({ id: 'unknown-r6', regimePhase: 'UNKNOWN', rejectionReason: 'R6_SHOCK_LATCH', signalDate: '2026-04-01' }),
      ghost({ id: 'unknown-still', regimePhase: 'UNKNOWN', signalDate: '' }),
    ];
    const input = {
      ghosts,
      counterfactuals: [] as CounterfactualEntry[],
      attributionRecords: [],
      macroSnapshots: [{ at: '2026-05-17T01:00:00.000Z', rawRegime: 'R3_EARLY' }],
      transitionSnapshots: [],
      now: new Date('2026-05-18T00:00:00.000Z'),
    };

    const dry = regimeUnknownRepairDryRun(input);
    expect(dry.scannedUnknown).toBe(3);
    expect(dry.attemptedUnique).toBe(3);
    expect(dry.attemptedDuplicates).toBe(0);
    expect(dry.repaired).toBe(2);
    expect(dry.failureReasonBreakdown.MISSING_SAMPLE_TIMESTAMP).toBe(1);
    expect(dry.failureBySourceLane.GHOST_REPAIR).toBe(1);
    expect(dry.failureByTimestampSource.MISSING).toBe(1);
    expect(dry.failureSampleKeys[0]).toContain('MISSING_SAMPLE_TIMESTAMP');
    expect(ghosts[0].regimePhase).toBe('UNKNOWN');

    const run = regimeUnknownRepairRun(input);
    expect(run.repaired).toBe(2);
    expect(run.stillUnknown).toBe(1);
    expect(ghosts[0].regimePhase).toBe('R3_EXPANSION');
    expect(ghosts[0].originalRegimePhase).toBe('UNKNOWN');
    expect(ghosts[0].regimeRecoveryConfidence).toBe('HIGH');
    expect(ghosts[1].regimePhase).toBe('R6_DEFENSE');
    expect(ghosts[1].regimeRecoveryConfidence).toBe('MEDIUM');
    expect(ghosts[2].regimeRecoveryConfidence).toBeUndefined();
    expect(run.executionImpact).toBe('NONE');
    expect(run.brokerOrdersCreated).toBe(0);
    expect(run.promotionAllowed).toBe(false);
  });

  it('records duplicate-suppressed attempts as explicit failure reasons', () => {
    const duplicateA = ghost({ id: 'dup', regimePhase: 'UNKNOWN', signalDate: '' });
    const duplicateB = ghost({ id: 'dup', regimePhase: 'UNKNOWN', signalDate: '' });

    const dry = regimeUnknownRepairDryRun({
      ghosts: [duplicateA, duplicateB],
      counterfactuals: [],
      attributionRecords: [],
      macroSnapshots: [],
      transitionSnapshots: [],
    });

    expect(dry.scannedUnknown).toBe(2);
    expect(dry.attemptedUnique).toBe(1);
    expect(dry.attemptedDuplicates).toBe(1);
    expect(dry.stillUnknown).toBe(2);
    expect(dry.failureReasonBreakdown.DUPLICATE_SUPPRESSED_BEFORE_BACKFILL).toBe(1);
  });
});
