import { describe, expect, it } from 'vitest';
import { enforceRowInvariant, resolveCombinedSource } from './programMarketSnapshot.js';

describe('programMarketSnapshot invariants', () => {
  it('outputLength=0 => nonZeroRows=0', () => {
    expect(enforceRowInvariant(0, 30)).toBe(0);
  });

  it('KOSPI=0,KOSDAQ=0 cannot be KOSPI_PLUS_KOSDAQ', () => {
    const src = resolveCombinedSource({ kospiRequested: true, kosdaqRequested: true, kospiOutputLength: 0, kosdaqOutputLength: 0, combinedOutputLength: 0, combinedMatchesSplit: true });
    expect(src).not.toBe('KOSPI_PLUS_KOSDAQ');
  });

  it('strict split requires combined length equality', () => {
    const src = resolveCombinedSource({ kospiRequested: true, kosdaqRequested: true, kospiOutputLength: 10, kosdaqOutputLength: 20, combinedOutputLength: 30, combinedMatchesSplit: true });
    expect(src).toBe('KOSPI_PLUS_KOSDAQ');
  });

  it('mismatch falls back to SINGLE_KIS_RESPONSE when combined exists', () => {
    const src = resolveCombinedSource({ kospiRequested: true, kosdaqRequested: true, kospiOutputLength: 0, kosdaqOutputLength: 0, combinedOutputLength: 11, combinedMatchesSplit: false });
    expect(src).toBe('SINGLE_KIS_RESPONSE');
  });
});
