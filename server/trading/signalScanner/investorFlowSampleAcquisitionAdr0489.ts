// @responsibility ADR-0489 InvestorFlow sample acquisition probe; diagnostic-only semantic sample extraction, no live execution.

export type InvestorFlowSampleAcquisitionStatusAdr0489 =
  | 'SAMPLE_READY'
  | 'EMPTY'
  | 'DATA_UNAVAILABLE'
  | 'PROVIDER_ERROR'
  | 'UNKNOWN';

export type InvestorFlowSampleSignalAdr0489 = 'BULLISH' | 'BEARISH' | 'UNKNOWN';

export interface InvestorFlowSemanticSampleAdr0489 {
  symbol: string;
  provider: string;
  sourceDate: string | null;
  foreignNetBuy: number | null;
  institutionNetBuy: number | null;
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
  requestedProviders: string[];
  executionImpact: 'NONE';
  liveExecutionAllowed: false;
  policyPromotionMode: 'OBSERVE';
  operatorApprovalRequired: true;
  rawPayloadPersistenceAllowed: false;
  diagnostics: string[];
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
      programNetBuy: toFiniteNumber(sample.programNetBuy),
      signal,
      confidence: sample.confidence ?? (signal === 'UNKNOWN' ? 'NONE' : 'LOW'),
      status: sample.status ?? (signal === 'UNKNOWN' ? 'DATA_UNAVAILABLE' : 'SAMPLE_READY'),
      diagnostics: [...(sample.diagnostics ?? [])],
    };
  });
  const selectedSample = samples.find((sample) => sample.status === 'SAMPLE_READY') ?? null;
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
    requestedProviders: [...(input.requestedProviders ?? ['NAVER', 'CACHE'])],
    executionImpact: 'NONE',
    liveExecutionAllowed: false,
    policyPromotionMode: 'OBSERVE',
    operatorApprovalRequired: true,
    rawPayloadPersistenceAllowed: false,
    diagnostics,
  };
}

export function formatInvestorFlowSampleAcquisitionLineAdr0489(
  report: InvestorFlowSampleAcquisitionReportAdr0489,
): string {
  return `ADR-0489 InvestorFlowSample: ${report.status} | samples=${report.samples.length} | selected=${report.selectedSample?.provider ?? 'NONE'} | impact=${report.executionImpact}`;
}
