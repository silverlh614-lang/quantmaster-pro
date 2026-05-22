// @responsibility Gate2 compact formatter helpers.

import type { Gate2ConsolidatedDiagnostic, Gate2ExternalDataCoverage, Gate2SourceCoverage } from './types.js';
import { buildGate2ConsolidatedDiagnostic, compactReadiness, valueText } from './consolidatedDiagnostic.js';

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
  const apiPath = kis.endpoint ?? null;
  const endpointDisplay = apiPath
    ?? (kis.endpointKey !== 'UNKNOWN' ? `endpointKey:${kis.endpointKey}` : 'UNRESOLVED');
  const trIdDisplay = kis.trId ?? 'UNKNOWN';
  return [
    `Gate2 KIS Flow: ${kis.status}`,
    `apiPath=${endpointDisplay}`,
    `trId=${trIdDisplay}`,
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

export function formatGate2DartFinancialsCompactDiagnostic(
  externalDataCoverage?: Gate2ExternalDataCoverage | null,
): string | null {
  const dart = externalDataCoverage?.dartFinancials;
  if (!dart || !dart.required) return null;
  const issue = dart.status === 'MISSING'
    ? 'issue=DART_FINANCIALS_MISSING'
    : dart.status === 'STAGE_NOT_FETCHED'
      ? 'stage=DISCOVERY_GATE'
      : dart.status === 'DEGRADED'
        ? 'providerIssue=true'
        : null;
  const earningsQuality = dart.status === 'VERIFIED'
    ? 'earnings_quality=available'
    : dart.status === 'STAGE_NOT_FETCHED'
      ? 'earnings_quality=not_yet_evaluated'
      : 'earnings_quality=unavailable';
  return [
    `Gate2 DART: ${dart.status}`,
    `OCF/NI=${formatRatio(dart.ocfRatio)}`,
    `ROE=${formatRatio(dart.roe)}`,
    `OPM=${formatRatio(dart.opm)}`,
    `ICR=${formatRatio(dart.interestCoverageRatio, 'x')}`,
    earningsQuality,
    ...(issue ? [issue] : []),
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
