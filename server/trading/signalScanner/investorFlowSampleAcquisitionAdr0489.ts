// @responsibility ADR-0489 investor-flow sample acquisition probe; sanitized diagnostics only.
export interface InvestorFlowSampleAcquisitionSampleAdr0489 {
  code: string | null;
  provider: string;
  status: string;
  signal: 'BULLISH' | 'BEARISH' | 'NEUTRAL' | 'UNKNOWN';
  confidence: 'HIGH' | 'MEDIUM' | 'LOW' | 'NONE' | 'UNKNOWN';
  coverageRatio: number;
}
export interface InvestorFlowSampleAcquisitionReportAdr0489 {
  generatedAt: string;
  status: 'SAMPLED' | 'EMPTY' | 'PROVIDER_ERROR' | 'UNKNOWN';
  selectedProvider: string | null;
  samples: InvestorFlowSampleAcquisitionSampleAdr0489[];
  executionImpact: 'NONE';
  liveExecutionAllowed: false;
  policyPromotionMode: 'OBSERVE' | 'SHADOW_ONLY';
  operatorApprovalRequired: true;
}
export function buildInvestorFlowSampleAcquisitionReportAdr0489(samples: InvestorFlowSampleAcquisitionSampleAdr0489[] = []): InvestorFlowSampleAcquisitionReportAdr0489 {
  return { generatedAt: new Date().toISOString(), status: samples.length > 0 ? 'SAMPLED' : 'EMPTY', selectedProvider: samples[0]?.provider ?? null, samples, executionImpact: 'NONE', liveExecutionAllowed: false, policyPromotionMode: 'OBSERVE', operatorApprovalRequired: true };
}
