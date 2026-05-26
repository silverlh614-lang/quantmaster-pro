import { describe, expect, it } from 'vitest';
import { buildGate3EvidenceWarmupStatus, formatGate3EvidenceWarmupSection, tradingDaysBetween } from './gate3EvidenceWarmup.js';
import type { Gate3OutcomeSeed, Gate3OutcomeStatus } from './gate3OutcomeSeed.js';

function seed(input: {
  id: string;
  tradeDate: string;
  status?: Gate3OutcomeStatus;
  d1?: number | null;
  d3?: number | null;
  d5?: number | null;
  d10?: number | null;
}): Gate3OutcomeSeed {
  return {
    id: input.id,
    symbol: input.id,
    sourceSnapshotId: 'scan-eval:warmup',
    gate3SnapshotId: 'scan-eval:warmup:gate3',
    asOf: `${input.tradeDate}T09:00:00.000Z`,
    tradeDate: input.tradeDate,
    readiness: 'READY',
    issue: 'FIRED',
    route: 'SHADOW_ENTRY_ALLOWED',
    entryReferencePrice: 10_000,
    stopLoss: 9_300,
    targetPrice: 11_500,
    rrr: 2.1,
    priceConfirmation: 'BREAKOUT_CONFIRMED',
    volumeConfirmation: 'CONFIRMED',
    falseBreakoutRisk: 'LOW',
    lastTriggerStatus: 'FIRED',
    learningLabel: 'GATE3_READY_FIRED',
    forwardReturns: {
      d1: input.d1 ?? null,
      d3: input.d3 ?? null,
      d5: input.d5 ?? null,
      d10: input.d10 ?? null,
    },
    maxForwardReturnPct: input.d5 ?? null,
    minForwardReturnPct: input.d5 ?? null,
    hitTarget: false,
    hitStop: false,
    outcomeStatus: input.status ?? 'PENDING',
    outcomeLabel: input.status === 'LABELED' ? 'GATE3_READY_FOLLOW_THROUGH' : null,
    executionImpact: 'NONE',
    marketSignal: false,
    providerIssue: false,
  };
}

describe('Gate3 Evidence Warm-up', () => {
  it('counts trading-day age and forward return update coverage', () => {
    const status = buildGate3EvidenceWarmupStatus([
      seed({ id: 'A', tradeDate: '2026-05-18', status: 'PARTIAL', d1: 1, d3: 2 }),
      seed({ id: 'B', tradeDate: '2026-05-21', status: 'LABELED', d1: 1, d3: 2, d5: 3 }),
    ], {
      now: new Date('2026-05-25T00:00:00.000Z'),
      thresholdEvidenceSampleSize: 1,
    });

    expect(tradingDaysBetween('2026-05-22', new Date('2026-05-25T00:00:00.000Z'))).toBe(1);
    expect(status.partial).toBe(1);
    expect(status.labeled).toBe(1);
    expect(status.oldestPendingAgeTradingDays).toBe(5);
    expect(status.d1Updated).toBe(2);
    expect(status.d3Updated).toBe(2);
    expect(status.d5Updated).toBe(1);
    expect(status.d10Updated).toBe(0);
    expect(status.evidenceReady).toBe(true);
    expect(status.marketSignal).toBe(false);
    expect(status.providerIssue).toBe(false);
  });

  it('warns when labeler stalls, D1 is missing, duplicates look unchecked, or aggregator is disconnected', () => {
    const stalled = buildGate3EvidenceWarmupStatus([
      seed({ id: 'A', tradeDate: '2026-05-18' }),
    ], { now: new Date('2026-05-25T00:00:00.000Z') });
    const duplicateRisk = buildGate3EvidenceWarmupStatus(
      Array.from({ length: 100 }, (_, index) => seed({ id: `P${index}`, tradeDate: '2026-05-24' })),
      { now: new Date('2026-05-24T00:00:00.000Z'), duplicateSuppressed: 0 },
    );
    const disconnected = buildGate3EvidenceWarmupStatus([
      seed({ id: 'L', tradeDate: '2026-05-18', status: 'LABELED', d1: 1, d3: 2, d5: 3 }),
    ], { now: new Date('2026-05-25T00:00:00.000Z'), thresholdEvidenceSampleSize: 0 });

    expect(stalled.warnings).toContain('WARN_OUTCOME_LABELER_STALLED');
    expect(stalled.warnings).toContain('WARN_FORWARD_RETURN_UPDATE_MISSING');
    expect(stalled.schedulerHealthy).toBe(false);
    expect(duplicateRisk.warnings).toContain('WARN_DUPLICATE_SUPPRESSION_CHECK');
    expect(duplicateRisk.schedulerHealthy).toBe(true);
    expect(disconnected.warnings).toContain('WARN_EVIDENCE_AGGREGATOR_DISCONNECTED');
    expect(disconnected.schedulerHealthy).toBe(false);
  });

  it('formats the operator warm-up section', () => {
    const status = buildGate3EvidenceWarmupStatus([
      seed({ id: 'A', tradeDate: '2026-05-18' }),
    ], { now: new Date('2026-05-25T00:00:00.000Z') });

    const text = formatGate3EvidenceWarmupSection(status);

    expect(text).toContain('Gate3 Evidence Warm-up');
    expect(text).toContain('pending: 1');
    expect(text).toContain('schedulerHealthy: false');
    expect(text).toContain('WARN_OUTCOME_LABELER_STALLED');
    expect(text).toContain('marketSignal=false');
  });
});
