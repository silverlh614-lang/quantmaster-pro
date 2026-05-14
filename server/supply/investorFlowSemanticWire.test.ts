// @responsibility Supply gate semantic flat-row wiring regression tests.
import { describe, expect, it } from 'vitest';
import {
  evaluateInvestorFlowSemanticAvailabilityV2,
  extractFlatInvestorFlowRow,
} from './investorFlowSemanticAvailability.js';
import { buildInvestorFlowFlatRowForGate } from '../trading/signalScanner/investorFlowProviderRouterAdr0477.js';

describe('extractFlatInvestorFlowRow', () => {
  it('foreignNetBuy=0 is valid, not missing', () => {
    const result = extractFlatInvestorFlowRow({ foreignNetBuy: 0, institutionNetBuy: 100 });
    expect(result).not.toBeNull();
    expect(result?.foreignNetBuy).toBe(0);
  });

  it('institutionNetBuy=0 is valid', () => {
    const result = extractFlatInvestorFlowRow({ foreignNetBuy: 500, institutionNetBuy: 0 });
    expect(result?.institutionNetBuy).toBe(0);
  });

  it('returns a flat row when only foreignNetBuy exists', () => {
    expect(extractFlatInvestorFlowRow({ foreignNetBuy: 123456 })).not.toBeNull();
  });

  it('returns a flat row when only institutionNetBuy exists', () => {
    expect(extractFlatInvestorFlowRow({ institutionNetBuy: -34567 })).not.toBeNull();
  });

  it('converts numeric strings to numbers', () => {
    const result = extractFlatInvestorFlowRow({ foreignNetBuy: '123456', institutionNetBuy: '-78900' });
    expect(result?.foreignNetBuy).toBe(123456);
    expect(result?.institutionNetBuy).toBe(-78900);
  });

  it('returns null when foreignNetBuy and institutionNetBuy are both null', () => {
    expect(extractFlatInvestorFlowRow({ programNetBuy: 100 })).toBeNull();
  });

  it('extracts numeric fields from a wrapper object', () => {
    const result = extractFlatInvestorFlowRow({
      candidateSymbol: '005930',
      providerScope: 'SYMBOL_LEVEL',
      foreignNetBuy: 987654321,
      institutionNetBuy: -123456789,
      executionImpact: 'NONE',
    });
    expect(result?.foreignNetBuy).toBe(987654321);
    expect(result?.institutionNetBuy).toBe(-123456789);
  });
});

describe('evaluateInvestorFlowSemanticAvailabilityV2 flat row', () => {
  it('returns AVAILABLE for a flat row', () => {
    const result = evaluateInvestorFlowSemanticAvailabilityV2({
      flow: { foreignNetBuy: 100, institutionNetBuy: 200 },
      symbolMatched: true,
      providerScope: 'SYMBOL_LEVEL',
    });
    expect(result.reason).toBe('AVAILABLE');
    expect(result.available).toBe(true);
    expect(result.providerIssue).toBe(false);
  });

  it('keeps ONLY_WRAPPER_OBJECT_SELECTED providerIssue=false', () => {
    const result = evaluateInvestorFlowSemanticAvailabilityV2({
      flow: { candidateSymbol: '005930', providerScope: 'SYMBOL_LEVEL', executionImpact: 'NONE' },
      symbolMatched: true,
      providerScope: 'SYMBOL_LEVEL',
    });
    expect(result.reason).toBe('ONLY_WRAPPER_OBJECT_SELECTED');
    expect(result.providerIssue).toBe(false);
  });
});

describe('buildInvestorFlowFlatRowForGate', () => {
  it('builds an explicit router-extracted flat row from sanitized semantic values', () => {
    const result = buildInvestorFlowFlatRowForGate({
      symbol: '005930',
      provider: 'KIS_API',
      providerScope: 'SYMBOL_LEVEL',
      materialized: true,
      foreignNetBuy: 0,
      institutionalNetBuy: 123,
      individualNetBuy: null,
      sourceFields: {},
      rawFieldKeys: [],
      normalizedFieldKeys: [],
    });
    expect(result).toEqual({
      foreignNetBuy: 0,
      institutionNetBuy: 123,
      programNetBuy: null,
      _source: 'ROUTER_EXTRACTED',
    });
  });
});
