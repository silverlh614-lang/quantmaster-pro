// @responsibility ADR-0496 Investor Flow semantic net-buy normalization diagnostics.

export type InvestorFlowProviderAdr0496 =
  | 'NAVER'
  | 'FSS'
  | 'INTERNAL'
  | 'CACHE'
  | 'UNKNOWN';

export type InvestorFlowSampleStatusAdr0496 =
  | 'FRESH'
  | 'PARTIAL'
  | 'STALE'
  | 'MISSING'
  | 'DATA_UNAVAILABLE'
  | 'PROVIDER_ERROR'
  | 'UNKNOWN';

export type InvestorTypeAdr0496 =
  | 'FOREIGN'
  | 'INSTITUTION'
  | 'RETAIL'
  | 'PROGRAM'
  | 'PENSION'
  | 'FINANCIAL_INVESTMENT'
  | 'INSURANCE'
  | 'TRUST'
  | 'PRIVATE_EQUITY'
  | 'BANK'
  | 'OTHER_FINANCE'
  | 'UNKNOWN';

export interface InvestorFlowSanitizedSampleAdr0496 {
  sampleId: string;
  symbol: string | null;
  market: 'KOSPI' | 'KOSDAQ' | 'KRX' | 'UNKNOWN';
  provider: InvestorFlowProviderAdr0496;
  capturedAt: string;
  dataDate: string | null;

  foreignNetBuy: number | null;
  institutionNetBuy: number | null;
  retailNetBuy: number | null;

  confidence: 'VERIFIED' | 'PARTIAL' | 'UNKNOWN';
  status: InvestorFlowSampleStatusAdr0496;

  isProviderIssue: boolean;
  isMarketSignal: false;

  rawPayloadPersistenceAllowed: false;
  liveExecutionAllowed: false;
  executionImpact: 'NONE';

  missingFields: string[];
  warnings: string[];
}

export interface SemanticNetBuyAdr0496 {
  sampleId: string;
  symbol: string | null;
  dataDate: string | null;

  foreignDirection: 'NET_BUY' | 'NET_SELL' | 'NEUTRAL' | 'UNKNOWN';
  institutionDirection: 'NET_BUY' | 'NET_SELL' | 'NEUTRAL' | 'UNKNOWN';
  retailDirection: 'NET_BUY' | 'NET_SELL' | 'NEUTRAL' | 'UNKNOWN';

  foreignAmount: number | null;
  institutionAmount: number | null;
  retailAmount: number | null;

  confluence:
    | 'FOREIGN_INSTITUTION_BOTH_BUY'
    | 'FOREIGN_ONLY_BUY'
    | 'INSTITUTION_ONLY_BUY'
    | 'RETAIL_ONLY_BUY'
    | 'MIXED'
    | 'NO_SIGNAL'
    | 'UNKNOWN';

  normalized: boolean;
  confidence: 'PARTIAL' | 'UNKNOWN';
  diagnosticOnly: true;
  liveExecutionAllowed: false;
  executionImpact: 'NONE';

  nullZeroSeparationPassed: boolean;
  providerIssueIsMarketSignal: false;
}

export interface SupplyCoverageReportAdr0496 {
  status: 'PARTIAL' | 'OBSERVING' | 'DATA_UNAVAILABLE';
  sampleCount: number;
  rawCount?: number;
  rawSampleCount?: number;
  normalizedCount?: number;
  materializedCount?: number;
  routerUsableCount?: number;
  diagnosticUsableCount?: number;
  normalizedSampleCount: number;
  semanticNetBuyCount: number;
  materializedSampleCount: number;
  semanticPlaceholderCount: number;
  routerUsableSampleCount: number;
  diagnosticUsableSampleCount: number;
  registryReadyCount: number;

  coverageBefore: number;
  coverageAfter: number;

  nullCount: number;
  zeroCount: number;
  missingCount: number;
  staleCount: number;
  providerErrorCount: number;

  providerIssueCount: number;
  marketSignalCount: 0;

  normalized: boolean;
  confidence: 'PARTIAL' | 'UNKNOWN';

  topGaps: string[];
  recommendedNextActions: string[];

  liveExecutionAllowed: false;
  executionImpact: 'NONE';
}

export interface BuildInvestorFlowSanitizedSampleInputAdr0496 {
  sampleId?: string;
  symbol?: string | null;
  market?: 'KOSPI' | 'KOSDAQ' | 'KRX' | 'UNKNOWN' | string | null;
  provider?: InvestorFlowProviderAdr0496 | string | null;
  capturedAt?: string;
  dataDate?: string | null;
  foreignNetBuy?: unknown;
  institutionNetBuy?: unknown;
  retailNetBuy?: unknown;
  status?: InvestorFlowSampleStatusAdr0496 | string | null;
  providerError?: boolean;
  warnings?: readonly string[];
}

export interface BuildSupplyCoverageReportInputAdr0496 {
  samples?: readonly InvestorFlowSanitizedSampleAdr0496[];
  semanticSamples?: readonly SemanticNetBuyAdr0496[];
  coverageBefore?: number | null;
}

const POLICY = {
  rawPayloadPersistenceAllowed: false as const,
  liveExecutionAllowed: false as const,
  executionImpact: 'NONE' as const,
};

const REQUIRED_AMOUNT_FIELDS = ['foreignNetBuy', 'institutionNetBuy', 'retailNetBuy'] as const;

type RequiredAmountFieldAdr0496 = typeof REQUIRED_AMOUNT_FIELDS[number];

function hasOwn(input: object, key: string): boolean {
  return Object.prototype.hasOwnProperty.call(input, key);
}

function finiteOrNull(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

function normalizeProvider(value: unknown): InvestorFlowProviderAdr0496 {
  if (value === 'NAVER' || value === 'FSS' || value === 'INTERNAL' || value === 'CACHE') return value;
  return 'UNKNOWN';
}

function normalizeMarket(value: unknown): InvestorFlowSanitizedSampleAdr0496['market'] {
  if (value === 'KOSPI' || value === 'KOSDAQ' || value === 'KRX') return value;
  return 'UNKNOWN';
}

function normalizeStatus(value: unknown, hasAnyAmount: boolean, missingCount: number, providerError: boolean): InvestorFlowSampleStatusAdr0496 {
  if (providerError) return 'PROVIDER_ERROR';
  if (value === 'FRESH' || value === 'PARTIAL' || value === 'STALE' || value === 'MISSING' || value === 'DATA_UNAVAILABLE' || value === 'UNKNOWN') return value;
  if (!hasAnyAmount && missingCount === REQUIRED_AMOUNT_FIELDS.length) return 'MISSING';
  if (!hasAnyAmount) return 'DATA_UNAVAILABLE';
  return missingCount > 0 ? 'PARTIAL' : 'FRESH';
}

function countKnownAmounts(sample: InvestorFlowSanitizedSampleAdr0496): number {
  return [sample.foreignNetBuy, sample.institutionNetBuy, sample.retailNetBuy].filter((value) => value !== null).length;
}

function clampCoverage(value: unknown): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) return 0;
  const ratio = value > 1 ? value / 100 : value;
  return Math.max(0, Math.min(1, Math.round(ratio * 1000) / 1000));
}

export function buildInvestorFlowSanitizedSampleAdr0496(
  input: BuildInvestorFlowSanitizedSampleInputAdr0496 = {},
): InvestorFlowSanitizedSampleAdr0496 {
  const missingFields = REQUIRED_AMOUNT_FIELDS.filter((field) => !hasOwn(input, field));
  const amounts: Record<RequiredAmountFieldAdr0496, number | null> = {
    foreignNetBuy: finiteOrNull(input.foreignNetBuy),
    institutionNetBuy: finiteOrNull(input.institutionNetBuy),
    retailNetBuy: finiteOrNull(input.retailNetBuy),
  };
  const hasAnyAmount = Object.values(amounts).some((value) => value !== null);
  const providerError = input.providerError === true || input.status === 'PROVIDER_ERROR';
  const status = normalizeStatus(input.status, hasAnyAmount, missingFields.length, providerError);
  const isProviderIssue = providerError || status === 'DATA_UNAVAILABLE' || status === 'MISSING';
  const capturedAt = input.capturedAt ?? new Date().toISOString();
  const confidence: InvestorFlowSanitizedSampleAdr0496['confidence'] =
    status === 'FRESH' && missingFields.length === 0 ? 'VERIFIED' : hasAnyAmount ? 'PARTIAL' : 'UNKNOWN';
  return {
    sampleId: input.sampleId ?? `adr0496-${capturedAt.replace(/[^A-Za-z0-9]/g, '').slice(0, 20)}`,
    symbol: typeof input.symbol === 'string' && input.symbol.length > 0 ? input.symbol : null,
    market: normalizeMarket(input.market),
    provider: normalizeProvider(input.provider),
    capturedAt,
    dataDate: typeof input.dataDate === 'string' && input.dataDate.length > 0 ? input.dataDate : null,
    foreignNetBuy: amounts.foreignNetBuy,
    institutionNetBuy: amounts.institutionNetBuy,
    retailNetBuy: amounts.retailNetBuy,
    confidence,
    status,
    isProviderIssue,
    isMarketSignal: false,
    ...POLICY,
    missingFields,
    warnings: [
      ...(input.warnings ?? []),
      'ADR-0496 sanitized sample excludes raw provider payload and is diagnostic-only.',
      'UNKNOWN/provider issue is not a bearish market signal; null is not coerced to zero.',
    ],
  };
}

function direction(amount: number | null | undefined): SemanticNetBuyAdr0496['foreignDirection'] {
  if (amount === null || amount === undefined) return 'UNKNOWN';
  if (amount > 0) return 'NET_BUY';
  if (amount < 0) return 'NET_SELL';
  return 'NEUTRAL';
}

function confluence(input: {
  foreignDirection: SemanticNetBuyAdr0496['foreignDirection'];
  institutionDirection: SemanticNetBuyAdr0496['institutionDirection'];
  retailDirection: SemanticNetBuyAdr0496['retailDirection'];
}): SemanticNetBuyAdr0496['confluence'] {
  const directions = [input.foreignDirection, input.institutionDirection, input.retailDirection];
  if (directions.every((item) => item === 'UNKNOWN')) return 'UNKNOWN';
  if (input.foreignDirection === 'NET_BUY' && input.institutionDirection === 'NET_BUY') return 'FOREIGN_INSTITUTION_BOTH_BUY';
  const hasBuy = directions.includes('NET_BUY');
  const hasSell = directions.includes('NET_SELL');
  if (hasBuy && hasSell) return 'MIXED';
  if (input.foreignDirection === 'NET_BUY') return 'FOREIGN_ONLY_BUY';
  if (input.institutionDirection === 'NET_BUY') return 'INSTITUTION_ONLY_BUY';
  if (input.retailDirection === 'NET_BUY') return 'RETAIL_ONLY_BUY';
  if (hasSell) return 'MIXED';
  return 'NO_SIGNAL';
}

export function normalizeSemanticNetBuyAdr0496(sample: InvestorFlowSanitizedSampleAdr0496): SemanticNetBuyAdr0496 {
  const foreignDirection = direction(sample.foreignNetBuy);
  const institutionDirection = direction(sample.institutionNetBuy);
  const retailDirection = direction(sample.retailNetBuy);
  const nullZeroSeparationPassed = [sample.foreignNetBuy, sample.institutionNetBuy, sample.retailNetBuy]
    .every((value) => value === null || (typeof value === 'number' && Number.isFinite(value)));
  return {
    sampleId: sample.sampleId,
    symbol: sample.symbol,
    dataDate: sample.dataDate,
    foreignDirection,
    institutionDirection,
    retailDirection,
    foreignAmount: sample.foreignNetBuy,
    institutionAmount: sample.institutionNetBuy,
    retailAmount: sample.retailNetBuy,
    confluence: confluence({ foreignDirection, institutionDirection, retailDirection }),
    normalized: true,
    confidence: countKnownAmounts(sample) > 0 ? 'PARTIAL' : 'UNKNOWN',
    diagnosticOnly: true,
    liveExecutionAllowed: false,
    executionImpact: 'NONE',
    nullZeroSeparationPassed,
    providerIssueIsMarketSignal: false,
  };
}

export function buildSupplyCoverageReportAdr0496(
  input: BuildSupplyCoverageReportInputAdr0496 = {},
): SupplyCoverageReportAdr0496 {
  const samples = [...(input.samples ?? [])];
  const semanticSamples = [...(input.semanticSamples ?? [])];
  const sampleCount = samples.length;
  const materializedSampleCount = samples.filter((sample) => countKnownAmounts(sample) > 0 && sample.status !== 'PROVIDER_ERROR' && sample.status !== 'DATA_UNAVAILABLE' && sample.status !== 'MISSING').length;
  const semanticNetBuyCount = semanticSamples.filter((sample) => sample.normalized).length;
  const semanticPlaceholderCount = semanticSamples.filter((sample) => !sample.normalized).length;
  const normalizedSampleCount = Math.max(materializedSampleCount, semanticNetBuyCount);
  const routerUsableSampleCount = samples.filter((sample) => countKnownAmounts(sample) > 0 && (sample.status === 'FRESH' || sample.status === 'PARTIAL')).length;
  const diagnosticUsableSampleCount = samples.filter((sample) => countKnownAmounts(sample) > 0 && (sample.status === 'FRESH' || sample.status === 'PARTIAL' || sample.status === 'STALE')).length + semanticNetBuyCount;
  const registryReadyCount = Math.max(0, sampleCount - materializedSampleCount);
  const nullCount = samples.reduce((sum, sample) => sum + [sample.foreignNetBuy, sample.institutionNetBuy, sample.retailNetBuy].filter((value) => value === null).length, 0);
  const zeroCount = samples.reduce((sum, sample) => sum + [sample.foreignNetBuy, sample.institutionNetBuy, sample.retailNetBuy].filter((value) => value === 0).length, 0);
  const missingCount = samples.reduce((sum, sample) => sum + sample.missingFields.length, 0);
  const staleCount = samples.filter((sample) => sample.status === 'STALE').length;
  const providerErrorCount = samples.filter((sample) => sample.status === 'PROVIDER_ERROR').length;
  const providerIssueCount = samples.filter((sample) => sample.isProviderIssue).length;
  const coverageBefore = clampCoverage(input.coverageBefore ?? 0);
  const coverageAfter = sampleCount > 0 ? clampCoverage(Math.max(normalizedSampleCount, semanticNetBuyCount) / sampleCount) : 0;
  const topGaps = [
    ...(sampleCount === 0 ? ['COLLECT_NAVER_INVESTOR_SAMPLE'] : []),
    ...(semanticNetBuyCount === 0 ? ['BUILD_SEMANTIC_NETBUY_SAMPLE'] : []),
    ...(providerErrorCount > 0 ? ['RESOLVE_INVESTOR_FLOW_PROVIDER_ERROR'] : []),
    ...(missingCount > 0 ? ['COMPLETE_INVESTOR_FLOW_FIELDS'] : []),
    ...(staleCount > 0 ? ['REFRESH_FSS_PASSIVE_ACTIVE'] : []),
  ];
  return {
    status: sampleCount === 0 ? 'DATA_UNAVAILABLE' : semanticNetBuyCount > 0 || normalizedSampleCount > 0 ? 'PARTIAL' : 'OBSERVING',
    sampleCount,
    rawCount: sampleCount,
    rawSampleCount: sampleCount,
    normalizedCount: normalizedSampleCount,
    materializedCount: materializedSampleCount,
    routerUsableCount: routerUsableSampleCount,
    diagnosticUsableCount: diagnosticUsableSampleCount,
    normalizedSampleCount,
    semanticNetBuyCount,
    materializedSampleCount,
    semanticPlaceholderCount,
    routerUsableSampleCount,
    diagnosticUsableSampleCount,
    registryReadyCount,
    coverageBefore,
    coverageAfter,
    nullCount,
    zeroCount,
    missingCount,
    staleCount,
    providerErrorCount,
    providerIssueCount,
    marketSignalCount: 0,
    normalized: semanticNetBuyCount > 0,
    confidence: semanticNetBuyCount > 0 || normalizedSampleCount > 0 ? 'PARTIAL' : 'UNKNOWN',
    topGaps,
    recommendedNextActions: topGaps.length > 0
      ? topGaps.map((gap) => `ADR-0496 diagnostic action: ${gap}; keep live execution unchanged.`)
      : ['Continue SHADOW_ONLY investor-flow observation; do not promote without ADR-0493/0494 audit history.'],
    liveExecutionAllowed: false,
    executionImpact: 'NONE',
  };
}

export function formatSupplyCoverageSummaryAdr0496(report: SupplyCoverageReportAdr0496 | null | undefined): string {
  if (!report) return 'ADR-0496 SupplyCoverage: unavailable';
  return [
    `ADR-0496 SupplyCoverage status=${report.status}`,
    `supplyCoverageBefore=${report.coverageBefore}`,
    `supplyCoverageAfter=${report.coverageAfter}`,
    `sampleCount=${report.sampleCount}`,
    `rawCount=${report.rawCount ?? report.sampleCount}`,
    `normalizedCount=${report.normalizedCount ?? report.normalizedSampleCount}`,
    `materializedCount=${report.materializedCount ?? report.materializedSampleCount}`,
    `routerUsableCount=${report.routerUsableCount ?? report.routerUsableSampleCount}`,
    `diagnosticUsableCount=${report.diagnosticUsableCount ?? report.diagnosticUsableSampleCount}`,
    `normalizedSampleCount=${report.normalizedSampleCount}`,
    `semanticNetBuyCount=${report.semanticNetBuyCount}`,
    `materializedSampleCount=${report.materializedSampleCount}`,
    `semanticPlaceholderCount=${report.semanticPlaceholderCount}`,
    `routerUsableSampleCount=${report.routerUsableSampleCount}`,
    `diagnosticUsableSampleCount=${report.diagnosticUsableSampleCount}`,
    `registryReadyCount=${report.registryReadyCount}`,
    `nullCount=${report.nullCount}`,
    `zeroCount=${report.zeroCount}`,
    `missingCount=${report.missingCount}`,
    `providerIssueCount=${report.providerIssueCount}`,
    `marketSignalCount=${report.marketSignalCount}`,
    'guardrails=executionImpact NONE; liveExecutionAllowed false; rawPayloadPersistenceAllowed false; providerIssue marketSignal false; UNKNOWN remains UNKNOWN; NET_SELL diagnostic only; trade controls unchanged',
  ].join(' | ');
}
