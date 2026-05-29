// @responsibility Gate2 compact formatter helpers.

import type { Gate2ConsolidatedDiagnostic, Gate2ExternalDataCoverage, Gate2SourceCoverage } from './types.js';
import { buildGate2ConsolidatedDiagnostic, compactReadiness, valueText } from './consolidatedDiagnostic.js';
// SSOT: KIS investor-flow canonical apiPath/trId 표시값은 server/trading/signalScanner/gate2KisFlowTraceMetadata.ts
// (KIS_INVESTOR_FLOW_CANONICAL) 가 단일 원천. 본 모듈은 같은 디렉토리(externalCoverage.ts)에서 이미
// server/trading/gate2 를 import 하는 기존 경계 위에서 동일 SSOT 상수를 재사용한다 (DRY, 표시 전용).
import { KIS_INVESTOR_FLOW_CANONICAL } from '../../trading/signalScanner/gate2KisFlowTraceMetadata.js';

const KIS_FLOW_METADATA_NOT_CARRIED = 'UNKNOWN_METADATA_NOT_CARRIED';
const KIS_FLOW_TRACE_BREAK_POINT = 'PROVIDER_METADATA_DROPPED_AFTER_ROUTER';

export function formatGate2CompactDiagnostic(input: {
  sourceCoverage?: Gate2SourceCoverage | null;
  externalDataCoverage?: Gate2ExternalDataCoverage | null;
}): string | null {
  const source = input.sourceCoverage;
  const external = input.externalDataCoverage;
  if (!source || !external) return null;
  return buildGate2ConsolidatedDiagnostic({
    gate2: {
      sourceCoverage: source,
      externalDataCoverage: external,
    },
  }).compactText;
}

function formatSigned(value: number | null): string {
  if (value == null) return 'null';
  return value > 0 ? `+${value}` : String(value);
}

export function formatGate2KisInvestorFlowCompactDiagnostic(
  externalDataCoverage?: Gate2ExternalDataCoverage | null,
): string | null {
  const kis = externalDataCoverage?.kisInvestorFlow;
  if (!kis || !kis.required) return null;
  const issue = kis.status === 'MISSING'
    ? 'issue=KIS_INVESTOR_FLOW_MISSING'
    : kis.status === 'STAGE_NOT_FETCHED'
      ? 'stage=DISCOVERY_GATE'
      : kis.status === 'DEGRADED'
        ? 'providerIssue=true'
        : null;
  const supply = kis.status === 'VERIFIED'
    ? 'supply=supported'
    : kis.status === 'STAGE_NOT_FETCHED'
      ? 'supply=not_yet_evaluated'
      : 'supply=unavailable';
  // §A — apiPath/trId 정합 (진단 가시화 전용, marketSignal=false 불변).
  // 실제 carry 된 endpoint/trId 가 있으면 그 값을 표기(기존 동작 유지).
  // endpoint 가 없지만 endpointKey 가 알려져 있으면 endpointKey 로 표기(기존 동작 유지).
  // endpoint·trId 둘 다 router 가 carry 하지 않은 경우(metadata drop) — 과거엔 apiPath/trId 를
  // UNKNOWN_METADATA_NOT_CARRIED 로 표기했으나, KIS investor-flow 의 canonical apiPath/trId 는
  // SSOT(KIS_INVESTOR_FLOW_CANONICAL)로 *이미 알려져 있다*. 따라서 apiPath/trId 표시에 canonical
  // 값을 참조시키고(METADATA_NOT_CARRIED 마커 부기), traceBreakPoint 로 drop 사실을 별도 노출한다.
  const hasEndpoint = typeof kis.endpoint === 'string' && kis.endpoint.length > 0;
  const hasTrId = typeof kis.trId === 'string' && kis.trId.length > 0;
  const knownEndpointKey = kis.endpointKey !== 'UNKNOWN';

  const metadataNotCarried = !hasEndpoint && !hasTrId && !knownEndpointKey;

  const endpointDisplay = hasEndpoint
    ? (kis.endpoint as string)
    : knownEndpointKey
      ? `endpointKey:${kis.endpointKey}`
      : `${KIS_INVESTOR_FLOW_CANONICAL.apiPath} (canonical;${KIS_FLOW_METADATA_NOT_CARRIED})`;
  const trIdDisplay = hasTrId
    ? (kis.trId as string)
    : metadataNotCarried
      ? `${KIS_INVESTOR_FLOW_CANONICAL.trId} (canonical;${KIS_FLOW_METADATA_NOT_CARRIED})`
      : 'UNKNOWN';

  return [
    `Gate2 KIS Flow: ${kis.status}`,
    `apiPath=${endpointDisplay}`,
    `trId=${trIdDisplay}`,
    ...(metadataNotCarried
      ? [`traceBreakPoint=${KIS_FLOW_TRACE_BREAK_POINT}`]
      : []),
    `foreign=${formatSigned(kis.foreignNetBuy)}`,
    `inst=${formatSigned(kis.institutionalNetBuy)}`,
    supply,
    ...(issue ? [issue] : []),
    'marketSignal=false',
  ].join(' | ');
}

function formatRatio(value: number | null, suffix = ''): string {
  return value == null ? 'null' : `${value.toFixed(2)}${suffix}`;
}

function formatPercentPoint(value: number | null): string {
  if (value == null) return 'null';
  const displayValue = Math.abs(value) <= 1 ? value * 100 : value;
  const signed = displayValue > 0 ? `+${displayValue.toFixed(2)}` : displayValue.toFixed(2);
  return `${signed}%`;
}

// §C — DART transport/parse 오류(providerStatus 기반) 판별. HTTP_ERROR/PARSE_ERROR/DART_ERROR_CODE/
// RATE_LIMITED/UNKNOWN_ERROR 만 transport/parse error → providerIssue=true. FIELD_MISSING(단순 부재) 및
// 그 외는 providerIssue=false. server/trading/.../dataLineClassification.ts 의 transportOrParseError 규약과 일관.
const DART_TRANSPORT_OR_PARSE_PROVIDER_STATUS = new Set([
  'HTTP_ERROR',
  'PARSE_ERROR',
  'DART_ERROR_CODE',
  'RATE_LIMITED',
  'UNKNOWN_ERROR',
]);

// dataLineClassification.ts DART_REQUIRED_FIELDS 와 동일 라벨/순서. earnings_quality 가 최우선 핵심 필드.
const DART_LINE_FIELD_RANK = ['earningsQuality', 'icr', 'ocfToNi', 'opm', 'roe'] as const;

export function formatGate2DartFinancialsCompactDiagnostic(
  externalDataCoverage?: Gate2ExternalDataCoverage | null,
): string | null {
  const dart = externalDataCoverage?.dartFinancials;
  if (!dart || !dart.required) return null;

  // 미시도/단계 미평가(STAGE_NOT_FETCHED)·전체 부재(MISSING)는 coarse status 그대로 유지(기존 동작).
  if (dart.status === 'STAGE_NOT_FETCHED' || dart.status === 'MISSING') {
    const earningsQuality = dart.status === 'STAGE_NOT_FETCHED'
      ? 'earnings_quality=not_yet_evaluated'
      : 'earnings_quality=unavailable';
    const issue = dart.status === 'MISSING'
      ? 'issue=DART_FINANCIALS_MISSING'
      : 'stage=DISCOVERY_GATE';
    return [
      `Gate2 DART: ${dart.status}`,
      `OCF/NI=${formatRatio(dart.ocfRatio)}`,
      `ROE=${formatRatio(dart.roe)}`,
      `OPM=${formatRatio(dart.opm)}`,
      `ICR=${formatRatio(dart.interestCoverageRatio, 'x')}`,
      earningsQuality,
      issue,
      'marketSignal=false',
    ].join(' | ');
  }

  // 필드 가용성 판정 (null 기준). dataLineClassification.ts 와 동일 라벨 사용.
  // ocfToNi 는 ocfRatio 로 대표, earningsQuality 는 dart.fields/메타에서 가용 여부 도출.
  const earningsQualityAvailable = dart.earningsQuality != null
    && (typeof dart.earningsQuality !== 'object' || Object.keys(dart.earningsQuality).length > 0);
  const fieldAvailability: Array<{ label: string; available: boolean }> = [
    { label: 'roe', available: dart.roe != null },
    { label: 'opm', available: dart.opm != null },
    { label: 'ocfToNi', available: dart.ocfRatio != null },
    { label: 'icr', available: dart.interestCoverageRatio != null },
    { label: 'earningsQuality', available: earningsQualityAvailable },
  ];
  const availableFields = fieldAvailability.filter(f => f.available).map(f => f.label);
  const missingFields = fieldAvailability.filter(f => !f.available).map(f => f.label);

  // transport/parse error 여부 (providerStatus 기반). 단순 부재는 false.
  const transportOrParseError =
    typeof dart.providerStatus === 'string'
    && DART_TRANSPORT_OR_PARSE_PROVIDER_STATUS.has(dart.providerStatus);

  // 5-state status 재도출 (dataLineClassification.ts 규약과 일관):
  // transport/parse error → DEGRADED, 전부 가용 → VERIFIED, 일부만 가용 → PARTIAL,
  // 요청 성공·행0·에러 없음(EMPTY_VALID) → coarse status 유지, 그 외 부재 → PARTIAL.
  let lineStatus: 'VERIFIED' | 'PARTIAL' | 'DEGRADED' | 'EMPTY_VALID' | 'NOT_ATTEMPTED';
  if (transportOrParseError) {
    lineStatus = 'DEGRADED';
  } else if (missingFields.length === 0) {
    lineStatus = 'VERIFIED';
  } else if (availableFields.length > 0) {
    lineStatus = 'PARTIAL';
  } else if (dart.status === 'EMPTY_VALID') {
    lineStatus = 'EMPTY_VALID';
  } else {
    lineStatus = 'PARTIAL';
  }

  // providerIssue 는 transport/parse error 일 때만 true. 단순 부재(PARTIAL/EMPTY_VALID)는 false. marketSignal=false 불변.
  const providerIssue = transportOrParseError;

  const earningsQualityField = earningsQualityAvailable
    ? 'earnings_quality=available'
    : 'earnings_quality=unavailable';

  // primaryIssue: 가장 핵심 미가용 필드(earnings_quality 우선)를 DATA_UNAVAILABLE:<field> 로 노출.
  let primaryIssue: string | null = null;
  if (missingFields.length > 0) {
    const topMissing = DART_LINE_FIELD_RANK.find(field => missingFields.includes(field)) ?? missingFields[0];
    const label = topMissing === 'earningsQuality' ? 'earnings_quality' : topMissing;
    primaryIssue = `primaryIssue=DATA_UNAVAILABLE:${label}`;
  }

  return [
    `Gate2 DART: ${lineStatus}`,
    `OCF/NI=${formatRatio(dart.ocfRatio)}`,
    `ROE=${formatRatio(dart.roe)}`,
    `OPM=${formatRatio(dart.opm)}`,
    `ICR=${formatRatio(dart.interestCoverageRatio, 'x')}`,
    earningsQualityField,
    `availableFields=${availableFields.length > 0 ? availableFields.join(',') : 'none'}`,
    `missingFields=${missingFields.length > 0 ? missingFields.join(',') : 'none'}`,
    ...(primaryIssue ? [primaryIssue] : []),
    `providerIssue=${providerIssue ? 'true' : 'false'}`,
    'marketSignal=false',
  ].join(' | ');
}

export function formatGate2BenchmarkCompactDiagnostic(
  externalDataCoverage?: Gate2ExternalDataCoverage | null,
): string | null {
  const benchmark = externalDataCoverage?.benchmark;
  if (!benchmark || !benchmark.required) return null;
  const issue = benchmark.status === 'MISSING'
    ? 'issue=BENCHMARK_20D_RETURN_MISSING'
    : benchmark.status === 'STAGE_NOT_FETCHED'
      ? 'stage=DISCOVERY_GATE'
      : benchmark.status === 'DEGRADED'
        ? 'providerIssue=true'
        : null;
  const warning = benchmark.notes.some(note => note.includes('KOSDAQ_BENCHMARK_MISSING') || note.includes('KOSPI_FALLBACK'))
    ? 'note=benchmark_mismatch_possible'
    : null;
  return [
    `Gate2 Benchmark: ${benchmark.status}`,
    `market=${benchmark.market}`,
    `benchmark=${warning ? 'KOSPI_FALLBACK' : benchmark.benchmarkKey}`,
    `stock20d=${formatPercentPoint(benchmark.values.stockReturn20d)}`,
    `bench20d=${formatPercentPoint(benchmark.values.benchmarkReturn20d)}`,
    `RS=${formatPercentPoint(benchmark.values.relativeReturn20d)}`,
    ...(issue ? [issue] : []),
    ...(warning ? [warning] : []),
    'marketSignal=false',
  ].join(' | ');
}

export function formatGate2ProgramTradeCompactDiagnostic(
  externalDataCoverage?: Gate2ExternalDataCoverage | null,
): string | null {
  const program = externalDataCoverage?.programTrade;
  if (!program) return null;
  if (!program.scopeSeparationValid) {
    return [
      'Gate2 Program: DEGRADED',
      'issue=SCOPE_MISMATCH_MARKET_DATA_USED_AS_STOCK_FLOW',
      'action=REVIEW_PROGRAM_FLOW_SCOPE',
      'marketSignal=false',
    ].join(' | ');
  }
  const stockStatus = program.stockProgram.status;
  const marketStatus = program.marketProgram.status;
  if (stockStatus === 'EMPTY_VALID' || marketStatus === 'EMPTY_VALID') {
    return [
      'Gate2 Program: EMPTY_VALID',
      'issue=NO_PROGRAM_OUTPUT',
      'not_bearish',
      'marketSignal=false',
    ].join(' | ');
  }
  if (stockStatus === 'VERIFIED') {
    return [
      'Gate2 Program: VERIFIED',
      `stockProgram=${formatSigned(program.stockProgram.values.programNetBuyAmount)}`,
      program.marketProgram.status === 'VERIFIED' ? 'marketProgram=context' : `marketProgram=${program.marketProgram.status}`,
      'scope=OK',
      'marketSignal=false',
    ].join(' | ');
  }
  if (marketStatus === 'VERIFIED') {
    return [
      'Gate2 Program: WARN',
      'marketProgram=VERIFIED',
      `stockProgram=${stockStatus}`,
      'note=market_context_only',
      'marketSignal=false',
    ].join(' | ');
  }
  if (program.marketProgram.providerIssue || program.stockProgram.providerIssue) {
    return [
      'Gate2 Program: DEGRADED',
      'providerIssue=true',
      'reason=KIS_PROGRAM_PROVIDER',
      'marketSignal=false',
    ].join(' | ');
  }
  return [
    `Gate2 Program: ${stockStatus}`,
    `marketProgram=${marketStatus}`,
    'marketSignal=false',
  ].join(' | ');
}

export function formatGate2SectorCycleCompactDiagnostic(
  externalDataCoverage?: Gate2ExternalDataCoverage | null,
): string | null {
  const sector = externalDataCoverage?.sectorCycle;
  if (!sector) return null;
  const issue = sector.status === 'MISSING'
    ? 'issue=SECTOR_THEME_CYCLE_MISSING'
    : sector.status === 'DEGRADED'
      ? 'providerIssue=true'
      : sector.status === 'PARTIAL'
        ? 'issue=SECTOR_THEME_CYCLE_PARTIAL'
        : null;
  return [
    `Gate2 Sector Cycle: ${sector.status}`,
    `sector=${sector.sector ?? 'UNKNOWN'}`,
    `theme=${sector.themeTags.length > 0 ? sector.themeTags.slice(0, 3).join('/') : 'UNKNOWN'}`,
    `sector20d=${formatPercentPoint(sector.values.sectorReturn20d)}`,
    `sectorRS20d=${formatPercentPoint(sector.values.sectorRelativeReturn20d)}`,
    `stockVsSector20d=${formatPercentPoint(sector.values.stockVsSectorReturn20d)}`,
    ...(issue ? [issue] : []),
    'marketSignal=false',
  ].join(' | ');
}

export function formatGate2LeaderCycleCompactDiagnostic(
  externalDataCoverage?: Gate2ExternalDataCoverage | null,
): string | null {
  const leader = externalDataCoverage?.leaderCycle;
  if (!leader) return null;
  return [
    `Gate2 Leader Cycle: ${leader.status}`,
    `phase=${leader.leaderCyclePhase}`,
    `currentSector=${leader.isCurrentLeadingSector}`,
    `sectorLeader=${leader.isSectorLeader}`,
    `attention=${leader.attentionPhase}`,
    `news30d=${leader.newsFrequency30d ?? 'null'}`,
    'marketSignal=false',
  ].join(' | ');
}
