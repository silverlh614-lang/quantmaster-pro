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
  applySectorEnergyCanonicalOverride,
  renderSectorEnergyCanonicalOutput,
  resolveOfficialSectorEnergyCoverage,
  assertSectorEnergyCoverageInvariants,
  OFFICIAL_SECTOR_ENERGY_BASE_VERIFY_TARGETS,
  stripStaleSectorEnergyBlockers,
  sectorEnergyRenderedStatus,
  STALE_SECTOR_ENERGY_BLOCKERS,
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

describe('applySectorEnergyCanonicalOverride — legacy field kill / renderer pass-through', () => {
  it('legacy promotionAllowed=true is overridden to canonical false and preserved as diagnostic', () => {
    const canonical = stateWithVerified(8); // promotionAllowed=false
    const legacy = {
      promotionAllowed: true,
      sectorBoostAllowed: true,
      strongBuyAllowed: true,
      leadershipConfidence: 'VERIFIED',
      selectedSectorEnergySourceTier: 'INTERNAL_GROUPED_SNAPSHOT',
      officialIndexCoverage: 73.3,
    };
    const out = applySectorEnergyCanonicalOverride(legacy, canonical);
    expect(out.promotionAllowed).toBe(false);
    expect(out.sectorBoostAllowed).toBe(false);
    expect(out.strongBuyAllowed).toBe(false);
    expect(out.legacyPromotionAllowedDiagnosticOnly).toBe(true);
    expect(out.legacySectorBoostAllowedDiagnosticOnly).toBe(true);
    expect(out.legacyStrongBuyAllowedDiagnosticOnly).toBe(true);
    // coverage 진단 수치는 보존 (단위 corruption 방지).
    expect(out.officialIndexCoverage).toBe(73.3);
    // legacy selectedSourceTier 보존, final 은 canonical tier.
    expect(out.legacySelectedSourceTierDiagnosticOnly).toBe('INTERNAL_GROUPED_SNAPSHOT');
    expect(out.selectedSourceTier).toBe('OFFICIAL_KIS_SECTOR_INDEX');
  });

  it('passing case keeps canonical true and maps leadershipConfidence=VERIFIED', () => {
    const canonical = stateWithVerified(11);
    const out = applySectorEnergyCanonicalOverride({ promotionAllowed: false, leadershipConfidence: 'BLOCKED' }, canonical);
    expect(out.promotionAllowed).toBe(true);
    expect(out.sectorBoostAllowed).toBe(true);
    expect(out.strongBuyAllowed).toBe(true);
    expect(out.leadershipConfidence).toBe('VERIFIED');
  });

  it('Invariant: override never yields promotionAllowed=true when canonical is false', () => {
    for (const n of [0, 5, 8]) {
      const canonical = stateWithVerified(n); // all fail
      const out = applySectorEnergyCanonicalOverride({ promotionAllowed: true, sectorBoostAllowed: true, strongBuyAllowed: true }, canonical);
      expect(out.promotionAllowed).toBe(false);
      expect(out.sectorBoostAllowed).toBe(false);
      expect(out.strongBuyAllowed).toBe(false);
    }
  });

  it('Invariant: MISSING canonical maps leadershipConfidence=SHADOW_ONLY (shadow still allowed)', () => {
    const canonical = resolveSectorEnergyCanonicalState({}); // NONE / MISSING
    const out = applySectorEnergyCanonicalOverride({ leadershipConfidence: 'VERIFIED' }, canonical);
    expect(out.leadershipConfidence).toBe('SHADOW_ONLY');
    expect(out.promotionAllowed).toBe(false);
  });
});

describe('resolveOfficialSectorEnergyCoverage — per-key mapping from real verify results (ADR-0535)', () => {
  // 공식 11개 key 의 첫 preferred index code (alias map SSOT 와 일치).
  const PREFERRED_CODE: Record<string, string> = {
    SEMICONDUCTOR_ELECTRONICS: '4003',
    AUTOMOTIVE_TRANSPORT_EQUIPMENT: '4002',
    MACHINERY_EQUIPMENT: '0012',
    CHEMICALS: '0008',
    BIO_HEALTHCARE_PHARMA: '4004',
    STEEL_METALS: '4008',
    CONSTRUCTION: '0018',
    FINANCIALS: '0021',
    CONSUMER_RETAIL: '0016',
    FOOD_BEVERAGE_TOBACCO: '0005',
    SERVICE_TELECOM: '4010',
  };

  function fullCoverageInputs(verifiedKeys: readonly string[] = OFFICIAL_SECTOR_ENERGY_11) {
    const officialIndexMasterRows = OFFICIAL_SECTOR_ENERGY_11.map((k) => ({ indexCode: PREFERRED_CODE[k], indexName: k }));
    const indexVerifyResults = verifiedKeys.map((k) => ({ indexCode: PREFERRED_CODE[k], success: true, verified: true }));
    return { officialIndexMasterRows, indexVerifyResults };
  }

  it('resolves all 11 official keys verified → count 11, missing empty', () => {
    const coverage = resolveOfficialSectorEnergyCoverage(fullCoverageInputs());
    expect(coverage.officialVerifyLoopSource).toBe('OFFICIAL_SECTOR_ENERGY_11');
    expect(coverage.officialVerifyLoopKeyCount).toBe(11);
    expect(coverage.officialVerifyRequestedKeys).toEqual([...OFFICIAL_SECTOR_ENERGY_11]);
    expect(coverage.verifiedOfficialSectorCount).toBe(11);
    expect(coverage.missingOfficialSectorKeys).toEqual([]);
    expect(coverage.verifiedOfficialSectorKeys).toEqual([...OFFICIAL_SECTOR_ENERGY_11]);
    expect(coverage.duplicateAliasRowsIgnored).toEqual(['AUTOMOTIVE', 'SEMICONDUCTOR', 'CONSUMER_RETAIL']);
  });

  it('CONSUMER_RETAIL verified by code 0016 is never reported missing', () => {
    const coverage = resolveOfficialSectorEnergyCoverage({
      officialIndexMasterRows: [{ indexCode: '0016', sectorName: '유통 소비재' }],
      indexVerifyResults: [{ indexCode: '0016', verified: true, indexValueUsable: true }],
    });
    expect(coverage.verifiedOfficialSectorKeys).toContain('CONSUMER_RETAIL');
    expect(coverage.missingOfficialSectorKeys).not.toContain('CONSUMER_RETAIL');
  });

  it('CONSUMER_RETAIL resolves by upstream sector name 유통 소비재 (space variant)', () => {
    const coverage = resolveOfficialSectorEnergyCoverage({
      officialIndexMasterRows: [{ indexCode: '9999', sectorName: '유통 소비재' }],
      indexVerifyResults: [{ indexCode: '9999', verified: true }],
    });
    expect(coverage.verifiedOfficialSectorKeys).toContain('CONSUMER_RETAIL');
  });

  it('FOOD_BEVERAGE_TOBACCO resolves from 0005 음식료·담배 when verified', () => {
    const coverage = resolveOfficialSectorEnergyCoverage({
      officialIndexMasterRows: [{ indexCode: '0005', indexName: '음식료·담배' }],
      indexVerifyResults: [{ indexCode: '0005', verified: true }],
    });
    expect(coverage.verifiedOfficialSectorKeys).toContain('FOOD_BEVERAGE_TOBACCO');
  });

  it('MACHINERY_EQUIPMENT resolves from 0012/4014 기계·장비 계열 when verified', () => {
    const machinery = resolveOfficialSectorEnergyCoverage({
      officialIndexMasterRows: [{ indexCode: '0012', indexName: '기계·장비' }],
      indexVerifyResults: [{ indexCode: '0012', verified: true }],
    });
    expect(machinery.verifiedOfficialSectorKeys).toContain('MACHINERY_EQUIPMENT');
    const krxMachinery = resolveOfficialSectorEnergyCoverage({
      officialIndexMasterRows: [{ indexCode: '4014', indexName: 'KRX 기계장비' }],
      indexVerifyResults: [{ indexCode: '4014', verified: true }],
    });
    expect(krxMachinery.verifiedOfficialSectorKeys).toContain('MACHINERY_EQUIPMENT');
  });

  it('SERVICE_TELECOM resolves from 4010 KRX 방송통신 / 4063 미디어&엔터테인먼트 when verified', () => {
    const broadcast = resolveOfficialSectorEnergyCoverage({
      officialIndexMasterRows: [{ indexCode: '4010', indexName: 'KRX 방송통신' }],
      indexVerifyResults: [{ indexCode: '4010', verified: true }],
    });
    expect(broadcast.verifiedOfficialSectorKeys).toContain('SERVICE_TELECOM');
    const media = resolveOfficialSectorEnergyCoverage({
      officialIndexMasterRows: [{ indexCode: '4063', indexName: 'KRX 미디어&엔터테인먼트' }],
      indexVerifyResults: [{ indexCode: '4063', verified: true }],
    });
    expect(media.verifiedOfficialSectorKeys).toContain('SERVICE_TELECOM');
  });

  it('value-quality is not a count gate: verified result with indexValueUsable omitted still counts', () => {
    const coverage = resolveOfficialSectorEnergyCoverage({
      officialIndexMasterRows: [{ indexCode: '0008', indexName: 'CHEMICALS' }],
      indexVerifyResults: [{ indexCode: '0008', verified: true }],
    });
    expect(coverage.verifiedOfficialSectorKeys).toContain('CHEMICALS');
  });
});

describe('assertSectorEnergyCoverageInvariants — critical key regression guard (ADR-0535)', () => {
  it('throws when CONSUMER_RETAIL has verified evidence (code 0016) yet is reported missing', () => {
    expect(() =>
      assertSectorEnergyCoverageInvariants(
        { missingOfficialSectorKeys: ['CONSUMER_RETAIL'] },
        {
          officialIndexMasterRows: [{ indexCode: '0016', sectorName: '유통 소비재' }],
          indexVerifyResults: [{ indexCode: '0016', verified: true }],
        },
      ),
    ).toThrow('SECTOR_ENERGY_COVERAGE_INVARIANT_VIOLATION:CONSUMER_RETAIL');
  });

  it('throws when MACHINERY_EQUIPMENT 0012/4014 is verified yet reported missing', () => {
    expect(() =>
      assertSectorEnergyCoverageInvariants(
        { missingOfficialSectorKeys: ['MACHINERY_EQUIPMENT'] },
        {
          officialIndexMasterRows: [{ indexCode: '0012', indexName: '기계·장비' }],
          indexVerifyResults: [{ indexCode: '0012', verified: true }],
        },
      ),
    ).toThrow('SECTOR_ENERGY_COVERAGE_INVARIANT_VIOLATION:MACHINERY_EQUIPMENT');
  });

  it('throws when FOOD_BEVERAGE_TOBACCO 0005 is verified yet reported missing', () => {
    expect(() =>
      assertSectorEnergyCoverageInvariants(
        { missingOfficialSectorKeys: ['FOOD_BEVERAGE_TOBACCO'] },
        {
          officialIndexMasterRows: [{ indexCode: '0005', indexName: '음식료·담배' }],
          indexVerifyResults: [{ indexCode: '0005', verified: true }],
        },
      ),
    ).toThrow('SECTOR_ENERGY_COVERAGE_INVARIANT_VIOLATION:FOOD_BEVERAGE_TOBACCO');
  });

  it('throws when SERVICE_TELECOM 4010/4063 is verified yet reported missing', () => {
    expect(() =>
      assertSectorEnergyCoverageInvariants(
        { missingOfficialSectorKeys: ['SERVICE_TELECOM'] },
        {
          officialIndexMasterRows: [{ indexCode: '4063', indexName: 'KRX 미디어&엔터테인먼트' }],
          indexVerifyResults: [{ indexCode: '4063', verified: true }],
        },
      ),
    ).toThrow('SECTOR_ENERGY_COVERAGE_INVARIANT_VIOLATION:SERVICE_TELECOM');
  });

  it('does not throw when a critical key is missing without any verified evidence', () => {
    expect(() =>
      assertSectorEnergyCoverageInvariants(
        { missingOfficialSectorKeys: ['CONSUMER_RETAIL', 'FOOD_BEVERAGE_TOBACCO', 'SERVICE_TELECOM'] },
        {
          officialIndexMasterRows: [{ indexCode: '0016', sectorName: '유통 소비재' }],
          indexVerifyResults: [{ indexCode: '0016', verified: false }],
        },
      ),
    ).not.toThrow();
  });

  it('does not throw when evidence is present but the key is correctly verified (not missing)', () => {
    const coverage = resolveOfficialSectorEnergyCoverage({
      officialIndexMasterRows: [{ indexCode: '0005', indexName: '음식료·담배' }],
      indexVerifyResults: [{ indexCode: '0005', verified: true }],
    });
    expect(() =>
      assertSectorEnergyCoverageInvariants(coverage, {
        officialIndexMasterRows: [{ indexCode: '0005', indexName: '음식료·담배' }],
        indexVerifyResults: [{ indexCode: '0005', verified: true }],
      }),
    ).not.toThrow();
  });
});

describe('OFFICIAL_SECTOR_ENERGY_BASE_VERIFY_TARGETS — always-verify universe (ADR-0534 follow-up)', () => {
  it('covers exactly the 11 official sectors, one target per key', () => {
    expect(OFFICIAL_SECTOR_ENERGY_BASE_VERIFY_TARGETS).toHaveLength(11);
    const keys = OFFICIAL_SECTOR_ENERGY_BASE_VERIFY_TARGETS.map((t) => t.key).sort();
    expect(keys).toEqual([...OFFICIAL_SECTOR_ENERGY_11].sort());
  });

  it('every base target index code is 4 digits', () => {
    for (const target of OFFICIAL_SECTOR_ENERGY_BASE_VERIFY_TARGETS) {
      expect(target.indexCode).toMatch(/^\d{4}$/);
      expect(target.sectorName.length).toBeGreaterThan(0);
    }
  });

  it('verifying the base universe resolves to 11/11 (machinery/food/service no longer missing)', () => {
    const officialIndexMasterRows = OFFICIAL_SECTOR_ENERGY_BASE_VERIFY_TARGETS.map((t) => ({ indexCode: t.indexCode, sectorName: t.sectorName }));
    const indexVerifyResults = OFFICIAL_SECTOR_ENERGY_BASE_VERIFY_TARGETS.map((t) => ({ indexCode: t.indexCode, verified: true }));
    const coverage = resolveOfficialSectorEnergyCoverage({ officialIndexMasterRows, indexVerifyResults });
    expect(coverage.verifiedOfficialSectorCount).toBe(11);
    expect(coverage.missingOfficialSectorKeys).toEqual([]);
    expect(coverage.verifiedOfficialSectorKeys).toContain('MACHINERY_EQUIPMENT');
    expect(coverage.verifiedOfficialSectorKeys).toContain('FOOD_BEVERAGE_TOBACCO');
    expect(coverage.verifiedOfficialSectorKeys).toContain('SERVICE_TELECOM');
  });
});

describe('Post-Pass cleanup — blocker/status hygiene (canonical-driven)', () => {
  function stateFrom(rows: { indexCode: string; sectorName?: string }[]): SectorEnergyCanonicalState {
    return resolveSectorEnergyCanonicalState({
      officialKisSectorIndex: { verifiedSectors: resolveOfficialSectorEnergyCoverage({
        officialIndexMasterRows: rows,
        indexVerifyResults: rows.map((r) => ({ indexCode: r.indexCode, verified: true, currentIndex: 100 })),
      }).verifiedOfficialSectorKeys },
      officialIndexMasterRows: rows,
      indexVerifyResults: rows.map((r) => ({ indexCode: r.indexCode, verified: true, currentIndex: 100 })),
    });
  }
  const passState = stateFrom(OFFICIAL_SECTOR_ENERGY_BASE_VERIFY_TARGETS.map((t) => ({ indexCode: t.indexCode, sectorName: t.sectorName })));

  it('Test 1/Invariant 1: PASS → rendered status VERIFIED (not PARTIAL)', () => {
    expect(passState.promotionCoveragePass).toBe(true);
    expect(sectorEnergyRenderedStatus(passState)).toBe('VERIFIED');
    expect(sectorEnergyRenderedStatus({ promotionCoveragePass: false, dataQuality: 'PARTIAL' })).toBe('PARTIAL');
  });

  it('Test 2/3 + Invariant 2/3/4: PASS strips stale official blockers, keeps real ones', () => {
    const blockers = stripStaleSectorEnergyBlockers(passState, [
      'OFFICIAL_INDEX_UNAVAILABLE',
      'OFFICIAL_INDEX_COVERAGE_BELOW_THRESHOLD',
      'SECTOR_OFFICIAL_PROMOTION_DISABLED',
      'FUNDAMENTAL_UNAVAILABLE',
      'BREAKOUT_MOMENTUM_FAIL',
    ]);
    expect(blockers).not.toContain('OFFICIAL_INDEX_UNAVAILABLE');
    expect(blockers).not.toContain('OFFICIAL_INDEX_COVERAGE_BELOW_THRESHOLD');
    expect(blockers).not.toContain('SECTOR_OFFICIAL_PROMOTION_DISABLED');
    expect(blockers).toContain('FUNDAMENTAL_UNAVAILABLE');
    expect(blockers).toContain('BREAKOUT_MOMENTUM_FAIL');
  });

  it('Invariant 5/2: FAIL adds SECTOR_OFFICIAL_PROMOTION_DISABLED exactly once', () => {
    const failState = { promotionAllowed: false };
    const blockers = stripStaleSectorEnergyBlockers(failState, ['SECTOR_OFFICIAL_PROMOTION_DISABLED', 'BREAKOUT_MOMENTUM_FAIL']);
    expect(blockers.filter((b) => b === 'SECTOR_OFFICIAL_PROMOTION_DISABLED')).toHaveLength(1);
    expect(blockers).toContain('BREAKOUT_MOMENTUM_FAIL');
  });

  it('Test 4/Invariant 6: verified mappings carry real index codes (never N/A)', () => {
    for (const m of passState.verifiedOfficialSectorMappings) {
      if (m.verified) {
        expect(m.selectedIndexCode).not.toBe('NONE');
        expect(m.selectedIndexCode).not.toContain('N/A');
        expect(m.selectedIndexCode).toMatch(/^\d{4}$/);
      }
    }
    const machinery = passState.verifiedOfficialSectorMappings.find((m) => m.key === 'MACHINERY_EQUIPMENT');
    expect(machinery?.selectedIndexCode).toBe('0012');
    const food = passState.verifiedOfficialSectorMappings.find((m) => m.key === 'FOOD_BEVERAGE_TOBACCO');
    expect(food?.selectedIndexCode).toBe('0005');
    const service = passState.verifiedOfficialSectorMappings.find((m) => m.key === 'SERVICE_TELECOM');
    expect(service?.selectedIndexCode).toBe('4010');
  });

  it('rendered canonical block shows real codes, not N/A(canonical-state)', () => {
    const out = renderSectorEnergyCanonicalOutput(passState);
    expect(out).not.toContain('N/A(canonical-state)');
    expect(out).toContain('MACHINERY_EQUIPMENT=VERIFIED selectedIndexCode=0012');
    expect(out).toContain('FOOD_BEVERAGE_TOBACCO=VERIFIED selectedIndexCode=0005');
    expect(out).toContain('SERVICE_TELECOM=VERIFIED selectedIndexCode=4010');
  });

  it('STALE_SECTOR_ENERGY_BLOCKERS covers the documented stale tokens', () => {
    for (const t of ['OFFICIAL_INDEX_UNAVAILABLE', 'OFFICIAL_INDEX_COVERAGE_BELOW_THRESHOLD', 'SECTOR_OFFICIAL_PROMOTION_DISABLED', 'SECTOR_ENERGY_DEGRADED']) {
      expect(STALE_SECTOR_ENERGY_BLOCKERS).toContain(t);
    }
  });
});

// ─── ADR-0544: SectorEnergy Session-Not-Verifiable Display Isolation ─────────────
describe('ADR-0544 — SectorEnergy session-not-verifiable display isolation', () => {
  const holidayInput = {
    sessionVerifiability: { sessionClosed: true, verifySkipped: true },
  } as const;

  it('T1: 휴일 verify-skip(verified=0) → SESSION_NOT_VERIFIABLE / VERIFY_SKIPPED reason', () => {
    const c = resolveSectorEnergyCanonicalState({ ...holidayInput });
    expect(c.verifiedOfficialSectorCount).toBe(0);
    expect(c.dataQuality).toBe('SESSION_NOT_VERIFIABLE');
    expect(c.reason).toBe('SECTOR_INDEX_VERIFY_SKIPPED_SESSION_CLOSED');
    expect(c.status).toBe('OBSERVE_ONLY_SESSION_CLOSED');
    expect(c.confidenceLabel).toBe('LAST_KNOWN_OR_OBSERVE_ONLY');
    expect(c.sectorIndexVerifyMode).toBe('VERIFY_SKIPPED_SESSION_CLOSED');
  });

  it('T2 (★ SSOT): 휴일 분류 변경에도 promotion/sectorBoost/strongBuy=false 불변 (false→true 회귀 0)', () => {
    const c = resolveSectorEnergyCanonicalState({ ...holidayInput });
    expect(c.promotionCoveragePass).toBe(false);
    expect(c.promotionAllowed).toBe(false);
    expect(c.sectorBoostAllowed).toBe(false);
    expect(c.strongBuyAllowed).toBe(false);
    // topBlock consistency 가드: promotion=false + DISABLED 조합은 throw 하지 않는다.
    const blocks = enforceSectorEnergyTopBlockConsistency(c, ['NONE']);
    expect(blocks).toContain(SECTOR_OFFICIAL_PROMOTION_DISABLED);
    expect(() => assertSectorEnergyTopBlockConsistency(c, blocks)).not.toThrow();
  });

  it('T3: 휴일 → shadowLeadership/counterfactual=true, executionImpact=NONE 유지', () => {
    const c = resolveSectorEnergyCanonicalState({ ...holidayInput });
    expect(c.shadowLeadershipAllowed).toBe(true);
    expect(c.counterfactualAllowed).toBe(true);
    expect(c.executionImpact).toBe('NONE');
  });

  it('T4: 장중 실제 verify 0건(session 신호 없음) → 기존 MISSING / OFFICIAL_SECTOR_SOURCE_MISSING 유지 (분리)', () => {
    const c = resolveSectorEnergyCanonicalState({});
    expect(c.dataQuality).toBe('MISSING');
    expect(c.reason).toBe('OFFICIAL_SECTOR_SOURCE_MISSING');
    expect(c.sectorIndexVerifyMode).toBe('LIVE_VERIFY');
    // sessionClosed=false 면 신규 분류가 새지 않는다.
    const c2 = resolveSectorEnergyCanonicalState({ sessionVerifiability: { sessionClosed: false, verifySkipped: false } });
    expect(c2.dataQuality).toBe('MISSING');
  });

  it('T5: 장중 부분 verify(verified=5) → PARTIAL 유지 (신규 분류 누설 없음, session AND 조건)', () => {
    const c = resolveSectorEnergyCanonicalState({
      officialKisSectorIndex: { verifiedSectors: OFFICIAL_SECTOR_ENERGY_11.slice(0, 5) },
      // 세션 신호가 있어도 verified>0 이면 SESSION_NOT_VERIFIABLE 로 새지 않는다 (count===0 AND 조건).
      sessionVerifiability: { sessionClosed: true, verifySkipped: true },
    });
    expect(c.verifiedOfficialSectorCount).toBe(5);
    expect(c.dataQuality).toBe('PARTIAL');
  });

  it('T6: 11/11 verified → VERIFIED/PASS 유지 (sessionClosed=false 무관)', () => {
    const c = resolveSectorEnergyCanonicalState({ officialKisSectorIndex: kisIndexWithVerified(11) });
    expect(c.dataQuality).toBe('VERIFIED');
    expect(c.promotionCoveragePass).toBe(true);
    expect(c.promotionAllowed).toBe(true);
  });

  it('rendered canonical block emits session display fields', () => {
    const out = renderSectorEnergyCanonicalOutput(resolveSectorEnergyCanonicalState({ ...holidayInput }));
    expect(out).toContain('dataQuality=SESSION_NOT_VERIFIABLE');
    expect(out).toContain('status=OBSERVE_ONLY_SESSION_CLOSED');
    expect(out).toContain('sectorIndexVerifyMode=VERIFY_SKIPPED_SESSION_CLOSED');
    expect(out).toContain('reason=SECTOR_INDEX_VERIFY_SKIPPED_SESSION_CLOSED');
  });
});
