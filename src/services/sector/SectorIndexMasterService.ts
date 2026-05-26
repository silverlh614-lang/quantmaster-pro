import type { SectorIndexCoverageDiag } from './SectorEnergyDiagnostics';

export type Gate2LeadershipBlocker =
  | 'OFFICIAL_INDEX_UNAVAILABLE'
  | 'OFFICIAL_INDEX_COVERAGE_BELOW_THRESHOLD'
  | 'SECTOR_STALE'
  | 'SECTOR_UNAVAILABLE'
  | 'FUNDAMENTAL_UNAVAILABLE'
  | 'BREAKOUT_MOMENTUM_FAIL'
  | 'RELATIVE_STRENGTH_FAIL'
  | 'VOLUME_CONFIRMATION_FAIL'
  | 'NO_LEADERSHIP_AFTER_ALL_CHECKS';

export interface Gate2LeadershipAttribution {
  finalNoLeadershipReason: string;
  blockers: Gate2LeadershipBlocker[];
  liveLeadership: boolean;
  shadowLeadership: boolean;
  executionImpact: 'NONE';
}

export function buildGate2LeadershipAttribution(input: {
  coverage: SectorIndexCoverageDiag;
  sectorStale: boolean;
  sectorUnavailable: boolean;
  breakoutMomentumConfirmed: boolean;
  relativeStrengthPass: boolean;
  volumeConfirmationPass: boolean;
  fundamentalUnavailable: string[];
}): Gate2LeadershipAttribution {
  const blockers: Gate2LeadershipBlocker[] = [];
  const decisionCoverage = input.coverage.decisionUsesSafeOfficialOnly && typeof input.coverage.safeOfficialVerifiedCoverage === 'number'
    ? input.coverage.safeOfficialVerifiedCoverage
    : input.coverage.officialIndexCoverage;
  if (!input.coverage.promotionAllowed && input.coverage.officialIndexCoverage <= 0) blockers.push('OFFICIAL_INDEX_UNAVAILABLE');
  if (!input.coverage.promotionAllowed && decisionCoverage < 0.8) blockers.push('OFFICIAL_INDEX_COVERAGE_BELOW_THRESHOLD');
  if (input.sectorStale) blockers.push('SECTOR_STALE');
  if (input.sectorUnavailable) blockers.push('SECTOR_UNAVAILABLE');
  if (!input.breakoutMomentumConfirmed) blockers.push('BREAKOUT_MOMENTUM_FAIL');
  if (!input.relativeStrengthPass) blockers.push('RELATIVE_STRENGTH_FAIL');
  if (!input.volumeConfirmationPass) blockers.push('VOLUME_CONFIRMATION_FAIL');
  if (input.fundamentalUnavailable.length > 0) blockers.push('FUNDAMENTAL_UNAVAILABLE');
  if (blockers.length === 0) blockers.push('NO_LEADERSHIP_AFTER_ALL_CHECKS');

  const liveLeadership = input.coverage.promotionAllowed && input.breakoutMomentumConfirmed;
  const shadowLeadership = input.coverage.shadowLeadershipAllowed;

  return {
    finalNoLeadershipReason: liveLeadership
      ? 'LIVE_LEADERSHIP_CONFIRMED'
      : !input.coverage.promotionAllowed && !input.breakoutMomentumConfirmed
        ? 'LIVE_PROMOTION_DISABLED_AND_BREAKOUT_NOT_CONFIRMED'
        : !input.breakoutMomentumConfirmed
          ? 'BREAKOUT_MOMENTUM_NOT_CONFIRMED'
          : 'NO_LEADERSHIP_AFTER_ALL_CHECKS',
    blockers,
    liveLeadership,
    shadowLeadership,
    executionImpact: 'NONE',
  };
}
