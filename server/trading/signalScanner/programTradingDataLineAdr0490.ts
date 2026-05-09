// @responsibility ADR-0490 program trading data-line sample normalization; sanitized diagnostics only.
export interface ProgramTradingDataLineSampleAdr0490 {
  code: string | null;
  provider: 'KIS' | 'KRX' | 'CACHE' | 'UNKNOWN';
  status: string;
  signal: 'BULLISH' | 'BEARISH' | 'NEUTRAL' | 'UNKNOWN';
  confidence: 'HIGH' | 'MEDIUM' | 'LOW' | 'NONE' | 'UNKNOWN';
  coverageRatio: number;
  programNetBuy: number | null;
}
export interface ProgramTradingDataLineReportAdr0490 {
  generatedAt: string;
  status: 'NORMALIZED' | 'EMPTY' | 'PROVIDER_ERROR' | 'UNKNOWN';
  samples: ProgramTradingDataLineSampleAdr0490[];
  executionImpact: 'NONE';
  liveExecutionAllowed: false;
  policyPromotionMode: 'OBSERVE' | 'SHADOW_ONLY';
  operatorApprovalRequired: true;
}
export function buildProgramTradingDataLineReportAdr0490(samples: ProgramTradingDataLineSampleAdr0490[] = []): ProgramTradingDataLineReportAdr0490 {
  return { generatedAt: new Date().toISOString(), status: samples.length > 0 ? 'NORMALIZED' : 'EMPTY', samples, executionImpact: 'NONE', liveExecutionAllowed: false, policyPromotionMode: 'OBSERVE', operatorApprovalRequired: true };
}
