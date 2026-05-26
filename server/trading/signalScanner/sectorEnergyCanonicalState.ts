// @responsibility ADR-0488 master report → SectorEnergyCanonicalState 어댑터. 공식 11개 denominator 로 재기준, 진단값 분리. executionImpact=NONE.

import {
  resolveSectorEnergyCanonicalState,
  resolveOfficialSectorEnergyCoverage,
  type SectorEnergyCanonicalState,
  type SectorEnergyDiagnosticSources,
  type ResolveSectorEnergyCanonicalInput,
  type IndexMasterRow,
  type IndexVerifyResult,
} from '../../../src/domain/sector-energy/SectorEnergyCanonicalResolver.js';
import type { SectorEnergyMasterSupplyLineReportAdr0488 } from './sectorEnergyMasterSupplyUnknownPolicyAdr0488/types.js';

function clamp01Pct(value: number | undefined): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) return 0;
  if (value <= 0) return 0;
  if (value >= 100) return 100;
  return value;
}

function clampOfficialCount(value: number): number {
  if (!Number.isFinite(value) || value <= 0) return 0;
  const floored = Math.round(value);
  return floored > 11 ? 11 : floored;
}

/**
 * ADR-0535: per-sector verify 데이터가 없을 때(시장 폐장/요약만 존재)의 fallback count.
 * 공식 11개 denominator 와 정합하는 safe-official(unsafe theme alias 제외) verified 를 우선 사용한다.
 * officialTarget(denominator 15) coverage 는 공식 11개 기준이 아니므로 최후 수단으로만 본다.
 */
function deriveVerifiedOfficialCount(master: SectorEnergyMasterSupplyLineReportAdr0488): number {
  const official = master.officialSectorIndexMaster;
  const directSafeCount = official?.promotionReadiness?.safeOfficialVerifiedCount;
  if (typeof directSafeCount === 'number' && Number.isFinite(directSafeCount)) {
    return clampOfficialCount(directSafeCount);
  }
  const safePct = clamp01Pct(
    official?.promotionReadiness?.safeOfficialVerifiedCoverage
      ?? official?.coverageMetrics?.verifiedCoverageExcludingUnsafeAlias
      ?? official?.verifiedCoverageExcludingUnsafeAlias
      ?? master.safeOfficialVerifiedCoverage
      ?? master.officialTargetVerifiedCoverageDiagnostic
      ?? master.verifiedIndexCodeCoverage,
  );
  return clampOfficialCount((safePct / 100) * 11);
}

/**
 * master 의 per-sector verify 결과 → canonical resolver 입력(rows/results) 으로 변환한다.
 * verify 결과가 없으면 null (→ fallback count 경로).
 */
function buildOfficialIndexInputsFromMaster(
  master: SectorEnergyMasterSupplyLineReportAdr0488,
): { rows: IndexMasterRow[]; results: IndexVerifyResult[] } | null {
  const official = master.officialSectorIndexMaster;
  const verifyResults = official?.verificationResults;
  if (!official || !Array.isArray(verifyResults) || verifyResults.length === 0) return null;

  // 옵션 A: canonical count 는 verify 성공을 따른다 — value-quality(zero-current-index)는 진단 전용이므로
  // indexValueUsable 를 count gate 로 쓰지 않는다.
  const results: IndexVerifyResult[] = verifyResults.map((r) => ({
    indexCode: String(r.idxCode ?? r.officialIndexCode ?? '').trim() || undefined,
    indexName: r.rawIdxName ?? undefined,
    success: r.verified === true,
    verified: r.verified === true,
  }));

  const rows: IndexMasterRow[] = [];
  const seen = new Set<string>();
  const pushRow = (indexCode: string, indexName?: string, sectorName?: string): void => {
    const dedupKey = `${indexCode}|${sectorName ?? ''}|${indexName ?? ''}`;
    if (seen.has(dedupKey)) return;
    seen.add(dedupKey);
    rows.push({
      ...(indexCode ? { indexCode } : {}),
      ...(indexName ? { indexName } : {}),
      ...(sectorName ? { sectorName } : {}),
    });
  };
  for (const r of verifyResults) {
    pushRow(String(r.idxCode ?? r.officialIndexCode ?? '').trim(), r.rawIdxName ?? undefined, r.sectorName);
  }
  for (const row of official.rows ?? []) {
    pushRow(String(row.officialIndexCode ?? '').trim(), row.officialIndexName, row.rawSectorName);
  }
  return { rows, results };
}

/**
 * ADR-0488 master report 로부터 SectorEnergyCanonicalState 를 생성한다.
 * 공식 KIS/KRX index 만 source 로 인정하고, 나머지(basket/grouped)는 진단으로 분리한다.
 * ADR-0535: per-sector verify 결과가 있으면 alias map 으로 공식 11개 key 별 verified 를 직접 도출한다
 * (verifiedOfficialSectorKeys/missingOfficialSectorKeys 가 실제 데이터를 반영). 없으면 safe-official count fallback.
 */
export function deriveSectorEnergyCanonicalState(
  master: SectorEnergyMasterSupplyLineReportAdr0488,
): SectorEnergyCanonicalState {
  const tier = master.selectedSectorEnergySourceTier;

  const input: ResolveSectorEnergyCanonicalInput = {
    oldOfficialTargetCoverage: clamp01Pct(master.officialTargetVerifiedCoverageDiagnostic) / 100,
    kisBasketDerived: { status: 'DIAGNOSTIC_ONLY' },
    internalGroupedSnapshot: { coverage: clamp01Pct(master.internalGroupedSnapshotCoverage) / 100 },
  };

  const officialInputs = buildOfficialIndexInputsFromMaster(master);
  let verifiedSource: { verifiedSectors?: readonly string[]; verifiedCount?: number };
  let hasOfficialEvidence: boolean;

  if (officialInputs) {
    const coverage = resolveOfficialSectorEnergyCoverage({
      officialIndexMasterRows: officialInputs.rows,
      indexVerifyResults: officialInputs.results,
    });
    verifiedSource = { verifiedSectors: coverage.verifiedOfficialSectorKeys };
    hasOfficialEvidence = coverage.verifiedOfficialSectorCount > 0;
    input.officialIndexMasterRows = officialInputs.rows;
    input.indexVerifyResults = officialInputs.results;
  } else {
    verifiedSource = { verifiedCount: deriveVerifiedOfficialCount(master) };
    hasOfficialEvidence = (verifiedSource.verifiedCount ?? 0) > 0;
  }

  // source tier 귀속: 공식 KIS/KRX index 만 source 로 인정한다.
  if (tier === 'OFFICIAL_KRX_SECTOR_INDEX') {
    input.officialKrxSectorIndex = verifiedSource;
  } else if (tier === 'OFFICIAL_KIS_SECTOR_INDEX' || (hasOfficialEvidence && (officialInputs !== null || master.promotionAllowed === true))) {
    // 공식 verify 증거가 있으면 KIS official 로 귀속 (기본). 그 외(grouped/basket/none)는 공식 source 없음 → NONE.
    input.officialKisSectorIndex = verifiedSource;
  }

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
