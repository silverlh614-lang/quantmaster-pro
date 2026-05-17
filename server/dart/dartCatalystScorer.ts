// @responsibility DART 선행공시 자문점수 산출
import type { DartCatalystCategory, DartExtractedFact, DartReason } from './dartPreNewsTypes.js';

export interface DartScoreInput {
  category: DartCatalystCategory;
  facts: DartExtractedFact[];
  reasons: DartReason[];
  risks: DartReason[];
  parserFailed: boolean;
}

export interface DartScoreResult {
  catalystScore: number;
  riskScore: number;
  reasons: DartReason[];
  risks: DartReason[];
}

function factNumber(facts: DartExtractedFact[], key: string): number | undefined {
  const v = facts.find((f) => f.key === key && (f.confidence === 'VERIFIED' || f.confidence === 'DEGRADED'))?.value;
  return typeof v === 'number' ? v : undefined;
}

function clamp(n: number): number {
  return Math.max(0, Math.min(100, Math.round(n)));
}

export function scoreDartCatalyst(input: DartScoreInput): DartScoreResult {
  let catalystScore = 0;
  let riskScore = 0;
  const reasons = [...input.reasons];
  const risks = [...input.risks];
  const salesRatio = factNumber(input.facts, 'salesRatio');
  const amount = factNumber(input.facts, 'amount');
  const hasPeriod = input.facts.some((f) => f.key === 'contractPeriod' && f.confidence !== 'MISSING');

  if (input.category === 'STRUCTURAL_POSITIVE') catalystScore = 58;
  else if (input.category === 'CYCLICAL_POSITIVE') catalystScore = 52;
  else if (input.category === 'SHORT_TERM_POSITIVE') catalystScore = 45;
  else if (input.category === 'NEUTRAL_INFO') catalystScore = 15;

  if (input.category === 'RISK_NEGATIVE') riskScore = 72;
  else if (input.category === 'DILUTION_RISK') riskScore = 76;
  else if (input.category === 'OVERHANG_RISK') riskScore = 70;
  else if (input.category === 'GOVERNANCE_RISK') riskScore = 68;

  if (salesRatio !== undefined) {
    if (salesRatio >= 50) catalystScore += 24;
    else if (salesRatio >= 20) catalystScore += 16;
    else if (salesRatio >= 10) catalystScore += 8;
    if (salesRatio >= 20 && input.category.endsWith('RISK')) riskScore += 12;
  }
  if (amount !== undefined && amount >= 100_000_000_000) catalystScore += 8;
  if (hasPeriod) catalystScore += 6;

  if (input.reasons.includes('PASS_DART_TREASURY_BUYBACK')) catalystScore = Math.max(catalystScore, 55);
  if (input.reasons.includes('PASS_DART_PATENT_ACQUIRED')) catalystScore = Math.max(catalystScore, 50);
  if (input.reasons.includes('PASS_DART_TECH_TRANSFER')) catalystScore = Math.max(catalystScore, 62);

  if (input.parserFailed || (salesRatio === undefined && amount === undefined)) {
    catalystScore = Math.min(catalystScore, 62);
    if (input.category === 'UNKNOWN') catalystScore = 0;
  }

  return {
    catalystScore: clamp(catalystScore),
    riskScore: clamp(riskScore),
    reasons: Array.from(new Set(reasons)),
    risks: Array.from(new Set(risks)),
  };
}
