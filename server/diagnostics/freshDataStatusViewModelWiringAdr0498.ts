// @responsibility ADR-0498 FreshDataStatusViewModel display adapter for read-only diagnostics.
import {
  buildFreshDataStatusViewModelAdr0497,
  formatFreshDataStatusCompactAdr0497,
  type DataConfidenceAdr0497,
  type DataLineStatusAdr0497,
  type FreshDataStatusViewModelAdr0497,
  type MarketSignalDirectionAdr0497,
  type PromotionReadinessStatusAdr0497,
  type ProviderHealthStatusAdr0497,
} from './diagnosticTaxonomyAdr0497.js';
import {
  classifyProviderMarketSignalAdr0499,
  normalizeMarketSignalDirectionAdr0499,
  normalizeProviderHealthStatusAdr0499,
} from './providerMarketSignalMigrationAdr0499.js';

export type FreshDataStatusSourceAdr0498 =
  | 'ADR_0487_FRESH_DATA'
  | 'ADR_0488_SECTOR_ENERGY'
  | 'ADR_0489_INVESTOR_FLOW_SAMPLE'
  | 'ADR_0490_PROGRAM_TRADING'
  | 'ADR_0491_SUPPLY_SNAPSHOT'
  | 'ADR_0492_FRESH_DATA_SCHEDULER'
  | 'ADR_0493_PROMOTION_READINESS'
  | 'ADR_0494_PROMOTION_AUDIT'
  | 'ADR_0495_SECTOR_INDEX_MASTER'
  | 'ADR_0496_INVESTOR_FLOW_SEMANTIC'
  | 'UNKNOWN';

export interface FreshDataStatusViewModelInputAdr0498 {
  sourceAdr: FreshDataStatusSourceAdr0498;
  dataLineId: string;
  domain?: FreshDataStatusViewModelAdr0497['domain'];
  providerHealth?: ProviderHealthStatusAdr0497;
  providerDisplay?: string;
  dataConfidence?: DataConfidenceAdr0497;
  marketSignal?: MarketSignalDirectionAdr0497;
  dataLineStatus?: DataLineStatusAdr0497;
  promotionReadiness?: PromotionReadinessStatusAdr0497;
  operatorMessage?: string;
  blockers?: string[];
  warnings?: string[];
  evidence?: Record<string, unknown>;
}

export interface FreshDataStatusSectionAdr0498 {
  lines: string[];
  viewModels: FreshDataStatusViewModelAdr0497[];
  truncated: boolean;
  executionImpact: 'NONE';
}

const PROVIDER_DIAGNOSTIC_WARNING = 'provider issue is diagnostic evidence, not a market signal';
const FORMATTER_ERROR_LINE = '[ADR-0498] FreshDataStatus unavailable: formatter_error impact=NONE';

function providerIsSevere(providerHealth: ProviderHealthStatusAdr0497): boolean {
  return providerHealth === 'DOWN' || providerHealth === 'EMPTY' || providerHealth === 'PARSE_ERROR' || providerHealth === 'RATE_LIMITED';
}

function coerceProviderHealth(value: unknown): ProviderHealthStatusAdr0497 {
  const normalized = normalizeProviderHealthStatusAdr0499(typeof value === 'string' ? value : undefined);
  if (normalized !== 'UNKNOWN') return normalized;
  if (value === 'DATA_AVAILABLE' || value === 'FRESH' || value === 'RECORDED' || value === 'REPLAY_READY' || value === 'DISABLED_BY_KIS_FIRST_MODE') return 'UP';
  if (value === 'FETCH_ERROR') return 'DOWN';
  if (value === 'CACHE_EMPTY' || value === 'REPLAY_UNAVAILABLE') return 'EMPTY';
  if (value === 'CORRUPT_RECOVERED') return 'PARSE_ERROR';
  return 'UNKNOWN';
}

function coerceMarketSignal(value: unknown): MarketSignalDirectionAdr0497 {
  return normalizeMarketSignalDirectionAdr0499(typeof value === 'string' || typeof value === 'number' ? value : undefined);
}

function compactLine(line: string): string {
  return line.length <= 280 ? line : `${line.slice(0, 277)}...`;
}

export function buildFreshDataStatusViewModelFromInputAdr0498(
  input: FreshDataStatusViewModelInputAdr0498,
): FreshDataStatusViewModelAdr0497 {
  try {
    const separation = classifyProviderMarketSignalAdr0499({
      fallbackProviderHealth: input.providerHealth ?? 'UNKNOWN',
      fallbackMarketSignal: input.marketSignal ?? 'UNKNOWN',
    });
    const providerHealth = separation.providerHealth;
    const warnings = [...(input.warnings ?? [])];
    if (separation.providerIssue && !warnings.includes(PROVIDER_DIAGNOSTIC_WARNING)) {
      warnings.push(PROVIDER_DIAGNOSTIC_WARNING);
    }
    return buildFreshDataStatusViewModelAdr0497({
      dataLineId: input.dataLineId || 'UNKNOWN',
      domain: input.domain ?? 'UNKNOWN',
      providerHealth,
      ...(input.providerDisplay === undefined ? {} : { providerDisplay: input.providerDisplay }),
      dataConfidence: input.dataConfidence ?? 'UNKNOWN',
      marketSignal: separation.marketSignal,
      dataLineStatus: input.dataLineStatus ?? 'OBSERVING',
      promotionReadiness: input.promotionReadiness ?? 'NOT_EVALUATED',
      executionImpact: 'NONE',
      operatorMessage: input.operatorMessage ?? `ADR-0498 ${input.sourceAdr} ${input.dataLineId || 'UNKNOWN'} diagnostic-only status`,
      blockers: [...(input.blockers ?? [])],
      warnings,
    });
  } catch {
    return buildFreshDataStatusViewModelAdr0497({
      dataLineId: 'UNKNOWN',
      domain: 'UNKNOWN',
      providerHealth: 'UNKNOWN',
      dataConfidence: 'UNKNOWN',
      marketSignal: 'UNKNOWN',
      dataLineStatus: 'OBSERVING',
      promotionReadiness: 'NOT_EVALUATED',
      executionImpact: 'NONE',
      operatorMessage: 'ADR-0498 malformed input normalized to UNKNOWN diagnostic status',
      warnings: [PROVIDER_DIAGNOSTIC_WARNING],
    });
  }
}

export function mapStatusFromCoverageAdr0498(input: {
  coveragePct?: number | null;
  sampleCount?: number | null;
  providerHealth?: ProviderHealthStatusAdr0497;
}): {
  dataConfidence: DataConfidenceAdr0497;
  dataLineStatus: DataLineStatusAdr0497;
  blockers: string[];
  warnings: string[];
} {
  const blockers: string[] = [];
  const warnings: string[] = [];
  const providerHealth = input.providerHealth;

  if (providerHealth && providerHealth !== 'UP' && providerHealth !== 'UNKNOWN') {
    warnings.push(PROVIDER_DIAGNOSTIC_WARNING);
    if (providerHealth === 'STALE' || providerHealth === 'DELAYED') {
      return { dataConfidence: 'STALE', dataLineStatus: 'OBSERVING', blockers, warnings };
    }
    const dataLineStatus: DataLineStatusAdr0497 = providerIsSevere(providerHealth) ? 'BLOCKED' : 'OBSERVING';
    if (dataLineStatus === 'BLOCKED') blockers.push(`PROVIDER_${providerHealth}`);
    return { dataConfidence: 'MISSING', dataLineStatus, blockers, warnings };
  }

  const coveragePct = input.coveragePct;
  if (coveragePct === null || coveragePct === undefined || !Number.isFinite(coveragePct)) {
    if (input.sampleCount === 0) warnings.push('sampleCount=0 is missing/observing evidence only, not bearish');
    return { dataConfidence: 'UNKNOWN', dataLineStatus: 'OBSERVING', blockers, warnings };
  }
  if (coveragePct >= 80) return { dataConfidence: 'VERIFIED', dataLineStatus: 'READY_FOR_SHADOW', blockers, warnings };
  if (coveragePct >= 30) return { dataConfidence: 'PARTIAL', dataLineStatus: 'PARTIAL', blockers, warnings };
  if (coveragePct > 0) return { dataConfidence: 'PARTIAL', dataLineStatus: 'OBSERVING', blockers, warnings };
  blockers.push('DATA_MISSING');
  if (input.sampleCount === 0) warnings.push('sampleCount=0 is missing/observing evidence only, not bearish');
  return { dataConfidence: 'MISSING', dataLineStatus: 'OBSERVING', blockers, warnings };
}

export function formatFreshDataStatusLineAdr0498(viewModel: FreshDataStatusViewModelAdr0497): string {
  void formatFreshDataStatusCompactAdr0497(viewModel);
  return compactLine(`[ADR-0498] FreshDataStatus ${viewModel.domain}/${viewModel.dataLineId} provider=${viewModel.providerDisplay ?? viewModel.providerHealth} confidence=${viewModel.dataConfidence} signal=${viewModel.marketSignal} status=${viewModel.dataLineStatus} promo=${viewModel.promotionReadiness} impact=${viewModel.executionImpact}`);
}

export function buildFreshDataStatusSectionAdr0498(
  inputs: FreshDataStatusViewModelInputAdr0498[],
  options: { maxLines?: number } = {},
): FreshDataStatusSectionAdr0498 {
  const maxLines = Math.max(0, Math.floor(options.maxLines ?? 6));
  const safeInputs = Array.isArray(inputs) ? inputs : [];
  const viewModels = safeInputs.map((input) => {
    try {
      return buildFreshDataStatusViewModelFromInputAdr0498(input);
    } catch {
      return buildFreshDataStatusViewModelFromInputAdr0498({
        sourceAdr: 'UNKNOWN',
        dataLineId: 'UNKNOWN',
        warnings: ['ADR-0498 per-input formatter_error normalized to UNKNOWN'],
      });
    }
  });
  const formatted = viewModels.map((viewModel) => {
    try {
      return formatFreshDataStatusLineAdr0498(viewModel);
    } catch {
      return FORMATTER_ERROR_LINE;
    }
  });
  const truncated = formatted.length > maxLines;
  const lines = truncated
    ? [
      ...formatted.slice(0, maxLines),
      `[ADR-0498] FreshDataStatus truncated=${formatted.length - maxLines} more; use /fresh_data_status for detail`,
    ]
    : formatted;
  return { lines, viewModels, truncated, executionImpact: 'NONE' };
}

export function safeBuildFreshDataStatusSectionAdr0498(
  inputs: FreshDataStatusViewModelInputAdr0498[],
  options: { maxLines?: number } = {},
): FreshDataStatusSectionAdr0498 {
  try {
    if (!Array.isArray(inputs)) {
      return { lines: [FORMATTER_ERROR_LINE], viewModels: [], truncated: false, executionImpact: 'NONE' };
    }
    return buildFreshDataStatusSectionAdr0498(inputs, options);
  } catch {
    return { lines: [FORMATTER_ERROR_LINE], viewModels: [], truncated: false, executionImpact: 'NONE' };
  }
}


function routerProviderDisplayAdr0498(selectedProvider: string | undefined): string {
  if (selectedProvider === 'CACHE') return 'CACHE';
  if (selectedProvider === 'NAVER' || selectedProvider === 'NAVER_INVESTOR_TREND') return 'NAVER';
  if (selectedProvider === 'SEMANTIC_NETBUY') return 'SEMANTIC_NETBUY';
  if (selectedProvider === 'KRX' || selectedProvider === 'KRX_INVESTOR_FLOW') return 'KRX';
  if (selectedProvider === 'KIS' || selectedProvider === 'KIS_API') return 'KIS';
  if (selectedProvider === 'FSS' || selectedProvider === 'FSS_PASSIVE_ACTIVE') return 'FSS';
  return selectedProvider && selectedProvider !== 'NONE' ? selectedProvider : 'EMPTY';
}

function routerSourceOfTruthAdr0498(selectedProvider: string | undefined): string {
  if (selectedProvider === 'KRX' || selectedProvider === 'KRX_INVESTOR_FLOW') return 'KRX';
  if (selectedProvider === 'KIS' || selectedProvider === 'KIS_API') return 'KIS_API';
  if (selectedProvider === 'FSS' || selectedProvider === 'FSS_PASSIVE_ACTIVE') return 'FSS_OFFICIAL_DIAGNOSTIC';
  if (selectedProvider === 'NAVER' || selectedProvider === 'NAVER_INVESTOR_TREND') return 'NAVER_SECONDARY';
  if (selectedProvider === 'CACHE') return 'CACHE_STALE_FALLBACK';
  if (selectedProvider === 'SEMANTIC_NETBUY') return 'SEMANTIC_DERIVED';
  return 'UNKNOWN';
}

function routerRoleWarningsAdr0498(selectedProvider: string | undefined): string[] {
  return [
    `sourceOfTruth=${routerSourceOfTruthAdr0498(selectedProvider)}`,
    'NAVER role=SECONDARY',
    'SEMANTIC role=DERIVED',
    'CACHE role=STALE_FALLBACK',
  ];
}

function routerProviderHealthAdr0498(status: string | undefined, selectedProvider: string | undefined): ProviderHealthStatusAdr0497 {
  if (!selectedProvider || selectedProvider === 'NONE') return 'EMPTY';
  if (status === 'CACHE_STALE_HIT' || status === 'STALE') return 'STALE';
  if (status === 'CACHE_HIT' || status === 'VERIFIED' || status === 'READY_FOR_SHADOW' || status === 'PARTIAL') return 'UP';
  if (status === 'CACHE_KEY_MISMATCH' || status === 'CACHE_EMPTY' || status === 'DATA_UNAVAILABLE' || status === 'EMPTY') return 'EMPTY';
  if (status === 'PROVIDER_ERROR' || status === 'ERROR') return 'DOWN';
  return coerceProviderHealth(status);
}

function routerFallbackProviderAdr0498(router: {
  providerStatuses?: Record<string, string>;
  coverage?: { available?: number; total?: number };
  diagnosticUsableCount?: number;
  coverageAfter?: number;
}): string | null {
  const statuses = router.providerStatuses ?? {};
  const ranked = ['KIS_API', 'KRX_INVESTOR_FLOW', 'FSS_PASSIVE_ACTIVE', 'CACHE', 'SEMANTIC_NETBUY', 'NAVER_INVESTOR_TREND'];
  const usableStatuses = new Set(['CACHE_HIT', 'CACHE_STALE_HIT', 'VERIFIED', 'READY_FOR_SHADOW', 'OBSERVING', 'PARTIAL', 'STALE', 'DEGRADED']);
  for (const provider of ranked) {
    const status = statuses[provider] ?? (provider === 'KRX_INVESTOR_FLOW' ? statuses.KRX : undefined) ?? (provider === 'KIS_API' ? statuses.KIS : undefined) ?? (provider === 'FSS_PASSIVE_ACTIVE' ? statuses.FSS : undefined);
    if (status && usableStatuses.has(status)) return provider;
  }
  if ((router.diagnosticUsableCount ?? 0) > 0 || (router.coverageAfter ?? 0) > 0 || (router.coverage?.available ?? 0) > 0) return 'CACHE';
  return null;
}

export function mapInvestorFlowRouterToStatusInputAdr0498(router: {
  selectedProvider?: string;
  status?: string;
  signal?: string;
  selectedReason?: string | null;
  providerStatuses?: Record<string, string>;
  coverage?: { available?: number; total?: number };
  diagnosticUsableCount?: number;
  coverageAfter?: number;
  rawPayloadPersistenceAllowed?: false;
  liveExecutionAllowed?: false;
  executionImpact?: 'NONE';
} | null | undefined): FreshDataStatusViewModelInputAdr0498 | null {
  if (!router) return null;
  const rawSelectedProvider = router.selectedProvider ?? 'NONE';
  const fallbackProvider = rawSelectedProvider === 'NONE' ? routerFallbackProviderAdr0498(router) : null;
  const selectedProvider = rawSelectedProvider === 'NONE' && fallbackProvider ? fallbackProvider : rawSelectedProvider;
  const cacheStatus = router.providerStatuses?.CACHE;
  const providerStatus = router.providerStatuses?.[selectedProvider] ?? (selectedProvider === 'KRX_INVESTOR_FLOW' ? router.providerStatuses?.KRX : undefined) ?? (selectedProvider === 'KIS_API' ? router.providerStatuses?.KIS : undefined) ?? (selectedProvider === 'FSS_PASSIVE_ACTIVE' ? router.providerStatuses?.FSS : undefined);
  const effectiveStatus = selectedProvider === 'CACHE' && cacheStatus ? cacheStatus : providerStatus ?? router.status;
  const krxDisabled = router.providerStatuses?.KRX_INVESTOR_FLOW === 'DISABLED_BY_KIS_FIRST_MODE' || router.providerStatuses?.KRX === 'DISABLED_BY_KIS_FIRST_MODE' || router.status === 'DISABLED_BY_KIS_FIRST_MODE';
  if (rawSelectedProvider === 'NONE' && krxDisabled && !fallbackProvider) {
    return {
      sourceAdr: 'ADR_0489_INVESTOR_FLOW_SAMPLE',
      dataLineId: 'investorFlow',
      domain: 'INVESTOR_FLOW',
      providerHealth: 'UP',
      providerDisplay: 'NONE',
      dataConfidence: 'MISSING',
      marketSignal: 'UNKNOWN',
      dataLineStatus: 'OBSERVING',
      promotionReadiness: 'NOT_EVALUATED',
      blockers: [],
      warnings: [
        'KRX_INVESTOR_FLOW status=DISABLED_BY_KIS_FIRST_MODE',
        'providerIssue=false',
        'marketSignal=false',
        'selectedProvider=NONE',
        'reason=KIS-first mode; KRX retained for manual validation only',
      ],
    };
  }
  if (rawSelectedProvider === 'NONE' && !fallbackProvider) {
    return {
      sourceAdr: 'ADR_0489_INVESTOR_FLOW_SAMPLE',
      dataLineId: 'investorFlow',
      domain: 'INVESTOR_FLOW',
      providerHealth: 'EMPTY',
      providerDisplay: 'EMPTY',
      dataConfidence: 'MISSING',
      marketSignal: 'UNKNOWN',
      dataLineStatus: 'BLOCKED',
      promotionReadiness: 'NOT_EVALUATED',
      blockers: ['selectedProvider=NONE'],
      warnings: ['InvestorFlow router selectedProvider=NONE; UNKNOWN is not bearish'],
    };
  }
  const providerHealth = routerProviderHealthAdr0498(effectiveStatus, selectedProvider);
  const stale = effectiveStatus === 'CACHE_STALE_HIT' || router.status === 'STALE' || providerHealth === 'STALE';
  return {
    sourceAdr: 'ADR_0489_INVESTOR_FLOW_SAMPLE',
    dataLineId: 'investorFlow',
    domain: 'INVESTOR_FLOW',
    providerHealth,
    providerDisplay: routerProviderDisplayAdr0498(selectedProvider),
    dataConfidence: stale ? 'STALE' : selectedProvider === 'KRX_INVESTOR_FLOW' || selectedProvider === 'KRX' ? 'VERIFIED' : selectedProvider === 'CACHE' || selectedProvider === 'NAVER_INVESTOR_TREND' || selectedProvider === 'NAVER' || selectedProvider === 'SEMANTIC_NETBUY' ? 'PARTIAL' : 'PARTIAL',
    marketSignal: router.signal === 'BULLISH' || router.signal === 'BEARISH' || router.signal === 'NEUTRAL' ? router.signal : 'UNKNOWN',
    dataLineStatus: stale ? 'OBSERVING' : 'READY_FOR_SHADOW',
    promotionReadiness: 'NOT_EVALUATED',
    warnings: [
      `selectedProvider=${rawSelectedProvider}`,
      ...(fallbackProvider ? [`fallbackProvider=${fallbackProvider}`, 'provider=EMPTY suppressed because diagnostic fallback exists'] : []),
      ...routerRoleWarningsAdr0498(selectedProvider),
      effectiveStatus ? `routerStatus=${effectiveStatus}` : 'routerStatus=UNKNOWN',
      `diagnosticUsableCount=${router.diagnosticUsableCount ?? 0}`,
      'rawPayloadPersistenceAllowed=false',
      'liveExecutionAllowed=false',
      router.selectedReason ?? 'UNKNOWN/provider issue is not bearish',
    ],
  };
}

export function mapFreshDataSupplyReportToStatusInputsAdr0498(report: {
  snapshots?: Array<{ registration?: { id?: string; domain?: string; provider?: string }; sourceId?: string; domain?: string; provider?: string; status?: string; confidence?: string; coverageRatio?: number; isProviderIssue?: boolean; diagnostics?: string[]; sampleMaterialized?: boolean; usableForRouter?: boolean; usableForShadow?: boolean; usableForLive?: false; readinessKind?: string; sourceOfTruth?: string }>;
  domainSummaries?: Array<{ domain?: string; status?: string; averageCoverageRatio?: number; topGaps?: string[] }>;
} | null | undefined): FreshDataStatusViewModelInputAdr0498[] {
  if (!report) return [];
  const fromSnapshots = (report.snapshots ?? []).slice(0, 4).map((snapshot): FreshDataStatusViewModelInputAdr0498 => {
    const sourceId = snapshot.registration?.id ?? snapshot.sourceId ?? 'freshDataSupply';
    const sourceDomain = snapshot.registration?.domain ?? snapshot.domain;
    const sourceProvider = snapshot.registration?.provider ?? snapshot.provider;
    const sampleMaterialized = snapshot.sampleMaterialized === true;
    const usableForRouter = snapshot.usableForRouter === true;
    const readinessKind = snapshot.readinessKind ?? (sampleMaterialized ? 'MATERIALIZED_SAMPLE' : 'REGISTRY_READY');
    const coverage = mapStatusFromCoverageAdr0498({
      coveragePct: typeof snapshot.coverageRatio === 'number' ? snapshot.coverageRatio * 100 : undefined,
      sampleCount: sampleMaterialized ? 1 : 0,
      providerHealth: snapshot.isProviderIssue ? coerceProviderHealth(snapshot.status) : 'UP',
    });
    const dataLineStatus = sampleMaterialized && usableForRouter && coverage.dataLineStatus === 'READY_FOR_SHADOW'
      ? 'READY_FOR_SHADOW'
      : sampleMaterialized && snapshot.status === 'STALE'
        ? 'OBSERVING'
        : 'OBSERVING';
    return {
      sourceAdr: 'ADR_0487_FRESH_DATA',
      dataLineId: sourceId,
      domain: sourceDomain === 'SECTOR_ENERGY' || sourceDomain === 'SUPPLY' ? (sourceDomain === 'SUPPLY' ? 'INVESTOR_FLOW' : 'SECTOR_ENERGY') : 'UNKNOWN',
      providerHealth: snapshot.isProviderIssue ? coerceProviderHealth(snapshot.status) : 'UP',
      dataConfidence: sampleMaterialized && snapshot.confidence === 'HIGH' ? 'VERIFIED' : sampleMaterialized && (snapshot.confidence === 'MEDIUM' || snapshot.confidence === 'LOW') ? 'PARTIAL' : 'MISSING',
      marketSignal: 'UNKNOWN',
      dataLineStatus,
      blockers: coverage.blockers,
      warnings: [
        ...coverage.warnings,
        `sampleMaterialized=${sampleMaterialized}`,
        `usableForRouter=${usableForRouter}`,
        `usableForShadow=${snapshot.usableForShadow === true}`,
        'usableForLive=false',
        `readinessKind=${readinessKind}`,
        `sourceOfTruth=${snapshot.sourceOfTruth ?? 'REGISTRY'}`,
        ...(snapshot.diagnostics ?? []).slice(0, 1),
      ],
      providerDisplay: sourceProvider,
      evidence: { sourceAdr: 'ADR_0487_FRESH_DATA', provider: sourceProvider, sampleMaterialized, usableForRouter, readinessKind, sourceOfTruth: snapshot.sourceOfTruth ?? 'REGISTRY' },
    };
  });
  const fromDomains = fromSnapshots.length > 0 ? [] : (report.domainSummaries ?? []).map((domain): FreshDataStatusViewModelInputAdr0498 => {
    const coverage = mapStatusFromCoverageAdr0498({ coveragePct: typeof domain.averageCoverageRatio === 'number' ? domain.averageCoverageRatio * 100 : undefined });
    return {
      sourceAdr: 'ADR_0487_FRESH_DATA',
      dataLineId: `${domain.domain ?? 'UNKNOWN'}_SUMMARY`,
      domain: domain.domain === 'SECTOR_ENERGY' ? 'SECTOR_ENERGY' : domain.domain === 'SUPPLY' ? 'INVESTOR_FLOW' : 'UNKNOWN',
      providerHealth: coerceProviderHealth(domain.status),
      dataConfidence: coverage.dataConfidence,
      marketSignal: 'UNKNOWN',
      dataLineStatus: coverage.dataLineStatus,
      blockers: [...coverage.blockers, ...(domain.topGaps ?? []).slice(0, 2)],
      warnings: coverage.warnings,
    };
  });
  return [...fromSnapshots, ...fromDomains];
}

export function mapPromotionAuditEvaluationToStatusInputAdr0498(audit: {
  input?: { dataLineId?: string; sourceType?: string };
  result?: { status?: string; blockReasons?: string[]; warnings?: string[] };
}): FreshDataStatusViewModelInputAdr0498 {
  const status = audit.result?.status;
  return {
    sourceAdr: 'ADR_0494_PROMOTION_AUDIT',
    dataLineId: audit.input?.dataLineId ?? 'promotionAudit',
    domain: audit.input?.sourceType === 'SECTOR_ENERGY' ? 'SECTOR_ENERGY' : audit.input?.sourceType === 'PROGRAM_TRADING' ? 'PROGRAM_TRADING' : audit.input?.sourceType === 'SUPPLY_SNAPSHOT' ? 'SNAPSHOT' : 'PROMOTION_AUDIT',
    providerHealth: 'UNKNOWN',
    dataConfidence: status === 'READY' || status === 'PASS' || status === 'WARN' ? 'VERIFIED' : status === 'BLOCKED' || status === 'FAIL' || status === 'INSUFFICIENT_DATA' ? 'MISSING' : 'UNKNOWN',
    marketSignal: 'UNKNOWN',
    dataLineStatus: status === 'READY' || status === 'PASS' || status === 'WARN' ? 'READY_FOR_SHADOW' : status === 'BLOCKED' || status === 'FAIL' || status === 'INSUFFICIENT_DATA' ? 'BLOCKED' : 'OBSERVING',
    promotionReadiness: status === 'READY' || status === 'PASS' || status === 'WARN' ? 'READY' : status === 'BLOCKED' || status === 'FAIL' || status === 'INSUFFICIENT_DATA' ? 'BLOCKED' : 'NOT_EVALUATED',
    blockers: audit.result?.blockReasons ?? [],
    warnings: audit.result?.warnings ?? [],
  };
}

interface SectorIndexMasterFreshStatusReportAdr0498 {
  sectorEnergyMaster?: {
    officialIndexCoverage?: number;
    verifiedIndexCodeCoverage?: number;
    promotionAllowed?: boolean;
    reasonCodes?: string[];
    officialSectorIndexMaster?: {
      masterSource?: string;
      masterLoaded?: boolean;
      masterRowCount?: number;
      idxcodeMstDownloaded?: boolean;
      cacheFallbackUsed?: boolean;
      parseStatus?: string;
      officialIndexCoverage?: number;
      verifiedIndexCodeCoverage?: number;
      mappedSectorCount?: number;
      verifiedIndexCodeCount?: number;
      targetSectorCount?: number;
      verifySuccessCount?: number;
      verifyFailCount?: number;
      selectedFailureReason?: string;
      kisIndexQuoteClientStatus?: {
        enabled?: boolean;
        authReady?: boolean;
        tokenPresent?: boolean;
        disabledReason?: string;
        verifyMode?: string;
      };
      verifyApiFailureSamples?: Array<{ reasonCode?: string; selectedFailureReason?: string }>;
      unresolvedSectorNames?: string[];
      topMissingSectorNames?: string[];
      reasonCodes?: string[];
    };
  };
}

function sectorMasterConfidenceAdr0498(officialCoverage: number, verifiedCoverage: number): DataConfidenceAdr0497 {
  if (verifiedCoverage >= 80) return 'VERIFIED';
  if (officialCoverage > 0 || verifiedCoverage > 0) return 'PARTIAL';
  return 'MISSING';
}

function sectorMasterLineStatusAdr0498(officialCoverage: number, verifiedCoverage: number): DataLineStatusAdr0497 {
  if (verifiedCoverage >= 80) return 'READY_FOR_ADVISORY';
  if (officialCoverage > 0 || verifiedCoverage > 0) return 'READY_FOR_SHADOW';
  return 'OBSERVING';
}

function sectorMasterPromotionReadinessAdr0498(verifiedCoverage: number): PromotionReadinessStatusAdr0497 {
  return verifiedCoverage >= 80 ? 'READY' : verifiedCoverage > 0 ? 'BLOCKED' : 'NOT_EVALUATED';
}

export function mapSectorEnergyOfficialIndexMasterToStatusInputsAdr0498(
  report: SectorIndexMasterFreshStatusReportAdr0498 | null | undefined,
): FreshDataStatusViewModelInputAdr0498[] {
  const master = report?.sectorEnergyMaster?.officialSectorIndexMaster;
  const officialCoverage = Number(master?.officialIndexCoverage ?? report?.sectorEnergyMaster?.officialIndexCoverage ?? 0);
  const verifiedCoverage = Number(master?.verifiedIndexCodeCoverage ?? report?.sectorEnergyMaster?.verifiedIndexCodeCoverage ?? 0);
  const promotionReadiness = sectorMasterPromotionReadinessAdr0498(verifiedCoverage);
  const coverageBlocker = verifiedCoverage >= 80
    ? null
    : officialCoverage > 0
      ? 'BLOCKED_COVERAGE_LOW'
      : 'OFFICIAL_INDEX_COVERAGE_ZERO';
  const commonWarnings = [
    `officialIndexCoverage=${Number.isFinite(officialCoverage) ? officialCoverage : 0}%`,
    `verifiedIndexCodeCoverage=${Number.isFinite(verifiedCoverage) ? verifiedCoverage : 0}%`,
    'signal=UNKNOWN',
    'executionImpact=NONE',
    ...(coverageBlocker ? [coverageBlocker] : []),
    ...(master?.reasonCodes ?? report?.sectorEnergyMaster?.reasonCodes ?? []).slice(0, 3),
  ];
  const commonBlockers = coverageBlocker ? [coverageBlocker] : [];
  const masterIsKis = master?.masterSource === 'OFFICIAL_KIS_IDXCODE_MST' || master?.masterSource === 'CACHE';
  const masterIsKrx = master?.masterSource === 'OFFICIAL_KRX_INDEX_MASTER' || master?.masterSource === 'OFFICIAL_KRX_SECTOR_INDEX_MASTER';
  const providerHealth: ProviderHealthStatusAdr0497 = master?.masterLoaded ? 'UP' : 'EMPTY';
  const confidence = sectorMasterConfidenceAdr0498(officialCoverage, verifiedCoverage);
  const status = sectorMasterLineStatusAdr0498(officialCoverage, verifiedCoverage);
  const verifyClientReason = master?.kisIndexQuoteClientStatus?.enabled === false
    ? 'CLIENT_DISABLED'
    : master?.kisIndexQuoteClientStatus?.authReady === false
      ? 'AUTH_NOT_READY'
      : undefined;
  const verifyReason = verifyClientReason
    ?? master?.selectedFailureReason
    ?? master?.verifyApiFailureSamples?.find((sample) => sample.selectedFailureReason || sample.reasonCode)?.selectedFailureReason
    ?? master?.verifyApiFailureSamples?.find((sample) => sample.reasonCode)?.reasonCode
    ?? (master?.reasonCodes ?? []).find((code) => code.startsWith('KIS_INDEX_API_') || code.startsWith('VERIFY_'))
    ?? (verifiedCoverage >= 80 ? 'VERIFIED' : 'VERIFY_NOT_ATTEMPTED');
  const verifyProviderHealth: ProviderHealthStatusAdr0497 = verifiedCoverage >= 80
    ? 'UP'
    : (master?.verifyFailCount ?? 0) > 0
      ? 'DOWN'
      : 'EMPTY';

  return [
    {
      sourceAdr: 'ADR_0495_SECTOR_INDEX_MASTER',
      dataLineId: 'KRX_SECTOR_INDEX_MASTER',
      domain: 'SECTOR_ENERGY',
      providerHealth: masterIsKrx ? providerHealth : 'EMPTY',
      providerDisplay: 'KRX',
      dataConfidence: masterIsKrx ? confidence : 'MISSING',
      marketSignal: 'UNKNOWN',
      dataLineStatus: masterIsKrx ? status : 'OBSERVING',
      promotionReadiness: masterIsKrx ? promotionReadiness : 'NOT_EVALUATED',
      blockers: masterIsKrx ? commonBlockers : ['KRX_SECTOR_INDEX_MASTER_MISSING'],
      warnings: masterIsKrx ? commonWarnings : ['KRX sector index master not selected', 'executionImpact=NONE'],
    },
    {
      sourceAdr: 'ADR_0495_SECTOR_INDEX_MASTER',
      dataLineId: 'KIS_SECTOR_INDEX_MASTER',
      domain: 'SECTOR_ENERGY',
      providerHealth: masterIsKis ? providerHealth : 'EMPTY',
      providerDisplay: 'KIS',
      dataConfidence: masterIsKis ? confidence : 'MISSING',
      marketSignal: 'UNKNOWN',
      dataLineStatus: masterIsKis ? status : 'OBSERVING',
      promotionReadiness: masterIsKis ? promotionReadiness : 'NOT_EVALUATED',
      blockers: masterIsKis ? commonBlockers : ['KIS_SECTOR_INDEX_MASTER_MISSING'],
      warnings: masterIsKis ? [
        `masterLoaded=${master?.masterLoaded === true}`,
        `masterRowCount=${master?.masterRowCount ?? 0}`,
        `cacheFallbackUsed=${master?.cacheFallbackUsed === true}`,
        `parseStatus=${master?.parseStatus ?? 'UNKNOWN'}`,
        ...commonWarnings,
      ] : ['KIS sector index master not loaded', 'executionImpact=NONE'],
    },
    {
      sourceAdr: 'ADR_0495_SECTOR_INDEX_MASTER',
      dataLineId: 'SECTOR_INDEX_CODE_MAPPING',
      domain: 'SECTOR_ENERGY',
      providerHealth: officialCoverage > 0 ? 'UP' : 'EMPTY',
      providerDisplay: 'INTERNAL',
      dataConfidence: sectorMasterConfidenceAdr0498(officialCoverage, verifiedCoverage),
      marketSignal: 'UNKNOWN',
      dataLineStatus: sectorMasterLineStatusAdr0498(officialCoverage, verifiedCoverage),
      promotionReadiness,
      blockers: commonBlockers,
      warnings: [
        `mappedSectorCount=${master?.mappedSectorCount ?? 0}/${master?.targetSectorCount ?? 0}`,
        `verifiedIndexCodeCount=${master?.verifiedIndexCodeCount ?? 0}/${master?.targetSectorCount ?? 0}`,
        `unresolvedSectorNames=${(master?.unresolvedSectorNames ?? master?.topMissingSectorNames ?? []).slice(0, 4).join('|') || 'NONE'}`,
        ...commonWarnings,
      ],
    },
    {
      sourceAdr: 'ADR_0495_SECTOR_INDEX_MASTER',
      dataLineId: 'KIS_SECTOR_INDEX_VERIFY',
      domain: 'SECTOR_ENERGY',
      providerHealth: verifyProviderHealth,
      providerDisplay: 'KIS',
      dataConfidence: verifiedCoverage >= 80 ? 'VERIFIED' : verifiedCoverage > 0 ? 'PARTIAL' : 'MISSING',
      marketSignal: 'UNKNOWN',
      dataLineStatus: verifiedCoverage >= 80 ? 'READY_FOR_ADVISORY' : officialCoverage > 0 ? 'OBSERVING' : 'OBSERVING',
      promotionReadiness,
      blockers: verifiedCoverage >= 80 ? [] : ['BLOCKED_COVERAGE_LOW'],
      warnings: [
        `reason=${verifyReason}`,
        `enabled=${master?.kisIndexQuoteClientStatus?.enabled === true}`,
        `authReady=${master?.kisIndexQuoteClientStatus?.authReady === true}`,
        `tokenPresent=${master?.kisIndexQuoteClientStatus?.tokenPresent === true}`,
        `verifyMode=${master?.kisIndexQuoteClientStatus?.verifyMode ?? 'OBSERVE'}`,
        `disabledReason=${master?.kisIndexQuoteClientStatus?.disabledReason ?? 'NONE'}`,
        `verifySuccessCount=${master?.verifySuccessCount ?? 0}`,
        `verifyFailCount=${master?.verifyFailCount ?? 0}`,
        `officialIndexCoverage=${Number.isFinite(officialCoverage) ? officialCoverage : 0}%`,
        `verifiedIndexCodeCoverage=${Number.isFinite(verifiedCoverage) ? verifiedCoverage : 0}%`,
        'executionImpact=NONE',
      ],
    },
  ];
}

export function mapRuntimeFreshDataSummaryToStatusInputsAdr0498(summary: Record<string, unknown> | null | undefined): FreshDataStatusViewModelInputAdr0498[] {
  const inputs: FreshDataStatusViewModelInputAdr0498[] = [];
  const routerInput = mapInvestorFlowRouterToStatusInputAdr0498(summary?.investorFlowProviderRouter as Parameters<typeof mapInvestorFlowRouterToStatusInputAdr0498>[0]);
  if (routerInput) inputs.push(routerInput);
  const investorFlow = summary?.investorFlowSampleAdr0489 as { status?: string; adr0496SupplyCoverage?: { coverageAfter?: number; sampleCount?: number } } | undefined;
  if (investorFlow && !routerInput) {
    const providerHealth = coerceProviderHealth(investorFlow.status);
    const coverage = mapStatusFromCoverageAdr0498({ coveragePct: investorFlow.adr0496SupplyCoverage?.coverageAfter, sampleCount: investorFlow.adr0496SupplyCoverage?.sampleCount, providerHealth });
    inputs.push({
      sourceAdr: 'ADR_0489_INVESTOR_FLOW_SAMPLE',
      dataLineId: 'investorFlow',
      domain: 'INVESTOR_FLOW',
      providerHealth,
      providerDisplay: providerHealth === 'EMPTY' ? 'EMPTY' : undefined,
      dataConfidence: coverage.dataConfidence,
      marketSignal: 'UNKNOWN',
      dataLineStatus: coverage.dataLineStatus,
      blockers: coverage.blockers,
      warnings: coverage.warnings,
    });
  }
  const adr0487Inputs = mapFreshDataSupplyReportToStatusInputsAdr0498(summary?.freshDataSupplyAdr0487 as Parameters<typeof mapFreshDataSupplyReportToStatusInputsAdr0498>[0]);
  inputs.push(...adr0487Inputs);
  const sector = summary?.sectorEnergySupplyUnknownAdr0488 as ({ sectorEnergyMaster?: { status?: string; coveragePct?: number; indexCodeCoverageAfter?: number }; supplyUnknownPolicy?: { providerIssue?: boolean; marketSignal?: boolean; providerStatus?: string } } & SectorIndexMasterFreshStatusReportAdr0498) | undefined;
  if (sector) {
    inputs.push(...mapSectorEnergyOfficialIndexMasterToStatusInputsAdr0498(sector));
    const providerHealth = coerceProviderHealth(sector.supplyUnknownPolicy?.providerStatus ?? sector.sectorEnergyMaster?.status);
    const coverage = mapStatusFromCoverageAdr0498({ coveragePct: sector.sectorEnergyMaster?.coveragePct ?? sector.sectorEnergyMaster?.indexCodeCoverageAfter, providerHealth });
    inputs.push({
      sourceAdr: 'ADR_0488_SECTOR_ENERGY',
      dataLineId: 'sectorEnergy',
      domain: 'SECTOR_ENERGY',
      providerHealth,
      providerDisplay: providerHealth === 'EMPTY' ? 'EMPTY' : undefined,
      dataConfidence: coverage.dataConfidence,
      marketSignal: sector.supplyUnknownPolicy?.providerIssue ? 'UNKNOWN' : coerceMarketSignal(sector.supplyUnknownPolicy?.marketSignal ? 'MIXED' : 'UNKNOWN'),
      dataLineStatus: coverage.dataLineStatus,
      blockers: coverage.blockers,
      warnings: coverage.warnings,
    });
  }
  return inputs.length > 0 ? inputs : [{ sourceAdr: 'UNKNOWN', dataLineId: 'freshDataStatus', domain: 'UNKNOWN' }];
}
