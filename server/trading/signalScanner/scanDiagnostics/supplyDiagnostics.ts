// @responsibility Supply diagnostic input adapters.

import type { NaverInvestorTrendRawPoint } from '../naverInvestorTrendCollectorAdr0481.js';
import type { SemanticNetBuyInputPoint } from '../semanticNetBuyNormalizerAdr0482.js';
import { scanDiagnosticNumber, scanDiagnosticString } from './macroScanDiagnostics.js';

export function cacheRawToNaverInvestorTrendPointAdr0481(cacheRaw: Record<string, unknown> | null | undefined): NaverInvestorTrendRawPoint | null {
  const sourceDate = scanDiagnosticString(cacheRaw?.sourceDate);
  if (!sourceDate) return null;
  return {
    date: sourceDate,
    foreignNetBuy: scanDiagnosticNumber(cacheRaw?.foreignNetBuy),
    institutionNetBuy: scanDiagnosticNumber(cacheRaw?.institutionNetBuy),
    individualNetBuy: scanDiagnosticNumber(cacheRaw?.retailNetBuy),
    programNetBuy: scanDiagnosticNumber(cacheRaw?.programNetBuy),
  };
}

export function cacheRawToSemanticInputAdr0482(input: {
  code: string;
  cacheRaw: Record<string, unknown> | null | undefined;
  stale: boolean;
}): SemanticNetBuyInputPoint | null {
  const sourceDate = scanDiagnosticString(input.cacheRaw?.sourceDate);
  if (!sourceDate) return null;
  return {
    code: input.code,
    provider: 'CACHE',
    sourceDate,
    rawForeignNetBuy: scanDiagnosticNumber(input.cacheRaw?.foreignNetBuy),
    rawInstitutionNetBuy: scanDiagnosticNumber(input.cacheRaw?.institutionNetBuy),
    rawProgramNetBuy: scanDiagnosticNumber(input.cacheRaw?.programNetBuy),
    rawIndividualNetBuy: scanDiagnosticNumber(input.cacheRaw?.retailNetBuy),
    unit: 'KRW',
    status: input.stale ? 'STALE' : 'VERIFIED',
    sourceAgeTradingDays: input.stale ? 4 : 0,
    diagnostics: ['ADR-0491 sanitized CACHE snapshot consumed by ADR-0482 as SHADOW_ONLY input; raw payload not persisted.'],
  };
}
