// @responsibility MTAS score diagnostic RevalidationStep.

import type { RevalidationStepResult } from './types.js';

export interface MtasGateStepInput {
  stockName: string;
  mtas: number;
}

const MTAS_BLOCK_THRESHOLD = 3;

/**
 * Simplification Step 3: MTAS weakness is quality/risk evidence only.
 * It must not hard-block entry by itself; finalScore decides after score penalties.
 */
export function mtasGateStep(input: MtasGateStepInput): RevalidationStepResult {
  if (input.mtas > MTAS_BLOCK_THRESHOLD) {
    return { proceed: true };
  }
  console.log(
    `[GATE_HARD_FAIL_LIMITED] symbol=${input.stockName} ` +
    `previousHardFailReason=MTAS_BELOW_THRESHOLD(${input.mtas.toFixed(1)}) ` +
    "newRole='SOFT_FAIL_OR_SCORE_PENALTY' executionImpact='NONE'",
  );
  return { proceed: true };
}
