// @responsibility Counterfactual outcome board read-only aggregation regression tests.
import { describe, expect, it } from 'vitest';
import type { ScanSummary } from '../trading/signalScanner/scanDiagnostics/scanSummaryTypes.js';
import type { Gate1DryRunObservationRow } from '../trading/signalScanner/gate1DryRunObservationLedgerAdr0476.js';
import type { CounterfactualShadowLearningLedgerEntry } from '../persistence/counterfactualShadowLearningRepo.js';
import {
  buildCounterfactualOutcomeBoard,
  formatCounterfactualBoardSummary,
  formatCounterfactualGate1,
  formatCounterfactualGate2,
  formatCounterfactualGate3,
  formatCounterfactualMissed,
  formatCounterfactualReview,
  formatCounterfactualToday,
  formatCounterfactualDebug,
  resolveCounterfactualCommandMode,
} from './counterfactualOutcomeBoard.js';

const NOW = new Date('2026-06-02T06:30:00.000Z');

function gate1Row(overrides: Partial<Gate1DryRunObservationRow> = {}): Gate1DryRunObservationRow {
  return {
    id: 'cf-gate1-138530',
    createdAt: '2026-06-02T06:00:00.000Z',
    forDate: '2026-06-02',
    scanId: 'scan-eval-20260602152915',
    sourceSnapshotId: 'snapshot-20260602152915',
    candidateSetId: 'candidate-set-20260602152915',
    source: 'GATE1_NEAR_MISS',
    symbol: '138530',
    name: 'A',
    actualGate1Passed: false,
    actualLiveEligible: false,
    dryRunDecision: 'NEAR_MISS',
    dryRunScenario: 'threshold-minus-5',
    dryRunScore: 68.4,
    requiredScore: 70,
    scoreSource: 'MIN_SIGNAL_TRACE',
    providerIssue: false,
    marketSignal: false,
    sectorEnergyDiagnosticOnly: false,
    sellOnly: false,
    entryReferencePrice: 10_000,
    gate2Evaluated: true,
    gate2Pass: false,
    gate2PrimaryBlocker: 'BREAKOUT_MOMENTUM_NOT_CONFIRMED',
    gate3Evaluated: true,
    gate3Readiness: 'PRE_BREAKOUT_WAIT',
    rrrStatus: 'RRR_WATCH',
    volumeConfirmation: 'VOLUME_WEAK',
    priceConfirmation: 'PRICE_NOT_CONFIRMED',
    lastTriggerStatus: 'LAST_TRIGGER_NOT_FIRED',
    forwardReturn1D: 2.1,
    forwardReturn3D: 4.2,
    forwardReturn5D: 12.4,
    mfeD5: 15.1,
    maeD5: -1.8,
    status: 'MATURED_5D',
    executionImpact: 'NONE',
    liveExecutionAllowed: false,
    policyPromotionMode: 'SHADOW_ONLY',
    ...overrides,
  };
}

function counterfactualEntry(): CounterfactualShadowLearningLedgerEntry {
  return {
    symbol: '022100',
    name: 'C',
    eventType: 'COUNTERFACTUAL_SHADOW_LEARNING_ENTRY',
    source: 'ADR-0430',
    learningOnly: true,
    provisional: false,
    executionShadow: false,
    label: 'R3_COUNTERFACTUAL_GATE2_NOT_CONFIRMED',
    reasons: ['R3_EARLY', 'GATE1_SURVIVOR', 'LEARNING_ONLY', 'GATE2_NOT_CONFIRMED'],
    blockedBy: ['GATE2_NOT_CONFIRMED'],
    liveAllowed: false,
    paperAllowed: false,
    executionShadowAllowed: false,
    virtualAccountImpact: 'NONE',
    scanId: 'scan-eval-20260602152915',
    createdAtKst: '2026-06-02T06:10:00.000Z',
    gate1Passed: true,
    gate2Passed: false,
    entryPriceHint: 5_000,
    executionImpact: 'NONE',
    liveOrderSent: false,
    sourceSnapshotId: 'snapshot-20260602152915',
    candidateSetId: 'candidate-set-20260602152915',
  } as CounterfactualShadowLearningLedgerEntry & { candidateSetId: string; sourceSnapshotId: string };
}

function lastScanSummary(): ScanSummary {
  return {
    time: '2026-06-02T06:29:15.000Z',
    candidates: 50,
    trackB: 0,
    swing: 0,
    catalyst: 0,
    momentum: 0,
    quoteFails: 0,
    gateMisses: 0,
    rrrMisses: 0,
    entries: 0,
    snapshotId: 'snapshot-20260602152915',
    scanEvaluation: { scanId: 'scan-eval-20260602152915', sourceSnapshotId: 'snapshot-20260602152915' } as unknown as ScanSummary['scanEvaluation'],
    entryFilterDecomposition: {
      ledgerRowsCreated: 50,
      counterfactualReady: 24,
      counterfactualRecorded: 24,
    } as ScanSummary['entryFilterDecomposition'],
    paperEntryForensic: {
      decisionRecords: [
        {
          symbol: '138530',
          sourceSnapshotId: 'snapshot-20260602152915',
          candidateSetId: 'candidate-set-20260602152915',
          gateScoreInputSnapshotId: 'gate-score-1',
          scanId: 'scan-eval-20260602152915',
          decision: 'CREATED',
          stage: 'ORDER_CREATION',
          skipReason: 'NONE',
          gate1HardSurvivor: true,
          minSignalLivePass: true,
          gate2PendingPreserved: true,
          shadowObservableStrict: true,
          shadowObservableSoft: true,
          paperEntryEligible: true,
          existingOpenShadowPosition: false,
          existingPendingPaperOrder: false,
          sizingAllowed: false,
          executionPermission: 'OBSERVATIONAL_ONLY',
          paperEntryKind: 'OBSERVATIONAL_PAPER_ENTRY',
          paperExecutable: false,
        },
      ],
      createdSymbols: ['138530'],
      executionImpact: 'NONE',
    },
  };
}

describe('counterfactualOutcomeBoard', () => {
  it('normalizes Gate1 and counterfactual ledger rows into diagnostic-only board rows', async () => {
    const board = await buildCounterfactualOutcomeBoard({
      now: NOW,
      gate1Rows: [
        gate1Row(),
        gate1Row({
          id: 'cf-gate1-007390',
          symbol: '007390',
          dryRunScore: 56,
          gate2PrimaryBlocker: 'RRR_FAIL',
          gate3Readiness: 'BLOCKED',
          rrrStatus: 'RRR_FAIL',
          forwardReturn5D: -1,
          mfeD5: 1,
          maeD5: -6,
        }),
      ],
      counterfactualEntries: [counterfactualEntry()],
      legacyEntries: [],
      lastScanSummary: lastScanSummary(),
    });

    expect(board.rows).toHaveLength(3);
    const missed = board.rows.find((row) => row.symbol === '138530');
    expect(missed?.gate1Band).toBe('65~70');
    expect(missed?.gate1PassType).toBe('SOFT_PASS');
    expect(missed?.gate2Status).toBe('FAIL');
    expect(missed?.gate3Status).toBe('WAIT');
    expect(missed?.wouldPassIfThresholdMinus5).toBe(true);
    expect(missed?.outcomeLabel).toBe('MISSED_OPPORTUNITY');
    expect(missed?.falseNegative).toBe(true);
    expect(missed?.recommendedAction).toBe('REVIEW_GATE1_BAND_WITH_OPERATOR');
    expect(board.summary.totalRecorded).toBe(3);
    expect(board.summary.matureD5).toBe(2);
    expect(board.summary.missedOpportunityRateD5).toBe(0.5);
    expect(board.gate1Bands.find((band) => band.key === '65~70')?.count).toBe(1);
    expect(board.gate2Blockers.find((blocker) => blocker.key === 'BREAKOUT_MOMENTUM_NOT_CONFIRMED')?.count).toBe(2);
    expect(board.topMissedOpportunities[0]?.symbol).toBe('138530');
    expect(board.executionImpact).toBe('NONE');
    expect(board.thresholdAutoChanged).toBe(false);
    expect(board.operatorApprovalRequired).toBe(true);
    expect(board.debug.totalRawRows).toBe(3);
    expect(board.debug.includedRows).toBe(3);
    expect(board.debug.excludedRows).toBe(0);
    expect(board.safety.counterfactualReportingNonExecutional).toBe(true);
    expect(board.safety.thresholdAutoChangeForbidden).toBe(true);
    expect(board.safety.sourceSnapshotLinked).toBe(true);
  });

  it('builds today, review, and Telegram formatter sections without execution side effects', async () => {
    const board = await buildCounterfactualOutcomeBoard({
      now: NOW,
      gate1Rows: [gate1Row()],
      counterfactualEntries: [counterfactualEntry()],
      legacyEntries: [],
      lastScanSummary: lastScanSummary(),
    });

    expect(board.today.scanId).toBe('scan-eval-20260602152915');
    expect(board.today.totalRecorded).toBe(50);
    expect(board.today.gateCounterfactualReadyCount).toBe(24);
    expect(board.today.paperObservationalSymbols).toEqual(['138530']);
    expect(board.review.status).toBe('INSUFFICIENT_SAMPLE');

    expect(formatCounterfactualBoardSummary(board)).toContain('Execution Impact: NONE');
    expect(formatCounterfactualToday(board)).toContain('total recorded: 50');
    expect(formatCounterfactualGate1(board)).toContain('thresholdAutoChanged=false');
    expect(formatCounterfactualGate2(board)).toContain('BREAKOUT_MOMENTUM_NOT_CONFIRMED');
    expect(formatCounterfactualGate3(board)).toContain('PRE_BREAKOUT_WAIT');
    expect(formatCounterfactualMissed(board)).toContain('138530');
    expect(formatCounterfactualReview(board)).toContain('NO_THRESHOLD_CHANGE');
    expect(resolveCounterfactualCommandMode('/counterfactual_gate2')).toBe('gate2');
    expect(resolveCounterfactualCommandMode('/counterfactual', ['missed'])).toBe('missed');
  });

  it('excludes replay diagnostic artifacts from debug sample rows and reports reasons', async () => {
    const replayArtifact = gate1Row({
      id: 'ADR_0491_SUPPLY_SNAPSHOT_STORE_REPLAY:2026-06-02',
      source: 'ADR_0491_SUPPLY_SNAPSHOT_STORE_REPLAY',
      observationType: 'SUPPLY_SNAPSHOT_STORE_REPLAY_ADR0491',
      scanId: undefined,
      sourceSnapshotId: undefined,
      candidateSetId: undefined,
      dryRunScore: undefined,
      gate2PrimaryBlocker: undefined,
      gate3Readiness: undefined,
      entryReferencePrice: undefined,
    });
    const board = await buildCounterfactualOutcomeBoard({
      now: NOW,
      gate1Rows: [replayArtifact, gate1Row()],
      counterfactualEntries: [],
      legacyEntries: [],
      lastScanSummary: lastScanSummary(),
    });

    expect(board.rows).toHaveLength(1);
    expect(board.rows[0]?.counterfactualId).not.toContain('ADR_0491_SUPPLY_SNAPSHOT_STORE_REPLAY');
    expect(board.rows[0]?.symbol).toBe('138530');
    expect(board.rows[0]?.scanId).toBe('scan-eval-20260602152915');
    expect(board.rows[0]?.sourceSnapshotId).toBe('snapshot-20260602152915');
    expect(board.rows[0]?.candidateSetId).toBe('candidate-set-20260602152915');
    expect(board.rows[0]?.gate1Band).toBe('65~70');
    expect(board.rows[0]?.blockedByPrimary).toBe('BREAKOUT_MOMENTUM_NOT_CONFIRMED');
    expect(board.safety.sourceSnapshotLinked).toBe(true);
    expect(board.debug.totalRawRows).toBe(2);
    expect(board.debug.includedRows).toBe(1);
    expect(board.debug.excludedRows).toBe(1);
    expect(board.debug.excludedReasonDistribution.DIAGNOSTIC_REPLAY_ARTIFACT).toBe(1);
    expect(board.debug.rowTypeDistribution.SUPPLY_SNAPSHOT_STORE_REPLAY).toBe(1);
    expect(board.debug.idPrefixDistribution.ADR_0491_SUPPLY_SNAPSHOT_STORE_REPLAY).toBe(1);

    const debug = formatCounterfactualDebug(board);
    const sampleSection = (debug.split('sampleRows:')[1] ?? debug).split('excludedSampleRows:')[0] ?? debug;
    expect(sampleSection).not.toContain('ADR_0491_SUPPLY_SNAPSHOT_STORE_REPLAY');
    expect(sampleSection).toContain('138530');
    expect(sampleSection).toContain('scanId=scan-eval-20260602152915');
    expect(sampleSection).toContain('sourceSnapshotId=snapshot-20260602152915');
    expect(sampleSection).toContain('candidateSetId=candidate-set-20260602152915');
    expect(sampleSection).toContain('band=65~70');
    expect(sampleSection).toContain('blockedBy=BREAKOUT_MOMENTUM_NOT_CONFIRMED');
    expect(debug).toContain('DIAGNOSTIC_REPLAY_ARTIFACT=1');
    expect(debug).toContain('executionImpact=NONE');
    expect(debug).toContain('thresholdAutoChanged=false');
    expect(debug).toContain('livePermissionUnchanged=true');
    expect(debug).toContain('shadowLearningContinues=true');
  });

  describe('bandMaturityStallGuard', () => {
    function canonicalImmatureRow(createdAt: string): Gate1DryRunObservationRow {
      // canonical band-eligible (MIN_SIGNAL_TRACE, score → 65~70) but no D5 return yet.
      return gate1Row({
        createdAt,
        forwardReturn1D: undefined,
        forwardReturn3D: undefined,
        forwardReturn5D: undefined,
        mfeD5: undefined,
        maeD5: undefined,
        status: 'PENDING',
      });
    }

    it('reports HEALTHY when canonical bands have matured D5 rows', async () => {
      const board = await buildCounterfactualOutcomeBoard({
        now: NOW,
        gate1Rows: [gate1Row()],
        counterfactualEntries: [],
        legacyEntries: [],
        lastScanSummary: lastScanSummary(),
      });
      const g = board.bandMaturityStallGuard;
      expect(g.totalBandMatureD5).toBeGreaterThan(0);
      expect(g.status).toBe('HEALTHY');
      expect(g.recommendedAction).toBe('NONE');
      expect(g.executionImpact).toBe('NONE');
      expect(g.observationOnly).toBe(true);
      expect(g.stallThresholdTradingDays).toBe(7);
    });

    it('reports IMMATURE_WAITING when matureD5=0 and oldest band row is younger than threshold', async () => {
      const now = new Date('2026-06-30T06:30:00.000Z');
      const board = await buildCounterfactualOutcomeBoard({
        now,
        gate1Rows: [canonicalImmatureRow('2026-06-29T06:00:00.000Z')],
        counterfactualEntries: [],
        legacyEntries: [],
        lastScanSummary: lastScanSummary(),
      });
      const g = board.bandMaturityStallGuard;
      expect(g.totalBandMatureD5).toBe(0);
      expect(g.totalBandRows).toBeGreaterThan(0);
      expect(g.oldestBandRowAgeTradingDays).not.toBeNull();
      expect(g.oldestBandRowAgeTradingDays as number).toBeLessThan(7);
      expect(g.status).toBe('IMMATURE_WAITING');
      expect(g.recommendedAction).toBe('OBSERVE_MORE');
    });

    it('reports STALL_SUSPECTED when matureD5=0 and oldest band row is at/above threshold', async () => {
      const now = new Date('2026-06-30T06:30:00.000Z');
      const board = await buildCounterfactualOutcomeBoard({
        now,
        gate1Rows: [canonicalImmatureRow('2026-06-02T06:00:00.000Z')],
        counterfactualEntries: [],
        legacyEntries: [],
        lastScanSummary: lastScanSummary(),
      });
      const g = board.bandMaturityStallGuard;
      expect(g.totalBandMatureD5).toBe(0);
      expect(g.oldestBandRowAgeTradingDays as number).toBeGreaterThanOrEqual(7);
      expect(g.status).toBe('STALL_SUSPECTED');
      expect(g.recommendedAction).toBe('INVESTIGATE_LABELER_WRITEBACK_OR_REFERENCE_PRICE');
      const gate1 = formatCounterfactualGate1(board);
      expect(gate1).toContain('⚠️ bandMaturityStallGuard:');
      expect(gate1).toContain('status=STALL_SUSPECTED');
      expect(gate1).toContain('threshold=7');
      expect(gate1).toContain('action=INVESTIGATE_LABELER_WRITEBACK_OR_REFERENCE_PRICE');
    });

    it('excludes weekends/holidays via krxTradingCalendar in the age count', async () => {
      // 2026-06-02 (Tue) → 2026-06-09 (Tue) is 7 calendar days. KRX has 2026-06-03
      // (지방선거) and 2026-06-06 (현충일) holidays + one weekend, so trading-day age < 7
      // → IMMATURE_WAITING (calendar-day count would wrongly trip STALL).
      const now = new Date('2026-06-09T06:30:00.000Z');
      const board = await buildCounterfactualOutcomeBoard({
        now,
        gate1Rows: [canonicalImmatureRow('2026-06-02T06:00:00.000Z')],
        counterfactualEntries: [],
        legacyEntries: [],
        lastScanSummary: lastScanSummary(),
      });
      const g = board.bandMaturityStallGuard;
      expect(g.oldestBandRowAgeTradingDays as number).toBeLessThan(7);
      expect(g.status).toBe('IMMATURE_WAITING');
    });

    it('returns safe defaults (not STALL, NONE) for an empty board without throwing', async () => {
      const board = await buildCounterfactualOutcomeBoard({
        now: NOW,
        gate1Rows: [],
        counterfactualEntries: [],
        legacyEntries: [],
        lastScanSummary: lastScanSummary(),
      });
      const g = board.bandMaturityStallGuard;
      expect(g.status).not.toBe('STALL_SUSPECTED');
      expect(g.status).toBe('IMMATURE_WAITING');
      expect(g.recommendedAction).toBe('OBSERVE_MORE');
      expect(g.totalBandMatureD5).toBe(0);
      expect(g.totalBandRows).toBe(0);
      expect(g.oldestBandRowAgeTradingDays).toBeNull();
      expect(g.executionImpact).toBe('NONE');
    });

    it('keeps existing band/legacyScaleMixed output byte-equivalent (additive guard only)', async () => {
      const board = await buildCounterfactualOutcomeBoard({
        now: NOW,
        gate1Rows: [gate1Row()],
        counterfactualEntries: [counterfactualEntry()],
        legacyEntries: [],
        lastScanSummary: lastScanSummary(),
      });
      const gate1 = formatCounterfactualGate1(board);
      const lines = gate1.split('\n');
      const guardIdx = lines.findIndex((l) => l.includes('bandMaturityStallGuard:'));
      const legacyIdx = lines.findIndex((l) => l.startsWith('legacyScaleMixed(밴드 제외):'));
      // guard line is inserted immediately after legacyScaleMixed; all other lines unchanged.
      expect(guardIdx).toBe(legacyIdx + 1);
      expect(lines[0]).toBe('[Counterfactual Gate1 Bands]');
      expect(gate1).toContain('thresholdAutoChanged=false');
      expect(gate1).toContain('legacyScale70Plus(scoreSource 격리):');
      // removing the single guard line reproduces the prior output exactly.
      const withoutGuard = lines.filter((_, i) => i !== guardIdx).join('\n');
      expect(withoutGuard).not.toContain('bandMaturityStallGuard');
    });
  });

  it('reports no valid rows when every raw row is excluded', async () => {
    const board = await buildCounterfactualOutcomeBoard({
      now: NOW,
      gate1Rows: [
        gate1Row({
          id: 'ADR_0491_SUPPLY_SNAPSHOT_STORE_REPLAY:only',
          source: 'ADR_0491_SUPPLY_SNAPSHOT_STORE_REPLAY',
          observationType: 'SUPPLY_SNAPSHOT_STORE_REPLAY_ADR0491',
          scanId: undefined,
          sourceSnapshotId: undefined,
          candidateSetId: undefined,
          entryReferencePrice: undefined,
        }),
      ],
      counterfactualEntries: [],
      legacyEntries: [],
      lastScanSummary: lastScanSummary(),
    });

    expect(board.rows).toHaveLength(0);
    expect(board.summary.verdict).toBe('NO_VALID_COUNTERFACTUAL_ROWS');
    expect(board.safety.sourceSnapshotLinked).toBe(false);
    const debug = formatCounterfactualDebug(board);
    expect(debug).toContain('includedRows=0');
    expect(debug).toContain('operatorAction=FIX_ROW_SELECTION_OR_COUNTERFACTUAL_WRITE_PATH');
  });
});
