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
  KisProgramFlowDriftDiagnostic,
  KisProgramFlowRawFieldCoverage,
  KisProgramTradeConfidence,
  KisProgramTradeProviderStatus,
  QmpProgramFlow,
} from '../clients/kisClient/kisOfficialProgramFlowMapper.js';
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
} from '../clients/sectorThemeLeaderCycleNormalizer.js';

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
  | 'PARTIAL'
  | 'DEGRADED'
  | 'MISSING'
  | 'EMPTY_VALID'
  | 'STALE'
  | 'STAGE_NOT_FETCHED'
  | 'UNKNOWN';

export type Gate2EvaluationStage = 'DISCOVERY_GATE' | 'REFRESHED_GATE' | 'ENTRY_RECHECK_GATE' | string;

export type Gate2RiskPressure = 'LOW' | 'MEDIUM' | 'HIGH' | 'UNKNOWN';

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
  programTrade: {
    required: false;
    available: boolean;
    provider: 'KIS_OFFICIAL' | 'KIS_API' | 'CACHE' | 'UNKNOWN';
    marketProgram: {
      available: boolean;
      endpointKey: 'COMP_PROGRAM_TRADE_TODAY' | 'UNKNOWN';
      endpoint: string | null;
      trId: string | null;
      providerStatus: KisProgramTradeProviderStatus | null;
      dataConfidence: KisProgramTradeConfidence | null;
      status: Gate2ExternalProviderStatus;
      scope: 'MARKET';
      fields: {
        programNetBuyAmount: boolean;
        arbitrageNetBuyAmount: boolean;
        nonArbitrageNetBuyAmount: boolean;
      };
      values: {
        programNetBuyAmount: number | null;
        arbitrageNetBuyAmount: number | null;
        nonArbitrageNetBuyAmount: number | null;
      };
      rawFieldCoverage: KisProgramFlowRawFieldCoverage;
      driftDiagnostics: KisProgramFlowDriftDiagnostic[];
      stageNotFetched: boolean;
      providerIssue: boolean;
      marketSignal: false;
    };
    stockProgram: {
      available: boolean;
      endpointKey: 'PROGRAM_TRADE_BY_STOCK_DAILY' | 'UNKNOWN';
      endpoint: string | null;
      trId: string | null;
      providerStatus: KisProgramTradeProviderStatus | null;
      dataConfidence: KisProgramTradeConfidence | null;
      status: Gate2ExternalProviderStatus;
      scope: 'STOCK';
      fields: {
        programNetBuyAmount: boolean;
        programNetBuyVolume: boolean;
      };
      values: {
        programNetBuyAmount: number | null;
        programNetBuyVolume: number | null;
      };
      rawFieldCoverage: KisProgramFlowRawFieldCoverage;
      driftDiagnostics: KisProgramFlowDriftDiagnostic[];
      stageNotFetched: boolean;
      providerIssue: boolean;
      marketSignal: false;
    };
    scopeSeparationValid: boolean;
    notes: string[];
    executionImpact: 'NONE' | 'DIAGNOSTIC_ONLY';
    marketSignal: false;
  };
  riskFlow: {
    required: false;
    available: boolean;
    provider: 'KIS_OFFICIAL' | 'KIS_API' | 'KRX_CACHE' | 'QMP_CACHE' | 'CACHE' | 'UNKNOWN';
    status: Gate2ExternalProviderStatus;
    fields: {
      shortPressure: boolean;
      loanPressure: boolean;
      creditOverheat: boolean;
    };
    values: {
      shortSaleIncreaseRate: number | null;
      loanIncreaseRate: number | null;
      creditIncreaseRate: number | null;
      creditBalanceRatio: number | null;
    };
    interpretation: {
      shortPressure: Gate2RiskPressure;
      loanPressure: Gate2RiskPressure;
      creditOverheat: Gate2RiskPressure;
      overallRisk: Gate2RiskPressure;
    };
    notes: string[];
    stageNotFetched: boolean;
    providerIssue: boolean;
    marketSignal: false;
    executionImpact: 'NONE' | 'DIAGNOSTIC_ONLY';
    diagnosticOnly: true;
  };
  sectorCycle: {
    required: boolean;
    available: boolean;
    provider: SectorThemeCycleSource;
    providerStatus: SectorThemeCycleProviderStatus | null;
    dataConfidence: SectorThemeCycleConfidence | null;
    status: Gate2ExternalProviderStatus;
    symbol: string;
    sector: string | null;
    industry: string | null;
    themeTags: string[];
    market: SectorCycleMarket;
    fields: {
      sector: boolean;
      industry: boolean;
      themeTags: boolean;
      sectorReturn20d: boolean;
      sectorReturn60d: boolean;
      benchmarkReturn20d: boolean;
      benchmarkReturn60d: boolean;
      sectorRelativeReturn20d: boolean;
      sectorRelativeReturn60d: boolean;
      stockReturn20d: boolean;
      stockReturn60d: boolean;
      stockVsSectorReturn20d: boolean;
      stockVsSectorReturn60d: boolean;
    };
    values: {
      sectorReturn20d: number | null;
      sectorReturn60d: number | null;
      benchmarkReturn20d: number | null;
      benchmarkReturn60d: number | null;
      sectorRelativeReturn20d: number | null;
      sectorRelativeReturn60d: number | null;
      stockReturn20d: number | null;
      stockReturn60d: number | null;
      stockVsSectorReturn20d: number | null;
      stockVsSectorReturn60d: number | null;
      sectorRank20d: number | null;
      sectorRank60d: number | null;
      sectorPercentile20d: number | null;
      sectorPercentile60d: number | null;
    };
    missingFields: string[];
    rawFieldCoverage: SectorThemeCycleRawFieldCoverage;
    providerIssue: boolean;
    marketSignal: false;
    executionImpact: 'NONE' | 'DIAGNOSTIC_ONLY';
    diagnosticOnly: true;
    notes: string[];
  };
  leaderCycle: {
    required: boolean;
    available: boolean;
    status: Gate2ExternalProviderStatus;
    leaderCyclePhase: LeaderCyclePhase;
    isCurrentLeadingSector: boolean | null;
    isSectorLeader: boolean | null;
    isPreviousCycleLeader: boolean | null;
    isNewLeaderCandidate: boolean | null;
    newsFrequency30d: number | null;
    newsCrowdingScore: number | null;
    attentionPhase: AttentionPhase;
    providerIssue: boolean;
    marketSignal: false;
    executionImpact: 'NONE' | 'DIAGNOSTIC_ONLY';
    diagnosticOnly: true;
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
  programTrade?: {
    marketProgram?: QmpProgramFlow | null;
    stockProgram?: QmpProgramFlow | null;
  } | null;
  riskFlow?: unknown;
  sectorThemeCycle?: QmpSectorThemeCycle | unknown | null;
  sectorEnergyResult?: unknown;
  evaluationStage?: Gate2EvaluationStage | null;
}

export type Gate2ConsolidatedHealth = 'OK' | 'WARN' | 'DEGRADED' | 'CONFLICT' | 'STAGE_NOT_FETCHED' | 'UNKNOWN';

export type Gate2ConsolidatedOperatorAction =
  | 'NONE'
  | 'WAIT_FOR_ENTRY_RECHECK'
  | 'CHECK_KIS_INVESTOR_FLOW'
  | 'CHECK_DART_FINANCIALS'
  | 'CHECK_BENCHMARK_PROVIDER'
  | 'CHECK_PROGRAM_FLOW_SCOPE'
  | 'CHECK_RISK_FLOW'
  | 'REVIEW_SECTOR_CYCLE'
  | 'REVIEW_SIGNAL_CONFLICT'
  | 'REVIEW_GATE2_INPUTS';

export type Gate2SignalAlignment =
  | 'BULLISH'
  | 'BEARISH'
  | 'NEUTRAL'
  | 'UNAVAILABLE'
  | 'RISK_HIGH'
  | 'LOW'
  | 'LEADER'
  | 'CROWDED'
  | 'LAGGARD'
  | 'UNKNOWN';

export interface Gate2ConsolidatedDiagnostic {
  health: Gate2ConsolidatedHealth;
  summary: string;
  primaryIssue: string | null;
  operatorAction: Gate2ConsolidatedOperatorAction;
  dataReadiness: {
    inputs: Gate2ExternalProviderStatus | 'OK' | 'DEGRADED';
    kisInvestorFlow: Gate2ExternalProviderStatus;
    dartFinancials: Gate2ExternalProviderStatus;
    benchmark: Gate2ExternalProviderStatus;
    programTrade: Gate2ExternalProviderStatus;
    riskFlow: Gate2ExternalProviderStatus;
    sectorCycle: Gate2ExternalProviderStatus;
  };
  signalAlignment: {
    supply: Gate2SignalAlignment;
    financials: Gate2SignalAlignment;
    relativeStrength: Gate2SignalAlignment;
    passiveFlow: Gate2SignalAlignment;
    riskFlow: Gate2SignalAlignment;
    sectorCycle: Gate2SignalAlignment;
  };
  conflictFlags: string[];
  missingCriticalData: string[];
  providerIssues: string[];
  marketSignal: false;
  providerIssue: boolean;
  executionImpact: 'NONE' | 'DIAGNOSTIC_ONLY';
  diagnosticOnly: true;
  compactText: string;
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

function gate2StatusFromProgramProviderStatus(
  status: KisProgramTradeProviderStatus | null,
  confidence: KisProgramTradeConfidence | null,
): Gate2ExternalProviderStatus | null {
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

function programStageStatus(value: QmpProgramFlow | null | undefined, evaluationStage?: Gate2EvaluationStage | null): Gate2ExternalProviderStatus {
  if (value) {
    return gate2StatusFromProgramProviderStatus(value.providerStatus, value.dataConfidence)
      ?? statusFromMetadata(value)
      ?? 'UNKNOWN';
  }
  return evaluationStage === 'DISCOVERY_GATE' ? 'STAGE_NOT_FETCHED' : 'MISSING';
}

function providerIssueForProgramStatus(status: Gate2ExternalProviderStatus): boolean {
  return !['VERIFIED', 'EMPTY_VALID', 'STAGE_NOT_FETCHED'].includes(status);
}

function providerIssueForOptionalProgramFlow(
  value: QmpProgramFlow | null | undefined,
  status: Gate2ExternalProviderStatus,
  scopeValid: boolean,
): boolean {
  if (!scopeValid) return true;
  if (!value) return false;
  return providerIssueForProgramStatus(status);
}

function programRawFieldCoverage(value: QmpProgramFlow | null | undefined, requiredFields: string[]): KisProgramFlowRawFieldCoverage {
  return value?.rawFieldCoverage ?? {
    requiredFields,
    presentFields: [],
    missingFields: requiredFields,
    allRequiredFieldsPresent: false,
  };
}

function programProviderFromFlows(
  marketProgram: QmpProgramFlow | null | undefined,
  stockProgram: QmpProgramFlow | null | undefined,
): Gate2ExternalDataCoverage['programTrade']['provider'] {
  const sources = [marketProgram?.source, stockProgram?.source].filter(Boolean).map(String);
  if (sources.includes('KIS_OFFICIAL')) return 'KIS_OFFICIAL';
  if (sources.includes('KIS_API')) return 'KIS_API';
  if (sources.includes('CACHE')) return 'CACHE';
  return 'UNKNOWN';
}

function normalizeRiskPressure(value: unknown): Gate2RiskPressure {
  const raw = String(value ?? '').trim().toUpperCase();
  if (raw === 'HIGH' || raw === 'RISK_HIGH' || raw === 'OVERHEATED' || raw === 'BLOCK') return 'HIGH';
  if (raw === 'MEDIUM' || raw === 'MID' || raw === 'WARN') return 'MEDIUM';
  if (raw === 'LOW' || raw === 'OK' || raw === 'NORMAL') return 'LOW';
  return 'UNKNOWN';
}

function pressureFromValue(value: number | null): Gate2RiskPressure {
  if (value == null) return 'UNKNOWN';
  const abs = Math.abs(value);
  if (abs >= 20) return 'HIGH';
  if (abs >= 10) return 'MEDIUM';
  return 'LOW';
}

function maxRiskPressure(values: readonly Gate2RiskPressure[]): Gate2RiskPressure {
  if (values.includes('HIGH')) return 'HIGH';
  if (values.includes('MEDIUM')) return 'MEDIUM';
  if (values.includes('LOW')) return 'LOW';
  return 'UNKNOWN';
}

function riskProviderFromMetadata(value: unknown): Gate2ExternalDataCoverage['riskFlow']['provider'] {
  if (!isRecord(value)) return 'UNKNOWN';
  const raw = String(value.provider ?? value.source ?? value.dataSource ?? '').toUpperCase();
  if (raw.includes('KIS_OFFICIAL')) return 'KIS_OFFICIAL';
  if (raw.includes('KIS')) return 'KIS_API';
  if (raw.includes('KRX')) return 'KRX_CACHE';
  if (raw.includes('QMP')) return 'QMP_CACHE';
  if (raw.includes('CACHE')) return 'CACHE';
  return 'UNKNOWN';
}

function buildGate2RiskFlowCoverage(
  riskFlow: unknown,
  evaluationStage?: Gate2EvaluationStage | null,
): Gate2ExternalDataCoverage['riskFlow'] {
  const record = isRecord(riskFlow) ? riskFlow : {};
  const interpretation = isRecord(record.interpretation) ? record.interpretation : {};
  const shortSaleIncreaseRate = numberOrNull(record.shortSaleIncreaseRate ?? record.shortIncreaseRate ?? record.shortPressureValue);
  const loanIncreaseRate = numberOrNull(record.loanIncreaseRate ?? record.loanPressureValue);
  const creditIncreaseRate = numberOrNull(record.creditIncreaseRate ?? record.creditOverheatValue);
  const creditBalanceRatio = numberOrNull(record.creditBalanceRatio ?? record.creditRate);
  const shortPressure = normalizeRiskPressure(interpretation.shortPressure ?? record.shortPressure) !== 'UNKNOWN'
    ? normalizeRiskPressure(interpretation.shortPressure ?? record.shortPressure)
    : pressureFromValue(shortSaleIncreaseRate);
  const loanPressure = normalizeRiskPressure(interpretation.loanPressure ?? record.loanPressure) !== 'UNKNOWN'
    ? normalizeRiskPressure(interpretation.loanPressure ?? record.loanPressure)
    : pressureFromValue(loanIncreaseRate);
  const creditOverheat = normalizeRiskPressure(interpretation.creditOverheat ?? record.creditOverheat) !== 'UNKNOWN'
    ? normalizeRiskPressure(interpretation.creditOverheat ?? record.creditOverheat)
    : maxRiskPressure([pressureFromValue(creditIncreaseRate), creditBalanceRatio != null && creditBalanceRatio >= 8 ? 'MEDIUM' : pressureFromValue(null)]);
  const overallRisk = normalizeRiskPressure(interpretation.overallRisk ?? record.overallRisk) !== 'UNKNOWN'
    ? normalizeRiskPressure(interpretation.overallRisk ?? record.overallRisk)
    : maxRiskPressure([shortPressure, loanPressure, creditOverheat]);
  const metadataStatus = statusFromMetadata(riskFlow);
  const status: Gate2ExternalProviderStatus = !riskFlow
    ? evaluationStage === 'DISCOVERY_GATE' ? 'STAGE_NOT_FETCHED' : 'MISSING'
    : metadataStatus ?? (overallRisk !== 'UNKNOWN' ? 'VERIFIED' : 'UNKNOWN');
  const providerIssue = Boolean(riskFlow) && !['VERIFIED', 'PARTIAL', 'EMPTY_VALID', 'STAGE_NOT_FETCHED', 'MISSING'].includes(status);
  const notes = unique([
    ...(overallRisk === 'HIGH' ? ['RISK_FLOW_HIGH_DIAGNOSTIC_ONLY'] : []),
    ...(status === 'STAGE_NOT_FETCHED' ? ['RISK_FLOW_STAGE_NOT_FETCHED_NOT_PROVIDER_ERROR'] : []),
  ]);

  return {
    required: false,
    available: status === 'VERIFIED' || status === 'PARTIAL',
    provider: riskProviderFromMetadata(riskFlow),
    status,
    fields: {
      shortPressure: shortPressure !== 'UNKNOWN',
      loanPressure: loanPressure !== 'UNKNOWN',
      creditOverheat: creditOverheat !== 'UNKNOWN',
    },
    values: {
      shortSaleIncreaseRate,
      loanIncreaseRate,
      creditIncreaseRate,
      creditBalanceRatio,
    },
    interpretation: {
      shortPressure,
      loanPressure,
      creditOverheat,
      overallRisk,
    },
    notes,
    stageNotFetched: status === 'STAGE_NOT_FETCHED',
    providerIssue,
    marketSignal: false,
    executionImpact: 'DIAGNOSTIC_ONLY',
    diagnosticOnly: true,
  };
}

function gate2StatusFromSectorThemeCycle(
  providerStatus: SectorThemeCycleProviderStatus | null,
  confidence: SectorThemeCycleConfidence | null,
): Gate2ExternalProviderStatus {
  if (confidence === 'VERIFIED') return 'VERIFIED';
  if (confidence === 'PARTIAL') return 'PARTIAL';
  if (confidence === 'EMPTY_VALID') return 'EMPTY_VALID';
  if (confidence === 'STALE') return 'STALE';
  if (confidence === 'MISSING') return 'MISSING';
  if (confidence === 'DEGRADED' || confidence === 'AI_ESTIMATED') return 'DEGRADED';
  if (providerStatus === 'OK_WITH_DATA') return 'VERIFIED';
  if (providerStatus === 'PARTIAL_WITH_DATA') return 'PARTIAL';
  if (providerStatus === 'OK_EMPTY') return 'EMPTY_VALID';
  if (providerStatus === 'STALE_CACHE') return 'STALE';
  if (providerStatus === 'FIELD_MISSING') return 'MISSING';
  return providerStatus ? 'DEGRADED' : 'UNKNOWN';
}

function providerIssueForSectorStatus(status: Gate2ExternalProviderStatus): boolean {
  return !['VERIFIED', 'PARTIAL', 'EMPTY_VALID', 'STAGE_NOT_FETCHED'].includes(status);
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
  const sectorThemeCycleDiagnostic = normalizeSectorThemeCycleForGate2({
    symbol: quoteSymbol(input),
    quote: input.quote,
    stockMaster: input.stockMaster,
    sectorThemeCycle: input.sectorThemeCycle,
    sectorEnergyResult: input.sectorEnergyResult,
    benchmarkReturn20d: benchmarkDiagnostic.benchmarkReturn,
    market: input.market,
  });
  const sectorCycleStatus = gate2StatusFromSectorThemeCycle(
    sectorThemeCycleDiagnostic.providerStatus,
    sectorThemeCycleDiagnostic.dataConfidence,
  );
  const sectorCycleFields = {
    sector: sectorThemeCycleDiagnostic.sector != null,
    industry: sectorThemeCycleDiagnostic.industry != null,
    themeTags: sectorThemeCycleDiagnostic.themeTags.length > 0,
    sectorReturn20d: sectorThemeCycleDiagnostic.sectorReturn20d != null,
    sectorReturn60d: sectorThemeCycleDiagnostic.sectorReturn60d != null,
    benchmarkReturn20d: sectorThemeCycleDiagnostic.benchmarkReturn20d != null,
    benchmarkReturn60d: sectorThemeCycleDiagnostic.benchmarkReturn60d != null,
    sectorRelativeReturn20d: sectorThemeCycleDiagnostic.sectorRelativeReturn20d != null,
    sectorRelativeReturn60d: sectorThemeCycleDiagnostic.sectorRelativeReturn60d != null,
    stockReturn20d: sectorThemeCycleDiagnostic.stockReturn20d != null,
    stockReturn60d: sectorThemeCycleDiagnostic.stockReturn60d != null,
    stockVsSectorReturn20d: sectorThemeCycleDiagnostic.stockVsSectorReturn20d != null,
    stockVsSectorReturn60d: sectorThemeCycleDiagnostic.stockVsSectorReturn60d != null,
  };
  const marketProgramFlow = input.programTrade?.marketProgram ?? null;
  const stockProgramFlow = input.programTrade?.stockProgram ?? null;
  const marketProgramScopeValid = !marketProgramFlow || marketProgramFlow.scope === 'MARKET';
  const stockProgramScopeValid = !stockProgramFlow || stockProgramFlow.scope === 'STOCK';
  const scopeSeparationValid = marketProgramScopeValid && stockProgramScopeValid;
  const marketProgramBaseStatus = programStageStatus(marketProgramFlow, input.evaluationStage);
  const stockProgramBaseStatus = programStageStatus(stockProgramFlow, input.evaluationStage);
  const marketProgramStatus = marketProgramScopeValid ? marketProgramBaseStatus : 'DEGRADED';
  const stockProgramStatus = stockProgramScopeValid ? stockProgramBaseStatus : 'DEGRADED';
  const marketProgramFields = {
    programNetBuyAmount: marketProgramFlow?.programNetBuyAmount != null,
    arbitrageNetBuyAmount: marketProgramFlow?.arbitrageNetBuyAmount != null,
    nonArbitrageNetBuyAmount: marketProgramFlow?.nonArbitrageNetBuyAmount != null,
  };
  const stockProgramFields = {
    programNetBuyAmount: stockProgramFlow?.programNetBuyAmount != null,
    programNetBuyVolume: stockProgramFlow?.programNetBuyVolume != null,
  };
  const programTradeNotes = unique([
    ...(marketProgramFlow ? ['MARKET_PROGRAM_TRADE_IS_CONTEXT_ONLY_NOT_STOCK_SIGNAL'] : []),
    ...(stockProgramStatus === 'VERIFIED' ? ['STOCK_PROGRAM_TRADE_AVAILABLE_FOR_SYMBOL'] : []),
    ...(marketProgramStatus === 'EMPTY_VALID' || stockProgramStatus === 'EMPTY_VALID' ? ['PROGRAM_TRADE_EMPTY_VALID_NOT_BEARISH'] : []),
    ...(marketProgramFlow && stockProgramStatus === 'STAGE_NOT_FETCHED' ? ['MARKET_PROGRAM_ONLY_STOCK_PROGRAM_NOT_FETCHED'] : []),
    ...(!scopeSeparationValid ? ['SCOPE_MISMATCH_MARKET_DATA_USED_AS_STOCK_FLOW'] : []),
  ]);
  const riskFlowCoverage = buildGate2RiskFlowCoverage(input.riskFlow, input.evaluationStage);

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
    programTrade: {
      required: false,
      available: marketProgramStatus === 'VERIFIED' || stockProgramStatus === 'VERIFIED',
      provider: programProviderFromFlows(marketProgramFlow, stockProgramFlow),
      marketProgram: {
        available: marketProgramScopeValid && marketProgramStatus === 'VERIFIED',
        endpointKey: marketProgramFlow?.endpointKey === 'COMP_PROGRAM_TRADE_TODAY' ? 'COMP_PROGRAM_TRADE_TODAY' : 'UNKNOWN',
        endpoint: marketProgramFlow?.endpoint ?? null,
        trId: marketProgramFlow?.trId ?? null,
        providerStatus: marketProgramFlow?.providerStatus ?? null,
        dataConfidence: marketProgramFlow?.dataConfidence ?? null,
        status: marketProgramStatus,
        scope: 'MARKET',
        fields: marketProgramFields,
        values: {
          programNetBuyAmount: marketProgramFlow?.programNetBuyAmount ?? null,
          arbitrageNetBuyAmount: marketProgramFlow?.arbitrageNetBuyAmount ?? null,
          nonArbitrageNetBuyAmount: marketProgramFlow?.nonArbitrageNetBuyAmount ?? null,
        },
        rawFieldCoverage: programRawFieldCoverage(marketProgramFlow, ['programNetBuyAmount']),
        driftDiagnostics: marketProgramFlow?.driftDiagnostics ?? [],
        stageNotFetched: marketProgramStatus === 'STAGE_NOT_FETCHED',
        providerIssue: providerIssueForOptionalProgramFlow(marketProgramFlow, marketProgramStatus, marketProgramScopeValid),
        marketSignal: false,
      },
      stockProgram: {
        available: stockProgramScopeValid && stockProgramStatus === 'VERIFIED',
        endpointKey: stockProgramFlow?.endpointKey === 'PROGRAM_TRADE_BY_STOCK_DAILY' ? 'PROGRAM_TRADE_BY_STOCK_DAILY' : 'UNKNOWN',
        endpoint: stockProgramFlow?.endpoint ?? null,
        trId: stockProgramFlow?.trId ?? null,
        providerStatus: stockProgramFlow?.providerStatus ?? null,
        dataConfidence: stockProgramFlow?.dataConfidence ?? null,
        status: stockProgramStatus,
        scope: 'STOCK',
        fields: stockProgramFields,
        values: {
          programNetBuyAmount: stockProgramFlow?.programNetBuyAmount ?? null,
          programNetBuyVolume: stockProgramFlow?.programNetBuyVolume ?? null,
        },
        rawFieldCoverage: programRawFieldCoverage(stockProgramFlow, ['programNetBuyAmount']),
        driftDiagnostics: stockProgramFlow?.driftDiagnostics ?? [],
        stageNotFetched: stockProgramStatus === 'STAGE_NOT_FETCHED',
        providerIssue: providerIssueForOptionalProgramFlow(stockProgramFlow, stockProgramStatus, stockProgramScopeValid),
        marketSignal: false,
      },
      scopeSeparationValid,
      notes: programTradeNotes,
      executionImpact: 'DIAGNOSTIC_ONLY',
      marketSignal: false,
    },
    riskFlow: riskFlowCoverage,
    sectorCycle: {
      required: false,
      available: sectorThemeCycleDiagnostic.sector != null && ['VERIFIED', 'PARTIAL'].includes(sectorCycleStatus),
      provider: sectorThemeCycleDiagnostic.source,
      providerStatus: sectorThemeCycleDiagnostic.providerStatus,
      dataConfidence: sectorThemeCycleDiagnostic.dataConfidence,
      status: sectorCycleStatus,
      symbol: sectorThemeCycleDiagnostic.symbol,
      sector: sectorThemeCycleDiagnostic.sector,
      industry: sectorThemeCycleDiagnostic.industry,
      themeTags: sectorThemeCycleDiagnostic.themeTags,
      market: sectorThemeCycleDiagnostic.market,
      fields: sectorCycleFields,
      values: {
        sectorReturn20d: sectorThemeCycleDiagnostic.sectorReturn20d,
        sectorReturn60d: sectorThemeCycleDiagnostic.sectorReturn60d,
        benchmarkReturn20d: sectorThemeCycleDiagnostic.benchmarkReturn20d,
        benchmarkReturn60d: sectorThemeCycleDiagnostic.benchmarkReturn60d,
        sectorRelativeReturn20d: sectorThemeCycleDiagnostic.sectorRelativeReturn20d,
        sectorRelativeReturn60d: sectorThemeCycleDiagnostic.sectorRelativeReturn60d,
        stockReturn20d: sectorThemeCycleDiagnostic.stockReturn20d,
        stockReturn60d: sectorThemeCycleDiagnostic.stockReturn60d,
        stockVsSectorReturn20d: sectorThemeCycleDiagnostic.stockVsSectorReturn20d,
        stockVsSectorReturn60d: sectorThemeCycleDiagnostic.stockVsSectorReturn60d,
        sectorRank20d: sectorThemeCycleDiagnostic.sectorRank20d,
        sectorRank60d: sectorThemeCycleDiagnostic.sectorRank60d,
        sectorPercentile20d: sectorThemeCycleDiagnostic.sectorPercentile20d,
        sectorPercentile60d: sectorThemeCycleDiagnostic.sectorPercentile60d,
      },
      missingFields: sectorThemeCycleDiagnostic.rawFieldCoverage?.missingFields ?? [],
      rawFieldCoverage: sectorThemeCycleDiagnostic.rawFieldCoverage ?? {
        requiredFields: ['sector', 'stockReturn20d', 'sectorReturn20d'],
        presentFields: [],
        missingFields: ['sector', 'stockReturn20d', 'sectorReturn20d'],
        allRequiredFieldsPresent: false,
      },
      providerIssue: providerIssueForSectorStatus(sectorCycleStatus),
      marketSignal: false,
      executionImpact: 'DIAGNOSTIC_ONLY',
      diagnosticOnly: true,
      notes: sectorThemeCycleDiagnostic.notes ?? [],
    },
    leaderCycle: {
      required: false,
      available: sectorThemeCycleDiagnostic.leaderCyclePhase !== 'UNKNOWN'
        && ['VERIFIED', 'PARTIAL'].includes(sectorCycleStatus),
      status: sectorCycleStatus,
      leaderCyclePhase: sectorThemeCycleDiagnostic.leaderCyclePhase,
      isCurrentLeadingSector: sectorThemeCycleDiagnostic.isCurrentLeadingSector,
      isSectorLeader: sectorThemeCycleDiagnostic.isSectorLeader,
      isPreviousCycleLeader: sectorThemeCycleDiagnostic.isPreviousCycleLeader,
      isNewLeaderCandidate: sectorThemeCycleDiagnostic.isNewLeaderCandidate,
      newsFrequency30d: sectorThemeCycleDiagnostic.newsFrequency30d,
      newsCrowdingScore: sectorThemeCycleDiagnostic.newsCrowdingScore,
      attentionPhase: sectorThemeCycleDiagnostic.attentionPhase,
      providerIssue: providerIssueForSectorStatus(sectorCycleStatus),
      marketSignal: false,
      executionImpact: 'DIAGNOSTIC_ONLY',
      diagnosticOnly: true,
      notes: sectorThemeCycleDiagnostic.notes ?? [],
    },
  };
}

function gate2StageNotFetched(external: Gate2ExternalDataCoverage): boolean {
  return external.kisInvestorFlow.status === 'STAGE_NOT_FETCHED'
    && external.dartFinancials.status === 'STAGE_NOT_FETCHED'
    && external.benchmark.status === 'STAGE_NOT_FETCHED';
}

function alignmentFromSigned(value: number | null): Gate2SignalAlignment {
  if (value == null) return 'UNAVAILABLE';
  if (value > 0) return 'BULLISH';
  if (value < 0) return 'BEARISH';
  return 'NEUTRAL';
}

function supplyAlignment(kis: Gate2ExternalDataCoverage['kisInvestorFlow']): Gate2SignalAlignment {
  if (kis.status !== 'VERIFIED') return 'UNAVAILABLE';
  if ((kis.foreignNetBuy ?? 0) > 0 && (kis.institutionalNetBuy ?? 0) > 0) return 'BULLISH';
  if ((kis.foreignNetBuy ?? 0) < 0 && (kis.institutionalNetBuy ?? 0) < 0) return 'BEARISH';
  return 'NEUTRAL';
}

function financialAlignment(dart: Gate2ExternalDataCoverage['dartFinancials']): Gate2SignalAlignment {
  if (dart.status !== 'VERIFIED') return 'UNAVAILABLE';
  const ocfOk = dart.ocfRatio != null && dart.ocfRatio >= 1;
  const roeOk = dart.roe == null || dart.roe > 0;
  const opmOk = dart.opm == null || dart.opm > 0;
  if (ocfOk && roeOk && opmOk) return 'BULLISH';
  if (dart.ocfRatio != null && dart.ocfRatio < 1) return 'BEARISH';
  return 'NEUTRAL';
}

function relativeStrengthAlignment(benchmark: Gate2ExternalDataCoverage['benchmark']): Gate2SignalAlignment {
  if (benchmark.status !== 'VERIFIED') return 'UNAVAILABLE';
  return alignmentFromSigned(benchmark.values.relativeReturn20d);
}

function passiveFlowAlignment(program: Gate2ExternalDataCoverage['programTrade']): Gate2SignalAlignment {
  if (!program.scopeSeparationValid) return 'UNAVAILABLE';
  if (program.stockProgram.status !== 'VERIFIED') return 'UNAVAILABLE';
  return alignmentFromSigned(program.stockProgram.values.programNetBuyAmount);
}

function riskFlowAlignment(risk: Gate2ExternalDataCoverage['riskFlow']): Gate2SignalAlignment {
  if (risk.interpretation.overallRisk === 'HIGH') return 'RISK_HIGH';
  if (risk.interpretation.overallRisk === 'LOW') return 'LOW';
  if (risk.status === 'STAGE_NOT_FETCHED' || risk.status === 'MISSING') return 'UNAVAILABLE';
  return 'UNKNOWN';
}

function sectorCycleAlignment(external: Gate2ExternalDataCoverage): Gate2SignalAlignment {
  const leaderPhase = external.leaderCycle.leaderCyclePhase;
  const attention = external.leaderCycle.attentionPhase;
  if (leaderPhase === 'LATE_CROWDED' || attention === 'CROWDED' || attention === 'OVERHYPED') return 'CROWDED';
  if (leaderPhase === 'LAGGARD' || leaderPhase === 'EX_LEADER') return 'LAGGARD';
  if (leaderPhase === 'EARLY_LEADER' || leaderPhase === 'MID_LEADER') return 'LEADER';
  if (external.sectorCycle.status === 'MISSING' || external.sectorCycle.status === 'STAGE_NOT_FETCHED') return 'UNAVAILABLE';
  return 'UNKNOWN';
}

function gate2ProviderIssues(source: Gate2SourceCoverage | undefined, external: Gate2ExternalDataCoverage): string[] {
  return unique([
    ...(source?.providerIssues ?? []),
    ...(external.kisInvestorFlow.providerIssue ? ['KIS_INVESTOR_FLOW_PROVIDER_ISSUE'] : []),
    ...(external.dartFinancials.providerIssue ? ['DART_FINANCIALS_PROVIDER_ISSUE'] : []),
    ...(external.benchmark.providerIssue ? ['BENCHMARK_PROVIDER_ISSUE'] : []),
    ...(external.programTrade.marketProgram.providerIssue || external.programTrade.stockProgram.providerIssue ? ['PROGRAM_TRADE_PROVIDER_ISSUE'] : []),
    ...(external.riskFlow.providerIssue ? ['RISK_FLOW_PROVIDER_ISSUE'] : []),
    ...(external.sectorCycle.providerIssue ? ['SECTOR_CYCLE_PROVIDER_ISSUE'] : []),
  ]);
}

function missingCriticalDataFor(source: Gate2SourceCoverage | undefined, external: Gate2ExternalDataCoverage): string[] {
  return unique([
    ...(source?.missingExternalData ?? []),
    ...(external.kisInvestorFlow.status === 'MISSING' || external.kisInvestorFlow.status === 'DEGRADED' ? ['KIS_INVESTOR_FLOW'] : []),
    ...(external.dartFinancials.status === 'MISSING' || external.dartFinancials.status === 'DEGRADED' || external.dartFinancials.status === 'EMPTY_VALID' ? ['DART_FINANCIALS'] : []),
    ...(external.benchmark.status === 'MISSING' || external.benchmark.status === 'DEGRADED' ? ['BENCHMARK_20D_RETURN'] : []),
  ]);
}

function buildGate2Summary(health: Gate2ConsolidatedHealth, primaryIssue: string | null): string {
  if (health === 'OK') return 'Gate2 diagnostics OK; supply, financials, benchmark, and advisory context are available.';
  if (health === 'STAGE_NOT_FETCHED') return 'Gate2 external data is intentionally not fetched at discovery stage.';
  if (health === 'CONFLICT') return 'Gate2 diagnostic signals conflict; review before interpreting the score.';
  if (primaryIssue) return `Gate2 diagnostic issue: ${primaryIssue}.`;
  return 'Gate2 diagnostics are advisory; scoring and execution policy are unchanged.';
}

export function buildGate2ConsolidatedDiagnostic(input: {
  gate2: {
    sourceCoverage?: Gate2SourceCoverage;
    externalDataCoverage?: Gate2ExternalDataCoverage;
  } | null | undefined;
}): Gate2ConsolidatedDiagnostic {
  const source = input.gate2?.sourceCoverage;
  const external = input.gate2?.externalDataCoverage;
  if (!source || !external) {
    return {
      health: 'UNKNOWN',
      summary: buildGate2Summary('UNKNOWN', 'GATE2_DIAGNOSTIC_MISSING'),
      primaryIssue: 'GATE2_DIAGNOSTIC_MISSING',
      operatorAction: 'REVIEW_GATE2_INPUTS',
      dataReadiness: {
        inputs: 'UNKNOWN',
        kisInvestorFlow: 'UNKNOWN',
        dartFinancials: 'UNKNOWN',
        benchmark: 'UNKNOWN',
        programTrade: 'UNKNOWN',
        riskFlow: 'UNKNOWN',
        sectorCycle: 'UNKNOWN',
      },
      signalAlignment: {
        supply: 'UNKNOWN',
        financials: 'UNKNOWN',
        relativeStrength: 'UNKNOWN',
        passiveFlow: 'UNKNOWN',
        riskFlow: 'UNKNOWN',
        sectorCycle: 'UNKNOWN',
      },
      conflictFlags: [],
      missingCriticalData: [],
      providerIssues: [],
      marketSignal: false,
      providerIssue: true,
      executionImpact: 'DIAGNOSTIC_ONLY',
      diagnosticOnly: true,
      compactText: 'Gate2: UNKNOWN | issue=GATE2_DIAGNOSTIC_MISSING | action=REVIEW_GATE2_INPUTS | marketSignal=false',
    };
  }

  const signalAlignment = {
    supply: supplyAlignment(external.kisInvestorFlow),
    financials: financialAlignment(external.dartFinancials),
    relativeStrength: relativeStrengthAlignment(external.benchmark),
    passiveFlow: passiveFlowAlignment(external.programTrade),
    riskFlow: riskFlowAlignment(external.riskFlow),
    sectorCycle: sectorCycleAlignment(external),
  };
  const conflictFlags = unique([
    ...(signalAlignment.supply === 'BULLISH' && signalAlignment.financials === 'BULLISH' && signalAlignment.relativeStrength === 'BEARISH' ? ['RS_CONFLICT'] : []),
    ...(signalAlignment.supply === 'BULLISH' && signalAlignment.sectorCycle === 'LAGGARD' ? ['SECTOR_CONFLICT'] : []),
  ]);
  const missingCriticalData = missingCriticalDataFor(source, external);
  const stageNotFetched = gate2StageNotFetched(external);
  const providerIssues = stageNotFetched ? [] : gate2ProviderIssues(source, external);

  let health: Gate2ConsolidatedHealth = 'OK';
  let primaryIssue: string | null = null;
  let operatorAction: Gate2ConsolidatedOperatorAction = 'NONE';

  if (stageNotFetched) {
    health = 'STAGE_NOT_FETCHED';
    primaryIssue = 'GATE2_STAGE_NOT_FETCHED';
    operatorAction = 'WAIT_FOR_ENTRY_RECHECK';
  } else if (!external.programTrade.scopeSeparationValid) {
    health = 'DEGRADED';
    primaryIssue = 'PROGRAM_FLOW_SCOPE_MISMATCH';
    operatorAction = 'CHECK_PROGRAM_FLOW_SCOPE';
  } else if (external.kisInvestorFlow.status === 'MISSING' || external.kisInvestorFlow.status === 'DEGRADED') {
    health = 'DEGRADED';
    primaryIssue = 'KIS_INVESTOR_FLOW_UNAVAILABLE';
    operatorAction = 'CHECK_KIS_INVESTOR_FLOW';
  } else if (external.dartFinancials.status === 'MISSING' || external.dartFinancials.status === 'DEGRADED' || external.dartFinancials.status === 'EMPTY_VALID') {
    health = 'DEGRADED';
    primaryIssue = 'DART_FINANCIALS_UNAVAILABLE';
    operatorAction = 'CHECK_DART_FINANCIALS';
  } else if (external.benchmark.status === 'MISSING' || external.benchmark.status === 'DEGRADED') {
    health = 'DEGRADED';
    primaryIssue = 'BENCHMARK_UNAVAILABLE';
    operatorAction = 'CHECK_BENCHMARK_PROVIDER';
  } else if (conflictFlags.length > 0) {
    health = 'CONFLICT';
    primaryIssue = 'GATE2_SIGNAL_CONFLICT';
    operatorAction = 'REVIEW_SIGNAL_CONFLICT';
  } else if (signalAlignment.riskFlow === 'RISK_HIGH') {
    health = 'WARN';
    primaryIssue = 'RISK_FLOW_HIGH_DIAGNOSTIC_ONLY';
    operatorAction = 'CHECK_RISK_FLOW';
  } else if (signalAlignment.sectorCycle === 'CROWDED') {
    health = 'WARN';
    primaryIssue = 'SECTOR_CYCLE_CROWDED_DIAGNOSTIC_ONLY';
    operatorAction = 'REVIEW_SECTOR_CYCLE';
  } else if (!source.allDeclaredInputsAvailable || !source.allExternalDataAvailable) {
    health = 'DEGRADED';
    primaryIssue = 'GATE2_INPUT_MISSING';
    operatorAction = 'REVIEW_GATE2_INPUTS';
  }

  const programStatus = external.programTrade.stockProgram.status !== 'STAGE_NOT_FETCHED'
    ? external.programTrade.stockProgram.status
    : external.programTrade.marketProgram.status;
  const compactText = [
    `Gate2: ${health}`,
    ...(primaryIssue ? [`issue=${primaryIssue}`] : []),
    `KIS=${external.kisInvestorFlow.status}`,
    `DART=${external.dartFinancials.status}`,
    `Benchmark=${external.benchmark.status}`,
    `Program=${programStatus}`,
    `Risk=${external.riskFlow.interpretation.overallRisk}`,
    `Sector=${signalAlignment.sectorCycle}`,
    ...(operatorAction !== 'NONE' ? [`action=${operatorAction}`] : []),
    'marketSignal=false',
  ].join(' | ');

  return {
    health,
    summary: buildGate2Summary(health, primaryIssue),
    primaryIssue,
    operatorAction,
    dataReadiness: {
      inputs: source.allDeclaredInputsAvailable && source.allExternalDataAvailable ? 'OK' : 'DEGRADED',
      kisInvestorFlow: external.kisInvestorFlow.status,
      dartFinancials: external.dartFinancials.status,
      benchmark: external.benchmark.status,
      programTrade: programStatus,
      riskFlow: external.riskFlow.status,
      sectorCycle: external.sectorCycle.status,
    },
    signalAlignment,
    conflictFlags,
    missingCriticalData,
    providerIssues,
    marketSignal: false,
    providerIssue: providerIssues.length > 0,
    executionImpact: health === 'OK' ? 'NONE' : 'DIAGNOSTIC_ONLY',
    diagnosticOnly: true,
    compactText,
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
    `Program=${external.programTrade.stockProgram.status}/${external.programTrade.marketProgram.status}`,
    `Risk=${external.riskFlow.status}`,
    `Sector=${external.sectorCycle.status}`,
    `Leader=${external.leaderCycle.leaderCyclePhase}`,
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
