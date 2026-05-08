/**
 * @responsibility ADR-0446 SectorEnergy indexCode Recovery Phase 2 진단 SSOT.
 *
 * ADR-0424 backfill 위에서 *missing row 의 진짜 원인* 을 row 단위로 분해 +
 * normalization 확장 alias + sourceTier breakdown + recoveryStatus 결정.
 *
 * ADR-0447: SECTOR_INDEX_MASTER alias registry expansion + NON_SECTOR_AGGREGATE_ROW
 * 분리 격상. 12-value union (ADR-0446 11 + NON_SECTOR_AGGREGATE_ROW) + normalize 10 단계
 * (중점 문자 / 전각·반각 / "업종" suffix) + isNonSectorAggregateRow SSOT + 3 옵셔널
 * 후방호환 필드 (aliasExpansionRecovered / nonSectorAggregateIgnored / topRecoveredAliases).
 * ENV `SECTOR_ENERGY_ALIAS_REGISTRY_EXPANSION_DISABLED=true` 시 ADR-0446 동작 100% 복원.
 *
 * 절대 불변식 (사용자 §"절대 불변식"):
 *   1. ambiguous alias 자동 backfill 절대 금지 (다중 후보 시 진단만 기록).
 *   2. STOCK_DAILY fallback trusted leadership source 금지.
 *   3. fallbackUsed !== 'NONE' → recoveryStatus='RECOVERED' 금지.
 *   4. symmetryValidation FAILED → recoveryStatus='RECOVERED' 금지.
 *   5. indexCodeCoverage < 0.8 → recoveryStatus='RECOVERED' 금지.
 *   6. freshness=FRESH 단독 leadershipConfidence='OK' 금지.
 *   7. SECTOR_INDEX_MASTER 본체 변경 0 (alias 등록은 본 ADR-0447 에서만 alias 배열 확장 허용).
 *   8. KIS 주문 함수 5종 import 0 (정적 grep 가드).
 *   9. autoTradeEngine / orderExecutor / trancheExecutor import 0.
 *  10. 외부 API 신규 호출 0 (sectorEnergyMaster 위임만).
 *  11. ADR-0447 — market aggregate row 를 sector alias 로 등록 절대 금지.
 *  12. ADR-0447 — NON_SECTOR_AGGREGATE_KEYWORDS 단어 경계 매칭 (KOSPI200 안 KOSPI 부분 매칭 차단).
 *
 * 외부 의존성: sectorEnergyMaster (ADR-0399 SSOT) 만. KIS/KRX/Yahoo/Naver outbound 0.
 */

import { SECTOR_INDEX_MASTER, getSectorByAlias, type SectorIndexMasterEntry } from './sectorEnergyMaster.js';

// ---------------------------------------------------------------------------
// SSOT 상수 + ENV gate
// ---------------------------------------------------------------------------

/**
 * ADR-0157 정확 비교 의무. default OFF — 활성 시 진단 layer 자체 비활성, ADR-0445
 * 동작 100% 복원.
 */
export function isSectorEnergyRecoveryPhase2Disabled(): boolean {
  return process.env.SECTOR_ENERGY_RECOVERY_PHASE2_DISABLED === 'true';
}

/**
 * ADR-0447: SectorEnergy Alias Registry Expansion ENV gate.
 *
 * default OFF — 활성 시:
 *   1. 신규 alias 매칭 차단 (음식료·담배 / 섬유·의류 / 종이·목재 / 금속 / 통신업 / 의약품 등)
 *   2. `normalizeIndexNameForLookup` 단계 4·5·8 skip (중점 문자 / 전각·반각 / "업종" suffix)
 *   3. `isNonSectorAggregateRow` 항상 false 반환 (시장 종합 row 분류 차단)
 *   → ADR-0446 동작 100% 복원.
 *
 * ADR-0157 정확 비교 의무 — '1' / 'TRUE' / 'yes' 모두 거부.
 */
export function isSectorEnergyAliasRegistryExpansionDisabled(): boolean {
  return process.env.SECTOR_ENERGY_ALIAS_REGISTRY_EXPANSION_DISABLED === 'true';
}

// ---------------------------------------------------------------------------
// ADR-0447: NON_SECTOR_AGGREGATE_ROW SSOT
// ---------------------------------------------------------------------------

/**
 * ADR-0447: NON_SECTOR_AGGREGATE_ROW 매칭 키워드 SSOT (절대 변경 금지).
 *
 * 시장 종합 row (코스피/코스닥/전체/합계/시장전체) 를 sector alias 로 등록하는 결함 차단.
 * `Object.freeze` drift 가드 + 단어 경계 매칭 의무 (KOSPI200 안 KOSPI 부분 매칭 영구 차단).
 */
export const NON_SECTOR_AGGREGATE_KEYWORDS: ReadonlyArray<string> = Object.freeze([
  '코스피',
  '코스닥',
  '전체',
  '합계',
  '시장전체',
  '외국주포함',
  'KOSPI',
  'KOSDAQ',
  'ALL',
]);

const _aggregateKeywordSet: ReadonlySet<string> = new Set(
  NON_SECTOR_AGGREGATE_KEYWORDS.map((k) => k.toLowerCase()),
);

/**
 * ADR-0447: aggregate-check 전용 1차 정규화 (괄호 strip + 공백 strip + lower-case).
 * 내부 헬퍼 — `isNonSectorAggregateRow` 만 사용.
 */
function normalizeForAggregateCheck(name: string): string {
  return name
    .replace(/[\[(\{][^\])\}]*[\])\}]/g, '') // 괄호 내부 strip
    .replace(/\s+/g, ' ') // 다중 공백 → 단일
    .trim()
    .toLowerCase();
}

/**
 * ADR-0447: market aggregate row (시장 종합) 분류 SSOT.
 *
 * 매칭 알고리즘 (절대 변경 금지):
 *   1. ENV 우회 활성 시 항상 false (ADR-0446 동작 복원).
 *   2. typeof !== 'string' → false (안전 fallback).
 *   3. `normalizeForAggregateCheck` 1차 정규화.
 *   4. 빈 문자열 → false (EMPTY_INDEX_NAME 분기로 자연 흐름).
 *   5. 키워드 set 정확 매칭 → true.
 *   6. 단어 경계 매칭 — keyword + (공백|구두점|EOL) 패턴만 인정.
 *      `KOSPI200` 안 `KOSPI` 부분 매칭 영구 차단 (sector alias 우선 보존).
 *   7. 외 → false.
 */
export function isNonSectorAggregateRow(rawIndexName: string | null | undefined): boolean {
  if (isSectorEnergyAliasRegistryExpansionDisabled()) return false;
  if (typeof rawIndexName !== 'string') return false;
  const normalized = normalizeForAggregateCheck(rawIndexName);
  if (!normalized) return false;
  // 1. 정확 매칭
  if (_aggregateKeywordSet.has(normalized)) return true;
  // 2. 단어 경계 매칭 — 한글에는 \b 미작동, 공백/구두점/EOL 명시 매칭.
  for (const kw of _aggregateKeywordSet) {
    const escaped = kw.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const re = new RegExp(`(^|[\\s,;])${escaped}($|[\\s,;])`, 'i');
    if (re.test(normalized)) return true;
  }
  return false;
}

/** Phase 2 진단 임계값 SSOT (절대 변경 금지). */
export const SECTOR_ENERGY_RECOVERY_PHASE2_THRESHOLDS = Object.freeze({
  /** indexCodeCoverage RECOVERED 최소 임계 — 사용자 §"절대 불변식" #6 정합. */
  RECOVERED_COVERAGE_MIN: 0.8,
  /** topMissing 표시 한도 — 텔레그램 메시지 길이 제한. */
  TOP_MISSING_LIMIT: 8,
  /** topAmbiguous 표시 한도. */
  TOP_AMBIGUOUS_LIMIT: 5,
} as const);

// ---------------------------------------------------------------------------
// 타입 SSOT
// ---------------------------------------------------------------------------

/**
 * 12-value union (ADR-0446 11 + ADR-0447 NON_SECTOR_AGGREGATE_ROW).
 *
 * `NON_SECTOR_AGGREGATE_ROW` (ADR-0447 신규) — 시장 종합 row (코스피/코스닥/전체/합계/시장전체).
 * `EMPTY_INDEX_NAME` 직후 + `ALIAS_NOT_REGISTERED` 보다 우선 분류 (`classifyMissingReason` 결정 트리).
 */
export type SectorIndexCodeMissingReason =
  | 'EMPTY_INDEX_NAME'
  | 'NON_SECTOR_AGGREGATE_ROW'
  | 'UNKNOWN_INDEX_NAME'
  | 'ALIAS_NOT_REGISTERED'
  | 'AMBIGUOUS_ALIAS'
  | 'MARKET_PREFIX_MISMATCH'
  | 'NORMALIZATION_MISMATCH'
  | 'STOCK_DAILY_ROW_NO_INDEX_SOURCE'
  | 'ETF_OR_DERIVED_ROW'
  | 'CACHE_ROW_MISSING_INDEX_CODE'
  | 'DATA_DBG_ROW_MISSING_IDX_IND_CD'
  | 'UNKNOWN';

/** 6-value source tier union (사용자 §3). */
export type SectorIndexRowSourceTier =
  | 'KRX_CODE'
  | 'STOCK_DAILY'
  | 'ETF'
  | 'CACHE'
  | 'DATA_DBG'
  | 'UNKNOWN';

/** ADR-0424 와 정합 + 본 ADR 4-state. */
export type SectorIndexRecoveryStatus = 'RECOVERED' | 'PARTIAL' | 'STILL_STALE' | 'NOT_NEEDED';

/** leadership confidence 3-state (사용자 §"진단 원칙"). */
export type SectorIndexLeadershipConfidence = 'OK' | 'DEGRADED' | 'BLOCKED';

/**
 * Phase 2 진단 SSOT — 단일 SectorEnergy build 의 indexCode 복구 분해.
 *
 * 호출자 (sectorEnergyProvider build / sectorEnergyDiag.cmd / scanBlockers.cmd)
 * 가 동일 SSOT 를 read.
 */
export interface SectorIndexCodeRecoveryDiagnostic {
  totalRows: number;
  rowsWithIndexCode: number;
  rowsMissingIndexCode: number;
  beforeIndexCodeCoverage: number;
  afterIndexCodeCoverage: number;
  backfilledByNameLookup: number;
  backfilledByAliasExpansion: number;
  stillMissing: number;
  missingReasonBreakdown: Record<SectorIndexCodeMissingReason, number>;
  topMissingIndexNames: Array<{
    rawName: string;
    normalizedName: string;
    count: number;
    reason: SectorIndexCodeMissingReason;
  }>;
  ambiguousAliases: Array<{ normalizedName: string; candidates: string[] }>;
  sourceTierBreakdown: Record<SectorIndexRowSourceTier, number>;
  recoveryStatus: SectorIndexRecoveryStatus;
  leadershipConfidence: SectorIndexLeadershipConfidence;
  /** 결정 트리 입력 (호출자가 전달, evaluator 가 항상 'NONE' default 로 채움). */
  fallbackUsed: 'NONE' | 'STOCK_DAILY' | 'ETF' | 'CACHE';
  symmetryValidationPassed: boolean;
  sanityViolationCount: number;

  /**
   * ADR-0447: alias 확장으로 backfill 된 row 수 (옵셔널 후방호환).
   *
   * Provider 가 normalize 후 alias 매칭 (`expandAliasCandidates(normalized).length === 1`)
   * 으로 indexCode 회복 시 `indexCodeSource='ALIAS_EXPANSION'` marker 부착 → 본 카운터 증가.
   * NAME_LOOKUP (직접 alias 매칭) 와 분리 — 신규 KRX 업종명 변형 매칭 가시화.
   */
  aliasExpansionRecovered?: number;

  /**
   * ADR-0447: aggregate row 자동 분리 카운트 (옵셔널 후방호환).
   *
   * `missingReasonBreakdown.NON_SECTOR_AGGREGATE_ROW` 와 동일 값. 운영자가 시장 종합 row
   * (코스피/코스닥/전체 등) 가 sector alias 등록 후보로 잘못 분류되지 않았는지 즉시 확인용.
   */
  nonSectorAggregateIgnored?: number;

  /**
   * ADR-0447: alias 확장으로 새로 매칭된 alias Top N (옵셔널 후방호환).
   *
   * `indexCodeSource='ALIAS_EXPANSION'` row 의 raw indexName + normalized + sectorKey
   * + displayName + count 만 영속 — raw KRX response payload / token / private metadata
   * 영속 절대 금지 (사용자 §"절대 불변식" #19 정합).
   */
  topRecoveredAliases?: Array<{
    indexName: string;
    normalizedName: string;
    sectorKey: string;
    displayName: string;
    count: number;
  }>;
}

// ---------------------------------------------------------------------------
// alias normalization 확장 SSOT
// ---------------------------------------------------------------------------

/**
 * indexName 을 lookup 용으로 normalize.
 *
 * 10 단계 (ADR-0447 격상, 사용자 §10 정합):
 *   1. trim 양쪽 공백
 *   2. 다중 공백 → 단일 공백
 *   3. 괄호 () [] {} 내부 + 괄호 자체 제거
 *   4. ★ ADR-0447 — 중점 문자 (`·` `ㆍ` `/` `-`) → 공백 (default ON, ENV 우회 시 skip)
 *   5. ★ ADR-0447 — 전각·반각 통일 (전각 ASCII U+FF01~U+FF5E → 반각, 전각 공백 U+3000 → 반각)
 *   6. 특수문자 (`,` `&`) → 공백
 *   7. 코스피/코스닥 접두/접미 제거 (KOSPI / 코스피 / KOSDAQ / 코스닥 — 단어 단위)
 *   8. ★ ADR-0447 — "업종" suffix 제거 (단어 경계 — `섬유의복업종` → `섬유의복`)
 *   9. 다중 공백 → 단일 공백 (재 trim)
 *  10. lower-case 변환 (alias 매칭은 lower-case)
 *
 * ENV `SECTOR_ENERGY_ALIAS_REGISTRY_EXPANSION_DISABLED=true` 시 단계 4·5·8 skip
 * → ADR-0446 6 단계 동작 100% 복원.
 *
 * empty/null/undefined → { normalized: '', original: '' }.
 */
export function normalizeIndexNameForLookup(
  name: string | null | undefined,
): { normalized: string; original: string } {
  const original = typeof name === 'string' ? name : '';
  if (!original) return { normalized: '', original: '' };
  let normalized = original.trim();
  if (!normalized) return { normalized: '', original };

  // 단계 1·2 — trim + 다중 공백 단일화 (사전 정리)
  normalized = normalized.replace(/\s+/g, ' ');

  // 단계 3 — 괄호 내부 + 괄호 자체 제거
  normalized = normalized.replace(/[\[(\{][^\])\}]*[\])\}]/g, '');

  const expansionEnabled = !isSectorEnergyAliasRegistryExpansionDisabled();

  if (expansionEnabled) {
    // 단계 4 — ★ ADR-0447 중점 문자 → 공백 (`·` `ㆍ` `/` `-`)
    normalized = normalized.replace(/[·ㆍ\/\-]/g, ' ');

    // 단계 5 — ★ ADR-0447 전각·반각 통일
    //   전각 ASCII (U+FF01 ~ U+FF5E) → 반각 (U+0021 ~ U+007E)
    //   전각 공백 (U+3000) → 반각 공백 (U+0020)
    normalized = normalized
      .replace(/[！-～]/g, (ch) => String.fromCharCode(ch.charCodeAt(0) - 0xfee0))
      .replace(/　/g, ' ');
  } else {
    // ENV 우회 시 ADR-0446 단계 4 그대로 (· / 만 — , & 는 단계 6 에서 처리).
    normalized = normalized.replace(/[·\/]/g, ' ');
  }

  // 단계 6 — 특수문자 (`,` `&`) → 공백 (ADR-0446 단계 4 의 일부)
  normalized = normalized.replace(/[,&]/g, ' ');

  // 단계 7 — 코스피/코스닥 접두·접미 제거 (단어 단위)
  normalized = normalized.replace(/(KOSPI|KOSDAQ|코스피|코스닥)/gi, ' ');

  if (expansionEnabled) {
    // 단계 8 — ★ ADR-0447 "업종" suffix 제거 (단어 경계 — 공백/EOL 다음만)
    normalized = normalized.replace(/업종(\s|$)/g, '$1');
  }

  // 단계 9 — 다중 공백 → 단일 공백 (재 trim)
  normalized = normalized.replace(/\s+/g, ' ').trim();

  // 단계 10 — lower-case 변환 (대소문자 무관 매칭)
  return { normalized: normalized.toLowerCase(), original };
}

/**
 * normalize 후 candidate 매칭 — SECTOR_INDEX_MASTER 의 displayName + aliases 모두
 * normalize 후 비교.
 *
 * 반환:
 *   - 정확 1개 매칭 → [single entry]
 *   - 0개 → []
 *   - 2개+ → 모든 후보 반환 (호출자가 AMBIGUOUS_ALIAS 분류)
 */
export function expandAliasCandidates(normalized: string): SectorIndexMasterEntry[] {
  if (!normalized) return [];
  const matches: SectorIndexMasterEntry[] = [];
  for (const entry of SECTOR_INDEX_MASTER) {
    const candidates = [entry.displayName, ...entry.aliases];
    for (const cand of candidates) {
      const candNorm = normalizeIndexNameForLookup(cand).normalized;
      if (candNorm && candNorm === normalized) {
        if (!matches.includes(entry)) matches.push(entry);
        break;
      }
    }
  }
  return matches;
}

/**
 * 직접 alias 호출 (정확 매칭, getSectorByAlias 위임) — backfilledByNameLookup 분류.
 */
export function tryDirectNameLookup(rawName: string | null | undefined): SectorIndexMasterEntry | null {
  return getSectorByAlias(rawName);
}

// ---------------------------------------------------------------------------
// row 분류 SSOT
// ---------------------------------------------------------------------------

/**
 * 진단 입력 row — krxOpenApi.KrxIndexDailyRow 의 *진단 필요 부분만* 복사
 * (외부 의존성 0 — type import 자체를 만들지 않고 duck-typed 사용).
 */
export interface RecoveryRowInput {
  indexCode?: string | null;
  indexName?: string | null;
  /**
   * ADR-0424 indexCodeSource — RAW / NAME_LOOKUP / STOCK_DAILY_DERIVED.
   * ADR-0447 추가 — `ALIAS_EXPANSION` (provider 가 normalize 후 alias 매칭으로 backfill).
   */
  indexCodeSource?: string | null;
  /** 옵셔널 — STOCK_DAILY/ETF/CACHE/DATA_DBG row marker (호출자가 전달). */
  rowSourceTier?: SectorIndexRowSourceTier;
}

/**
 * row 의 sourceTier 분류 SSOT.
 *
 * 우선순위:
 *   1. row.rowSourceTier 명시 → 그대로 사용 (호출자 책임)
 *   2. indexCode 존재 + indexCodeSource='RAW' → KRX_CODE
 *   3. indexCodeSource='NAME_LOOKUP' → KRX_CODE (backfill 효과 — 운영자 표기는 KRX_CODE)
 *   4. ADR-0447 — indexCodeSource='ALIAS_EXPANSION' → KRX_CODE (backfill 효과 — alias 확장 매칭)
 *   5. indexCodeSource='STOCK_DAILY_DERIVED' → STOCK_DAILY
 *   6. 그 외 (indexCode 부재 + source 미상) → UNKNOWN
 */
export function classifyRowSourceTier(row: RecoveryRowInput): SectorIndexRowSourceTier {
  if (row.rowSourceTier) return row.rowSourceTier;
  if (row.indexCode && row.indexCodeSource === 'RAW') return 'KRX_CODE';
  if (row.indexCode && row.indexCodeSource === 'NAME_LOOKUP') return 'KRX_CODE';
  if (row.indexCode && row.indexCodeSource === 'ALIAS_EXPANSION') return 'KRX_CODE';
  if (row.indexCodeSource === 'STOCK_DAILY_DERIVED') return 'STOCK_DAILY';
  return 'UNKNOWN';
}

/**
 * missing row 의 reason 분류 SSOT.
 *
 * 결정 트리 (절대 변경 금지, ADR-0446 9 분기 + ADR-0447 1 분기 = 10 분기):
 *   1. row.rowSourceTier='STOCK_DAILY' → STOCK_DAILY_ROW_NO_INDEX_SOURCE
 *   2. row.rowSourceTier='ETF' → ETF_OR_DERIVED_ROW
 *   3. row.rowSourceTier='CACHE' → CACHE_ROW_MISSING_INDEX_CODE
 *   4. row.rowSourceTier='DATA_DBG' → DATA_DBG_ROW_MISSING_IDX_IND_CD
 *   5. indexName empty/null → EMPTY_INDEX_NAME
 *   6. ★ ADR-0447 — isNonSectorAggregateRow(rawIndexName) → NON_SECTOR_AGGREGATE_ROW
 *      (EMPTY 직후, ALIAS_NOT_REGISTERED 보다 우선 — 시장 종합 row 가 sector alias 등록 후보로
 *       잘못 분류되는 결함 차단. raw indexName 으로 검사 — `"코스피 (외국주포함)"` 같이 단계 3
 *       괄호 strip 후 KOSPI 키워드 매칭 가능.)
 *   7. expandAliasCandidates(normalized).length >= 2 → AMBIGUOUS_ALIAS
 *   8. tryDirectNameLookup(raw) 매칭 → null (이미 backfill 되었어야 함, 분류 안 함)
 *   9. 정규화 후 매칭 → NORMALIZATION_MISMATCH (정상은 backfilledByAliasExpansion)
 *  10. (정규화 후 매칭 없음) → ALIAS_NOT_REGISTERED
 */
export function classifyMissingReason(row: RecoveryRowInput): SectorIndexCodeMissingReason {
  const tier = classifyRowSourceTier(row);
  if (tier === 'STOCK_DAILY') return 'STOCK_DAILY_ROW_NO_INDEX_SOURCE';
  if (tier === 'ETF') return 'ETF_OR_DERIVED_ROW';
  if (tier === 'CACHE') return 'CACHE_ROW_MISSING_INDEX_CODE';
  if (tier === 'DATA_DBG') return 'DATA_DBG_ROW_MISSING_IDX_IND_CD';

  const indexName = typeof row.indexName === 'string' ? row.indexName : '';
  if (!indexName.trim()) return 'EMPTY_INDEX_NAME';

  // ★ ADR-0447 — NON_SECTOR_AGGREGATE_ROW 분기 (EMPTY 직후 + ALIAS_NOT_REGISTERED 보다 우선).
  // raw indexName 검사 — "코스피 (외국주포함)" 같이 normalize 후 빈 문자열이 되는 케이스도
  // raw 에서 KOSPI 키워드 매칭으로 정확히 분류.
  if (isNonSectorAggregateRow(indexName)) return 'NON_SECTOR_AGGREGATE_ROW';

  const { normalized } = normalizeIndexNameForLookup(indexName);
  if (!normalized) return 'EMPTY_INDEX_NAME';

  const candidates = expandAliasCandidates(normalized);
  if (candidates.length >= 2) return 'AMBIGUOUS_ALIAS';

  // candidates.length === 0 — direct lookup 실패 + alias normalize 후도 실패
  // → ALIAS_NOT_REGISTERED (KRX 신규 업종명, alias 등록 필요)
  if (candidates.length === 0) {
    // 직접 lookup 만 실패하고 normalize 후 ambiguous 인 경우는 위에서 처리됨.
    // direct + normalize 모두 0 매칭 → ALIAS_NOT_REGISTERED.
    return 'ALIAS_NOT_REGISTERED';
  }

  // candidates.length === 1 + direct 실패 → NORMALIZATION_MISMATCH
  // (정상 흐름은 backfilledByAliasExpansion 으로 분류, 미수행 시점만 reason 노출)
  return 'NORMALIZATION_MISMATCH';
}

// ---------------------------------------------------------------------------
// 진단 합성 SSOT
// ---------------------------------------------------------------------------

export interface EvaluateRecoveryInput {
  rowsBeforeBackfill: RecoveryRowInput[];
  rowsAfterBackfill: RecoveryRowInput[];
  fallbackUsed?: 'NONE' | 'STOCK_DAILY' | 'ETF' | 'CACHE';
  symmetryValidationPassed?: boolean;
  sanityViolationCount?: number;
}

function emptyMissingReasonBreakdown(): Record<SectorIndexCodeMissingReason, number> {
  return {
    EMPTY_INDEX_NAME: 0,
    NON_SECTOR_AGGREGATE_ROW: 0, // ★ ADR-0447 신규
    UNKNOWN_INDEX_NAME: 0,
    ALIAS_NOT_REGISTERED: 0,
    AMBIGUOUS_ALIAS: 0,
    MARKET_PREFIX_MISMATCH: 0,
    NORMALIZATION_MISMATCH: 0,
    STOCK_DAILY_ROW_NO_INDEX_SOURCE: 0,
    ETF_OR_DERIVED_ROW: 0,
    CACHE_ROW_MISSING_INDEX_CODE: 0,
    DATA_DBG_ROW_MISSING_IDX_IND_CD: 0,
    UNKNOWN: 0,
  };
}

function emptySourceTierBreakdown(): Record<SectorIndexRowSourceTier, number> {
  return { KRX_CODE: 0, STOCK_DAILY: 0, ETF: 0, CACHE: 0, DATA_DBG: 0, UNKNOWN: 0 };
}

function rowHasIndexCode(row: RecoveryRowInput): boolean {
  return typeof row.indexCode === 'string' && row.indexCode.trim().length > 0;
}

function rowSource(row: RecoveryRowInput): string {
  return typeof row.indexCodeSource === 'string' ? row.indexCodeSource : '';
}

/**
 * Phase 2 진단 SSOT — backfill 이전/이후 row 비교로 분해 합성.
 *
 * 결정 트리 (절대 변경 금지):
 *   - backfilledByNameLookup: ADR-0424 RAW + NAME_LOOKUP source.
 *   - backfilledByAliasExpansion: 본 ADR normalize 후 매칭으로 backfill 된 row 수
 *     (호출자가 별도 marker 부착 시 — 본 PR 에서는 0, 후속 PR scope).
 */
export function evaluateIndexCodeRecovery(
  input: EvaluateRecoveryInput,
): SectorIndexCodeRecoveryDiagnostic {
  const before = input.rowsBeforeBackfill ?? [];
  const after = input.rowsAfterBackfill ?? [];
  const totalRows = after.length;
  const rowsWithIndexCode = after.filter(rowHasIndexCode).length;
  const rowsMissingIndexCode = totalRows - rowsWithIndexCode;
  const rowsBeforeWithIndexCode = before.filter(rowHasIndexCode).length;
  const beforeIndexCodeCoverage = before.length > 0 ? rowsBeforeWithIndexCode / before.length : 0;
  const afterIndexCodeCoverage = totalRows > 0 ? rowsWithIndexCode / totalRows : 0;

  // backfill 분류
  const backfilledByNameLookup = after.filter(
    (r) => rowHasIndexCode(r) && rowSource(r) === 'NAME_LOOKUP',
  ).length;
  // backfilledByAliasExpansion — 본 PR 에서는 0 (provider 측에서 별도 marker 부착 시 격상)
  // 호출자가 explicit `indexCodeSource='ALIAS_EXPANSION'` 표기 시 카운트.
  const backfilledByAliasExpansion = after.filter(
    (r) => rowHasIndexCode(r) && rowSource(r) === 'ALIAS_EXPANSION',
  ).length;

  // missing reason 분해
  const missingRows = after.filter((r) => !rowHasIndexCode(r));
  const missingReasonBreakdown = emptyMissingReasonBreakdown();
  const missingByName = new Map<string, { rawName: string; count: number; reason: SectorIndexCodeMissingReason }>();
  const ambiguousByNorm = new Map<string, Set<string>>();

  for (const row of missingRows) {
    const reason = classifyMissingReason(row);
    missingReasonBreakdown[reason] += 1;
    const rawName = typeof row.indexName === 'string' ? row.indexName : '';
    const { normalized } = normalizeIndexNameForLookup(rawName);
    const key = normalized || '<empty>';
    const prev = missingByName.get(key);
    if (prev) prev.count += 1;
    else missingByName.set(key, { rawName, count: 1, reason });
    // ambiguous alias 후보 누적
    if (reason === 'AMBIGUOUS_ALIAS' && normalized) {
      const candidates = expandAliasCandidates(normalized);
      const set = ambiguousByNorm.get(normalized) ?? new Set<string>();
      for (const c of candidates) set.add(c.displayName);
      ambiguousByNorm.set(normalized, set);
    }
  }

  // topMissing 정렬 (count desc)
  const topMissingIndexNames = [...missingByName.entries()]
    .map(([norm, v]) => ({
      rawName: v.rawName,
      normalizedName: norm,
      count: v.count,
      reason: v.reason,
    }))
    .sort((a, b) => b.count - a.count)
    .slice(0, SECTOR_ENERGY_RECOVERY_PHASE2_THRESHOLDS.TOP_MISSING_LIMIT);

  // ambiguous alias 목록
  const ambiguousAliases = [...ambiguousByNorm.entries()]
    .map(([normalizedName, set]) => ({ normalizedName, candidates: [...set].sort() }))
    .sort((a, b) => b.candidates.length - a.candidates.length)
    .slice(0, SECTOR_ENERGY_RECOVERY_PHASE2_THRESHOLDS.TOP_AMBIGUOUS_LIMIT);

  // sourceTier breakdown — after 기준 분류
  const sourceTierBreakdown = emptySourceTierBreakdown();
  for (const row of after) sourceTierBreakdown[classifyRowSourceTier(row)] += 1;

  // recoveryStatus 결정 트리 (사용자 §8 정합)
  const fallbackUsed = input.fallbackUsed ?? 'NONE';
  const symmetry = Boolean(input.symmetryValidationPassed);
  const sanity = Math.max(0, input.sanityViolationCount ?? 0);
  const totalBackfilled = backfilledByNameLookup + backfilledByAliasExpansion;
  const coverageMin = SECTOR_ENERGY_RECOVERY_PHASE2_THRESHOLDS.RECOVERED_COVERAGE_MIN;

  let recoveryStatus: SectorIndexRecoveryStatus;
  if (
    fallbackUsed === 'NONE' &&
    totalBackfilled === 0 &&
    afterIndexCodeCoverage >= coverageMin &&
    symmetry &&
    sanity === 0
  ) {
    recoveryStatus = 'NOT_NEEDED';
  } else if (
    fallbackUsed === 'NONE' &&
    afterIndexCodeCoverage >= coverageMin &&
    symmetry &&
    totalBackfilled > 0 &&
    sanity === 0
  ) {
    recoveryStatus = 'RECOVERED';
  } else if (
    afterIndexCodeCoverage > 0 &&
    (fallbackUsed !== 'NONE' || !symmetry || sanity > 0 || afterIndexCodeCoverage < coverageMin)
  ) {
    recoveryStatus = 'PARTIAL';
  } else {
    recoveryStatus = 'STILL_STALE';
  }

  // leadershipConfidence 결정 트리 (사용자 §9)
  let leadershipConfidence: SectorIndexLeadershipConfidence;
  const stockDailyDominant = sourceTierBreakdown.STOCK_DAILY > sourceTierBreakdown.KRX_CODE;
  if (
    recoveryStatus === 'STILL_STALE' ||
    fallbackUsed === 'STOCK_DAILY' ||
    fallbackUsed === 'ETF' ||
    afterIndexCodeCoverage === 0 ||
    stockDailyDominant
  ) {
    leadershipConfidence = 'BLOCKED';
  } else if (
    recoveryStatus === 'PARTIAL' ||
    afterIndexCodeCoverage < coverageMin ||
    sanity > 0
  ) {
    leadershipConfidence = 'DEGRADED';
  } else {
    leadershipConfidence = 'OK';
  }

  // ★ ADR-0447 — aliasExpansionRecovered / nonSectorAggregateIgnored / topRecoveredAliases 자동 산출
  // (provider 가 `indexCodeSource='ALIAS_EXPANSION'` marker 부착한 row 만 카운트).
  const aliasExpansionRecovered = backfilledByAliasExpansion;
  const nonSectorAggregateIgnored = missingReasonBreakdown.NON_SECTOR_AGGREGATE_ROW;

  // topRecoveredAliases — ALIAS_EXPANSION source row 그룹핑 (sectorKey:normalized 키, count desc, Top 5).
  const recoveredAliasMap = new Map<
    string,
    { indexName: string; normalizedName: string; sectorKey: string; displayName: string; count: number }
  >();
  for (const row of after) {
    if (!rowHasIndexCode(row)) continue;
    if (rowSource(row) !== 'ALIAS_EXPANSION') continue;
    const rawName = typeof row.indexName === 'string' ? row.indexName : '';
    const { normalized } = normalizeIndexNameForLookup(rawName);
    if (!normalized) continue;
    const matches = expandAliasCandidates(normalized);
    if (matches.length !== 1) continue;
    const entry = matches[0]!;
    const key = `${entry.sectorKey}:${normalized}`;
    const prev = recoveredAliasMap.get(key);
    if (prev) prev.count += 1;
    else
      recoveredAliasMap.set(key, {
        indexName: rawName,
        normalizedName: normalized,
        sectorKey: entry.sectorKey,
        displayName: entry.displayName,
        count: 1,
      });
  }
  const topRecoveredAliases = [...recoveredAliasMap.values()]
    .sort((a, b) => b.count - a.count)
    .slice(0, 5);

  return {
    totalRows,
    rowsWithIndexCode,
    rowsMissingIndexCode,
    beforeIndexCodeCoverage,
    afterIndexCodeCoverage,
    backfilledByNameLookup,
    backfilledByAliasExpansion,
    stillMissing: rowsMissingIndexCode,
    missingReasonBreakdown,
    topMissingIndexNames,
    ambiguousAliases,
    sourceTierBreakdown,
    recoveryStatus,
    leadershipConfidence,
    fallbackUsed,
    symmetryValidationPassed: symmetry,
    sanityViolationCount: sanity,
    // ADR-0447 — 옵셔널 후방호환 필드 (provider 측 ALIAS_EXPANSION marker 부착 시 활성).
    aliasExpansionRecovered,
    nonSectorAggregateIgnored,
    topRecoveredAliases,
  };
}

// ---------------------------------------------------------------------------
// 텔레그램 라인 빌더 SSOT (plain text, HTML escape 자동)
// ---------------------------------------------------------------------------

/** HTML escape SSOT — `<` `>` `&` 안전 처리 + null-safe. */
export function escapePhase2Html(input: unknown): string {
  if (input == null) return '';
  return String(input)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

/** Phase 2 진단 섹션 — `/sector_energy_diag` plain text. */
export function formatPhase2RecoverySection(
  diag: SectorIndexCodeRecoveryDiagnostic | null | undefined,
): string | null {
  if (!diag) return null;
  const lines: string[] = [];
  lines.push('🧩 SectorEnergy indexCode Recovery Phase 2');
  lines.push(`  • beforeCoverage: ${(diag.beforeIndexCodeCoverage * 100).toFixed(1)}%`);
  lines.push(`  • afterCoverage: ${(diag.afterIndexCodeCoverage * 100).toFixed(1)}%`);
  lines.push(`  • backfilledByNameLookup: ${diag.backfilledByNameLookup}`);
  lines.push(`  • backfilledByAliasExpansion: ${diag.backfilledByAliasExpansion}`);
  lines.push(`  • stillMissing: ${diag.stillMissing}`);

  // missingReasons (count > 0 만)
  const reasonsSorted = (Object.entries(diag.missingReasonBreakdown) as Array<[SectorIndexCodeMissingReason, number]>)
    .filter(([, count]) => count > 0)
    .sort(([, a], [, b]) => b - a);
  if (reasonsSorted.length > 0) {
    lines.push('  • missingReasons:');
    for (const [reason, count] of reasonsSorted) {
      lines.push(`    - ${reason}: ${count}`);
    }
  }

  // sourceTierBreakdown (count > 0 만)
  const tiersSorted = (Object.entries(diag.sourceTierBreakdown) as Array<[SectorIndexRowSourceTier, number]>)
    .filter(([, count]) => count > 0);
  if (tiersSorted.length > 0) {
    lines.push('  • sourceTierBreakdown:');
    for (const [tier, count] of tiersSorted) {
      lines.push(`    - ${tier}: ${count}`);
    }
  }

  // topMissing (텔레그램 길이 제한)
  if (diag.topMissingIndexNames.length > 0) {
    lines.push('  • topMissing:');
    diag.topMissingIndexNames.slice(0, 5).forEach((m, i) => {
      const safeRaw = escapePhase2Html(m.rawName || '<empty>');
      lines.push(`    ${i + 1}. "${safeRaw}" → ${m.reason} x${m.count}`);
    });
  }

  lines.push(`  • recoveryStatus: ${diag.recoveryStatus}`);
  lines.push(`  • leadershipConfidence: ${diag.leadershipConfidence}`);

  // ★ ADR-0447 — 🧩 Alias Expansion 섹션 (잡음 차단: aliasRecovered=0 + aggregateIgnored=0 → 미렌더).
  const aliasRecovered = diag.aliasExpansionRecovered ?? 0;
  const aggregateIgnored = diag.nonSectorAggregateIgnored ?? 0;
  if (aliasRecovered > 0 || aggregateIgnored > 0) {
    lines.push('');
    lines.push('🧩 SectorEnergy Alias Expansion (ADR-0447)');
    lines.push(`  • aliasExpansionRecovered: ${aliasRecovered}`);
    lines.push(`  • nonSectorAggregateIgnored: ${aggregateIgnored}`);
    if (diag.topRecoveredAliases && diag.topRecoveredAliases.length > 0) {
      lines.push('  • topRecoveredAliases:');
      diag.topRecoveredAliases.slice(0, 5).forEach((a, i) => {
        const safeIndexName = escapePhase2Html(a.indexName);
        const safeDisplay = escapePhase2Html(a.displayName);
        lines.push(`    ${i + 1}. "${safeIndexName}" → ${a.sectorKey} (${safeDisplay}) x${a.count}`);
      });
    }
  }

  return lines.join('\n');
}

/**
 * /scan_blockers compact — ADR-0446 라인 + ADR-0447 alias 라인 두 줄 격상.
 *
 * ADR-0446 라인은 byte-equivalent 보존 (`SectorEnergy Recovery: ...`). ADR-0447 라인은 항상 추가
 * (aliasRecovered=0 도 진단 정보로 운영자 인지). aliasMissing 합산 = ALIAS_NOT_REGISTERED +
 * AMBIGUOUS_ALIAS + UNKNOWN_INDEX_NAME.
 */
export function formatPhase2RecoveryCompactLine(
  diag: SectorIndexCodeRecoveryDiagnostic | null | undefined,
): string | null {
  if (!diag) return null;
  const fb = diag.fallbackUsed ?? 'NONE';
  const cov = (diag.afterIndexCodeCoverage * 100).toFixed(1);
  const adr0446Line =
    `SectorEnergy Recovery: ${diag.recoveryStatus} · ` +
    `indexCodeCoverage ${cov}% · missing ${diag.rowsMissingIndexCode}/${diag.totalRows} · ` +
    `sanity ${diag.sanityViolationCount ?? 0} · fallback ${fb} · leadership ${diag.leadershipConfidence}`;

  // ★ ADR-0447 — aliasMissing 합산 (ALIAS_NOT_REGISTERED + AMBIGUOUS_ALIAS + UNKNOWN_INDEX_NAME).
  const aliasMissing =
    (diag.missingReasonBreakdown.ALIAS_NOT_REGISTERED ?? 0) +
    (diag.missingReasonBreakdown.AMBIGUOUS_ALIAS ?? 0) +
    (diag.missingReasonBreakdown.UNKNOWN_INDEX_NAME ?? 0);
  const aliasRecovered = diag.aliasExpansionRecovered ?? 0;
  const aggregateIgnored = diag.nonSectorAggregateIgnored ?? 0;
  const aliasLine =
    `🧩 SectorEnergy Alias: recovered ${aliasRecovered} · ` +
    `aggregateIgnored ${aggregateIgnored} · ` +
    `aliasMissing ${aliasMissing} · ` +
    `confidence ${diag.leadershipConfidence}`;

  return `${adr0446Line}\n${aliasLine}`;
}
