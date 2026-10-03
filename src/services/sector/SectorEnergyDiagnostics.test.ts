import { describe, expect, it } from 'vitest';
import { evaluateCoverageDiagnostics } from './SectorEnergyDiagnostics';

describe('SectorEnergy official index master diagnostics', () => {

  it('keeps 0% official coverage with basket proxy in SHADOW_ONLY confidence', () => {
    const diag = evaluateCoverageDiagnostics({
      totalSectorCount: 12,
      officialCoveredCount: 0,
      internalProxyCount: 0,
      stockBasketCount: 12,
      missingIndexCodeCount: 12,
      aliasResolvedCount: 0,
      unsafeAliasCount: 0,
      topMissingSectorNames: ['반도체'],
      selectedSectorEnergySourceTier: 'KIS_STOCK_BASKET_DERIVED',
      officialIndexApiSucceeded: false,
      containsUnsafeAliasInPromotionTarget: false,
      dataHealthMissing: false,
      stale: false,
    });

    expect(diag.leadershipConfidence).toBe('SHADOW_ONLY');
    expect(diag.sectorBoostAllowed).toBe(false);
    expect(diag.strongBuyAllowed).toBe(false);
    expect(diag.shadowLeadershipAllowed).toBe(true);
    expect(diag.counterfactualAllowed).toBe(true);
    expect(diag.executionImpact).toBe('NONE');
    expect(diag.reasonCodes).toContain('KIS_BASKET_DERIVED_SHADOW_ONLY');
  });

  it('allows official promotion only when verified coverage reaches 80% and guardrails are clean', () => {
    const baseInput = {
      totalSectorCount: 10,
      internalProxyCount: 10,
      stockBasketCount: 0,
      aliasResolvedCount: 0,
      unsafeAliasCount: 0,
      topMissingSectorNames: [] as string[],
      selectedSectorEnergySourceTier: 'OFFICIAL_KIS_SECTOR_INDEX',
      officialIndexApiSucceeded: true,
      containsUnsafeAliasInPromotionTarget: false,
      dataHealthMissing: false,
      stale: false,
    } as const;
    const partial = evaluateCoverageDiagnostics({
      ...baseInput,
      officialCoveredCount: 5,
      missingIndexCodeCount: 5,
    });
    expect(partial.leadershipConfidence).toBe('PARTIAL');
    expect(partial.promotionAllowed).toBe(false);
    expect(partial.shadowLeadershipAllowed).toBe(true);

    const verified = evaluateCoverageDiagnostics({
      ...baseInput,
      officialCoveredCount: 8,
      missingIndexCodeCount: 2,
    });
    expect(verified.leadershipConfidence).toBe('VERIFIED');
    expect(verified.promotionAllowed).toBe(true);
    expect(verified.sectorBoostAllowed).toBe(true);
    expect(verified.strongBuyAllowed).toBe(true);
    expect(verified.executionImpact).toBe('NONE');
  });

  it('excludes unsafe aliases from live promotion while keeping shadow scoring available', () => {
    const diag = evaluateCoverageDiagnostics({
      totalSectorCount: 10,
      officialCoveredCount: 10,
      internalProxyCount: 10,
      stockBasketCount: 0,
      missingIndexCodeCount: 0,
      aliasResolvedCount: 1,
      unsafeAliasCount: 1,
      topMissingSectorNames: [],
      selectedSectorEnergySourceTier: 'OFFICIAL_KIS_SECTOR_INDEX',
      officialIndexApiSucceeded: true,
      containsUnsafeAliasInPromotionTarget: true,
      dataHealthMissing: false,
      stale: false,
    });

    expect(diag.leadershipConfidence).toBe('PARTIAL');
    expect(diag.promotionAllowed).toBe(false);
    expect(diag.shadowLeadershipAllowed).toBe(true);
    expect(diag.reasonCodes).toContain('UNSAFE_ALIAS_EXCLUDED_FROM_PROMOTION');
  });
});
