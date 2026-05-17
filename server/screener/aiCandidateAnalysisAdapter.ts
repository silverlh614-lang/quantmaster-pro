/**
 * @responsibility Advisory AI analysis adapter
 */

import type { AbnormalSignalRecord, AdvisoryScreenerCandidate } from './quantScreenerTypes.js';

export interface AiCandidateAnalysisOptions {
  enabled?: boolean;
  maxCandidates?: number;
}

export async function analyzeCandidatesWithAi(
  records: AbnormalSignalRecord[],
  options: AiCandidateAnalysisOptions = {},
): Promise<Map<string, NonNullable<AdvisoryScreenerCandidate['aiAnalysis']>>> {
  if (options.enabled !== true || records.length === 0) return new Map();
  const limited = records.slice(0, options.maxCandidates ?? records.length);
  const analyses = new Map<string, NonNullable<AdvisoryScreenerCandidate['aiAnalysis']>>();
  for (const record of limited) {
    analyses.set(record.item.symbol, {
      summary: `${record.item.name} passed data-first screening; qualitative interpretation remains advisory only.`,
      possibleCatalysts: ['AI qualitative catalyst review required'],
      cautionPoints: record.risks.length > 0 ? record.risks : ['AI output is not verified market data'],
      followUpChecks: record.missingData.length > 0 ? record.missingData.map((field) => `Verify ${field}`) : ['Confirm disclosure, news, sector flows'],
      confidence: 'AI_ESTIMATED',
    });
  }
  return analyses;
}
