// @responsibility ADR-0520 Gate1 scoring-alignment DRY_RUN observation regression tests
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  ADR_0520_DRY_RUN_SCENARIO,
  buildGate1ScoringAlignmentDryRunGate,
} from './gate1ScoringAlignmentDryRunGateAdr0520.js';
import { buildGate1DryRunObservationRows } from './gate1DryRunObservationLedgerAdr0476.js';
import type { Gate1ScoreStarvationTrace } from './gate1PositiveScoreStarvation.js';
import type { Gate1ScoringAlignmentReport } from './gate1ScoringAlignmentAdr0472.js';

// alignDelta per-candidate = sum of recognized positive weightedScores
// (BREAKOUT_STRUCTURE 6 + PRICE_MOMENTUM 10 = 16). No penalty components -> dedup/risk = 0.
const TRACE_ALIGN_DELTA = 16;

function trace(
  symbol: string,
  actualScore: number,
  name?: string,
  penaltyComponents: Gate1ScoreStarvationTrace['penaltyComponents'] = [],
): Gate1ScoreStarvationTrace {
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
    penaltyComponents,
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

// ADR-0472 report stub: CURRENT net 42.6, relaxed best (ALIGN_PLUS_DEDUP_PLUS_RISK_SPLIT) net 72.6.
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

// 43 real candidates: a few cross from fail -> pass under the per-candidate align delta.
function fortyThreeTraces(): Gate1ScoreStarvationTrace[] {
  return Array.from({ length: 43 }, (_, index) =>
    trace(`${index}`.padStart(6, '0'), 30 + index, `cand-${index}`));
}

describe('ADR-0520 Gate1 scoring-alignment DRY_RUN observation', () => {
  it('always evaluates (observation-only, no ENV toggle); empty only when no traces', () => {
    const empty = buildGate1ScoringAlignmentDryRunGate({ traces: [], alignmentReport: alignmentReport() });
    expect(empty.survivors).toHaveLength(0);
    expect(empty.evaluated).toHaveLength(0);

    const result = buildGate1ScoringAlignmentDryRunGate({
      traces: fortyThreeTraces(),
      alignmentReport: alignmentReport(),
    });
    expect(result.totalCandidates).toBe(43);
    expect(result.evaluated.length).toBe(43);
  });

  it('derives the relaxed score per-candidate from the candidate own trace (single source, no uniform delta)', () => {
    const result = buildGate1ScoringAlignmentDryRunGate({
      traces: [trace('100000', 60, 'single-source')],
      alignmentReport: alignmentReport(),
    });
    const candidate = result.evaluated[0];
    expect(candidate).toBeDefined();
    // align delta comes ONLY from this candidate's own recognized positive components.
    expect(candidate?.alignPositiveDelta).toBe(TRACE_ALIGN_DELTA);
    expect(candidate?.dedupPenaltyDelta).toBe(0);
    expect(candidate?.riskSplitPenaltyDelta).toBe(0);
    // relaxedScore = actualScore (60, frozen) + alignDelta (16) = 76.
    expect(candidate?.dryRunScore).toBe(60 + TRACE_ALIGN_DELTA);
    expect(candidate?.actualScore).toBe(60);
  });

  it('adds per-candidate ADR-0469 dedup delta; ADR-0470 REGIME_RISK is sizing-only so risk-split delta is 0', () => {
    // Two duplicate provider penalties (10 + 8) dedup to keep-largest (10), removing 8.
    // RISK_PENALTY 의 risk-split delta 는 0: production 의 resolveRiskSplitDeltaForCandidate 가
    // buildCandidateRiskDoubleCountTrace 를 rootCause='REGIME_RISK' 로 호출하는데, REGIME_RISK 는
    // gate1RiskDoubleCount.ts L408/419 에서 effectiveSignalRiskPenalty=0 (signal-score 가 아니라
    // confidence+Kelly sizing 전용) 로 정의된다. 따라서 scoreIfRiskAtSizingOnly==actualScore →
    // delta 0. 이는 regime risk 를 signal score 에 double-count 하지 않으려는 ADR-0470 설계와 정합
    // (과거 3점 가산 기대는 double-count 방지 적용 전 stale 가정).
    const penalties: Gate1ScoreStarvationTrace['penaltyComponents'] = [
      {
        code: 'SUPPLY_CONFLUENCE', normalizedScore: 0, weight: 10, weightedScore: -10, maxScore: 0,
        contributionPct: 0, confidence: 'UNKNOWN', providerIssue: true, marketSignal: false,
        penaltyApplied: true, message: 'supply unknown',
      },
      {
        code: 'INVESTOR_FLOW', normalizedScore: 0, weight: 8, weightedScore: -8, maxScore: 0,
        contributionPct: 0, confidence: 'UNKNOWN', providerIssue: true, marketSignal: false,
        penaltyApplied: true, message: 'investor unknown',
      },
      {
        code: 'RISK_PENALTY', normalizedScore: 0, weight: 5, weightedScore: -5, maxScore: 0,
        contributionPct: 0, confidence: 'VERIFIED', providerIssue: false, marketSignal: true,
        penaltyApplied: true, message: 'risk',
      },
    ];
    const result = buildGate1ScoringAlignmentDryRunGate({
      traces: [trace('110000', 50, 'penalty-source', penalties)],
      alignmentReport: alignmentReport(),
    });
    const candidate = result.evaluated[0];
    expect(candidate?.dedupPenaltyDelta).toBe(8); // 18 total -> keep largest 10 -> removed 8
    expect(candidate?.riskSplitPenaltyDelta).toBe(0); // REGIME_RISK 는 sizing-only → signal-score delta 0
    // relaxedScore = 50 + align(16) + dedup(8) + riskSplit(0) = 74.
    expect(candidate?.dryRunScore).toBe(50 + TRACE_ALIGN_DELTA + 8 + 0);
  });

  it('identifies REAL survivor symbols that fail live but pass the relaxed curve', () => {
    const result = buildGate1ScoringAlignmentDryRunGate({
      traces: fortyThreeTraces(),
      alignmentReport: alignmentReport(),
    });
    expect(result.scenario).toBe(ADR_0520_DRY_RUN_SCENARIO);
    expect(result.totalCandidates).toBe(43);
    // Per-candidate align delta = 16, required = 70 -> actualScore in [54, 69] crosses.
    // actualScore = 30+index. survivors: index 24..39 (actual 54..69) -> 16 survivors,
    // index 40..42 already pass live (actual 70..72).
    expect(result.survivors.length).toBe(16);
    for (const survivor of result.survivors) {
      expect(survivor.decision).toBe('WOULD_PASS_DRY_RUN');
      // Real, non-placeholder symbol.
      expect(survivor.symbol).not.toMatch(/^ADR0472-/);
      expect(survivor.actualScore).toBeLessThan(survivor.requiredScore); // fails live
      expect(survivor.dryRunScore).toBeGreaterThanOrEqual(survivor.requiredScore); // passes relaxed
      // dryRunScore derives strictly from the candidate own actualScore + per-candidate deltas.
      expect(survivor.dryRunScore).toBe(
        survivor.actualScore + survivor.alignPositiveDelta + survivor.dedupPenaltyDelta + survivor.riskSplitPenaltyDelta,
      );
    }
  });

  it('does not flag candidates that already pass the live curve as survivors', () => {
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
    const result = buildGate1ScoringAlignmentDryRunGate({
      traces: fortyThreeTraces(),
      alignmentReport: alignmentReport(),
    });
    expect(result.executionImpact).toBe('NONE');
    expect(result.liveExecutionAllowed).toBe(false);
    expect(result.policyPromotionMode).toBe('SHADOW_ONLY');
  });

  it('emits no ADR-0472 ledger rows when there is no gate result', () => {
    const rows = buildGate1DryRunObservationRows({
      forDate: '2026-05-25',
      scoringAlignmentDryRunAdr0520: null,
    });
    expect(rows.filter((row) => row.source === 'ADR_0472_SCORING_ALIGNMENT')).toHaveLength(0);
  });

  it('records ADR_0472_SCORING_ALIGNMENT ledger rows for real survivors (always-on observation)', () => {
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
