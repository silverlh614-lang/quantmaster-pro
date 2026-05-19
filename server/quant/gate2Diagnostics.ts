// @responsibility Gate2 data wiring diagnostics; diagnostic output only.

import type { ConditionKey, GateLayerName, ServerGateResult } from '../quantFilter.js';
import type { KisInvestorFlow } from '../clients/kisClient.js';
import type { DartFinancials } from '../clients/dartFinancialClient.js';

type GateEvaluatorOutput = NonNullable<ServerGateResult['outputs']>[number];

export type Gate2WiringStatus =
  | 'FIRED'
  | 'THRESHOLD_NOT_MET'
  | 'DATA_UNAVAILABLE'
  | 'PROVIDER_DEGRADED'
  | 'ERROR';

export type Gate2DataPath =
  | 'QUOTE_ONLY'
  | 'KIS'
  | 'DART'
  | 'BENCHMARK'
  | 'KIS_DART'
  | 'QUOTE_BENCHMARK'
  | 'MIXED'
  | 'UNKNOWN';

export interface Gate2WiringDiagnostic {
  key: string;
  layer: 'gate2';
  status: Gate2WiringStatus;
  inputs: string[];
  quoteInputs: string[];
  kisInputs: string[];
  dartInputs: string[];
  benchmarkInputs: string[];
  missingInputs: string[];
  availableInputs: string[];
  requiredExternalData: string[];
  missingExternalData: string[];
  dataPath: Gate2DataPath;
  providerIssue: boolean;
  marketSignal: false;
  diagnosticOnly: true;
}

export interface Gate2SourceCoverage {
  conditionCount: number;
  quoteInputCount: number;
  kisInputCount: number;
  dartInputCount: number;
  benchmarkInputCount: number;
  requiredExternalData: string[];
  missingInputs: string[];
  missingExternalData: string[];
  providerIssues: string[];
  allDeclaredInputsAvailable: boolean;
  allExternalDataAvailable: boolean;
  marketSignal: false;
  diagnosticOnly: true;
}

export type Gate2ExternalProviderStatus =
  | 'VERIFIED'
  | 'DEGRADED'
  | 'MISSING'
  | 'STALE'
  | 'STAGE_NOT_FETCHED'
  | 'UNKNOWN';

export interface Gate2ExternalDataCoverage {
  kisInvestorFlow: {
    required: boolean;
    available: boolean;
    provider: 'KIS_OFFICIAL' | 'KIS_API' | 'CACHE' | 'UNKNOWN';
    status: Gate2ExternalProviderStatus;
    fields: {
      foreignNetBuy: boolean;
      institutionalNetBuy: boolean;
      individualNetBuy?: boolean;
    };
    providerIssue: boolean;
    marketSignal: false;
  };
  dartFinancials: {
    required: boolean;
    available: boolean;
    provider: 'DART' | 'CACHE' | 'UNKNOWN';
    status: Gate2ExternalProviderStatus;
    fields: {
      ocfRatio: boolean;
      roe?: boolean;
      opmAcceleration?: boolean;
      interestCoverageRatio?: boolean;
    };
    providerIssue: boolean;
    marketSignal: false;
  };
  benchmark: {
    required: boolean;
    available: boolean;
    provider: 'KOSPI_INDEX' | 'QMP_MACRO' | 'CACHE' | 'UNKNOWN';
    status: Gate2ExternalProviderStatus;
    fields: {
      kospi20dReturn: boolean;
    };
    providerIssue: boolean;
    marketSignal: false;
  };
}

export interface Gate2ExternalCoverageInput {
  kisFlow?: KisInvestorFlow | null;
  dartFin?: DartFinancials | null;
  kospi20dReturn?: number | null;
}

const GATE2_STATUS_SET = new Set<Gate2WiringStatus>([
  'FIRED',
  'THRESHOLD_NOT_MET',
  'DATA_UNAVAILABLE',
  'PROVIDER_DEGRADED',
  'ERROR',
]);

function unique(values: readonly string[]): string[] {
  return [...new Set(values.filter(Boolean))];
}

function hasInput(input: string, prefix: string): boolean {
  return input === prefix || input.startsWith(`${prefix}.`);
}

function isKisInput(input: string): boolean {
  return input.startsWith('ctx.kisFlow.') || input.startsWith('kisFlow.');
}

function isDartInput(input: string): boolean {
  return input.startsWith('ctx.dartFin.') || input.startsWith('dartFin.');
}

function isBenchmarkInput(input: string): boolean {
  return input === 'ctx.kospi20dReturn'
    || input === 'kospi20dReturn'
    || input.startsWith('benchmark.')
    || input.startsWith('index.');
}

function externalLabelForInput(input: string): string | null {
  if (isKisInput(input)) return 'KIS_INVESTOR_FLOW';
  if (isDartInput(input)) return 'DART_FINANCIALS';
  if (isBenchmarkInput(input)) return 'BENCHMARK_KOSPI_20D_RETURN';
  return null;
}

function contextKeyForExternal(label: string): string | null {
  if (label === 'KIS_INVESTOR_FLOW') return 'kisFlow';
  if (label === 'DART_FINANCIALS') return 'dartFin';
  if (label === 'BENCHMARK_KOSPI_20D_RETURN') return 'kospi20dReturn';
  return null;
}

function normalizeStatus(output: GateEvaluatorOutput): Gate2WiringStatus {
  const raw = output.output?.status
    ?? (output.output ? 'FIRED' : output.context?.hadRequiredData === false ? 'DATA_UNAVAILABLE' : 'THRESHOLD_NOT_MET');
  return GATE2_STATUS_SET.has(raw as Gate2WiringStatus) ? raw as Gate2WiringStatus : 'THRESHOLD_NOT_MET';
}

function classifyDataPath(input: {
  quoteInputs: string[];
  kisInputs: string[];
  dartInputs: string[];
  benchmarkInputs: string[];
}): Gate2DataPath {
  const hasQuote = input.quoteInputs.length > 0;
  const hasKis = input.kisInputs.length > 0;
  const hasDart = input.dartInputs.length > 0;
  const hasBenchmark = input.benchmarkInputs.length > 0;
  const domainCount = [hasQuote, hasKis, hasDart, hasBenchmark].filter(Boolean).length;
  if (domainCount === 0) return 'UNKNOWN';
  if (domainCount === 1) {
    if (hasQuote) return 'QUOTE_ONLY';
    if (hasKis) return 'KIS';
    if (hasDart) return 'DART';
    if (hasBenchmark) return 'BENCHMARK';
  }
  if (domainCount === 2 && hasKis && hasDart) return 'KIS_DART';
  if (domainCount === 2 && hasQuote && hasBenchmark) return 'QUOTE_BENCHMARK';
  return 'MIXED';
}

function missingExternalDataFor(
  inputs: readonly string[],
  missingInputs: readonly string[],
  availableData: Record<string, boolean> | undefined,
): string[] {
  const labels = unique(inputs.map(input => externalLabelForInput(input) ?? '').filter(Boolean));
  return labels.filter(label => {
    const contextKey = contextKeyForExternal(label);
    const contextMissing = contextKey ? availableData?.[contextKey] !== true : false;
    const fieldMissing = missingInputs.some(input => externalLabelForInput(input) === label);
    return contextMissing || fieldMissing;
  });
}

export function buildGate2WiringDiagnostics(
  outputs: NonNullable<ServerGateResult['outputs']>,
  layerMap: Record<ConditionKey, GateLayerName>,
): Gate2WiringDiagnostic[] {
  return outputs
    .filter(output => layerMap[output.key as ConditionKey] === 'gate2')
    .map(output => {
      const inputs = [...(output.inputs ?? [])].map(String);
      const quoteInputs = inputs.filter(input => input.startsWith('quote.'));
      const kisInputs = inputs.filter(isKisInput);
      const dartInputs = inputs.filter(isDartInput);
      const benchmarkInputs = inputs.filter(isBenchmarkInput);
      const missingInputs = unique(output.context?.missingInputs ?? []);
      const availableInputs = inputs.filter(input => output.context?.inputAvailability?.[input] === true);
      const requiredExternalData = unique(inputs.map(input => externalLabelForInput(input) ?? '').filter(Boolean));
      const missingExternalData = missingExternalDataFor(inputs, missingInputs, output.context?.availableData);
      const status = normalizeStatus(output);
      const providerIssue = missingInputs.length > 0
        || missingExternalData.length > 0
        || status === 'DATA_UNAVAILABLE'
        || status === 'PROVIDER_DEGRADED'
        || status === 'ERROR';

      return {
        key: output.key,
        layer: 'gate2',
        status,
        inputs,
        quoteInputs,
        kisInputs,
        dartInputs,
        benchmarkInputs,
        missingInputs,
        availableInputs,
        requiredExternalData,
        missingExternalData,
        dataPath: classifyDataPath({ quoteInputs, kisInputs, dartInputs, benchmarkInputs }),
        providerIssue,
        marketSignal: false,
        diagnosticOnly: true,
      };
    });
}

export function buildGate2SourceCoverage(wiring: readonly Gate2WiringDiagnostic[]): Gate2SourceCoverage {
  const quoteInputs = unique(wiring.flatMap(item => item.quoteInputs));
  const kisInputs = unique(wiring.flatMap(item => item.kisInputs));
  const dartInputs = unique(wiring.flatMap(item => item.dartInputs));
  const benchmarkInputs = unique(wiring.flatMap(item => item.benchmarkInputs));
  const requiredExternalData = unique(wiring.flatMap(item => item.requiredExternalData));
  const missingInputs = unique(wiring.flatMap(item => item.missingInputs));
  const missingExternalData = unique(wiring.flatMap(item => item.missingExternalData));
  const providerIssues = unique(wiring.flatMap(item => {
    if (!item.providerIssue) return [];
    const issues = [
      ...item.missingExternalData.map(key => `${key}_MISSING`),
      ...item.missingInputs
        .filter(input => input.startsWith('quote.'))
        .map(input => `QUOTE_INPUT_MISSING:${input}`),
    ];
    if (item.status === 'PROVIDER_DEGRADED' || item.status === 'ERROR') issues.push(`${item.status}:${item.key}`);
    if (item.status === 'DATA_UNAVAILABLE' && issues.length === 0) issues.push(`DATA_UNAVAILABLE:${item.key}`);
    return issues;
  }));

  return {
    conditionCount: wiring.length,
    quoteInputCount: quoteInputs.length,
    kisInputCount: kisInputs.length,
    dartInputCount: dartInputs.length,
    benchmarkInputCount: benchmarkInputs.length,
    requiredExternalData,
    missingInputs,
    missingExternalData,
    providerIssues,
    allDeclaredInputsAvailable: missingInputs.length === 0,
    allExternalDataAvailable: missingExternalData.length === 0,
    marketSignal: false,
    diagnosticOnly: true,
  };
}

function fieldAvailable(wiring: readonly Gate2WiringDiagnostic[], input: string): boolean {
  return wiring.some(item => item.availableInputs.includes(input));
}

function requiredExternal(wiring: readonly Gate2WiringDiagnostic[], label: string): boolean {
  return wiring.some(item => item.requiredExternalData.includes(label));
}

function externalMissing(wiring: readonly Gate2WiringDiagnostic[], label: string): boolean {
  return wiring.some(item => item.missingExternalData.includes(label));
}

function statusFromMetadata(value: unknown): Gate2ExternalProviderStatus | null {
  if (!value || typeof value !== 'object') return null;
  const record = value as Record<string, unknown>;
  const raw = String(record.providerStatus ?? record.sourceStatus ?? record.status ?? record.dataQuality ?? '').toUpperCase();
  if (raw.includes('VERIFIED') || raw === 'OK' || raw === 'OK_WITH_DATA') return 'VERIFIED';
  if (raw.includes('STALE')) return 'STALE';
  if (raw.includes('MISSING') || raw === 'OK_EMPTY') return 'MISSING';
  if (raw.includes('DEGRADED') || raw.includes('ERROR') || raw.includes('RATE_LIMIT') || raw.includes('TOKEN')) return 'DEGRADED';
  return null;
}

function providerFromMetadata(value: unknown, defaults: { verified: string; cache: string; unknown: string }): string {
  if (!value || typeof value !== 'object') return defaults.unknown;
  const record = value as Record<string, unknown>;
  const raw = String(record.provider ?? record.source ?? record.dataSource ?? '').toUpperCase();
  if (raw.includes('CACHE')) return defaults.cache;
  if (raw.includes('KIS_OFFICIAL')) return 'KIS_OFFICIAL';
  if (raw.includes('KIS')) return 'KIS_API';
  if (raw.includes('DART')) return 'DART';
  if (raw.includes('KOSPI') || raw.includes('INDEX')) return 'KOSPI_INDEX';
  if (raw.includes('QMP')) return 'QMP_MACRO';
  return defaults.verified;
}

function resolveStatus(required: boolean, available: boolean, missing: boolean, metadata: unknown): Gate2ExternalProviderStatus {
  if (!required) return 'UNKNOWN';
  const metadataStatus = statusFromMetadata(metadata);
  if (metadataStatus && metadataStatus !== 'VERIFIED') return metadataStatus;
  if (available && !missing) return 'VERIFIED';
  return 'MISSING';
}

export function buildGate2ExternalDataCoverage(
  wiring: readonly Gate2WiringDiagnostic[],
  input: Gate2ExternalCoverageInput = {},
): Gate2ExternalDataCoverage {
  const kisRequired = requiredExternal(wiring, 'KIS_INVESTOR_FLOW');
  const dartRequired = requiredExternal(wiring, 'DART_FINANCIALS');
  const benchmarkRequired = requiredExternal(wiring, 'BENCHMARK_KOSPI_20D_RETURN');

  const kisFields = {
    foreignNetBuy: fieldAvailable(wiring, 'ctx.kisFlow.foreignNetBuy') || fieldAvailable(wiring, 'kisFlow.foreignNetBuy'),
    institutionalNetBuy: fieldAvailable(wiring, 'ctx.kisFlow.institutionalNetBuy') || fieldAvailable(wiring, 'kisFlow.institutionalNetBuy'),
    individualNetBuy: input.kisFlow != null && typeof (input.kisFlow as unknown as Record<string, unknown>).individualNetBuy === 'number',
  };
  const dartFields = {
    ocfRatio: fieldAvailable(wiring, 'ctx.dartFin.ocfRatio') || fieldAvailable(wiring, 'dartFin.ocfRatio'),
    roe: input.dartFin != null && typeof (input.dartFin as unknown as Record<string, unknown>).roe === 'number',
    opmAcceleration: input.dartFin != null && typeof (input.dartFin as unknown as Record<string, unknown>).opmAcceleration === 'number',
    interestCoverageRatio: input.dartFin != null && typeof (input.dartFin as unknown as Record<string, unknown>).interestCoverageRatio === 'number',
  };
  const benchmarkFields = {
    kospi20dReturn: fieldAvailable(wiring, 'ctx.kospi20dReturn') || typeof input.kospi20dReturn === 'number' && Number.isFinite(input.kospi20dReturn),
  };

  const kisAvailable = kisRequired && kisFields.foreignNetBuy && kisFields.institutionalNetBuy && !externalMissing(wiring, 'KIS_INVESTOR_FLOW');
  const dartAvailable = dartRequired && dartFields.ocfRatio && !externalMissing(wiring, 'DART_FINANCIALS');
  const benchmarkAvailable = benchmarkRequired && benchmarkFields.kospi20dReturn && !externalMissing(wiring, 'BENCHMARK_KOSPI_20D_RETURN');
  const kisStatus = resolveStatus(kisRequired, kisAvailable, externalMissing(wiring, 'KIS_INVESTOR_FLOW'), input.kisFlow);
  const dartStatus = resolveStatus(dartRequired, dartAvailable, externalMissing(wiring, 'DART_FINANCIALS'), input.dartFin);
  const benchmarkStatus = resolveStatus(benchmarkRequired, benchmarkAvailable, externalMissing(wiring, 'BENCHMARK_KOSPI_20D_RETURN'), null);

  return {
    kisInvestorFlow: {
      required: kisRequired,
      available: kisAvailable,
      provider: providerFromMetadata(input.kisFlow, { verified: kisRequired && input.kisFlow ? 'KIS_API' : 'UNKNOWN', cache: 'CACHE', unknown: 'UNKNOWN' }) as Gate2ExternalDataCoverage['kisInvestorFlow']['provider'],
      status: kisStatus,
      fields: kisFields,
      providerIssue: kisRequired && kisStatus !== 'VERIFIED',
      marketSignal: false,
    },
    dartFinancials: {
      required: dartRequired,
      available: dartAvailable,
      provider: providerFromMetadata(input.dartFin, { verified: dartRequired && input.dartFin ? 'DART' : 'UNKNOWN', cache: 'CACHE', unknown: 'UNKNOWN' }) as Gate2ExternalDataCoverage['dartFinancials']['provider'],
      status: dartStatus,
      fields: dartFields,
      providerIssue: dartRequired && dartStatus !== 'VERIFIED',
      marketSignal: false,
    },
    benchmark: {
      required: benchmarkRequired,
      available: benchmarkAvailable,
      provider: benchmarkRequired && typeof input.kospi20dReturn === 'number' && Number.isFinite(input.kospi20dReturn) ? 'KOSPI_INDEX' : 'UNKNOWN',
      status: benchmarkStatus,
      fields: benchmarkFields,
      providerIssue: benchmarkRequired && benchmarkStatus !== 'VERIFIED',
      marketSignal: false,
    },
  };
}

export function formatGate2CompactDiagnostic(input: {
  sourceCoverage?: Gate2SourceCoverage | null;
  externalDataCoverage?: Gate2ExternalDataCoverage | null;
}): string | null {
  const source = input.sourceCoverage;
  const external = input.externalDataCoverage;
  if (!source || !external) return null;
  const health = source.allDeclaredInputsAvailable && source.allExternalDataAvailable ? 'inputs=OK' : 'DEGRADED';
  const issue = source.providerIssues[0] ?? source.missingExternalData[0] ?? source.missingInputs[0] ?? null;
  return [
    `Gate2: ${health}`,
    `KIS=${external.kisInvestorFlow.status}`,
    `DART=${external.dartFinancials.status}`,
    `Benchmark=${external.benchmark.status}`,
    `unavailable=${source.missingExternalData.length}`,
    ...(issue ? [`issue=${issue}`] : []),
    'marketSignal=false',
  ].join(' | ');
}
