// @responsibility Resolve attribution sample hygiene eligibility.

import type {
  AttributionEligibility,
  AttributionEvidenceRecord,
  AttributionExecutionImpact,
} from './attributionEvidenceTypes.js';

export interface ResolveAttributionEligibilityInput
  extends Partial<Omit<AttributionEvidenceRecord, 'eligibility' | 'createdAt' | 'updatedAt'>> {
  sampleSize?: number;
  minCoreSampleSize?: number;
}

const DIAGNOSTIC_ENGINE_MODES = new Set(['SELL_ONLY', 'SHADOW_ONLY', 'OBSERVE_ONLY', 'R6_DEFENSE']);
const REQUIRED_FIELDS = ['tradeDate', 'symbol', 'regime', 'source', 'outcomeStatus', 'executionStatus', 'engineMode', 'dataConfidence'] as const;
const CORE_EXECUTION_IMPACTS = new Set<AttributionExecutionImpact | undefined>([undefined, 'NONE', 'EXIT_ALLOWED']);

function hasRequiredFields(input: ResolveAttributionEligibilityInput): boolean {
  for (const field of REQUIRED_FIELDS) {
    const value = input[field];
    if (value === undefined || value === null || value === '') return false;
  }
  return Array.isArray(input.conditionKeys);
}

export function resolveAttributionEligibility(
  input: ResolveAttributionEligibilityInput,
): AttributionEligibility {
  if (!hasRequiredFields(input)) return 'EXCLUDED';
  if (input.outcomeStatus === 'INVALID') return 'EXCLUDED';
  if (input.dataConfidence === 'MISSING' || input.dataConfidence === 'UNKNOWN') return 'EXCLUDED';
  if (input.providerIssue === true && input.marketSignal === false) return 'EXCLUDED';

  if (input.source === 'COUNTERFACTUAL') return 'COUNTERFACTUAL_ONLY';
  if (input.source === 'DIAGNOSTIC' || input.source === 'BLOCKED') return 'DIAGNOSTIC_ONLY';
  if (input.executionStatus === 'SKIPPED' || input.executionStatus === 'BLOCKED' || input.executionStatus === 'REJECTED') {
    return 'DIAGNOSTIC_ONLY';
  }
  if (DIAGNOSTIC_ENGINE_MODES.has(String(input.engineMode))) return 'DIAGNOSTIC_ONLY';
  if (input.providerIssue === true) return 'DIAGNOSTIC_ONLY';

  if (
    input.source === 'SHADOW'
    && input.executionStatus === 'PAPER_FILLED'
    && input.outcomeStatus === 'CONFIRMED'
  ) {
    return 'SHADOW_ONLY';
  }

  if (
    input.source === 'LIVE'
    && input.outcomeStatus === 'CONFIRMED'
    && (
      input.dataConfidence === 'DEGRADED'
      || input.engineMode === 'DEGRADED'
      || (input.sampleSize !== undefined && input.sampleSize < (input.minCoreSampleSize ?? 100))
    )
  ) {
    return 'CANDIDATE_ONLY';
  }

  if (
    input.source === 'LIVE'
    && input.executionStatus === 'EXECUTED'
    && input.outcomeStatus === 'CONFIRMED'
    && input.dataConfidence === 'VERIFIED'
    && input.engineMode === 'NORMAL'
    && CORE_EXECUTION_IMPACTS.has(input.executionImpact)
  ) {
    return 'CORE_ELIGIBLE';
  }

  if (input.source === 'LIVE' && input.outcomeStatus === 'CONFIRMED') return 'CANDIDATE_ONLY';

  return 'EXCLUDED';
}
