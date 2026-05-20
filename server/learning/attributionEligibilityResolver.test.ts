import { describe, expect, it } from 'vitest';
import { resolveAttributionEligibility, type ResolveAttributionEligibilityInput } from './attributionEligibilityResolver.js';

const base: ResolveAttributionEligibilityInput = {
  tradeDate: '2026-05-01',
  symbol: '005930',
  regime: 'R2_BULL',
  conditionKeys: ['momentum'],
  source: 'LIVE',
  outcomeStatus: 'CONFIRMED',
  executionStatus: 'EXECUTED',
  engineMode: 'NORMAL',
  dataConfidence: 'VERIFIED',
  executionImpact: 'NONE',
};

describe('resolveAttributionEligibility', () => {
  it('classifies LIVE + EXECUTED + CONFIRMED + VERIFIED + NORMAL as CORE_ELIGIBLE', () => {
    expect(resolveAttributionEligibility(base)).toBe('CORE_ELIGIBLE');
  });

  it('classifies SHADOW + PAPER_FILLED + CONFIRMED as SHADOW_ONLY', () => {
    expect(resolveAttributionEligibility({
      ...base,
      source: 'SHADOW',
      executionStatus: 'PAPER_FILLED',
    })).toBe('SHADOW_ONLY');
  });

  it('classifies COUNTERFACTUAL as COUNTERFACTUAL_ONLY', () => {
    expect(resolveAttributionEligibility({
      ...base,
      source: 'COUNTERFACTUAL',
      executionStatus: 'NOT_EXECUTED',
    })).toBe('COUNTERFACTUAL_ONLY');
  });

  it('keeps SELL_ONLY samples out of CORE_ELIGIBLE', () => {
    expect(resolveAttributionEligibility({ ...base, engineMode: 'SELL_ONLY' })).toBe('DIAGNOSTIC_ONLY');
  });

  it('keeps R6_DEFENSE samples out of CORE_ELIGIBLE', () => {
    expect(resolveAttributionEligibility({ ...base, engineMode: 'R6_DEFENSE' })).toBe('DIAGNOSTIC_ONLY');
  });

  it('excludes MISSING data confidence', () => {
    expect(resolveAttributionEligibility({ ...base, dataConfidence: 'MISSING' })).toBe('EXCLUDED');
  });

  it('keeps DEGRADED live samples candidate-only', () => {
    expect(resolveAttributionEligibility({ ...base, dataConfidence: 'DEGRADED' })).toBe('CANDIDATE_ONLY');
  });

  it('excludes providerIssue=true when marketSignal=false', () => {
    expect(resolveAttributionEligibility({
      ...base,
      providerIssue: true,
      marketSignal: false,
    })).toBe('EXCLUDED');
  });
});
