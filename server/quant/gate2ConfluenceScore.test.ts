// @responsibility ADR-0519 Gate2 confluence promotion policy tests.
import { describe, expect, it } from 'vitest';
import {
  buildGate2ConfluenceSummary,
  buildGate2EvaluationResult,
  type Gate2EvaluationResult,
} from './gate2ConfluenceScore.js';

function bullishTrace(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    symbol: '005930',
    name: 'Samsung',
    gate1Passed: true,
    symbolFeatures: {
      rsScore: 100,
      maAlignmentStatus: 'NEUTRAL',
      aboveMA20: true,
      aboveMA60: true,
      return20d: 4,
    },
    gate2ExternalDataCoverage: {
      kisInvestorFlow: {
        status: 'VERIFIED',
        foreignNetBuy: 1200,
        institutionalNetBuy: 900,
      },
      sectorCycle: {
        status: 'VERIFIED',
        values: {
          sectorRelativeReturn20d: 8,
          stockVsSectorReturn20d: 4,
          sectorPercentile20d: 82,
        },
      },
      leaderCycle: {
        isCurrentLeadingSector: true,
        isSectorLeader: true,
        attentionPhase: 'EARLY',
      },
    },
    ...overrides,
  };
}

function status(result: Gate2EvaluationResult): string {
  return result.gate2Status;
}

describe('ADR-0519 Gate2 confluence score', () => {
  it('classifies RS/supply/sector bullish with technical neutral and fundamental missing as pass via coverage adjusted score', () => {
    const result = buildGate2EvaluationResult({
      trace: bullishTrace(),
      sourceSnapshotId: 'snap:gate2',
    });

    expect(['GATE2_PASS_STRONG', 'GATE2_PASS_WEAK']).toContain(status(result));
    expect(result.usableAxisCount).toBeGreaterThanOrEqual(4);
    expect(result.coverageAdjustedScore).toBeGreaterThanOrEqual(80);
    expect(result.axes.find(axis => axis.axis === 'FUNDAMENTAL_QUALITY')).toMatchObject({
      status: 'MISSING',
      scoreIncluded: false,
      missingReason: 'DART_FINANCIALS_MISSING',
    });
    expect(result.executionImpact).toBe('NONE');
    expect(result.marketSignal).toBe(false);
  });

  it('uses DATA_INCOMPLETE when fewer than three axes are usable', () => {
    const result = buildGate2EvaluationResult({
      sourceSnapshotId: 'snap:gate2',
      trace: {
        symbol: '000660',
        gate1Passed: true,
        symbolFeatures: {
          rsScore: 85,
          maAlignmentStatus: 'BULLISH',
          aboveMA20: true,
          aboveMA60: true,
        },
      },
    });

    expect(result.gate2Status).toBe('DATA_INCOMPLETE');
    expect(result.usableAxisCount).toBe(2);
    expect(result.primaryBlocker).toContain('MISSING_');
  });

  it('excludes AI estimated fundamentals from weighted score', () => {
    const result = buildGate2EvaluationResult({
      sourceSnapshotId: 'snap:gate2',
      trace: bullishTrace({
        gate2ExternalDataCoverage: {
          kisInvestorFlow: { status: 'VERIFIED', foreignNetBuy: 1, institutionalNetBuy: 1 },
          sectorCycle: { status: 'VERIFIED', values: { sectorRelativeReturn20d: 8, stockVsSectorReturn20d: 4 } },
          dartFinancials: { status: 'VERIFIED', source: 'AI_ESTIMATED', confidence: 'AI_ESTIMATED' },
        },
      }),
    });

    const fundamental = result.axes.find(axis => axis.axis === 'FUNDAMENTAL_QUALITY');
    expect(fundamental).toMatchObject({
      confidence: 'AI_ESTIMATED',
      promotionStage: 'OBSERVE',
      scoreIncluded: false,
    });
    expect(result.aiEstimatedAxisCount).toBe(1);
  });

  it('neutralizes NO_ROW_FOUND supply instead of treating it as bearish', () => {
    const result = buildGate2EvaluationResult({
      sourceSnapshotId: 'snap:gate2',
      trace: bullishTrace({
        supplyProviderHealth: {
          semanticRowBreakPoint: 'NO_ROW_FOUND',
        },
        gate2ExternalDataCoverage: {
          kisInvestorFlow: { status: 'MISSING' },
          sectorCycle: { status: 'VERIFIED', values: { sectorRelativeReturn20d: 8, stockVsSectorReturn20d: 4 } },
        },
      }),
    });

    const supply = result.axes.find(axis => axis.axis === 'SUPPLY_CONFLUENCE');
    expect(supply).toMatchObject({
      status: 'MISSING',
      confidence: 'MISSING',
      scoreIncluded: false,
      missingReason: 'SUPPLY_ROW_MISSING_NEUTRALIZED',
    });
    expect(supply?.evidence).toContain('marketSignal=false');
  });

  it('skips Gate2 when Gate1 hard failed', () => {
    const result = buildGate2EvaluationResult({
      sourceSnapshotId: 'snap:gate2',
      trace: {
        ...bullishTrace(),
        gate1Passed: false,
        gate1Trace: { hardFailCount: 1, gate1Passed: false },
      },
    });

    expect(result.gate2Status).toBe('SKIPPED_BY_GATE1');
    expect(result.gate2EvaluationScope).toBe('DIAGNOSTIC_ONLY');
    expect(result.finalGate2).toBe('NOT_EVALUATED_DUE_TO_GATE1_FAIL');
    expect(result.upstreamBlocker).toBe('GATE1_FAIL');
    expect(result.gate2DiagnosticPrimary).toBe('SKIPPED_BY_GATE1_HARD_FAIL');
    expect(result.primaryBlocker).toBeUndefined();
    expect(result.executionImpact).toBe('NONE');
  });

  it('evaluates Gate1 degraded-pass candidates diagnostically', () => {
    const result = buildGate2EvaluationResult({
      sourceSnapshotId: 'snap:gate2',
      trace: {
        ...bullishTrace({ gate1Passed: false }),
        gate1Trace: {
          gate1Passed: false,
          hardFailCount: 1,
          wouldPassIfProviderIssueSoftened: true,
        },
      },
    });

    expect(result.gate1Status).toBe('DEGRADED_PASS');
    expect(result.gate2Status).not.toBe('SKIPPED_BY_GATE1');
    expect(result.shadowLearning).toBe(true);
  });

  it('keeps programTrade ACCEPTED_EMPTY excluded from score and sectorEnergy advisory as non-blocking', () => {
    const result = buildGate2EvaluationResult({
      sourceSnapshotId: 'snap:gate2',
      trace: bullishTrace({
        gate2ExternalDataCoverage: {
          kisInvestorFlow: { status: 'VERIFIED', foreignNetBuy: 100, institutionalNetBuy: 0 },
          programTrade: { stockProgram: { status: 'ACCEPTED_EMPTY' } },
          sectorCycle: { status: 'PARTIAL', values: { sectorRelativeReturn20d: 10, stockVsSectorReturn20d: 5 } },
          leaderCycle: { isCurrentLeadingSector: true, isSectorLeader: true, attentionPhase: 'NORMAL' },
        },
      }),
    });

    expect(result.axes.some(axis => axis.axis === 'SECTOR_LEADERSHIP' && axis.promotionStage === 'ADVISORY')).toBe(true);
    expect(result.primaryBlocker).not.toBe('programTrade');
    expect(result.executionImpact).toBe('NONE');
  });

  it('builds aggregate counters and counterfactual seed payloads from candidate details', () => {
    const summary = buildGate2ConfluenceSummary({
      sourceSnapshotId: 'snap:gate2',
      traces: [
        bullishTrace({ symbol: '005930' }),
        {
          ...bullishTrace({ symbol: '000660' }),
          gate1Passed: false,
          gate1Trace: { hardFailCount: 1, gate1Passed: false },
        },
      ],
    });

    expect(summary.totalCandidates).toBe(2);
    expect(summary.evaluated).toBe(1);
    expect(summary.gate2SkippedByGate1HardFail).toBe(1);
    expect(summary.counterfactualSeeds).toHaveLength(2);
    expect(summary.counterfactualSeeds[0]).toMatchObject({
      sourceSnapshotId: 'snap:gate2',
      executionImpact: 'NONE',
      marketSignal: false,
      shadowLearning: true,
      counterfactualRecorded: true,
    });
    expect(summary.executionImpact).toBe('NONE');
  });
});
