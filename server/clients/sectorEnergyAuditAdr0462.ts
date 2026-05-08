// @responsibility ADR-0462 SectorEnergy audit/Telegram formatter — leadership vs execution separation

import type { CoverageMetric, SectorCoverageReport } from './sectorCoverage.js';
import { formatCoverageMetric } from './sectorCoverage.js';
import type { SectorSourceTier } from './sectorIndexMaster.js';
import { SECTOR_INDEX_MASTER_VERSION } from './sectorIndexMaster.js';
import type { SectorSymmetryValidationResult } from './sectorSymmetryValidator.js';
import type { SectorEnergyScorerResult } from './sectorEnergyScorer.js';

export type SectorEnergyCaseTag =
  | 'CASE_SECTOR_ENERGY_DEGRADED'
  | 'CASE_INDEX_CODE_COVERAGE_LOW'
  | 'CASE_STOCK_DAILY_FALLBACK_DIAGNOSTIC_ONLY'
  | 'CASE_SYMMETRY_VALIDATION_FAILED'
  | 'CASE_PROVIDER_CACHE_EMPTY'
  | 'CASE_STRONG_BUY_BLOCKED_BY_SECTOR_CONFIDENCE'
  | 'CASE_ENGINE_ALIVE_WITH_SECTOR_DEGRADED';

export interface SectorEnergyAudit {
  timestamp: string;
  masterVersion: string;
  sectorCoverage: CoverageMetric;
  indexCodeCoverage: CoverageMetric;
  aliasCoverage: CoverageMetric;
  providerCoverage: CoverageMetric;
  fallbackUsed: boolean;
  fallbackType?: SectorSourceTier;
  fallbackContributionToScore: number;
  symmetryValidation: SectorSymmetryValidationResult;
  missingIndexCodes: string[];
  aliasMissing: string[];
  aggregateIgnored: number;
  recoveredAliases: string[];
  sourceTierBreakdown: Record<SectorSourceTier, number>;
  dataQuality: string;
  leadershipConfidence: string;
  sectorBoost: number;
  executionHardBlock: boolean;
  learningOnly: boolean;
  caseTag: SectorEnergyCaseTag;
  reasons: string[];
}

export function buildSectorEnergyAudit(input: {
  coverage: SectorCoverageReport;
  scorer: SectorEnergyScorerResult;
  symmetryValidation: SectorSymmetryValidationResult;
  sourceTier: SectorSourceTier;
  aliasMissing?: string[];
  recoveredAliases?: string[];
  now?: Date;
}): SectorEnergyAudit {
  const fallbackUsed = input.sourceTier === 'STOCK_DAILY_FALLBACK';
  const caseTag: SectorEnergyCaseTag = fallbackUsed
    ? 'CASE_STOCK_DAILY_FALLBACK_DIAGNOSTIC_ONLY'
    : input.scorer.reasons.includes('PROVIDER_CACHE_EMPTY')
      ? 'CASE_PROVIDER_CACHE_EMPTY'
      : !input.symmetryValidation.ok
        ? 'CASE_SYMMETRY_VALIDATION_FAILED'
        : input.scorer.reasons.includes('INDEX_CODE_COVERAGE_LOW')
          ? 'CASE_INDEX_CODE_COVERAGE_LOW'
          : input.scorer.strongBuyBlocked
            ? 'CASE_STRONG_BUY_BLOCKED_BY_SECTOR_CONFIDENCE'
            : 'CASE_ENGINE_ALIVE_WITH_SECTOR_DEGRADED';

  return {
    timestamp: (input.now ?? new Date()).toISOString(),
    masterVersion: SECTOR_INDEX_MASTER_VERSION,
    sectorCoverage: input.coverage.sectorCoverage,
    indexCodeCoverage: input.coverage.indexCodeCoverage,
    aliasCoverage: input.coverage.aliasCoverage,
    providerCoverage: input.coverage.providerCoverage,
    fallbackUsed,
    fallbackType: fallbackUsed ? input.sourceTier : undefined,
    fallbackContributionToScore: input.scorer.fallbackContributionToScore,
    symmetryValidation: input.symmetryValidation,
    missingIndexCodes: input.symmetryValidation.missingIndexCodes,
    aliasMissing: input.aliasMissing ?? input.symmetryValidation.unresolvedAliases,
    aggregateIgnored: input.symmetryValidation.aggregateIgnored,
    recoveredAliases: input.recoveredAliases ?? [],
    sourceTierBreakdown: {
      KRX_INDEX: input.sourceTier === 'KRX_INDEX' ? 1 : 0,
      KRX_ETF: input.sourceTier === 'KRX_ETF' ? 1 : 0,
      YAHOO_PROXY: input.sourceTier === 'YAHOO_PROXY' ? 1 : 0,
      STOCK_DAILY_FALLBACK: input.sourceTier === 'STOCK_DAILY_FALLBACK' ? 1 : 0,
    },
    dataQuality: input.scorer.dataQuality,
    leadershipConfidence: input.scorer.leadershipConfidence,
    sectorBoost: input.scorer.sectorBoost,
    executionHardBlock: false,
    learningOnly: input.scorer.mode === 'DIAGNOSTIC_ONLY',
    caseTag,
    reasons: input.scorer.reasons,
  };
}

export function formatSectorEnergyAuditTelegram(audit: SectorEnergyAudit): string {
  const fallbackText = audit.fallbackUsed ? (audit.fallbackType === 'STOCK_DAILY_FALLBACK' ? 'STOCK_DAILY' : audit.fallbackType) : 'NONE';
  const symmetryText = audit.symmetryValidation.ok ? 'PASSED' : 'FAILED';
  const reasons = audit.reasons.length > 0
    ? audit.reasons.map((reason, index) => `  ${index + 1}. ${reason}`).join('\n')
    : '  1. OK';
  return [
    '🌐 SectorEnergy 진단 (ADR-0462)',
    `• dataQuality: ${audit.dataQuality}`,
    `• mode: ${audit.learningOnly ? 'DIAGNOSTIC_ONLY' : 'SCORING'}`,
    `• sectorCoverage: ${formatCoverageMetric(audit.sectorCoverage)}`,
    `• indexCodeCoverage: ${(audit.indexCodeCoverage.ratio * 100).toFixed(1)}% (${audit.indexCodeCoverage.valid}/${audit.indexCodeCoverage.total})`,
    `• aliasCoverage: ${formatCoverageMetric(audit.aliasCoverage)}`,
    `• symmetryValidation: ${symmetryText}`,
    `• fallbackUsed: ${fallbackText}`,
    `• fallbackContributionToScore: ${audit.fallbackContributionToScore}`,
    '• reasons:',
    reasons,
    `• leadershipConfidence: ${audit.leadershipConfidence}`,
    `• sectorBoost: ${audit.sectorBoost}`,
    `• STRONG_BUY: ${audit.leadershipConfidence === 'BLOCKED' ? 'BLOCKED' : 'ALLOWED'}`,
    `• executionHardBlock: ${audit.executionHardBlock}`,
    '• engine: ALIVE',
    '• learning/counterfactual: KEPT',
    '• operatorAction: SectorIndexMaster alias/indexCode/provider cache 점검',
  ].join('\n');
}
