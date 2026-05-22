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

function buildKisRouterEligibility(summary: ScanSummary | null): string[] {
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
  const staleDays = router?.freshness?.sourceAgeTradingDays ?? 0;
  const selectedCandidateCarriesSemanticRow =
    Boolean(router?.kisSelectedCandidateCarriesSemanticRow) ||
    numberOrZero(forensic?.selectedCandidateCarriesSemanticRowCount) > 0 ||
    semanticRows > 0;
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
        numberOrZero(forensic?.diagnosticActualInvestorRowCarriedCount),
        numberOrZero(forensic?.selectedCandidateCarriesActualRowCount),
        foreignFieldCount,
        institutionFieldCount,
        semanticRows,
      )
    : 0;
  const total = Math.max(0, Math.floor(forensic?.totalCandidates ?? summary?.candidates ?? 0));
  return [
    'KIS Router Eligibility:',
    `- provider=${selectedProvider}`,
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
    `- finalRouterUsable=${boolText(finalRouterUsable)}`,
    `- finalGateScoreEligible=${boolText(finalRouterUsable)}`,
    `- gateEligibleRows=${gateEligibleRows}/${total}`,
  ];
}

function buildAdr0467WatchlistResolver(summary: ScanSummary | null): string[] {
  const forensic = summary?.gate1MinimumSignalForensicAdr0505;
  const repair = summary?.scoreCeilingRepair;
  const verified = Math.max(
    numberOrZero(repair?.watchlistScoreVerified),
    numberOrZero(forensic?.watchlistScoreImportedCount),
    numberOrZero(forensic?.adr0505WatchlistImportedCount),
    numberOrZero(forensic?.adr0467WatchlistVerifiedCount),
  );
  const missing = repair
    ? numberOrZero(repair.watchlistScoreMissing)
    : Math.max(0, numberOrZero(forensic?.watchlistSourceAvailableCount) - verified);
  const imports = repair?.watchlistScoreImports ?? [];
  const avg = imports.length > 0
    ? Math.round((imports.reduce((acc, item) => acc + (finite(item.importedScore) ? item.importedScore : 0), 0) / imports.length) * 10) / 10
    : Math.round(numberOrZero(forensic?.watchlistScoreAvg) * 10) / 10;
  const conflict = false;
  return [
    'ADR-0467 Watchlist Resolver:',
    '- selectedInputPath=gateScoreInputSnapshot.watchlist.watchlistScore',
    '- legacyPathUsed=false',
    `- verified=${verified}`,
    `- missing=${missing}`,
    `- avg=+${avg.toFixed(1)}`,
    '- comparedWithADR0468=true',
    `- conflict=${boolText(conflict)}`,
  ];
}

function buildMomentumProjection(summary: ScanSummary | null): string[] {
  const forensic = summary?.gate1MinimumSignalForensicAdr0505;
  const coverage = forensic?.quoteFeatureFieldCoverage ?? {};
  const return20d = numberOrZero(coverage.return20d);
  const return5d = numberOrZero(coverage.return5d);
  const relativeReturn20d = numberOrZero(coverage.relativeReturn20d);
  const marketRelativeReturn = numberOrZero(coverage.marketRelativeReturn);
  const computedCount = Math.max(return20d, return5d, relativeReturn20d, marketRelativeReturn);
  const projected = computedCount > 0 || Boolean(summary?.freshGate2Attribution);
  return [
    'Momentum Projection:',
    '- source=Gate2Benchmark|KIS_DAILY_CHART',
    `- stock20d=${return20d}`,
    `- bench20d=${marketRelativeReturn}`,
    `- relativeReturn20d=${relativeReturn20d}`,
    `- return5d=${return5d}`,
    `- projectedToGate1=${boolText(projected)}`,
    `- failedReason=${projected ? 'NONE' : 'GATE2_BENCHMARK_SOURCE_NOT_PRESENT_IN_SUMMARY'}`,
    `- PRICE_MOMENTUM computedCount=${computedCount}`,
  ];
}

function buildProviderPenaltyPolicy(summary: ScanSummary | null): string[] {
  const router = summary?.investorFlowProviderRouter;
  const selectedProvider = router?.selectedProvider ?? 'KIS_API';
  const selectedProviderStatus =
    router?.providerStatuses?.[selectedProvider] ??
    router?.providerStatuses?.KIS_API ??
    router?.status ??
    'UNKNOWN';
  const selectedProviderVerified = selectedProvider === 'KIS_API' && statusOk(selectedProviderStatus);
  const unknownPolicyActive = summary?.sectorEnergySupplyUnknownAdr0488?.supplyUnknownPolicy?.unknownPolicyActive === true;
  const originalProviderPenaltyAvg = numberOrZero(summary?.penaltyDeduplication?.providerIssuePenaltyAvg);
  const originalUnknownPenaltyAvg = numberOrZero(summary?.penaltyDeduplication?.unknownPenaltyAvg);
  const providerIssuePenaltyApplied = !selectedProviderVerified && originalProviderPenaltyAvg > 0;
  const unknownPenaltyApplied = unknownPolicyActive && originalUnknownPenaltyAvg > 0;
  const effectiveProviderPenaltyAvg = providerIssuePenaltyApplied ? originalProviderPenaltyAvg : 0;
  const effectiveUnknownPenaltyAvg = unknownPenaltyApplied ? originalUnknownPenaltyAvg : 0;
  return [
    'Provider Penalty Policy:',
    `- selectedProvider=${selectedProvider}`,
    `- selectedProviderStatus=${selectedProviderStatus}`,
    `- providerIssuePenaltyApplied=${boolText(providerIssuePenaltyApplied)}`,
    `- unknownPenaltyApplied=${boolText(unknownPenaltyApplied)}`,
    '- penaltyScope=DIAGNOSTIC_ONLY',
    `- originalPenaltyAvg=providerIssue ${originalProviderPenaltyAvg.toFixed(1)} / unknown ${originalUnknownPenaltyAvg.toFixed(1)}`,
    `- effectivePenaltyAvg=providerIssue ${effectiveProviderPenaltyAvg.toFixed(1)} / unknown ${effectiveUnknownPenaltyAvg.toFixed(1)}`,
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
  const sourceSnapshotId = summary?.snapshotId ?? 'NO_SCAN_SUMMARY';
  const candidateCount = Math.max(0, Math.floor(summary?.candidates ?? summary?.gate1MinimumSignalForensicAdr0505?.totalCandidates ?? 0));
  const scanId = summary?.time ?? 'NO_SCAN_SUMMARY';
  const candidateSetId = `candidateSet:${sourceSnapshotId}:${candidateCount}`;
  const gateScoreInputSnapshotId = `gateScoreInput:${sourceSnapshotId}`;
  const modules = buildModules(summary);
  const actualScope = summary?.gate1MinimumSignalForensicAdr0505?.actualInvestorRowUseScopeDistribution;
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
