/**
 * @responsibility ADR-0456 DART name disambiguation SSOT — corpName/ISIN/nameEng → stockCode 역매핑.
 *
 * 결함 (Before): `dartPoller.ts:795` 의 `(d.stock_code ?? '').padStart(6, '0')` 가 DART 가 stock_code
 * 없이 반환한 disclosure 를 `'000000'` 으로 silent pad → watchlist 매칭 실패 → disclosure 영구 손실.
 *
 * 본 모듈: ADR-0455 enrichment 필드 (`isin` + `nameEng`) 를 사용해 corpName / ISIN / 영문명 으로
 * stockCode 역매핑. 정확 일치만 (no fuzzy) — 모호 매칭 시 운영자에게 분류 진단 노출 (별도 후속 ADR
 * 에서 fuzzy 도입).
 *
 * 호출자: `server/alerts/dartPoller.ts` (stock_code 부재 시 corpName 기반 fallback).
 * 외부 API 호출 0건 — `getAllStockEntries()` (krxStockMasterRepo) read-only.
 */

import { getAllStockEntries, type StockMasterEntry } from './krxStockMasterRepo.js';

/** 사용자 명시 ENV 정확 비교 (ADR-0157) — `'1'` / `'TRUE'` / `'yes'` 모두 거부. */
export function isDartNameDisambiguationDisabled(): boolean {
  return process.env.DART_NAME_DISAMBIGUATION_DISABLED === 'true';
}

/**
 * ISIN (12자리) 으로 stockCode 역매핑.
 * - 입력 정규식: `/^[A-Z0-9]{12}$/i` (대소문자 무관, 정규화 후 비교)
 * - master 부재 / 정합 0건 → null
 */
export function lookupStockCodeByIsin(isin: string | null | undefined): string | null {
  if (!isin || typeof isin !== 'string') return null;
  const normalized = isin.trim().toUpperCase();
  if (!/^[A-Z0-9]{12}$/.test(normalized)) return null;
  const entries = getAllStockEntries();
  for (const e of entries) {
    if (e.isin && e.isin.toUpperCase() === normalized) return e.code;
  }
  return null;
}

/**
 * 한국어 또는 영문 종목명으로 정확 일치 stockCode 역매핑.
 *
 * 우선순위 (사용자 명시):
 * 1. 한국어 정확 일치 (`StockMasterEntry.name === nameKo`)
 * 2. 영문 정확 일치 (`StockMasterEntry.nameEng === nameEng`, ADR-0455 입력)
 *
 * 부분 일치 / 유사도 매칭 — *본 PR scope 외*. 후속 ADR 에서 Levenshtein/Jaro-Winkler 도입 검토.
 *
 * 다중 매칭 (모호) → null 반환 + console.warn (운영자 진단). 모호 조건 자체는 매우 드뭄
 * (KRX master 의 한국어 종목명은 unique key 보장).
 */
export function lookupStockCodeByExactName(
  nameKo: string | null | undefined,
  nameEng: string | null | undefined,
): string | null {
  const entries = getAllStockEntries();

  // 1순위: 한국어 정확 일치
  if (nameKo && typeof nameKo === 'string' && nameKo.trim().length > 0) {
    const trimmedKo = nameKo.trim();
    const koMatches = entries.filter((e) => e.name === trimmedKo);
    if (koMatches.length === 1) return koMatches[0].code;
    if (koMatches.length > 1) {
      console.warn(`[DartNameLookup] 한국어 모호 매칭 nameKo="${trimmedKo}" → ${koMatches.length}건 (codes: ${koMatches.map((e) => e.code).join(',')}) — null 반환`);
      return null;
    }
  }

  // 2순위: 영문 정확 일치 (대소문자 무관)
  if (nameEng && typeof nameEng === 'string' && nameEng.trim().length > 0) {
    const trimmedEng = nameEng.trim().toLowerCase();
    const engMatches = entries.filter(
      (e) => typeof e.nameEng === 'string' && e.nameEng.trim().toLowerCase() === trimmedEng,
    );
    if (engMatches.length === 1) return engMatches[0].code;
    if (engMatches.length > 1) {
      console.warn(`[DartNameLookup] 영문 모호 매칭 nameEng="${trimmedEng}" → ${engMatches.length}건 (codes: ${engMatches.map((e) => e.code).join(',')}) — null 반환`);
      return null;
    }
  }

  return null;
}

/**
 * DART corpName 모호성 진단 — 운영자 가시화용 SSOT.
 *
 * 한국어 정확 일치 + 영문 정확 일치 결과를 합쳐 candidates 반환. dedup by code.
 * - matches.length === 0 → 매칭 없음 (DART 만의 회사, 비상장)
 * - matches.length === 1 → 정확 일치 (안전)
 * - matches.length >= 2 → 모호 (별도 ADR fuzzy 매칭 검토)
 *
 * 외부 호출 0 — read-only.
 */
export interface CorpNameMatchDiagnosis {
  corpName: string;
  matches: StockMasterEntry[];
  ambiguous: boolean;
}

export function diagnoseCorpNameMatch(corpName: string | null | undefined): CorpNameMatchDiagnosis {
  const trimmed = typeof corpName === 'string' ? corpName.trim() : '';
  if (trimmed.length === 0) return { corpName: '', matches: [], ambiguous: false };
  const entries = getAllStockEntries();
  const seen = new Set<string>();
  const matches: StockMasterEntry[] = [];
  // 한국어 정확 일치
  for (const e of entries) {
    if (e.name === trimmed && !seen.has(e.code)) {
      seen.add(e.code);
      matches.push(e);
    }
  }
  // 영문 정확 일치 (대소문자 무관) — 한국어 매칭 없을 때 보충
  const trimmedLower = trimmed.toLowerCase();
  for (const e of entries) {
    if (
      typeof e.nameEng === 'string'
      && e.nameEng.trim().toLowerCase() === trimmedLower
      && !seen.has(e.code)
    ) {
      seen.add(e.code);
      matches.push(e);
    }
  }
  return { corpName: trimmed, matches, ambiguous: matches.length >= 2 };
}

/**
 * dartPoller fallback 진입점 — `(d.stock_code ?? '').padStart(6, '0')` 결함 차단.
 *
 * 우선순위:
 * 1. dartStockCode 가 6자리 정수 → 그대로 사용 (정상 경로)
 * 2. ISIN 역매핑 (ADR-0455 입력)
 * 3. corpName 한국어 → 영문 순서 정확 일치
 * 4. 모두 실패 → null (호출자가 disclosure 흐름 결정)
 *
 * ENV `DART_NAME_DISAMBIGUATION_DISABLED=true` → 항상 null (legacy 동작 = `'000000'` pad)
 */
export interface ResolveStockCodeFromDartInput {
  dartStockCode?: string | null;
  corpName?: string | null;
  corpNameEng?: string | null;
  isin?: string | null;
}

export interface ResolveStockCodeFromDartResult {
  stockCode: string | null;
  source: 'DART_RAW' | 'ISIN_LOOKUP' | 'NAME_KO_LOOKUP' | 'NAME_ENG_LOOKUP' | 'AMBIGUOUS' | 'NOT_FOUND' | 'DISABLED';
}

export function resolveStockCodeFromDart(input: ResolveStockCodeFromDartInput): ResolveStockCodeFromDartResult {
  if (isDartNameDisambiguationDisabled()) {
    return { stockCode: null, source: 'DISABLED' };
  }
  // 1. DART raw stock_code 정상 (6자리 정수)
  const raw = typeof input.dartStockCode === 'string' ? input.dartStockCode.trim() : '';
  if (/^\d{6}$/.test(raw) && raw !== '000000') {
    return { stockCode: raw, source: 'DART_RAW' };
  }
  // 2. ISIN 역매핑
  const byIsin = lookupStockCodeByIsin(input.isin);
  if (byIsin) return { stockCode: byIsin, source: 'ISIN_LOOKUP' };
  // 3. 한국어 정확 일치 (corpName)
  if (input.corpName && typeof input.corpName === 'string' && input.corpName.trim().length > 0) {
    const trimmedKo = input.corpName.trim();
    const entries = getAllStockEntries();
    const koMatches = entries.filter((e) => e.name === trimmedKo);
    if (koMatches.length === 1) return { stockCode: koMatches[0].code, source: 'NAME_KO_LOOKUP' };
    if (koMatches.length > 1) return { stockCode: null, source: 'AMBIGUOUS' };
  }
  // 4. 영문 정확 일치
  if (input.corpNameEng && typeof input.corpNameEng === 'string' && input.corpNameEng.trim().length > 0) {
    const byEng = lookupStockCodeByExactName(null, input.corpNameEng);
    if (byEng) return { stockCode: byEng, source: 'NAME_ENG_LOOKUP' };
  }
  return { stockCode: null, source: 'NOT_FOUND' };
}
