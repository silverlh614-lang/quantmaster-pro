// @responsibility sectorEnergyProvider 외부 클라이언트 모듈
/**
 * sectorEnergyProvider.ts — KRX 실데이터를 sectorEnergyEngine 입력으로 가공.
 * ADR-0362: KRX index daily 가 empty 일 때 종목별 KRX 일별거래 + sector map 으로 합성.
 * ADR-0365: data-dbg index rows 는 IDX_IND_CD 없이 IDX_NM 만 올 수 있다.
 * ADR-0369: indexName fallback 은 기본 OFF. 서로 다른 KRX 지수를 이름/정규식으로 잘못
 * 매칭하면 -100%~-500% 수익률과 1000%+ 거래량 이상치가 발생한다. 기본 경로는
 * stock-daily synthetic sectorEnergy 이며, indexName fallback 은 ENV opt-in 전용이다.
 * ADR-0370 (Phase 1): RETURN_SANITY_BOUND_PCT default 90 → 30 강화 (한국 섹터 일일
 * 변화 ±15%·주간 ±30% 초과는 데이터 결함 의심). indexName fallback ENV 활성 시
 * 부팅 1회 console.warn. aggregateIndexDeltas 키 합성 시 indexCode 우선 + indexName
 * 단독 매칭은 fallback OFF 시 호출 0건 보장. 동일 key 중복 silent overwrite 금지
 */

import {
  fetchKospiIndexDaily,
  fetchKosdaqIndexDaily,
  recentBusinessDaysKst,
  fetchKospiDailyTrade,
  fetchKosdaqDailyTrade,
  type KrxIndexDailyRow,
  type KrxStockDailyRow,
} from './krxOpenApi.js';
import { fetchInvestorTrading, type KrxInvestorRow } from './krxClient.js';
import { safePctChange } from '../utils/safePctChange.js';
import { isKrxTradingDay } from '../calendar/krxTradingCalendar.js';
import { getSectorByCode } from '../screener/sectorMap.js';
// ADR-0423: SectorEnergy 데이터 진실성 진단 SSOT — 모든 build result 에 부착.
import {
  evaluateSectorEnergyQualityDiagnostic,
  isSectorEnergyQualityDiagnosticDisabled,
} from './sectorEnergyQualityDiagnostic.js';
// ADR-0424: indexName → indexCode SSOT 역변환 — KRX 가 IDX_IND_CD 누락 응답 시 backfill.
import {
  isSectorIndexCodeBackfillDisabled,
  resolveIndexCodeBySectorName,
} from './sectorEnergyMaster.js';
// ADR-0446 Phase 2: indexCode recovery 분해 + sanity violation 진단 SSOT 2종.
// ADR-0447: SECTOR_INDEX_MASTER alias expansion + NON_SECTOR_AGGREGATE_ROW 분리 격상.
import {
  evaluateIndexCodeRecovery,
  evaluateKrxSectorIndexRawDiagnostic,
  expandAliasCandidates,
  isSectorEnergyAliasRegistryExpansionDisabled,
  isSectorEnergyRecoveryPhase2Disabled,
  logKrxSectorIndexRawDiagnostic,
  normalizeIndexNameForLookup,
  type RecoveryRowInput,
} from './sectorEnergyIndexCodeRecoveryDiagnostic.js';
import {
  createSanityViolationState,
  finalizeSanityDiagnostic,
  isSectorEnergySanityDiagnosticDisabled,
  recordSanityViolation,
  type SectorEnergySanityViolation,
  type SectorEnergySanityViolationState,
} from './sectorEnergySanityViolationDiagnostic.js';
import { buildGroupedSectorEnergyFromSnapshotQuotes, type SymbolGroupedEnergyQuote } from './groupedSectorEnergyProvider.js';
import { getSectorCycleReturnsForBuild, sectorCycleInputFields, type SectorCycleReturn } from './sectorIndexCycleProvider.js'; // ADR-0570(ADR-0423 후속): sectorReturn20d 배선
// ADR-0579: type declarations extracted to submodule for ACMA 1500-line limit (type-only, byte-equivalent).
export * from './sectorEnergyProvider/types.js';
import type {
  StrategicSector,
  SectorEnergyInput,
  SectorEnergyDataQuality,
  SymmetryValidationResult,
  SectorEnergySourceTierForDiag,
  SectorEnergyDiagnosticsMeta,
  SectorEnergyBuildResult,
} from './sectorEnergyProvider/types.js';

const CANONICAL_SECTORS: StrategicSector[] = [
  '반도체', '이차전지', '바이오/헬스케어', '인터넷/플랫폼',
  '자동차', '조선', '방산', '금융',
  '유통/소비재', '건설/부동산', '에너지/화학', '통신/유틸리티',
];
const TOTAL_SECTOR_COUNT = CANONICAL_SECTORS.length;

const KRX_INDEX_TO_SECTOR: Array<[RegExp, StrategicSector]> = [
  [/반도체|전기전자|IT\s*하드|IT\s*H\/W/i, '반도체'],
  [/이차\s*전지|배터리|2차\s*전지|전지/, '이차전지'],
  [/바이오|헬스|의약|제약|의료/, '바이오/헬스케어'],
  [/플랫폼|인터넷|S\/W|소프트웨어|IT\s*S\/W|게임|미디어|서비스업/i, '인터넷/플랫폼'],
  [/자동차|운수장비/, '자동차'],
  [/조선|기계/, '조선'],
  [/방산|국방/, '방산'],
  [/은행|증권|보험|금융/, '금융'],
  [/유통|소비재|음식료|섬유/, '유통/소비재'],
  [/건설|부동산|리츠/, '건설/부동산'],
  [/에너지|화학|철강|비금속|종이|목재|석유/, '에너지/화학'],
  [/통신|전기가스|유틸리티/, '통신/유틸리티'],
];

// ADR-0370: default 90 → 30. 한국 섹터 일일 ±15% / 주간 ±30% 가 정상 상한.
// 30 초과는 데이터 결함 의심 (자릿수 격차, 액면병합/분할, 잘못된 indexName 매칭 등).
// 회귀 발견 시 SECTOR_ENERGY_RETURN_SANITY_BOUND_PCT=90 ENV 1줄로 즉시 롤백.
export const RETURN_SANITY_BOUND_PCT_DEFAULT = 30;
const RETURN_SANITY_BOUND_PCT = Number(
  process.env.SECTOR_ENERGY_RETURN_SANITY_BOUND_PCT ?? String(RETURN_SANITY_BOUND_PCT_DEFAULT),
);
const VOLUME_SANITY_BOUND_PCT = Number(process.env.SECTOR_ENERGY_VOLUME_SANITY_BOUND_PCT ?? '1000');
export const SECTOR_ENERGY_MIN_VALID_DEFAULT = 8;
export const SECTOR_ENERGY_INDEX_CODE_FILL_THRESHOLD = 0.9;

/**
 * ADR-0423: SectorEnergyBuildResult 에 quality diagnostic 부착 SSOT.
 *
 * 본 모듈의 모든 return site 끝에서 호출 — 단일 합성 진입점으로 drift 차단.
 * 외부 부작용 0 (순수 함수). 입력 result 의 다른 필드 무수정.
 *
 * fallbackUsed 분류:
 *   - sourceTier === 'STOCK_DAILY'     → 'STOCK_DAILY'
 *   - sourceTier === 'YAHOO_ETF'        → 'ETF'
 *   - sourceTier === 'CACHE'            → 'CACHE'
 *   - sourceTier === 'KRX_CODE' / 'FAILED' / undefined → 'NONE'
 *
 * ENV `SECTOR_ENERGY_QUALITY_DIAGNOSTIC_DISABLED=true` 시 result 그대로 반환 (회귀 1줄 롤백).
 */
function withQualityDiagnostic(result: SectorEnergyBuildResult): SectorEnergyBuildResult {
  if (isSectorEnergyQualityDiagnosticDisabled()) return result;

  const sym = result.symmetryValidation;
  const totalSectorRows = sym?.todayRowsTotal ?? result.totalSectorCount;
  // todayRowsWithIndexCode 부재 시 todayCodeFillRatio × totalSectorRows 추정 (SymmetryValidationResult
  // 옛 callers 호환). symmetry 자체 부재 시 1.0 가정 (정상 KRX_CODE 경로).
  const rowsWithIndexCode =
    result.sourceTier === 'KIS_STOCK_BASKET_DERIVED'
      ? (result.coverageBreakdown?.verifiedIndexCodeCount ?? 0)
      : sym?.todayRowsWithIndexCode ??
        (sym ? Math.round((sym.todayCodeFillRatio ?? 1) * totalSectorRows) : totalSectorRows);
  const fallbackUsed: 'NONE' | 'STOCK_DAILY' | 'ETF' | 'CACHE' =
    result.sourceTier === 'STOCK_DAILY' ? 'STOCK_DAILY'
    : result.sourceTier === 'YAHOO_ETF' ? 'ETF'
    : result.sourceTier === 'CACHE' ? 'CACHE'
    : 'NONE';
  // ADR-0424: backfilled rows 수 — symmetryValidation 결과에 첨부됨.
  const indexCodeBackfilledCount = sym?.backfilledCount ?? 0;

  // ADR-0446: per-build sanity state → Sanity violation diagnostic finalize.
  let sanityViolation: ReturnType<typeof finalizeSanityDiagnostic> | undefined;
  if (!isSectorEnergySanityDiagnosticDisabled() && _currentBuildSanityState) {
    try {
      sanityViolation = finalizeSanityDiagnostic(_currentBuildSanityState);
    } catch (err) {
      console.warn(`[SectorEnergy] ADR-0446 sanity diag finalize 실패: ${(err as Error)?.message ?? err}`);
    }
  }


  // SECTOR-CLASSIFICATION-SNAPSHOT — derive internal grouped energy from already-built
  // sector input cache/baskets only. No KIS/KRX/Yahoo/Naver calls; diagnostic shadow/advisory only.
  let groupedSectorEnergy: ReturnType<typeof buildGroupedSectorEnergyFromSnapshotQuotes> | undefined;
  try {
    const groupedQuotes: SymbolGroupedEnergyQuote[] = [];
    for (const input of result.inputs ?? []) {
      const basketCodes = Array.isArray(input.basketCodes) ? input.basketCodes : [];
      for (const code of basketCodes) {
        const close = 100;
        const r1 = typeof input.return4w === 'number' && Number.isFinite(input.return4w) ? input.return4w / 20 : 0;
        const r5 = typeof input.sectorReturn5d === 'number' && Number.isFinite(input.sectorReturn5d) ? input.sectorReturn5d : r1 * 5;
        const r20 = typeof input.sectorReturn20d === 'number' && Number.isFinite(input.sectorReturn20d) ? input.sectorReturn20d : input.return4w;
        const tradingValueChangePct = typeof input.turnoverAcceleration === 'number' && Number.isFinite(input.turnoverAcceleration)
          ? input.turnoverAcceleration
          : input.volumeChangePct;
        groupedQuotes.push({
          symbol: code,
          close,
          previousClose: close / (1 + r1 / 100),
          close5dAgo: close / (1 + r5 / 100),
          close20dAgo: close / (1 + r20 / 100),
          tradingValue: 100 * (1 + (Number.isFinite(tradingValueChangePct) ? tradingValueChangePct : 0) / 100),
          tradingValue20dAvg: 100,
          volume: input.sectorVolumeSurge ? 160 : 100,
          volume20dAvg: 100,
          ma20: (input.breadthAbove20ma ?? 0) >= 50 ? 95 : 105,
          high20d: close / 0.98,
        });
      }
    }
    if (groupedQuotes.length > 0) {
      groupedSectorEnergy = buildGroupedSectorEnergyFromSnapshotQuotes(groupedQuotes);
      console.log(
        `[SECTOR_CLASSIFICATION_SNAPSHOT] coverage=${groupedSectorEnergy.classification.snapshotCoverage} ` +
        `missing=${groupedSectorEnergy.classification.missingClassification} source=${groupedSectorEnergy.classification.source} ` +
        `executionImpact=${groupedSectorEnergy.executionImpact}`,
      );
      console.log(
        `[GROUPED_SECTOR_ENERGY] sourceTier=${groupedSectorEnergy.sourceTier} ` +
        `validSectorCount=${groupedSectorEnergy.groupedValidSectorCount}/${groupedSectorEnergy.expectedSectorCount} ` +
        `benchmarkStatus=${groupedSectorEnergy.benchmarkStatus} ` +
        `topSectors=${groupedSectorEnergy.topGroupedSectors.join(',') || 'none'} ` +
        `leadershipConfidence=${groupedSectorEnergy.leadershipConfidence} ` +
        `sectorBoostAllowed=${groupedSectorEnergy.sectorBoostAllowed} ` +
        `strongBuyAllowed=${groupedSectorEnergy.strongBuyAllowed} ` +
        `executionImpact=${groupedSectorEnergy.executionImpact}`,
      );
    }
  } catch (err) {
    console.warn(`[SectorEnergy] grouped snapshot energy synth 실패: ${(err as Error)?.message ?? err}`);
  }

  // ADR-0446 Phase 2: per-build state → Phase 2 recovery diagnostic 합성.
  let sectorIndexRecovery: ReturnType<typeof evaluateIndexCodeRecovery> | undefined;
  if (!isSectorEnergyRecoveryPhase2Disabled() && _currentBuildRecoveryAfter.length > 0) {
    try {
      sectorIndexRecovery = evaluateIndexCodeRecovery({
        rowsBeforeBackfill: _currentBuildRecoveryBefore,
        rowsAfterBackfill: _currentBuildRecoveryAfter,
        fallbackUsed,
        symmetryValidationPassed: sym?.valid ?? true,
        sanityViolationCount: sanityViolation?.totalViolations ?? 0,
      });
    } catch (err) {
      // Phase 2 진단 실패가 build 흐름 차단 안 함 (try/catch 격리).
      console.warn(`[SectorEnergy] ADR-0446 Phase 2 recovery diag synth 실패: ${(err as Error)?.message ?? err}`);
    }
  }

  // KRX-SECTOR-INDEXCODE-RAW-DIAGNOSTIC-001: per-build KRX raw 스냅샷 → raw 입력 부검 합성.
  // KIS provider 가 먼저 채택되면 _currentBuildKrxRawSnapshot 이 null → raw path 미진입을
  // rawTodayRows=[] + backfillInvoked=false 로 표현 → finalSourceTier 로 FALLBACK_TO_* 분류.
  let krxSectorIndexRaw: ReturnType<typeof evaluateKrxSectorIndexRawDiagnostic> | undefined;
  try {
    krxSectorIndexRaw = evaluateKrxSectorIndexRawDiagnostic({
      rawTodayRows: _currentBuildKrxRawSnapshot?.rawTodayRows ?? [],
      backfillInvoked: _currentBuildKrxRawSnapshot?.backfillInvoked ?? false,
      backfilledCount: _currentBuildKrxRawSnapshot?.backfilledCount ?? 0,
      finalSourceTier: result.sourceTier ?? 'UNKNOWN',
    });
    // 1스캔 1회 + 같은 breakPoint 60초 throttle (모듈 로컬 throttle).
    logKrxSectorIndexRawDiagnostic(krxSectorIndexRaw);
  } catch (err) {
    // raw 부검 실패가 build 흐름 차단 안 함 (try/catch 격리).
    console.warn(`[SectorEnergy] KRX raw 부검 진단 합성 실패: ${(err as Error)?.message ?? err}`);
  }

  if (groupedSectorEnergy) {
    const verifiedCoverage = result.coverageBreakdown?.verifiedIndexCodeCoverage ?? (rowsWithIndexCode / Math.max(1, totalSectorRows));
    console.log(
      `[SECTOR_BENCHMARK_STATUS] krxVerifiedIndexCodeCoverage=${(verifiedCoverage * 100).toFixed(1)} ` +
      `benchmarkStatus=${groupedSectorEnergy.benchmarkStatus} groupedEnergyAvailable=${groupedSectorEnergy.groupedValidSectorCount > 0} ` +
      `executionImpact=${groupedSectorEnergy.executionImpact}`,
    );
  }

  const qualityDiagnostic = evaluateSectorEnergyQualityDiagnostic({
    validSectorCount: result.validSectorCount,
    expectedSectorCount: result.totalSectorCount,
    totalSectorRows,
    rowsWithIndexCode,
    symmetryValidationPassed: sym?.valid ?? true,
    fallbackUsed,
    ...(result.sourceTier ? { sourceTier: result.sourceTier } : {}),
    ...(indexCodeBackfilledCount > 0 ? { indexCodeBackfilledCount } : {}),
    ...(sectorIndexRecovery ? { sectorIndexRecovery } : {}),
    ...(krxSectorIndexRaw ? { krxSectorIndexRaw } : {}),
    ...(sanityViolation ? { sanityViolation } : {}),
    ...(result.sectorCoverageBreakdown ? { coverageBreakdown: result.sectorCoverageBreakdown } : {}),
    ...(result.recoveryAudit ? { representativeBasketAudit: result.recoveryAudit } : {}),
    ...(groupedSectorEnergy ? { groupedSectorEnergy } : {}),
  });
  return { ...result, qualityDiagnostic };
}

function classifySector(label: string): StrategicSector | null {
  if (!label) return null;
  for (const [pattern, canonical] of KRX_INDEX_TO_SECTOR) {
    if (pattern.test(label)) return canonical;
  }
  return null;
}

function classifyIndex(indexName: string): StrategicSector | null {
  return classifySector(indexName);
}

function resolveStockSector(row: KrxStockDailyRow): StrategicSector | null {
  return classifySector(row.sector) ?? classifySector(getSectorByCode(row.code));
}

function shiftedKstDateKey(kst: Date): string {
  const y = kst.getUTCFullYear();
  const m = String(kst.getUTCMonth() + 1).padStart(2, '0');
  const d = String(kst.getUTCDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

function toYyyymmdd(dateKey: string): string {
  return dateKey.replace(/-/g, '');
}

function businessDaysAgo(n: number): string {
  const now = new Date();
  const utcMs = now.getTime() + now.getTimezoneOffset() * 60_000;
  const kst = new Date(utcMs + 9 * 60 * 60_000);
  kst.setUTCDate(kst.getUTCDate() - 1);
  let remaining = n;
  let guard = 0;
  while (remaining > 0 && guard < 80) {
    kst.setUTCDate(kst.getUTCDate() - 1);
    if (isKrxTradingDay(shiftedKstDateKey(kst))) remaining -= 1;
    guard += 1;
  }
  return toYyyymmdd(shiftedKstDateKey(kst));
}

export function isSectorEnergySymmetryDisabled(): boolean {
  return process.env.SECTOR_ENERGY_SYMMETRY_DISABLED === 'true';
}

export function isSectorEnergyIndexNameFallbackEnabled(): boolean {
  // ADR-0369: unsafe fallback is opt-in only.
  // ADR-0370: 정확 비교 (=== 'true') 의무 (ADR-0157 정합).
  return process.env.SECTOR_ENERGY_INDEX_NAME_FALLBACK === 'true';
}

// ADR-0370: 부팅 시점 1회 unsafe fallback 활성 경고. 모듈 로드 시 1회만 실행.
// ENV 정확 비교 (=== 'true') — 'TRUE'/'1'/'yes' 거부 (ADR-0157 정합).
let _indexNameFallbackWarningEmitted = false;
export function emitIndexNameFallbackWarningIfEnabled(): boolean {
  if (_indexNameFallbackWarningEmitted) return false;
  if (process.env.SECTOR_ENERGY_INDEX_NAME_FALLBACK !== 'true') return false;
  console.warn(
    '[SECTOR_ENERGY] unsafe indexName fallback is enabled. ' +
      'This may produce unreliable sector deltas (ADR-0369/0370).',
  );
  _indexNameFallbackWarningEmitted = true;
  return true;
}
export function __resetIndexNameFallbackWarningForTests(): void {
  _indexNameFallbackWarningEmitted = false;
}
// 모듈 로드 시 1회 실행 (부팅 시점 진단).
emitIndexNameFallbackWarningIfEnabled();

export function getSectorEnergyMinValid(): number {
  const env = Number(process.env.SECTOR_ENERGY_MIN_VALID);
  if (Number.isFinite(env) && env > 0 && env <= TOTAL_SECTOR_COUNT) return env;
  return SECTOR_ENERGY_MIN_VALID_DEFAULT;
}

/**
 * ADR-0424: KRX 응답 row 의 비어있는 `indexCode` 를 SECTOR_INDEX_MASTER 역변환으로 backfill.
 *
 * 운영 시나리오: KRX OpenAPI 가 *data-dbg fallback base* 사용 시 IDX_NM (indexName) 만 채우고
 * IDX_IND_CD (indexCode) 가 비어있는 row 를 반환하는 사례 (ADR-0365). Symmetry validation 이
 * 0% coverage 로 fail → STOCK_DAILY fallback → indexCodeCoverage=0% 악순환.
 *
 * 본 helper 는 *KRX 공식 표준 이름 → indexCode* 변환만 수행 — fabrication 아님:
 *   - row.indexCode 이미 채워져 있으면 그대로 (RAW source).
 *   - 비어있고 row.indexName 매칭되면 backfill (NAME_LOOKUP source, HIGH confidence).
 *   - 매칭 안 되면 그대로 (caller 측 symmetry 가 자연 fail).
 *
 * ENV `SECTOR_INDEX_CODE_BACKFILL_DISABLED=true` 시 입력 그대로 반환 (회귀 1줄 즉시 롤백).
 *
 * 외부 부작용 0. 입력 row 의 indexCode 가 변경되지만 새 객체 생성 패턴 (immutable-friendly).
 *
 * 반환: { rows, backfilledCount } — backfilled row 수를 운영자 진단 + 회귀 가드용.
 *
 * 사용자 §C 정합 (절대 변경 금지):
 *   - sourceTier 변경 0 (sourceTier 는 fallback 채택 여부로 결정).
 *   - dataQuality 강제 변경 0 (ADR-0423 결정 트리가 input 기반 자동 분류).
 *   - 매매 정책 변경 0 (진단 input 정확화만).
 */
export function backfillIndexCodes(
  rows: KrxIndexDailyRow[],
): { rows: KrxIndexDailyRow[]; backfilledCount: number } {
  if (!rows || rows.length === 0) return { rows: rows ?? [], backfilledCount: 0 };
  if (isSectorIndexCodeBackfillDisabled()) return { rows, backfilledCount: 0 };

  let backfilledCount = 0;
  const beforeRows: RecoveryRowInput[] = [];
  const afterRows: RecoveryRowInput[] = [];
  const out: KrxIndexDailyRow[] = rows.map((r) => {
    // ADR-0446: backfill 이전 row 진단 입력 (Phase 2 beforeIndexCodeCoverage 산출).
    beforeRows.push({
      indexCode: r.indexCode || null,
      indexName: r.indexName ?? null,
      indexCodeSource: r.indexCodeSource ?? null,
    });
    if (r.indexCode && r.indexCode.trim().length > 0) {
      // raw KRX 가 indexCode 제공 — RAW source 명시 (옵셔널, 후방호환).
      const tagged: KrxIndexDailyRow = r.indexCodeSource ? r : { ...r, indexCodeSource: 'RAW' as const };
      afterRows.push({
        indexCode: tagged.indexCode,
        indexName: tagged.indexName ?? null,
        indexCodeSource: tagged.indexCodeSource ?? 'RAW',
      });
      return tagged;
    }
    // raw KRX 가 indexCode 비어있음 — 직접 alias 매칭 (NAME_LOOKUP) 시도.
    const recoveredCode = resolveIndexCodeBySectorName(r.indexName);
    if (recoveredCode) {
      backfilledCount += 1;
      afterRows.push({
        indexCode: recoveredCode,
        indexName: r.indexName ?? null,
        indexCodeSource: 'NAME_LOOKUP',
      });
      return { ...r, indexCode: recoveredCode, indexCodeSource: 'NAME_LOOKUP' as const };
    }

    // ★ ADR-0447 — normalize 후 alias 확장 매칭 시도 (ALIAS_EXPANSION).
    // 직접 매칭 실패 + ENV 우회 비활성 시에만 활성. expandAliasCandidates 결과:
    //   - length === 1 → ALIAS_EXPANSION marker 부착 + backfill (HIGH confidence — 정확 1:1)
    //   - length >= 2 → ambiguous 자동 차단 (사용자 §"절대 불변식" #1 정합) — backfill 안 함
    //   - length === 0 → 매칭 실패 — caller 측 symmetry 자연 fail
    if (!isSectorEnergyAliasRegistryExpansionDisabled() && r.indexName) {
      const { normalized } = normalizeIndexNameForLookup(r.indexName);
      if (normalized) {
        const candidates = expandAliasCandidates(normalized);
        if (candidates.length === 1) {
          const expansionCode = candidates[0]!.krxIndexCode;
          backfilledCount += 1;
          afterRows.push({
            indexCode: expansionCode,
            indexName: r.indexName ?? null,
            indexCodeSource: 'ALIAS_EXPANSION',
          });
          return { ...r, indexCode: expansionCode, indexCodeSource: 'ALIAS_EXPANSION' as const };
        }
        // ambiguous (length >= 2) 또는 미매칭 (length === 0) — backfill 차단, 자연 흐름 진행.
      }
    }

    // 매칭 실패 — caller 측 symmetry 가 자연 fail (운영자 후속 PR 분리).
    afterRows.push({
      indexCode: null,
      indexName: r.indexName ?? null,
      indexCodeSource: null,
    });
    return r;
  });
  // ADR-0446: per-build recovery 진단 inputs 누적 (today + past 양쪽).
  if (!isSectorEnergyRecoveryPhase2Disabled()) {
    _currentBuildRecoveryBefore.push(...beforeRows);
    _currentBuildRecoveryAfter.push(...afterRows);
  }

  if (backfilledCount > 0) {
    console.warn(
      `[SectorEnergy] ADR-0424 indexCode backfill (${backfilledCount}/${rows.length} rows recovered ` +
      `via SECTOR_INDEX_MASTER NAME_LOOKUP — KRX IDX_IND_CD 응답 결손 의심, data-dbg fallback 가능성)`,
    );
  }
  return { rows: out, backfilledCount };
}

export function validateIndexResponseSymmetry(
  todayRows: KrxIndexDailyRow[],
  pastRows: KrxIndexDailyRow[],
): SymmetryValidationResult {
  const reasons: string[] = [];
  // ADR-0423: today rows 절대 카운트 — quality diagnostic 합성 입력.
  const todayRowsTotal = todayRows.length;
  const todayRowsWithIndexCode = todayRows.filter((r) => Boolean(r.indexCode)).length;
  if (todayRows.length === 0 || pastRows.length === 0) {
    reasons.push(`empty rows: today=${todayRows.length}, past=${pastRows.length}`);
    return {
      valid: false,
      todayCodeFillRatio: 0,
      pastCodeFillRatio: 0,
      reasons,
      todayRowsTotal,
      todayRowsWithIndexCode,
    };
  }
  const todayCodeFillRatio = todayRowsWithIndexCode / todayRows.length;
  const pastCodeFillRatio = pastRows.filter((r) => Boolean(r.indexCode)).length / pastRows.length;
  if (todayCodeFillRatio < SECTOR_ENERGY_INDEX_CODE_FILL_THRESHOLD) {
    reasons.push(`today indexCode 충실도 ${(todayCodeFillRatio * 100).toFixed(1)}% < ${(SECTOR_ENERGY_INDEX_CODE_FILL_THRESHOLD * 100).toFixed(0)}%`);
  }
  if (pastCodeFillRatio < SECTOR_ENERGY_INDEX_CODE_FILL_THRESHOLD) {
    reasons.push(`past indexCode 충실도 ${(pastCodeFillRatio * 100).toFixed(1)}% < ${(SECTOR_ENERGY_INDEX_CODE_FILL_THRESHOLD * 100).toFixed(0)}%`);
  }
  return {
    valid: reasons.length === 0,
    todayCodeFillRatio,
    pastCodeFillRatio,
    reasons,
    todayRowsTotal,
    todayRowsWithIndexCode,
  };
}

/**
 * ADR-0446: pushDelta 가 sanity violation 발생 시 진단 state 에 기록.
 *
 * `sanityState` 옵셔널 — undefined 시 ADR-0370 기존 console.warn skip 동작 100% 보존.
 * `scope` 인자 (SECTOR/STOCK_VOLUME/STOCK_RETURN) 로 sector vs stock 분리 (사용자 §6).
 * `code` 옵셔널 — stock-level violation 시 6자리 stock code (사용자 §"테스트 요구사항").
 */
function pushDelta(
  bySector: Map<StrategicSector, { returns: number[]; volumes: number[] }>,
  sector: StrategicSector,
  returnPct: number,
  volumePct: number,
  sanityState?: SectorEnergySanityViolationState,
  options?: {
    /** stock-level violation 인 경우 stock code (옵셔널). */
    code?: string;
    /** today close (참고용). */
    currentClose?: number;
    /** past close (참고용). */
    pastClose?: number;
  },
): void {
  // ADR-0370: sanity bound default 90 → 30. 초과 시 진단 로그 + skip.
  if (!Number.isFinite(returnPct)) {
    if (sanityState) {
      recordSanityViolation(sanityState, {
        kind: 'CURRENT_OUTLIER',
        scope: options?.code ? 'STOCK_RETURN' : 'SECTOR',
        pct: Number.isFinite(returnPct) ? returnPct : 0,
        bound: RETURN_SANITY_BOUND_PCT,
        sector,
        ...(options?.code ? { code: options.code } : {}),
        ...(options?.currentClose !== undefined ? { current: options.currentClose } : {}),
        ...(options?.pastClose !== undefined ? { base: options.pastClose } : {}),
      });
    }
    return;
  }
  if (Math.abs(returnPct) > RETURN_SANITY_BOUND_PCT) {
    console.warn(
      `[SectorEnergy] sanity-violation pct=${returnPct.toFixed(2)}% sector=${sector} ` +
        `bound=${RETURN_SANITY_BOUND_PCT}% (ADR-0370)`,
    );
    if (sanityState) {
      const violation: SectorEnergySanityViolation = options?.code
        ? {
            kind: 'STOCK_RETURN_PCT_CHANGE_EXCEEDED',
            scope: 'STOCK_RETURN',
            pct: returnPct,
            bound: RETURN_SANITY_BOUND_PCT,
            sector,
            code: options.code,
            ...(options.currentClose !== undefined ? { current: options.currentClose } : {}),
            ...(options.pastClose !== undefined ? { base: options.pastClose } : {}),
          }
        : {
            kind: 'SECTOR_PCT_BOUND_EXCEEDED',
            scope: 'SECTOR',
            pct: returnPct,
            bound: RETURN_SANITY_BOUND_PCT,
            sector,
            ...(options?.currentClose !== undefined ? { current: options.currentClose } : {}),
            ...(options?.pastClose !== undefined ? { base: options.pastClose } : {}),
          };
      recordSanityViolation(sanityState, violation);
    }
    return;
  }
  if (!Number.isFinite(volumePct) || Math.abs(volumePct) > VOLUME_SANITY_BOUND_PCT) {
    if (sanityState && Number.isFinite(volumePct)) {
      recordSanityViolation(sanityState, {
        kind: options?.code ? 'STOCK_VOLUME_PCT_CHANGE_EXCEEDED' : 'SECTOR_PCT_BOUND_EXCEEDED',
        scope: options?.code ? 'STOCK_VOLUME' : 'SECTOR',
        pct: volumePct,
        bound: VOLUME_SANITY_BOUND_PCT,
        sector,
        ...(options?.code ? { code: options.code } : {}),
      });
    }
    return;
  }
  const acc = bySector.get(sector) ?? { returns: [], volumes: [] };
  acc.returns.push(returnPct);
  acc.volumes.push(volumePct);
  bySector.set(sector, acc);
}

/**
 * ADR-0370: composite key (`${market}:${indexCode|indexName}`) 우선순위.
 * 1) indexCode 있으면 → `${market}:${indexCode}` (정확 매칭, 동일 indexName 다른 시장 분리)
 * 2) 그 외 → `${market}:${indexName}` (indexName fallback, ENV 활성 시에만 사용)
 *
 * KOSPI:반도체 와 KOSDAQ:반도체 같은 동일 이름 다른 시장 sub-index 의 silent overwrite
 * 영구 차단. KrxIndexDailyRow.market 필드 부재 시 빈 문자열 — 단일 시장 호환.
 */
function indexRowMarket(row: KrxIndexDailyRow): string {
  // KrxIndexDailyRow 의 market 필드는 옵셔널 — 부재 시 빈 문자열 (호환).
  // ts-ignore: 외부 타입 변경 없이 옵셔널 access.
  const m = (row as unknown as { market?: string }).market;
  return typeof m === 'string' ? m : '';
}

// ADR-0370: indexRowKey 헬퍼 — composite key 합성 SSOT (외부 reference 가능).
// `${market}:code:${indexCode}` 우선 / useNameFallback=true 시 `${market}:name:${indexName}` fallback.
export function indexRowKey(row: KrxIndexDailyRow, useNameFallback: boolean): string | null {
  const market = indexRowMarket(row);
  if (row.indexCode) return `${market}:code:${row.indexCode}`;
  if (useNameFallback && row.indexName) return `${market}:name:${row.indexName}`;
  return null;
}
function warnIndexDateCollision(today: KrxIndexDailyRow, past: KrxIndexDailyRow, labelKey: string): void {
  console.warn(
    `[SectorEnergy] baseDate 동일 index=${labelKey} name=${today.indexName} ` +
      `baseDate=${today.baseDate} closeToday=${today.close} closePast=${past.close}. ` +
      'fetch boundary 또는 과거 기준일 매칭 오류 의심.',
  );
}

function warnIndexDigitMismatch(today: KrxIndexDailyRow, past: KrxIndexDailyRow, labelKey: string, ratio: number): void {
  console.warn(
    `[SectorEnergy] 자릿수 격차 index=${labelKey} name=${today.indexName} ` +
      `ratio=${ratio.toFixed(3)} today.close=${today.close} past.close=${past.close} ` +
      `today.baseDate=${today.baseDate} past.baseDate=${past.baseDate}. ` +
      'sector index 매칭 오류 의심으로 skip.',
  );
}

export function aggregateIndexDeltas(
  todayRows: KrxIndexDailyRow[],
  pastRows: KrxIndexDailyRow[],
  sanityState?: SectorEnergySanityViolationState,
): Map<StrategicSector, { returns: number[]; volumes: number[] }> {
  const useNameFallback = isSectorEnergyIndexNameFallbackEnabled();

  // ADR-0370: composite key 합성. 동일 key 중복 시 silent overwrite 금지 → console.warn skip.
  // 두 layer 분리:
  //  (1) pastByCode = `${market}:code:${indexCode}` — 정확 매칭 (KOSPI vs KOSDAQ 분리)
  //  (2) pastByName = `${market}:name:${indexName}` — useNameFallback=true 시에만 활성
  const pastByCode = new Map<string, KrxIndexDailyRow>();
  const pastByName = new Map<string, KrxIndexDailyRow>();
  for (const r of pastRows) {
    const market = indexRowMarket(r);
    if (r.indexCode) {
      const codeKey = `${market}:code:${r.indexCode}`;
      if (pastByCode.has(codeKey)) {
        console.warn(
          `[SectorEnergy] duplicate past key=${codeKey} skipped (ADR-0370). ` +
            `existing.close=${pastByCode.get(codeKey)!.close} duplicate.close=${r.close}`,
        );
      } else {
        pastByCode.set(codeKey, r);
      }
    }
    if (useNameFallback && r.indexName) {
      const nameKey = `${market}:name:${r.indexName}`;
      if (!pastByName.has(nameKey)) pastByName.set(nameKey, r);
      // pastByName 중복은 silent (fallback 자체가 unsafe opt-in 이라 첫 번째만 사용)
    }
  }

  const bySector = new Map<StrategicSector, { returns: number[]; volumes: number[] }>();
  for (const t of todayRows) {
    const sector = classifyIndex(t.indexName);
    if (!sector) continue;

    // ADR-0370: 우선순위 SSOT
    //  1) today.indexCode 있으면 → pastByCode (KOSPI vs KOSDAQ 분리, default 경로)
    //  2) useNameFallback=true 이고 매칭 실패 시 → pastByName (회귀 분석 ENV opt-in)
    //  useNameFallback=false (default) 시 indexName fallback 경로 호출 0건 보장.
    const market = indexRowMarket(t);
    let past: KrxIndexDailyRow | undefined;
    if (t.indexCode) {
      past = pastByCode.get(`${market}:code:${t.indexCode}`);
    }
    if (!past && useNameFallback && t.indexName) {
      past = pastByName.get(`${market}:name:${t.indexName}`);
    }

    const labelKey = t.indexCode || t.indexName;
    if (!past || past.close <= 0) continue;
    if (t.baseDate && past.baseDate && t.baseDate === past.baseDate) {
      warnIndexDateCollision(t, past, labelKey);
      continue;
    }
    const closeRatio = t.close / past.close;
    if (t.close <= 0 || closeRatio > 10 || closeRatio < 0.1) {
      warnIndexDigitMismatch(t, past, labelKey, closeRatio);
      continue;
    }

    const returnPct = safePctChange(t.close, past.close, { label: `sectorEnergy.return:${labelKey}` });
    if (returnPct === null) continue;
    const volumePct = past.volume > 0
      ? (safePctChange(t.volume, past.volume, { label: `sectorEnergy.volume:${labelKey}`, sanityBoundPct: VOLUME_SANITY_BOUND_PCT }) ?? 0)
      : 0;
    pushDelta(bySector, sector, returnPct, volumePct, sanityState, {
      currentClose: t.close,
      pastClose: past.close,
    });
  }
  return bySector;
}

function aggregateStockDeltas(
  todayStocks: KrxStockDailyRow[],
  pastStocks: KrxStockDailyRow[],
  sanityState?: SectorEnergySanityViolationState,
): Map<StrategicSector, { returns: number[]; volumes: number[] }> {
  const pastByCode = new Map<string, KrxStockDailyRow>();
  for (const row of pastStocks) {
    if (row.code && row.close > 0) pastByCode.set(row.code, row);
  }

  const bySector = new Map<StrategicSector, { returns: number[]; volumes: number[] }>();
  for (const today of todayStocks) {
    if (!today.code || today.close <= 0) continue;
    const sector = resolveStockSector(today);
    if (!sector) continue;
    const past = pastByCode.get(today.code);
    if (!past || past.close <= 0) continue;

    const returnPct = safePctChange(today.close, past.close, { label: `sectorEnergy.stockReturn:${today.code}` });
    if (returnPct === null) continue;
    const volumePct = past.volume > 0
      ? (safePctChange(today.volume, past.volume, { label: `sectorEnergy.stockVolume:${today.code}`, sanityBoundPct: VOLUME_SANITY_BOUND_PCT }) ?? 0)
      : 0;
    pushDelta(bySector, sector, returnPct, volumePct, sanityState, {
      code: today.code,
      currentClose: today.close,
      pastClose: past.close,
    });
  }
  return bySector;
}

function aggregateForeignConcentration(
  investors: KrxInvestorRow[],
  stockSectorMap: Map<string, StrategicSector>,
): Map<StrategicSector, number> {
  const rawBySector = new Map<StrategicSector, number>();
  for (const row of investors) {
    const canonical = stockSectorMap.get(row.code);
    if (!canonical) continue;
    rawBySector.set(canonical, (rawBySector.get(canonical) ?? 0) + row.foreignNetBuy);
  }
  if (rawBySector.size === 0) return rawBySector;
  const values = Array.from(rawBySector.values());
  const min = Math.min(...values);
  const max = Math.max(...values);
  const normalized = new Map<StrategicSector, number>();
  if (max === min) {
    for (const [k] of rawBySector) normalized.set(k, 50);
    return normalized;
  }
  for (const [sector, v] of rawBySector) normalized.set(sector, ((v - min) / (max - min)) * 100);
  return normalized;
}

function buildStockSectorMap(stocks: KrxStockDailyRow[]): Map<string, StrategicSector> {
  const out = new Map<string, StrategicSector>();
  for (const s of stocks) {
    const canonical = resolveStockSector(s);
    if (canonical) out.set(s.code, canonical);
  }
  return out;
}

function buildInputsFromDeltas(
  deltas: Map<StrategicSector, { returns: number[]; volumes: number[] }>,
  foreignMap: Map<StrategicSector, number>,
): { inputs: SectorEnergyInput[]; validSectorCount: number } {
  const inputs: SectorEnergyInput[] = [];
  let validSectorCount = 0;
  const avg = (xs: number[]): number => xs.length === 0 ? 0 : xs.reduce((a, b) => a + b, 0) / xs.length;

  for (const sector of CANONICAL_SECTORS) {
    const d = deltas.get(sector);
    const returns = d?.returns ?? [];
    const volumes = d?.volumes ?? [];
    if (returns.length > 0) validSectorCount++;
    inputs.push({
      name: sector,
      return4w: Number(avg(returns).toFixed(2)),
      volumeChangePct: Number(avg(volumes).toFixed(2)),
      foreignConcentration: Number((foreignMap.get(sector) ?? 0).toFixed(1)),
      ...sectorCycleInputFields(_currentBuildSectorCycleReturns, sector), // ADR-0570 (flag OFF=빈,byte-equal)
    });
  }
  return { inputs, validSectorCount };
}

function buildStockDailyFallbackResult(
  todayStocks: KrxStockDailyRow[],
  pastStocks: KrxStockDailyRow[],
  foreignMap: Map<StrategicSector, number>,
  prefixReasons: string[],
  qualityIfComplete: SectorEnergyDataQuality = 'STALE',
): SectorEnergyBuildResult | null {
  // ADR-0446: STOCK_DAILY fallback 경로 sanity state 정합 — _currentBuildSanityState 사용.
  const deltas = aggregateStockDeltas(todayStocks, pastStocks, _currentBuildSanityState ?? undefined);
  const { inputs, validSectorCount } = buildInputsFromDeltas(deltas, foreignMap);
  const minValid = getSectorEnergyMinValid();
  if (validSectorCount < minValid) return null;
  return {
    inputs,
    dataQuality: validSectorCount === TOTAL_SECTOR_COUNT ? qualityIfComplete : 'STALE',
    validSectorCount,
    totalSectorCount: TOTAL_SECTOR_COUNT,
    reasons: [
      ...prefixReasons,
      `ADR-0369 stock-daily synthetic sector energy validSectorCount=${validSectorCount}/${TOTAL_SECTOR_COUNT}`,
    ],
  };
}

export async function buildSectorEnergyInputs(): Promise<SectorEnergyInput[]> {
  const result = await buildSectorEnergyInputsWithMeta();
  return result.inputs;
}

export async function buildSectorEnergyInputsWithMeta(): Promise<SectorEnergyBuildResult> {
  // ADR-0423: 진입점 wrapper — 최종 결과에 quality diagnostic 부착 SSOT.
  // 내부 `buildSectorEnergyInputsWithMetaWithFallback` 는 4-tier fallback 채택 후 sourceTier
  // 부착 + symmetryValidation 보존 → withQualityDiagnostic 가 모든 정보를 합성.
  return withQualityDiagnostic(await buildSectorEnergyInputsWithMetaWithFallback());
}

// ADR-0399: buildSectorEnergyInputsWithMetaRaw 의 attemptedTodayDates 를
// withFallback wrapper 가 진단 메타에 사용할 수 있도록 export.
let _lastAttemptedTodayDates: string[] = [];
export function __getLastAttemptedTodayDatesForTests(): string[] {
  return [..._lastAttemptedTodayDates];
}
export function __setLastAttemptedTodayDatesForTests(v: string[]): void {
  _lastAttemptedTodayDates = [...v];
}

// ADR-0446 Phase 2: per-build sanity state + recovery row inputs (module-local).
// withQualityDiagnostic 가 finalize 후 attach. buildSectorEnergyInputsWithMetaRaw 진입
// 시점마다 reset (이전 build 잔여 state 누수 차단).
let _currentBuildSanityState: SectorEnergySanityViolationState | null = null;
/** ADR-0446: backfill 이전 row 누적 (rowsBeforeBackfill). */
let _currentBuildRecoveryBefore: RecoveryRowInput[] = [];
/** ADR-0446: backfill 이후 row 누적 (rowsAfterBackfill, indexCodeSource 포함). ADR-0570: cycle return per-build. */
let _currentBuildRecoveryAfter: RecoveryRowInput[] = [], _currentBuildSectorCycleReturns: Map<string, SectorCycleReturn> = new Map();

/**
 * KRX-SECTOR-INDEXCODE-RAW-DIAGNOSTIC-001: per-build KRX raw 스냅샷 (module-local).
 *
 * `buildSectorEnergyInputsWithMetaRaw` 진입 시 raw todayIdx row 캡처 + backfill 호출 여부/카운트.
 * KIS provider 가 먼저 채택되면 raw path 미진입 → null 유지 → FALLBACK_TO_KIS_BASKET 분류.
 */
let _currentBuildKrxRawSnapshot: {
  rawTodayRows: Array<{ indexCode?: string | null; indexName?: string | null }>;
  backfillInvoked: boolean;
  backfilledCount: number;
} | null = null;

function resetCurrentBuildPhase2State(): void {
  _currentBuildSanityState = isSectorEnergySanityDiagnosticDisabled() ? null : createSanityViolationState();
  _currentBuildRecoveryBefore = [];
  _currentBuildRecoveryAfter = [];
  _currentBuildKrxRawSnapshot = null;
}

export function __getCurrentBuildKrxRawSnapshotForTests(): typeof _currentBuildKrxRawSnapshot {
  return _currentBuildKrxRawSnapshot;
}

export function __getCurrentBuildSanityStateForTests(): SectorEnergySanityViolationState | null {
  return _currentBuildSanityState;
}
export function __getCurrentBuildRecoveryInputsForTests(): {
  before: RecoveryRowInput[];
  after: RecoveryRowInput[];
} {
  return { before: [..._currentBuildRecoveryBefore], after: [..._currentBuildRecoveryAfter] };
}

async function buildSectorEnergyInputsWithMetaRaw(): Promise<SectorEnergyBuildResult> {
  // ADR-0446: per-build sanity state + recovery row inputs reset (이전 build 누수 차단).
  resetCurrentBuildPhase2State();
  _currentBuildSectorCycleReturns = await getSectorCycleReturnsForBuild('LOW'); // ADR-0570(flag OFF=빈Map,KIS콜0)
  const todayCandidates: Array<string | undefined> = [undefined, ...recentBusinessDaysKst(5)];
  const past = businessDaysAgo(20);
  let selectedToday: string | undefined;
  let todayKospiIdx: KrxIndexDailyRow[] = [];
  let todayKosdaqIdx: KrxIndexDailyRow[] = [];
  const attemptedTodayDates: string[] = [];

  for (const candidate of todayCandidates) {
    if (candidate) attemptedTodayDates.push(candidate);
    const [kospiIdx, kosdaqIdx] = await Promise.all([fetchKospiIndexDaily(candidate), fetchKosdaqIndexDaily(candidate)]);
    if (kospiIdx.length + kosdaqIdx.length > 0) {
      selectedToday = candidate;
      todayKospiIdx = kospiIdx;
      todayKosdaqIdx = kosdaqIdx;
      break;
    }
  }
  _lastAttemptedTodayDates = [...attemptedTodayDates];

  const [pastKospiIdx, pastKosdaqIdx, kospiStocks, kosdaqStocks, pastKospiStocks, pastKosdaqStocks, investors] = await Promise.all([
    fetchKospiIndexDaily(past),
    fetchKosdaqIndexDaily(past),
    fetchKospiDailyTrade(selectedToday),
    fetchKosdaqDailyTrade(selectedToday),
    fetchKospiDailyTrade(past),
    fetchKosdaqDailyTrade(past),
    fetchInvestorTrading(),
  ]);

  const todayIdx = [...todayKospiIdx, ...todayKosdaqIdx];
  const pastIdx = [...pastKospiIdx, ...pastKosdaqIdx];
  // KRX-SECTOR-INDEXCODE-RAW-DIAGNOSTIC-001: raw todayIdx 스냅샷 캡처 (backfill 이전).
  // backfill 후 invoked/count 갱신. duck-typed — 진단 필요 부분만 복사 (raw payload 누출 차단).
  _currentBuildKrxRawSnapshot = {
    rawTodayRows: todayIdx.map((r) => ({ indexCode: r.indexCode, indexName: r.indexName })),
    backfillInvoked: false,
    backfilledCount: 0,
  };
  const todayStocks = [...kospiStocks, ...kosdaqStocks];
  const pastStocks = [...pastKospiStocks, ...pastKosdaqStocks];
  const stockSectorMap = buildStockSectorMap(todayStocks);
  const foreignMap = aggregateForeignConcentration(investors, stockSectorMap);

  if (todayIdx.length === 0) {
    const fallback = buildStockDailyFallbackResult(
      todayStocks,
      pastStocks,
      foreignMap,
      ['todayIdx empty — KRX index OpenAPI 응답 부재', `attempted=${attemptedTodayDates.join(',') || 'default'}`],
      'PARTIAL',
    );
    // ADR-0399: STOCK_DAILY fallback 채택 시 sourceTier 부착.
    if (fallback) return { ...fallback, sourceTier: 'STOCK_DAILY' };
    return {
      inputs: [],
      dataQuality: 'FAILED',
      validSectorCount: 0,
      totalSectorCount: TOTAL_SECTOR_COUNT,
      reasons: ['todayIdx empty — KRX OpenAPI 응답 부재', `attempted=${attemptedTodayDates.join(',') || 'default'}`],
      sourceTier: 'FAILED',
    };
  }

  // ── ADR-0424: indexCode 백필 SSOT 진입 — KRX 응답에 IDX_IND_CD 누락 row 가 있으면 ─
  // SECTOR_INDEX_MASTER alias 매칭으로 회복 (HIGH confidence, data-dbg fallback 시나리오 차단).
  // backfilledCount 가 symmetry 결과에 첨부되어 운영자 진단 + 회귀 가드용. sourceTier 변경 0 —
  // 정상 KRX 경로에서 indexName 만 있던 row 가 backfill 로 회복되면 STOCK_DAILY fallback 미진입.
  const todayBackfill = backfillIndexCodes(todayIdx);
  const pastBackfill = backfillIndexCodes(pastIdx);
  const todayIdxBackfilled = todayBackfill.rows;
  const pastIdxBackfilled = pastBackfill.rows;
  const totalBackfilledCount = todayBackfill.backfilledCount + pastBackfill.backfilledCount;
  // KRX-SECTOR-INDEXCODE-RAW-DIAGNOSTIC-001: backfill 호출 여부/카운트 갱신.
  if (_currentBuildKrxRawSnapshot) {
    _currentBuildKrxRawSnapshot.backfillInvoked = true;
    _currentBuildKrxRawSnapshot.backfilledCount = todayBackfill.backfilledCount;
  }

  const symmetryRaw = validateIndexResponseSymmetry(todayIdxBackfilled, pastIdxBackfilled);
  // ADR-0424: backfill 통계 첨부 (옵셔널, 후방호환).
  const symmetry: SymmetryValidationResult =
    totalBackfilledCount > 0
      ? { ...symmetryRaw, backfilledCount: totalBackfilledCount }
      : symmetryRaw;
  if (!symmetry.valid && !isSectorEnergySymmetryDisabled()) {
    const stockFallback = buildStockDailyFallbackResult(
      todayStocks,
      pastStocks,
      foreignMap,
      ['symmetry validation failed — indexCode missing, stock-daily fallback preferred', ...symmetry.reasons],
      'STALE',
    );
    // ADR-0399: STOCK_DAILY fallback 채택 시 sourceTier 부착.
    if (stockFallback) return { ...stockFallback, symmetryValidation: symmetry, sourceTier: 'STOCK_DAILY' };

    if (isSectorEnergyIndexNameFallbackEnabled()) {
      // ADR-0399: indexName fallback 은 ENV opt-in 전용 — default 영구 차단.
      // 활성 시에도 sourceTier='KRX_CODE' 가 아닌 STOCK_DAILY 분류 (정확 매칭이 아니라 휴리스틱 매칭이라).
      const nameDeltas = aggregateIndexDeltas(
        todayIdxBackfilled,
        pastIdxBackfilled,
        _currentBuildSanityState ?? undefined,
      );
      const nameBuilt = buildInputsFromDeltas(nameDeltas, foreignMap);
      if (nameBuilt.validSectorCount >= getSectorEnergyMinValid()) {
        return {
          inputs: nameBuilt.inputs,
          dataQuality: nameBuilt.validSectorCount === TOTAL_SECTOR_COUNT ? 'PARTIAL' : 'STALE',
          validSectorCount: nameBuilt.validSectorCount,
          totalSectorCount: TOTAL_SECTOR_COUNT,
          symmetryValidation: symmetry,
          reasons: [
            'symmetry validation failed but explicit indexName fallback succeeded',
            ...symmetry.reasons,
            `ADR-0369 indexName fallback opt-in validSectorCount=${nameBuilt.validSectorCount}/${TOTAL_SECTOR_COUNT}`,
          ],
          // ADR-0399: indexName fallback 은 KRX_CODE 정확 매칭이 아니므로 STOCK_DAILY 분류.
          sourceTier: 'STOCK_DAILY',
        };
      }
    }

    return {
      inputs: [],
      dataQuality: 'FAILED',
      validSectorCount: 0,
      totalSectorCount: TOTAL_SECTOR_COUNT,
      symmetryValidation: symmetry,
      reasons: ['symmetry validation failed', ...symmetry.reasons, 'stock-daily fallback insufficient and indexName fallback disabled'],
      sourceTier: 'FAILED',
    };
  }

  const deltas = aggregateIndexDeltas(
    todayIdxBackfilled,
    pastIdxBackfilled,
    _currentBuildSanityState ?? undefined,
  );
  const { inputs, validSectorCount } = buildInputsFromDeltas(deltas, foreignMap);
  const minValid = getSectorEnergyMinValid();
  if (validSectorCount < minValid) {
    const fallback = buildStockDailyFallbackResult(
      todayStocks,
      pastStocks,
      foreignMap,
      [`index-code sector validSectorCount=${validSectorCount} < min=${minValid}`],
      'STALE',
    );
    // ADR-0399: STOCK_DAILY fallback 채택 시 sourceTier 부착.
    if (fallback) return { ...fallback, symmetryValidation: symmetry, sourceTier: 'STOCK_DAILY' };
    return {
      inputs: [],
      dataQuality: 'STALE',
      validSectorCount,
      totalSectorCount: TOTAL_SECTOR_COUNT,
      symmetryValidation: symmetry,
      reasons: [`validSectorCount=${validSectorCount} < min=${minValid}`],
      sourceTier: 'FAILED',
    };
  }

  const dataQuality: SectorEnergyDataQuality = validSectorCount === TOTAL_SECTOR_COUNT ? 'OK' : 'PARTIAL';
  // ADR-0399: KRX_CODE 정확 매칭 성공 — L1 채택.
  return {
    inputs,
    dataQuality,
    validSectorCount,
    totalSectorCount: TOTAL_SECTOR_COUNT,
    symmetryValidation: symmetry,
    reasons: dataQuality === 'PARTIAL' ? [`PARTIAL: validSectorCount=${validSectorCount}/${TOTAL_SECTOR_COUNT}`] : [],
    sourceTier: 'KRX_CODE',
  };
}

export const SECTOR_ENERGY_FALLBACK_MAX_AGE_HOURS = 48;
export function isSectorEnergyFallbackDisabled(): boolean { return process.env.SECTOR_ENERGY_FALLBACK_DISABLED === 'true'; }

/**
 * ADR-0397 (= 사용자 명시 ADR-0372): Yahoo ETF L4 fallback degradation 정책 SSOT.
 *
 * Yahoo ETF 는 KRX 섹터지수의 *원천 대체재 아님* — L4 보험 레이어.
 * 사용자 명시 절대 변경 금지 정책:
 *   - confidence × 0.5 (호출자 측 합성 후 한 번 더 강등)
 *   - allowStrongBuy=false (ADR-0398 STRONG_BUY 게이트 입력)
 *   - dataQuality='DEGRADED' 강제 (5-state union, ADR-0396)
 *
 * 한계 사유 (ADR-0397 §"Yahoo ETF 한계"):
 *   1. volumeChangePct=0 (Yahoo ETF 는 KRX 섹터 거래량 미제공)
 *   2. foreignConcentration=0 (외인 수급 미제공)
 *   3. 4주 수익률 단일 축 의존 위험
 */
function applyYahooEtfDegradation(yahooResult: SectorEnergyBuildResult): SectorEnergyBuildResult {
  return {
    ...yahooResult,
    dataQuality: 'DEGRADED',
    reasons: [
      ...yahooResult.reasons,
      'L4 Yahoo ETF fallback (ADR-0397) — confidence × 0.5, allowStrongBuy=false, dataQuality=DEGRADED 강제',
    ],
  };
}

/**
 * ADR-0399 (= 사용자 명시 ADR-0374): 4-tier 호출 순서 SSOT (절대 변경 금지).
 *
 *   L1: KRX_CODE exact match → buildSectorEnergyInputsWithMetaRaw 의 정상 분기
 *   L2: STOCK_DAILY synthetic → raw 함수 내부 buildStockDailyFallbackResult
 *   L3: CACHE (≤ 48h, ADR-0343) → macroState.sectorEnergyInputs read
 *   L4: YAHOO_ETF (ADR-0397) → buildSectorEnergyFromYahooETF, confidence × 0.5 + DEGRADED 강제
 *
 * 모든 진입에 sourceTierAttempts 누적 + 최종 채택 tier 부착. 운영자 진단용.
 */
export async function buildSectorEnergyInputsWithMetaWithFallback(): Promise<SectorEnergyBuildResult> {
  // ADR-0399: 진단 메타 누적 (각 layer 시도 결과).
  const sourceTierAttempts: SectorEnergyDiagnosticsMeta['sourceTierAttempts'] = [];

  // KRX-SECTOR-INDEXCODE-RAW-DIAGNOSTIC-001: per-build phase2 state reset 을 funnel 진입부에서
  // 수행 — KIS provider 가 먼저 채택되면 buildSectorEnergyInputsWithMetaRaw 미진입이므로
  // raw snapshot 이 null 로 남아 FALLBACK_TO_KIS_BASKET 으로 정확히 분류됨.
  resetCurrentBuildPhase2State();

  if (!isSectorEnergySourceRestorationDisabled() && !isKisSectorEnergyProviderDisabled()) {
    try {
      const { buildKisSectorEnergyInputsWithMeta } = await import('./kisSectorEnergyProvider.js');
      const kis = await buildKisSectorEnergyInputsWithMeta();
      sourceTierAttempts.push({
        tier: kis.sourceTier,
        validCount: kis.validSectorCount,
        reason: kis.reasons.slice(0, 1).join('; ') || 'KIS sectorEnergy provider attempted',
      });
      if (kis.validSectorCount > 0 && kis.sourceTier !== 'MISSING') {
        return attachDiagnostics(
          {
            inputs: kis.inputs,
            dataQuality: kis.dataQuality,
            validSectorCount: kis.validSectorCount,
            totalSectorCount: kis.totalSectorCount,
            reasons: kis.reasons,
            sourceTier: kis.sourceTier,
            coverageBreakdown: kis.coverageBreakdown,
            leadershipConfidence: kis.leadershipConfidence,
            selectedSectors: kis.selectedSectors,
            providerIssue: kis.providerIssue,
            marketSignal: kis.marketSignal,
            liveExecutionAllowed: kis.liveExecutionAllowed,
            executionImpact: kis.executionImpact,
            recoveryAudit: kis.recoveryAudit,
            sectorCoverageBreakdown: kis.sectorCoverageBreakdown,
          },
          [],
          sourceTierAttempts,
        );
      }
    } catch (e) {
      sourceTierAttempts.push({
        tier: 'MISSING',
        validCount: 0,
        reason: `KIS sectorEnergy throw: ${e instanceof Error ? e.message : 'unknown'}`,
      });
    }
  }

  const result = await buildSectorEnergyInputsWithMetaRaw();

  // ADR-0399: raw 결과의 sourceTier 를 진단 메타에 기록 (L1/L2/FAILED 분기).
  const rawTier: SectorEnergySourceTierForDiag = result.sourceTier ?? 'FAILED';
  sourceTierAttempts.push({
    tier: rawTier,
    validCount: result.validSectorCount,
    reason: rawTier === 'FAILED' ? result.reasons.slice(0, 1).join('; ') || 'raw FAILED' : undefined,
  });

  const candidateDates = __getLastAttemptedTodayDatesForTests();

  // ADR-0399: ENV `SECTOR_ENERGY_SOURCE_RESTORATION_DISABLED=true` 활성 시 진단 메타 부착 없이 raw 그대로.
  if (isSectorEnergySourceRestorationDisabled()) {
    return result;
  }

  if (isSectorEnergyFallbackDisabled()) return attachDiagnostics(result, candidateDates, sourceTierAttempts);
  if (result.dataQuality !== 'FAILED') return attachDiagnostics(result, candidateDates, sourceTierAttempts);

  // L3: macroState cache (48h, ADR-0343) — 우선 시도
  // ADR-0418 baseline cleanup — MacroState 의 sectorEnergyInputs 는 본 모듈의
  // SectorEnergyInput 과 다른 SSOT (src/types/sectorEnergy) 일 수 있어 안전 cast.
  let cached: { sectorEnergyInputs?: SectorEnergyInput[]; sectorEnergyInputsUpdatedAt?: string } | null;
  try {
    const { loadMacroState } = await import('../persistence/macroStateRepo.js');
    cached = loadMacroState() as unknown as { sectorEnergyInputs?: SectorEnergyInput[]; sectorEnergyInputsUpdatedAt?: string } | null;
  } catch { cached = null; }

  if (cached?.sectorEnergyInputs && cached.sectorEnergyInputsUpdatedAt) {
    const updatedAtMs = new Date(cached.sectorEnergyInputsUpdatedAt).getTime();
    if (Number.isFinite(updatedAtMs)) {
      const ageHours = (Date.now() - updatedAtMs) / (3600 * 1000);
      if (ageHours >= 0 && ageHours < SECTOR_ENERGY_FALLBACK_MAX_AGE_HOURS) {
        sourceTierAttempts.push({
          tier: 'CACHE',
          validCount: cached.sectorEnergyInputs.length,
          reason: `cache age=${ageHours.toFixed(1)}h`,
        });
        const cacheResult: SectorEnergyBuildResult = {
          inputs: cached.sectorEnergyInputs,
          dataQuality: 'STALE',
          validSectorCount: cached.sectorEnergyInputs.length,
          totalSectorCount: TOTAL_SECTOR_COUNT,
          reasons: [...result.reasons, `fallback to macroState cache (${ageHours.toFixed(1)}h old, ADR-0343)`],
          sourceTier: 'CACHE',
        };
        return attachDiagnostics(cacheResult, candidateDates, sourceTierAttempts);
      } else {
        sourceTierAttempts.push({
          tier: 'CACHE',
          validCount: 0,
          reason: `cache EXPIRED (age=${ageHours.toFixed(1)}h ≥ ${SECTOR_ENERGY_FALLBACK_MAX_AGE_HOURS}h)`,
        });
      }
    }
  } else {
    sourceTierAttempts.push({ tier: 'CACHE', validCount: 0, reason: 'cache 부재' });
  }

  // L4: Yahoo ETF fallback (ADR-0397).
  // 진입 조건: KRX 실패 (L1+L2) + macroState cache 부재/EXPIRED (L3) 모두 충족 시.
  // 호출 순서 SSOT 절대 변경 금지 — L1 → L2 → L3 → L4.
  if (!isSectorEnergyEtfFallbackDisabled()) {
    try {
      const { buildSectorEnergyFromYahooETF } = await import('./sectorEnergyFallbackProvider.js');
      const yahoo = await buildSectorEnergyFromYahooETF();
      if (yahoo.dataQuality !== 'FAILED' && yahoo.validSectorCount > 0) {
        sourceTierAttempts.push({
          tier: 'YAHOO_ETF',
          validCount: yahoo.validSectorCount,
          reason: 'L4 보험 — KRX 실패 + cache 부재/EXPIRED',
        });
        const degraded = applyYahooEtfDegradation(yahoo);
        return attachDiagnostics(
          { ...degraded, sourceTier: 'YAHOO_ETF' },
          candidateDates,
          sourceTierAttempts,
          'KRX 실패 + cache 부재/EXPIRED → Yahoo ETF L4 (ADR-0397)',
        );
      } else {
        sourceTierAttempts.push({
          tier: 'YAHOO_ETF',
          validCount: yahoo.validSectorCount,
          reason: `Yahoo ETF FAILED (validCount=${yahoo.validSectorCount})`,
        });
      }
    } catch (e) {
      sourceTierAttempts.push({
        tier: 'YAHOO_ETF',
        validCount: 0,
        reason: `Yahoo ETF throw: ${e instanceof Error ? e.message : 'unknown'}`,
      });
    }
  }

  // L1~L4 모두 실패
  return attachDiagnostics(
    { ...result, sourceTier: 'FAILED' },
    candidateDates,
    sourceTierAttempts,
    'L1~L4 모두 실패 — 데이터 입력 부재',
  );
}

/**
 * ADR-0399: SectorEnergyBuildResult 에 진단 메타 부착 SSOT.
 * confidence 산출은 ADR-0396 SSOT (`buildSectorEnergyQualityComposite`) 위임.
 */
function attachDiagnostics(
  result: SectorEnergyBuildResult,
  candidateDates: string[],
  sourceTierAttempts: SectorEnergyDiagnosticsMeta['sourceTierAttempts'],
  fallbackReason?: string,
): SectorEnergyBuildResult {
  const finalSourceTier: SectorEnergySourceTierForDiag = result.sourceTier ?? 'FAILED';

  // ADR-0396 SSOT 호출 — 신규 산출식 도입 금지.
  // ageMs=0 (KRX 정상 fetch 시 FRESH 자동 분류) — CACHE/YAHOO_ETF 분기는 호출자 측 wiring.
  let confidence = 0;
  try {
    // dynamic import — circular 회피.
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const { buildSectorEnergyQualityComposite } = require('./sectorEnergyDataQuality.js');
    const composite = buildSectorEnergyQualityComposite(
      result.validSectorCount,
      finalSourceTier,
      0, // FRESH (raw fetch 직후)
      result.totalSectorCount,
    );
    confidence = composite.confidence;
  } catch {
    confidence = 0;
  }

  return withQualityDiagnostic({
    ...result,
    diagnostics: {
      candidateDates,
      sourceTierAttempts,
      finalSourceTier,
      confidence,
      ...(fallbackReason ? { fallbackReason } : {}),
      ...(result.coverageBreakdown ? { coverageBreakdown: result.coverageBreakdown } : {}),
      ...(result.leadershipConfidence ? { leadershipConfidence: result.leadershipConfidence } : {}),
      ...(result.selectedSectors ? { selectedSectors: result.selectedSectors } : {}),
      ...(result.providerIssue !== undefined ? { providerIssue: result.providerIssue } : {}),
      ...(result.marketSignal !== undefined ? { marketSignal: result.marketSignal } : {}),
      ...(result.liveExecutionAllowed !== undefined ? { liveExecutionAllowed: result.liveExecutionAllowed } : {}),
      ...(result.executionImpact !== undefined ? { executionImpact: result.executionImpact } : {}),
    },
  });
}

/**
 * ADR-0399: ENV `SECTOR_ENERGY_SOURCE_RESTORATION_DISABLED=true` 우회.
 * 회귀 발견 시 1줄 즉시 ADR-0398 이전 동작 복원.
 * 정확 비교 (=== 'true') ADR-0157 정합.
 */
export function isSectorEnergySourceRestorationDisabled(): boolean {
  return process.env.SECTOR_ENERGY_SOURCE_RESTORATION_DISABLED === 'true';
}

export function isKisSectorEnergyProviderDisabled(): boolean {
  if (process.env.KIS_SECTOR_ENERGY_PROVIDER_DISABLED === 'true') return true;
  if (
    (process.env.VITEST === 'true' || process.env.NODE_ENV === 'test') &&
    process.env.KIS_SECTOR_ENERGY_PROVIDER_ENABLED !== 'true'
  ) {
    return true;
  }
  return false;
}

/**
 * ADR-0397: Yahoo ETF L4 fallback ENV 헬퍼 SSOT.
 * 정확 비교 (=== 'true') ADR-0157 의무. default OFF — 활성화 시 즉시 L4 비활성.
 *
 * 호출자 측 inline ENV 검사 0건 — SSOT 위임 (ADR-0185~0189 정합).
 *
 * NOTE: ADR-0364 의 sectorEnergyFallbackProvider 는 자체 ENV
 * `SECTOR_ENERGY_ETF_FALLBACK_DISABLED` 도 가짐 — 본 함수와 동일한 SSOT 통합.
 */
export function isSectorEnergyEtfFallbackDisabled(): boolean {
  // ADR-0364 동일 ENV 변수명 정합 — sectorEnergyFallbackProvider.isSectorEnergyEtfFallbackDisabled() 와 동일.
  // 사용자 명시 ADR-0372 ENV `SECTOR_ENERGY_YAHOO_ETF_FALLBACK_DISABLED` 도 함께 우회 (alias).
  if (process.env.SECTOR_ENERGY_YAHOO_ETF_FALLBACK_DISABLED === 'true') return true;
  return process.env.SECTOR_ENERGY_ETF_FALLBACK_DISABLED === 'true';
}

const CACHE_TTL_MS = 30 * 60 * 1000;
let _cache: { data: SectorEnergyInput[]; expiresAt: number } | null = null;
let _inflight: Promise<SectorEnergyInput[]> | null = null;

export async function getSectorEnergyInputs(force = false): Promise<SectorEnergyInput[]> {
  if (!force && _cache && _cache.expiresAt > Date.now()) return _cache.data;
  if (_inflight) return _inflight;
  _inflight = (async () => {
    try {
      const data = await buildSectorEnergyInputs();
      if (data.length > 0) _cache = { data, expiresAt: Date.now() + CACHE_TTL_MS };
      return data;
    } finally {
      _inflight = null;
    }
  })();
  return _inflight;
}

export function resetSectorEnergyCache(): void {
  _cache = null;
  _inflight = null;
}
