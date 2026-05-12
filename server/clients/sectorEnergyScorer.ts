// @responsibility ADR-0462 SectorEnergy scorer — source-tier/coverage/leadership semantics SSOT

import type { CoverageMetric, SectorCoverageReport } from './sectorCoverage.js';
import type { SectorSourceTier } from './sectorIndexMaster.js';
import type { SectorSymmetryValidationResult } from './sectorSymmetryValidator.js';
import { applyFallbackContaminationGuard } from './fallbackContaminationGuard.js';

export type SectorEnergyAdr0462DataQuality = 'VERIFIED' | 'DEGRADED_BUT_USABLE' | 'DIAGNOSTIC_ONLY' | 'DEGRADED';
export type SectorEnergyReason =
  | 'INDEX_CODE_COVERAGE_LOW'
  | 'SYMMETRY_VALIDATION_FAILED'
  | 'STOCK_DAILY_FALLBACK_USED'
  | 'ALIAS_MISSING'
  | 'PROVIDER_CACHE_EMPTY'
  | 'PROVIDER_STALE'
  | 'FALLBACK_DIAGNOSTIC_ONLY'
  | 'LEADERSHIP_CONFIDENCE_BLOCKED';

export interface SectorEnergyScorerInput {
  sourceTier: SectorSourceTier;
  coverage: SectorCoverageReport;
  symmetryValidation: SectorSymmetryValidationResult;
  providerHealth?: 'VERIFIED' | 'DEGRADED' | 'STALE' | 'EMPTY' | 'ERROR';
  rawLeadershipScore?: number;
}

export interface SectorEnergyScorerResult {
  dataQuality: SectorEnergyAdr0462DataQuality;
  mode: 'SCORING' | 'LIMITED_SCORING' | 'DIAGNOSTIC_ONLY';
  leadershipScore: number;
  leadershipConfidence: 'OK' | 'READY_FOR_SHADOW' | 'DEGRADED' | 'BLOCKED';
  sectorBoost: number;
  strongBuyBlocked: boolean;
  executionHardBlock: boolean;
  fallbackContributionToScore: number;
  reasons: SectorEnergyReason[];
  indexCodeCoverage: CoverageMetric;
}

export function scoreSectorEnergyAdr0462(input: SectorEnergyScorerInput): SectorEnergyScorerResult {
  const reasons: SectorEnergyReason[] = [];
  const indexCoverage = input.coverage.indexCodeCoverage;
  let dataQuality: SectorEnergyAdr0462DataQuality = 'VERIFIED';
  let mode: SectorEnergyScorerResult['mode'] = 'SCORING';
  let leadershipConfidence: SectorEnergyScorerResult['leadershipConfidence'] = 'OK';
  let sectorBoost = Math.max(0, input.rawLeadershipScore ?? 0) > 0 ? 1 : 0;
  let leadershipScore = Math.max(0, input.rawLeadershipScore ?? 0);
  let strongBuyBlocked = false;

  if (!input.symmetryValidation.ok) reasons.push('SYMMETRY_VALIDATION_FAILED');
  if (input.symmetryValidation.unresolvedAliases.length > 0) reasons.push('ALIAS_MISSING');
  if (input.providerHealth === 'EMPTY') reasons.push('PROVIDER_CACHE_EMPTY');
  if (input.providerHealth === 'STALE') reasons.push('PROVIDER_STALE');

  if (input.sourceTier === 'KIS_OFFICIAL_INDEX' || input.sourceTier === 'KIS_OFFICIAL_DAILY') {
    const guard = applyFallbackContaminationGuard({ sourceTier: input.sourceTier, sectorBoost, leadershipConfidence, reasons });
    return {
      dataQuality: 'VERIFIED',
      mode: 'SCORING',
      leadershipScore,
      leadershipConfidence: guard.leadershipConfidence,
      sectorBoost: guard.sectorBoost,
      strongBuyBlocked,
      executionHardBlock: false,
      fallbackContributionToScore: guard.fallbackContributionToScore,
      reasons: guard.reasons as SectorEnergyReason[],
      indexCodeCoverage: indexCoverage,
    };
  }

  if (input.sourceTier === 'KIS_STOCK_BASKET_DERIVED') {
    dataQuality = 'DEGRADED_BUT_USABLE';
    mode = 'LIMITED_SCORING';
    leadershipConfidence = 'READY_FOR_SHADOW';
    sectorBoost = 0;
    strongBuyBlocked = true;
    const guard = applyFallbackContaminationGuard({ sourceTier: input.sourceTier, sectorBoost, leadershipConfidence, reasons });
    return {
      dataQuality,
      mode,
      leadershipScore,
      leadershipConfidence: guard.leadershipConfidence,
      sectorBoost: guard.sectorBoost,
      strongBuyBlocked,
      executionHardBlock: false,
      fallbackContributionToScore: guard.fallbackContributionToScore,
      reasons: guard.reasons as SectorEnergyReason[],
      indexCodeCoverage: indexCoverage,
    };
  }

  if (indexCoverage.ratio >= 0.85) {
    dataQuality = 'VERIFIED';
  } else if (indexCoverage.ratio >= 0.60) {
    dataQuality = 'DEGRADED_BUT_USABLE';
    mode = 'LIMITED_SCORING';
    leadershipConfidence = 'DEGRADED';
    sectorBoost = Math.min(sectorBoost, 0.5);
  } else if (indexCoverage.ratio >= 0.30) {
    dataQuality = 'DIAGNOSTIC_ONLY';
    mode = 'DIAGNOSTIC_ONLY';
    leadershipConfidence = 'BLOCKED';
    sectorBoost = 0;
    leadershipScore = 0;
    strongBuyBlocked = true;
    reasons.push('INDEX_CODE_COVERAGE_LOW', 'LEADERSHIP_CONFIDENCE_BLOCKED');
  } else {
    dataQuality = 'DEGRADED';
    mode = 'DIAGNOSTIC_ONLY';
    leadershipConfidence = 'BLOCKED';
    sectorBoost = 0;
    leadershipScore = 0;
    strongBuyBlocked = true;
    reasons.push('INDEX_CODE_COVERAGE_LOW', 'LEADERSHIP_CONFIDENCE_BLOCKED');
  }

  const guard = applyFallbackContaminationGuard({ sourceTier: input.sourceTier, sectorBoost, leadershipConfidence, reasons });
  if (guard.diagnosticOnly) {
    mode = 'DIAGNOSTIC_ONLY';
    dataQuality = 'DEGRADED';
    leadershipScore = 0;
    strongBuyBlocked = true;
  }

  return {
    dataQuality,
    mode,
    leadershipScore,
    leadershipConfidence: guard.leadershipConfidence,
    sectorBoost: guard.sectorBoost,
    strongBuyBlocked,
    executionHardBlock: false,
    fallbackContributionToScore: guard.fallbackContributionToScore,
    reasons: guard.reasons as SectorEnergyReason[],
    indexCodeCoverage: indexCoverage,
  };
}
