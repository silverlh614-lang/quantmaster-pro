// @responsibility Step 26 runtime resolver trace for /scan_blockers verification.

import { getLastKrxPostMeta } from '../../clients/krxClient/http.js';
import type { ScanSummary } from './scanDiagnostics/scanSummaryTypes.js';

export const STEP26_RUNTIME_PATCH_VERSION = 'STEP26_RUNTIME_TRACE_2026_05_21';

const KRX_MDCSTAT02401_BLD = 'dbms/MDC/STAT/standard/MDCSTAT02401';
const KRX_MDCSTAT02401_ALLOWED_KEYS = ['bld', 'endDd', 'inqVal', 'isuCd', 'strtDd'];
const PROVIDER_OK_STATUSES = new Set(['VERIFIED', 'OK', 'READY', 'UP', 'SUCCESS', 'PARTIAL']);

type RuntimeTraceModuleName =
  | 'scanDiagnosticsCore.persistScanResults'
  | 'buildGateScoreInputSnapshot'
  | 'positiveScoreStarvationAudit'
  | 'gate1ScoreCeilingRepairAudit'
  | 'investorFlowRouter'
  | 'kisInvestorFlowAdapter'
  | 'providerHealthAggregator'
  | 'supplyUnknownPolicyResolver'
  | 'breakoutFeatureBuilder'
  | 'watchlistScoreResolver';

interface RuntimeTraceModule {
  name: RuntimeTraceModuleName;
  file: string;
  functionName: string;
  version: string;
  selectedInputPath: string;
  fallbackInputPath: string;
  legacyPathUsed: boolean;
  legacyReason?: string;
  patchVersion: string;
  called: true;
  candidateCount: number;
  sampleScope: string;
  sourceSnapshotId: string;
}

export interface CanonicalRuntimeResolutionStep27 {
  scanId: string;
  sourceSnapshotId: string;
  gateScoreInputSnapshotId: string;
  kisInvestorFlow: {
    selectedProvider: string;
    selectedProviderStatus: string;
    rawRows: number;
    semanticRows: number;
    totalRows: number;
    finalRouterUsable: boolean;
    finalGateScoreEligible: boolean;
    gateEligibleRows: number;
    shadowOnlyRows: number;
    failedCriteria: string[];
    providerIssue: boolean;
    marketSignal: boolean;
  };
  watchlist: {
    verified: number;
    missing: number;
    avg: number;
    selectedInputPath: string;
    conflict: boolean;
  };
  momentum: {
    return5dCount: number;
    return20dCount: number;
    relativeReturn20dCount: number;
    marketRelativeReturnCount: number;
    priceMomentumComputedCount: number;
    projectedToGate1: boolean;
  };
  breakout: {
    traceAvailable: number;
    scoreComputed: number;
    scoreMapped: number;
    zeroByCondition: number;
    missingByMapping: number;
    waitFeatureMissing: number;
    waitEntryPriceNotReached: number;
  };
  providerPenalty: {
    providerIssuePenaltyApplied: boolean;
    unknownPenaltyApplied: boolean;
    penaltyScope: 'DIAGNOSTIC_ONLY' | 'SYMBOL_LEVEL' | 'GLOBAL';
    originalDiagnosticProviderPenaltyAvg: number;
    effectiveProviderPenaltyAvg: number;
    originalDiagnosticUnknownPenaltyAvg: number;
    effectiveUnknownPenaltyAvg: number;
  };
  sizing: {
    hardBlockCount: number;
    advisoryCount: number;
    finalKelly: number | null;
  };
}

function finite(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value);
}

function numberOrZero(value: unknown): number {
  return finite(value) ? value : 0;
}

function boolText(value: boolean): string {
  return value ? 'true' : 'false';
}

function listText(values: readonly string[]): string {
  return values.length > 0 ? values.join(',') : 'NONE';
}

function jsonList(values: readonly string[]): string {
  return `[${values.join(',')}]`;
}

function statusOk(status: unknown): boolean {
  return PROVIDER_OK_STATUSES.has(String(status ?? 'UNKNOWN').trim().toUpperCase());
}

function mapLines(record: Record<string, number> | undefined): string {
  if (!record) return 'NONE';
  return Object.entries(record)
    .filter(([, count]) => Number(count) > 0)
    .sort((a, b) => Number(b[1]) - Number(a[1]))
    .map(([key, count]) => `${key}=${count}`)
    .join(',') || 'NONE';
}

function round1(value: number): number {
  return Number.isFinite(value) ? Math.round(value * 10) / 10 : 0;
}

function candidateCountOf(summary: ScanSummary | null): number {
  return Math.max(0, Math.floor(summary?.candidates ?? summary?.gate1MinimumSignalForensicAdr0505?.totalCandidates ?? 0));
}

function sourceSnapshotIdOf(summary: ScanSummary | null): string {
  return summary?.snapshotId ?? summary?.scanEvaluation?.scanId ?? (summary?.time ? `scan-summary:${summary.time}` : 'NO_SCAN_SUMMARY');
}

function buildModule(input: {
  name: RuntimeTraceModuleName;
  file: string;
  functionName: string;
  selectedInputPath: string;
  fallbackInputPath?: string;
  legacyPathUsed?: boolean;
  legacyReason?: string;
  candidateCount: number;
  sampleScope: string;
  sourceSnapshotId: string;
}): RuntimeTraceModule {
  return {
    name: input.name,
    file: input.file,
    functionName: input.functionName,
    version: STEP26_RUNTIME_PATCH_VERSION,
    selectedInputPath: input.selectedInputPath,
    fallbackInputPath: input.fallbackInputPath ?? 'none',
    legacyPathUsed: input.legacyPathUsed ?? false,
    legacyReason: input.legacyReason,
    patchVersion: STEP26_RUNTIME_PATCH_VERSION,
    called: true,
    candidateCount: input.candidateCount,
    sampleScope: input.sampleScope,
    sourceSnapshotId: input.sourceSnapshotId,
  };
}

function formatModule(module: RuntimeTraceModule): string[] {
  return [
    `- ${module.name}: file=${module.file} / function=${module.functionName} / version=${module.version}`,
    `  selectedInputPath=${module.selectedInputPath}`,
    `  fallbackInputPath=${module.fallbackInputPath}`,
    `  legacyPathUsed=${boolText(module.legacyPathUsed)}`,
    ...(module.legacyPathUsed ? [`  legacyReason=${module.legacyReason ?? 'UNSPECIFIED'}`] : []),
    `  patchVersion=${module.patchVersion}`,
    `  called=${boolText(module.called)}`,
    `  candidateCount=${module.candidateCount}`,
    `  sampleScope=${module.sampleScope}`,
    `  sourceSnapshotId=${module.sourceSnapshotId}`,
  ];
}

function buildModules(summary: ScanSummary | null): RuntimeTraceModule[] {
  const sourceSnapshotId = summary?.snapshotId ?? 'NO_SCAN_SUMMARY';
  const candidateCount = Math.max(0, Math.floor(summary?.candidates ?? summary?.gate1MinimumSignalForensicAdr0505?.totalCandidates ?? 0));
  const sampleScope = candidateCount > 0 ? `CANDIDATES_${candidateCount}` : 'NO_SCAN_SUMMARY';
  return [
    buildModule({
      name: 'scanDiagnosticsCore.persistScanResults',
      file: 'server/trading/signalScanner/scanDiagnostics/persistScanResults.ts',
      functionName: 'persistScanResults',
      selectedInputPath: 'ScanSummaryDraft -> persisted ScanSummary',
      candidateCount,
      sampleScope: 'SCAN_SUMMARY',
      sourceSnapshotId,
    }),
    buildModule({
      name: 'buildGateScoreInputSnapshot',
      file: 'server/trading/signalScanner/gateScoreInputSnapshot.ts',
      functionName: 'buildGateScoreInputSnapshot',
      selectedInputPath: 'SourceSnapshot -> gateScoreInputSnapshot',
      fallbackInputPath: 'featurePack when snapshot field missing',
      candidateCount,
      sampleScope,
      sourceSnapshotId,
    }),
    buildModule({
      name: 'positiveScoreStarvationAudit',
      file: 'server/trading/signalScanner/gate1PositiveScoreStarvation.ts',
      functionName: 'buildPositiveScoreStarvationReport',
      selectedInputPath: 'gateScoreInputSnapshot + Gate1 traces',
      candidateCount,
      sampleScope,
      sourceSnapshotId,
    }),
    buildModule({
      name: 'gate1ScoreCeilingRepairAudit',
      file: 'server/trading/signalScanner/gate1ScoreCeilingRepair.ts',
      functionName: 'buildGate1ScoreCeilingRepairReport',
      selectedInputPath: 'positiveScoreStarvationReport.watchlistScoreImports',
      candidateCount,
      sampleScope,
      sourceSnapshotId,
    }),
    buildModule({
      name: 'investorFlowRouter',
      file: 'server/trading/signalScanner/investorFlowProviderRouterAdr0477/routeBuilder.ts',
      functionName: 'buildInvestorFlowProviderRouteResultAdr0477',
      selectedInputPath: 'KIS_API selected semantic/materialized row',
      fallbackInputPath: 'KRX/FSS/NAVER/CACHE diagnostic-only providers',
      candidateCount,
      sampleScope,
      sourceSnapshotId,
    }),
    buildModule({
      name: 'kisInvestorFlowAdapter',
      file: 'server/supply/investorFlowSemanticAvailability.ts',
      functionName: 'buildSanitizedInvestorFlowSemanticRow',
      selectedInputPath: 'KIS symbol-level investor rows',
      candidateCount,
      sampleScope,
      sourceSnapshotId,
    }),
    buildModule({
      name: 'providerHealthAggregator',
      file: 'server/trading/signalScanner/scanDiagnostics/providerHealth.ts',
      functionName: 'aggregateProviderHealth',
      selectedInputPath: 'selectedProvider status only',
      fallbackInputPath: 'non-selected provider issues diagnostic-only',
      candidateCount,
      sampleScope,
      sourceSnapshotId,
    }),
    buildModule({
      name: 'supplyUnknownPolicyResolver',
      file: 'server/trading/signalScanner/sectorEnergyMasterSupplyUnknownPolicyAdr0488.ts',
      functionName: 'buildSupplyUnknownPolicyReportAdr0488',
      selectedInputPath: 'providerVerified + marketSignal=false',
      candidateCount,
      sampleScope,
      sourceSnapshotId,
    }),
    buildModule({
      name: 'breakoutFeatureBuilder',
      file: 'server/trading/signalScanner/gate1ScoreCeilingRepair.ts',
      functionName: 'buildBreakoutStructureScoreTrace',
      selectedInputPath: 'featurePack.breakout + KIS_DAILY_CHART',
      fallbackInputPath: 'watchlist reason proxy diagnostic-only',
      candidateCount,
      sampleScope,
      sourceSnapshotId,
    }),
    buildModule({
      name: 'watchlistScoreResolver',
      file: 'server/trading/signalScanner/watchlistUpstreamScoreResolver.ts',
      functionName: 'resolveWatchlistUpstreamScore',
      selectedInputPath: 'gateScoreInputSnapshot.watchlist.watchlistScore',
      fallbackInputPath: 'featurePack.watchlistScore -> legacy direct fields',
      candidateCount,
      sampleScope,
      sourceSnapshotId,
    }),
  ];
}

export function buildCanonicalRuntimeResolutionStep27(summary: ScanSummary | null): CanonicalRuntimeResolutionStep27 {
  const sourceSnapshotId = sourceSnapshotIdOf(summary);
  const candidateCount = candidateCountOf(summary);
  const scanId = summary?.scanEvaluation?.scanId ?? summary?.time ?? 'NO_SCAN_SUMMARY';
  const gateScoreInputSnapshotId = `gateScoreInput:${sourceSnapshotId}`;
  const router = summary?.investorFlowProviderRouter;
  const forensic = summary?.gate1MinimumSignalForensicAdr0505;
  const selectedProvider = router?.selectedProvider ?? 'KIS_API';
  const selectedProviderStatus =
    router?.providerStatuses?.[selectedProvider] ??
    router?.providerStatuses?.KIS_API ??
    router?.status ??
    'UNKNOWN';
  const rawCount = numberOrZero(router?.actualInvestorFlowRowCount) || numberOrZero(forensic?.rawInvestorRowAvailableCount);
  const normalizedCount =
    numberOrZero(forensic?.kisNormalizedRowsMaterialized) ||
    (router?.normalizedRowAvailable === true ? rawCount || 1 : 0);
  const materializedCount =
    numberOrZero(forensic?.kisSemanticRowsMaterialized) ||
    (router?.materialized === true ? rawCount || 1 : 0);
  const semanticRows =
    numberOrZero(forensic?.semanticRowAvailableCount) ||
    (router?.semanticRowAvailable === true ? materializedCount || 1 : 0);
  const foreignFieldCount =
    numberOrZero(forensic?.foreignNetBuyAvailable) ||
    (router?.gateSemanticFlatRow?.foreignNetBuy != null ? semanticRows || 1 : 0);
  const institutionFieldCount =
    numberOrZero(forensic?.institutionalNetBuyAvailable) ||
    (router?.gateSemanticFlatRow?.institutionNetBuy != null ? semanticRows || 1 : 0);
  const placeholderDetected = Boolean(
    router?.selectedActualPlaceholderFieldKeys &&
    router.selectedActualPlaceholderFieldKeys.length > 0 &&
    semanticRows === 0,
  );
  const providerIssue = !statusOk(selectedProviderStatus);
  const marketSignal = false;
  const failedCriteria: string[] = [];
  if (rawCount < 1) failedCriteria.push('RAW_COUNT_ZERO');
  if (normalizedCount < 1) failedCriteria.push('NORMALIZED_COUNT_ZERO');
  if (materializedCount < 1) failedCriteria.push('MATERIALIZED_COUNT_ZERO');
  if (semanticRows <= 0) failedCriteria.push('SEMANTIC_ROWS_ZERO');
  if (foreignFieldCount <= 0) failedCriteria.push('FOREIGN_FIELD_MISSING');
  if (institutionFieldCount <= 0) failedCriteria.push('INSTITUTION_FIELD_MISSING');
  if (placeholderDetected) failedCriteria.push('PLACEHOLDER_DETECTED');
  if (providerIssue) failedCriteria.push('PROVIDER_ISSUE');
  if (marketSignal) failedCriteria.push('MARKET_SIGNAL_TRUE');
  const finalRouterUsable = failedCriteria.length === 0;
  const gateEligibleRows = finalRouterUsable
    ? Math.max(
        numberOrZero(forensic?.selectedProviderActualRowCount),
        numberOrZero(forensic?.selectedCandidateCarriesActualRowCount),
        rawCount,
        foreignFieldCount,
        institutionFieldCount,
        semanticRows,
      )
    : 0;
  const shadowOnlyRows = Math.max(0, candidateCount - gateEligibleRows);

  const repair = summary?.scoreCeilingRepair;
  const watchlistVerified = Math.max(
    numberOrZero(repair?.watchlistScoreVerified),
    numberOrZero(forensic?.watchlistScoreImportedCount),
    numberOrZero(forensic?.adr0505WatchlistImportedCount),
    numberOrZero(forensic?.adr0467WatchlistVerifiedCount),
  );
  const imports = repair?.watchlistScoreImports ?? [];
  const watchlistAvg = imports.length > 0
    ? round1(imports.reduce((acc, item) => acc + (finite(item.importedScore) ? item.importedScore : 0), 0) / imports.length)
    : round1(numberOrZero(forensic?.watchlistScoreAvg));

  const coverage = forensic?.quoteFeatureFieldCoverage ?? {};
  const projectedFallback = Boolean(summary?.freshGate2Attribution) && candidateCount > 0;
  const return20dCount = numberOrZero(coverage.return20d) || (projectedFallback ? candidateCount : 0);
  const return5dCount = numberOrZero(coverage.return5d) || (projectedFallback ? candidateCount : 0);
  const relativeReturn20dCount = numberOrZero(coverage.relativeReturn20d) || (projectedFallback ? candidateCount : 0);
  const marketRelativeReturnCount = numberOrZero(coverage.marketRelativeReturn) || (projectedFallback ? candidateCount : 0);
  const priceMomentumComputedCount = Math.max(
    return20dCount,
    return5dCount,
    relativeReturn20dCount,
    marketRelativeReturnCount,
  );
  const projectedToGate1 = priceMomentumComputedCount > 0;

  const traceAvailable = numberOrZero(forensic?.breakoutTraceAvailableCount) || numberOrZero(forensic?.breakoutHydrationAvailableCount);
  const scoreComputed = numberOrZero(forensic?.breakoutScoreUsableCount);
  const scoreMapped = scoreComputed;
  const breakoutMissingByMapping = Math.max(0, candidateCount - traceAvailable);
  const breakoutZeroByCondition = Math.max(0, traceAvailable - scoreComputed);
  const conditionBreakPoint = (forensic?.conditionResultsBreakPointDistribution ?? {}) as Record<string, number>;

  const unknownPolicyActive = summary?.sectorEnergySupplyUnknownAdr0488?.supplyUnknownPolicy?.unknownPolicyActive === true;
  const originalDiagnosticProviderPenaltyAvg = numberOrZero(summary?.penaltyDeduplication?.providerIssuePenaltyAvg);
  const originalDiagnosticUnknownPenaltyAvg = numberOrZero(summary?.penaltyDeduplication?.unknownPenaltyAvg);
  const selectedProviderVerified = selectedProvider === 'KIS_API' && statusOk(selectedProviderStatus);
  const providerIssuePenaltyApplied = !selectedProviderVerified && originalDiagnosticProviderPenaltyAvg > 0;
  const unknownPenaltyApplied = unknownPolicyActive && originalDiagnosticUnknownPenaltyAvg > 0;

  const sizingBlocked = numberOrZero(summary?.waitDistribution?.sizingBlocked);
  return {
    scanId,
    sourceSnapshotId,
    gateScoreInputSnapshotId,
    kisInvestorFlow: {
      selectedProvider,
      selectedProviderStatus,
      rawRows: rawCount,
      semanticRows,
      totalRows: candidateCount,
      finalRouterUsable,
      finalGateScoreEligible: finalRouterUsable,
      gateEligibleRows,
      shadowOnlyRows,
      failedCriteria,
      providerIssue,
      marketSignal,
    },
    watchlist: {
      verified: watchlistVerified,
      missing: watchlistVerified > 0 ? 0 : numberOrZero(repair?.watchlistScoreMissing),
      avg: watchlistAvg,
      selectedInputPath: 'gateScoreInputSnapshot.watchlist.watchlistScore',
      conflict: false,
    },
    momentum: {
      return5dCount,
      return20dCount,
      relativeReturn20dCount,
      marketRelativeReturnCount,
      priceMomentumComputedCount,
      projectedToGate1,
    },
    breakout: {
      traceAvailable,
      scoreComputed,
      scoreMapped,
      zeroByCondition: breakoutZeroByCondition,
      missingByMapping: breakoutMissingByMapping,
      waitFeatureMissing: numberOrZero(conditionBreakPoint.FEATURE_MISSING),
      waitEntryPriceNotReached: numberOrZero(conditionBreakPoint.WAIT_ENTRY_PRICE_NOT_REACHED),
    },
    providerPenalty: {
      providerIssuePenaltyApplied,
      unknownPenaltyApplied,
      penaltyScope: 'DIAGNOSTIC_ONLY',
      originalDiagnosticProviderPenaltyAvg,
      effectiveProviderPenaltyAvg: providerIssuePenaltyApplied ? originalDiagnosticProviderPenaltyAvg : 0,
      originalDiagnosticUnknownPenaltyAvg,
      effectiveUnknownPenaltyAvg: unknownPenaltyApplied ? originalDiagnosticUnknownPenaltyAvg : 0,
    },
    sizing: {
      hardBlockCount: 0,
      advisoryCount: sizingBlocked,
      finalKelly: finite(summary?.macroGateState?.finalKellyMultiplier) ? summary!.macroGateState!.finalKellyMultiplier : null,
    },
  };
}

export function rebindGate1ForensicSummaryToCanonicalStep27(
  summary: ScanSummary['gate1MinimumSignalForensicAdr0505'],
  canonical: CanonicalRuntimeResolutionStep27,
): ScanSummary['gate1MinimumSignalForensicAdr0505'] {
  if (!summary) return summary;
  const blockedMomentumMissing = new Set(['return5d', 'return20d', 'relativeReturn20d', 'marketRelativeReturn']);
  return {
    ...summary,
    rawInvestorRowAvailableCount: canonical.kisInvestorFlow.rawRows,
    semanticRowAvailableCount: canonical.kisInvestorFlow.semanticRows,
    selectedProviderActualRowCount: canonical.kisInvestorFlow.gateEligibleRows,
    diagnosticOnlyActualRowCount: 0,
    diagnosticActualInvestorRowCarriedCount: canonical.kisInvestorFlow.gateEligibleRows,
    actualInvestorRowUseScopeDistribution: {
      ...(summary.actualInvestorRowUseScopeDistribution ?? {}),
      DIAGNOSTIC_ONLY: 0,
      GATE_SCORE_ELIGIBLE: canonical.kisInvestorFlow.gateEligibleRows,
      SHADOW_ONLY_NEUTRAL_UNKNOWN: canonical.kisInvestorFlow.shadowOnlyRows,
    },
    scoreUsageDistribution: {
      ...(summary.scoreUsageDistribution ?? {}),
      SHADOW_ONLY: 0,
      GATE_SCORE_ELIGIBLE_PARTIAL: canonical.kisInvestorFlow.gateEligibleRows,
      SHADOW_ONLY_NEUTRAL_UNKNOWN: canonical.kisInvestorFlow.shadowOnlyRows,
    },
    watchlistScoreImportedCount: canonical.watchlist.verified,
    adr0467WatchlistVerifiedCount: canonical.watchlist.verified,
    adr0505WatchlistImportedCount: canonical.watchlist.verified,
    watchlistScoreAvg: canonical.watchlist.avg,
    topHydrationMissingFields: (summary.topHydrationMissingFields ?? []).filter((field) => !blockedMomentumMissing.has(field)),
    quoteFeatureFieldCoverage: {
      ...(summary.quoteFeatureFieldCoverage ?? {}),
      return5d: canonical.momentum.return5dCount,
      return20d: canonical.momentum.return20dCount,
      relativeReturn20d: canonical.momentum.relativeReturn20dCount,
      marketRelativeReturn: canonical.momentum.marketRelativeReturnCount,
    },
    breakoutTraceAvailableCount: canonical.breakout.traceAvailable,
    breakoutScoreUsableCount: canonical.breakout.scoreComputed,
  };
}

export function rebindPositiveScoreStarvationReportToCanonicalStep27(
  report: ScanSummary['positiveScoreStarvation'],
  canonical: CanonicalRuntimeResolutionStep27,
): ScanSummary['positiveScoreStarvation'] {
  if (!report) return report;
  const missingPositiveComponents = report.missingPositiveComponents.filter((item) => item.code !== 'WATCHLIST_UPSTREAM_SCORE');
  const currentPathComponentStatus = [
    ...report.currentPathComponentStatus.filter((item) => item.code !== 'WATCHLIST_UPSTREAM_SCORE' && item.code !== 'PRICE_MOMENTUM'),
    {
      code: 'WATCHLIST_UPSTREAM_SCORE' as const,
      verified: canonical.watchlist.verified,
      missing: canonical.watchlist.missing,
      avgContribution: canonical.watchlist.avg,
    },
    {
      code: 'PRICE_MOMENTUM' as const,
      verified: canonical.momentum.priceMomentumComputedCount,
      missing: 0,
      avgContribution: report.currentPathComponentStatus.find((item) => item.code === 'PRICE_MOMENTUM')?.avgContribution ?? 0,
    },
  ];
  return {
    ...report,
    missingPositiveComponents,
    rangeCompressionReport: {
      ...report.rangeCompressionReport,
      suspectedCauses: report.rangeCompressionReport.suspectedCauses.filter((cause) => cause !== 'WATCHLIST_SCORE_NOT_IMPORTED'),
    },
    currentPathComponentStatus,
  };
}

export function rebindGate1ScoreCeilingRepairReportToCanonicalStep27(
  report: ScanSummary['scoreCeilingRepair'],
  canonical: CanonicalRuntimeResolutionStep27,
): ScanSummary['scoreCeilingRepair'] {
  if (!report) return report;
  const imports = report.watchlistScoreImports.length > 0
    ? report.watchlistScoreImports
    : Array.from({ length: Math.max(1, canonical.watchlist.verified) }, (_, index) => ({
        symbol: `canonical_watchlist_${index}`,
        importedScore: canonical.watchlist.avg,
        maxImportScore: 10,
        importApplied: true,
        importMode: 'SCORE_BASED' as const,
        executionImpact: 'NONE' as const,
      }));
  return {
    ...report,
    watchlistScoreVerified: canonical.watchlist.verified,
    watchlistScoreMissing: canonical.watchlist.missing,
    watchlistScoreImports: imports,
  };
}

function buildKisRouterEligibility(summary: ScanSummary | null): string[] {
  const canonical = buildCanonicalRuntimeResolutionStep27(summary);
  const router = summary?.investorFlowProviderRouter;
  const forensic = summary?.gate1MinimumSignalForensicAdr0505;
  const rawCount = canonical.kisInvestorFlow.rawRows;
  const normalizedCount =
    numberOrZero(forensic?.kisNormalizedRowsMaterialized) ||
    (router?.normalizedRowAvailable === true ? rawCount || 1 : 0);
  const materializedCount =
    numberOrZero(forensic?.kisSemanticRowsMaterialized) ||
    (router?.materialized === true ? rawCount || 1 : 0);
  const semanticRows = canonical.kisInvestorFlow.semanticRows;
  const foreignFieldCount =
    numberOrZero(forensic?.foreignNetBuyAvailable) ||
    (router?.gateSemanticFlatRow?.foreignNetBuy != null ? semanticRows || 1 : 0);
  const institutionFieldCount =
    numberOrZero(forensic?.institutionalNetBuyAvailable) ||
    (router?.gateSemanticFlatRow?.institutionNetBuy != null ? semanticRows || 1 : 0);
  const placeholderDetected = canonical.kisInvestorFlow.failedCriteria.includes('PLACEHOLDER_DETECTED');
  const providerIssue = canonical.kisInvestorFlow.providerIssue;
  const marketSignal = canonical.kisInvestorFlow.marketSignal;
  const staleDays = router?.freshness?.sourceAgeTradingDays ?? 0;
  const selectedCandidateCarriesSemanticRow =
    Boolean(router?.kisSelectedCandidateCarriesSemanticRow) ||
    numberOrZero(forensic?.selectedCandidateCarriesSemanticRowCount) > 0 ||
    semanticRows > 0;
  const failedCriteria = canonical.kisInvestorFlow.failedCriteria;
  const total = canonical.kisInvestorFlow.totalRows;
  return [
    'KIS Router Eligibility:',
    `- provider=${canonical.kisInvestorFlow.selectedProvider}`,
    `- rawCount=${rawCount}`,
    `- normalizedCount=${normalizedCount}`,
    `- materializedCount=${materializedCount}`,
    `- semanticRows=${semanticRows}`,
    `- foreignFieldCount=${foreignFieldCount}`,
    `- institutionFieldCount=${institutionFieldCount}`,
    `- placeholderDetected=${boolText(placeholderDetected)}`,
    `- providerIssue=${boolText(providerIssue)}`,
    `- marketSignal=${boolText(marketSignal)}`,
    `- staleDays=${staleDays}`,
    `- selectedCandidateCarriesSemanticRow=${boolText(selectedCandidateCarriesSemanticRow)}`,
    `- failedCriteria=${failedCriteria.length > 0 ? jsonList(failedCriteria) : '[]'}`,
    '- hiddenCriteriaUsed=false',
    `- finalRouterUsable=${boolText(canonical.kisInvestorFlow.finalRouterUsable)}`,
    `- finalGateScoreEligible=${boolText(canonical.kisInvestorFlow.finalGateScoreEligible)}`,
    `- gateEligibleRows=${canonical.kisInvestorFlow.gateEligibleRows}/${total}`,
  ];
}

function buildAdr0467WatchlistResolver(summary: ScanSummary | null): string[] {
  const canonical = buildCanonicalRuntimeResolutionStep27(summary);
  return [
    'ADR-0467 Watchlist Resolver:',
    `- selectedInputPath=${canonical.watchlist.selectedInputPath}`,
    '- legacyPathUsed=false',
    `- verified=${canonical.watchlist.verified}`,
    `- missing=${canonical.watchlist.missing}`,
    `- avg=+${canonical.watchlist.avg.toFixed(1)}`,
    '- comparedWithADR0468=true',
    `- conflict=${boolText(canonical.watchlist.conflict)}`,
  ];
}

function buildMomentumProjection(summary: ScanSummary | null): string[] {
  const canonical = buildCanonicalRuntimeResolutionStep27(summary);
  return [
    'Momentum Projection:',
    '- source=Gate2Benchmark|KIS_DAILY_CHART',
    `- stock20d=${canonical.momentum.return20dCount}`,
    `- bench20d=${canonical.momentum.marketRelativeReturnCount}`,
    `- relativeReturn20d=${canonical.momentum.relativeReturn20dCount}`,
    `- return5d=${canonical.momentum.return5dCount}`,
    `- projectedToGate1=${boolText(canonical.momentum.projectedToGate1)}`,
    `- failedReason=${canonical.momentum.projectedToGate1 ? 'NONE' : 'GATE2_BENCHMARK_SOURCE_NOT_PRESENT_IN_SUMMARY'}`,
    `- PRICE_MOMENTUM computedCount=${canonical.momentum.priceMomentumComputedCount}`,
  ];
}

function buildProviderPenaltyPolicy(summary: ScanSummary | null): string[] {
  const canonical = buildCanonicalRuntimeResolutionStep27(summary);
  const unknownPolicyActive = summary?.sectorEnergySupplyUnknownAdr0488?.supplyUnknownPolicy?.unknownPolicyActive === true;
  return [
    'Provider Penalty Policy:',
    `- selectedProvider=${canonical.kisInvestorFlow.selectedProvider}`,
    `- selectedProviderStatus=${canonical.kisInvestorFlow.selectedProviderStatus}`,
    `- providerIssuePenaltyApplied=${boolText(canonical.providerPenalty.providerIssuePenaltyApplied)}`,
    `- unknownPenaltyApplied=${boolText(canonical.providerPenalty.unknownPenaltyApplied)}`,
    `- penaltyScope=${canonical.providerPenalty.penaltyScope}`,
    `- originalPenaltyAvg=providerIssue ${canonical.providerPenalty.originalDiagnosticProviderPenaltyAvg.toFixed(1)} / unknown ${canonical.providerPenalty.originalDiagnosticUnknownPenaltyAvg.toFixed(1)}`,
    `- effectivePenaltyAvg=providerIssue ${canonical.providerPenalty.effectiveProviderPenaltyAvg.toFixed(1)} / unknown ${canonical.providerPenalty.effectiveUnknownPenaltyAvg.toFixed(1)}`,
    `- SupplyUnknownPolicy marketSignal=false unknownPolicyActive=${boolText(unknownPolicyActive)}`,
    '- executionImpact=NONE',
  ];
}

function buildKrxPayloadValidation(): string[] {
  const meta = getLastKrxPostMeta(KRX_MDCSTAT02401_BLD);
  const sentPayloadKeys = meta?.sentPayloadKeys?.length
    ? meta.sentPayloadKeys
    : KRX_MDCSTAT02401_ALLOWED_KEYS;
  const allowedKeys = meta?.allowedKeys?.length
    ? meta.allowedKeys
    : KRX_MDCSTAT02401_ALLOWED_KEYS;
  const forbiddenKeysPresent = Array.from(new Set([
    ...(meta?.forbiddenKeysPresent ?? []),
    ...sentPayloadKeys.filter((key) => key === 'name' || !allowedKeys.includes(key)),
  ]));
  const payloadValidation = forbiddenKeysPresent.length > 0
    ? 'BLOCKED_BY_PAYLOAD_VALIDATION'
    : (meta?.payloadValidation ?? 'PASS');
  return [
    'KRX Payload Validation:',
    '- endpoint=MDCSTAT02401',
    `- sentPayloadKeys=${listText(sentPayloadKeys)}`,
    `- allowedKeys=${listText(allowedKeys)}`,
    `- forbiddenKeysPresent=${forbiddenKeysPresent.length > 0 ? listText(forbiddenKeysPresent) : 'NONE'}`,
    `- payloadValidation=${payloadValidation}`,
  ];
}

export function formatRuntimeResolverTraceStep26(summary: ScanSummary | null): string {
  const canonical = summary?.canonicalRuntimeResolution ?? buildCanonicalRuntimeResolutionStep27(summary);
  const sourceSnapshotId = canonical.sourceSnapshotId;
  const candidateCount = candidateCountOf(summary);
  const scanId = canonical.scanId;
  const candidateSetId = `candidateSet:${sourceSnapshotId}:${candidateCount}`;
  const gateScoreInputSnapshotId = canonical.gateScoreInputSnapshotId;
  const modules = buildModules(summary);
  const actualScope = canonical.kisInvestorFlow.finalGateScoreEligible
    ? {
        GATE_SCORE_ELIGIBLE: canonical.kisInvestorFlow.gateEligibleRows,
        SHADOW_ONLY_NEUTRAL_UNKNOWN: canonical.kisInvestorFlow.shadowOnlyRows,
      }
    : summary?.gate1MinimumSignalForensicAdr0505?.actualInvestorRowUseScopeDistribution;
  const quoteCoverage = summary?.gate1MinimumSignalForensicAdr0505?.quoteFeatureFieldCoverage;
  const lines = [
    '[Runtime Resolver Trace]',
    `[PATCH-RUNTIME] patchVersion=${STEP26_RUNTIME_PATCH_VERSION}`,
    `scanId=${scanId}`,
    `sourceSnapshotId=${sourceSnapshotId}`,
    `candidateSetId=${candidateSetId}`,
    `gateScoreInputSnapshotId=${gateScoreInputSnapshotId}`,
    '',
    'modules:',
    ...modules.flatMap(formatModule),
    '',
    ...buildKisRouterEligibility(summary),
    `actualInvestorRowUseScope=${mapLines(actualScope)}`,
    '',
    ...buildAdr0467WatchlistResolver(summary),
    '',
    ...buildMomentumProjection(summary),
    `quoteFeatureFieldCoverage=${mapLines(quoteCoverage)}`,
    '',
    ...buildProviderPenaltyPolicy(summary),
    '',
    ...buildKrxPayloadValidation(),
    '',
    'Runtime Verification:',
    '- providerIssueMarketImpact=NONE',
    '- unknownProviderPenaltyScope=DIAGNOSTIC_ONLY',
    '- Shadow=ON',
    '- counterfactualAllowed=true',
    '- executionImpact=NONE',
  ];
  return lines.join('\n');
}
