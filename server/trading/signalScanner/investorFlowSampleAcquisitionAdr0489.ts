// @responsibility ADR-0489 InvestorFlow sample acquisition probe; diagnostic-only semantic sample extraction, no live execution.
import {
  buildInvestorFlowSanitizedSampleAdr0496,
  buildSupplyCoverageReportAdr0496,
  normalizeSemanticNetBuyAdr0496,
  type InvestorFlowSanitizedSampleAdr0496,
  type SemanticNetBuyAdr0496,
  type SupplyCoverageReportAdr0496,
} from './investorFlowSemanticNetBuyAdr0496.js';

type InvestorFlowSampleAcquisitionStatusAdr0489 =
  | 'SAMPLE_READY'
  | 'EMPTY'
  | 'DATA_UNAVAILABLE'
  | 'PROVIDER_ERROR'
  | 'UNKNOWN';

type InvestorFlowSampleSignalAdr0489 = 'BULLISH' | 'BEARISH' | 'UNKNOWN';

export interface InvestorFlowSemanticSampleAdr0489 {
  symbol: string;
  provider: string;
  sourceDate: string | null;
  foreignNetBuy: number | null;
  institutionNetBuy: number | null;
  individualNetBuy?: number | null;
  programNetBuy: number | null;
  signal: InvestorFlowSampleSignalAdr0489;
  confidence: 'HIGH' | 'MEDIUM' | 'LOW' | 'NONE';
  status: InvestorFlowSampleAcquisitionStatusAdr0489;
  diagnostics: string[];
}

export interface InvestorFlowSampleAcquisitionReportAdr0489 {
  generatedAt: string;
  status: InvestorFlowSampleAcquisitionStatusAdr0489;
  samples: InvestorFlowSemanticSampleAdr0489[];
  selectedSample: InvestorFlowSemanticSampleAdr0489 | null;
  adr0496SanitizedSamples: InvestorFlowSanitizedSampleAdr0496[];
  adr0496SemanticNetBuySamples: SemanticNetBuyAdr0496[];
  adr0496SupplyCoverage: SupplyCoverageReportAdr0496;
  requestedProviders: string[];
  executionImpact: 'NONE';
  liveExecutionAllowed: false;
  policyPromotionMode: 'OBSERVE';
  operatorApprovalRequired: true;
  rawPayloadPersistenceAllowed: false;
  diagnostics: string[];
}

export interface KisInvestorFlowMaterializationInputAdr0489 {
  symbol: string;
  investorTradeByStockDaily?: { tradingDate?: string; foreignNetBuy?: number; institutionalNetBuy?: number; individualNetBuy?: number } | null;
  foreignInstitutionTotal?: { foreignNetBuy?: number; institutionalNetBuy?: number } | null;
  strictInvestorFlow?: { foreignNetBuy?: number; institutionalNetBuy?: number; individualNetBuy?: number } | null;
  investorTrendEstimate?: { foreignNetBuyEstimate?: number; institutionalNetBuyEstimate?: number; individualNetBuyEstimate?: number } | null;
  marketSupply?: unknown;
}

export interface InvestorFlowSampleAcquisitionInputAdr0489 {
  generatedAt?: string;
  requestedProviders?: readonly string[];
  samples?: readonly Partial<InvestorFlowSemanticSampleAdr0489>[];
  providerIssue?: boolean;
  diagnostics?: readonly string[];
}

function toFiniteNumber(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

function hasFinitePair(foreign: unknown, institution: unknown): boolean {
  return toFiniteNumber(foreign) !== null && toFiniteNumber(institution) !== null;
}

export function materializeKisInvestorFlowSampleAdr0489(
  input: KisInvestorFlowMaterializationInputAdr0489,
): Partial<InvestorFlowSemanticSampleAdr0489> | null {
  const daily = input.investorTradeByStockDaily;
  if (daily && hasFinitePair(daily.foreignNetBuy, daily.institutionalNetBuy)) {
    const individual = toFiniteNumber(daily.individualNetBuy);
    return {
      symbol: input.symbol,
      provider: 'KIS_API',
      sourceDate: daily.tradingDate ?? null,
      foreignNetBuy: toFiniteNumber(daily.foreignNetBuy),
      institutionNetBuy: toFiniteNumber(daily.institutionalNetBuy),
      individualNetBuy: individual,
      confidence: individual === null ? 'MEDIUM' : 'HIGH',
      status: 'SAMPLE_READY',
      diagnostics: [individual === null ? 'KIS investor_trade_by_stock_daily DEGRADED: individualNetBuy missing; shadow usable.' : 'KIS investor_trade_by_stock_daily VERIFIED.'],
    };
  }

  const total = input.foreignInstitutionTotal;
  if (total && hasFinitePair(total.foreignNetBuy, total.institutionalNetBuy)) {
    return {
      symbol: input.symbol,
      provider: 'KIS_API',
      sourceDate: null,
      foreignNetBuy: toFiniteNumber(total.foreignNetBuy),
      institutionNetBuy: toFiniteNumber(total.institutionalNetBuy),
      individualNetBuy: null,
      confidence: 'MEDIUM',
      status: 'SAMPLE_READY',
      diagnostics: ['KIS foreign_institution_total DEGRADED: foreign+institution only; shadow usable.'],
    };
  }

  const strict = input.strictInvestorFlow;
  if (strict && hasFinitePair(strict.foreignNetBuy, strict.institutionalNetBuy) && toFiniteNumber(strict.individualNetBuy) !== null) {
    return {
      symbol: input.symbol,
      provider: 'KIS_API',
      sourceDate: null,
      foreignNetBuy: toFiniteNumber(strict.foreignNetBuy),
      institutionNetBuy: toFiniteNumber(strict.institutionalNetBuy),
      individualNetBuy: toFiniteNumber(strict.individualNetBuy),
      confidence: 'HIGH',
      status: 'SAMPLE_READY',
      diagnostics: ['KIS inquire_investor strict parser VERIFIED.'],
    };
  }

  const estimate = input.investorTrendEstimate;
  if (estimate && hasFinitePair(estimate.foreignNetBuyEstimate, estimate.institutionalNetBuyEstimate)) {
    return {
      symbol: input.symbol,
      provider: 'KIS_API',
      sourceDate: null,
      foreignNetBuy: toFiniteNumber(estimate.foreignNetBuyEstimate),
      institutionNetBuy: toFiniteNumber(estimate.institutionalNetBuyEstimate),
      individualNetBuy: toFiniteNumber(estimate.individualNetBuyEstimate),
      confidence: 'LOW',
      status: 'DATA_UNAVAILABLE',
      diagnostics: ['KIS estimate endpoint is ESTIMATED/advisory only; not selected as semantic sample.'],
    };
  }

  if (input.marketSupply) return null;
  return null;
}

function normalizeSignal(input: Partial<InvestorFlowSemanticSampleAdr0489>): InvestorFlowSampleSignalAdr0489 {
  if (input.signal === 'BULLISH' || input.signal === 'BEARISH') return input.signal;
  const foreign = toFiniteNumber(input.foreignNetBuy);
  const institution = toFiniteNumber(input.institutionNetBuy);
  const program = toFiniteNumber(input.programNetBuy);
  const total = (foreign ?? 0) + (institution ?? 0) + (program ?? 0);
  if (foreign === null && institution === null && program === null) return 'UNKNOWN';
  if (total > 0) return 'BULLISH';
  if (total < 0) return 'BEARISH';
  return 'UNKNOWN';
}

export function buildInvestorFlowSampleAcquisitionReportAdr0489(
  input: InvestorFlowSampleAcquisitionInputAdr0489 = {},
): InvestorFlowSampleAcquisitionReportAdr0489 {
  const diagnostics = [...(input.diagnostics ?? [])];
  const samples = (input.samples ?? []).map((sample, index): InvestorFlowSemanticSampleAdr0489 => {
    const signal = normalizeSignal(sample);
    return {
      symbol: sample.symbol ?? `SAMPLE_${index + 1}`,
      provider: sample.provider ?? 'UNKNOWN',
      sourceDate: sample.sourceDate ?? null,
      foreignNetBuy: toFiniteNumber(sample.foreignNetBuy),
      institutionNetBuy: toFiniteNumber(sample.institutionNetBuy),
      individualNetBuy: toFiniteNumber(sample.individualNetBuy),
      programNetBuy: toFiniteNumber(sample.programNetBuy),
      signal,
      confidence: sample.confidence ?? (signal === 'UNKNOWN' ? 'NONE' : 'LOW'),
      status: sample.status ?? (signal === 'UNKNOWN' ? 'DATA_UNAVAILABLE' : 'SAMPLE_READY'),
      diagnostics: [...(sample.diagnostics ?? [])],
    };
  });
  const selectedSample = samples.find((sample) => sample.status === 'SAMPLE_READY') ?? null;
  const adr0496SanitizedSamples = samples.map((sample, index) => buildInvestorFlowSanitizedSampleAdr0496({
    sampleId: `adr0489-adr0496-${index + 1}`,
    symbol: sample.symbol,
    provider: sample.provider,
    market: 'UNKNOWN',
    capturedAt: input.generatedAt,
    dataDate: sample.sourceDate,
    foreignNetBuy: sample.foreignNetBuy,
    institutionNetBuy: sample.institutionNetBuy,
    retailNetBuy: sample.individualNetBuy ?? null,
    status: sample.status === 'PROVIDER_ERROR' ? 'PROVIDER_ERROR' : sample.status === 'SAMPLE_READY' ? 'PARTIAL' : 'DATA_UNAVAILABLE',
    providerError: sample.status === 'PROVIDER_ERROR',
    warnings: sample.diagnostics,
  }));
  const adr0496SemanticNetBuySamples = adr0496SanitizedSamples.map(normalizeSemanticNetBuyAdr0496);
  const adr0496SupplyCoverage = buildSupplyCoverageReportAdr0496({
    samples: adr0496SanitizedSamples,
    semanticSamples: adr0496SemanticNetBuySamples,
  });
  const status: InvestorFlowSampleAcquisitionStatusAdr0489 = selectedSample
    ? 'SAMPLE_READY'
    : input.providerIssue
      ? 'PROVIDER_ERROR'
      : samples.length > 0
        ? 'DATA_UNAVAILABLE'
        : 'EMPTY';
  if (!selectedSample) diagnostics.push('No bullish/bearish conversion is applied for UNKNOWN provider samples.');
  return {
    generatedAt: input.generatedAt ?? new Date().toISOString(),
    status,
    samples,
    selectedSample,
    adr0496SanitizedSamples,
    adr0496SemanticNetBuySamples,
    adr0496SupplyCoverage,
    requestedProviders: [...(input.requestedProviders ?? ['KIS_API', 'NAVER', 'CACHE'])],
    executionImpact: 'NONE',
    liveExecutionAllowed: false,
    policyPromotionMode: 'OBSERVE',
    operatorApprovalRequired: true,
    rawPayloadPersistenceAllowed: false,
    diagnostics: [
      ...diagnostics,
      `ADR-0496 coverageAfter=${adr0496SupplyCoverage.coverageAfter} normalizedSampleCount=${adr0496SupplyCoverage.normalizedSampleCount} semanticNetBuyCount=${adr0496SupplyCoverage.semanticNetBuyCount}`,
    ],
  };
}
