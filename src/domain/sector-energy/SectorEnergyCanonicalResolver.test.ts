import { describe, it, expect } from 'vitest';
import {
  OFFICIAL_SECTOR_ENERGY_11,
  OFFICIAL_SECTOR_COUNT,
  SECTOR_THEME_TAG_POLICY,
  EXCLUDED_THEME_TAGS,
  SECTOR_OFFICIAL_PROMOTION_DISABLED,
  resolveSectorEnergyCanonicalState,
  missingSectorEnergyCanonicalState,
  sectorEnergyCanonicalOrMissing,
  lockSectorEnergyOutputToCanonical,
  enforceSectorEnergyTopBlockConsistency,
  assertSectorEnergyTopBlockConsistency,
  overrideWithCanonicalPromotion,
  renderSectorEnergyCanonicalOutput,
  type SectorEnergyCanonicalState,
} from './SectorEnergyCanonicalResolver.js';

function kisIndexWithVerified(count: number) {
  return { verifiedSectors: OFFICIAL_SECTOR_ENERGY_11.slice(0, count) };
}

function stateWithVerified(count: number, extra = {}): SectorEnergyCanonicalState {
  return resolveSectorEnergyCanonicalState({
    officialKisSectorIndex: kisIndexWithVerified(count),
    ...extra,
  });
}

describe('SectorEnergyCanonicalResolver — coverage gate', () => {
  it('Test 1: 11/11 verified → 100% PASS, all allowed, VERIFIED, no DISABLED block', () => {
    const c = stateWithVerified(11);
    expect(c.officialSectorCount).toBe(11);
    expect(c.verifiedOfficialSectorCount).toBe(11);
    expect(c.promotionCoverage).toBeCloseTo(1.0, 6);
    expect(c.promotionCoveragePass).toBe(true);
    expect(c.promotionAllowed).toBe(true);
    expect(c.sectorBoostAllowed).toBe(true);
    expect(c.strongBuyAllowed).toBe(true);
    expect(c.dataQuality).toBe('VERIFIED');
    expect(c.confidence).toBe('VERIFIED');
    expect(c.reason).toBe('OFFICIAL_SECTOR_COVERAGE_PASS');
    const blocks = enforceSectorEnergyTopBlockConsistency(c, ['NONE']);
    expect(blocks).not.toContain(SECTOR_OFFICIAL_PROMOTION_DISABLED);
  });

  it('Test 2: 10/11 verified → 90.9% PASS, all allowed', () => {
    const c = stateWithVerified(10);
    expect(c.promotionCoverage).toBeCloseTo(0.909, 3);
    expect(c.promotionCoveragePass).toBe(true);
    expect(c.promotionAllowed).toBe(true);
    expect(c.sectorBoostAllowed).toBe(true);
    expect(c.strongBuyAllowed).toBe(true);
    expect(c.dataQuality).toBe('PARTIAL');
  });

  it('Test 3: 9/11 verified → 81.8% PASS, all allowed', () => {
    const c = stateWithVerified(9);
    expect(c.promotionCoverage).toBeCloseTo(0.818, 3);
    expect(c.promotionCoveragePass).toBe(true);
    expect(c.promotionAllowed).toBe(true);
    expect(c.sectorBoostAllowed).toBe(true);
    expect(c.strongBuyAllowed).toBe(true);
  });

  it('Test 4: 8/11 verified → 72.7% FAIL, all disabled, DISABLED block present', () => {
    const c = stateWithVerified(8);
    expect(c.promotionCoverage).toBeCloseTo(0.727, 3);
    expect(c.promotionCoveragePass).toBe(false);
    expect(c.promotionAllowed).toBe(false);
    expect(c.sectorBoostAllowed).toBe(false);
    expect(c.strongBuyAllowed).toBe(false);
    expect(c.reason).toBe('OFFICIAL_SECTOR_COVERAGE_BELOW_THRESHOLD');
    const blocks = enforceSectorEnergyTopBlockConsistency(c, ['NONE']);
    expect(blocks).toContain(SECTOR_OFFICIAL_PROMOTION_DISABLED);
  });
});

describe('SectorEnergyCanonicalResolver — diagnostic inputs never drive decision', () => {
  it('Test 5: KIS basket derived present + 8/11 official → basket diagnosticOnly, promotion disabled', () => {
    const c = resolveSectorEnergyCanonicalState({
      officialKisSectorIndex: kisIndexWithVerified(8),
      kisBasketDerived: { coverage: 1.0, validSectorCount: 12 },
    });
    expect(c.promotionAllowed).toBe(false);
    expect(c.sectorBoostAllowed).toBe(false);
    expect(c.strongBuyAllowed).toBe(false);
    const out = renderSectorEnergyCanonicalOutput(c, { kisBasketDerivedStatus: 'DIAGNOSTIC_ONLY' });
    expect(out).toContain('kisBasketDerivedStatus=DIAGNOSTIC_ONLY');
  });

  it('Test 6: internalGroupedSnapshotCoverage=100 + 8/11 official → grouped diagnosticOnly, promotion disabled', () => {
    const c = resolveSectorEnergyCanonicalState({
      officialKisSectorIndex: kisIndexWithVerified(8),
      internalGroupedSnapshot: { coverage: 1.0 },
    });
    expect(c.promotionAllowed).toBe(false);
    expect(c.sectorBoostAllowed).toBe(false);
    expect(c.strongBuyAllowed).toBe(false);
    const out = renderSectorEnergyCanonicalOutput(c, { internalGroupedSnapshotCoverage: 1.0 });
    expect(out).toContain('internalGroupedSnapshotCoverage=100.0% diagnosticOnly=true');
  });

  it('Test 10: validSectorCount=12/12 present → diagnosticOnly, officialSectorCount stays 11', () => {
    const c = resolveSectorEnergyCanonicalState({
      officialKisSectorIndex: kisIndexWithVerified(11),
      internalGroupedSnapshot: { validSectorCount: 12, expectedSectorCount: 12, coverage: 1.0 },
      oldOfficialTargetCoverage: 12 / 15,
    });
    expect(c.officialSectorCount).toBe(11);
    expect(c.verifiedOfficialSectorCount).toBe(11);
    // 12/12 internal grouped is not the denominator — coverage is verified/11.
    expect(c.promotionCoverage).toBeCloseTo(1.0, 6);
    const out = renderSectorEnergyCanonicalOutput(c, {
      oldOfficialTargetCoverage: 12 / 15,
      internalGroupedSnapshotCoverage: 1.0,
    });
    expect(out).toContain('officialSectorCount=11');
    expect(out).toContain('diagnosticOnly=true');
    expect(out).not.toContain('officialSectorCount=12');
  });
});

describe('SectorEnergyCanonicalResolver — theme tag policy', () => {
  it('Test 7: 조선/방산/원자력/이차전지 are theme-tag-only, never official', () => {
    for (const tag of EXCLUDED_THEME_TAGS) {
      const p = SECTOR_THEME_TAG_POLICY[tag];
      expect(p.themeTagOnly).toBe(true);
      expect(p.includeInSectorEnergyUniverse).toBe(false);
      expect(p.includeInPromotionDenominator).toBe(false);
      expect(p.includeInPromotionNumerator).toBe(false);
      expect(p.useForLivePromotion).toBe(false);
      expect(p.useForSectorBoost).toBe(false);
      expect(p.useForStrongBuy).toBe(false);
      expect(p.useForShadowEvidence).toBe(true);
      expect(p.executionImpact).toBe('NONE');
    }
  });

  it('theme tags supplied as verified sectors are excluded from the official count', () => {
    const c = resolveSectorEnergyCanonicalState({
      officialKisSectorIndex: { verifiedSectors: [...OFFICIAL_SECTOR_ENERGY_11, '조선', '방산', '원자력', '이차전지'] },
    });
    expect(c.verifiedOfficialSectorCount).toBe(11);
    expect(c.officialSectorCount).toBe(11);
  });
});

describe('SectorEnergyCanonicalResolver — renderer authority', () => {
  it('Test 8: legacy promotionAllowed differing from canonical is overridden with canonical value', () => {
    const c = stateWithVerified(8); // canonical.promotionAllowed = false
    const result = overrideWithCanonicalPromotion(c, { promotionAllowed: true });
    expect(result.promotionAllowed).toBe(false); // canonical wins
    expect(result.mismatch).toBe(true);
    expect(result.mismatchCode).toBe('CANONICAL_STATE_MISMATCH');
  });

  it('locks rendered output to canonical when legacy Gate2 promotion survives as true', () => {
    const c = stateWithVerified(8);
    const rendered = lockSectorEnergyOutputToCanonical({
      promotionAllowed: true,
      sectorBoostAllowed: true,
      strongBuyAllowed: true,
      legacyPromotionAllowedDiagnosticOnly: true,
    }, c);
    expect(rendered.promotionAllowed).toBe(false);
    expect(rendered.sectorBoostAllowed).toBe(false);
    expect(rendered.strongBuyAllowed).toBe(false);
    expect(rendered.legacyPromotionAllowedDiagnosticOnly).toBe(true);
    expect(rendered.canonicalLocked).toBe(true);
  });

  it('keeps grouped legacy strong-buy as diagnostic-only while canonical strong-buy stays false', () => {
    const c = stateWithVerified(8);
    const rendered = lockSectorEnergyOutputToCanonical({
      legacyStrongBuyAllowedDiagnosticOnly: true,
      strongBuyAllowed: true,
    }, c);
    expect(rendered.strongBuyAllowed).toBe(false);
    expect(rendered.legacyStrongBuyAllowedDiagnosticOnly).toBe(true);
  });

  it('does not fallback to legacy when canonical state is missing', () => {
    const c = sectorEnergyCanonicalOrMissing(undefined);
    const rendered = lockSectorEnergyOutputToCanonical({
      promotionAllowed: true,
      sectorBoostAllowed: true,
      strongBuyAllowed: true,
    }, c);
    expect(c).toEqual(missingSectorEnergyCanonicalState());
    expect(rendered.dataQuality).toBe('MISSING');
    expect(rendered.promotionAllowed).toBe(false);
    expect(rendered.sectorBoostAllowed).toBe(false);
    expect(rendered.strongBuyAllowed).toBe(false);
    expect(rendered.reason).toBe('SECTOR_ENERGY_CANONICAL_STATE_MISSING');
  });

  it('uses canonical selectedSourceTier over legacy diagnostic selectedSourceTier', () => {
    const c = missingSectorEnergyCanonicalState();
    const rendered = lockSectorEnergyOutputToCanonical({
      selectedSourceTier: 'OFFICIAL_KIS_SECTOR_INDEX',
      legacySelectedSourceTierDiagnosticOnly: 'OFFICIAL_KIS_SECTOR_INDEX',
    }, c);
    expect(rendered.selectedSourceTier).toBe('NONE');
    expect(rendered.legacySelectedSourceTierDiagnosticOnly).toBe('OFFICIAL_KIS_SECTOR_INDEX');
  });

  it('Test 9: DISABLED block + strongBuyAllowed=true throws SECTOR_ENERGY_CANONICAL_TOPBLOCK_CONFLICT', () => {
    const passing = stateWithVerified(11); // strongBuyAllowed = true
    expect(() =>
      assertSectorEnergyTopBlockConsistency(passing, [SECTOR_OFFICIAL_PROMOTION_DISABLED]),
    ).toThrow('SECTOR_ENERGY_CANONICAL_TOPBLOCK_CONFLICT');
  });
});

describe('SectorEnergyCanonicalResolver — source tier ordering', () => {
  it('selects OFFICIAL_KIS_SECTOR_INDEX when KIS is usable', () => {
    const c = resolveSectorEnergyCanonicalState({
      officialKisSectorIndex: kisIndexWithVerified(11),
      officialKrxSectorIndex: kisIndexWithVerified(11),
    });
    expect(c.selectedSourceTier).toBe('OFFICIAL_KIS_SECTOR_INDEX');
  });

  it('falls back to OFFICIAL_KRX_SECTOR_INDEX when KIS missing', () => {
    const c = resolveSectorEnergyCanonicalState({
      officialKrxSectorIndex: kisIndexWithVerified(9),
    });
    expect(c.selectedSourceTier).toBe('OFFICIAL_KRX_SECTOR_INDEX');
  });

  it('resolves to NONE / SOURCE_MISSING when neither official source present', () => {
    const c = resolveSectorEnergyCanonicalState({
      kisBasketDerived: { coverage: 1.0 },
      internalGroupedSnapshot: { coverage: 1.0 },
    });
    expect(c.selectedSourceTier).toBe('NONE');
    expect(c.dataQuality).toBe('MISSING');
    expect(c.reason).toBe('OFFICIAL_SECTOR_SOURCE_MISSING');
    expect(c.promotionAllowed).toBe(false);
  });
});

describe('SectorEnergyCanonicalResolver — invariants', () => {
  const samples: SectorEnergyCanonicalState[] = [0, 5, 8, 9, 10, 11].map((n) => stateWithVerified(n));

  it('Invariant 1: officialSectorCount === 11', () => {
    for (const c of samples) expect(c.officialSectorCount).toBe(11);
  });

  it('Invariant 2: promotionCoverage === verifiedOfficialSectorCount / 11', () => {
    for (const c of samples) {
      expect(c.promotionCoverage).toBeCloseTo(c.verifiedOfficialSectorCount / 11, 9);
    }
  });

  it('Invariant 3: pass=false implies promotion/boost/strongBuy all false', () => {
    for (const c of samples) {
      if (c.promotionCoveragePass === false) {
        expect(c.promotionAllowed).toBe(false);
        expect(c.sectorBoostAllowed).toBe(false);
        expect(c.strongBuyAllowed).toBe(false);
      }
    }
  });

  it('Invariant 4: promotionAllowed=true implies TopBlocks has no DISABLED after enforcement', () => {
    for (const c of samples) {
      const blocks = enforceSectorEnergyTopBlockConsistency(c, ['SHADOW_ONLY_POLICY', SECTOR_OFFICIAL_PROMOTION_DISABLED]);
      if (c.promotionAllowed === true) expect(blocks).not.toContain(SECTOR_OFFICIAL_PROMOTION_DISABLED);
    }
  });

  it('Invariant 5: enforcement adds DISABLED whenever promotion disabled', () => {
    for (const c of samples) {
      const blocks = enforceSectorEnergyTopBlockConsistency(c, ['NONE']);
      if (c.promotionAllowed === false) expect(blocks).toContain(SECTOR_OFFICIAL_PROMOTION_DISABLED);
    }
  });

  it('Invariant 6: excludedThemeTags fixed to the four non-official theme tags', () => {
    for (const c of samples) {
      expect(c.excludedThemeTags).toEqual(EXCLUDED_THEME_TAGS);
    }
  });

  it('Invariant 7: executionImpact always NONE', () => {
    for (const c of samples) expect(c.executionImpact).toBe('NONE');
  });

  it('Invariant 8: pass=false and promotionAllowed=true cannot coexist', () => {
    for (const c of samples) {
      expect(c.promotionCoveragePass === false && c.promotionAllowed === true).toBe(false);
    }
  });

  it('Invariant 9: enforced blocks never pair DISABLED with strongBuyAllowed=true', () => {
    for (const c of samples) {
      const blocks = enforceSectorEnergyTopBlockConsistency(c, ['NONE']);
      const hasDisabled = blocks.includes(SECTOR_OFFICIAL_PROMOTION_DISABLED);
      expect(hasDisabled && c.strongBuyAllowed === true).toBe(false);
      // and the runtime guard agrees
      expect(() => assertSectorEnergyTopBlockConsistency(c, blocks)).not.toThrow();
    }
  });

  it('OFFICIAL_SECTOR_COUNT constant equals 11 and list length is 11', () => {
    expect(OFFICIAL_SECTOR_COUNT).toBe(11);
    expect(OFFICIAL_SECTOR_ENERGY_11).toHaveLength(11);
  });
});
