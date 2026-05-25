// @responsibility ADR-0520 Gate1 scoring-alignment DRY_RUN gating regression tests
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import {
  ADR_0520_DRY_RUN_SCENARIO,
  GATE1_SCORING_ALIGNMENT_DRYRUN_ENV_FLAG,
  buildGate1ScoringAlignmentDryRunGate,
  isGate1ScoringAlignmentDryRunEnabled,
  resolveAdr0520AlignmentDelta,
} from './gate1ScoringAlignmentDryRunGateAdr0520.js';
import { buildGate1DryRunObservationRows } from './gate1DryRunObservationLedgerAdr0476.js';
import type { Gate1ScoreStarvationTrace } from './gate1PositiveScoreStarvation.js';
import type { Gate1ScoringAlignmentReport } from './gate1ScoringAlignmentAdr0472.js';

const FLAG = GATE1_SCORING_ALIGNMENT_DRYRUN_ENV_FLAG;

afterEach(() => {
  delete process.env[FLAG];
});

function trace(symbol: string, actualScore: number, name?: string): Gate1ScoreStarvationTrace {
  return {
    symbol,
    ...(name ? { name } : {}),
    requiredScore: 70,
    actualScore,
    scoreGap: actualScore - 70,
    grossPositiveScore: actualScore + 20,
    totalPenaltyScore: 20,
    netScoreAfterPenalty: actualScore,
    positiveMaxPossibleScore: 100,
    positiveUtilizationPct: 50,
    scoreCeilingEstimate: 80,
    positiveComponents: [
      {
        code: 'BREAKOUT_STRUCTURE',
        available: true,
        normalizedScore: 60,
        weight: 1,
        weightedScore: 6,
        maxScore: 10,
        contributionPct: 10,
        confidence: 'VERIFIED',
        message: 'breakout',
      },
      {
        code: 'PRICE_MOMENTUM',
        available: true,
        normalizedScore: 50,
        weight: 1,
        weightedScore: 10,
        maxScore: 20,
        contributionPct: 10,
        confidence: 'VERIFIED',
        message: 'momentum',
      },
    ],
    penaltyComponents: [],
    zeroContributionComponents: [],
    missingPositiveComponents: [],
    verifiedZeroComponents: [],
    stalePositiveComponents: [],
    scoreStarved: true,
    starvationReason: [],
    wouldPassIfWatchlistScoreImported: false,
    wouldPassIfPositiveFeaturesRestored: false,
    wouldPassIfPenaltyNotAppliedBeforePositive: false,
    wouldPassIfScoreCeilingFixed: false,
  };
}

// ADR-0472 report stub: CURRENT net 42.6, relaxed best (ALIGN_PLUS_DEDUP_PLUS_RISK_SPLIT) net 72.6
// -> alignment delta = +30. requiredScore 70.
function alignmentReport(): Gate1ScoringAlignmentReport {
  const scenarioResult = (scenario: string, netScoreAvg: number, penaltyAvg: number) => ({
    scenario: scenario as never,
    netScoreAvg,
    positiveScoreAvg: netScoreAvg + penaltyAvg,
    penaltyAvg,
    scoreMin: netScoreAvg - 5,
    scoreMax: netScoreAvg + 5,
    scoreRange: 10,
    compressed: false,
    requiredScore: 70,
    hypotheticalSurvivors: 0,
    survivorExamples: [],
    executionImpact: 'NONE' as const,
    liveExecutionAllowed: false as const,
    policyPromotionMode: 'SHADOW_ONLY' as const,
  });
  return {
    timestamp: '2026-05-25T00:00:00.000Z',
    forDate: '2026-05-25',
    regime: 'R3_EARLY',
    marketSession: 'BUY_ALLOWED',
    totalCandidates: 43,
    componentSetAligned: false,
    minimumSignalComponents: [],
    positiveAuditComponents: [],
    missingComponents: ['WATCHLIST_UPSTREAM_SCORE', 'BREAKOUT_STRUCTURE'],
    componentMeanings: [],
    requiredScore: 70,
    scenarioResults: [
      scenarioResult('CURRENT', 42.6, 31.3),
      scenarioResult('ALIGN_ALL_POSITIVE_COMPONENTS', 61.6, 31.3),
      scenarioResult('ALIGN_PLUS_PENALTY_DEDUP', 66.6, 26.3),
      scenarioResult('ALIGN_PLUS_RISK_SPLIT', 64.6, 28.3),
      scenarioResult('ALIGN_PLUS_DEDUP_PLUS_RISK_SPLIT', 72.6, 21.3),
    ],
    matrixRows: [],
    providerGuard: {
      providerHealthStatus: 'UNKNOWN',
      unknownPolicyActive: true,
      autoDisableWhenProviderVerified: true,
      providerVerifiedOverrideWarning: false,
    },
    bestDryRun: 'ALIGN_PLUS_DEDUP_PLUS_RISK_SPLIT',
    nextAction: 'OBSERVE_3D_THEN_OPERATOR_APPROVAL',
    observationDays: 3,
    operatorApprovalRequired: true,
    executionImpact: 'NONE',
    liveExecutionAllowed: false,
    policyPromotionMode: 'SHADOW_ONLY',
  };
}

// 43 real candidates: a few cross from fail -> pass under +30 delta.
function fortyThreeTraces(): Gate1ScoreStarvationTrace[] {
  return Array.from({ length: 43 }, (_, index) =>
    trace(`${index}`.padStart(6, '0'), 30 + index, `cand-${index}`));
}

describe('ADR-0520 Gate1 scoring-alignment DRY_RUN gating', () => {
  it('defaults to disabled when the ENV flag is unset', () => {
    delete process.env[FLAG];
    expect(isGate1ScoringAlignmentDryRunEnabled()).toBe(false);
    const result = buildGate1ScoringAlignmentDryRunGate({
      traces: fortyThreeTraces(),
      alignmentReport: alignmentReport(),
    });
    expect(result.enabled).toBe(false);
    expect(result.survivors).toHaveLength(0);
    expect(result.evaluated).toHaveLength(0);
  });

  it('resolves the ADR-0472 alignment delta from the relaxed best scenario', () => {
    expect(resolveAdr0520AlignmentDelta(alignmentReport())).toBe(30);
    expect(resolveAdr0520AlignmentDelta(null)).toBe(0);
  });

  it('identifies REAL survivor symbols that fail live but pass the relaxed curve', () => {
    process.env[FLAG] = 'true';
    const result = buildGate1ScoringAlignmentDryRunGate({
      traces: fortyThreeTraces(),
      alignmentReport: alignmentReport(),
    });
    expect(result.enabled).toBe(true);
    expect(result.scenario).toBe(ADR_0520_DRY_RUN_SCENARIO);
    expect(result.alignmentDelta).toBe(30);
    expect(result.totalCandidates).toBe(43);
    // delta=30, required=70 -> actualScore in [40, 69] crosses (40+30=70 passes, <40 still fails).
    // actualScore = 30+index. survivors: index 10..39 (actual 40..69) -> 30 survivors,
    // index 40..42 already pass live (actual 70..72).
    expect(result.survivors.length).toBe(30);
    for (const survivor of result.survivors) {
      expect(survivor.decision).toBe('WOULD_PASS_DRY_RUN');
      // Real, non-placeholder symbol.
      expect(survivor.symbol).not.toMatch(/^ADR0472-/);
      expect(survivor.actualScore).toBeLessThan(survivor.requiredScore); // fails live
      expect(survivor.dryRunScore).toBeGreaterThanOrEqual(survivor.requiredScore); // passes relaxed
    }
  });

  it('does not flag candidates that already pass the live curve as survivors', () => {
    process.env[FLAG] = 'true';
    const result = buildGate1ScoringAlignmentDryRunGate({
      traces: [trace('900000', 75, 'already-passing')],
      alignmentReport: alignmentReport(),
    });
    expect(result.survivors).toHaveLength(0);
    expect(result.evaluated[0]?.decision).toBe('ALREADY_PASSED_LIVE');
    // The live actualScore is preserved exactly — never mutated.
    expect(result.evaluated[0]?.actualScore).toBe(75);
  });

  it('always reports executionImpact NONE / liveExecutionAllowed false / SHADOW_ONLY', () => {
    process.env[FLAG] = 'true';
    const result = buildGate1ScoringAlignmentDryRunGate({
      traces: fortyThreeTraces(),
      alignmentReport: alignmentReport(),
    });
    expect(result.executionImpact).toBe('NONE');
    expect(result.liveExecutionAllowed).toBe(false);
    expect(result.policyPromotionMode).toBe('SHADOW_ONLY');
  });

  it('emits no ADR-0472 ledger rows when the gate is disabled (flag off, behaviour unchanged)', () => {
    delete process.env[FLAG];
    const gate = buildGate1ScoringAlignmentDryRunGate({
      traces: fortyThreeTraces(),
      alignmentReport: alignmentReport(),
    });
    const rows = buildGate1DryRunObservationRows({
      forDate: '2026-05-25',
      scoringAlignmentDryRunAdr0520: gate,
    });
    expect(rows.filter((row) => row.source === 'ADR_0472_SCORING_ALIGNMENT')).toHaveLength(0);
  });

  it('records ADR_0472_SCORING_ALIGNMENT ledger rows for real survivors when enabled', () => {
    process.env[FLAG] = 'true';
    const gate = buildGate1ScoringAlignmentDryRunGate({
      traces: fortyThreeTraces(),
      alignmentReport: alignmentReport(),
    });
    const rows = buildGate1DryRunObservationRows({
      forDate: '2026-05-25',
      scoringAlignmentDryRunAdr0520: gate,
      topN: 10,
    });
    const alignmentRows = rows.filter((row) => row.source === 'ADR_0472_SCORING_ALIGNMENT');
    expect(alignmentRows.length).toBeGreaterThan(0);
    for (const row of alignmentRows) {
      expect(row.dryRunDecision).toBe('WOULD_PASS_DRY_RUN');
      expect(row.dryRunScenario).toBe(ADR_0520_DRY_RUN_SCENARIO);
      expect(row.actualGate1Passed).toBe(false);
      expect(row.actualLiveEligible).toBe(false);
      expect(row.liveExecutionAllowed).toBe(false);
      expect(row.executionImpact).toBe('NONE');
      expect(row.policyPromotionMode).toBe('SHADOW_ONLY');
      // Forward-return tracking fields exist on the row schema (undefined until matured).
      expect(row).toHaveProperty('requiredScore');
      expect(row.symbol).not.toMatch(/^ADR0472-/);
    }
  });

  it('does not import KIS order functions or fetch in the ADR-0520 module', () => {
    const source = readFileSync(new URL('./gate1ScoringAlignmentDryRunGateAdr0520.ts', import.meta.url), 'utf8');
    for (const banned of [
      'placeKisMarketBuyOrder',
      'placeKisSellOrder',
      'placeKisStopLossOrder',
      'placeKisTakeProfitOrder',
      'cancelKisOrder',
      'fetch(',
      'axios',
      'setGateThreshold',
      'liveExecutionAllowed: true',
    ]) {
      expect(source).not.toContain(banned);
    }
  });

  it('ADR-0520 document and INDEX entry are present', () => {
    const root = process.cwd();
    const doc = join(root, 'docs/adr/0520-gate1-scoring-alignment-dry-run-gating.md');
    expect(existsSync(doc)).toBe(true);
    expect(readFileSync(doc, 'utf8')).toContain('DRY_RUN');
    expect(readFileSync(join(root, 'docs/adr/INDEX.md'), 'utf8')).toContain('| 0520 |');
  });
});
