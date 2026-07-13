// @responsibility Normal-mode supply diagnostic overlay under live-entry blocks.
import type {
  CandidateWithSupplyContext,
  PerSymbolSupplyContext,
  SupplyProviderHealth,
  SupplySignal,
} from './injectPerSymbolSupplyContext.js';
import {
  loadLatestIntradayProgramFlowSnapshot,
  type IntradayProgramFlowSnapshot,
} from '../../replay/intradayProgramFlowSnapshotRepo.js';
import { createTraceId, logVisibilityEvent } from '../../utils/logger.js';
import {
  classifyProgramFlowSession,
  type ProgramFlowForensicNextAction,
  type ProgramFlowSessionGuard,
} from './programFlowSessionGuard.js';
import {
  classifyActivePassiveConfluence,
  describeActiveFlow,
  describeProgramSignal,
  formatList,
  formatReasonDistribution,
  formatStockProgramFieldKeysTop,
} from './normalSupplyPreview/formatters.js';
import { buildNormalSupplyFieldAvailability } from './normalSupplyPreview/fieldAvailabilityBuilder.js';
import { resolveProgramFlowAfterMarketDisplay } from './normalSupplyPreview/programFlowAfterMarketDisplay.js';
import { assembleNormalSupplyPreview } from './normalSupplyPreview/previewAssembler.js';
import { setLatestNormalSupplyPreview } from './normalSupplyPreview/previewStore.js';
import {
  NORMAL_SUPPLY_DIAGNOSTIC_FULL_PREVIEW_MODE,
  NORMAL_SUPPLY_SCORE_THRESHOLDS,
} from './normalSupplyPreview/constants.js';
import {
  MARKET_PROGRAM_NUMERIC_KEYS,
  STOCK_PROGRAM_BUY_KEYS,
  STOCK_PROGRAM_NET_AMOUNT_KEYS,
  STOCK_PROGRAM_NET_BUY_KEYS,
  STOCK_PROGRAM_SCAN_KEYS,
  STOCK_PROGRAM_SELL_KEYS,
  asRecord,
  buildProgramFlowEvidenceTrace,
  candidatePreviewSymbol,
  candidateProgramRecords,
  collectProgramRecords,
  collectProgramRecordsFromItems,
  collectUpstreamProgramRecords,
  countRowsWithAnyProgramKey,
  countRowsWithParsableProgramValue,
  directRecordsFromItems,
  firstNormalizedProgramValue,
  firstOkProgramValueFromRecords,
  firstProgramValueNormalization,
  firstValueFromRecords,
  hasAnyProgramReasons,
  hasOnlyProgramReasons,
  hasProgramField,
  isStockProgramScanKey,
  marketCacheItems,
  marketLevelProgramRecords,
  marketProgramNetBuyFieldState,
  marketSnapshotItems,
  programNetBuyAmountFieldState,
  stockUpstreamSourceRecords,
  stringValue,
} from './normalSupplyPreview/programFlowEvidenceCollector.js';
import { normalizeProgramFlowValue } from './normalSupplyPreview/programFlowValueNormalizer.js';
import type {
  MarketProgramCarryForensicTrace,
  PerStockProgramCarryForensicTrace,
  ProgramFlowCarryValue,
  ProgramFlowDiagnostic,
  ProgramFlowDiagnosticsSummary,
  ProgramFlowEvidenceTrace,
  ProgramFlowMarketCarrySource,
  ProgramFlowMarketEvidenceBreakPoint,
  ProgramFlowNullRootCause,
  ProgramFlowSignal,
  ProgramFlowSourceProvider,
  ProgramFlowStockCarrySource,
  ProgramFlowStockEvidenceBreakPoint,
  ProgramFlowUpstreamPopulationResult,
  ProgramFlowUpstreamPopulationTrace,
  ProgramFlowValueNormalizationResult,
  ProgramFlowValueReason,
  ProgramMarketCarryValue,
} from './normalSupplyPreview/programFlowTypes.js';
import type {
  NormalSupplyPreview,
  NormalSupplyPreviewCandidate,
  NormalSupplyPreviewEngineMode,
  PersistNormalSupplyPreviewInput,
} from './normalSupplyPreview/types.js';
import { buildMarketProgramCarry, buildProgramFlowUpstreamPopulation, logProgramFlowDiagnostics, wireStockProgramNetBuyContextAliases } from './normalSupplyPreview/programFlowCarry.js';
import {
  buildMarketProgramCarryForensicTrace,
  buildPerStockProgramCarryForensicTrace,
  buildProgramFlowDiagnostics,
  countStockProgramKeyRows,
  hasCandidateProgramContainer,
} from './normalSupplyPreview/programFlowDiagnosticsBuilder.js';
import { deriveNormalSupplyPreviewEngineMode } from './normalSupplyPreview/engineMode.js';
import { extractMarketProgramFlowFromCandidates, normalizeMarketProgramFlow, toPreviewCandidate } from './normalSupplyPreview/candidateMapper.js';
export { deriveNormalSupplyPreviewEngineMode } from './normalSupplyPreview/engineMode.js';
export { classifySupplySignal } from './normalSupplyPreview/candidateMapper.js';

export {
  NORMAL_SUPPLY_DIAGNOSTIC_FULL_PREVIEW_MODE
} from './normalSupplyPreview/constants.js';
export { normalizeProgramFlowValue } from './normalSupplyPreview/programFlowValueNormalizer.js';
export {
  formatNormalSupplyPreviewFullSections,
  formatNormalSupplyPreviewMissingSection,
  formatNormalSupplyPreviewSection,
} from './normalSupplyPreview/formatters.js';
export {
  __resetNormalSupplyPreviewForTests,
  getLastNormalSupplyPreview,
} from './normalSupplyPreview/previewStore.js';
export type {
  NormalSupplyPreview,
  PersistNormalSupplyPreviewInput,
} from './normalSupplyPreview/types.js';

function logSupplyPreviewTrace(message: string, summary: Record<string, unknown> = {}): void {
  logVisibilityEvent({
    visibility: 'TRACE',
    message,
    category: 'SUPPLY',
    sourceCommand: '/normal_supply_preview',
    summary,
    details: { message, ...summary },
    level: 'info',
    executionImpact: 'NONE',
  });
}

export function persistNormalSupplyPreview<T extends CandidateWithSupplyContext>(
  input: PersistNormalSupplyPreviewInput<T>,
): NormalSupplyPreview {
  const capturedAt = input.capturedAt ?? new Date().toISOString();
  const sessionGuard = classifyProgramFlowSession(new Date(capturedAt));
  logSupplyPreviewTrace(
    `[NORMAL_SUPPLY_PREVIEW_PROGRAM_EVIDENCE_TRACE_START] ` +
      `candidateCount=${input.candidates.length} previewMode=${NORMAL_SUPPLY_DIAGNOSTIC_FULL_PREVIEW_MODE} ` +
      `providerCallsAdded=0 executionImpact=NONE`,
    { candidateCount: input.candidates.length, previewMode: NORMAL_SUPPLY_DIAGNOSTIC_FULL_PREVIEW_MODE },
  );
  const marketProgramFlowRaw = input.marketProgramFlow ?? extractMarketProgramFlowFromCandidates(input.candidates);
  const latestIntradayProgramFlowSnapshot = loadLatestIntradayProgramFlowSnapshot();
  wireStockProgramNetBuyContextAliases(input.candidates, latestIntradayProgramFlowSnapshot);
  logSupplyPreviewTrace(
    `[INTRADAY_PROGRAM_FLOW_CARRY_START] ` +
      `candidateCount=${input.candidates.length} ` +
      `snapshotAvailable=${Boolean(latestIntradayProgramFlowSnapshot)} ` +
      `cacheAvailable=${hasCandidateProgramContainer(input.candidates, ['cache', 'supplySnapshotCache', 'programTradingCache'])} ` +
      `programTradingContextAvailable=${hasCandidateProgramContainer(input.candidates, ['programTrading', 'programDiagnostic', 'stockProgramFlow'])} ` +
      `providerCallsAdded=0 executionImpact=NONE`,
    { candidateCount: input.candidates.length, snapshotAvailable: Boolean(latestIntradayProgramFlowSnapshot) },
  );
  const programPopulation = buildProgramFlowUpstreamPopulation(
    input.candidates,
    marketProgramFlowRaw,
    latestIntradayProgramFlowSnapshot,
  );
  logSupplyPreviewTrace(
    `[NORMAL_SUPPLY_PREVIEW_PROGRAM_UPSTREAM_POPULATION_START] ` +
      `candidateCount=${input.candidates.length} ` +
      `stockProgramNullCount=${programPopulation.trace.stockLevel.programNetBuyAmountNullCount} ` +
      `marketProgramNull=${programPopulation.trace.marketLevel.marketProgramNetBuyNull} ` +
      `providerCallsAdded=0 executionImpact=NONE`,
    { candidateCount: input.candidates.length, stockProgramNullCount: programPopulation.trace.stockLevel.programNetBuyAmountNullCount },
  );
  logSupplyPreviewTrace(
    `[NORMAL_SUPPLY_PREVIEW_PROGRAM_VALUE_NORMALIZER_START] ` +
      `candidateCount=${input.candidates.length} stockProgramKeyRows=${countStockProgramKeyRows(input.candidates)} ` +
      `marketProgramContextFound=${Boolean(asRecord(marketProgramFlowRaw))} ` +
      `providerCallsAdded=0 executionImpact=NONE`,
    { candidateCount: input.candidates.length, stockProgramKeyRows: countStockProgramKeyRows(input.candidates) },
  );
  const marketProgramFlow = normalizeMarketProgramFlow(programPopulation.marketProgramFlowRaw ?? marketProgramFlowRaw, sessionGuard);
  const previewCandidates = input.candidates
    .map((candidate) => toPreviewCandidate(
      candidate,
      marketProgramFlow,
      programPopulation.stockCarryBySymbol.get(candidatePreviewSymbol(candidate)),
    ))
    .filter((candidate): candidate is NormalSupplyPreviewCandidate => candidate !== null);
  const programFlowEvidenceTrace = buildProgramFlowEvidenceTrace(
    input.candidates,
    programPopulation.marketProgramFlowRaw ?? marketProgramFlowRaw,
    previewCandidates,
    marketProgramFlow,
    programPopulation.trace,
  );
  const marketCarryTrace = buildMarketProgramCarryForensicTrace(
    input.marketProgramCarrySource,
    input.marketProgramFlow,
    marketProgramFlow,
    programPopulation.trace.marketLevel,
    sessionGuard,
  );
  const stockCarryTrace = buildPerStockProgramCarryForensicTrace(
    input.candidates,
    latestIntradayProgramFlowSnapshot,
    previewCandidates,
    programPopulation.trace.stockLevel,
    sessionGuard,
  );
  const programFlowDiagnostics = buildProgramFlowDiagnostics(
    previewCandidates,
    marketProgramFlow,
    programFlowEvidenceTrace,
    sessionGuard,
    marketCarryTrace,
    stockCarryTrace,
  );
  const fieldAvailability = buildNormalSupplyFieldAvailability(
    previewCandidates,
    programFlowEvidenceTrace,
    programFlowDiagnostics,
  );

  const preview = setLatestNormalSupplyPreview(
    assembleNormalSupplyPreview({
      capturedAt,
      engineMode: input.engineMode,
      source: input.source,
      reason: input.reason,
      preflightDecision: input.preflightDecision,
      candidates: previewCandidates,
      supplyInjection: input.supplyInjection,
      fieldAvailability,
      programFlowDiagnostics,
      programFlowEvidenceTrace,
      programFlowUpstreamPopulationTrace: programPopulation.trace,
      topN: input.topN ?? 5,
    }),
  );
  const summaryTraceId = createTraceId('supply');
  const { healthCounts, signalCounts, supplyInjection } = preview;
  logVisibilityEvent({
    visibility: 'SUMMARY',
    category: 'SUPPLY',
    sourceCommand: '/normal_supply_preview',
    traceId: summaryTraceId,
    message:
      `[SUPPLY_PREVIEW_SUMMARY] ` +
      `mode=${NORMAL_SUPPLY_DIAGNOSTIC_FULL_PREVIEW_MODE} ` +
      `candidateCount=${preview.candidateCount} ` +
      `injected=${supplyInjection.injected} verified=${healthCounts.VERIFIED} degraded=${healthCounts.DEGRADED} ` +
      `stale=${healthCounts.STALE} missing=${healthCounts.MISSING} ` +
      `accumulating=${signalCounts.ACCUMULATING} neutral=${signalCounts.NEUTRAL} bearish=${signalCounts.BEARISH} ` +
      `programProvider=${programFlowDiagnostics.marketProgramAvailable ? 'AVAILABLE_DIAGNOSTIC_ONLY' : 'EMPTY_DIAGNOSTIC_ONLY'} ` +
      `providerCallsAdded=0 executionImpact=NONE traceId=${summaryTraceId}`,
    summary: {
      candidateCount: preview.candidateCount,
      injected: supplyInjection.injected,
      healthCounts,
      signalCounts,
      programProvider: programFlowDiagnostics.marketProgramAvailable ? 'AVAILABLE_DIAGNOSTIC_ONLY' : 'EMPTY_DIAGNOSTIC_ONLY',
      executionImpact: 'NONE',
    },
    details: { preview },
    level: 'info',
    executionImpact: 'NONE',
  });
  logSupplySignalTierRefinement(preview);
  logProgramFlowDiagnostics(preview);
  return preview;
}

function logSupplySignalTierRefinement(preview: NormalSupplyPreview): void {
  logVisibilityEvent({
    visibility: 'DIAGNOSTIC',
    category: 'SUPPLY',
    sourceCommand: '/normal_supply_preview',
    dedupKey: `SUPPLY_SIGNAL_TIER_REFINEMENT:${preview.candidateCount}:${preview.signalCounts.ACCUMULATING}:NONE`,
    message:
    `[SUPPLY_SIGNAL_TIER_REFINEMENT] ` +
      `candidateCount=${preview.candidateCount} bullish=${preview.signalCounts.BULLISH} ` +
      `accumulating=${preview.signalCounts.ACCUMULATING} neutral=${preview.signalCounts.NEUTRAL} ` +
      `bearish=${preview.signalCounts.BEARISH} unusable=${preview.signalCounts.UNUSABLE} ` +
      `accumulatingUsedForLiveDecision=false executionImpact=NONE`,
    summary: { signalCounts: preview.signalCounts, executionImpact: 'NONE' },
    details: { candidates: preview.candidates.map((c) => ({ symbol: c.symbol, signal: c.supplySignal, score: c.supplyScore })) },
    level: 'info',
    executionImpact: 'NONE',
  });
  const accumulating = preview.candidates.filter((candidate) => candidate.supplySignal === 'ACCUMULATING');
  if (accumulating.length > 0) {
    const traceId = createTraceId('supply_acc');
    logVisibilityEvent({
      visibility: 'SUMMARY',
      category: 'SUPPLY',
      sourceCommand: '/normal_supply_preview',
      traceId,
      message:
        `[SUPPLY_ACCUMULATING_SUMMARY] ` +
        `count=${accumulating.length} topSymbols=${accumulating.slice(0, 5).map((c) => c.name ?? c.symbol).join(',')} ` +
        `usedForLiveDecision=false shadowTracking=true executionImpact=NONE ` +
        `detailsSuppressed=${Math.max(0, accumulating.length - 5)} traceId=${traceId}`,
      summary: { count: accumulating.length, topSymbols: accumulating.slice(0, 5).map((c) => c.symbol), executionImpact: 'NONE' },
      details: { accumulating },
      level: 'info',
      executionImpact: 'NONE',
    });
  }
  for (const candidate of accumulating) {
    if (candidate.supplySignal !== 'ACCUMULATING') continue;
    logVisibilityEvent({
      visibility: 'TRACE',
      category: 'SUPPLY',
      sourceCommand: '/normal_supply_preview',
      message:
      `[SUPPLY_ACCUMULATING_DETECTED] ` +
        `symbol=${candidate.symbol} name=${candidate.name ?? 'n/a'} supplyScore=${candidate.supplyScore} ` +
        `foreignNetBuy=${candidate.foreignNetBuyAmount ?? 'N/A'} ` +
        `institutionNetBuy=${candidate.institutionNetBuyAmount ?? 'N/A'} ` +
        `reason=FOREIGN_AND_INSTITUTION_NET_BUY_BUT_BELOW_BULLISH_THRESHOLD ` +
        `usedForLiveDecision=false shadowTracking=true executionImpact=NONE`,
      summary: { symbol: candidate.symbol, supplyScore: candidate.supplyScore, executionImpact: 'NONE' },
      details: { candidate },
      level: 'info',
      executionImpact: 'NONE',
    });
  }
}
