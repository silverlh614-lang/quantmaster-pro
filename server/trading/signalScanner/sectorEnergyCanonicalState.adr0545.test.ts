// @responsibility ADR-0545 어댑터 회귀 — last-known snapshot write(verify성공)·read(휴일)·ENV OFF byte-equivalent. executionImpact=NONE.

import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { deriveSectorEnergyCanonicalState } from './sectorEnergyCanonicalState.js';
import type { SectorEnergyMasterSupplyLineReportAdr0488 } from './sectorEnergyMasterSupplyUnknownPolicyAdr0488/types.js';
import {
  readLatestSectorEnergyVerifiedSnapshot,
  __resetSectorEnergyVerifiedSnapshotForTests,
} from '../../persistence/sectorEnergyVerifiedSnapshotRepo.js';

/** 세션 open + per-sector verify 성공(safeOfficialVerifiedCount) master. */
function verifiedSessionOpenMaster(generatedAt: string): SectorEnergyMasterSupplyLineReportAdr0488 {
  return {
    generatedAt,
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
    missing: 0,
    providerError: 0,
    fallbackUsed: 'NONE',
    leadershipConfidence: 'SHADOW_ONLY',
    leadershipBlockReason: 'NONE',
    promotionAllowed: true,
    sectorBoostAllowed: true,
    strongBuyAllowed: true,
    shadowLeadershipAllowed: true,
    counterfactualAllowed: true,
    selectedSectorEnergySourceTier: 'OFFICIAL_KIS_SECTOR_INDEX',
    reasonCodes: [],
    topMissingSectorNames: [],
    liveExecutionAllowed: false,
    executionImpact: 'NONE',
    operatorApprovalRequired: true,
    officialIndexMasterRecovery: {} as never,
    officialSectorIndexMaster: {
      promotionReadiness: { safeOfficialVerifiedCount: 11 },
    } as never,
    topGaps: [],
    recommendedNextActions: [],
    diagnostics: [],
  };
}

/** 휴일 verify-skip master (verified=0). */
function holidayMaster(generatedAt: string): SectorEnergyMasterSupplyLineReportAdr0488 {
  return {
    ...verifiedSessionOpenMaster(generatedAt),
    selectedSectorEnergySourceTier: 'NONE',
    promotionAllowed: false,
    sectorBoostAllowed: false,
    strongBuyAllowed: false,
    officialSectorIndexMaster: undefined,
    reasonCodes: ['SECTOR_INDEX_MARKET_CLOSED', 'HOLIDAY_NO_SESSION_OBSERVE_ONLY'],
  };
}

describe('ADR-0545 adapter — last-known snapshot write/read', () => {
  beforeEach(() => {
    __resetSectorEnergyVerifiedSnapshotForTests();
    delete process.env.SECTOR_ENERGY_LAST_KNOWN_SNAPSHOT_ENABLED;
  });
  afterEach(() => {
    __resetSectorEnergyVerifiedSnapshotForTests();
    delete process.env.SECTOR_ENERGY_LAST_KNOWN_SNAPSHOT_ENABLED;
  });

  it('ENV ON + verify 성공(세션 open) → snapshot 영속', () => {
    process.env.SECTOR_ENERGY_LAST_KNOWN_SNAPSHOT_ENABLED = 'true';
    // 2026-05-29(금) 은 거래일.
    const c = deriveSectorEnergyCanonicalState(verifiedSessionOpenMaster('2026-05-29T05:00:00.000Z'));
    expect(c.verifiedOfficialSectorCount).toBeGreaterThan(0);
    const saved = readLatestSectorEnergyVerifiedSnapshot();
    expect(saved?.tradeDate).toBe('2026-05-29');
    expect(saved?.verifiedOfficialSectorCount).toBe(c.verifiedOfficialSectorCount);
  });

  it('ENV ON + 휴일(verify-skip) → write 안 함', () => {
    process.env.SECTOR_ENERGY_LAST_KNOWN_SNAPSHOT_ENABLED = 'true';
    deriveSectorEnergyCanonicalState(holidayMaster('2026-05-30T05:00:00.000Z'));
    expect(readLatestSectorEnergyVerifiedSnapshot()).toBeNull();
  });

  it('ENV ON + 휴일 + last-known 존재 → LAST_KNOWN_VALID, promotion 불변 false', () => {
    process.env.SECTOR_ENERGY_LAST_KNOWN_SNAPSHOT_ENABLED = 'true';
    // 1) 직전 거래일(2026-05-29) verify 성공 write
    deriveSectorEnergyCanonicalState(verifiedSessionOpenMaster('2026-05-29T05:00:00.000Z'));
    // 2) 휴일(2026-05-30 토) read → last-known 표시
    const c = deriveSectorEnergyCanonicalState(holidayMaster('2026-05-30T05:00:00.000Z'));
    expect(c.dataQuality).toBe('SESSION_NOT_VERIFIABLE');
    expect(c.sectorIndexVerifyMode).toBe('LAST_KNOWN_VALID');
    expect(c.lastKnown?.lastKnownUsableForLivePromotion).toBe(false);
    expect(c.lastKnown?.lastKnownUsableForShadowEvidence).toBe(true);
    // ★ 게이팅 불변
    expect(c.promotionAllowed).toBe(false);
    expect(c.sectorBoostAllowed).toBe(false);
    expect(c.strongBuyAllowed).toBe(false);
    expect(c.verifiedOfficialSectorCount).toBe(0);
  });

  it('ENV ON + 휴일 + last-known 부재 → SESSION_CLOSED_NO_LAST_KNOWN_SECTOR_SNAPSHOT', () => {
    process.env.SECTOR_ENERGY_LAST_KNOWN_SNAPSHOT_ENABLED = 'true';
    const c = deriveSectorEnergyCanonicalState(holidayMaster('2026-05-30T05:00:00.000Z'));
    expect(c.reason).toBe('SESSION_CLOSED_NO_LAST_KNOWN_SECTOR_SNAPSHOT');
    expect(c.lastKnown).toBeUndefined();
  });

  it('ENV OFF(default) → write·read 미수행 byte-equivalent (PR-1 동작), 휴일 VERIFY_SKIPPED', () => {
    // verify 성공 master 라도 write 안 함
    deriveSectorEnergyCanonicalState(verifiedSessionOpenMaster('2026-05-29T05:00:00.000Z'));
    expect(readLatestSectorEnergyVerifiedSnapshot()).toBeNull();
    // 휴일은 ADR-0544 그대로
    const c = deriveSectorEnergyCanonicalState(holidayMaster('2026-05-30T05:00:00.000Z'));
    expect(c.sectorIndexVerifyMode).toBe('VERIFY_SKIPPED_SESSION_CLOSED');
    expect(c.lastKnown).toBeUndefined();
  });
});
