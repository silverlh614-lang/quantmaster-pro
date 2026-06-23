// @responsibility Unified forward outcome labeler regression tests for learning-only evidence and safety invariants.

import { afterEach, describe, expect, it, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import type { Gate3OutcomeSeed } from '../quant/gate3OutcomeSeed.js';
import type { NearMissOutcomeEntry } from '../persistence/nearMissOutcomeLedger.js';
import type { CounterfactualShadowLearningLedgerEntry } from '../persistence/counterfactualShadowLearningRepo.js';
import type { Gate1DryRunObservationRow } from '../trading/signalScanner/gate1DryRunObservationLedgerAdr0476.js';
import type { PullbackLaneObservationRow } from './pullbackLaneObservationTypes.js';
import {
  formatUnifiedForwardOutcomeLabelerSection,
  horizonIdempotencyKey,
  normalizeUnifiedForwardOutcomeRows,
  runUnifiedForwardOutcomeLabeler,
  UNIFIED_FORWARD_OUTCOME_SOURCE_REGISTRY,
} from './unifiedForwardOutcomeLabeler.js';

const NOW = new Date('2026-05-22T08:00:00.000Z');

function gate3Seed(overrides: Partial<Gate3OutcomeSeed> = {}): Gate3OutcomeSeed {
  return {
    id: 'gate3-outcome:2026-05-12:005930:scan:READY:vcp',
    symbol: '005930',
    sourceSnapshotId: 'scan:test',
    gate3SnapshotId: 'scan:test:gate3',
    asOf: '2026-05-12T00:00:00.000Z',
    tradeDate: '2026-05-12',
    readiness: 'READY',
    issue: 'vcp',
    route: 'SHADOW_ENTRY_ALLOWED',
    entryReferencePrice: 10_000,
    stopLoss: 9_300,
    targetPrice: 11_500,
    rrr: 2.4,
    priceConfirmation: 'BREAKOUT_CONFIRMED',
    volumeConfirmation: 'CONFIRMED',
    falseBreakoutRisk: 'LOW',
    lastTriggerStatus: 'FIRED',
    learningLabel: 'GATE3_READY_FIRED',
    forwardReturns: { d1: null, d3: null, d5: null, d10: null },
    maxForwardReturnPct: null,
    minForwardReturnPct: null,
    hitTarget: null,
    hitStop: null,
    outcomeStatus: 'PENDING',
    outcomeLabel: null,
    executionImpact: 'NONE',
    marketSignal: false,
    providerIssue: false,
    ...overrides,
  };
}

function gate1Row(overrides: Partial<Gate1DryRunObservationRow> = {}): Gate1DryRunObservationRow {
  return {
    id: 'gate1-dry-run:2026-05-12:005930',
    createdAt: '2026-05-12T00:00:00.000Z',
    forDate: '2026-05-12',
    source: 'GATE1_NEAR_MISS',
    symbol: '005930',
    actualGate1Passed: false,
    actualLiveEligible: false,
    dryRunDecision: 'NEAR_MISS',
    dryRunScenario: 'threshold-minus-5',
    requiredScore: 70,
    providerIssue: false,
    marketSignal: false,
    sectorEnergyDiagnosticOnly: false,
    sellOnly: false,
    entryReferencePrice: 10_000,
    status: 'PENDING',
    executionImpact: 'NONE',
    liveExecutionAllowed: false,
    policyPromotionMode: 'SHADOW_ONLY',
    ...overrides,
  };
}

function nearMissEntry(): NearMissOutcomeEntry {
  return {
    id: 'near-miss:2026-05-12:005930:PROBING',
    stockCode: '005930',
    stockName: 'Samsung Electronics',
    signalDate: '2026-05-12',
    signalPriceKrw: 10_000,
    bucket: 'PROBING',
    diagnosticReason: 'near threshold',
    gateScore: 4.6,
    normalThreshold: 5,
    horizons: [
      { horizonDays: 3, targetDate: '2026-05-15', status: 'OBSERVED', priceKrw: 10_500, returnPct: 5, observedAt: '2026-05-15T00:00:00.000Z' },
      { horizonDays: 5, targetDate: '2026-05-19', status: 'PENDING' },
      { horizonDays: 10, targetDate: '2026-05-26', status: 'PENDING' },
    ],
    createdAt: '2026-05-12T00:00:00.000Z',
    closed: false,
    executionImpact: 'NONE',
  };
}

function counterfactualEntry(): CounterfactualShadowLearningLedgerEntry {
  return {
    symbol: '000660',
    eventType: 'COUNTERFACTUAL_SHADOW_LEARNING_ENTRY',
    source: 'ADR-0430',
    learningOnly: true,
    provisional: false,
    executionShadow: false,
    label: 'COUNTERFACTUAL_BLOCKED_BUY',
    reasons: ['LEARNING_ONLY'],
    blockedBy: ['SHADOW_ONLY_MODE'],
    liveAllowed: false,
    paperAllowed: false,
    executionShadowAllowed: false,
    virtualAccountImpact: 'NONE',
    createdAtKst: '2026-05-12T00:00:00.000Z',
    entryPriceHint: 100_000,
    executionImpact: 'NONE',
    liveOrderSent: false,
  };
}

function pullbackObservationRow(overrides: Partial<PullbackLaneObservationRow> = {}): PullbackLaneObservationRow {
  return {
    scanId: 'scan:pullback:001',
    symbol: '005930',
    asOf: '2026-05-12T00:30:00.000Z',
    pullbackLaneHypotheticalFired: true,
    breakoutChaseLaneFired: false,
    overheatGuardTriggered: false,
    posVsHigh20d: 0.94,
    volRatio: 1.3,
    aboveMa20: true,
    entryRrr: 2.2,
    entryLane: 'PULLBACK',
    maturity: 'PENDING',
    observationOnly: true,
    ...overrides,
  };
}

afterEach(() => {
  delete process.env.UNIFIED_FORWARD_OUTCOME_LABELER_ENABLED;
  delete process.env.PULLBACK_LANE_FORWARD_OBSERVATION_ENABLED;
});

describe('UnifiedForwardOutcomeLabeler', () => {
  it('normalizes Gate3, Gate1, Near-Miss, counterfactual, and paper rows into a safe common schema', () => {
    const rows = normalizeUnifiedForwardOutcomeRows({
      now: NOW,
      gate3Seeds: [gate3Seed({ forwardReturns: { d1: 3, d3: 4, d5: 6, d10: null }, outcomeStatus: 'LABELED', outcomeLabel: 'GATE3_READY_FOLLOW_THROUGH' })],
      gate1Rows: [gate1Row({
        sourceSnapshotId: 'scan:test',
        candidateSetId: 'candidateSet:scan:test:1',
        forwardReturn1D: 2,
        forwardReturn10D: 4,
        status: 'MATURED_10D',
      })],
      nearMissEntries: [nearMissEntry()],
      counterfactualEntries: [counterfactualEntry()],
      paperEntries: [{
        outcomeId: 'paper-observation:2026-05-12:035420',
        symbol: '035420',
        decisionType: 'OBSERVATIONAL_PAPER_ENTRY',
        entryReferencePrice: 200_000,
        createdAt: '2026-05-12T00:00:00.000Z',
        sourceSnapshotId: 'scan:test',
        gateScoreInputSnapshotId: 'scan:test:gate',
      }],
    });

    expect(rows.map((row) => row.sourceType)).toEqual([
      'GATE3_OUTCOME_SEED',
      'GATE1_DRY_RUN_OBSERVATION',
      'NEAR_MISS_OUTCOME',
      'COUNTERFACTUAL_LEDGER',
      'PAPER_OBSERVATIONAL_ENTRY',
    ]);
    expect(rows.every((row) => row.executionImpact === 'NONE' && row.marketSignal === false)).toBe(true);
    expect(horizonIdempotencyKey(rows[0], 'D3')).toBe('GATE3_OUTCOME_SEED:gate3-outcome:2026-05-12:005930:scan:READY:vcp:005930:D3');
    expect(rows[0].sourceLedgerId).toBe(rows[0].outcomeId);
    expect(rows[0].horizonStatusD1).toBe('UPDATED');
    expect(rows[0].priceAtD1).toBe(10_300);
    expect(rows[1].sourceSnapshotId).toBe('scan:test');
    expect(rows[1].candidateSetId).toBe('candidateSet:scan:test:1');
    expect(rows[1].horizonStatusD10).toBe('UPDATED');
    expect(rows[1].forwardReturnD10).toBe(4);
    expect(rows[3].liveExecutionAllowedAtCreation).toBe(false);
    expect(rows[4].policyView).toBe('OBSERVATIONAL_ONLY');
  });

  it('declares source registry safety policy for every common bus input', () => {
    const byType = new Map(UNIFIED_FORWARD_OUTCOME_SOURCE_REGISTRY.map((entry) => [entry.sourceType, entry]));

    expect(byType.get('GATE3_OUTCOME_SEED')?.includeInGate3Evidence).toBe(true);
    expect(byType.get('GATE1_DRY_RUN_OBSERVATION')?.includeInGate1Calibration).toBe(true);
    expect(byType.get('NEAR_MISS_OUTCOME')?.includeInNearMissAnalytics).toBe(true);
    expect(byType.get('COUNTERFACTUAL_LEDGER')?.includeInCounterfactualEvidence).toBe(true);
    expect(byType.get('PAPER_OBSERVATIONAL_ENTRY')?.includeInExecutablePnL).toBe(false);
    expect(UNIFIED_FORWARD_OUTCOME_SOURCE_REGISTRY.every((entry) => entry.executionImpact === 'NONE')).toBe(true);
  });

  it('updates only due horizons and reports learning evidence without enabling live execution', async () => {
    const result = await runUnifiedForwardOutcomeLabeler({
      now: NOW,
      persist: false,
      gate3Seeds: [gate3Seed()],
      gate1Rows: [gate1Row()],
      nearMissEntries: [nearMissEntry()],
      counterfactualEntries: [counterfactualEntry()],
      paperEntries: [],
      priceFetcher: async () => 10_800,
    });

    expect(result.unifiedOutcomeLabelerHealthy).toBe(true);
    expect(result.rowsUpdatedD1).toBeGreaterThan(0);
    expect(result.rowsUpdatedD3).toBeGreaterThan(0);
    expect(result.rowsUpdatedD5).toBeGreaterThan(0);
    expect(result.gate3EvidenceSampleSize).toBeGreaterThan(0);
    expect(result.gate1CalibrationSampleSize).toBeGreaterThan(0);
    expect(result.nearMissEvidenceSampleSize).toBeGreaterThan(0);
    expect(result.sourceRowsByType.GATE3_OUTCOME_SEED).toBe(1);
    expect(result.sourceRowsByType.GATE1_DRY_RUN_OBSERVATION).toBe(1);
    expect(result.sourceRowsByType.NEAR_MISS_OUTCOME).toBe(1);
    expect(result.sourceRowsByType.COUNTERFACTUAL_LEDGER).toBe(1);
    expect(result.counterfactualEvidenceSampleSize).toBe(1);
    expect(result.paperObservationalEvidenceSampleSize).toBe(0);
    expect(result.lastLabelingRunAt).not.toBeNull();
    expect(result.lastLabelingErrorSanitized).toBe('NONE');
    expect(result.liveExecutionAllowed).toBe(false);
    expect(result.executionImpact).toBe('NONE');
    expect(result.thresholdAutoChanged).toBe(false);

    const section = formatUnifiedForwardOutcomeLabelerSection(result);
    expect(section).toContain('unifiedOutcomeLabelerHealthy: true');
    expect(section).toContain('rowsUpdatedD1:');
    expect(section).toContain('sourceRowsByType: GATE3=');
    expect(section).toContain('gate3EvidenceSampleSize:');
    expect(section).toContain('lastLabelingErrorSanitized: NONE');
  });

  it('bridges already-labeled Gate3 threshold evidence into the common bus without rewriting it', async () => {
    const labeledSeeds = Array.from({ length: 249 }, (_, index) =>
      gate3Seed({
        id: `gate3-outcome:2026-05-12:${String(index).padStart(6, '0')}:scan:READY:vcp`,
        symbol: String(index).padStart(6, '0'),
        forwardReturns: { d1: 8, d3: null, d5: null, d10: null },
        outcomeStatus: 'LABELED',
        outcomeLabel: 'GATE3_READY_FOLLOW_THROUGH',
      }),
    );

    const result = await runUnifiedForwardOutcomeLabeler({
      now: NOW,
      persist: false,
      gate3Seeds: labeledSeeds,
      gate1Rows: [],
      nearMissEntries: [],
      counterfactualEntries: [],
      paperEntries: [],
      priceFetcher: async () => {
        throw new Error('already labeled Gate3 evidence should not refetch prices');
      },
    });

    expect(result.unifiedOutcomeLabelerHealthy).toBe(true);
    expect(result.sourceRowsScanned).toBe(249);
    expect(result.sourceRowsByType.GATE3_OUTCOME_SEED).toBe(249);
    expect(result.sourceRowsByType.GATE3_THRESHOLD_EVIDENCE).toBeGreaterThanOrEqual(249);
    expect(result.gate3EvidenceSampleSize).toBeGreaterThanOrEqual(249);
    expect(result.rowsUpdatedD1).toBe(0);
    expect(result.liveExecutionAllowed).toBe(false);
    expect(result.executionImpact).toBe('NONE');
    expect(result.thresholdAutoChanged).toBe(false);
  });

  it('keeps the run healthy when due horizons have no price data', async () => {
    const result = await runUnifiedForwardOutcomeLabeler({
      now: NOW,
      persist: false,
      gate3Seeds: [gate3Seed()],
      gate1Rows: [gate1Row()],
      nearMissEntries: [],
      counterfactualEntries: [],
      paperEntries: [],
      priceFetcher: async () => null,
    });

    expect(result.unifiedOutcomeLabelerHealthy).toBe(true);
    expect(result.sourceRowsScanned).toBeGreaterThan(0);
    expect(result.rowsUpdatedD1 + result.rowsUpdatedD3 + result.rowsUpdatedD5 + result.rowsUpdatedD10).toBe(0);
    expect(result.dataUnavailable).toBeGreaterThan(0);
    expect(result.lastLabelingRunAt).not.toBeNull();
    expect(result.lastLabelingErrorSanitized).toBe('NONE');
    expect(result.liveExecutionAllowed).toBe(false);
    expect(result.executionImpact).toBe('NONE');
  });

  it('honors the rollback env without touching price providers', async () => {
    process.env.UNIFIED_FORWARD_OUTCOME_LABELER_ENABLED = 'false';
    const priceFetcher = vi.fn(async () => 10_800);

    const result = await runUnifiedForwardOutcomeLabeler({
      now: NOW,
      persist: false,
      gate3Seeds: [gate3Seed()],
      gate1Rows: [gate1Row()],
      nearMissEntries: [],
      counterfactualEntries: [],
      paperEntries: [],
      priceFetcher,
    });

    expect(result.unifiedOutcomeLabelerHealthy).toBe(false);
    expect(result.lastLabelingErrorSanitized).toBe('UNIFIED_FORWARD_OUTCOME_LABELER_DISABLED');
    expect(result.liveExecutionAllowed).toBe(false);
    expect(result.executionImpact).toBe('NONE');
    expect(priceFetcher).not.toHaveBeenCalled();
  });

  it('declares PULLBACK_LANE source registry as diagnostic-only observation (ADR-0650)', () => {
    const entry = UNIFIED_FORWARD_OUTCOME_SOURCE_REGISTRY.find((e) => e.sourceType === 'PULLBACK_LANE');
    expect(entry).toBeDefined();
    expect(entry?.diagnosticOnly).toBe(true);
    expect(entry?.includeInExecutablePnL).toBe(false);
    expect(entry?.includeInForwardEvidence).toBe(true);
    expect(entry?.includeInGateCalibration).toBe(false);
    expect(entry?.executionImpact).toBe('NONE');
  });

  it('normalizes a PENDING PULLBACK_LANE row with D1/D3/D5 supported and D10 UNSUPPORTED', () => {
    const rows = normalizeUnifiedForwardOutcomeRows({
      now: NOW,
      pullbackRows: [pullbackObservationRow()],
    });
    expect(rows).toHaveLength(1);
    const row = rows[0];
    expect(row.sourceType).toBe('PULLBACK_LANE');
    expect(row.decisionType).toBe('PULLBACK_LANE');
    expect(row.decisionLabel).toBe('PULLBACK');
    expect(row.policyView).toBe('OBSERVATIONAL_ONLY');
    expect(row.horizonStatusD10).toBe('UNSUPPORTED');
    expect(row.forwardReturnD10).toBeNull();
    // D1/D3/D5 due (asOf 2026-05-12, now 2026-05-22) but no return yet → PENDING.
    expect(row.horizonStatusD1).toBe('PENDING');
    expect(row.horizonStatusD3).toBe('PENDING');
    expect(row.horizonStatusD5).toBe('PENDING');
    expect(row.marketSignal).toBe(false);
    expect(row.executionImpact).toBe('NONE');
    expect(row.liveExecutionAllowedAtCreation).toBe(false);
    expect(row.sourceSnapshotId).toBe('scan:pullback:001');
  });

  it('matures PULLBACK_LANE D1/D3/D5 forward returns from KIS daily closes (ADR-0650 §D2)', async () => {
    // entry(asOf 2026-05-12) close=10000; forward closes vary by date → nonzero returns.
    const closes: Record<string, number> = {
      '2026-05-12': 10_000, // entry close
      '2026-05-13': 10_100, // D1 (+1%)
      '2026-05-15': 10_300, // D3 (+3%)
      '2026-05-19': 10_500, // D5 (+5%)
    };
    const priceFetcher = vi.fn(async (_symbol: string, asOf: Date) => {
      const ymd = asOf.toISOString().slice(0, 10);
      return closes[ymd] ?? null;
    });

    const result = await runUnifiedForwardOutcomeLabeler({
      now: NOW,
      persist: false,
      gate3Seeds: [],
      gate1Rows: [],
      nearMissEntries: [],
      counterfactualEntries: [],
      paperEntries: [],
      pullbackRows: [pullbackObservationRow()],
      priceFetcher,
    });

    expect(result.unifiedOutcomeLabelerHealthy).toBe(true);
    expect(result.sourceRowsByType.PULLBACK_LANE).toBe(1);
    expect(result.rowsUpdatedD1).toBe(1);
    expect(result.rowsUpdatedD3).toBe(1);
    expect(result.rowsUpdatedD5).toBe(1);
    expect(result.rowsUpdatedD10).toBe(0);
    expect(result.liveExecutionAllowed).toBe(false);
    expect(result.executionImpact).toBe('NONE');
    expect(result.thresholdAutoChanged).toBe(false);

    const section = formatUnifiedForwardOutcomeLabelerSection(result);
    expect(section).toContain('PULLBACK_LANE=1');
  });

  it('gracefully skips PULLBACK_LANE maturation when forward closes are missing (invariant #6)', async () => {
    const priceFetcher = vi.fn(async () => null);
    const result = await runUnifiedForwardOutcomeLabeler({
      now: NOW,
      persist: false,
      gate3Seeds: [],
      gate1Rows: [],
      nearMissEntries: [],
      counterfactualEntries: [],
      paperEntries: [],
      pullbackRows: [pullbackObservationRow()],
      priceFetcher,
    });

    expect(result.unifiedOutcomeLabelerHealthy).toBe(true);
    expect(result.rowsUpdatedD1 + result.rowsUpdatedD3 + result.rowsUpdatedD5).toBe(0);
    expect(result.dataUnavailable).toBeGreaterThan(0);
    expect(result.sourceRowsByType.PULLBACK_LANE).toBe(1);
    expect(result.executionImpact).toBe('NONE');
  });

  it('treats a RESOLVED PULLBACK_LANE row as immutable evidence without refetching', async () => {
    const priceFetcher = vi.fn(async () => {
      throw new Error('RESOLVED PULLBACK_LANE row must not refetch prices');
    });
    const result = await runUnifiedForwardOutcomeLabeler({
      now: NOW,
      persist: false,
      gate3Seeds: [],
      gate1Rows: [],
      nearMissEntries: [],
      counterfactualEntries: [],
      paperEntries: [],
      pullbackRows: [pullbackObservationRow({
        maturity: 'RESOLVED',
        forwardReturn1d: 1,
        forwardReturn3d: 3,
        forwardReturn5d: 5,
        maturedAt: '2026-05-19T00:00:00.000Z',
      })],
      priceFetcher,
    });

    expect(result.unifiedOutcomeLabelerHealthy).toBe(true);
    expect(result.sourceRowsByType.PULLBACK_LANE).toBe(1);
    expect(result.rowsUpdatedD1 + result.rowsUpdatedD3 + result.rowsUpdatedD5).toBe(0);
    expect(priceFetcher).not.toHaveBeenCalled();
  });

  it('does not load PULLBACK_LANE ledger when flag is OFF (byte-equivalent baseline)', async () => {
    delete process.env.PULLBACK_LANE_FORWARD_OBSERVATION_ENABLED; // default OFF
    const priceFetcher = vi.fn(async () => 10_500);
    const result = await runUnifiedForwardOutcomeLabeler({
      now: NOW,
      persist: false,
      gate3Seeds: [gate3Seed()],
      gate1Rows: [],
      nearMissEntries: [],
      counterfactualEntries: [],
      paperEntries: [],
      // no pullbackRows injected → flag OFF means ledger is not loaded.
      priceFetcher,
    });

    expect(result.unifiedOutcomeLabelerHealthy).toBe(true);
    expect(result.sourceRowsByType.PULLBACK_LANE ?? 0).toBe(0);
    expect(result.executionImpact).toBe('NONE');
  });

  it('keeps existing source types unchanged when PULLBACK_LANE rows are present (no regression)', () => {
    const rows = normalizeUnifiedForwardOutcomeRows({
      now: NOW,
      gate3Seeds: [gate3Seed({ forwardReturns: { d1: 3, d3: 4, d5: 6, d10: null }, outcomeStatus: 'LABELED', outcomeLabel: 'GATE3_READY_FOLLOW_THROUGH' })],
      gate1Rows: [gate1Row()],
      nearMissEntries: [nearMissEntry()],
      counterfactualEntries: [counterfactualEntry()],
      pullbackRows: [pullbackObservationRow()],
    });
    expect(rows.map((row) => row.sourceType)).toEqual([
      'GATE3_OUTCOME_SEED',
      'GATE1_DRY_RUN_OBSERVATION',
      'NEAR_MISS_OUTCOME',
      'COUNTERFACTUAL_LEDGER',
      'PULLBACK_LANE',
    ]);
    expect(rows.every((row) => row.executionImpact === 'NONE' && row.marketSignal === false)).toBe(true);
    // Existing Gate3 row still normalized identically.
    expect(rows[0].horizonStatusD1).toBe('UPDATED');
    expect(rows[0].priceAtD1).toBe(10_300);
  });

  it('is wired to a startup activation and an ALWAYS_ON dedicated scheduler', () => {
    const source = readFileSync(new URL('../scheduler/learningJobs.ts', import.meta.url), 'utf8');

    expect(source).toContain("runUnifiedForwardOutcomeLabelerJob('startup')");
    expect(source).toContain("scheduledJob('36 7 * * *', 'ALWAYS_ON', 'unified_forward_outcome_labeling'");
    expect(source).not.toContain("scheduledJob('36 7 * * 1-5', 'TRADING_DAY_ONLY', 'unified_forward_outcome_labeling'");
  });
});
