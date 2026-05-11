// @responsibility ADR-0462 Fallback contamination guard — STOCK_DAILY diagnostic-only barrier

import type { SectorSourceTier } from './sectorIndexMaster.js';

export interface FallbackContaminationDecision {
  diagnosticOnly: boolean;
  fallbackContributionToScore: number;
  sectorBoost: number;
  leadershipConfidence: 'OK' | 'DEGRADED' | 'BLOCKED';
  executionHardBlock: boolean;
  reasons: string[];
}

export function applyFallbackContaminationGuard(input: {
  sourceTier?: SectorSourceTier;
  sectorBoost?: number;
  leadershipConfidence?: 'OK' | 'DEGRADED' | 'BLOCKED';
  reasons?: string[];
}): FallbackContaminationDecision {
  const reasons = Array.from(new Set(input.reasons ?? []));
  if (input.sourceTier === 'STOCK_DAILY_FALLBACK' || input.sourceTier === 'INTERNAL_PROXY') {
    reasons.push('STOCK_DAILY_FALLBACK_USED', 'FALLBACK_DIAGNOSTIC_ONLY');
    return {
      diagnosticOnly: true,
      fallbackContributionToScore: 0,
      sectorBoost: 0,
      leadershipConfidence: 'BLOCKED',
      executionHardBlock: false,
      reasons: Array.from(new Set(reasons)),
    };
  }
  if (input.sourceTier === 'YAHOO_GLOBAL_PROXY') {
    reasons.push('FALLBACK_DIAGNOSTIC_ONLY');
    return {
      diagnosticOnly: true,
      fallbackContributionToScore: 0,
      sectorBoost: 0,
      leadershipConfidence: 'BLOCKED',
      executionHardBlock: false,
      reasons: Array.from(new Set(reasons)),
    };
  }
  return {
    diagnosticOnly: false,
    fallbackContributionToScore: 1,
    sectorBoost: input.sectorBoost ?? 0,
    leadershipConfidence: input.leadershipConfidence ?? 'OK',
    executionHardBlock: false,
    reasons,
  };
}
