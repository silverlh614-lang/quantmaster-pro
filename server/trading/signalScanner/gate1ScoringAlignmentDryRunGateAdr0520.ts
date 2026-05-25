// @responsibility ADR-0520 Gate1 scoring-alignment DRY_RUN gating; per-candidate single-source relaxed-curve survivor identification. No live mutation.
import type { Gate1ScoreStarvationTrace } from './gate1PositiveScoreStarvation.js';
import {
  ADR_0472_ALIGN_RECOGNIZED_POSITIVE_COMPONENTS,
  resolveAdr0472AlignDeltaForCandidate,
  type Gate1ScoringAlignmentReport,
  type Gate1ScoringAlignmentScenario,
} from './gate1ScoringAlignmentAdr0472.js';
import { buildCandidatePenaltyDedupTrace, penaltyComponentTrace } from './gate1PenaltyDeduplication.js';
import { buildCandidateRiskDoubleCountTrace } from './gate1RiskDoubleCount.js';

/**
 * ADR-0520 — Gate1 Scoring Alignment DRY_RUN Gating (single-source per-candidate).
 *
 * The live Gate1 minimum-signal scoring curve is FROZEN (ADR-0471 freezeRule).
 * Operator approved a DRY_RUN observation gate: take the relaxed alignment curve
 * (ADR-0472 best scenario: recognize already-computed BREAKOUT_STRUCTURE +
 * PRICE_MOMENTUM positive components, apply ADR-0469 penalty dedup and ADR-0470
 * risk-at-sizing-only), apply it PER-CANDIDATE to the REAL candidate traces, and
 * identify which real symbols currently FAIL the live curve but WOULD PASS relaxed.
 *
 * Single-source rule (operator requirement): the relaxed score is derived ONLY from
 * each candidate's own `Gate1ScoreStarvationTrace` — the same frozen artifact the
 * live curve produced — by REUSING the existing ADR-0472 (align positive), ADR-0469
 * (penalty dedup) and ADR-0470 (risk-at-sizing) transform functions per-candidate.
 * There is no second scoring formula and no scan-wide uniform delta approximation.
 *
 *   relaxedScore = trace.actualScore (frozen, read-only)
 *                + ADR-0472 align delta (candidate's own recognized positives)
 *                + ADR-0469 dedup delta (candidate's own duplicate-penalty removal)
 *                + ADR-0470 risk-split delta (candidate's own signal risk penalty)
 *
 * This module never recomputes or mutates the live actualScore. Survivor rows are
 * recorded in the ADR-0476 observation ledger for 1D/3D/5D forward-return tracking only.
 */

export const GATE1_SCORING_ALIGNMENT_DRYRUN_ENV_FLAG = 'GATE1_SCORING_ALIGNMENT_DRYRUN_ENABLED';

/** ADR-0472 best scenario applied per-candidate as the relaxed alignment curve. */
export const ADR_0520_DRY_RUN_SCENARIO: Gate1ScoringAlignmentScenario = 'ALIGN_PLUS_DEDUP_PLUS_RISK_SPLIT';

/** ADR-0470 caps the diagnostic signal-score risk penalty at 3 points; reuse the same cap. */
const ADR_0470_SIGNAL_RISK_PENALTY_CAP = 3;

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
  /** Per-candidate relaxed alignment score = actualScore + align + dedup + risk-split deltas. */
  dryRunScore: number;
  scoreGap: number;
  decision: Gate1ScoringAlignmentDryRunDecision;
  /** Per-candidate ADR-0472 positive align delta (sum of recognized positive contributions). */
  alignPositiveDelta: number;
  /** Already-computed (live) positive contributions recognized by the relaxed curve. */
  breakoutStructureScore: number;
  priceMomentumScore: number;
  /** Per-candidate penalty reductions derived from this candidate's own trace. */
  dedupPenaltyDelta: number;
  riskSplitPenaltyDelta: number;
}

export interface Gate1ScoringAlignmentDryRunGateResult {
  enabled: boolean;
  scenario: Gate1ScoringAlignmentScenario;
  requiredScore: number;
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

function positiveComponentScore(
  trace: Gate1ScoreStarvationTrace,
  code: 'BREAKOUT_STRUCTURE' | 'PRICE_MOMENTUM',
): number {
  const found = trace.positiveComponents.find((component) => component.code === code);
  return found ? Math.max(0, finite(found.weightedScore)) : 0;
}

/**
 * Per-candidate ADR-0469 dedup delta: the duplicate provider-unknown penalty removed
 * for THIS candidate, computed by reusing `buildCandidatePenaltyDedupTrace`. The trace's
 * own penalty components (or the ADR-0469 default aggregate when none are recorded) are
 * the single source — no scan-wide average.
 */
function resolveDedupDeltaForCandidate(trace: Gate1ScoreStarvationTrace): number {
  const penalties = trace.penaltyComponents.length > 0
    ? trace.penaltyComponents.map((component) => penaltyComponentTrace({
        code: component.code === 'SUPPLY_CONFLUENCE'
          ? 'SUPPLY_CONFLUENCE'
          : component.code === 'INVESTOR_FLOW'
            ? 'INVESTOR_FLOW'
            : component.code === 'RISK_PENALTY' || component.code === 'MACRO_RISK'
              ? 'RISK_PENALTY'
              : component.code === 'SOFT_FAIL_PENALTY'
                ? 'SOFT_FAIL_PENALTY'
                : component.code === 'SECTOR_ENERGY'
                  ? 'SECTOR_ENERGY'
                  : component.code === 'DATA_QUALITY' || component.code === 'UNKNOWN_DATA_PENALTY'
                    ? 'DATA_QUALITY_PENALTY'
                    : component.code === 'SESSION_STATUS'
                      ? 'SESSION_PENALTY'
                      : 'OTHER_PENALTY',
        value: Math.abs(finite(component.weightedScore)),
        providerIssue: component.providerIssue,
        marketSignal: component.marketSignal,
        confidence: component.confidence,
        message: component.message,
      }))
    : undefined;
  if (!penalties) return 0;
  const dedup = buildCandidatePenaltyDedupTrace({
    symbol: trace.symbol,
    name: trace.name,
    grossPositiveScore: finite(trace.grossPositiveScore),
    originalPenaltyTotal: finite(trace.totalPenaltyScore),
    originalNetScore: finite(trace.actualScore),
    requiredScore: finite(trace.requiredScore),
    penalties,
  });
  return round1(Math.max(0, dedup.scoreDeltaAfterDedup));
}

/**
 * Per-candidate ADR-0470 risk-split delta: the signal-score risk penalty that the
 * relaxed curve moves to sizing only, computed by reusing
 * `buildCandidateRiskDoubleCountTrace`. The signal risk penalty is read from THIS
 * candidate's own RISK_PENALTY trace component (capped at 3 to match ADR-0470's
 * `signalRiskPenaltyFrom`). The delta = scoreIfRiskAtSizingOnly - actualScore.
 */
function resolveRiskSplitDeltaForCandidate(trace: Gate1ScoreStarvationTrace): number {
  const riskPenalty = trace.penaltyComponents
    .filter((component) => component.code === 'RISK_PENALTY' || component.code === 'MACRO_RISK')
    .reduce((sum, component) => sum + Math.abs(Math.min(0, finite(component.weightedScore))), 0);
  const signalRiskPenalty = Math.min(ADR_0470_SIGNAL_RISK_PENALTY_CAP, Math.max(0, riskPenalty));
  if (signalRiskPenalty <= 0) return 0;
  const actualScore = finite(trace.actualScore);
  const riskTrace = buildCandidateRiskDoubleCountTrace({
    symbol: trace.symbol,
    name: trace.name,
    originalSignalScore: actualScore,
    originalSignalRiskPenalty: signalRiskPenalty,
    originalKellyMultiplier: 1,
    requiredScore: finite(trace.requiredScore),
    rootCause: 'REGIME_RISK',
  });
  return round1(Math.max(0, riskTrace.scoreIfRiskAtSizingOnly - actualScore));
}

/**
 * Compute the per-candidate relaxed score for a single real candidate trace by reusing
 * the ADR-0472/0469/0470 transforms against THIS candidate's own frozen artifact.
 */
function evaluateCandidate(
  trace: Gate1ScoreStarvationTrace,
  requiredScoreOverride?: number,
): Gate1ScoringAlignmentDryRunCandidate {
  // requiredScore is the LIVE frozen threshold per candidate; never lowered.
  const requiredScore = round1(requiredScoreOverride ?? finite(trace.requiredScore, 70));
  // actualScore is the LIVE frozen net score; read-only reference, never mutated.
  const actualScore = round1(finite(trace.actualScore));

  // Each delta derives from THIS candidate's own trace via the reused live transforms.
  const alignPositiveDelta = resolveAdr0472AlignDeltaForCandidate(
    trace,
    ADR_0472_ALIGN_RECOGNIZED_POSITIVE_COMPONENTS,
  );
  const dedupPenaltyDelta = resolveDedupDeltaForCandidate(trace);
  const riskSplitPenaltyDelta = resolveRiskSplitDeltaForCandidate(trace);

  const dryRunScore = round1(actualScore + alignPositiveDelta + dedupPenaltyDelta + riskSplitPenaltyDelta);
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
    requiredScore,
    dryRunScore,
    scoreGap,
    decision,
    alignPositiveDelta,
    breakoutStructureScore: round1(positiveComponentScore(trace, 'BREAKOUT_STRUCTURE')),
    priceMomentumScore: round1(positiveComponentScore(trace, 'PRICE_MOMENTUM')),
    dedupPenaltyDelta,
    riskSplitPenaltyDelta,
  };
}

/**
 * Build the per-candidate DRY_RUN scoring-alignment gate result from the REAL
 * candidate traces. Returns a disabled result with no survivors when the ENV flag
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
  // requiredScore on the result is informational only; per-candidate uses the frozen trace value.
  const requiredScoreFromReport = finite(input.alignmentReport?.requiredScore, 70);

  const base: Omit<Gate1ScoringAlignmentDryRunGateResult, 'survivors' | 'evaluated'> = {
    enabled,
    scenario,
    requiredScore: round1(input.requiredScoreOverride ?? requiredScoreFromReport),
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
    .map((trace) => evaluateCandidate(trace, input.requiredScoreOverride));

  // Survivors: real symbols that fail the live curve but pass the relaxed curve.
  const survivors = evaluated.filter((candidate) => candidate.decision === 'WOULD_PASS_DRY_RUN');

  return { ...base, survivors, evaluated };
}
