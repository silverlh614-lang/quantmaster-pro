import { describe, expect, it } from 'vitest';
import { createSectorAliasResolver } from './sectorAliasResolver.js';
import { deriveSectorCoverageReport } from './sectorCoverage.js';
import { applyFallbackContaminationGuard } from './fallbackContaminationGuard.js';
import { getSectorIndexMasterItems, type SectorIndexMasterItem } from './sectorIndexMaster.js';
import { deriveSectorProviderHealth } from './sectorProviderHealth.js';
import { scoreSectorEnergyAdr0462 } from './sectorEnergyScorer.js';
import { validateSectorSymmetry } from './sectorSymmetryValidator.js';
import { buildSectorEnergyAudit, formatSectorEnergyAuditTelegram } from './sectorEnergyAuditAdr0462.js';

function coverageWith(valid: number, total = 10) {
  const ids = Array.from({ length: valid }, (_, index) => `S${index}`);
  const master: SectorIndexMasterItem[] = Array.from({ length: total }, (_, index) => ({
    canonicalSectorId: `S${index}`,
    canonicalSectorName: `Sector ${index}`,
    displayNameKo: `섹터${index}`,
    krxIndexCode: `IDX${index}`,
    aliases: [`섹터${index}`],
    isTradableSector: true,
    sourceTier: 'KRX_INDEX',
    confidence: 'VERIFIED',
  }));
  return deriveSectorCoverageReport({
    validCanonicalSectorIds: ids,
    validIndexCodes: ids.map((id) => `IDX${id.slice(1)}`),
    validAliases: ids.map((id) => `섹터${id.slice(1)}`),
    providerHealthyCanonicalSectorIds: ids,
  }, master);
}

const okSymmetry = { ok: true, failedReasons: [], duplicateAliases: [], unresolvedAliases: [], missingIndexCodes: [], reverseLookupFailures: [], aggregateIgnored: 0 };

describe('ADR-0462 SectorEnergy SSOT + fallback guard', () => {
  it('stock daily fallback does not affect leadership score', () => {
    const result = scoreSectorEnergyAdr0462({ sourceTier: 'STOCK_DAILY_FALLBACK', coverage: coverageWith(10), symmetryValidation: okSymmetry, rawLeadershipScore: 88 });
    expect(result.leadershipScore).toBe(0);
    expect(result.fallbackContributionToScore).toBe(0);
  });

  it('stock daily fallback does not create sectorBoost', () => {
    const guarded = applyFallbackContaminationGuard({ sourceTier: 'STOCK_DAILY_FALLBACK', sectorBoost: 1, leadershipConfidence: 'OK' });
    expect(guarded.sectorBoost).toBe(0);
    expect(guarded.leadershipConfidence).toBe('BLOCKED');
  });

  it('stock daily fallback does not force executionHardBlock', () => {
    const result = scoreSectorEnergyAdr0462({ sourceTier: 'STOCK_DAILY_FALLBACK', coverage: coverageWith(10), symmetryValidation: okSymmetry, rawLeadershipScore: 88 });
    expect(result.executionHardBlock).toBe(false);
  });

  it('low index coverage blocks STRONG_BUY but does not hard block engine', () => {
    const result = scoreSectorEnergyAdr0462({ sourceTier: 'KRX_INDEX', coverage: coverageWith(2, 10), symmetryValidation: okSymmetry, rawLeadershipScore: 70 });
    expect(result.dataQuality).toBe('DEGRADED');
    expect(result.strongBuyBlocked).toBe(true);
    expect(result.executionHardBlock).toBe(false);
    expect(result.reasons).toContain('INDEX_CODE_COVERAGE_LOW');
  });

  it('symmetry validation passes with canonical sector and alias', () => {
    const result = validateSectorSymmetry([{
      canonicalSectorId: 'SEMICONDUCTOR', canonicalSectorName: '반도체', displayNameKo: '반도체', krxIndexCode: 'IDX1', aliases: ['반도체', '칩'], isTradableSector: true, sourceTier: 'KRX_INDEX', confidence: 'VERIFIED',
    }]);
    expect(result.ok).toBe(true);
  });

  it('duplicate alias fails symmetry validation', () => {
    const result = validateSectorSymmetry([
      { canonicalSectorId: 'A', canonicalSectorName: 'A', displayNameKo: 'A', krxIndexCode: 'A1', aliases: ['공통'], isTradableSector: true, sourceTier: 'KRX_INDEX', confidence: 'VERIFIED' },
      { canonicalSectorId: 'B', canonicalSectorName: 'B', displayNameKo: 'B', krxIndexCode: 'B1', aliases: ['공통'], isTradableSector: true, sourceTier: 'KRX_INDEX', confidence: 'VERIFIED' },
    ]);
    expect(result.ok).toBe(false);
    expect(result.failedReasons).toContain('DUPLICATE_ALIAS');
  });

  it('aggregate ignored is counted but does not crash scorer', () => {
    const result = validateSectorSymmetry([
      { canonicalSectorId: 'OTHER', canonicalSectorName: '기타', displayNameKo: '기타', krxIndexCode: 'IDX0', aliases: ['기타'], aggregateGroup: 'AGGREGATE_OTHER', isTradableSector: false, sourceTier: 'KRX_INDEX', confidence: 'VERIFIED' },
    ]);
    expect(result.aggregateIgnored).toBe(1);
    expect(() => scoreSectorEnergyAdr0462({ sourceTier: 'KRX_INDEX', coverage: coverageWith(10), symmetryValidation: result, rawLeadershipScore: 10 })).not.toThrow();
  });

  it('denominator consistency across validator/scorer/router', () => {
    const master = getSectorIndexMasterItems();
    const report = deriveSectorCoverageReport({
      validCanonicalSectorIds: master.filter((item) => item.isTradableSector).map((item) => item.canonicalSectorId),
      validIndexCodes: master.flatMap((item) => item.krxIndexCode ? [item.krxIndexCode] : []),
      validAliases: master.flatMap((item) => item.aliases),
      providerHealthyCanonicalSectorIds: master.filter((item) => item.isTradableSector).map((item) => item.canonicalSectorId),
    });
    const validation = validateSectorSymmetry();
    const scored = scoreSectorEnergyAdr0462({ sourceTier: 'KRX_INDEX', coverage: report, symmetryValidation: validation, rawLeadershipScore: 10 });
    const audit = buildSectorEnergyAudit({ coverage: report, scorer: scored, symmetryValidation: validation, sourceTier: 'KRX_INDEX' });
    expect(scored.indexCodeCoverage.total).toBe(report.indexCodeCoverage.total);
    expect(audit.indexCodeCoverage.total).toBe(report.indexCodeCoverage.total);
  });

  it('provider cache empty is provider issue, not market signal', () => {
    const health = deriveSectorProviderHealth({ cacheSize: 0, now: new Date('2026-05-08T00:00:00.000Z') });
    expect(health.providerHealth).toBe('EMPTY');
    expect(health.marketSignal).toBe(false);
    expect(health.reasons).toContain('PROVIDER_CACHE_EMPTY');
  });

  it('SectorEnergy DEGRADED keeps engine alive and separates leadershipBlocked/executionHardBlock', () => {
    const result = scoreSectorEnergyAdr0462({ sourceTier: 'KRX_INDEX', coverage: coverageWith(1, 10), symmetryValidation: okSymmetry, rawLeadershipScore: 20 });
    const audit = buildSectorEnergyAudit({ coverage: coverageWith(1, 10), scorer: result, symmetryValidation: okSymmetry, sourceTier: 'KRX_INDEX' });
    const telegram = formatSectorEnergyAuditTelegram(audit);
    expect(result.leadershipConfidence).toBe('BLOCKED');
    expect(result.executionHardBlock).toBe(false);
    expect(telegram).toContain('• engine: ALIVE');
    expect(telegram).toContain('• learning/counterfactual: KEPT');
  });

  it('alias resolver records missing, aggregate ignored, and recovered aliases without throwing', () => {
    const resolver = createSectorAliasResolver([
      { canonicalSectorId: 'A', canonicalSectorName: 'A', displayNameKo: '정식', krxIndexCode: 'A1', aliases: ['정식', '별칭'], isTradableSector: true, sourceTier: 'KRX_INDEX', confidence: 'VERIFIED' },
      { canonicalSectorId: 'OTHER', canonicalSectorName: '기타', displayNameKo: '기타', aliases: ['기타'], aggregateGroup: 'AGGREGATE_OTHER', isTradableSector: false, sourceTier: 'STOCK_DAILY_FALLBACK', confidence: 'DEGRADED' },
    ]);
    const audit = resolver.auditAliases(['별칭', '없는별칭', '기타']);
    expect(audit.recoveredAliases).toEqual(['별칭']);
    expect(audit.aliasMissing).toEqual(['없는별칭']);
    expect(audit.aggregateIgnored).toEqual(['기타']);
    expect(resolver.resolveIndexCode('A1')).toBe('A');
  });
});
