/**
 * @responsibility Frozen Quote Detector — 입력 데이터 품질 SSOT (얼어 있는 가격 감지)
 *
 * ADR-0412 — R3 sanity 가 잘못된 입력 데이터를 먹지 않도록 입력 layer 차단.
 *
 * 핵심: "가격 데이터가 얼어 있으면 시스템 결함이 아니라 데이터 품질 문제로 분류한다."
 *
 * 사용자 명시 절대 원칙:
 *   - 매수 직접 차단 금지 (절대 원칙 #3) — frozen quote 결과는 R3 guard + streak skip 에 합성.
 *   - 시스템 결함이 아니라 데이터 품질 문제로 분류 (절대 원칙 #4).
 *   - 새 fallback 추가 금지 (절대 원칙 #10) — 기존 데이터의 *품질 판정* 만.
 *
 * 외부 의존성: 0 (KIS/Yahoo/외부 API 호출 0건 — 정적 가드 19~21).
 *
 * 호출자: scanDiagnostics.ts (persistScanResults) — 후보 평가 직후 진단 입력.
 */

/**
 * 임계값 SSOT (사용자 명시 절대 변경 금지) — ADR-0412 §1.
 *
 * 변경은 ADR 갱신 + 회귀 테스트 의무 (잘못된 해결 방법 차단 #5).
 */
export const FROZEN_QUOTE_THRESHOLDS = {
  /** 최소 비교 가능 종목 수 — 이하 SUSPECT (표본 부족, STALE 아님) */
  MIN_COMPARABLE: 10,
  /** 10% 이상 frozen 시 SUSPECT */
  SUSPECT_RATIO: 0.1,
  /** 30% 이상 frozen 시 STALE */
  STALE_RATIO: 0.3,
  /** currentPrice == previousClose 판정 허용 오차 (0.01%) */
  EPSILON_PCT: 0.0001,
} as const;

export type FrozenQuoteDataQuality = 'OK' | 'SUSPECT' | 'STALE';

/**
 * Detector 입력 — 종목당 1 row.
 *
 * `currentPrice` / `previousClose` 미전달 시 (undefined / null / NaN / Infinity / ≤0)
 * comparable 카운트에서 제외. 호출자 책임 — `enrichStockWithRealData` 결과 그대로 전달.
 */
export interface FrozenQuoteInput {
  symbol: string;
  currentPrice?: number | null;
  previousClose?: number | null;
  volume?: number | null;
}

/**
 * Detector 출력 — `dataQuality` 가 핵심 SSOT, 나머지는 진단·UI 입력.
 *
 * 호출자가 R3 state machine 의 `R3SanityGuardInput.frozenQuoteDataQuality` 로 전달.
 */
export interface FrozenQuoteResult {
  dataQuality: FrozenQuoteDataQuality;
  frozenCount: number;
  comparableCount: number;
  /** 0~1, comparableCount=0 시 0 */
  frozenRatio: number;
  /** 진단 메시지 (텔레그램·로그용) — 사용자 명시 "결함" / "에러" 표현 금지 */
  reason: string;
  /** frozen 종목 코드 Top 10 — 진단·운영자 추적용 */
  symbols: string[];
}

/**
 * 단일 row 가 comparable (비교 가능) 한지 판정.
 *
 * currentPrice / previousClose 모두 양수 + 유한값 의무.
 * volume 은 comparable 자체에는 무관 — frozen 카운트에서만 평가.
 */
function isComparable(row: FrozenQuoteInput): boolean {
  const cur = row.currentPrice;
  const prev = row.previousClose;
  if (typeof cur !== 'number' || !Number.isFinite(cur) || cur <= 0) return false;
  if (typeof prev !== 'number' || !Number.isFinite(prev) || prev <= 0) return false;
  return true;
}

/**
 * 단일 row 의 frozen 판정.
 *
 * - currentPrice / previousClose 비교 (EPSILON_PCT 이내 동일).
 * - volume === 0 또는 부재 → 보수적 false (volumeClock 거래량 0 종목 frozen 과잉 회피).
 * - 호출 전 isComparable 통과 의무.
 */
function isFrozen(row: FrozenQuoteInput): boolean {
  // volume === 0 / 부재 → frozen 카운트 제외
  const vol = row.volume;
  if (typeof vol !== 'number' || !Number.isFinite(vol) || vol <= 0) return false;

  // isComparable 통과 가정 — currentPrice/previousClose 모두 양수
  const cur = row.currentPrice as number;
  const prev = row.previousClose as number;
  const diff = Math.abs(cur - prev);
  const ratio = diff / prev;
  return ratio <= FROZEN_QUOTE_THRESHOLDS.EPSILON_PCT;
}

/**
 * Frozen Quote 분류 SSOT — ADR-0412 §1 결정 트리.
 *
 * 우선순위:
 *   1. comparable < MIN_COMPARABLE → SUSPECT + INSUFFICIENT_COMPARABLE_QUOTES (STALE 금지)
 *   2. frozenRatio ≥ STALE_RATIO (0.3) → STALE
 *   3. frozenRatio ≥ SUSPECT_RATIO (0.1) → SUSPECT
 *   4. 그 외 → OK
 *
 * @param inputs 종목당 1 row 의 가격·거래량 입력 배열.
 * @returns FrozenQuoteResult — dataQuality 는 R3 guard 입력으로, 나머지는 진단용.
 */
export function evaluateFrozenQuotes(
  inputs: ReadonlyArray<FrozenQuoteInput>,
): FrozenQuoteResult {
  if (!Array.isArray(inputs) || inputs.length === 0) {
    return {
      dataQuality: 'SUSPECT',
      frozenCount: 0,
      comparableCount: 0,
      frozenRatio: 0,
      reason: 'INSUFFICIENT_COMPARABLE_QUOTES (입력 0건)',
      symbols: [],
    };
  }

  const comparable = inputs.filter(isComparable);
  const comparableCount = comparable.length;

  if (comparableCount < FROZEN_QUOTE_THRESHOLDS.MIN_COMPARABLE) {
    return {
      dataQuality: 'SUSPECT',
      frozenCount: 0,
      comparableCount,
      frozenRatio: 0,
      reason: `INSUFFICIENT_COMPARABLE_QUOTES (comparable=${comparableCount} < ${FROZEN_QUOTE_THRESHOLDS.MIN_COMPARABLE})`,
      symbols: [],
    };
  }

  const frozenRows = comparable.filter(isFrozen);
  const frozenCount = frozenRows.length;
  const frozenRatio = comparableCount > 0 ? frozenCount / comparableCount : 0;
  const symbols = frozenRows.slice(0, 10).map((r) => r.symbol);

  if (frozenRatio >= FROZEN_QUOTE_THRESHOLDS.STALE_RATIO) {
    return {
      dataQuality: 'STALE',
      frozenCount,
      comparableCount,
      frozenRatio,
      reason: `STALE — frozenRatio ${(frozenRatio * 100).toFixed(1)}% (${frozenCount}/${comparableCount} 종목 currentPrice == previousClose)`,
      symbols,
    };
  }

  if (frozenRatio >= FROZEN_QUOTE_THRESHOLDS.SUSPECT_RATIO) {
    return {
      dataQuality: 'SUSPECT',
      frozenCount,
      comparableCount,
      frozenRatio,
      reason: `SUSPECT — frozenRatio ${(frozenRatio * 100).toFixed(1)}% (${frozenCount}/${comparableCount} 종목)`,
      symbols,
    };
  }

  return {
    dataQuality: 'OK',
    frozenCount,
    comparableCount,
    frozenRatio,
    reason: `OK — frozenRatio ${(frozenRatio * 100).toFixed(1)}% (${frozenCount}/${comparableCount} 종목, 정상 범위)`,
    symbols,
  };
}
