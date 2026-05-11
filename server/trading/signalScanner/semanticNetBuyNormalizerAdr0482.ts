// @responsibility ADR-0482 provider-agnostic semantic net-buy normalizer; SHADOW_ONLY diagnostics only.
import {
  buildInvestorSampleDiagnosticsAdr0502,
  formatInvestorSampleDiagnosticsAdr0502,
  type InvestorSampleDiagnosticsAdr0502,
  type InvestorSampleInputSourceKindAdr0502,
} from './investorSampleMaterializationAdr0502.js';

export type SemanticNetBuyProvider =
  | 'NAVER'
  | 'KIS'
  | 'KRX'
  | 'FSS'
  | 'CACHE'
  | 'MANUAL'
  | 'UNKNOWN';

export type SemanticNetBuyStatus =
  | 'VERIFIED'
  | 'PARTIAL'
  | 'STALE'
  | 'EMPTY'
  | 'DATA_UNAVAILABLE'
  | 'PROVIDER_MISMATCH'
  | 'PARSE_ERROR'
  | 'PROVIDER_ERROR'
  | 'NON_TRADING_DAY'
  | 'DISABLED';

export type SemanticNetBuySignal =
  | 'BULLISH'
  | 'NEUTRAL'
  | 'BEARISH'
  | 'UNKNOWN';

export type SemanticNetBuyConfidence =
  | 'HIGH'
  | 'MEDIUM'
  | 'LOW'
  | 'NONE';

export interface SemanticNetBuyInputPoint {
  code: string;
  provider: SemanticNetBuyProvider;
  sourceDate: string | null;
  collectedAt?: string | null;
  rawForeignNetBuy?: number | string | null;
  rawInstitutionNetBuy?: number | string | null;
  rawProgramNetBuy?: number | string | null;
  rawIndividualNetBuy?: number | string | null;
  unit?: 'KRW' | 'THOUSAND_KRW' | 'MILLION_KRW' | 'SHARES' | 'UNKNOWN';
  status?: string;
  diagnostics?: string[];
  sourceAgeTradingDays?: number | null;
  providerSemanticCapable?: boolean;
}

export interface SemanticNetBuySampleAdr0482 {
  code: string;
  provider: SemanticNetBuyProvider;
  sourceDate: string | null;
  collectedAt: string;
  foreignNetBuy: number | null;
  institutionNetBuy: number | null;
  programNetBuy: number | null;
  individualNetBuy: number | null;
  totalSmartMoneyNetBuy: number | null;
  unit: 'KRW' | 'SHARES' | 'UNKNOWN';
  status: SemanticNetBuyStatus;
  signal: SemanticNetBuySignal;
  confidence: SemanticNetBuyConfidence;
  freshness: {
    sourceState: 'FRESH' | 'STALE' | 'MISSING' | 'UNKNOWN';
    sourceAgeTradingDays: number | null;
    lastSourceDate: string | null;
  };
  coverage: {
    foreignAvailable: boolean;
    institutionAvailable: boolean;
    programAvailable: boolean;
    individualAvailable: boolean;
    availableFields: number;
    totalFields: number;
  };
  quality: {
    parseOk: boolean;
    unitNormalized: boolean;
    hasMinimumFields: boolean;
    isProviderIssue: boolean;
    isMarketSignal: boolean;
  };
  executionImpact: 'NONE';
  liveExecutionAllowed: false;
  rawPayloadPersistenceAllowed: false;
  policyPromotionMode: 'SHADOW_ONLY';
  operatorApprovalRequired: true;
  diagnostics: string[];
}

export interface SemanticNetBuyNormalizationReportAdr0482 {
  generatedAt: string;
  code: string;
  samples: SemanticNetBuySampleAdr0482[];
  selectedSample: SemanticNetBuySampleAdr0482 | null;
  inputSources: SemanticNetBuyProvider[];
  materializationDiagnostics: InvestorSampleDiagnosticsAdr0502;
  providerRanking: SemanticNetBuyProvider[];
  status: SemanticNetBuyStatus;
  signal: SemanticNetBuySignal;
  confidence: SemanticNetBuyConfidence;
  executionImpact: 'NONE';
  liveExecutionAllowed: false;
  rawPayloadPersistenceAllowed: false;
  policyPromotionMode: 'SHADOW_ONLY';
  operatorApprovalRequired: true;
  diagnostics: string[];
}

export interface BuildSemanticNetBuyNormalizationReportInputAdr0482 {
  code: string;
  generatedAt?: string;
  inputs?: readonly SemanticNetBuyInputPoint[];
}

const ADR_0482_POLICY = {
  executionImpact: 'NONE',
  liveExecutionAllowed: false,
  rawPayloadPersistenceAllowed: false,
  policyPromotionMode: 'SHADOW_ONLY',
  operatorApprovalRequired: true,
} as const;

const STALE_TRADING_DAYS = 4;
const PROVIDER_ORDER: SemanticNetBuyProvider[] = ['NAVER', 'KRX', 'FSS', 'CACHE', 'MANUAL', 'KIS', 'UNKNOWN'];
const ERROR_STATUSES: SemanticNetBuyStatus[] = ['PROVIDER_MISMATCH', 'PARSE_ERROR', 'PROVIDER_ERROR', 'NON_TRADING_DAY', 'DISABLED'];

function finiteNumber(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value);
}

function parseNumeric(value: number | string | null | undefined): { value: number | null; parseOk: boolean } {
  if (value === null || value === undefined || value === '') return { value: null, parseOk: true };
  if (finiteNumber(value)) return { value, parseOk: true };
  if (typeof value !== 'string') return { value: null, parseOk: false };
  const trimmed = value.trim();
  if (trimmed.length === 0) return { value: null, parseOk: true };
  const parenthesized = /^\((.*)\)$/.exec(trimmed);
  const normalized = (parenthesized?.[1] ?? trimmed).replace(/,/g, '');
  if (!/^[+-]?(\d+\.?\d*|\.\d+)$/.test(normalized)) return { value: null, parseOk: false };
  const parsed = Number(normalized);
  if (!Number.isFinite(parsed)) return { value: null, parseOk: false };
  return { value: parenthesized ? -parsed : parsed, parseOk: true };
}

function normalizeUnitValue(value: number | null, unit: SemanticNetBuyInputPoint['unit']): number | null {
  if (value === null) return null;
  if (unit === 'THOUSAND_KRW') return value * 1_000;
  if (unit === 'MILLION_KRW') return value * 1_000_000;
  return value;
}

function outputUnit(unit: SemanticNetBuyInputPoint['unit']): SemanticNetBuySampleAdr0482['unit'] {
  if (unit === 'SHARES') return 'SHARES';
  if (unit === 'KRW' || unit === 'THOUSAND_KRW' || unit === 'MILLION_KRW') return 'KRW';
  return 'UNKNOWN';
}

function normalizedExplicitStatus(input: SemanticNetBuyInputPoint): SemanticNetBuyStatus | null {
  const upper = (input.status ?? '').trim().toUpperCase();
  if (upper === '') return null;
  if (upper === 'OK' || upper === 'DATA_AVAILABLE') return 'VERIFIED';
  if (upper === 'CACHE_EMPTY') return 'EMPTY';
  if (upper === 'ERROR' || upper === 'HTTP_400' || upper === 'HTTP_403' || upper === 'HTTP_429' || upper === 'HTTP_5XX' || upper === 'TIMEOUT' || upper === 'UNKNOWN_ERROR') return 'PROVIDER_ERROR';
  if (upper === 'PARSER_EMPTY_ROWS') return 'EMPTY';
  const allowed: SemanticNetBuyStatus[] = ['VERIFIED', 'PARTIAL', 'STALE', 'EMPTY', 'DATA_UNAVAILABLE', 'PROVIDER_MISMATCH', 'PARSE_ERROR', 'PROVIDER_ERROR', 'NON_TRADING_DAY', 'DISABLED'];
  return allowed.includes(upper as SemanticNetBuyStatus) ? upper as SemanticNetBuyStatus : null;
}

function isProviderMismatch(input: SemanticNetBuyInputPoint, explicit: SemanticNetBuyStatus | null): boolean {
  if (explicit === 'PROVIDER_MISMATCH') return true;
  if (input.provider === 'KIS') return input.providerSemanticCapable !== true && explicit !== 'VERIFIED' && explicit !== 'PARTIAL';
  if (input.provider === 'FSS') return input.providerSemanticCapable !== true && explicit !== 'VERIFIED' && explicit !== 'PARTIAL';
  if (input.provider === 'UNKNOWN') return explicit !== 'VERIFIED' && explicit !== 'PARTIAL';
  return false;
}

function deriveFreshness(input: SemanticNetBuyInputPoint, explicitStatus: SemanticNetBuyStatus | null): SemanticNetBuySampleAdr0482['freshness'] {
  const age = finiteNumber(input.sourceAgeTradingDays) ? input.sourceAgeTradingDays : null;
  if (!input.sourceDate) return { sourceState: explicitStatus === 'DISABLED' ? 'UNKNOWN' : 'MISSING', sourceAgeTradingDays: age, lastSourceDate: null };
  if (explicitStatus === 'STALE' || (age !== null && age >= STALE_TRADING_DAYS)) return { sourceState: 'STALE', sourceAgeTradingDays: age, lastSourceDate: input.sourceDate };
  return { sourceState: age === null ? 'UNKNOWN' : 'FRESH', sourceAgeTradingDays: age, lastSourceDate: input.sourceDate };
}

function confidenceFor(input: {
  status: SemanticNetBuyStatus;
  parseOk: boolean;
  unitNormalized: boolean;
  foreignAvailable: boolean;
  institutionAvailable: boolean;
  stale: boolean;
}): SemanticNetBuyConfidence {
  if (!input.parseOk || ERROR_STATUSES.includes(input.status) || input.status === 'EMPTY' || input.status === 'DATA_UNAVAILABLE') return 'NONE';
  if (input.stale || !input.unitNormalized) return input.foreignAvailable || input.institutionAvailable ? 'LOW' : 'NONE';
  if (input.foreignAvailable && input.institutionAvailable) return 'HIGH';
  if (input.foreignAvailable || input.institutionAvailable) return 'MEDIUM';
  return 'NONE';
}

function deriveStatus(input: {
  explicit: SemanticNetBuyStatus | null;
  parseOk: boolean;
  providerMismatch: boolean;
  anyNumeric: boolean;
  bothCore: boolean;
  oneCore: boolean;
  stale: boolean;
}): SemanticNetBuyStatus {
  if (input.providerMismatch) return 'PROVIDER_MISMATCH';
  if (input.explicit && ERROR_STATUSES.includes(input.explicit)) return input.explicit;
  if (!input.parseOk || input.explicit === 'PARSE_ERROR') return 'PARSE_ERROR';
  if (input.stale || input.explicit === 'STALE') return 'STALE';
  if (!input.anyNumeric) return input.explicit === 'DATA_UNAVAILABLE' ? 'DATA_UNAVAILABLE' : 'EMPTY';
  if (input.explicit === 'DATA_UNAVAILABLE') return 'DATA_UNAVAILABLE';
  if (input.bothCore) return 'VERIFIED';
  if (input.oneCore) return 'PARTIAL';
  return 'EMPTY';
}

function deriveSignal(input: {
  status: SemanticNetBuyStatus;
  confidence: SemanticNetBuyConfidence;
  totalSmartMoneyNetBuy: number | null;
  foreignNetBuy: number | null;
  institutionNetBuy: number | null;
}): SemanticNetBuySignal {
  if (input.status === 'PARTIAL') {
    if (input.confidence !== 'HIGH' && input.confidence !== 'MEDIUM') return 'UNKNOWN';
    const singleCore = input.foreignNetBuy ?? input.institutionNetBuy;
    return finiteNumber(singleCore) && singleCore > 0 ? 'BULLISH' : 'UNKNOWN';
  }
  if (input.status !== 'VERIFIED') return 'UNKNOWN';
  if (input.confidence !== 'HIGH' && input.confidence !== 'MEDIUM') return 'UNKNOWN';
  if (!finiteNumber(input.totalSmartMoneyNetBuy)) return 'UNKNOWN';
  if (input.totalSmartMoneyNetBuy > 0) return 'BULLISH';
  if (input.totalSmartMoneyNetBuy < 0) return 'BEARISH';
  return 'NEUTRAL';
}

export function normalizeSemanticNetBuySampleAdr0482(input: SemanticNetBuyInputPoint): SemanticNetBuySampleAdr0482 {
  const unit = input.unit ?? 'UNKNOWN';
  const explicit = normalizedExplicitStatus(input);
  const parsed = {
    foreign: parseNumeric(input.rawForeignNetBuy),
    institution: parseNumeric(input.rawInstitutionNetBuy),
    program: parseNumeric(input.rawProgramNetBuy),
    individual: parseNumeric(input.rawIndividualNetBuy),
  };
  const parseOk = parsed.foreign.parseOk && parsed.institution.parseOk && parsed.program.parseOk && parsed.individual.parseOk;
  const foreignNetBuy = normalizeUnitValue(parsed.foreign.value, unit);
  const institutionNetBuy = normalizeUnitValue(parsed.institution.value, unit);
  const programNetBuy = normalizeUnitValue(parsed.program.value, unit);
  const individualNetBuy = normalizeUnitValue(parsed.individual.value, unit);
  const foreignAvailable = finiteNumber(foreignNetBuy);
  const institutionAvailable = finiteNumber(institutionNetBuy);
  const programAvailable = finiteNumber(programNetBuy);
  const individualAvailable = finiteNumber(individualNetBuy);
  const availableFields = [foreignAvailable, institutionAvailable, programAvailable, individualAvailable].filter(Boolean).length;
  const totalSmartMoneyNetBuy = foreignAvailable && institutionAvailable ? foreignNetBuy! + institutionNetBuy! : null;
  const freshness = deriveFreshness(input, explicit);
  const providerMismatch = isProviderMismatch(input, explicit);
  const status = deriveStatus({
    explicit,
    parseOk,
    providerMismatch,
    anyNumeric: availableFields > 0,
    bothCore: foreignAvailable && institutionAvailable,
    oneCore: foreignAvailable || institutionAvailable,
    stale: freshness.sourceState === 'STALE',
  });
  const unitNormalized = unit === 'KRW' || unit === 'THOUSAND_KRW' || unit === 'MILLION_KRW' || unit === 'SHARES';
  const confidence = confidenceFor({ status, parseOk, unitNormalized, foreignAvailable, institutionAvailable, stale: freshness.sourceState === 'STALE' });
  const signal = deriveSignal({ status, confidence, totalSmartMoneyNetBuy, foreignNetBuy, institutionNetBuy });
  const isProviderIssue = status !== 'VERIFIED' && status !== 'PARTIAL';
  const isMarketSignal = (status === 'VERIFIED' || status === 'PARTIAL') && signal !== 'UNKNOWN';
  return {
    code: input.code,
    provider: input.provider,
    sourceDate: input.sourceDate,
    collectedAt: input.collectedAt ?? new Date().toISOString(),
    foreignNetBuy,
    institutionNetBuy,
    programNetBuy,
    individualNetBuy,
    totalSmartMoneyNetBuy,
    unit: outputUnit(unit),
    status,
    signal,
    confidence,
    freshness,
    coverage: {
      foreignAvailable,
      institutionAvailable,
      programAvailable,
      individualAvailable,
      availableFields,
      totalFields: 4,
    },
    quality: {
      parseOk,
      unitNormalized,
      hasMinimumFields: foreignAvailable || institutionAvailable,
      isProviderIssue,
      isMarketSignal,
    },
    ...ADR_0482_POLICY,
    diagnostics: [
      'ADR-0482 semantic net-buy normalized as SHADOW_ONLY diagnostic sample.',
      `provider=${input.provider}`,
      `status=${status}`,
      `signal=${signal}`,
      ...(input.diagnostics ?? []),
    ],
  };
}

function selectable(sample: SemanticNetBuySampleAdr0482): boolean {
  if (sample.status !== 'VERIFIED' && sample.status !== 'PARTIAL') return false;
  if (sample.status === 'PARTIAL' && sample.confidence !== 'HIGH' && sample.confidence !== 'MEDIUM') return false;
  if (sample.quality.isProviderIssue) return false;
  return sample.confidence === 'HIGH' || sample.confidence === 'MEDIUM';
}

function scoreSample(sample: SemanticNetBuySampleAdr0482): number {
  const providerRank = PROVIDER_ORDER.indexOf(sample.provider);
  const providerScore = providerRank >= 0 ? (PROVIDER_ORDER.length - providerRank) * 10 : 0;
  const statusScore = sample.status === 'VERIFIED' ? 100 : sample.status === 'PARTIAL' ? 60 : 0;
  const confidenceScore = sample.confidence === 'HIGH' ? 30 : sample.confidence === 'MEDIUM' ? 20 : sample.confidence === 'LOW' ? 5 : 0;
  return statusScore + confidenceScore + providerScore + sample.coverage.availableFields;
}

function semanticInputSourceKind(samples: readonly SemanticNetBuySampleAdr0482[], inputsCount: number): InvestorSampleInputSourceKindAdr0502 {
  if (inputsCount === 0) return 'NONE';
  if (samples.some((sample) => sample.provider === 'CACHE')) return 'CACHE_FALLBACK';
  if (samples.some((sample) => sample.provider === 'MANUAL' || sample.provider === 'UNKNOWN')) return 'SEMANTIC_DERIVED';
  return 'NORMALIZED_PROVIDER';
}

function buildSemanticMaterializationDiagnostics(input: {
  code: string;
  inputsCount: number;
  samples: readonly SemanticNetBuySampleAdr0482[];
  selectedSample: SemanticNetBuySampleAdr0482 | null;
}): InvestorSampleDiagnosticsAdr0502 {
  const materializedSamples = input.samples.filter((sample) => sample.coverage.availableFields > 0 && sample.status !== 'PROVIDER_ERROR' && sample.status !== 'PARSE_ERROR' && sample.status !== 'PROVIDER_MISMATCH' && sample.status !== 'DATA_UNAVAILABLE' && sample.status !== 'EMPTY');
  const latest = input.selectedSample ?? materializedSamples[0] ?? null;
  const realInputSources = Array.from(new Set(input.samples.map((sample) => sample.provider)));
  const inputSourceKind = semanticInputSourceKind(input.samples, input.inputsCount);
  const placeholderDetected = input.inputsCount === 0 || input.samples.length === 0 || realInputSources.length === 0;
  const avgFieldCoverage = input.samples.length === 0
    ? 0
    : input.samples.reduce((sum, sample) => sum + (sample.coverage.availableFields / sample.coverage.totalFields), 0) / input.samples.length;
  return buildInvestorSampleDiagnosticsAdr0502({
    providerName: 'SEMANTIC_NETBUY',
    rawFetched: input.inputsCount > 0,
    rawCount: input.inputsCount,
    normalizedCount: input.samples.length,
    materializedCount: materializedSamples.length,
    symbolCoverage: input.code ? 1 : 0,
    dateCoverage: latest?.sourceDate ?? null,
    fieldCoverage: avgFieldCoverage,
    placeholderDetected,
    inputSourceKind,
    inputSources: realInputSources,
    lastSuccessfulSampleAt: latest?.sourceDate ?? null,
    confidenceLevel: input.selectedSample?.confidence === 'HIGH' ? 'VERIFIED'
      : input.selectedSample?.confidence === 'MEDIUM' ? 'PARTIAL'
        : materializedSamples.some((sample) => sample.status === 'STALE') ? 'DEGRADED'
          : materializedSamples.length > 0 ? 'LOW' : 'MISSING',
    blockedReason: input.inputsCount === 0 ? 'NO_INPUT_SAMPLE'
      : placeholderDetected ? 'PLACEHOLDER_ONLY'
        : inputSourceKind === 'SEMANTIC_DERIVED' || inputSourceKind === 'AI_ESTIMATED' ? 'NO_REAL_INPUT_SOURCE'
          : undefined,
    staleReason: materializedSamples.some((sample) => sample.status === 'STALE') ? 'STALE_INPUT_ONLY' : null,
    safePreview: materializedSamples.slice(0, 3).map((sample) => ({
      code: sample.code,
      provider: sample.provider,
      sourceDate: sample.sourceDate,
      foreignNetBuy: sample.foreignNetBuy,
      institutionNetBuy: sample.institutionNetBuy,
      status: sample.status,
    })),
  });
}

export function buildSemanticNetBuyNormalizationReportAdr0482(
  input: BuildSemanticNetBuyNormalizationReportInputAdr0482,
): SemanticNetBuyNormalizationReportAdr0482 {
  const samples = (input.inputs ?? []).map(normalizeSemanticNetBuySampleAdr0482);
  const selectedSample = samples
    .filter(selectable)
    .sort((a, b) => scoreSample(b) - scoreSample(a))[0] ?? null;
  const inputSources = Array.from(new Set(samples.map((sample) => sample.provider)));
  const materializationDiagnostics = buildSemanticMaterializationDiagnostics({
    code: input.code,
    inputsCount: input.inputs?.length ?? 0,
    samples,
    selectedSample,
  });
  return {
    generatedAt: input.generatedAt ?? new Date().toISOString(),
    code: input.code,
    samples,
    selectedSample,
    inputSources,
    materializationDiagnostics,
    providerRanking: [...PROVIDER_ORDER],
    status: selectedSample?.status ?? (samples[0]?.status ?? 'DATA_UNAVAILABLE'),
    signal: selectedSample?.signal ?? 'UNKNOWN',
    confidence: selectedSample?.confidence ?? 'NONE',
    ...ADR_0482_POLICY,
    diagnostics: selectedSample
      ? [`ADR-0482 selected ${selectedSample.provider} semantic sample.`, `status=${selectedSample.status}`, `signal=${selectedSample.signal}`, formatInvestorSampleDiagnosticsAdr0502(materializationDiagnostics)]
      : [input.inputs?.length ? 'ADR-0482 normalizer found no usable semantic sample.' : 'INPUT_SAMPLE_UNAVAILABLE', formatInvestorSampleDiagnosticsAdr0502(materializationDiagnostics), 'UNKNOWN/provider issue is not bearish.'],
  };
}

export function safeBuildSemanticNetBuyNormalizationReportAdr0482(
  input: BuildSemanticNetBuyNormalizationReportInputAdr0482,
): SemanticNetBuyNormalizationReportAdr0482 {
  try {
    return buildSemanticNetBuyNormalizationReportAdr0482(input);
  } catch (error) {
    return {
      generatedAt: input.generatedAt ?? new Date().toISOString(),
      code: input.code,
      samples: [],
      selectedSample: null,
      inputSources: [],
      materializationDiagnostics: buildInvestorSampleDiagnosticsAdr0502({
        providerName: 'SEMANTIC_NETBUY',
        rawFetched: false,
        rawCount: 0,
        normalizedCount: 0,
        materializedCount: 0,
        placeholderDetected: true,
        inputSourceKind: 'NONE',
        blockedReason: 'PROVIDER_ERROR',
        hardBlocked: true,
      }),
      providerRanking: [...PROVIDER_ORDER],
      status: 'PROVIDER_ERROR',
      signal: 'UNKNOWN',
      confidence: 'NONE',
      ...ADR_0482_POLICY,
      diagnostics: ['ADR-0482 normalizer failure isolated; scan and Shadow Learning continue.', error instanceof Error ? error.message : String(error)],
    };
  }
}

export function formatSemanticNetBuyCompactAdr0482(report?: SemanticNetBuyNormalizationReportAdr0482 | null): string | null {
  if (!report) return null;
  return `ADR-0482 SemanticNetBuy: ${report.status} | selected=${report.selectedSample?.provider ?? 'NONE'} | signal=${report.signal} | confidence=${report.confidence} | impact=${report.executionImpact}`;
}

export function formatSemanticNetBuyDetailAdr0482(report?: SemanticNetBuyNormalizationReportAdr0482 | null): string | null {
  if (!report) return null;
  const selected = report.selectedSample;
  return [
    '🧮 ADR-0482 Semantic Net-Buy Normalizer',
    `- code: ${report.code}`,
    `- status: ${report.status}`,
    `- selected: ${selected?.provider ?? 'NONE'}`,
    `- signal: ${report.signal}`,
    `- confidence: ${report.confidence}`,
    `- sampleCount: ${report.samples.length}`,
    `- inputSources: ${report.inputSources.join(',') || 'NONE'}`,
    `- selectedSample: ${selected ? `provider=${selected.provider}, status=${selected.status}, signal=${selected.signal}, unit=${selected.unit}, sourceDate=${selected.sourceDate ?? 'none'}, totalSmartMoneyNetBuy=${selected.totalSmartMoneyNetBuy ?? 'null'}` : 'none'}`,
    `- materialization: ${formatInvestorSampleDiagnosticsAdr0502(report.materializationDiagnostics)}`,
    `- executionImpact: ${report.executionImpact}`,
    `- liveExecutionAllowed: ${report.liveExecutionAllowed}`,
    `- policyPromotionMode: ${report.policyPromotionMode}`,
    `- operatorApprovalRequired: ${report.operatorApprovalRequired}`,
    `- diagnostics: ${report.diagnostics.join(' | ')}`,
  ].join('\n');
}

export interface SemanticNetBuyDetailRegistryEntryAdr0482 {
  adr: '0482';
  sectionId: 'semantic_net_buy_normalizer';
  commandHint: '/supply_health_detail';
  scanBlockersDetailHint: '/scan_blockers_detail semantic_net_buy_normalizer';
  adrTraceHint: '/adr_trace 0482';
  executionImpact: 'NONE';
  liveExecutionAllowed: false;
  render: () => string;
}

export function getSemanticNetBuyDetailRegistryEntryAdr0482(report: SemanticNetBuyNormalizationReportAdr0482): SemanticNetBuyDetailRegistryEntryAdr0482 {
  return {
    adr: '0482',
    sectionId: 'semantic_net_buy_normalizer',
    commandHint: '/supply_health_detail',
    scanBlockersDetailHint: '/scan_blockers_detail semantic_net_buy_normalizer',
    adrTraceHint: '/adr_trace 0482',
    executionImpact: 'NONE',
    liveExecutionAllowed: false,
    render: () => formatSemanticNetBuyDetailAdr0482(report) ?? '',
  };
}
