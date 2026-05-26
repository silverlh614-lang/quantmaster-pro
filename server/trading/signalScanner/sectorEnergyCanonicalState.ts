// @responsibility ADR-0488 master report → SectorEnergyCanonicalState 어댑터. 공식 11개 denominator 로 재기준, 진단값 분리. executionImpact=NONE.

import {
  resolveSectorEnergyCanonicalState,
  type SectorEnergyCanonicalState,
  type SectorEnergyDiagnosticSources,
  type ResolveSectorEnergyCanonicalInput,
} from '../../../src/domain/sector-energy/SectorEnergyCanonicalResolver.js';
import type { SectorEnergyMasterSupplyLineReportAdr0488 } from './sectorEnergyMasterSupplyUnknownPolicyAdr0488/types.js';

function clamp01Pct(value: number | undefined): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) return 0;
  if (value <= 0) return 0;
  if (value >= 100) return 100;
  return value;
}

/**
 * 공식 source 의 verified coverage(%) 를 공식 11개 denominator 의 정수 count 로 재기준한다.
 * master.promotionAllowed 와 경계(80%)에서 일치하도록 보정 — LIVE 판단 byte-equivalent 보존.
 */
function deriveVerifiedOfficialCount(master: SectorEnergyMasterSupplyLineReportAdr0488): number {
  const coveragePct = clamp01Pct(master.safeOfficialVerifiedCoverage ?? master.verifiedIndexCodeCoverage);
  let count = Math.round((coveragePct / 100) * 11);
  if (count < 0) count = 0;
  if (count > 11) count = 11;
  // 경계 정합: master 의 공식 promotion 결정과 canonical pass(>=9) 를 일치시킨다.
  if (master.promotionAllowed === true && count < 9) count = 9;
  if (master.promotionAllowed === false && count >= 9) count = 8;
  return count;
}

/**
 * ADR-0488 master report 로부터 SectorEnergyCanonicalState 를 생성한다.
 * 공식 KIS/KRX index 만 source 로 인정하고, 나머지(basket/grouped)는 진단으로 분리한다.
 */
export function deriveSectorEnergyCanonicalState(
  master: SectorEnergyMasterSupplyLineReportAdr0488,
): SectorEnergyCanonicalState {
  const verifiedCount = deriveVerifiedOfficialCount(master);
  const tier = master.selectedSectorEnergySourceTier;

  const input: ResolveSectorEnergyCanonicalInput = {
    oldOfficialTargetCoverage: clamp01Pct(master.officialTargetVerifiedCoverageDiagnostic) / 100,
    kisBasketDerived: { status: 'DIAGNOSTIC_ONLY' },
    internalGroupedSnapshot: { coverage: clamp01Pct(master.internalGroupedSnapshotCoverage) / 100 },
  };

  if (tier === 'OFFICIAL_KIS_SECTOR_INDEX') {
    input.officialKisSectorIndex = { verifiedCount };
  } else if (tier === 'OFFICIAL_KRX_SECTOR_INDEX') {
    input.officialKrxSectorIndex = { verifiedCount };
  } else if (master.promotionAllowed === true) {
    // 공식 promotion 결정은 공식 source 를 함의한다 — 기본적으로 KIS official 로 귀속.
    input.officialKisSectorIndex = { verifiedCount };
  }
  // 그 외(INTERNAL_GROUPED_SNAPSHOT / KIS_STOCK_BASKET_DERIVED / NONE)는 공식 source 없음 → NONE.

  return resolveSectorEnergyCanonicalState(input);
}

/** 진단 source 블록 렌더용 입력 (모두 diagnosticOnly). */
export function deriveSectorEnergyDiagnosticSources(
  master: SectorEnergyMasterSupplyLineReportAdr0488,
): SectorEnergyDiagnosticSources {
  return {
    oldOfficialTargetCoverage: clamp01Pct(master.officialTargetVerifiedCoverageDiagnostic) / 100,
    internalGroupedSnapshotCoverage: clamp01Pct(master.internalGroupedSnapshotCoverage) / 100,
    groupedValidSectorCount: master.internalGroupedValidSectorCount,
    groupedExpectedSectorCount: master.internalGroupedExpectedSectorCount,
    kisBasketDerivedStatus: 'DIAGNOSTIC_ONLY',
    kisBasketOfficialEquivalent: false,
    kisBasketUseForPromotion: false,
  };
}
