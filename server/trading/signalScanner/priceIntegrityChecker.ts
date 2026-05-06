/**
 * @responsibility Price Integrity Checker — 종목별 입력 데이터 품질 SSOT
 *
 * ADR-0414 — Stage 1 Read-Only Mode. ADR-0412 (Frozen Quote Detector) 의 종목별 정밀 격상.
 *
 * 사용자 명시 절대 원칙:
 *   - 매수 직접 차단 금지 (절대 원칙 #3) — Stage 1 Read-Only.
 *   - 시스템 결함이 아니라 데이터 품질 문제로 분류.
 *   - 외부 API 직접 호출 금지 (절대 원칙 #10) — 이미 수집된 데이터만 사용.
 *
 * 외부 의존성: 0 (KIS/Yahoo/외부 API 호출 0건 — 정적 가드 ADR-0414 §22~30).
 *
 * 호출자: scanDiagnostics 본 PR 미연결 (Stage 1 dead code wiring 의도 — Stage 2/3 후속 PR).
 */

/**
 * 임계값 SSOT (ADR-0414 §1) — 변경은 ADR 갱신 + 회귀 테스트 의무.
 */
export const PRICE_INTEGRITY_THRESHOLDS = {
  /** currentPrice == previousClose 판정 허용 오차 (0.01%) — ADR-0412 정합 */
  EPSILON_PCT: 0.0001,
  /** 최근 유효 거래일 -2 거래일 이상 → STALE */
  STALE_DAYS: 2,
  /** |gapPct| > 7% → SUSPECT */
  SUSPECT_GAP_PCT: 7,
  /** |gapPct| > 15% → REVERSE_GAP_SUSPECT */
  REVERSE_GAP_PCT: 15,
  /** |gapPct| > 25% + date mismatch → PRICE_BASE_MISMATCH 격상 */
  MISMATCH_GAP_PCT: 25,
  /** comparable 부족 임계 (ADR-0412 정합) */
  MIN_COMPARABLE: 10,
} as const;

/**
 * Integrity status 7 union — ADR-0414 §1 결정 트리 산출값.
 *
 * 우선순위 (위에서 아래로 첫 매칭 채택):
 *   1. FAILED — currentPrice/previousClose 부재 + 추론 불가
 *   2. PRICE_BASE_MISMATCH — T/T-1 관계 아님 또는 mismatch + 큰 gap (>25%)
 *   3. STALE — currentPriceDate 가 STALE_DAYS 이상 과거
 *   4. FROZEN_QUOTE — currentPrice ≈ previousClose (EPSILON 이내)
 *   5. REVERSE_GAP_SUSPECT — |gapPct| > 15%
 *   6. SUSPECT — |gapPct| > 7% 또는 comparable 부족
 *   7. OK — 정상
 */
export type PriceIntegrityStatus =
  | 'OK'
  | 'SUSPECT'
  | 'STALE'
  | 'FROZEN_QUOTE'
  | 'PRICE_BASE_MISMATCH'
  | 'REVERSE_GAP_SUSPECT'
  | 'FAILED';

/**
 * 날짜 정렬 분류 — confidence 산출 입력 (ADR-0414 §2).
 *
 * MATCH = currentPriceDate == 최근 유효 거래일 + previousCloseDate == T-1
 * T_MINUS_1 = currentPriceDate == T-1
 * T_MINUS_2 = currentPriceDate == T-2
 * STALE = currentPriceDate < T-2
 * UNKNOWN = 날짜 정보 부재
 */
export type PriceDateAlignment = 'MATCH' | 'T_MINUS_1' | 'T_MINUS_2' | 'STALE' | 'UNKNOWN';

export interface PriceIntegrityInput {
  /** 종목 코드 (KRX 6자리 또는 .KS/.KQ 접미사) */
  symbol: string;
  /** 현재가 — undefined/null/NaN/Infinity/≤0 시 FAILED 후보 */
  currentPrice?: number | null;
  /** 현재가 기준일 (ISO `YYYY-MM-DD` 또는 RFC3339) */
  currentPriceDate?: string | null;
  /** 전일 종가 — undefined/null/NaN/Infinity/≤0 시 FAILED 후보 */
  previousClose?: number | null;
  /** 전일 종가 기준일 (ISO `YYYY-MM-DD` 또는 RFC3339) */
  previousCloseDate?: string | null;
  /**
   * 비교 가능한 다른 종목 수 (전체 스캔 layer 의 comparable count).
   * 부재 시 comparable 부족 분기 미평가 (단일 종목 평가 시).
   */
  comparableQuoteCount?: number;
  /**
   * 다중 출처 보유 여부 (Yahoo + KIS + KRX 등) — confidence 산출 입력.
   * 부재 시 cross-source 불명 (UNKNOWN 가중치).
   */
  secondarySources?: ReadonlyArray<'KIS' | 'KRX' | 'YAHOO' | 'RECENT_DAILY' | 'CACHE'>;
  /**
   * 최근 유효 거래일 KST (`YYYY-MM-DD`).
   * 호출자가 `previousKrxTradingDay()` 결과 전달.
   * 부재 시 STALE 분기 미평가 (날짜 정보 부재 분기).
   */
  lastKrxTradingDate?: string | null;
}

export interface PriceIntegrityResult {
  symbol: string;
  status: PriceIntegrityStatus;
  reasons: string[];
  /** gapPct = (currentPrice - previousClose) / previousClose × 100 — 산출 가능 시. */
  gapPct: number | null;
  /** currentPriceDate 와 lastKrxTradingDate 거리 (영업일 추정 안 함, 단순 캘린더 일자) */
  daysFromLastTradingDay: number | null;
  dateAlignment: PriceDateAlignment;
  computedAt: string;
}

/**
 * 숫자 안전 가드 — finite + > 0.
 */
function isPositiveFinite(v: unknown): v is number {
  return typeof v === 'number' && Number.isFinite(v) && v > 0;
}

/**
 * `YYYY-MM-DD` 추출 — 잘못된 ISO 시 null.
 */
function extractDateKey(iso?: string | null): string | null {
  if (!iso || typeof iso !== 'string') return null;
  // RFC3339 → 앞 10자
  const candidate = iso.length >= 10 ? iso.slice(0, 10) : iso;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(candidate)) return null;
  return candidate;
}

/**
 * 두 KST 일자 (`YYYY-MM-DD`) 의 캘린더 일자 차이 (양수 = a 가 b 보다 미래).
 * 잘못된 입력 → null.
 */
function diffCalendarDays(a: string | null, b: string | null): number | null {
  if (!a || !b) return null;
  const aTs = Date.parse(`${a}T00:00:00.000Z`);
  const bTs = Date.parse(`${b}T00:00:00.000Z`);
  if (!Number.isFinite(aTs) || !Number.isFinite(bTs)) return null;
  return Math.round((aTs - bTs) / (24 * 3_600_000));
}

/**
 * gapPct 계산 — base ≤ 0 시 null.
 */
function computeGapPct(current: number | null | undefined, base: number | null | undefined): number | null {
  if (!isPositiveFinite(current) || !isPositiveFinite(base)) return null;
  return ((current - base) / base) * 100;
}

/**
 * 날짜 정렬 분류 — currentPriceDate vs lastKrxTradingDate.
 */
function classifyDateAlignment(
  currentPriceDate: string | null,
  lastKrxTradingDate: string | null,
): PriceDateAlignment {
  if (!currentPriceDate || !lastKrxTradingDate) return 'UNKNOWN';
  const diff = diffCalendarDays(currentPriceDate, lastKrxTradingDate);
  if (diff === null) return 'UNKNOWN';
  if (diff >= 0) return 'MATCH';
  if (diff === -1) return 'T_MINUS_1';
  if (diff === -2) return 'T_MINUS_2';
  return 'STALE';
}

/**
 * Price Integrity 분류 SSOT — ADR-0414 §1 결정 트리 (사용자 명시 절대 변경 금지).
 *
 * 우선순위 분기:
 *   1. currentPrice/previousClose 부재 또는 ≤0 → FAILED 또는 SUSPECT
 *   2. STALE (currentPriceDate < T - STALE_DAYS) — 날짜 우선순위 격상
 *   3. PRICE_BASE_MISMATCH (T/T-1 관계 아님 + |gap|>25%)
 *   4. FROZEN_QUOTE (currentPrice ≈ previousClose)
 *   5. REVERSE_GAP_SUSPECT (|gap|>15%)
 *   6. SUSPECT (|gap|>7% 또는 comparable 부족)
 *   7. OK (정상)
 *
 * 외부 부작용 0 — 영속 무관 read-only.
 */
export function evaluatePriceIntegrity(input: PriceIntegrityInput): PriceIntegrityResult {
  const reasons: string[] = [];
  const computedAt = new Date().toISOString();

  // 입력 정규화
  const cur = isPositiveFinite(input.currentPrice) ? input.currentPrice : null;
  const prev = isPositiveFinite(input.previousClose) ? input.previousClose : null;
  const curDateKey = extractDateKey(input.currentPriceDate);
  const prevDateKey = extractDateKey(input.previousCloseDate);
  const lastTradingKey = extractDateKey(input.lastKrxTradingDate);

  const dateAlignment = classifyDateAlignment(curDateKey, lastTradingKey);
  const daysFromLastTradingDay =
    curDateKey && lastTradingKey ? diffCalendarDays(curDateKey, lastTradingKey) : null;
  const gapPct = computeGapPct(cur, prev);

  // 1. FAILED — currentPrice/previousClose 모두 부재 + 추론 불가
  if (cur === null && prev === null) {
    reasons.push('FAILED — currentPrice/previousClose 모두 부재');
    return {
      symbol: input.symbol,
      status: 'FAILED',
      reasons,
      gapPct: null,
      daysFromLastTradingDay,
      dateAlignment,
      computedAt,
    };
  }

  // 1-b. SUSPECT — 한쪽만 부재 (gap 계산 불가, FAILED 격하 — 장 전 frozen 만으로 FAILED 금지)
  if (cur === null || prev === null) {
    reasons.push(
      cur === null
        ? 'SUSPECT — currentPrice 부재 또는 ≤0'
        : 'SUSPECT — previousClose 부재 또는 ≤0',
    );
    return {
      symbol: input.symbol,
      status: 'SUSPECT',
      reasons,
      gapPct: null,
      daysFromLastTradingDay,
      dateAlignment,
      computedAt,
    };
  }

  // 2. STALE — currentPriceDate 가 STALE_DAYS 이상 과거 (캘린더 일자 기준)
  if (
    daysFromLastTradingDay !== null &&
    daysFromLastTradingDay <= -PRICE_INTEGRITY_THRESHOLDS.STALE_DAYS
  ) {
    reasons.push(
      `STALE — currentPriceDate ${curDateKey} (${daysFromLastTradingDay}일 차이, 임계 ${PRICE_INTEGRITY_THRESHOLDS.STALE_DAYS}일)`,
    );
    return {
      symbol: input.symbol,
      status: 'STALE',
      reasons,
      gapPct,
      daysFromLastTradingDay,
      dateAlignment,
      computedAt,
    };
  }

  // 3. PRICE_BASE_MISMATCH — T/T-1 관계 아님 (currentPriceDate vs previousCloseDate 거리 > 1)
  //    + 큰 gap (>25%) 시 격상.
  const dateGap = diffCalendarDays(curDateKey, prevDateKey);
  const dateGapAbs = dateGap !== null ? Math.abs(dateGap) : null;
  const absGapPct = gapPct !== null ? Math.abs(gapPct) : 0;

  if (
    dateGapAbs !== null &&
    dateGapAbs > 1 &&
    absGapPct > PRICE_INTEGRITY_THRESHOLDS.MISMATCH_GAP_PCT
  ) {
    reasons.push(
      `PRICE_BASE_MISMATCH — currentPriceDate=${curDateKey} previousCloseDate=${prevDateKey} (거리 ${dateGapAbs}일, |gap|=${absGapPct.toFixed(2)}%)`,
    );
    return {
      symbol: input.symbol,
      status: 'PRICE_BASE_MISMATCH',
      reasons,
      gapPct,
      daysFromLastTradingDay,
      dateAlignment,
      computedAt,
    };
  }

  // 3-b. PRICE_BASE_MISMATCH — date 거리 > 1 (gap 작아도 의심) — STALE 분기 미적합 케이스
  if (dateGapAbs !== null && dateGapAbs > 1) {
    reasons.push(
      `PRICE_BASE_MISMATCH — date 거리 ${dateGapAbs}일 (currentPriceDate=${curDateKey} previousCloseDate=${prevDateKey})`,
    );
    return {
      symbol: input.symbol,
      status: 'PRICE_BASE_MISMATCH',
      reasons,
      gapPct,
      daysFromLastTradingDay,
      dateAlignment,
      computedAt,
    };
  }

  // 4. FROZEN_QUOTE — currentPrice ≈ previousClose
  if (
    gapPct !== null &&
    Math.abs(cur - prev) / prev <= PRICE_INTEGRITY_THRESHOLDS.EPSILON_PCT
  ) {
    reasons.push(
      `FROZEN_QUOTE — currentPrice ≈ previousClose (|Δ|/prev ≤ ${PRICE_INTEGRITY_THRESHOLDS.EPSILON_PCT * 100}%)`,
    );
    return {
      symbol: input.symbol,
      status: 'FROZEN_QUOTE',
      reasons,
      gapPct,
      daysFromLastTradingDay,
      dateAlignment,
      computedAt,
    };
  }

  // 5. REVERSE_GAP_SUSPECT — |gap| > 15%
  if (absGapPct > PRICE_INTEGRITY_THRESHOLDS.REVERSE_GAP_PCT) {
    reasons.push(
      `REVERSE_GAP_SUSPECT — |gap|=${absGapPct.toFixed(2)}% > ${PRICE_INTEGRITY_THRESHOLDS.REVERSE_GAP_PCT}%`,
    );
    return {
      symbol: input.symbol,
      status: 'REVERSE_GAP_SUSPECT',
      reasons,
      gapPct,
      daysFromLastTradingDay,
      dateAlignment,
      computedAt,
    };
  }

  // 6. SUSPECT — |gap| > 7% 또는 comparable 부족
  if (absGapPct > PRICE_INTEGRITY_THRESHOLDS.SUSPECT_GAP_PCT) {
    reasons.push(
      `SUSPECT — |gap|=${absGapPct.toFixed(2)}% > ${PRICE_INTEGRITY_THRESHOLDS.SUSPECT_GAP_PCT}%`,
    );
    return {
      symbol: input.symbol,
      status: 'SUSPECT',
      reasons,
      gapPct,
      daysFromLastTradingDay,
      dateAlignment,
      computedAt,
    };
  }

  if (
    typeof input.comparableQuoteCount === 'number' &&
    Number.isFinite(input.comparableQuoteCount) &&
    input.comparableQuoteCount < PRICE_INTEGRITY_THRESHOLDS.MIN_COMPARABLE
  ) {
    reasons.push(
      `SUSPECT — comparableQuoteCount=${input.comparableQuoteCount} < ${PRICE_INTEGRITY_THRESHOLDS.MIN_COMPARABLE} (장 전 frozen 만으로 FAILED 금지)`,
    );
    return {
      symbol: input.symbol,
      status: 'SUSPECT',
      reasons,
      gapPct,
      daysFromLastTradingDay,
      dateAlignment,
      computedAt,
    };
  }

  // 7. OK
  reasons.push(
    `OK — gap=${absGapPct.toFixed(2)}% (정상 범위, 임계 ${PRICE_INTEGRITY_THRESHOLDS.SUSPECT_GAP_PCT}%)`,
  );
  return {
    symbol: input.symbol,
    status: 'OK',
    reasons,
    gapPct,
    daysFromLastTradingDay,
    dateAlignment,
    computedAt,
  };
}
