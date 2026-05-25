// @responsibility ADR-0520 Gate1 scoring-alignment DRY_RUN gating; identifies real relaxed-curve survivor symbols for observation only. No live mutation.
import type { Gate1ScoreStarvationTrace } from './gate1PositiveScoreStarvation.js';
import type {
  Gate1ScoringAlignmentReport,
  Gate1ScoringAlignmentScenario,
} from './gate1ScoringAlignmentAdr0472.js';

/**
 * ADR-0520 — Gate1 Scoring Alignment DRY_RUN Gating.
 *
 * The live Gate1 minimum-signal scoring curve is FROZEN (ADR-0471 freezeRule).
 * Operator approved a DRY_RUN observation gate: take the relaxed alignment curve
 * (ADR-0472 best scenario: recognize already-computed BREAKOUT_STRUCTURE +
 * PRICE_MOMENTUM positive components, apply ADR-0469 penalty dedup and ADR-0470
 * risk-at-sizing-only), apply it to the REAL candidate traces, and identify which
 * real symbols currently FAIL the live curve but WOULD PASS under the relaxed curve.
 *
 * This module never recomputes or mutates the live actualScore. It reads the live
 * per-candidate `Gate1ScoreStarvationTrace.actualScore` as an immutable reference
 * and copies the ADR-0472 relaxation delta on top. Survivor rows are recorded in
 * the ADR-0476 observation ledger for 1D/3D/5D forward-return tracking only.
 */

export const GATE1_SCORING_ALIGNMENT_DRYRUN_ENV_FLAG = 'GATE1_SCORING_ALIGNMENT_DRYRUN_ENABLED';

/** ADR-0472 best scenario applied per-candidate as the relaxed alignment curve. */
export const ADR_0520_DRY_RUN_SCENARIO: Gate1ScoringAlignmentScenario = 'ALIGN_PLUS_DEDUP_PLUS_RISK_SPLIT';

export type Gate1ScoringAlignmentDryRunDecision =
  | 'WOULD_PASS_DRY_RUN'
  | 'NEAR_MISS'
  | 'WOULD_STILL_FAIL'
  | 'ALREADY_PASSED_LIVE';

export interface Gate1ScoringAlignmentDryRunCandidate {
  symbol: string;
  name?: string;
  /** Live frozen Gate1 net score — read-only reference, never mutated. */
  actualScore: number;
  requiredScore: number;
  /** Per-candidate relaxed alignment score = actualScore + alignment delta. */
  dryRunScore: number;
  scoreGap: number;
  decision: Gate1ScoringAlignmentDryRunDecision;
  /** Already-computed (live) positive contributions recognized by the relaxed curve. */
  breakoutStructureScore: number;
  priceMomentumScore: number;
  /** Penalty reductions copied from the relaxed curve (diagnostic only). */
  dedupPenaltyDelta: number;
  riskSplitPenaltyDelta: number;
}

export interface Gate1ScoringAlignmentDryRunGateResult {
  enabled: boolean;
  scenario: Gate1ScoringAlignmentScenario;
  requiredScore: number;
  alignmentDelta: number;
  totalCandidates: number;
  /** Candidates that fail the live curve but pass the relaxed curve. */
  survivors: Gate1ScoringAlignmentDryRunCandidate[];
  /** All evaluated candidates (survivors + near-miss + still-fail), real symbols only. */
  evaluated: Gate1ScoringAlignmentDryRunCandidate[];
  executionImpact: 'NONE';
  liveExecutionAllowed: false;
  policyPromotionMode: 'SHADOW_ONLY';
}

function round1(value: number): number {
  return Math.round(value * 10) / 10;
}

function finite(value: unknown, fallback = 0): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : fallback;
}

/**
 * Resolve whether the DRY_RUN scoring-alignment gate is enabled.
 * Default is `false` — the operator must explicitly opt in. When `false`, the
 * caller must keep 100% identical behaviour (no rows emitted, no live impact).
 */
export function isGate1ScoringAlignmentDryRunEnabled(
  env: NodeJS.ProcessEnv = process.env,
): boolean {
  return env[GATE1_SCORING_ALIGNMENT_DRYRUN_ENV_FLAG] === 'true';
}

/**
 * Compute the relaxed alignment delta from the ADR-0472 report.
 *
 * The delta is the SHADOW-ONLY scenario difference between the relaxed best
 * scenario net average and the CURRENT (live) net average. The live curve itself
 * is never read or modified here — only the ADR-0472 dry-run aggregate is used.
 */
export function resolveAdr0520AlignmentDelta(
  report?: Gate1ScoringAlignmentReport | null,
  scenario: Gate1ScoringAlignmentScenario = ADR_0520_DRY_RUN_SCENARIO,
): number {
  if (!report) return 0;
  const current = report.scenarioResults.find((item) => item.scenario === 'CURRENT');
  const relaxed = report.scenarioResults.find((item) => item.scenario === scenario)
    ?? report.scenarioResults.find((item) => item.scenario === report.bestDryRun);
  if (!current || !relaxed) return 0;
  return Math.max(0, round1(relaxed.netScoreAvg - current.netScoreAvg));
}

function positiveComponentScore(
  trace: Gate1ScoreStarvationTrace,
  code: 'BREAKOUT_STRUCTURE' | 'PRICE_MOMENTUM',
): number {
  const found = trace.positiveComponents.find((component) => component.code === code);
  return found ? Math.max(0, finite(found.weightedScore)) : 0;
}

/**
 * Build the per-candidate DRY_RUN scoring-alignment gate result from the REAL
 * candidate traces. Returns disabled result with no survivors when the ENV flag
 * is off (preserving 100% of the prior behaviour for the caller).
 */
export function buildGate1ScoringAlignmentDryRunGate(input: {
  traces?: readonly Gate1ScoreStarvationTrace[];
  alignmentReport?: Gate1ScoringAlignmentReport | null;
  scenario?: Gate1ScoringAlignmentScenario;
  /** Override requiredScore for tests; defaults to per-candidate trace requiredScore (live, frozen). */
  requiredScoreOverride?: number;
  env?: NodeJS.ProcessEnv;
}): Gate1ScoringAlignmentDryRunGateResult {
  const scenario = input.scenario ?? ADR_0520_DRY_RUN_SCENARIO;
  const enabled = isGate1ScoringAlignmentDryRunEnabled(input.env ?? process.env);
  const requiredScoreFromReport = finite(input.alignmentReport?.requiredScore, 70);
  const alignmentDelta = resolveAdr0520AlignmentDelta(input.alignmentReport, scenario);
  const dedupDelta = (() => {
    const align = input.alignmentReport?.scenarioResults.find((item) => item.scenario === 'ALIGN_ALL_POSITIVE_COMPONENTS');
    const alignDedup = input.alignmentReport?.scenarioResults.find((item) => item.scenario === 'ALIGN_PLUS_PENALTY_DEDUP');
    if (!align || !alignDedup) return 0;
    return Math.max(0, round1(align.penaltyAvg - alignDedup.penaltyAvg));
  })();
  const riskSplitDelta = (() => {
    const align = input.alignmentReport?.scenarioResults.find((item) => item.scenario === 'ALIGN_ALL_POSITIVE_COMPONENTS');
    const alignRisk = input.alignmentReport?.scenarioResults.find((item) => item.scenario === 'ALIGN_PLUS_RISK_SPLIT');
    if (!align || !alignRisk) return 0;
    return Math.max(0, round1(align.penaltyAvg - alignRisk.penaltyAvg));
  })();

  const base: Omit<Gate1ScoringAlignmentDryRunGateResult, 'survivors' | 'evaluated'> = {
    enabled,
    scenario,
    requiredScore: round1(requiredScoreFromReport),
    alignmentDelta,
    totalCandidates: input.traces?.length ?? 0,
    executionImpact: 'NONE',
    liveExecutionAllowed: false,
    policyPromotionMode: 'SHADOW_ONLY',
  };

  if (!enabled || !input.traces || input.traces.length === 0) {
    return { ...base, survivors: [], evaluated: [] };
  }

  const evaluated: Gate1ScoringAlignmentDryRunCandidate[] = input.traces
    .filter((trace) => typeof trace.symbol === 'string' && trace.symbol.length > 0)
    .map((trace) => {
      // requiredScore is the LIVE frozen threshold per candidate; never lowered.
      const requiredScore = input.requiredScoreOverride ?? finite(trace.requiredScore, requiredScoreFromReport);
      // actualScore is the LIVE frozen net score; read-only reference.
      const actualScore = round1(finite(trace.actualScore));
      // Relaxed curve = live actualScore + ADR-0472 alignment delta (copy, not mutate).
      const dryRunScore = round1(actualScore + alignmentDelta);
      const scoreGap = round1(dryRunScore - requiredScore);
      const passesLive = actualScore >= requiredScore;
      const decision: Gate1ScoringAlignmentDryRunDecision = passesLive
        ? 'ALREADY_PASSED_LIVE'
        : scoreGap >= 0
          ? 'WOULD_PASS_DRY_RUN'
          : scoreGap >= -5
            ? 'NEAR_MISS'
            : 'WOULD_STILL_FAIL';
      return {
        symbol: trace.symbol,
        ...(trace.name ? { name: trace.name } : {}),
        actualScore,
        requiredScore: round1(requiredScore),
        dryRunScore,
        scoreGap,
        decision,
        breakoutStructureScore: round1(positiveComponentScore(trace, 'BREAKOUT_STRUCTURE')),
        priceMomentumScore: round1(positiveComponentScore(trace, 'PRICE_MOMENTUM')),
        dedupPenaltyDelta: dedupDelta,
        riskSplitPenaltyDelta: riskSplitDelta,
      };
    });

  // Survivors: real symbols that fail the live curve but pass the relaxed curve.
  const survivors = evaluated.filter((candidate) => candidate.decision === 'WOULD_PASS_DRY_RUN');

  return { ...base, survivors, evaluated };
}
