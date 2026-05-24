// @responsibility Gate3 completion invariant assertion for tests and operator dry-runs.

import {
  buildGate3CompletionScore,
  type Gate3CompletionContext,
  type Gate3CompletionScore,
  type Gate3CompletionSummaryInput,
} from './gate3CompletionScore.js';

export class Gate3CompletionInvariantError extends Error {
  readonly score: Gate3CompletionScore;

  constructor(score: Gate3CompletionScore) {
    const reason = score.blockers[0]?.reason ?? score.warnings[0]?.reason ?? 'GATE3_COMPLETION_INVARIANT_FAILED';
    super(`Gate3 completion invariant failed: ${reason}`);
    this.name = 'Gate3CompletionInvariantError';
    this.score = score;
  }
}

export function assertGate3CompletionInvariants(
  gate3Summary: Gate3CompletionSummaryInput | null | undefined,
  context: Gate3CompletionContext = {},
): Gate3CompletionScore {
  const score = buildGate3CompletionScore(gate3Summary, context);
  if (score.blockers.length > 0) throw new Gate3CompletionInvariantError(score);
  return score;
}
