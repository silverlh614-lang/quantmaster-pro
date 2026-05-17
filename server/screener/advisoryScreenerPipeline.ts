/**
 * @responsibility Advisory screener pipeline orchestration
 */

import { resolveScreenerConfig } from './quantScreenerConfig.js';
import type { AdvisoryScreenerCandidate, AdvisoryScreenerResult, AdvisoryStage, ScreenerConfig, ScreenerUniverseItem } from './quantScreenerTypes.js';
import { applyQuantFirstFilter } from './quantFirstFilter.js';
import { applyAbnormalSignalFilter } from './abnormalSignalFilter.js';
import { analyzeCandidatesWithAi } from './aiCandidateAnalysisAdapter.js';
import { loadScreenerUniverse } from './universeLoader.js';
import { saveAdvisoryWatchlist } from './advisoryWatchlistStore.js';

export interface AdvisoryScreenerPipelineOptions {
  config?: Partial<ScreenerConfig>;
  universe?: ScreenerUniverseItem[];
  aiEnabled?: boolean;
  persist?: boolean;
  now?: Date;
}

function clampStage(stage: AdvisoryStage, allowedStages: AdvisoryStage[]): AdvisoryStage {
  if (allowedStages.includes(stage)) return stage;
  if (allowedStages.includes('OBSERVE')) return 'OBSERVE';
  return allowedStages[0] ?? 'OBSERVE';
}

function buildCandidate(
  record: ReturnType<typeof applyAbnormalSignalFilter>[number],
  config: ScreenerConfig,
  nowIso: string,
  aiAnalysis?: AdvisoryScreenerCandidate['aiAnalysis'],
): AdvisoryScreenerCandidate {
  const intendedStage: AdvisoryStage = aiAnalysis ? 'ADVISORY' : record.marketSignal ? 'SHADOW_SCORE' : 'OBSERVE';
  const totalAdvisoryScore = Math.round(record.quantScore * 0.45 + record.abnormalSignalScore * 0.55);
  return {
    symbol: record.item.symbol,
    name: record.item.name,
    market: record.item.market,
    sector: record.item.sector,
    stage: clampStage(intendedStage, config.allowedStages),
    passedQuantFilter: record.passedQuantFilter,
    passedAbnormalSignalFilter: record.passedAbnormalSignalFilter,
    quantScore: record.quantScore,
    abnormalSignalScore: record.abnormalSignalScore,
    totalAdvisoryScore,
    reasons: record.reasons,
    risks: record.risks,
    missingData: record.missingData,
    dataConfidence: aiAnalysis
      ? { ...record.dataConfidence, aiEstimated: record.dataConfidence.aiEstimated + 1 }
      : record.dataConfidence,
    providerIssue: record.providerIssue,
    marketSignal: record.marketSignal,
    aiEstimatedFields: aiAnalysis ? ['aiAnalysis.summary', 'aiAnalysis.possibleCatalysts', 'aiAnalysis.cautionPoints', 'aiAnalysis.followUpChecks'] : [],
    aiAnalysis,
    createdAt: nowIso,
    updatedAt: nowIso,
  };
}

export async function runAdvisoryScreenerPipeline(options: AdvisoryScreenerPipelineOptions = {}): Promise<AdvisoryScreenerResult> {
  const nowIso = (options.now ?? new Date()).toISOString();
  const config = resolveScreenerConfig(options.config);

  console.log('[ADVISORY_SCREENER_START] executionImpact=NONE');
  const universe = options.universe ?? await loadScreenerUniverse();
  console.log(`[UNIVERSE_LOADED] total=${universe.length}`);

  const quantRecords = applyQuantFirstFilter(universe, config);
  const quantPassed = quantRecords.filter((record) => record.passedQuantFilter);
  console.log(`[QUANT_FILTER_RESULT] input=${quantRecords.length} passed=${quantPassed.length} rejected=${quantRecords.length - quantPassed.length}`);

  const abnormalRecords = applyAbnormalSignalFilter(quantRecords, config);
  const abnormalPassed = abnormalRecords.filter((record) => record.passedAbnormalSignalFilter);
  console.log(`[ABNORMAL_SIGNAL_RESULT] input=${abnormalRecords.length} passed=${abnormalPassed.length}`);

  const aiInput = abnormalPassed.slice(0, config.maxCandidatesForAiAnalysis);
  const aiAnalyses = await analyzeCandidatesWithAi(aiInput, { enabled: options.aiEnabled === true, maxCandidates: config.maxCandidatesForAiAnalysis });
  const aiSkippedReason = aiInput.length === 0 ? 'NO_CANDIDATES' : options.aiEnabled === true ? undefined : 'AI_DISABLED';
  if (aiSkippedReason) console.log(`[AI_ANALYSIS_SKIPPED] reason=${aiSkippedReason}`);
  else console.log(`[AI_ANALYSIS_COMPLETED] candidates=${aiAnalyses.size}`);

  const candidates = abnormalPassed.map((record) => buildCandidate(record, config, nowIso, aiAnalyses.get(record.item.symbol)));
  if (options.persist === true) saveAdvisoryWatchlist(candidates);
  console.log(`[ADVISORY_WATCHLIST_UPDATED] count=${candidates.length}`);
  console.log('[ADVISORY_SCREENER_DONE] executionImpact=NONE');

  return {
    candidates,
    executionImpact: 'NONE',
    liveExecutionAllowed: false,
    shadowLearning: true,
    telemetry: {
      universeTotal: universe.length,
      quantPassed: quantPassed.length,
      quantRejected: quantRecords.length - quantPassed.length,
      abnormalPassed: abnormalPassed.length,
      aiAnalyzed: aiAnalyses.size,
      aiSkippedReason,
      learningTags: [
        'CASE_QUANT_CANDIDATE_OBSERVED',
        ...(abnormalPassed.length > 0 ? ['CASE_ABNORMAL_SIGNAL_DETECTED'] : []),
        ...(aiAnalyses.size > 0 ? ['CASE_AI_ANALYSIS_ADVISORY_ONLY'] : []),
        'CASE_CANDIDATE_NOT_PROMOTED_TO_CORE',
        ...(quantRecords.some((record) => record.missingData.length > 0) ? ['CASE_DATA_MISSING_IN_SCREENER'] : []),
      ],
    },
    createdAt: nowIso,
  };
}
