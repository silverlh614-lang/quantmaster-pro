// @responsibility ADR-0488/0544/0545 master report → SectorEnergyCanonicalState 어댑터. 공식 11개 재기준, 세션 분류·last-known snapshot read/write(표시 전용). executionImpact=NONE.

import {
  resolveSectorEnergyCanonicalState,
  resolveOfficialSectorEnergyCoverage,
  type SectorEnergyCanonicalState,
  type SectorEnergyDiagnosticSources,
  type ResolveSectorEnergyCanonicalInput,
  type SectorEnergyLastKnownSnapshotDisplay,
  type IndexMasterRow,
  type IndexVerifyResult,
} from '../../../src/domain/sector-energy/SectorEnergyCanonicalResolver.js';
import type { SectorEnergyMasterSupplyLineReportAdr0488 } from './sectorEnergyMasterSupplyUnknownPolicyAdr0488/types.js';
import {
  writeSectorEnergyVerifiedSnapshot,
  readLastKnownSectorEnergyVerifiedSnapshot,
  type SectorEnergyVerifiedSnapshotRecord,
} from '../../persistence/sectorEnergyVerifiedSnapshotRepo.js';
import { isTradingDay, prevTradingDay } from '../../utils/marketDayClassifier.js';

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
    ...(typeof r.currentIndex === 'number' && Number.isFinite(r.currentIndex) ? { currentIndex: r.currentIndex } : {}),
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
/**
 * ADR-0544: master.reasonCodes 로부터 세션 신호(표시 전용)를 도출한다.
 * SECTOR_INDEX_MARKET_CLOSED / HOLIDAY_NO_SESSION_OBSERVE_ONLY 신호는 SectorIndexVerifier 가
 * 휴일/비장중 verify 스킵 시 이미 master.reasonCodes 에 push 한다 (KIS quota 0 침범).
 * ENV `SECTOR_ENERGY_SESSION_ISOLATION_ADR0544_DISABLED=true` 면 신호 미전달 → 기존 MISSING 분류
 * 그대로 (byte-equivalent rollback). 게이팅(promotion/sectorBoost/strongBuy)에는 사용하지 않는다.
 */
function deriveSessionVerifiability(
  master: SectorEnergyMasterSupplyLineReportAdr0488,
): { sessionClosed: boolean; verifySkipped: boolean } | undefined {
  if (process.env.SECTOR_ENERGY_SESSION_ISOLATION_ADR0544_DISABLED === 'true') return undefined;
  const reasonCodes = master.reasonCodes ?? [];
  const verifySkipped =
    reasonCodes.includes('SECTOR_INDEX_MARKET_CLOSED') ||
    master.officialSectorIndexMaster?.promotionReadiness?.reason === 'SECTOR_INDEX_MARKET_CLOSED_OBSERVE_ONLY';
  const sessionClosed = reasonCodes.includes('HOLIDAY_NO_SESSION_OBSERVE_ONLY') || verifySkipped;
  if (!sessionClosed && !verifySkipped) return undefined;
  return { sessionClosed, verifySkipped };
}

/**
 * ADR-0545: last-known verified sector snapshot 영속/표시 게이트.
 * default OFF (ENV 미설정) → PR-1(ADR-0544) 동작 그대로 (write·read 미수행, byte-equivalent).
 */
function lastKnownSnapshotEnabled(): boolean {
  return process.env.SECTOR_ENERGY_LAST_KNOWN_SNAPSHOT_ENABLED === 'true';
}

/** master.generatedAt(ISO) 의 KST tradeDate(yyyy-mm-dd). 파싱 실패 시 빈 문자열. */
function masterTradeDate(master: SectorEnergyMasterSupplyLineReportAdr0488): string {
  const iso = master.generatedAt;
  if (typeof iso !== 'string' || iso.length < 10) return '';
  const ms = Date.parse(iso);
  if (!Number.isFinite(ms)) return iso.slice(0, 10);
  return new Date(ms + 9 * 3_600_000).toISOString().slice(0, 10);
}

/** snapshot tradeDate 와 현재 tradeDate 사이의 거래일 격차(>=0). 8일 내 미산정 시 calendar 근사. */
function tradingDaysBetween(fromTradeDate: string, toTradeDate: string): number {
  if (!fromTradeDate || !toTradeDate || fromTradeDate >= toTradeDate) return 0;
  let count = 0;
  let cursor = toTradeDate;
  // toTradeDate 부터 역방향으로 영업일을 세며 fromTradeDate 에 도달할 때까지 카운트.
  for (let i = 0; i < 30 && cursor > fromTradeDate; i++) {
    const prev = prevTradingDay(shiftDay(cursor, -1));
    if (!prev || prev <= fromTradeDate) break;
    count += 1;
    cursor = prev;
  }
  return count;
}

function shiftDay(ymd: string, delta: number): string {
  const ms = Date.parse(`${ymd}T00:00:00Z`);
  if (!Number.isFinite(ms)) return ymd;
  return new Date(ms + delta * 86_400_000).toISOString().slice(0, 10);
}

/**
 * ADR-0545 write: 장중 official sector verify 성공(verified>0) 시에만 snapshot 영속.
 * 휴일/세션닫힘(sessionVerifiability 존재) 또는 verified=0 이면 write 하지 않는다.
 */
function persistVerifiedSnapshotIfEligible(
  master: SectorEnergyMasterSupplyLineReportAdr0488,
  canonical: SectorEnergyCanonicalState,
  sessionVerifiability: { sessionClosed: boolean; verifySkipped: boolean } | undefined,
): void {
  if (!lastKnownSnapshotEnabled()) return;
  // 세션닫힘/휴일엔 verify 가 스킵되므로 write 금지 (실패·휴일 미저장 보장).
  if (sessionVerifiability) return;
  if (canonical.verifiedOfficialSectorCount <= 0) return;
  const tradeDate = masterTradeDate(master);
  if (!tradeDate || !isTradingDay(tradeDate)) return;
  const asOf = master.generatedAt ?? new Date().toISOString();
  const record: SectorEnergyVerifiedSnapshotRecord = {
    snapshotId: `sector-verified:${tradeDate}:${asOf}`,
    asOf,
    tradeDate,
    verifiedOfficialSectorCount: canonical.verifiedOfficialSectorCount,
    promotionCoverage: canonical.promotionCoverage,
    selectedSourceTier: canonical.selectedSourceTier,
  };
  writeSectorEnergyVerifiedSnapshot(record);
}

/**
 * ADR-0545 read: 세션닫힘 시 직전 verified snapshot 을 읽어 표시 입력으로 변환.
 * ★ lastKnownUsableForLivePromotion 은 무조건 false (세션닫힘 live promotion 금지 SSOT).
 * 부재 시 undefined → resolver 가 reason=SESSION_CLOSED_NO_LAST_KNOWN_SECTOR_SNAPSHOT.
 */
function buildLastKnownSnapshotDisplay(
  master: SectorEnergyMasterSupplyLineReportAdr0488,
): SectorEnergyLastKnownSnapshotDisplay | undefined {
  if (!lastKnownSnapshotEnabled()) return undefined;
  const tradeDate = masterTradeDate(master) || new Date(Date.now() + 9 * 3_600_000).toISOString().slice(0, 10);
  const prev = prevTradingDay(shiftDay(tradeDate, -1)) || tradeDate;
  const snapshot = readLastKnownSectorEnergyVerifiedSnapshot({ tradeDate, prevTradingDay: prev });
  if (!snapshot) return undefined;
  return {
    lastKnownSectorSnapshotId: snapshot.snapshotId,
    lastKnownSectorSnapshotAsOf: snapshot.asOf,
    lastKnownVerifiedOfficialSectorCount: snapshot.verifiedOfficialSectorCount,
    lastKnownPromotionCoverage: snapshot.promotionCoverage,
    lastKnownSourceTier: snapshot.selectedSourceTier,
    lastKnownAgeTradingDays: tradingDaysBetween(snapshot.tradeDate, tradeDate),
    lastKnownUsableForLivePromotion: false,
    lastKnownUsableForShadowEvidence: true,
  };
}

export function deriveSectorEnergyCanonicalState(
  master: SectorEnergyMasterSupplyLineReportAdr0488,
): SectorEnergyCanonicalState {
  const tier = master.selectedSectorEnergySourceTier;

  const sessionVerifiability = deriveSessionVerifiability(master);
  const input: ResolveSectorEnergyCanonicalInput = {
    oldOfficialTargetCoverage: clamp01Pct(master.officialTargetVerifiedCoverageDiagnostic) / 100,
    kisBasketDerived: { status: 'DIAGNOSTIC_ONLY' },
    internalGroupedSnapshot: { coverage: clamp01Pct(master.internalGroupedSnapshotCoverage) / 100 },
    ...(sessionVerifiability ? { sessionVerifiability } : {}),
  };

  // ADR-0545: last-known 정책 활성(ENV ON) + 세션닫힘이면 직전 verified snapshot 을 표시 입력으로
  // 주입 (표시·shadow 전용). ENV OFF 면 lastKnownLookupEnabled 미설정 → ADR-0544 byte-equivalent.
  // sessionVerifiability 가 있을 때만 read 한다 (장중엔 read 불필요·promotion 무관).
  if (sessionVerifiability && lastKnownSnapshotEnabled()) {
    input.lastKnownLookupEnabled = true;
    const lastKnownSnapshot = buildLastKnownSnapshotDisplay(master);
    if (lastKnownSnapshot) input.lastKnownSnapshot = lastKnownSnapshot;
  }

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

  const canonical = resolveSectorEnergyCanonicalState(input);
  // ADR-0545 write: 장중 verify 성공(verified>0, 세션 open) 시에만 영속.
  persistVerifiedSnapshotIfEligible(master, canonical, sessionVerifiability);
  return canonical;
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
