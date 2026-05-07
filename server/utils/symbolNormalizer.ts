// @responsibility KRX 6자리 코드 정규화 + Yahoo 심볼 변환 단일 SSOT (ADR-0438 = 사용자 명시 ADR-0442).
/**
 * symbolNormalizer.ts — Symbol Resolver SSOT (ADR-0438).
 *
 * 사용자 핵심 의도 (절대 변경 금지):
 *   *"invalid code 는 degraded 가 아니라 hard reject 다. master missing 은
 *    degraded/fallback 이지만, invalid code 는 시스템 안으로 들이면 안 된다.
 *    ADR-0442 는 수익률 로직이 아니라 데이터 오염 방지용 경계 방어 패치다."*
 *
 * 안전 invariant (ADR §"12 invariants" 정합):
 *   1. KRX 내부 code = 6자리 숫자 문자열만
 *   2. .KS / .KQ / .KOSPI / .KOSDAQ suffix 는 검증 *전* strip
 *   3. suffix strip 후 비-6자리 숫자 → invalid (NON_NUMERIC / INVALID_LENGTH)
 *   4. invalid → KIS WebSocket subscribe 절대 0 (호출자 측 wiring)
 *   5. invalid → watchlist add 절대 0 (호출자 측 wiring)
 *   6. invalid → counterfactual learning ledger 영속 절대 0 (호출자 측 wiring)
 *   7. invalid → KIS/KRX/Naver/Yahoo provider 호출 0 (호출자 측 wiring)
 *   8. master missing ≠ invalid (분리 정책)
 *   9. master missing → degraded/fallback 가능 (FALLBACK_SYMBOL marker 의무)
 *  10. invalid → hard reject (literal type 강제)
 *  11. LIVE 매매 본체 0줄 변경 — 호출자 측 통합만
 *  12. 외부 fetch 추가 0 (master lookup read-only)
 *
 * 호출자 측 inline 정규식 복붙 영구 금지 — 본 SSOT 위임 의무 (ADR-0148 정합).
 */

import { DataQualityError } from '../dataQuality/emergencyDataQualityGuards.js';
import { getStockByCode } from '../persistence/krxStockMasterRepo.js';

// ─── Schema (사용자 §1) ─────────────────────────────────────────────────────

export type NormalizedKrxSymbolReason =
  | 'OK'
  | 'EMPTY'
  | 'SUFFIX_STRIPPED'
  | 'NON_NUMERIC'
  | 'INVALID_LENGTH'
  | 'MASTER_MISSING'
  | 'FALLBACK_SYMBOL'
  | 'UNKNOWN';

export interface NormalizedKrxSymbol {
  raw: string;
  code: string | null;
  valid: boolean;
  reason: NormalizedKrxSymbolReason;
  yahooSymbol?: string;
  marketSuffix?: 'KS' | 'KQ';
}

export type YahooSymbolStatus =
  | 'OK'
  | 'MASTER_MISSING'
  | 'FALLBACK_SYMBOL'
  | 'INVALID_SYMBOL';

export interface YahooSymbolResult {
  yahooSymbol: string | null;
  status: YahooSymbolStatus;
  marketSuffix?: 'KS' | 'KQ';
  fallback?: boolean;
}

// ─── ENV gate SSOT (ADR-0157 정확 비교) ────────────────────────────────────

/**
 * `SYMBOL_NORMALIZER_STRICT_DISABLED=true` 시 strict 정책 우회.
 *
 * default OFF — invalid hard reject 정책 적용.
 * 활성화 시 본 SSOT 는 invalid 도 normal 처리 (호출자 측 책임으로 위임).
 *
 * 회귀 발견 시 1줄 즉시 활성화로 ADR-0438 이전 동작 (호출자 측 inline 정규식)
 * 100% 복원 가능.
 */
export function isSymbolNormalizerStrictDisabled(): boolean {
  return process.env.SYMBOL_NORMALIZER_STRICT_DISABLED === 'true';
}

// ─── 정규화 SSOT ────────────────────────────────────────────────────────────

const KRX_SUFFIX_RE = /\.(KS|KQ|KOSPI|KOSDAQ)$/u;
const ALL_DIGITS_RE = /^\d+$/u;
const KRX_CODE_RE = /^\d{6}$/u;

/**
 * suffix 정규화 — uppercase + .KS/.KQ/.KOSPI/.KOSDAQ strip.
 *
 * @returns { core, marketSuffix } — core 는 strip 후 코드, marketSuffix 는 strip 된 시장 키 (KS/KQ).
 */
function stripSuffix(upper: string): { core: string; marketSuffix?: 'KS' | 'KQ' } {
  const match = upper.match(KRX_SUFFIX_RE);
  if (!match) return { core: upper };
  const suffix = match[1];
  const core = upper.slice(0, upper.length - match[0].length);
  if (suffix === 'KS' || suffix === 'KOSPI') return { core, marketSuffix: 'KS' };
  if (suffix === 'KQ' || suffix === 'KOSDAQ') return { core, marketSuffix: 'KQ' };
  return { core };
}

/**
 * 입력값을 6자리 KRX code 로 정규화. 실패 시 reason 별 분류.
 *
 * 결정 트리 (사용자 §1, 절대 변경 금지):
 *   1. null / undefined / non-string → EMPTY
 *   2. trim 후 빈 문자열 → EMPTY
 *   3. uppercase + suffix strip → marketSuffix 기록
 *   4. suffix 후 빈 → EMPTY
 *   5. 6자리 숫자 + suffix 없음 → OK
 *   6. 6자리 숫자 + suffix 있음 → SUFFIX_STRIPPED
 *   7. 모두 숫자 + 6자리 아님 → INVALID_LENGTH
 *   8. 알파벳 포함 → NON_NUMERIC
 *   9. 그 외 (예: 빈 결과 + 비-숫자 mix) → NON_NUMERIC
 *
 * @param raw 임의 입력 (string / null / undefined / 다른 type 모두 허용 — non-string 은 EMPTY)
 * @returns NormalizedKrxSymbol — valid=true 시 code 보장, valid=false 시 reason 명시
 */
export function normalizeKrxCode(raw: unknown): NormalizedKrxSymbol {
  // 1. EMPTY 분기 (null / undefined / non-string)
  if (raw === null || raw === undefined || typeof raw !== 'string') {
    return {
      raw: raw === null ? 'null' : raw === undefined ? 'undefined' : String(raw),
      code: null,
      valid: false,
      reason: 'EMPTY',
    };
  }

  const trimmed = raw.trim();
  if (trimmed.length === 0) {
    return { raw, code: null, valid: false, reason: 'EMPTY' };
  }

  // 2. uppercase + suffix strip
  const upper = trimmed.toUpperCase();
  const { core, marketSuffix } = stripSuffix(upper);

  if (core.length === 0) {
    return { raw, code: null, valid: false, reason: 'EMPTY' };
  }

  // 3. 6자리 숫자 검증
  if (KRX_CODE_RE.test(core)) {
    if (marketSuffix) {
      return {
        raw,
        code: core,
        valid: true,
        reason: 'SUFFIX_STRIPPED',
        marketSuffix,
      };
    }
    return { raw, code: core, valid: true, reason: 'OK' };
  }

  // 4. 모두 숫자 + 6자리 아님 → INVALID_LENGTH
  if (ALL_DIGITS_RE.test(core)) {
    return { raw, code: null, valid: false, reason: 'INVALID_LENGTH' };
  }

  // 5. 알파벳 포함 또는 mix → NON_NUMERIC
  return { raw, code: null, valid: false, reason: 'NON_NUMERIC' };
}

/**
 * code → Yahoo symbol 변환 SSOT (ADR-0438 §1).
 *
 * 결정 트리:
 *   1. normalizeKrxCode invalid → status='INVALID_SYMBOL', yahooSymbol=null
 *   2. master lookup 통과 → status='OK', yahooSymbol=`${code}.${KS|KQ}`
 *   3. master 부재 + marketHint 있음 → status='FALLBACK_SYMBOL', fallback=true
 *   4. master 부재 + marketHint 없음 → status='MASTER_MISSING', yahooSymbol=null
 *
 * marketHint 우선순위:
 *   - 명시 인자 우선
 *   - normalizeKrxCode 결과의 marketSuffix (suffix 가 있었으면)
 *   - 둘 다 없음 → MASTER_MISSING
 *
 * @param rawOrCode 임의 입력 (정규화 전)
 * @param marketHint 'KS' | 'KQ' | undefined — master 부재 시 fallback 시장
 */
export function toYahooSymbol(
  rawOrCode: unknown,
  marketHint?: 'KS' | 'KQ',
): YahooSymbolResult {
  const normalized = normalizeKrxCode(rawOrCode);
  if (!normalized.valid || !normalized.code) {
    return { yahooSymbol: null, status: 'INVALID_SYMBOL' };
  }

  const code = normalized.code;
  // master lookup
  let masterEntry: ReturnType<typeof getStockByCode> = null;
  try {
    masterEntry = getStockByCode(code);
  } catch {
    masterEntry = null;
  }

  if (masterEntry) {
    if (masterEntry.market === 'KOSPI') {
      return { yahooSymbol: `${code}.KS`, status: 'OK', marketSuffix: 'KS' };
    }
    if (masterEntry.market === 'KOSDAQ') {
      return { yahooSymbol: `${code}.KQ`, status: 'OK', marketSuffix: 'KQ' };
    }
    // KONEX / OTHER → fallback to hint or MASTER_MISSING
  }

  // master 부재 또는 KONEX/OTHER
  const effectiveHint = marketHint ?? normalized.marketSuffix;
  if (effectiveHint) {
    return {
      yahooSymbol: `${code}.${effectiveHint}`,
      status: 'FALLBACK_SYMBOL',
      marketSuffix: effectiveHint,
      fallback: true,
    };
  }

  return { yahooSymbol: null, status: 'MASTER_MISSING' };
}

/**
 * invalid code 시 throw — 호출자가 reject 흐름 보장 의무.
 *
 * @throws DataQualityError code='INVALID_KRX_CODE' (emergencyDataQualityGuards SSOT)
 */
export function assertValidKrxCode(input: unknown): string {
  const result = normalizeKrxCode(input);
  if (!result.valid || !result.code) {
    throw new DataQualityError('INVALID_KRX_CODE', {
      input,
      reason: 'KRX code must be exactly 6 numeric digits (ADR-0438)',
      normalizeReason: result.reason,
    });
  }
  return result.code;
}
