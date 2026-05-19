export type CombinedSource = 'KOSPI_PLUS_KOSDAQ' | 'SINGLE_KIS_RESPONSE' | 'CACHE' | 'UNKNOWN';

export function resolveCombinedSource(input: {
  kospiRequested: boolean;
  kosdaqRequested: boolean;
  kospiOutputLength: number;
  kosdaqOutputLength: number;
  combinedOutputLength: number;
  combinedMatchesSplit: boolean;
  upstreamHint?: string;
}): CombinedSource {
  const strictSplit = input.kospiRequested
    && input.kosdaqRequested
    && (input.kospiOutputLength + input.kosdaqOutputLength > 0)
    && input.combinedMatchesSplit
    && input.combinedOutputLength === input.kospiOutputLength + input.kosdaqOutputLength;
  if (strictSplit) return 'KOSPI_PLUS_KOSDAQ';
  if (input.upstreamHint === 'CACHE') return 'CACHE';
  if (input.combinedOutputLength > 0) return 'SINGLE_KIS_RESPONSE';
  return 'UNKNOWN';
}

export function enforceRowInvariant(outputLength: number, nonZeroRows: number): number {
  if (outputLength <= 0) return 0;
  return Math.max(0, Math.min(nonZeroRows, outputLength));
}

