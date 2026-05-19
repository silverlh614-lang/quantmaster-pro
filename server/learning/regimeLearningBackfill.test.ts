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
    expect(ghosts[0].regimeRecoverySource).toBe('INTRADAY_NEAREST_60M');
    expect(ghosts[0].regimeRecoveryConfidence).toBe('MEDIUM');
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

  it('recovers UNKNOWN rows from same-day daily regime fallback after intraday window misses', () => {
    const ghosts = [
      ghost({ id: 'daily-0430', regimePhase: 'UNKNOWN', signalDate: '2026-04-30' }),
    ];

    const dry = regimeUnknownRepairDryRun({
      ghosts,
      counterfactuals: [],
      attributionRecords: [],
      macroSnapshots: [{ at: '2026-04-30T03:00:00.000Z', rawRegime: 'R6_DEFENSE' }],
      transitionSnapshots: [],
      dailyRegimeSnapshots: [{ tradingDate: '2026-04-30', rawRegime: 'R3_EARLY', effectiveRegime: 'R3_EARLY' }],
    });

    expect(dry.repaired).toBe(1);
    expect(dry.stillUnknown).toBe(0);
    expect(dry.recoveredBySource.SAME_DAY_DAILY_REGIME).toBe(1);
    expect(dry.recoveredByConfidence.RECOVERED_LOW).toBe(1);
    expect(dry.failedAfterDailyFallback).toBe(0);
    expect(dry.failureReasonBreakdown.NO_SNAPSHOT_IN_WINDOW).toBeUndefined();
    expect(dry.dailyRegimeFallbackStatus).toBe('USED_DAILY_FALLBACK');
  });

  it('falls back to previous trading day close when same-day daily snapshot is missing', () => {
    const ghosts = [
      ghost({ id: 'prev-close-0501', regimePhase: 'UNKNOWN', signalDate: '2026-05-01' }),
    ];

    const dry = regimeUnknownRepairDryRun({
      ghosts,
      counterfactuals: [],
      attributionRecords: [],
      macroSnapshots: [{ at: '2026-05-02T00:00:00.000Z', rawRegime: 'R4_NEUTRAL' }],
      transitionSnapshots: [],
      dailyRegimeSnapshots: [{ tradingDate: '2026-04-30', rawRegime: 'R2_EARLY', effectiveRegime: 'R2_EARLY' }],
    });

    expect(dry.repaired).toBe(1);
    expect(dry.recoveredBySource.PREVIOUS_TRADING_DAY_CLOSE).toBe(1);
    expect(dry.recoveredByConfidence.RECOVERED_LOW).toBe(1);
    expect(dry.snapshotCoverageByTradingDate['2026-05-01'].previousTradingDayClose).toBe(1);
  });

  it('records 2026-04-30 coverage gaps when daily fallback still cannot recover', () => {
    const ghosts = [
      ghost({ id: 'missing-0430', regimePhase: 'UNKNOWN', signalDate: '2026-04-30' }),
    ];

    const dry = regimeUnknownRepairDryRun({
      ghosts,
      counterfactuals: [],
      attributionRecords: [],
      macroSnapshots: [{ at: '2026-05-02T00:00:00.000Z', rawRegime: 'R4_NEUTRAL' }],
      transitionSnapshots: [],
      dailyRegimeSnapshots: [],
      pulseArchiveSnapshots: [],
    });

    expect(dry.repaired).toBe(0);
    expect(dry.failedAfterDailyFallback).toBe(1);
    expect(dry.failureByTradingDate['2026-04-30']).toBe(1);
    expect(dry.snapshotCoverageByTradingDate['2026-04-30'].sameDayDaily).toBe(0);
    expect(dry.missingRegimeSnapshotDates).toEqual(['2026-04-30']);
    expect(dry.dailyRegimeFallbackStatus).toBe('NO_DAILY_SNAPSHOT_FOR_DATE');
    expect(dry.failureReasonBreakdownAfterDailyFallback.NO_RECONSTRUCTION_SOURCE_FOR_DATE).toBe(1);
    expect(dry.sourceInventoryByDate['2026-04-30']).toMatchObject({
      telegramPulseArchive: 0,
      regimeResolverDecisionLog: 0,
      marketMacroSnapshotLog: 0,
      riskOverrideEventLog: 0,
      r6TriggerLog: 0,
      effectiveRegimeTransitionLog: 0,
      executionPolicySnapshotLog: 0,
      learningPulseArchive: 0,
      railwayAppLogArchive: 0,
    });
  });

  it('reconstructs missing daily regime snapshots from resolver logs before final backfill', () => {
    const ghosts = [
      ghost({ id: 'missing-0513', regimePhase: 'UNKNOWN', signalDate: '2026-05-13' }),
    ];

    const dry = regimeUnknownRepairDryRun({
      ghosts,
      counterfactuals: [],
      attributionRecords: [],
      macroSnapshots: [{ at: '2026-05-20T00:00:00.000Z', rawRegime: 'R4_NEUTRAL' }],
      transitionSnapshots: [],
      dailyRegimeSnapshots: [],
      pulseArchiveSnapshots: [],
      reconstructionLogEntries: [{
        at: '2026-05-13T06:00:00.000Z',
        source: 'REGIME_RESOLVER_LOG',
        message: '[SOURCE_QUERY_RESULT] command=/regime detectedRegime=R3_EARLY effectiveRegime=R3_EARLY riskOverride=NONE',
      }],
      now: new Date('2026-05-19T12:00:00.000Z'),
    });

    expect(dry.snapshotReconstructionAttemptedDates).toEqual(['2026-05-13']);
    expect(dry.snapshotReconstructionSucceededDates).toEqual(['2026-05-13']);
    expect(dry.snapshotReconstructionFailedDates).toEqual([]);
    expect(dry.snapshotReconstructionSourceBreakdown.REGIME_RESOLVER_DECISION_LOG).toBe(1);
    expect(dry.snapshotReconstructionConfidenceBreakdown.RECOVERED_MEDIUM).toBe(1);
    expect(dry.sourceInventoryByDate['2026-05-13']).toMatchObject({
      regimeResolverDecisionLog: 1,
    });
    expect(dry.sourceInventoryTopAvailable).toContain('regimeResolverDecisionLog:1');
    expect(dry.sourceInventoryMissingSources['2026-05-13']).not.toContain('regimeResolverDecisionLog');
    expect(dry.sourceInventoryAuditStatus).toBe('PRIORITY_SOURCE_AVAILABLE');
    expect(dry.snapshotReconstructionPriorityDate).toBe('2026-05-13');
    expect(dry.priorityDateReconstructionStatus).toBe('SUCCESS');
    expect(dry.priorityDateRecoveredSampleCount).toBe(1);
    expect(dry.priorityDateFailureReason).toBe('NONE');
    expect(dry.reconstructedDailySnapshots[0]).toMatchObject({
      tradingDate: '2026-05-13',
      rawRegime: 'R3_EARLY',
      effectiveRegime: 'R3_EARLY',
      source: 'REGIME_RESOLVER_DECISION_LOG',
      confidence: 'RECOVERED_MEDIUM',
      reconstructed: true,
      executionImpact: 'NONE',
    });
    expect(dry.repaired).toBe(1);
    expect(dry.failedAfterDailyFallback).toBe(0);
    expect(dry.recoveredBySource.RECONSTRUCTED_DAILY_REGIME).toBe(1);
    expect(dry.recoveredByConfidence.RECOVERED_MEDIUM).toBe(1);
    expect(dry.snapshotCoverageByTradingDate['2026-05-13']).toMatchObject({
      intradayNearest60m: 0,
      sameDayDaily: 0,
      previousTradingDayClose: 0,
      pulseArchiveSameDate: 0,
      reconstructedDaily: 1,
    });
  });

  it('prioritizes reconstruction dates before lower-impact missing days', () => {
    const ghosts = [
      ghost({ id: 'missing-0512', regimePhase: 'UNKNOWN', signalDate: '2026-05-12' }),
      ghost({ id: 'missing-0430', regimePhase: 'UNKNOWN', signalDate: '2026-04-30' }),
      ghost({ id: 'missing-0515', regimePhase: 'UNKNOWN', signalDate: '2026-05-15' }),
      ghost({ id: 'missing-0513', regimePhase: 'UNKNOWN', signalDate: '2026-05-13' }),
    ];

    const dry = regimeUnknownRepairDryRun({
      ghosts,
      counterfactuals: [],
      attributionRecords: [],
      macroSnapshots: [{ at: '2026-05-20T00:00:00.000Z', rawRegime: 'R4_NEUTRAL' }],
      transitionSnapshots: [],
      dailyRegimeSnapshots: [],
      pulseArchiveSnapshots: [],
      reconstructionLogEntries: [
        { tradingDate: '2026-05-13', source: 'MARKET_MACRO_SNAPSHOT', rawRegime: 'R3_EARLY', effectiveRegime: 'R3_EARLY' },
        { tradingDate: '2026-04-30', source: 'R6_TRIGGER_EVENT', rawRegime: 'R6_DEFENSE', effectiveRegime: 'R6_DEFENSE' },
        { tradingDate: '2026-05-15', source: 'RISK_OVERRIDE_LOG', riskOverride: 'R5_CAUTION' },
      ],
    });

    expect(dry.snapshotReconstructionAttemptedDates).toEqual(['2026-05-13', '2026-04-30', '2026-05-15', '2026-05-12']);
    expect(dry.snapshotReconstructionSucceededDates).toEqual(['2026-05-13', '2026-04-30', '2026-05-15']);
    expect(dry.snapshotReconstructionFailedDates).toEqual(['2026-05-12']);
    expect(dry.snapshotReconstructionSourceBreakdown.MARKET_MACRO_SNAPSHOT_LOG).toBe(1);
    expect(dry.snapshotReconstructionSourceBreakdown.R6_TRIGGER_LOG).toBe(1);
    expect(dry.snapshotReconstructionSourceBreakdown.RISK_OVERRIDE_EVENT_LOG).toBe(1);
    expect(dry.sourceInventoryAuditStatus).toBe('PRIORITY_SOURCE_AVAILABLE');
    expect(dry.sourceInventoryByDate['2026-05-13'].marketMacroSnapshotLog).toBe(1);
    expect(dry.sourceInventoryByDate['2026-05-12']).toMatchObject({
      telegramPulseArchive: 0,
      regimeResolverDecisionLog: 0,
      marketMacroSnapshotLog: 0,
      riskOverrideEventLog: 0,
      r6TriggerLog: 0,
      effectiveRegimeTransitionLog: 0,
      executionPolicySnapshotLog: 0,
      learningPulseArchive: 0,
      railwayAppLogArchive: 0,
    });
  });

  it('marks priority date unrecoverable when source inventory has no reliable source', () => {
    const ghosts = [
      ghost({ id: 'missing-0513-nosource', regimePhase: 'UNKNOWN', signalDate: '2026-05-13' }),
    ];

    const dry = regimeUnknownRepairDryRun({
      ghosts,
      counterfactuals: [],
      attributionRecords: [],
      macroSnapshots: [],
      transitionSnapshots: [],
      dailyRegimeSnapshots: [],
      pulseArchiveSnapshots: [],
    });

    expect(dry.snapshotReconstructionAttemptedDates).toEqual(['2026-05-13']);
    expect(dry.snapshotReconstructionFailedDates).toEqual(['2026-05-13']);
    expect(dry.sourceInventoryAuditStatus).toBe('PRIORITY_SOURCE_MISSING');
    expect(dry.priorityDateReconstructionStatus).toBe('UNRECOVERABLE');
    expect(dry.priorityDateRecoveredSampleCount).toBe(0);
    expect(dry.priorityDateFailureReason).toBe('UNRECOVERABLE_MISSING_REGIME_SOURCE');
    expect(dry.failureReasonBreakdownAfterDailyFallback.NO_RECONSTRUCTION_SOURCE_FOR_DATE).toBe(1);
    expect(dry.failureSampleKeys[0]).toContain('NO_RECONSTRUCTION_SOURCE_FOR_DATE');
  });
});
