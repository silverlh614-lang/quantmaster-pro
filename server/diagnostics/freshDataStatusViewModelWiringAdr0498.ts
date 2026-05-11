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
  if (value === 'DATA_AVAILABLE' || value === 'FRESH' || value === 'RECORDED' || value === 'REPLAY_READY') return 'UP';
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

function routerProviderHealthAdr0498(status: string | undefined, selectedProvider: string | undefined): ProviderHealthStatusAdr0497 {
  if (!selectedProvider || selectedProvider === 'NONE') return 'EMPTY';
  if (status === 'CACHE_STALE_HIT' || status === 'STALE') return 'STALE';
  if (status === 'CACHE_HIT' || status === 'VERIFIED' || status === 'READY_FOR_SHADOW' || status === 'PARTIAL') return 'UP';
  if (status === 'CACHE_KEY_MISMATCH' || status === 'CACHE_EMPTY' || status === 'DATA_UNAVAILABLE' || status === 'EMPTY') return 'EMPTY';
  if (status === 'PROVIDER_ERROR' || status === 'ERROR') return 'DOWN';
  return coerceProviderHealth(status);
}

export function mapInvestorFlowRouterToStatusInputAdr0498(router: {
  selectedProvider?: string;
  status?: string;
  signal?: string;
  selectedReason?: string | null;
  providerStatuses?: Record<string, string>;
  coverage?: { available?: number; total?: number };
  rawPayloadPersistenceAllowed?: false;
  liveExecutionAllowed?: false;
  executionImpact?: 'NONE';
} | null | undefined): FreshDataStatusViewModelInputAdr0498 | null {
  if (!router) return null;
  const selectedProvider = router.selectedProvider ?? 'NONE';
  const cacheStatus = router.providerStatuses?.CACHE;
  const effectiveStatus = selectedProvider === 'CACHE' && cacheStatus ? cacheStatus : router.status;
  if (selectedProvider === 'NONE') {
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
    dataConfidence: stale ? 'STALE' : selectedProvider === 'CACHE' ? 'PARTIAL' : 'PARTIAL',
    marketSignal: router.signal === 'BULLISH' || router.signal === 'BEARISH' || router.signal === 'NEUTRAL' ? router.signal : 'UNKNOWN',
    dataLineStatus: stale ? 'OBSERVING' : 'READY_FOR_SHADOW',
    promotionReadiness: 'NOT_EVALUATED',
    warnings: [
      `selectedProvider=${selectedProvider}`,
      effectiveStatus ? `routerStatus=${effectiveStatus}` : 'routerStatus=UNKNOWN',
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
  const sector = summary?.sectorEnergySupplyUnknownAdr0488 as { sectorEnergyMaster?: { status?: string; coveragePct?: number; indexCodeCoverageAfter?: number }; supplyUnknownPolicy?: { providerIssue?: boolean; marketSignal?: boolean; providerStatus?: string } } | undefined;
  if (sector) {
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
