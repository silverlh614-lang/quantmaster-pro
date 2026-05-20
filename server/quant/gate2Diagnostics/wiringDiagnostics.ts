// @responsibility Gate2 wiring diagnostic builders.

import type { ConditionKey, GateLayerName, ServerGateResult } from '../../quantFilter.js';
import type { KisInvestorFlow } from '../../clients/kisClient.js';
import type { DartFinancials } from '../../clients/dartFinancialClient.js';
import {
  KIS_OFFICIAL_INVESTOR_FLOW_ENDPOINTS,
} from '../../clients/kisClient/kisOfficialEndpointRegistry.js';
import type {
  KisInvestorFlowConfidence,
  KisInvestorFlowDriftDiagnostic,
  KisInvestorFlowEndpointKey,
  KisInvestorFlowProviderStatus,
  KisInvestorFlowRawFieldCoverage,
  QmpInvestorFlow,
} from '../../clients/kisClient/kisOfficialInvestorFlowMapper.js';
import type {
  KisProgramFlowDriftDiagnostic,
  KisProgramFlowRawFieldCoverage,
  KisProgramTradeConfidence,
  KisProgramTradeProviderStatus,
  QmpProgramFlow,
} from '../../clients/kisClient/kisOfficialProgramFlowMapper.js';
import type {
  DartFinancialConfidence,
  DartFinancialProviderStatus,
  DartFinancialRawFieldCoverage,
  QmpDartFinancials,
} from '../../clients/dartFinancialNormalizer.js';
import {
  normalizeBenchmarkReturnForGate2,
  type BenchmarkConfidence,
  type BenchmarkKey,
  type BenchmarkMarket,
  type BenchmarkProviderStatus,
  type BenchmarkRawFieldCoverage,
  type BenchmarkReturnSource,
  type QmpBenchmarkReturn,
} from '../../clients/benchmarkReturnNormalizer.js';
import {
  normalizeSectorThemeCycleForGate2,
  type AttentionPhase,
  type LeaderCyclePhase,
  type QmpSectorThemeCycle,
  type SectorCycleMarket,
  type SectorThemeCycleConfidence,
  type SectorThemeCycleProviderStatus,
  type SectorThemeCycleRawFieldCoverage,
  type SectorThemeCycleSource,
} from '../../clients/sectorThemeLeaderCycleNormalizer.js';
import type {
  Gate2DataPath,
  Gate2SourceCoverage,
  Gate2WiringDiagnostic,
  Gate2WiringStatus,
  GateEvaluatorOutput,
} from './types.js';

export const GATE2_STATUS_SET = new Set<Gate2WiringStatus>([
  'FIRED',
  'THRESHOLD_NOT_MET',
  'DATA_UNAVAILABLE',
  'PROVIDER_DEGRADED',
  'ERROR',
]);

export function unique(values: readonly string[]): string[] {
  return [...new Set(values.filter(Boolean))];
}

export function hasInput(input: string, prefix: string): boolean {
  return input === prefix || input.startsWith(`${prefix}.`);
}

export function isKisInput(input: string): boolean {
  return input.startsWith('ctx.kisFlow.') || input.startsWith('kisFlow.');
}

export function isDartInput(input: string): boolean {
  return input.startsWith('ctx.dartFin.') || input.startsWith('dartFin.');
}

export function isBenchmarkInput(input: string): boolean {
  return input === 'ctx.kospi20dReturn'
    || input === 'kospi20dReturn'
    || input.startsWith('benchmark.')
    || input.startsWith('index.');
}

export function externalLabelForInput(input: string): string | null {
  if (isKisInput(input)) return 'KIS_INVESTOR_FLOW';
  if (isDartInput(input)) return 'DART_FINANCIALS';
  if (isBenchmarkInput(input)) return 'BENCHMARK_20D_RETURN';
  return null;
}

export function contextKeyForExternal(label: string): string | null {
  if (label === 'KIS_INVESTOR_FLOW') return 'kisFlow';
  if (label === 'DART_FINANCIALS') return 'dartFin';
  if (label === 'BENCHMARK_20D_RETURN') return 'kospi20dReturn';
  if (label === 'BENCHMARK_KOSPI_20D_RETURN') return 'kospi20dReturn';
  return null;
}

export function normalizeStatus(output: GateEvaluatorOutput): Gate2WiringStatus {
  const raw = output.output?.status
    ?? (output.output ? 'FIRED' : output.context?.hadRequiredData === false ? 'DATA_UNAVAILABLE' : 'THRESHOLD_NOT_MET');
  return GATE2_STATUS_SET.has(raw as Gate2WiringStatus) ? raw as Gate2WiringStatus : 'THRESHOLD_NOT_MET';
}

export function classifyDataPath(input: {
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

export function missingExternalDataFor(
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
