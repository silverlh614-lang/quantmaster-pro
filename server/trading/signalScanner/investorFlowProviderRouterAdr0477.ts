// @responsibility ADR-0477 Investor Flow Provider Router; semantic net-buy routing dry-run only.
import type { NaverInvestorTrendCollectorResult } from './naverInvestorTrendCollectorAdr0481.js';
import type { SemanticNetBuyNormalizationReportAdr0482, SemanticNetBuyProvider, SemanticNetBuySampleAdr0482, SemanticNetBuyStatus } from './semanticNetBuyNormalizerAdr0482.js';


export type InvestorFlowProviderId =
  | 'KIS'
  | 'KRX'
  | 'NAVER'
  | 'FSS'
  | 'CACHE'
  | 'MANUAL'
  | 'SEMANTIC_NETBUY'
  | 'UNKNOWN'
  | 'NONE';

export type InvestorFlowProviderRoute =
  | 'investor_flow'
  | 'program_trading'
  | 'market_program'
  | 'foreign_trend'
  | 'short_balance'
  | 'credit_balance';

export type InvestorFlowProviderStatus =
  | 'VERIFIED'
  | 'DEGRADED'
  | 'PARTIAL'
  | 'STALE'
  | 'ACCEPTED_EMPTY'
  | 'CACHE_EMPTY'
  | 'NOT_WIRED'
  | 'PROVIDER_MISMATCH'
  | 'DATA_UNAVAILABLE'
  | 'NON_TRADING_DAY'
  | 'ERROR'
  | 'EMPTY'
  | 'PARSE_ERROR'
  | 'PROVIDER_ERROR'
  | 'DISABLED';

export type SemanticSupplySignal =
  | 'BULLISH'
  | 'NEUTRAL'
  | 'BEARISH'
  | 'UNKNOWN';

export interface SupplyProviderCapability {
  provider: InvestorFlowProviderId;
  supportsInvestorFlow: boolean;
  supportsProgramTrading: boolean;
  supportsMarketProgram: boolean;
  supportsForeignTrend: boolean;
  supportsShortBalance: boolean;
  supportsCreditBalance: boolean;
  isSemanticNetBuyProvider: boolean;
  notes: string[];
}

export interface SemanticNetBuySample {
  code: string;
  source: InvestorFlowProviderId;
  sourceDate: string | null;
  collectedAt: string;
  foreignNetBuy: number | null;
  institutionNetBuy: number | null;
  programNetBuy: number | null;
  confidence: 'HIGH' | 'MEDIUM' | 'LOW' | 'NONE';
  status: InvestorFlowProviderStatus;
  signal: SemanticSupplySignal;
  diagnostics: string[];
}

export interface InvestorFlowProviderRouteResult {
  code: string;
  route: 'investor_flow';
  selectedProvider: InvestorFlowProviderId;
  providerTried: InvestorFlowProviderId[];
  providerStatuses: Record<string, InvestorFlowProviderStatus>;
  semanticNetBuy: SemanticNetBuySample | null;
  status: InvestorFlowProviderStatus;
  signal: SemanticSupplySignal;
  coverage: {
    available: number;
    total: number;
    missing: number;
    stale: number;
    acceptedEmpty: number;
    providerMismatch: number;
    notWired: number;
  };
  freshness: {
    cacheState: 'FRESH' | 'STALE' | 'EMPTY' | 'UNKNOWN';
    sourceState: 'FRESH' | 'STALE' | 'MISSING' | 'UNKNOWN';
    sourceAgeTradingDays: number | null;
    oldestSourceAgeTradingDays: number | null;
    lastSourceDate: string | null;
  };
  executionImpact: 'NONE';
  liveExecutionAllowed: false;
  policyPromotionMode: 'SHADOW_ONLY';
  operatorApprovalRequired: true;
  diagnostics: string[];
}

export interface InvestorFlowProviderRouterInput {
  code: string;
  collectedAt?: string;
  naverCollectorWired?: boolean;
  naverRaw?: Record<string, unknown> | null;
  naverCollectorResultAdr0481?: NaverInvestorTrendCollectorResult | null;
  semanticNetBuyNormalizationAdr0482?: SemanticNetBuyNormalizationReportAdr0482 | null;
  cacheRaw?: Record<string, unknown> | null;
  previousTradingDayCacheRaw?: Record<string, unknown> | null;
  kisTriedForInvestorFlow?: boolean;
  nonTradingDay?: boolean;
  sourceAgeTradingDays?: number | null;
  cacheAgeTradingDays?: number | null;
  marketProgramStatus?: InvestorFlowProviderStatus;
  fssSourceAgeTradingDays?: number | null;
}

const ROUTER_POLICY = {
  executionImpact: 'NONE',
  liveExecutionAllowed: false,
  policyPromotionMode: 'SHADOW_ONLY',
  operatorApprovalRequired: true,
} as const;

function finiteNumber(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value);
}

function stringOrNull(value: unknown): string | null {
  return typeof value === 'string' && value.length > 0 ? value : null;
}

function valueFromAliases(raw: Record<string, unknown> | null | undefined, keys: string[]): number | null {
  for (const key of keys) {
    const value = raw?.[key];
    if (finiteNumber(value)) return value;
  }
  return null;
}

function normalizeStatus(input: {
  raw: Record<string, unknown> | null | undefined;
  sourceAgeTradingDays?: number | null;
  fallbackStatus?: InvestorFlowProviderStatus;
}): InvestorFlowProviderStatus {
  if (!input.raw) return input.fallbackStatus ?? 'DATA_UNAVAILABLE';
  const explicit = input.raw.status;
  const allowed: InvestorFlowProviderStatus[] = [
    'VERIFIED',
    'DEGRADED',
    'PARTIAL',
    'STALE',
    'ACCEPTED_EMPTY',
    'CACHE_EMPTY',
    'NOT_WIRED',
    'PROVIDER_MISMATCH',
    'DATA_UNAVAILABLE',
    'NON_TRADING_DAY',
    'ERROR',
    'EMPTY',
    'PARSE_ERROR',
    'PROVIDER_ERROR',
    'DISABLED',
  ];
  if (typeof explicit === 'string' && allowed.includes(explicit as InvestorFlowProviderStatus)) {
    return explicit as InvestorFlowProviderStatus;
  }
  if ((input.sourceAgeTradingDays ?? 0) >= 4) return 'STALE';
  return 'VERIFIED';
}

function confidenceForStatus(
  status: InvestorFlowProviderStatus,
  sourceAgeTradingDays?: number | null,
): SemanticNetBuySample['confidence'] {
  if (status === 'VERIFIED') return sourceAgeTradingDays !== null && sourceAgeTradingDays !== undefined && sourceAgeTradingDays > 1
    ? 'MEDIUM'
    : 'HIGH';
  if (status === 'PARTIAL' || status === 'DEGRADED') return 'MEDIUM';
  if (status === 'STALE') return 'LOW';
  return 'NONE';
}

function deriveSignal(input: {
  foreignNetBuy: number | null;
  institutionNetBuy: number | null;
  confidence: SemanticNetBuySample['confidence'];
  status: InvestorFlowProviderStatus;
}): SemanticSupplySignal {
  if (input.status !== 'VERIFIED' && input.status !== 'PARTIAL') return 'UNKNOWN';
  if (input.confidence !== 'HIGH' && input.confidence !== 'MEDIUM') return 'UNKNOWN';
  if (!finiteNumber(input.foreignNetBuy) || !finiteNumber(input.institutionNetBuy)) return 'UNKNOWN';
  if (input.foreignNetBuy > 0 && input.institutionNetBuy > 0) return 'BULLISH';
  if (input.foreignNetBuy < 0 && input.institutionNetBuy < 0) return 'BEARISH';
  return 'NEUTRAL';
}

export function buildInvestorFlowProviderCapabilities(input: {
  naverCollectorWired?: boolean;
  naverSemanticSampleAvailable?: boolean;
  cacheHasSemanticSample?: boolean;
} = {}): SupplyProviderCapability[] {
  return [
    {
      provider: 'KIS',
      supportsInvestorFlow: false,
      supportsProgramTrading: true,
      supportsMarketProgram: true,
      supportsForeignTrend: false,
      supportsShortBalance: false,
      supportsCreditBalance: false,
      isSemanticNetBuyProvider: false,
      notes: ['KIS is not a semantic investor-flow provider by default.'],
    },
    {
      provider: 'KRX',
      supportsInvestorFlow: true,
      supportsProgramTrading: false,
      supportsMarketProgram: true,
      supportsForeignTrend: false,
      supportsShortBalance: true,
      supportsCreditBalance: true,
      isSemanticNetBuyProvider: true,
      notes: ['KRX can be semantic only when normalized investor-flow rows are present.'],
    },
    {
      provider: 'NAVER',
      supportsInvestorFlow: input.naverCollectorWired !== false,
      supportsProgramTrading: false,
      supportsMarketProgram: false,
      supportsForeignTrend: true,
      supportsShortBalance: true,
      supportsCreditBalance: false,
      isSemanticNetBuyProvider: input.naverCollectorWired !== false && input.naverSemanticSampleAvailable === true,
      notes: input.naverCollectorWired !== false
        ? ['NAVER investor trend collector is wired as ADR-0481 SHADOW_ONLY candidate.', 'policyPromotionMode=SHADOW_ONLY']
        : ['NAVER investor trend collector is NOT_WIRED; this is not bearish.'],
    },
    {
      provider: 'FSS',
      supportsInvestorFlow: false,
      supportsProgramTrading: false,
      supportsMarketProgram: false,
      supportsForeignTrend: false,
      supportsShortBalance: true,
      supportsCreditBalance: true,
      isSemanticNetBuyProvider: false,
      notes: ['FSS is freshness diagnostic for passive/active, short, and credit data.'],
    },
    {
      provider: 'SEMANTIC_NETBUY',
      supportsInvestorFlow: true,
      supportsProgramTrading: false,
      supportsMarketProgram: false,
      supportsForeignTrend: true,
      supportsShortBalance: true,
      supportsCreditBalance: false,
      isSemanticNetBuyProvider: true,
      notes: ['SemanticNetBuy normalizer can route NAVER/KRX/FSS/CACHE normalized samples for SHADOW_ONLY observation.'],
    },
    {
      provider: 'CACHE',
      supportsInvestorFlow: true,
      supportsProgramTrading: false,
      supportsMarketProgram: false,
      supportsForeignTrend: false,
      supportsShortBalance: false,
      supportsCreditBalance: false,
      isSemanticNetBuyProvider: input.cacheHasSemanticSample === true,
      notes: ['CACHE is fallback only and never primary truth.'],
    },
  ];
}

export function normalizeSemanticNetBuySampleAdr0477(
  raw: Record<string, unknown> | null | undefined,
  source: InvestorFlowProviderId,
  opts: {
    code?: string;
    collectedAt?: string;
    sourceAgeTradingDays?: number | null;
    fallbackStatus?: InvestorFlowProviderStatus;
  } = {},
): SemanticNetBuySample {
  const status = normalizeStatus({
    raw,
    sourceAgeTradingDays: opts.sourceAgeTradingDays,
    fallbackStatus: opts.fallbackStatus,
  });
  const foreignNetBuy = valueFromAliases(raw, ['foreignNetBuy', 'investorForeignNetBuy']);
  const institutionNetBuy = valueFromAliases(raw, ['institutionNetBuy', 'investorInstitutionNetBuy']);
  const programNetBuy = valueFromAliases(raw, ['programNetBuy']);
  const confidence = confidenceForStatus(status, opts.sourceAgeTradingDays);
  const signal = deriveSignal({ foreignNetBuy, institutionNetBuy, confidence, status });
  return {
    code: opts.code ?? stringOrNull(raw?.code) ?? 'UNKNOWN',
    source,
    sourceDate: stringOrNull(raw?.sourceDate),
    collectedAt: opts.collectedAt ?? new Date().toISOString(),
    foreignNetBuy,
    institutionNetBuy,
    programNetBuy,
    confidence,
    status,
    signal,
    diagnostics: [
      `source=${source}`,
      `status=${status}`,
      signal === 'UNKNOWN' ? 'UNKNOWN/provider issue is not bearish' : `semantic signal=${signal}`,
    ],
  };
}


function mapSemanticNetBuyStatusAdr0482ToAdr0477(status: SemanticNetBuyStatus): InvestorFlowProviderStatus {
  switch (status) {
    case 'VERIFIED':
      return 'VERIFIED';
    case 'PARTIAL':
      return 'PARTIAL';
    case 'STALE':
      return 'STALE';
    case 'EMPTY':
      return 'EMPTY';
    case 'DATA_UNAVAILABLE':
      return 'DATA_UNAVAILABLE';
    case 'PROVIDER_MISMATCH':
      return 'PROVIDER_MISMATCH';
    case 'PARSE_ERROR':
      return 'PARSE_ERROR';
    case 'PROVIDER_ERROR':
      return 'PROVIDER_ERROR';
    case 'NON_TRADING_DAY':
      return 'NON_TRADING_DAY';
    case 'DISABLED':
      return 'DISABLED';
    default:
      return 'DATA_UNAVAILABLE';
  }
}

function providerFromSemanticAdr0482(provider: SemanticNetBuyProvider): InvestorFlowProviderId {
  if (provider === 'NAVER' || provider === 'KIS' || provider === 'KRX' || provider === 'FSS' || provider === 'CACHE' || provider === 'MANUAL' || provider === 'UNKNOWN') return provider;
  return 'UNKNOWN';
}

function semanticNetBuyDiagnosticCandidate(report: SemanticNetBuyNormalizationReportAdr0482): SemanticNetBuySampleAdr0482 | null {
  return [...report.samples]
    .filter((sample) => (sample.status === 'VERIFIED' || sample.status === 'PARTIAL' || sample.status === 'STALE') && sample.confidence !== 'NONE')
    .sort((a, b) => {
      const confidenceScore = (value: SemanticNetBuySampleAdr0482['confidence']) => value === 'HIGH' ? 4 : value === 'MEDIUM' ? 3 : value === 'LOW' ? 2 : 0;
      const statusScore = (value: SemanticNetBuySampleAdr0482['status']) => value === 'VERIFIED' ? 4 : value === 'PARTIAL' ? 3 : value === 'STALE' ? 1 : 0;
      return (statusScore(b.status) + confidenceScore(b.confidence)) - (statusScore(a.status) + confidenceScore(a.confidence));
    })[0] ?? null;
}

function sampleFromSemanticAdr0482(sample: SemanticNetBuySampleAdr0482): SemanticNetBuySample {
  return {
    code: sample.code,
    source: providerFromSemanticAdr0482(sample.provider),
    sourceDate: sample.sourceDate,
    collectedAt: sample.collectedAt,
    foreignNetBuy: sample.foreignNetBuy,
    institutionNetBuy: sample.institutionNetBuy,
    programNetBuy: sample.programNetBuy,
    confidence: sample.confidence,
    status: mapSemanticNetBuyStatusAdr0482ToAdr0477(sample.status),
    signal: sample.signal,
    diagnostics: sample.diagnostics,
  };
}

function mapNaverAdr0481StatusToAdr0477(status: NaverInvestorTrendCollectorResult['status']): InvestorFlowProviderStatus {
  switch (status) {
    case 'DATA_AVAILABLE':
      return 'VERIFIED';
    case 'WIRED':
      return 'DATA_UNAVAILABLE';
    case 'PARTIAL':
      return 'PARTIAL';
    case 'STALE':
      return 'STALE';
    case 'EMPTY':
      return 'EMPTY';
    case 'PARSE_ERROR':
      return 'PARSE_ERROR';
    case 'PROVIDER_ERROR':
      return 'PROVIDER_ERROR';
    case 'NON_TRADING_DAY':
      return 'NON_TRADING_DAY';
    case 'DISABLED':
    case 'DATA_UNAVAILABLE':
      return 'DATA_UNAVAILABLE';
    default:
      return 'DATA_UNAVAILABLE';
  }
}

function coverageFromStatuses(statuses: Record<string, InvestorFlowProviderStatus>): InvestorFlowProviderRouteResult['coverage'] {
  const values = Object.values(statuses);
  return {
    available: values.filter((status) => status === 'VERIFIED' || status === 'PARTIAL' || status === 'DEGRADED').length,
    total: values.length,
    missing: values.filter((status) => status === 'DATA_UNAVAILABLE' || status === 'NON_TRADING_DAY' || status === 'EMPTY' || status === 'PARSE_ERROR' || status === 'PROVIDER_ERROR' || status === 'DISABLED').length,
    stale: values.filter((status) => status === 'STALE' || status === 'DEGRADED').length,
    acceptedEmpty: values.filter((status) => status === 'ACCEPTED_EMPTY').length,
    providerMismatch: values.filter((status) => status === 'PROVIDER_MISMATCH').length,
    notWired: values.filter((status) => status === 'NOT_WIRED').length,
  };
}

function cacheState(status: InvestorFlowProviderStatus | undefined): InvestorFlowProviderRouteResult['freshness']['cacheState'] {
  if (status === 'VERIFIED' || status === 'PARTIAL') return 'FRESH';
  if (status === 'STALE') return 'STALE';
  if (status === 'CACHE_EMPTY') return 'EMPTY';
  return 'UNKNOWN';
}

function sourceState(age: number | null): InvestorFlowProviderRouteResult['freshness']['sourceState'] {
  if (age === null) return 'UNKNOWN';
  return age >= 4 ? 'STALE' : 'FRESH';
}

export function buildInvestorFlowProviderRouteResultAdr0477(
  input: InvestorFlowProviderRouterInput,
): InvestorFlowProviderRouteResult {
  const collectedAt = input.collectedAt ?? new Date().toISOString();
  const providerTried: InvestorFlowProviderId[] = ['NAVER', 'SEMANTIC_NETBUY', 'CACHE'];
  const providerStatuses: Record<string, InvestorFlowProviderStatus> = {};
  const diagnostics: string[] = [];
  let selectedProvider: InvestorFlowProviderId = 'NONE';
  let semanticNetBuy: SemanticNetBuySample | null = null;
  let routeStatus: InvestorFlowProviderStatus = input.nonTradingDay === true ? 'NON_TRADING_DAY' : 'DATA_UNAVAILABLE';

  if (input.nonTradingDay === true) {
    providerStatuses.KRX = 'NON_TRADING_DAY';
    diagnostics.push('NON_TRADING_DAY is data unavailable, not bearish.');
  }

  if (input.semanticNetBuyNormalizationAdr0482) {
    providerStatuses.SEMANTIC_NETBUY = mapSemanticNetBuyStatusAdr0482ToAdr0477(input.semanticNetBuyNormalizationAdr0482.status);
    for (const sample of input.semanticNetBuyNormalizationAdr0482.samples) {
      providerStatuses[providerFromSemanticAdr0482(sample.provider)] = mapSemanticNetBuyStatusAdr0482ToAdr0477(sample.status);
    }
    const selected = input.semanticNetBuyNormalizationAdr0482.selectedSample ?? semanticNetBuyDiagnosticCandidate(input.semanticNetBuyNormalizationAdr0482);
    if (selected) {
      selectedProvider = 'SEMANTIC_NETBUY';
      semanticNetBuy = sampleFromSemanticAdr0482(selected);
      routeStatus = mapSemanticNetBuyStatusAdr0482ToAdr0477(selected.status);
      diagnostics.push(input.semanticNetBuyNormalizationAdr0482.selectedSample
        ? 'ADR-0482 semantic net-buy selected sample consumed by ADR-0477.'
        : 'ADR-0482 semantic net-buy diagnostic sample consumed for OBSERVE/SHADOW_ONLY only.');
    } else {
      routeStatus = mapSemanticNetBuyStatusAdr0482ToAdr0477(input.semanticNetBuyNormalizationAdr0482.status);
      diagnostics.push(`ADR-0482 semantic net-buy report has no selectable sample; reason=${input.semanticNetBuyNormalizationAdr0482.diagnostics.join('; ') || 'INPUT_SAMPLE_UNAVAILABLE'}. UNKNOWN is not bearish.`);
    }
  } else {
    providerStatuses.SEMANTIC_NETBUY = 'DATA_UNAVAILABLE';
    diagnostics.push('ADR-0482 semantic net-buy normalizer input not supplied; reason=INPUT_SAMPLE_UNAVAILABLE.');
  }

  if (input.naverCollectorWired === true || input.naverCollectorResultAdr0481) {
    const adr0481 = input.naverCollectorResultAdr0481;
    const naverRaw = adr0481?.semanticNetBuyCandidate ? {
      code: input.code,
      sourceDate: adr0481.semanticNetBuyCandidate.sourceDate,
      foreignNetBuy: adr0481.semanticNetBuyCandidate.foreignNetBuy,
      institutionNetBuy: adr0481.semanticNetBuyCandidate.institutionNetBuy,
      programNetBuy: adr0481.semanticNetBuyCandidate.programNetBuy,
      status: adr0481.semanticNetBuyCandidate.status === 'VERIFIED' ? 'VERIFIED' : adr0481.semanticNetBuyCandidate.status,
    } : input.naverRaw;
    const naverSample = normalizeSemanticNetBuySampleAdr0477(naverRaw, 'NAVER', {
      code: input.code,
      collectedAt,
      sourceAgeTradingDays: adr0481?.freshness.sourceAgeTradingDays ?? input.sourceAgeTradingDays,
      fallbackStatus: naverRaw ? undefined : adr0481 ? mapNaverAdr0481StatusToAdr0477(adr0481.status) : 'DATA_UNAVAILABLE',
    });
    providerStatuses.NAVER = adr0481 ? mapNaverAdr0481StatusToAdr0477(adr0481.status) : naverSample.status;
    if (naverSample.status === 'VERIFIED' || naverSample.status === 'PARTIAL') {
      selectedProvider = 'NAVER';
      semanticNetBuy = naverSample;
      routeStatus = naverSample.status;
    } else if (!semanticNetBuy && (naverSample.status === 'STALE' || naverSample.status === 'DEGRADED')) {
      routeStatus = naverSample.status;
      diagnostics.push('NAVER source is stale/degraded; positive source blocked, not bearish.');
    }
  } else {
    providerStatuses.NAVER = 'NOT_WIRED';
    diagnostics.push('NAVER investor trend collector NOT_WIRED; provider issue only.');
  }

  if (!semanticNetBuy) {
    const cacheRaw = input.cacheRaw ?? input.previousTradingDayCacheRaw;
    const cacheSample = normalizeSemanticNetBuySampleAdr0477(cacheRaw, 'CACHE', {
      code: input.code,
      collectedAt,
      sourceAgeTradingDays: input.cacheAgeTradingDays,
      fallbackStatus: cacheRaw ? undefined : 'CACHE_EMPTY',
    });
    providerStatuses.CACHE = cacheSample.status;
    if (cacheSample.status === 'VERIFIED' || cacheSample.status === 'PARTIAL') {
      selectedProvider = 'CACHE';
      semanticNetBuy = cacheSample;
      routeStatus = cacheSample.status;
      diagnostics.push('CACHE fallback used; fallback only, not primary truth.');
    }
  } else {
    providerStatuses.CACHE = input.cacheRaw ? 'PARTIAL' : 'CACHE_EMPTY';
  }

  if (input.kisTriedForInvestorFlow === true) {
    providerTried.push('KIS');
    providerStatuses.KIS = 'PROVIDER_MISMATCH';
    diagnostics.push('KIS skipped/mismatch for semantic investor_flow route.');
  }
  if (input.marketProgramStatus === 'ACCEPTED_EMPTY') {
    providerTried.push('KRX');
    providerStatuses.MARKET_PROGRAM = 'ACCEPTED_EMPTY';
    diagnostics.push('ACCEPTED_EMPTY market/program data excluded from scoring, not bearish.');
  }
  if ((input.fssSourceAgeTradingDays ?? 0) >= 4) {
    providerTried.push('FSS');
    providerStatuses.FSS = 'STALE';
    diagnostics.push(`FSS source stale ${input.fssSourceAgeTradingDays} trading days; diagnostic only.`);
  }

  const signal = semanticNetBuy?.signal ?? 'UNKNOWN';
  if (!semanticNetBuy && providerStatuses.NAVER === 'NOT_WIRED' && providerStatuses.CACHE === 'CACHE_EMPTY') {
    routeStatus = 'DATA_UNAVAILABLE';
  }
  const sourceAge = input.sourceAgeTradingDays ?? input.cacheAgeTradingDays ?? null;
  const oldest = [input.sourceAgeTradingDays, input.cacheAgeTradingDays, input.fssSourceAgeTradingDays]
    .filter((item): item is number => finiteNumber(item))
    .sort((a, b) => b - a)[0] ?? null;
  const status = signal === 'UNKNOWN' && routeStatus === 'VERIFIED' ? 'DEGRADED' : routeStatus;

  return {
    code: input.code,
    route: 'investor_flow',
    selectedProvider,
    providerTried,
    providerStatuses,
    semanticNetBuy,
    status,
    signal,
    coverage: coverageFromStatuses(providerStatuses),
    freshness: {
      cacheState: cacheState(providerStatuses.CACHE),
      sourceState: sourceState(sourceAge),
      sourceAgeTradingDays: sourceAge,
      oldestSourceAgeTradingDays: oldest,
      lastSourceDate: semanticNetBuy?.sourceDate ?? null,
    },
    ...ROUTER_POLICY,
    diagnostics,
  };
}

export function formatInvestorFlowProviderRouterAdr0477(
  result?: InvestorFlowProviderRouteResult | null,
): string | null {
  if (!result) return null;
  const nextAction = result.status === 'DATA_UNAVAILABLE' || result.coverage.notWired > 0
    ? 'WIRE_NAVER_OR_REPAIR_CACHE_KEY / feed SemanticNetBuy normalized input / keep UNKNOWN out of bearish scoring'
    : result.freshness.oldestSourceAgeTradingDays !== null && result.freshness.oldestSourceAgeTradingDays >= 4
      ? 'refresh stale FSS source / keep UNKNOWN out of bearish scoring'
      : 'store ADR-0476 observation row and keep provider issue out of bearish scoring';
  return [
    '🔌 Investor Flow Provider Router (ADR-0477)',
    `- route: ${result.route}`,
    `- selectedProvider: ${result.selectedProvider}`,
    `- status: ${result.status}`,
    `- signal: ${result.signal}`,
    `- coverage: ${result.coverage.available}/${result.coverage.total}`,
    `- freshness: cache=${result.freshness.cacheState}, source=${result.freshness.sourceState}, oldest=${result.freshness.oldestSourceAgeTradingDays ?? 'unknown'} trading days`,
    `- providerTried: ${result.providerTried.join(' -> ') || 'NONE'}`,
    `- rawPayloadPersistenceAllowed: false`,
    `- executionImpact: ${result.executionImpact}`,
    `- liveExecutionAllowed: ${result.liveExecutionAllowed}`,
    '- 수급 악화가 아니라 수급 데이터 라우팅/커버리지 문제입니다.',
    '- UNKNOWN/provider issue는 bearish로 변환되지 않습니다.',
    '- STRONG_BUY는 차단될 수 있지만 Gate fail로 확정하지 않습니다.',
    '- ADR-0476 ledger에 관찰 row를 저장합니다.',
    `- nextAction: ${nextAction}`,
  ].join('\n');
}
