// @responsibility DART 후보 정량스크리너 부착
import type { DartPreNewsCandidate } from './dartPreNewsTypes.js';

export type AdvisoryCandidateWithOptionalCode = {
  code?: string;
  stockCode?: string;
  symbol?: string;
  dartPreNewsCatalysts?: DartPreNewsCandidate[];
  totalAdvisoryScore?: number;
};

export function attachDartPreNewsCatalysts<T extends AdvisoryCandidateWithOptionalCode>(
  candidates: T[],
  dartCandidates: DartPreNewsCandidate[],
): Array<T & { dartPreNewsCatalysts?: DartPreNewsCandidate[] }> {
  const byCode = new Map<string, DartPreNewsCandidate[]>();
  for (const dart of dartCandidates) {
    if (!dart.stockCode) continue;
    byCode.set(dart.stockCode, [...(byCode.get(dart.stockCode) ?? []), dart]);
  }
  return candidates.map((candidate) => {
    const code = candidate.stockCode ?? candidate.code ?? candidate.symbol;
    const catalysts = code ? byCode.get(code) : undefined;
    return catalysts?.length ? { ...candidate, dartPreNewsCatalysts: catalysts } : { ...candidate };
  });
}
