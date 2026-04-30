/**
 * @responsibility Price Source Policy SSOT — KIS canonicalPrice 승격 + Yahoo 괴리 검증
 *
 * ADR-0121 (PR-C): 사용자 9번 §1+§2 직접 반영. 한국 주식에서 Yahoo 가격이
 * 액면분할/병합/권리락 보정 오류로 -60~-80% 괴리를 일으키는 사례가 반복됨
 * (1차 로그 098460 +221%, 336260 +207% 등). KIS 현재가를 *유일한 매매 결정
 * 기준* 으로 승격하고 Yahoo 는 *Backfill 보조* 로 격하.
 *
 * 본 PR-C 는 *SSOT 인프라만* 도입. 호출자 wiring (entryEngine / exitEngine /
 * orderDispatch) 은 운영 데이터 1~2주 누적 후 후속 PR 분리 — 회귀 위험 격리.
 *
 * 사용자 §1 Yahoo 역할 강등:
 *   기존: Yahoo 가격 = 비교 기준 / 손익 계산 / 기술지표 / 이상탐지 기준
 *   변경: Yahoo 가격 = 보조 참고값 / 결측 보완용 / 히스토리 OHLCV
 *   금지: 실시간 현재가 / 손절·본절 / 매수 체결 / 성과 추적 / STRONG_BUY
 *
 * ENV `PRICE_SOURCE_POLICY_DISABLED=true` 시 SSOT 무력화 — 회귀 분석 시 사용.
 */

/** 사용자 §2 DataQualityStatus 6값 SSOT. */
export type DataQualityStatus =
  | 'VALID'                      // KIS 정상 + Yahoo 괴리 ≤3% (보조 허용)
  | 'WARN'                       // 괴리 3~10% (Yahoo 보조 비활성, KIS canonical)
  | 'INVALID'                    // 괴리 10~30% (Yahoo 사용 금지, KIS canonical 만)
  | 'CORPORATE_ACTION_SUSPECT'   // 괴리 30%+ (액면분할/병합/권리락 의심, 매수 차단)
  | 'STALE'                      // KIS 부재 + Yahoo 만 있음 (검증 불가)
  | 'MISSING';                   // KIS + Yahoo 모두 부재

/** 사용자 §2 DataQualityResult 인터페이스 SSOT. */
export interface DataQualityResult {
  status: DataQualityStatus;
  canonicalPrice: number | null;
  canonicalSource: 'KIS' | 'KRX' | 'NAVER' | 'YAHOO_VALIDATED' | 'NONE';
  yahooPrice?: number | null;
  kisPrice?: number | null;
  discrepancyPct?: number | null;
  reasons: string[];
  /** 기술지표 (RSI/MACD/볼린저 등) 사용 허용 여부 */
  allowTechnicalIndicators: boolean;
  /** 매수/매도 주문 생성 허용 여부 (사용자 §3 Execution Rule) */
  allowExecution: boolean;
}

/** 임계 SSOT — 사용자 §1 정합. ENV 우회 미설계 (PR-C 인프라 단계). */
export const PRICE_SOURCE_THRESHOLDS = {
  /** ≤3% 괴리 시 Yahoo 보조 허용 */
  DISCREPANCY_VALID_PCT: 3,
  /** 3~10% 괴리 시 WARN (Yahoo 보조 비활성) */
  DISCREPANCY_WARN_PCT: 10,
  /** 10~30% 괴리 시 INVALID (Yahoo 사용 금지) */
  DISCREPANCY_INVALID_PCT: 30,
  /** 30~50% 괴리 시 CORPORATE_ACTION_SUSPECT (매수 차단) */
  DISCREPANCY_CORPORATE_ACTION_PCT: 50,
} as const;

/** ENV 우회 헬퍼 — 사용자 §1 정합 강제 비활성화 시 사용. */
export function isPriceSourcePolicyDisabled(): boolean {
  return process.env.PRICE_SOURCE_POLICY_DISABLED === 'true';
}

export interface PriceSourceInput {
  kisPrice?: number | null;
  yahooPrice?: number | null;
  prevClose?: number | null;
  basePrice?: number | null;
  lastUpdatedAt?: string;
}

/**
 * Price Source Policy SSOT — KIS canonical + Yahoo 괴리 검증.
 *
 * 사용자 §1 우선순위:
 * 1. KIS 현재가 → canonical (매매 결정 기준)
 * 2. KIS+Yahoo 괴리 ≤3% → Yahoo 보조 허용
 * 3. 괴리 3~10% → WARN
 * 4. 괴리 10~30% → INVALID (Yahoo 사용 금지)
 * 5. 괴리 30%+ → CORPORATE_ACTION_SUSPECT (매수 차단)
 *
 * @returns DataQualityResult — allowExecution 가드 + canonicalPrice 단일 SSOT
 */
export function evaluateDataQuality(input: PriceSourceInput): DataQualityResult {
  const { kisPrice, yahooPrice } = input;

  // ENV 우회 — 강제 VALID + KIS 우선 (회귀 분석용)
  if (isPriceSourcePolicyDisabled()) {
    return {
      status: 'VALID',
      canonicalPrice: kisPrice ?? yahooPrice ?? null,
      canonicalSource: kisPrice ? 'KIS' : yahooPrice ? 'YAHOO_VALIDATED' : 'NONE',
      kisPrice,
      yahooPrice,
      reasons: ['PRICE_SOURCE_POLICY_DISABLED'],
      allowTechnicalIndicators: true,
      allowExecution: kisPrice != null && kisPrice > 0,
    };
  }

  const reasons: string[] = [];

  // KIS + Yahoo 모두 부재 → MISSING
  const kisValid = typeof kisPrice === 'number' && Number.isFinite(kisPrice) && kisPrice > 0;
  const yahooValid = typeof yahooPrice === 'number' && Number.isFinite(yahooPrice) && yahooPrice > 0;

  if (!kisValid && !yahooValid) {
    return {
      status: 'MISSING',
      canonicalPrice: null,
      canonicalSource: 'NONE',
      kisPrice,
      yahooPrice,
      reasons: ['BOTH_PRICES_MISSING'],
      allowTechnicalIndicators: false,
      allowExecution: false,
    };
  }

  // KIS 부재 + Yahoo 만 있음 → STALE (검증 불가, 매수 차단)
  if (!kisValid && yahooValid) {
    return {
      status: 'STALE',
      canonicalPrice: yahooPrice ?? null,
      canonicalSource: 'YAHOO_VALIDATED',
      kisPrice,
      yahooPrice,
      reasons: ['KIS_PRICE_MISSING_YAHOO_UNVERIFIED'],
      allowTechnicalIndicators: true, // 기술지표는 OHLCV 보조 허용
      allowExecution: false,           // 매수 차단 — KIS canonical 부재
    };
  }

  // KIS 만 있음 + Yahoo 부재 → VALID (KIS canonical, Yahoo 무관)
  if (kisValid && !yahooValid) {
    reasons.push('YAHOO_PRICE_MISSING');
    return {
      status: 'VALID',
      canonicalPrice: kisPrice as number,
      canonicalSource: 'KIS',
      kisPrice,
      yahooPrice,
      reasons,
      allowTechnicalIndicators: true,
      allowExecution: true,
    };
  }

  // KIS + Yahoo 둘 다 있음 → 괴리율 계산
  const kis = kisPrice as number;
  const yh = yahooPrice as number;
  const discrepancyPct = (Math.abs(yh - kis) / kis) * 100;
  const reasonStr = `discrepancy=${discrepancyPct.toFixed(2)}% (KIS=${kis}, Yahoo=${yh})`;

  if (discrepancyPct <= PRICE_SOURCE_THRESHOLDS.DISCREPANCY_VALID_PCT) {
    reasons.push(`PRICE_VALID: ${reasonStr}`);
    return {
      status: 'VALID',
      canonicalPrice: kis,
      canonicalSource: 'KIS',
      kisPrice,
      yahooPrice,
      discrepancyPct,
      reasons,
      allowTechnicalIndicators: true,
      allowExecution: true,
    };
  }

  if (discrepancyPct <= PRICE_SOURCE_THRESHOLDS.DISCREPANCY_WARN_PCT) {
    reasons.push(`PRICE_WARN: ${reasonStr} — Yahoo 보조 비활성`);
    return {
      status: 'WARN',
      canonicalPrice: kis,
      canonicalSource: 'KIS',
      kisPrice,
      yahooPrice,
      discrepancyPct,
      reasons,
      allowTechnicalIndicators: true,
      allowExecution: true, // 매수 허용 (KIS canonical 신뢰)
    };
  }

  if (discrepancyPct <= PRICE_SOURCE_THRESHOLDS.DISCREPANCY_INVALID_PCT) {
    reasons.push(`PRICE_INVALID: ${reasonStr} — Yahoo 사용 금지`);
    return {
      status: 'INVALID',
      canonicalPrice: kis,
      canonicalSource: 'KIS',
      kisPrice,
      yahooPrice,
      discrepancyPct,
      reasons,
      allowTechnicalIndicators: true,
      allowExecution: false, // 매수 차단 — 데이터 오염 의심
    };
  }

  // 30%+ 괴리 → CORPORATE_ACTION_SUSPECT
  const isHardQuarantine =
    discrepancyPct > PRICE_SOURCE_THRESHOLDS.DISCREPANCY_CORPORATE_ACTION_PCT;
  reasons.push(
    `CORPORATE_ACTION_SUSPECT: ${reasonStr} — ${isHardQuarantine ? 'HARD_QUARANTINE (50%+)' : '액면분할/병합/권리락 의심'}`,
  );
  return {
    status: 'CORPORATE_ACTION_SUSPECT',
    canonicalPrice: kis,
    canonicalSource: 'KIS',
    kisPrice,
    yahooPrice,
    discrepancyPct,
    reasons,
    allowTechnicalIndicators: !isHardQuarantine, // hard 는 기술지표도 차단
    allowExecution: false, // 항상 매수 차단
  };
}

/**
 * 사용자 §3 Execution Rule 가드 SSOT.
 * 호출자가 매수 주문 생성 직전에 호출 — false 반환 시 DATA_INVALID 마커 부착 후 별도 격리.
 */
export function shouldAllowExecution(quality: DataQualityResult): boolean {
  return quality.allowExecution;
}

/**
 * 격리 분류 SSOT — DataQuarantine 카운터 입력.
 * VALID/WARN 은 격리 안 함, INVALID/CORPORATE_ACTION_SUSPECT/STALE/MISSING 은 격리.
 */
export function shouldQuarantine(status: DataQualityStatus): boolean {
  return status === 'INVALID' || status === 'CORPORATE_ACTION_SUSPECT' || status === 'STALE' || status === 'MISSING';
}
