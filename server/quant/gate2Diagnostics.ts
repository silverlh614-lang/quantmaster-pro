// @responsibility Gate2 data wiring diagnostics; diagnostic output only.

import type { ConditionKey, GateLayerName, ServerGateResult } from '../quantFilter.js';
import type { KisInvestorFlow } from '../clients/kisClient.js';
import type { DartFinancials } from '../clients/dartFinancialClient.js';
import {
  KIS_OFFICIAL_INVESTOR_FLOW_ENDPOINTS,
} from '../clients/kisClient/kisOfficialEndpointRegistry.js';
import type {
  KisInvestorFlowConfidence,
  KisInvestorFlowDriftDiagnostic,
  KisInvestorFlowEndpointKey,
  KisInvestorFlowProviderStatus,
  KisInvestorFlowRawFieldCoverage,
  QmpInvestorFlow,
} from '../clients/kisClient/kisOfficialInvestorFlowMapper.js';
import type {
  DartFinancialConfidence,
  DartFinancialProviderStatus,
  DartFinancialRawFieldCoverage,
  QmpDartFinancials,
} from '../clients/dartFinancialNormalizer.js';
import {
  normalizeBenchmarkReturnForGate2,
  type BenchmarkConfidence,
  type BenchmarkKey,
  type BenchmarkMarket,
  type BenchmarkProviderStatus,
  type BenchmarkRawFieldCoverage,
  type BenchmarkReturnSource,
  type QmpBenchmarkReturn,
} from '../clients/benchmarkReturnNormalizer.js';

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
  | 'EMPTY_VALID'
  | 'STALE'
  | 'STAGE_NOT_FETCHED'
  | 'UNKNOWN';

export type Gate2EvaluationStage = 'DISCOVERY_GATE' | 'REFRESHED_GATE' | 'ENTRY_RECHECK_GATE' | string;

export interface Gate2ExternalDataCoverage {
  kisInvestorFlow: {
    required: boolean;
    available: boolean;
    provider: 'KIS_OFFICIAL' | 'KIS_API' | 'CACHE' | 'UNKNOWN';
    endpointKey: KisInvestorFlowEndpointKey | 'UNKNOWN';
    endpoint: string | null;
    trId: string | null;
    providerStatus: KisInvestorFlowProviderStatus | null;
    dataConfidence: KisInvestorFlowConfidence | null;
    status: Gate2ExternalProviderStatus;
    fields: {
      foreignNetBuy: boolean;
      institutionalNetBuy: boolean;
      individualNetBuy: boolean;
    };
    foreignNetBuy: number | null;
    institutionalNetBuy: number | null;
    individualNetBuy: number | null;
    missingFields: string[];
    rawFieldCoverage: KisInvestorFlowRawFieldCoverage;
    driftDiagnostics: KisInvestorFlowDriftDiagnostic[];
    stageNotFetched: boolean;
    providerIssue: boolean;
    marketSignal: false;
    executionImpact: 'NONE' | 'DIAGNOSTIC_ONLY';
  };
  dartFinancials: {
    required: boolean;
    available: boolean;
    provider: 'DART' | 'DART_CACHE' | 'QMP_CACHE' | 'UNKNOWN';
    providerStatus: DartFinancialProviderStatus | null;
    dataConfidence: DartFinancialConfidence | null;
    status: Gate2ExternalProviderStatus;
    fields: {
      operatingCashFlow: boolean;
      netIncome: boolean;
      ocfRatio: boolean;
      roe: boolean;
      opm: boolean;
      opmYoYDelta: boolean;
      marginAcceleration: boolean;
      interestCoverageRatio: boolean;
    };
    ocfRatio: number | null;
    roe: number | null;
    opm: number | null;
    opmYoYDelta: number | null;
    marginAcceleration: number | null;
    interestCoverageRatio: number | null;
    missingFields: string[];
    rawFieldCoverage: DartFinancialRawFieldCoverage;
    stageNotFetched: boolean;
    providerIssue: boolean;
    marketSignal: false;
    executionImpact: 'NONE' | 'DIAGNOSTIC_ONLY';
  };
  benchmark: {
    required: boolean;
    available: boolean;
    provider: BenchmarkReturnSource;
    providerStatus: BenchmarkProviderStatus | null;
    dataConfidence: BenchmarkConfidence | null;
    status: Gate2ExternalProviderStatus;
    market: BenchmarkMarket;
    benchmarkKey: BenchmarkKey;
    period: '20D';
    fields: {
      stockReturn20d: boolean;
      benchmarkReturn20d: boolean;
      relativeReturn20d: boolean;
      kospi20dReturn: boolean;
      kosdaq20dReturn: boolean;
    };
    values: {
      stockReturn20d: number | null;
      benchmarkReturn20d: number | null;
      relativeReturn20d: number | null;
    };
    missingFields: string[];
    rawFieldCoverage: BenchmarkRawFieldCoverage;
    stageNotFetched: boolean;
    providerIssue: boolean;
    marketSignal: false;
    executionImpact: 'NONE' | 'DIAGNOSTIC_ONLY';
    notes: string[];
  };
}

export interface Gate2ExternalCoverageInput {
  kisFlow?: KisInvestorFlow | QmpInvestorFlow | null;
  dartFin?: DartFinancials | QmpDartFinancials | null;
  kospi20dReturn?: number | null;
  kosdaq20dReturn?: number | null;
  quote?: unknown;
  stockMaster?: unknown;
  market?: BenchmarkMarket | string | null;
  benchmarkReturn?: QmpBenchmarkReturn | null;
  benchmarkRaw?: unknown;
  evaluationStage?: Gate2EvaluationStage | null;
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
  if (isBenchmarkInput(input)) return 'BENCHMARK_20D_RETURN';
  return null;
}

function contextKeyForExternal(label: string): string | null {
  if (label === 'KIS_INVESTOR_FLOW') return 'kisFlow';
  if (label === 'DART_FINANCIALS') return 'dartFin';
  if (label === 'BENCHMARK_20D_RETURN') return 'kospi20dReturn';
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

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === 'object' && !Array.isArray(value);
}

function numberOrNull(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

function stringOrNull(value: unknown): string | null {
  return typeof value === 'string' && value.trim() ? value.trim() : null;
}

function statusFromMetadata(value: unknown): Gate2ExternalProviderStatus | null {
  if (!isRecord(value)) return null;
  const record = value;
  const raw = String(record.providerStatus ?? record.sourceStatus ?? record.status ?? record.dataQuality ?? '').toUpperCase();
  if (raw.includes('VERIFIED') || raw === 'OK' || raw === 'OK_WITH_DATA') return 'VERIFIED';
  if (raw.includes('STALE')) return 'STALE';
  if (raw === 'OK_EMPTY' || raw.includes('EMPTY_VALID')) return 'EMPTY_VALID';
  if (raw.includes('MISSING')) return 'MISSING';
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

function normalizeKisEndpointKey(value: unknown): KisInvestorFlowEndpointKey | 'UNKNOWN' {
  const raw = String(value ?? '').toUpperCase();
  if (raw === 'INQUIRE_INVESTOR' || raw === 'INQUIREINVESTOR') return 'INQUIRE_INVESTOR';
  if (raw === 'INVESTOR_TRADE_BY_STOCK_DAILY' || raw === 'INVESTORTRADEBYSTOCKDAILY') return 'INVESTOR_TRADE_BY_STOCK_DAILY';
  return 'UNKNOWN';
}

function kisProviderStatus(value: unknown): KisInvestorFlowProviderStatus | null {
  if (!isRecord(value)) return null;
  const raw = String(value.providerStatus ?? '').toUpperCase();
  const allowed: KisInvestorFlowProviderStatus[] = [
    'OK_WITH_DATA',
    'OK_EMPTY',
    'HTTP_ERROR',
    'KIS_ERROR_CODE',
    'TOKEN_EXPIRED',
    'RATE_LIMITED',
    'FIELD_MISSING',
    'PARSE_ERROR',
    'UNKNOWN_ERROR',
  ];
  if ((allowed as string[]).includes(raw)) return raw as KisInvestorFlowProviderStatus;
  return null;
}

function kisConfidence(value: unknown): KisInvestorFlowConfidence | null {
  if (!isRecord(value)) return null;
  const raw = String(value.dataConfidence ?? value.confidence ?? '').toUpperCase();
  const allowed: KisInvestorFlowConfidence[] = ['VERIFIED', 'DEGRADED', 'STALE', 'MISSING', 'EMPTY_VALID', 'AI_ESTIMATED'];
  if ((allowed as string[]).includes(raw)) return raw as KisInvestorFlowConfidence;
  return null;
}

function gate2StatusFromKisProviderStatus(status: KisInvestorFlowProviderStatus | null, confidence: KisInvestorFlowConfidence | null): Gate2ExternalProviderStatus | null {
  if (confidence === 'EMPTY_VALID') return 'EMPTY_VALID';
  if (confidence === 'VERIFIED') return 'VERIFIED';
  if (confidence === 'STALE') return 'STALE';
  if (confidence === 'MISSING') return 'MISSING';
  if (confidence === 'DEGRADED' || confidence === 'AI_ESTIMATED') return 'DEGRADED';
  if (status === 'OK_WITH_DATA') return 'VERIFIED';
  if (status === 'OK_EMPTY') return 'EMPTY_VALID';
  if (status === 'FIELD_MISSING' || status === 'PARSE_ERROR') return 'DEGRADED';
  if (status === 'HTTP_ERROR' || status === 'KIS_ERROR_CODE' || status === 'TOKEN_EXPIRED' || status === 'RATE_LIMITED' || status === 'UNKNOWN_ERROR') return 'DEGRADED';
  return null;
}

function kisEndpointMetadata(value: unknown): {
  endpointKey: KisInvestorFlowEndpointKey | 'UNKNOWN';
  endpoint: string | null;
  trId: string | null;
  driftDiagnostics: KisInvestorFlowDriftDiagnostic[];
} {
  const record = isRecord(value) ? value : {};
  const endpointKey = normalizeKisEndpointKey(record.endpointKey ?? record.sourceKind);
  const spec = endpointKey === 'UNKNOWN' ? null : KIS_OFFICIAL_INVESTOR_FLOW_ENDPOINTS[endpointKey];
  const endpoint = stringOrNull(record.endpoint ?? record.actualPath ?? record.path) ?? spec?.path ?? null;
  const trId = stringOrNull(record.trId ?? record.actualTrId) ?? spec?.trId ?? null;
  const existingDrift = Array.isArray(record.driftDiagnostics)
    ? record.driftDiagnostics.filter(isRecord) as unknown as KisInvestorFlowDriftDiagnostic[]
    : [];
  if (existingDrift.length > 0 || !spec || !endpoint || !trId) return { endpointKey, endpoint, trId, driftDiagnostics: existingDrift };
  if (endpoint === spec.path && trId === spec.trId) return { endpointKey, endpoint, trId, driftDiagnostics: [] };
  return {
    endpointKey,
    endpoint,
    trId,
    driftDiagnostics: [{
      type: 'KIS_OFFICIAL_DRIFT_DETECTED',
      api: endpointKey as KisInvestorFlowEndpointKey,
      expectedPath: spec.path,
      actualPath: endpoint,
      expectedTrId: spec.trId,
      actualTrId: trId,
      action: 'DO_NOT_AUTO_REPLACE_REQUIRE_REVIEW',
    }],
  };
}

function kisRawFieldCoverage(value: unknown, missingFields: string[]): KisInvestorFlowRawFieldCoverage {
  const record = isRecord(value) ? value : {};
  const embedded = record.rawFieldCoverage;
  if (isRecord(embedded)) {
    return {
      requiredFields: Array.isArray(embedded.requiredFields) ? embedded.requiredFields.map(String) : ['foreignNetBuy', 'institutionalNetBuy'],
      presentFields: Array.isArray(embedded.presentFields) ? embedded.presentFields.map(String) : [],
      missingFields: Array.isArray(embedded.missingFields) ? embedded.missingFields.map(String) : missingFields,
      allRequiredFieldsPresent: embedded.allRequiredFieldsPresent === true,
    };
  }
  return {
    requiredFields: ['foreignNetBuy', 'institutionalNetBuy'],
    presentFields: ['foreignNetBuy', 'institutionalNetBuy'].filter(field => !missingFields.includes(field)),
    missingFields,
    allRequiredFieldsPresent: missingFields.length === 0,
  };
}

function resolveKisStatus(input: {
  required: boolean;
  fieldsAvailable: boolean;
  missing: boolean;
  kisFlow: Gate2ExternalCoverageInput['kisFlow'];
  evaluationStage?: Gate2EvaluationStage | null;
}): Gate2ExternalProviderStatus {
  if (!input.required) return 'UNKNOWN';
  if (!input.kisFlow) {
    return input.evaluationStage === 'DISCOVERY_GATE' ? 'STAGE_NOT_FETCHED' : 'MISSING';
  }
  const metadataStatus = gate2StatusFromKisProviderStatus(kisProviderStatus(input.kisFlow), kisConfidence(input.kisFlow))
    ?? statusFromMetadata(input.kisFlow);
  if (metadataStatus && metadataStatus !== 'VERIFIED') return metadataStatus;
  if (input.fieldsAvailable && !input.missing) return 'VERIFIED';
  return 'DEGRADED';
}

function providerIssueForKisStatus(required: boolean, status: Gate2ExternalProviderStatus): boolean {
  if (!required) return false;
  return !['VERIFIED', 'EMPTY_VALID', 'STAGE_NOT_FETCHED'].includes(status);
}

function dartProviderStatus(value: unknown): DartFinancialProviderStatus | null {
  if (!isRecord(value)) return null;
  const raw = String(value.providerStatus ?? '').toUpperCase();
  const allowed: DartFinancialProviderStatus[] = [
    'OK_WITH_DATA',
    'OK_EMPTY',
    'HTTP_ERROR',
    'DART_ERROR_CODE',
    'RATE_LIMITED',
    'FIELD_MISSING',
    'PARSE_ERROR',
    'STALE_CACHE',
    'UNKNOWN_ERROR',
  ];
  if ((allowed as string[]).includes(raw)) return raw as DartFinancialProviderStatus;
  return null;
}

function dartConfidence(value: unknown): DartFinancialConfidence | null {
  if (!isRecord(value)) return null;
  const raw = String(value.dataConfidence ?? value.confidence ?? '').toUpperCase();
  const allowed: DartFinancialConfidence[] = ['VERIFIED', 'DEGRADED', 'STALE', 'MISSING', 'EMPTY_VALID', 'AI_ESTIMATED'];
  if ((allowed as string[]).includes(raw)) return raw as DartFinancialConfidence;
  return null;
}

function gate2StatusFromDartProviderStatus(status: DartFinancialProviderStatus | null, confidence: DartFinancialConfidence | null): Gate2ExternalProviderStatus | null {
  if (confidence === 'EMPTY_VALID') return 'EMPTY_VALID';
  if (confidence === 'VERIFIED') return 'VERIFIED';
  if (confidence === 'STALE') return 'STALE';
  if (confidence === 'MISSING') return 'MISSING';
  if (confidence === 'DEGRADED' || confidence === 'AI_ESTIMATED') return 'DEGRADED';
  if (status === 'OK_WITH_DATA') return 'VERIFIED';
  if (status === 'OK_EMPTY') return 'EMPTY_VALID';
  if (status === 'STALE_CACHE') return 'STALE';
  if (status === 'FIELD_MISSING' || status === 'PARSE_ERROR') return 'DEGRADED';
  if (status === 'HTTP_ERROR' || status === 'DART_ERROR_CODE' || status === 'RATE_LIMITED' || status === 'UNKNOWN_ERROR') return 'DEGRADED';
  return null;
}

function dartProviderFromMetadata(value: unknown): Gate2ExternalDataCoverage['dartFinancials']['provider'] {
  if (!isRecord(value)) return 'UNKNOWN';
  const raw = String(value.provider ?? value.source ?? value.dataSource ?? '').toUpperCase();
  if (raw.includes('DART_CACHE')) return 'DART_CACHE';
  if (raw.includes('QMP_CACHE') || raw === 'CACHE') return 'QMP_CACHE';
  if (raw.includes('DART')) return 'DART';
  return 'UNKNOWN';
}

function dartRawFieldCoverage(value: unknown, missingFields: string[], legacyRequiredField: boolean): DartFinancialRawFieldCoverage {
  const record = isRecord(value) ? value : {};
  const embedded = record.rawFieldCoverage;
  if (isRecord(embedded)) {
    return {
      requiredFields: Array.isArray(embedded.requiredFields) ? embedded.requiredFields.map(String) : ['operatingCashFlow', 'netIncome'],
      presentFields: Array.isArray(embedded.presentFields) ? embedded.presentFields.map(String) : [],
      missingFields: Array.isArray(embedded.missingFields) ? embedded.missingFields.map(String) : missingFields,
      allRequiredFieldsPresent: embedded.allRequiredFieldsPresent === true,
    };
  }
  const requiredFields = legacyRequiredField ? ['ocfRatio'] : ['operatingCashFlow', 'netIncome'];
  return {
    requiredFields,
    presentFields: requiredFields.filter(field => !missingFields.includes(field)),
    missingFields,
    allRequiredFieldsPresent: missingFields.length === 0,
  };
}

function resolveDartStatus(input: {
  required: boolean;
  ocfAvailable: boolean;
  missing: boolean;
  dartFin: Gate2ExternalCoverageInput['dartFin'];
  evaluationStage?: Gate2EvaluationStage | null;
}): Gate2ExternalProviderStatus {
  if (!input.required) return 'UNKNOWN';
  if (!input.dartFin) {
    return input.evaluationStage === 'DISCOVERY_GATE' ? 'STAGE_NOT_FETCHED' : 'MISSING';
  }
  const metadataStatus = gate2StatusFromDartProviderStatus(dartProviderStatus(input.dartFin), dartConfidence(input.dartFin))
    ?? statusFromMetadata(input.dartFin);
  if (metadataStatus && metadataStatus !== 'VERIFIED') return metadataStatus;
  if (input.ocfAvailable && !input.missing) return 'VERIFIED';
  return 'DEGRADED';
}

function providerIssueForDartStatus(required: boolean, status: Gate2ExternalProviderStatus): boolean {
  if (!required) return false;
  return !['VERIFIED', 'EMPTY_VALID', 'STAGE_NOT_FETCHED'].includes(status);
}

function gate2StatusFromBenchmarkProviderStatus(
  status: BenchmarkProviderStatus | null,
  confidence: BenchmarkConfidence | null,
): Gate2ExternalProviderStatus | null {
  if (confidence === 'EMPTY_VALID') return 'EMPTY_VALID';
  if (confidence === 'VERIFIED') return 'VERIFIED';
  if (confidence === 'STALE') return 'STALE';
  if (confidence === 'MISSING') return 'MISSING';
  if (confidence === 'DEGRADED' || confidence === 'AI_ESTIMATED') return 'DEGRADED';
  if (status === 'OK_WITH_DATA') return 'VERIFIED';
  if (status === 'OK_EMPTY') return 'EMPTY_VALID';
  if (status === 'STALE_CACHE') return 'STALE';
  if (status === 'FIELD_MISSING') return 'MISSING';
  if (status === 'PARSE_ERROR' || status === 'HTTP_ERROR' || status === 'PROVIDER_ERROR' || status === 'RATE_LIMITED' || status === 'UNKNOWN_ERROR') return 'DEGRADED';
  return null;
}

function resolveBenchmarkStatus(input: {
  required: boolean;
  benchmark: QmpBenchmarkReturn;
  missing: boolean;
  evaluationStage?: Gate2EvaluationStage | null;
}): Gate2ExternalProviderStatus {
  if (!input.required) return 'UNKNOWN';
  const fieldsAvailable = input.benchmark.stockReturn != null && input.benchmark.benchmarkReturn != null;
  if (!fieldsAvailable && input.evaluationStage === 'DISCOVERY_GATE') return 'STAGE_NOT_FETCHED';
  const metadataStatus = gate2StatusFromBenchmarkProviderStatus(input.benchmark.providerStatus, input.benchmark.dataConfidence);
  if (metadataStatus && metadataStatus !== 'VERIFIED') return metadataStatus;
  if (fieldsAvailable && !input.missing) return 'VERIFIED';
  return 'MISSING';
}

function providerIssueForBenchmarkStatus(required: boolean, status: Gate2ExternalProviderStatus): boolean {
  if (!required) return false;
  return !['VERIFIED', 'EMPTY_VALID', 'STAGE_NOT_FETCHED'].includes(status);
}

function quoteSymbol(input: Gate2ExternalCoverageInput): string {
  const quote = isRecord(input.quote) ? input.quote : {};
  const stockMaster = isRecord(input.stockMaster) ? input.stockMaster : {};
  return stringOrNull(quote.symbol ?? quote.code ?? stockMaster.symbol ?? stockMaster.code) ?? 'UNKNOWN';
}

export function buildGate2ExternalDataCoverage(
  wiring: readonly Gate2WiringDiagnostic[],
  input: Gate2ExternalCoverageInput = {},
): Gate2ExternalDataCoverage {
  const kisRequired = requiredExternal(wiring, 'KIS_INVESTOR_FLOW');
  const dartRequired = requiredExternal(wiring, 'DART_FINANCIALS');
  const benchmarkRequired = requiredExternal(wiring, 'BENCHMARK_20D_RETURN')
    || requiredExternal(wiring, 'BENCHMARK_KOSPI_20D_RETURN');

  const kisRecord: Record<string, unknown> = isRecord(input.kisFlow) ? input.kisFlow : {};
  const kisForeignNetBuy = numberOrNull(kisRecord.foreignNetBuy);
  const kisInstitutionalNetBuy = numberOrNull(kisRecord.institutionalNetBuy ?? kisRecord.institutionNetBuy);
  const kisIndividualNetBuy = numberOrNull(kisRecord.individualNetBuy);
  const kisFields = {
    foreignNetBuy: fieldAvailable(wiring, 'ctx.kisFlow.foreignNetBuy') || fieldAvailable(wiring, 'kisFlow.foreignNetBuy') || kisForeignNetBuy != null,
    institutionalNetBuy: fieldAvailable(wiring, 'ctx.kisFlow.institutionalNetBuy') || fieldAvailable(wiring, 'kisFlow.institutionalNetBuy') || kisInstitutionalNetBuy != null,
    individualNetBuy: kisIndividualNetBuy != null,
  };
  const kisMissingFields = ['foreignNetBuy', 'institutionalNetBuy'].filter(field => kisFields[field as 'foreignNetBuy' | 'institutionalNetBuy'] !== true);
  const dartRecord: Record<string, unknown> = isRecord(input.dartFin) ? input.dartFin : {};
  const dartOcfRatio = numberOrNull(dartRecord.ocfRatio);
  const dartRoe = numberOrNull(dartRecord.roe);
  const dartOpm = numberOrNull(dartRecord.opm);
  const dartOpmYoYDelta = numberOrNull(dartRecord.opmYoYDelta);
  const dartMarginAcceleration = numberOrNull(dartRecord.marginAcceleration);
  const dartInterestCoverageRatio = numberOrNull(dartRecord.interestCoverageRatio);
  const dartOperatingCashFlow = numberOrNull(dartRecord.operatingCashFlow);
  const dartNetIncome = numberOrNull(dartRecord.netIncome);
  const dartLegacyRequiredField = dartOcfRatio != null && dartOperatingCashFlow == null && dartNetIncome == null && !isRecord(dartRecord.rawFieldCoverage);
  const dartFields = {
    ocfRatio: fieldAvailable(wiring, 'ctx.dartFin.ocfRatio') || fieldAvailable(wiring, 'dartFin.ocfRatio'),
    operatingCashFlow: dartOperatingCashFlow != null,
    netIncome: dartNetIncome != null,
    roe: dartRoe != null,
    opm: dartOpm != null,
    opmYoYDelta: dartOpmYoYDelta != null,
    marginAcceleration: dartMarginAcceleration != null,
    interestCoverageRatio: dartInterestCoverageRatio != null,
  };
  const dartMissingFields = dartLegacyRequiredField
    ? []
    : ['operatingCashFlow', 'netIncome'].filter(field => dartFields[field as 'operatingCashFlow' | 'netIncome'] !== true);
  const benchmarkDiagnostic = input.benchmarkReturn ?? normalizeBenchmarkReturnForGate2({
    symbol: quoteSymbol(input),
    market: input.market,
    quote: input.quote,
    stockMaster: input.stockMaster,
    benchmarkRaw: input.benchmarkRaw,
    kospi20dReturn: input.kospi20dReturn,
    kosdaq20dReturn: input.kosdaq20dReturn,
    period: '20D',
    evaluationStage: input.evaluationStage,
  });
  const benchmarkFields = {
    stockReturn20d: benchmarkDiagnostic.stockReturn != null,
    benchmarkReturn20d: benchmarkDiagnostic.benchmarkReturn != null,
    relativeReturn20d: benchmarkDiagnostic.relativeReturn != null,
    kospi20dReturn: fieldAvailable(wiring, 'ctx.kospi20dReturn') || typeof input.kospi20dReturn === 'number' && Number.isFinite(input.kospi20dReturn),
    kosdaq20dReturn: typeof input.kosdaq20dReturn === 'number' && Number.isFinite(input.kosdaq20dReturn),
  };

  const kisFieldsAvailable = kisRequired && kisFields.foreignNetBuy && kisFields.institutionalNetBuy;
  const kisStatus = resolveKisStatus({
    required: kisRequired,
    fieldsAvailable: kisFieldsAvailable,
    missing: externalMissing(wiring, 'KIS_INVESTOR_FLOW'),
    kisFlow: input.kisFlow,
    evaluationStage: input.evaluationStage,
  });
  const kisAvailable = kisFieldsAvailable && !externalMissing(wiring, 'KIS_INVESTOR_FLOW') && kisStatus === 'VERIFIED';
  const dartStatus = resolveDartStatus({
    required: dartRequired,
    ocfAvailable: dartFields.ocfRatio,
    missing: externalMissing(wiring, 'DART_FINANCIALS'),
    dartFin: input.dartFin,
    evaluationStage: input.evaluationStage,
  });
  const dartAvailable = dartRequired && dartFields.ocfRatio && !externalMissing(wiring, 'DART_FINANCIALS') && dartStatus === 'VERIFIED';
  const benchmarkStatus = resolveBenchmarkStatus({
    required: benchmarkRequired,
    benchmark: benchmarkDiagnostic,
    missing: externalMissing(wiring, 'BENCHMARK_20D_RETURN')
      || externalMissing(wiring, 'BENCHMARK_KOSPI_20D_RETURN'),
    evaluationStage: input.evaluationStage,
  });
  const benchmarkAvailable = benchmarkRequired
    && benchmarkFields.stockReturn20d
    && benchmarkFields.benchmarkReturn20d
    && !externalMissing(wiring, 'BENCHMARK_20D_RETURN')
    && !externalMissing(wiring, 'BENCHMARK_KOSPI_20D_RETURN')
    && benchmarkStatus === 'VERIFIED';
  const kisEndpoint = kisEndpointMetadata(input.kisFlow);
  const kisProviderStatusValue = kisProviderStatus(input.kisFlow);
  const kisDataConfidence = kisConfidence(input.kisFlow);
  const dartProviderStatusValue = dartProviderStatus(input.dartFin);
  const dartDataConfidence = dartConfidence(input.dartFin);

  return {
    kisInvestorFlow: {
      required: kisRequired,
      available: kisAvailable,
      provider: providerFromMetadata(input.kisFlow, { verified: kisRequired && input.kisFlow ? 'KIS_API' : 'UNKNOWN', cache: 'CACHE', unknown: 'UNKNOWN' }) as Gate2ExternalDataCoverage['kisInvestorFlow']['provider'],
      endpointKey: kisEndpoint.endpointKey,
      endpoint: kisEndpoint.endpoint,
      trId: kisEndpoint.trId,
      providerStatus: kisProviderStatusValue,
      dataConfidence: kisDataConfidence,
      status: kisStatus,
      fields: kisFields,
      foreignNetBuy: kisForeignNetBuy,
      institutionalNetBuy: kisInstitutionalNetBuy,
      individualNetBuy: kisIndividualNetBuy,
      missingFields: kisMissingFields,
      rawFieldCoverage: kisRawFieldCoverage(input.kisFlow, kisMissingFields),
      driftDiagnostics: kisEndpoint.driftDiagnostics,
      stageNotFetched: kisStatus === 'STAGE_NOT_FETCHED',
      providerIssue: providerIssueForKisStatus(kisRequired, kisStatus),
      marketSignal: false,
      executionImpact: 'DIAGNOSTIC_ONLY',
    },
    dartFinancials: {
      required: dartRequired,
      available: dartAvailable,
      provider: dartProviderFromMetadata(input.dartFin),
      providerStatus: dartProviderStatusValue,
      dataConfidence: dartDataConfidence,
      status: dartStatus,
      fields: dartFields,
      ocfRatio: dartOcfRatio,
      roe: dartRoe,
      opm: dartOpm,
      opmYoYDelta: dartOpmYoYDelta,
      marginAcceleration: dartMarginAcceleration,
      interestCoverageRatio: dartInterestCoverageRatio,
      missingFields: dartMissingFields,
      rawFieldCoverage: dartRawFieldCoverage(input.dartFin, dartMissingFields, dartLegacyRequiredField),
      stageNotFetched: dartStatus === 'STAGE_NOT_FETCHED',
      providerIssue: providerIssueForDartStatus(dartRequired, dartStatus),
      marketSignal: false,
      executionImpact: 'DIAGNOSTIC_ONLY',
    },
    benchmark: {
      required: benchmarkRequired,
      available: benchmarkAvailable,
      provider: benchmarkDiagnostic.source,
      providerStatus: benchmarkDiagnostic.providerStatus,
      dataConfidence: benchmarkDiagnostic.dataConfidence,
      status: benchmarkStatus,
      market: benchmarkDiagnostic.market,
      benchmarkKey: benchmarkDiagnostic.benchmarkKey,
      period: '20D',
      fields: benchmarkFields,
      values: {
        stockReturn20d: benchmarkDiagnostic.stockReturn,
        benchmarkReturn20d: benchmarkDiagnostic.benchmarkReturn,
        relativeReturn20d: benchmarkDiagnostic.relativeReturn,
      },
      missingFields: benchmarkDiagnostic.rawFieldCoverage?.missingFields ?? [],
      rawFieldCoverage: benchmarkDiagnostic.rawFieldCoverage ?? {
        requiredFields: ['stockReturn20d', 'benchmarkReturn20d'],
        presentFields: [],
        missingFields: ['stockReturn20d', 'benchmarkReturn20d'],
        allRequiredFieldsPresent: false,
      },
      stageNotFetched: benchmarkStatus === 'STAGE_NOT_FETCHED',
      providerIssue: providerIssueForBenchmarkStatus(benchmarkRequired, benchmarkStatus),
      marketSignal: false,
      executionImpact: 'DIAGNOSTIC_ONLY',
      notes: benchmarkDiagnostic.notes,
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
  return [
    `Gate2 KIS Flow: ${kis.status}`,
    `endpoint=${kis.endpointKey}`,
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
