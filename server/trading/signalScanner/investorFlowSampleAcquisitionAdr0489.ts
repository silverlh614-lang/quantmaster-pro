// @responsibility ADR-0489 investor-flow sample acquisition probe; non-live related-supply evidence only.

export interface InvestorFlowSampleAcquisitionProbeAdr0489 {
  generatedAt: string;
  code: string | null;
  selectedProvider: string | null;
  semanticSampleAvailable: boolean;
  relatedProgramSampleAvailable: boolean;
  relatedProgramSampleProvider: string | null;
  signal: 'BULLISH' | 'NEUTRAL' | 'BEARISH' | 'UNKNOWN';
  executionImpact: 'NONE';
  liveExecutionAllowed: false;
  policyPromotionMode: 'SHADOW_ONLY';
  operatorApprovalRequired: true;
  diagnostics: string[];
}

export function buildInvestorFlowSampleAcquisitionProbeAdr0489(input: {
  generatedAt?: string;
  code?: string | null;
  selectedProvider?: string | null;
  semanticSampleAvailable?: boolean;
  semanticSignal?: 'BULLISH' | 'NEUTRAL' | 'BEARISH' | 'UNKNOWN' | null;
  relatedProgramSampleAvailable?: boolean;
  relatedProgramSampleProvider?: string | null;
} = {}): InvestorFlowSampleAcquisitionProbeAdr0489 {
  return {
    generatedAt: input.generatedAt ?? new Date().toISOString(),
    code: input.code ?? null,
    selectedProvider: input.selectedProvider ?? null,
    semanticSampleAvailable: input.semanticSampleAvailable === true,
    relatedProgramSampleAvailable: input.relatedProgramSampleAvailable === true,
    relatedProgramSampleProvider: input.relatedProgramSampleProvider ?? null,
    signal: input.semanticSampleAvailable === true ? (input.semanticSignal ?? 'UNKNOWN') : 'UNKNOWN',
    executionImpact: 'NONE',
    liveExecutionAllowed: false,
    policyPromotionMode: 'SHADOW_ONLY',
    operatorApprovalRequired: true,
    diagnostics: [
      'ADR-0489 probes semantic investor-flow sample acquisition only.',
      'Related program trading samples are supporting evidence only and never replace semantic investor-flow samples.',
    ],
  };
}
