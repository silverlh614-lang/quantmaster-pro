// @responsibility Gate3 outcome label assignment from forward returns; no execution impact.

import type { Gate3OutcomeLabel, Gate3OutcomeSeed, Gate3OutcomeStatus } from './gate3OutcomeSeed.js';

export interface Gate3OutcomeLabelContext {
  becameReadyWithin3d?: boolean;
  dataResolvedWithin3d?: boolean;
  dataStillMissing?: boolean;
}

function valueOrNull(value: number | null | undefined): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

function d5OrMax(seed: Gate3OutcomeSeed): number | null {
  return valueOrNull(seed.forwardReturns.d5) ?? valueOrNull(seed.maxForwardReturnPct);
}

function hasAnyForwardReturn(seed: Gate3OutcomeSeed): boolean {
  return Object.values(seed.forwardReturns).some((value) => valueOrNull(value) !== null);
}

function labelReady(seed: Gate3OutcomeSeed): Gate3OutcomeLabel | null {
  const d5 = valueOrNull(seed.forwardReturns.d5);
  const maxReturn = valueOrNull(seed.maxForwardReturnPct);
  if (seed.hitTarget === true) return 'GATE3_READY_WIN';
  if (seed.hitStop === true) return 'GATE3_READY_LOSS';
  if ((d5 ?? Number.NEGATIVE_INFINITY) >= 3 || (maxReturn ?? Number.NEGATIVE_INFINITY) >= 5) return 'GATE3_READY_FOLLOW_THROUGH';
  if ((d5 ?? Number.POSITIVE_INFINITY) <= -2) return 'GATE3_READY_FAILED_BREAKOUT';
  return hasAnyForwardReturn(seed) ? 'GATE3_READY_BREAKEVEN' : null;
}

function labelWait(seed: Gate3OutcomeSeed, context: Gate3OutcomeLabelContext): Gate3OutcomeLabel | null {
  const d5 = d5OrMax(seed);
  const maxReturn = valueOrNull(seed.maxForwardReturnPct);
  if (context.becameReadyWithin3d === true) return 'GATE3_WAIT_BECAME_READY';
  if ((d5 ?? Number.NEGATIVE_INFINITY) >= 5) return 'GATE3_WAIT_MISSED_BREAKOUT';
  if ((d5 ?? Number.POSITIVE_INFINITY) <= 0 || (maxReturn ?? Number.POSITIVE_INFINITY) < 3) return 'GATE3_WAIT_CORRECT_PATIENCE';
  return hasAnyForwardReturn(seed) ? 'GATE3_WAIT_FAILED_SETUP' : null;
}

function labelBlocked(seed: Gate3OutcomeSeed): Gate3OutcomeLabel | null {
  const d5 = d5OrMax(seed);
  if (d5 === null) return null;
  if (d5 >= 5 && seed.issue === 'RRR_FAIL') return 'GATE3_BLOCKED_OVERSTRICT_RRR';
  if (d5 >= 5 && seed.issue === 'VOLUME_WEAK') return 'GATE3_BLOCKED_OVERSTRICT_VOLUME';
  if (d5 >= 5 && seed.issue === 'PRICE_NOT_CONFIRMED') return 'GATE3_BLOCKED_OVERSTRICT_PRICE';
  if (d5 >= 5) return 'GATE3_BLOCKED_FALSE_NEGATIVE';
  return 'GATE3_BLOCKED_CORRECT';
}

function labelDataIncomplete(seed: Gate3OutcomeSeed, context: Gate3OutcomeLabelContext): Gate3OutcomeLabel | null {
  const d5 = d5OrMax(seed);
  if (context.dataResolvedWithin3d === true) return 'GATE3_DATA_INCOMPLETE_RESOLVED';
  if ((d5 ?? Number.NEGATIVE_INFINITY) >= 5) return 'GATE3_DATA_INCOMPLETE_MISSED_OPPORTUNITY';
  if (context.dataStillMissing === true) return 'GATE3_DATA_INCOMPLETE_PROVIDER_GAP';
  if (hasAnyForwardReturn(seed)) return 'GATE3_DATA_INCOMPLETE_NO_SIGNAL';
  return null;
}

export function labelGate3Outcome(
  seed: Gate3OutcomeSeed,
  context: Gate3OutcomeLabelContext = {},
): Gate3OutcomeLabel | null {
  if (seed.readiness === 'READY') return labelReady(seed);
  if (seed.readiness === 'WAIT') return labelWait(seed, context);
  if (seed.readiness === 'BLOCKED') return labelBlocked(seed);
  return labelDataIncomplete(seed, context);
}

export function applyGate3OutcomeLabel(
  seed: Gate3OutcomeSeed,
  context: Gate3OutcomeLabelContext = {},
): Gate3OutcomeSeed {
  const outcomeLabel = labelGate3Outcome(seed, context);
  const outcomeStatus: Gate3OutcomeStatus = outcomeLabel ? 'LABELED' : seed.outcomeStatus;
  return {
    ...seed,
    outcomeLabel,
    outcomeStatus,
    marketSignal: false,
    providerIssue: false,
  };
}
