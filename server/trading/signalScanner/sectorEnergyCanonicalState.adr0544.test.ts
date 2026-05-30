// @responsibility ADR-0544 어댑터 회귀 — master.reasonCodes 세션 신호 → resolver 입력 매핑 + ENV rollback. executionImpact=NONE.

import { afterEach, describe, expect, it } from 'vitest';
import { deriveSectorEnergyCanonicalState } from './sectorEnergyCanonicalState.js';
import type { SectorEnergyMasterSupplyLineReportAdr0488 } from './sectorEnergyMasterSupplyUnknownPolicyAdr0488/types.js';

/** 최소 master 픽스처 — verified=0 (per-sector 데이터 없음 → fallback count 0). */
function masterFixture(reasonCodes: string[]): SectorEnergyMasterSupplyLineReportAdr0488 {
  return {
    generatedAt: '2026-05-30T00:00:00.000Z',
    status: 'PARTIAL',
    records: [],
    mappingDiagnostics: {} as never,
    indexCodeCoverageBefore: 0,
    indexCodeCoverageAfter: 0,
    officialIndexCoverage: 0,
    verifiedIndexCodeCoverage: 0,
    internalGroupedSnapshotCoverage: 0,
    internalProxyCoverage: 0,
    stockDailyFallbackCoverage: 0,
    aliasResolvedCount: 0,
    aliasUnsafeCount: 0,
    unresolvedSectorCount: 0,
    coveragePct: 0,
    fresh: 0,
    stale: 0,
    missing: 1,
    providerError: 0,
    fallbackUsed: 'NONE',
    leadershipConfidence: 'SHADOW_ONLY',
    leadershipBlockReason: 'NONE',
    promotionAllowed: false,
    sectorBoostAllowed: false,
    strongBuyAllowed: false,
    shadowLeadershipAllowed: true,
    counterfactualAllowed: true,
    selectedSectorEnergySourceTier: 'NONE',
    reasonCodes,
    topMissingSectorNames: [],
    liveExecutionAllowed: false,
    executionImpact: 'NONE',
    operatorApprovalRequired: true,
    officialIndexMasterRecovery: {} as never,
    topGaps: [],
    recommendedNextActions: [],
    diagnostics: [],
  };
}

describe('ADR-0544 adapter — session signal mapping', () => {
  afterEach(() => {
    delete process.env.SECTOR_ENERGY_SESSION_ISOLATION_ADR0544_DISABLED;
  });

  it('휴일 reasonCodes(SECTOR_INDEX_MARKET_CLOSED) → SESSION_NOT_VERIFIABLE 분류 + promotion=false', () => {
    const c = deriveSectorEnergyCanonicalState(masterFixture(['SECTOR_INDEX_MARKET_CLOSED', 'HOLIDAY_NO_SESSION_OBSERVE_ONLY']));
    expect(c.verifiedOfficialSectorCount).toBe(0);
    expect(c.dataQuality).toBe('SESSION_NOT_VERIFIABLE');
    expect(c.reason).toBe('SECTOR_INDEX_VERIFY_SKIPPED_SESSION_CLOSED');
    expect(c.sectorIndexVerifyMode).toBe('VERIFY_SKIPPED_SESSION_CLOSED');
    // 게이팅 불변
    expect(c.promotionAllowed).toBe(false);
    expect(c.sectorBoostAllowed).toBe(false);
    expect(c.strongBuyAllowed).toBe(false);
    expect(c.shadowLeadershipAllowed).toBe(true);
    expect(c.counterfactualAllowed).toBe(true);
    expect(c.executionImpact).toBe('NONE');
  });

  it('장중 reasonCodes(세션 신호 없음) verified=0 → 기존 MISSING / OFFICIAL_SECTOR_SOURCE_MISSING 유지', () => {
    const c = deriveSectorEnergyCanonicalState(masterFixture(['OFFICIAL_INDEX_API_VERIFY_FAILED']));
    expect(c.dataQuality).toBe('MISSING');
    expect(c.reason).toBe('OFFICIAL_SECTOR_SOURCE_MISSING');
    expect(c.sectorIndexVerifyMode).toBe('LIVE_VERIFY');
  });

  it('T9: ENV DISABLED=true → 휴일 입력도 byte-equivalent MISSING 으로 복귀, promotion 여전히 false', () => {
    process.env.SECTOR_ENERGY_SESSION_ISOLATION_ADR0544_DISABLED = 'true';
    const c = deriveSectorEnergyCanonicalState(masterFixture(['SECTOR_INDEX_MARKET_CLOSED', 'HOLIDAY_NO_SESSION_OBSERVE_ONLY']));
    expect(c.dataQuality).toBe('MISSING');
    expect(c.reason).toBe('OFFICIAL_SECTOR_SOURCE_MISSING');
    expect(c.promotionAllowed).toBe(false);
    expect(c.sectorBoostAllowed).toBe(false);
    expect(c.strongBuyAllowed).toBe(false);
  });
});
