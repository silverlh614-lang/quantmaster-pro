// @responsibility ADR-0481 NAVER Investor Trend Collector Wiring; SHADOW_ONLY semantic investor-flow candidate.

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
  executionImpact: 'NONE';
  liveExecutionAllowed: false;
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

function deriveVerifiedSignal(input: {
  foreignNetBuy: number | null;
  institutionNetBuy: number | null;
  confidence: 'HIGH' | 'MEDIUM' | 'LOW' | 'NONE';
  status: NonNullable<NaverInvestorTrendCollectorResult['semanticNetBuyCandidate']>['status'];
}): NaverInvestorTrendSignal {
  if (input.status !== 'VERIFIED' && input.status !== 'PARTIAL') return 'UNKNOWN';
  if (input.confidence !== 'HIGH' && input.confidence !== 'MEDIUM') return 'UNKNOWN';
  if (!finiteNumber(input.foreignNetBuy) || !finiteNumber(input.institutionNetBuy)) return 'UNKNOWN';
  if (input.foreignNetBuy > 0 && input.institutionNetBuy > 0) return 'BULLISH';
  if (input.foreignNetBuy < 0 && input.institutionNetBuy < 0) return 'BEARISH';
  return 'NEUTRAL';
}

function emptyResult(input: NaverInvestorTrendCollectorInput, status: NaverInvestorTrendCollectorStatus, diagnostic: string): NaverInvestorTrendCollectorResult {
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
    ...ADR_0481_POLICY,
    diagnostics: ['ADR-0481 NAVER collector wired as SHADOW_ONLY candidate.', diagnostic, 'UNKNOWN/provider issue is not bearish.'],
  };
}

export function buildNaverInvestorTrendCollectorResultAdr0481(input: NaverInvestorTrendCollectorInput): NaverInvestorTrendCollectorResult {
  const requestedDays = input.requestedDays ?? 5;
  if (input.disabled === true) return emptyResult(input, 'DISABLED', 'collector disabled by input; no live execution impact.');
  if (input.nonTradingDay === true) return emptyResult(input, 'NON_TRADING_DAY', 'non-trading day; missing NAVER data is not bearish.');
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
  const hasCore = !!latestPoint && (finiteNumber(latestPoint.foreignNetBuy) || finiteNumber(latestPoint.institutionNetBuy));
  const hasBothCore = !!latestPoint && finiteNumber(latestPoint.foreignNetBuy) && finiteNumber(latestPoint.institutionNetBuy);
  const sourceAgeTradingDays = input.sourceAgeTradingDays ?? 0;
  const stale = sourceAgeTradingDays >= 4;
  const status: NaverInvestorTrendCollectorStatus = stale
    ? 'STALE'
    : !hasCore
      ? 'EMPTY'
      : hasBothCore
        ? 'DATA_AVAILABLE'
        : 'PARTIAL';
  const candidateStatus: NonNullable<NaverInvestorTrendCollectorResult['semanticNetBuyCandidate']>['status'] = stale
    ? 'STALE'
    : !hasCore
      ? 'EMPTY'
      : hasBothCore
        ? 'VERIFIED'
        : 'PARTIAL';
  const candidateConfidence = stale ? 'LOW' : (latestPoint?.confidence ?? 'NONE');
  const signal = deriveVerifiedSignal({
    foreignNetBuy: latestPoint?.foreignNetBuy ?? null,
    institutionNetBuy: latestPoint?.institutionNetBuy ?? null,
    confidence: candidateConfidence,
    status: candidateStatus,
  });
  const semanticNetBuyCandidate = hasCore || stale ? {
    foreignNetBuy: latestPoint?.foreignNetBuy ?? null,
    institutionNetBuy: latestPoint?.institutionNetBuy ?? null,
    programNetBuy: latestPoint?.programNetBuy ?? null,
    sourceDate: latestPoint?.date ?? null,
    confidence: candidateConfidence,
    status: candidateStatus,
    signal,
  } : null;

  return {
    code: input.code,
    provider: 'NAVER',
    status,
    signal,
    points,
    latestPoint,
    coverage: cov,
    freshness: {
      sourceState: stale ? 'STALE' : latestPoint ? 'FRESH' : 'MISSING',
      lastSourceDate: latestPoint?.date ?? null,
      sourceAgeTradingDays,
    },
    semanticNetBuyCandidate,
    ...ADR_0481_POLICY,
    diagnostics: [
      'ADR-0481 NAVER collector wired as SHADOW_ONLY candidate.',
      `status=${status}`,
      `signal=${signal}`,
      'executionImpact=NONE liveExecutionAllowed=false policyPromotionMode=SHADOW_ONLY',
    ],
  };
}

export function safeBuildNaverInvestorTrendCollectorResultAdr0481(input: NaverInvestorTrendCollectorInput): NaverInvestorTrendCollectorResult {
  try {
    return buildNaverInvestorTrendCollectorResultAdr0481(input);
  } catch (error) {
    return {
      ...emptyResult(input, 'PROVIDER_ERROR', 'collector failure isolated; scan and Shadow Learning continue.'),
      diagnostics: ['ADR-0481 collector failure isolated.', error instanceof Error ? error.message : String(error), 'UNKNOWN/provider issue is not bearish.'],
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
