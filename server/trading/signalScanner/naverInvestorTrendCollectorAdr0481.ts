// @responsibility ADR-0481 NAVER Investor Trend Collector Wiring; SHADOW_ONLY semantic investor-flow candidate.
import { normalizeSemanticNetBuySampleAdr0482 } from './semanticNetBuyNormalizerAdr0482.js';
import {
  buildInvestorSampleDiagnosticsAdr0502,
  formatInvestorSampleDiagnosticsAdr0502,
  type InvestorSampleDiagnosticsAdr0502,
} from './investorSampleMaterializationAdr0502.js';


export type NaverInvestorTrendCollectorStatus =
  | 'WIRED'
  | 'DATA_AVAILABLE'
  | 'DATA_UNAVAILABLE'
  | 'PARTIAL'
  | 'STALE'
  | 'EMPTY'
  | 'PARSE_ERROR'
  | 'PROVIDER_ERROR'
  | 'NON_TRADING_DAY'
  | 'DISABLED';

export type NaverInvestorTrendSignal =
  | 'BULLISH'
  | 'NEUTRAL'
  | 'BEARISH'
  | 'UNKNOWN';

export interface NaverInvestorTrendRawPoint {
  date: string;
  foreignNetBuy?: number | null;
  institutionNetBuy?: number | null;
  individualNetBuy?: number | null;
  programNetBuy?: number | null;
}

export interface NaverInvestorTrendNormalizedPoint {
  date: string;
  foreignNetBuy: number | null;
  institutionNetBuy: number | null;
  individualNetBuy: number | null;
  programNetBuy: number | null;
  source: 'NAVER';
  confidence: 'HIGH' | 'MEDIUM' | 'LOW' | 'NONE';
}

export interface NaverInvestorTrendCollectorResult {
  code: string;
  provider: 'NAVER';
  status: NaverInvestorTrendCollectorStatus;
  signal: NaverInvestorTrendSignal;
  points: NaverInvestorTrendNormalizedPoint[];
  latestPoint: NaverInvestorTrendNormalizedPoint | null;
  coverage: {
    availableDays: number;
    requestedDays: number;
    foreignAvailable: number;
    institutionAvailable: number;
    programAvailable: number;
  };
  freshness: {
    sourceState: 'FRESH' | 'STALE' | 'MISSING' | 'UNKNOWN';
    lastSourceDate: string | null;
    sourceAgeTradingDays: number | null;
  };
  semanticNetBuyCandidate: {
    foreignNetBuy: number | null;
    institutionNetBuy: number | null;
    programNetBuy: number | null;
    sourceDate: string | null;
    confidence: 'HIGH' | 'MEDIUM' | 'LOW' | 'NONE';
    status: 'VERIFIED' | 'PARTIAL' | 'STALE' | 'EMPTY' | 'DATA_UNAVAILABLE';
    signal: 'BULLISH' | 'NEUTRAL' | 'BEARISH' | 'UNKNOWN';
  } | null;
  materializationDiagnostics: InvestorSampleDiagnosticsAdr0502;
  executionImpact: 'NONE';
  liveExecutionAllowed: false;
  rawPayloadPersistenceAllowed: false;
  policyPromotionMode: 'SHADOW_ONLY';
  operatorApprovalRequired: true;
  diagnostics: string[];
}

export interface NaverInvestorTrendCollectorInput {
  code: string;
  requestedDays?: number;
  rawPoints?: readonly NaverInvestorTrendRawPoint[] | null;
  disabled?: boolean;
  nonTradingDay?: boolean;
  parseError?: boolean;
  providerError?: boolean;
  sourceAgeTradingDays?: number | null;
}

const ADR_0481_POLICY = {
  executionImpact: 'NONE',
  liveExecutionAllowed: false,
  rawPayloadPersistenceAllowed: false,
  policyPromotionMode: 'SHADOW_ONLY',
  operatorApprovalRequired: true,
} as const;

function finiteNumber(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value);
}

function normalizePoint(point: NaverInvestorTrendRawPoint): NaverInvestorTrendNormalizedPoint {
  const foreignNetBuy = finiteNumber(point.foreignNetBuy) ? point.foreignNetBuy : null;
  const institutionNetBuy = finiteNumber(point.institutionNetBuy) ? point.institutionNetBuy : null;
  const individualNetBuy = finiteNumber(point.individualNetBuy) ? point.individualNetBuy : null;
  const programNetBuy = finiteNumber(point.programNetBuy) ? point.programNetBuy : null;
  const hasBoth = finiteNumber(foreignNetBuy) && finiteNumber(institutionNetBuy);
  const hasOneCore = finiteNumber(foreignNetBuy) || finiteNumber(institutionNetBuy);
  return {
    date: point.date,
    foreignNetBuy,
    institutionNetBuy,
    individualNetBuy,
    programNetBuy,
    source: 'NAVER',
    confidence: hasBoth ? 'HIGH' : hasOneCore ? 'MEDIUM' : 'NONE',
  };
}

function coverage(points: readonly NaverInvestorTrendNormalizedPoint[], requestedDays: number): NaverInvestorTrendCollectorResult['coverage'] {
  return {
    availableDays: points.filter((point) => finiteNumber(point.foreignNetBuy) || finiteNumber(point.institutionNetBuy) || finiteNumber(point.programNetBuy)).length,
    requestedDays,
    foreignAvailable: points.filter((point) => finiteNumber(point.foreignNetBuy)).length,
    institutionAvailable: points.filter((point) => finiteNumber(point.institutionNetBuy)).length,
    programAvailable: points.filter((point) => finiteNumber(point.programNetBuy)).length,
  };
}

function pointHasInvestorFlow(point: NaverInvestorTrendNormalizedPoint): boolean {
  return finiteNumber(point.foreignNetBuy) || finiteNumber(point.institutionNetBuy) || finiteNumber(point.programNetBuy);
}

function fieldCoverage(points: readonly NaverInvestorTrendNormalizedPoint[]): number {
  if (points.length === 0) return 0;
  const available = points.reduce((sum, point) => sum + [point.foreignNetBuy, point.institutionNetBuy, point.programNetBuy].filter(finiteNumber).length, 0);
  return available / (points.length * 3);
}

function buildNaverMaterializationDiagnostics(
  input: NaverInvestorTrendCollectorInput,
  points: readonly NaverInvestorTrendNormalizedPoint[],
  status: NaverInvestorTrendCollectorStatus,
): InvestorSampleDiagnosticsAdr0502 {
  const materializedPoints = points.filter(pointHasInvestorFlow);
  const latest = materializedPoints[materializedPoints.length - 1] ?? null;
  return buildInvestorSampleDiagnosticsAdr0502({
    providerName: 'NAVER_INVESTOR_TREND',
    rawFetched: input.rawPoints !== null && input.rawPoints !== undefined,
    rawCount: input.rawPoints?.length ?? 0,
    normalizedCount: points.length,
    materializedCount: materializedPoints.length,
    symbolCoverage: input.code ? 1 : 0,
    dateCoverage: latest?.date ?? null,
    fieldCoverage: fieldCoverage(points),
    placeholderDetected: points.length === 0 || materializedPoints.length === 0,
    inputSourceKind: input.rawPoints && input.rawPoints.length > 0 ? 'RAW_PROVIDER' : 'NONE',
    inputSources: ['NAVER_INVESTOR_TREND'],
    lastSuccessfulSampleAt: latest?.date ?? null,
    confidenceLevel: status === 'DATA_AVAILABLE' ? 'VERIFIED' : status === 'PARTIAL' ? 'PARTIAL' : status === 'STALE' ? 'DEGRADED' : 'MISSING',
    staleReason: status === 'STALE' ? `sourceAgeTradingDays=${input.sourceAgeTradingDays ?? 'UNKNOWN'}` : null,
    hardBlocked: status === 'DISABLED' || status === 'PROVIDER_ERROR' || status === 'PARSE_ERROR',
    safePreview: materializedPoints.slice(-3).map((point) => ({
      code: input.code,
      date: point.date,
      foreignNetBuy: point.foreignNetBuy,
      institutionNetBuy: point.institutionNetBuy,
      programNetBuy: point.programNetBuy,
    })),
  });
}

function emptyResult(input: NaverInvestorTrendCollectorInput, status: NaverInvestorTrendCollectorStatus, diagnostic: string): NaverInvestorTrendCollectorResult {
  const materializationDiagnostics = buildNaverMaterializationDiagnostics(input, [], status);
  return {
    code: input.code,
    provider: 'NAVER',
    status,
    signal: 'UNKNOWN',
    points: [],
    latestPoint: null,
    coverage: coverage([], input.requestedDays ?? 5),
    freshness: { sourceState: status === 'DISABLED' ? 'UNKNOWN' : 'MISSING', lastSourceDate: null, sourceAgeTradingDays: null },
    semanticNetBuyCandidate: null,
    materializationDiagnostics,
    ...ADR_0481_POLICY,
    diagnostics: [
      'ADR-0481 NAVER collector wired as SHADOW_ONLY candidate.',
      diagnostic,
      formatInvestorSampleDiagnosticsAdr0502(materializationDiagnostics),
      'UNKNOWN/provider issue is not bearish.',
    ],
  };
}

export function buildNaverInvestorTrendCollectorResultAdr0481(input: NaverInvestorTrendCollectorInput): NaverInvestorTrendCollectorResult {
  const requestedDays = input.requestedDays ?? 5;
  if (input.disabled === true) return emptyResult(input, 'DISABLED', 'collector disabled by input; no live execution impact.');
  const suppliedRawPoints = input.rawPoints?.some((point) => typeof point.date === 'string' && point.date.length > 0) === true;
  if (input.nonTradingDay === true && !suppliedRawPoints) return emptyResult(input, 'NON_TRADING_DAY', 'non-trading day; missing NAVER data is not bearish.');
  if (input.parseError === true) return emptyResult(input, 'PARSE_ERROR', 'parse error isolated by ADR-0481 collector.');
  if (input.providerError === true) return emptyResult(input, 'PROVIDER_ERROR', 'provider error isolated by ADR-0481 collector.');

  const points = (input.rawPoints ?? [])
    .filter((point) => typeof point.date === 'string' && point.date.length > 0)
    .map(normalizePoint)
    .sort((a, b) => a.date.localeCompare(b.date))
    .slice(-requestedDays);

  if (points.length === 0) return emptyResult(input, 'DATA_UNAVAILABLE', 'collector exists but no safe NAVER trend rows were supplied.');

  const latestPoint = points[points.length - 1] ?? null;
  const cov = coverage(points, requestedDays);
  const normalized = normalizeSemanticNetBuySampleAdr0482({
    code: input.code,
    provider: 'NAVER',
    sourceDate: latestPoint?.date ?? null,
    rawForeignNetBuy: latestPoint?.foreignNetBuy ?? null,
    rawInstitutionNetBuy: latestPoint?.institutionNetBuy ?? null,
    rawProgramNetBuy: latestPoint?.programNetBuy ?? null,
    rawIndividualNetBuy: latestPoint?.individualNetBuy ?? null,
    unit: 'KRW',
    status: input.nonTradingDay === true ? 'STALE' : undefined,
    sourceAgeTradingDays: input.nonTradingDay === true ? (input.sourceAgeTradingDays ?? 1) : (input.sourceAgeTradingDays ?? 0),
    diagnostics: [
      'normalized via ADR-0482 semantic net-buy normalizer',
      ...(input.nonTradingDay === true ? ['previousTradingDate/off-hours NAVER sample is shadow-only stale diagnostic.'] : []),
    ],
  });
  const status: NaverInvestorTrendCollectorStatus = normalized.status === 'VERIFIED'
    ? 'DATA_AVAILABLE'
    : normalized.status === 'PARTIAL'
      ? 'PARTIAL'
      : normalized.status === 'STALE'
        ? 'STALE'
        : normalized.status === 'EMPTY'
          ? 'EMPTY'
          : normalized.status === 'PARSE_ERROR'
            ? 'PARSE_ERROR'
            : normalized.status === 'PROVIDER_ERROR'
              ? 'PROVIDER_ERROR'
              : normalized.status === 'NON_TRADING_DAY'
                ? 'NON_TRADING_DAY'
                : normalized.status === 'DISABLED'
                  ? 'DISABLED'
                  : 'DATA_UNAVAILABLE';
  const signal = normalized.signal;
  const candidateStatus: NonNullable<NaverInvestorTrendCollectorResult['semanticNetBuyCandidate']>['status'] = normalized.status === 'VERIFIED'
    ? 'VERIFIED'
    : normalized.status === 'PARTIAL'
      ? 'PARTIAL'
      : normalized.status === 'STALE'
        ? 'STALE'
        : normalized.status === 'EMPTY'
          ? 'EMPTY'
          : 'DATA_UNAVAILABLE';
  const semanticNetBuyCandidate: NaverInvestorTrendCollectorResult['semanticNetBuyCandidate'] = normalized.coverage.foreignAvailable || normalized.coverage.institutionAvailable || normalized.coverage.programAvailable ? {
    foreignNetBuy: normalized.foreignNetBuy,
    institutionNetBuy: normalized.institutionNetBuy,
    programNetBuy: normalized.programNetBuy,
    sourceDate: normalized.sourceDate,
    confidence: normalized.confidence,
    status: candidateStatus,
    signal: normalized.signal,
  } : null;
  const materializationDiagnostics = buildNaverMaterializationDiagnostics(input, points, status);

  return {
    code: input.code,
    provider: 'NAVER',
    status,
    signal,
    points,
    latestPoint,
    coverage: cov,
    freshness: {
      sourceState: normalized.freshness.sourceState,
      lastSourceDate: normalized.freshness.lastSourceDate,
      sourceAgeTradingDays: normalized.freshness.sourceAgeTradingDays,
    },
    semanticNetBuyCandidate,
    materializationDiagnostics,
    ...ADR_0481_POLICY,
    diagnostics: [
      'ADR-0481 NAVER collector wired as SHADOW_ONLY candidate.',
      `status=${status}`,
      `signal=${signal}`,
      formatInvestorSampleDiagnosticsAdr0502(materializationDiagnostics),
      input.nonTradingDay === true ? 'nonTradingDay previousTradingDate fallback consumed as STALE/SHADOW_ONLY.' : 'BUY_ALLOWED fresh NAVER sample path.',
      'executionImpact=NONE liveExecutionAllowed=false policyPromotionMode=SHADOW_ONLY',
      'rawPayloadPersistenceAllowed=false',
    ],
  };
}

export function safeBuildNaverInvestorTrendCollectorResultAdr0481(input: NaverInvestorTrendCollectorInput): NaverInvestorTrendCollectorResult {
  try {
    return buildNaverInvestorTrendCollectorResultAdr0481(input);
  } catch (error) {
    const fallback = emptyResult(input, 'PROVIDER_ERROR', 'collector failure isolated; scan and Shadow Learning continue.');
    return {
      ...fallback,
      diagnostics: [
        'ADR-0481 collector failure isolated.',
        error instanceof Error ? error.message : String(error),
        formatInvestorSampleDiagnosticsAdr0502(fallback.materializationDiagnostics),
        'UNKNOWN/provider issue is not bearish.',
      ],
    };
  }
}

export function formatNaverInvestorTrendCompactAdr0481(result?: NaverInvestorTrendCollectorResult | null): string | null {
  if (!result) return null;
  const days = result.status === 'DATA_AVAILABLE'
    ? ` | days=${result.coverage.availableDays}/${result.coverage.requestedDays}`
    : '';
  return `ADR-0481 NAVER InvestorTrend: ${result.status} | signal=${result.signal}${days} | impact=${result.executionImpact}`;
}

export function formatNaverInvestorTrendDetailAdr0481(result?: NaverInvestorTrendCollectorResult | null): string | null {
  if (!result) return null;
  const candidate = result.semanticNetBuyCandidate;
  return [
    '🧭 ADR-0481 NAVER Investor Trend Collector',
    `- code: ${result.code}`,
    `- status: ${result.status}`,
    `- signal: ${result.signal}`,
    `- coverage: days=${result.coverage.availableDays}/${result.coverage.requestedDays}, foreign=${result.coverage.foreignAvailable}, institution=${result.coverage.institutionAvailable}, program=${result.coverage.programAvailable}`,
    `- freshness: ${result.freshness.sourceState}, sourceDate=${result.freshness.lastSourceDate ?? 'none'}, age=${result.freshness.sourceAgeTradingDays ?? 'unknown'}`,
    `- semanticNetBuyCandidate: ${candidate ? `status=${candidate.status}, foreign=${candidate.foreignNetBuy ?? 'null'}, institution=${candidate.institutionNetBuy ?? 'null'}, program=${candidate.programNetBuy ?? 'null'}, confidence=${candidate.confidence}, sourceDate=${candidate.sourceDate ?? 'none'}` : 'none'}`,
    `- materialization: ${formatInvestorSampleDiagnosticsAdr0502(result.materializationDiagnostics)}`,
    `- executionImpact: ${result.executionImpact}`,
    `- liveExecutionAllowed: ${result.liveExecutionAllowed}`,
    `- policyPromotionMode: ${result.policyPromotionMode}`,
    `- operatorApprovalRequired: ${result.operatorApprovalRequired}`,
    `- diagnostics: ${result.diagnostics.join(' | ')}`,
  ].join('\n');
}

export interface NaverInvestorTrendDetailRegistryEntryAdr0481 {
  adr: '0481';
  sectionId: 'naver_investor_trend';
  commandHint: '/supply_health_detail';
  scanBlockersDetailHint: '/scan_blockers_detail naver_investor_trend';
  adrTraceHint: '/adr_trace 0481';
  executionImpact: 'NONE';
  liveExecutionAllowed: false;
  render: () => string;
}

export function getNaverInvestorTrendDetailRegistryEntryAdr0481(result: NaverInvestorTrendCollectorResult): NaverInvestorTrendDetailRegistryEntryAdr0481 {
  return {
    adr: '0481',
    sectionId: 'naver_investor_trend',
    commandHint: '/supply_health_detail',
    scanBlockersDetailHint: '/scan_blockers_detail naver_investor_trend',
    adrTraceHint: '/adr_trace 0481',
    executionImpact: 'NONE',
    liveExecutionAllowed: false,
    render: () => formatNaverInvestorTrendDetailAdr0481(result) ?? '',
  };
}
