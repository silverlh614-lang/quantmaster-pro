/**
 * @responsibility Price Correction Engine — Scan-Local Overlay 보정 SSOT
 *
 * ADR-0414 — Stage 1 Read-Only Mode. **이번 PR 에서 corrected 값을 LIVE 매수 판단에 사용 금지**.
 *
 * 사용자 명시 절대 원칙 (10종):
 *   1. 원본 quote / daily / master 데이터 절대 덮어쓰기 금지 (persistence 무수정).
 *   2. correction 결과는 *scan-local overlay 또는 read-only comparison* 만.
 *   3. corrected 값 LIVE 매수 판단 사용 금지.
 *   4. original + corrected 동시 계산 + 차이 기록.
 *   5. correctionType / confidence / lineage / reasons 모두 영속.
 *   6. **gap 기준일 불일치 시 gapPct 계산 금지** (DROP_GAP_CALCULATION 명시 지원).
 *   7. correction 실패 시 SHADOW_ONLY 분류만.
 *   8. correction 자체가 새로운 단일 장애점 되지 않도록 health metric 기록.
 *   9. LIVE 주문 함수 / KIS 주문 함수 / order executor 수정 금지.
 *  10. 외부 API 직접 호출 금지 — 이미 수집된 데이터만 사용.
 *
 * 외부 의존성: 0 (KIS/Yahoo/외부 API 호출 0건 — 정적 가드 ADR-0414 §22~30).
 *
 * 호출자: 본 PR 0건 (Stage 1 dead code 의도 — Stage 2/3 후속 PR wiring).
 */

import type { PriceIntegrityResult, PriceIntegrityStatus } from './priceIntegrityChecker.js';
import {
  buildPriceCorrectionLineage,
  type PriceCorrectionLineage,
  type PriceCorrectionLineageInput,
  type PriceSourceSnapshot,
} from './priceCorrectionLineage.js';

/**
 * Correction 타입 6 union (사용자 명시 §2 결정 트리 — 절대 변경 금지).
 *
 * | 타입                       | 의미 |
 * |----------------------------|------|
 * | `NONE`                     | 보정 불필요 (Integrity OK) |
 * | `USE_KIS_CURRENT`          | KIS 실시간 가격 채택 |
 * | `USE_KRX_PREV_CLOSE`       | KRX 공식 종가 채택 |
 * | `USE_RECENT_DAILY_CLOSE`   | 최근 일봉 close 채택 |
 * | `DROP_GAP_CALCULATION`     | gap 산출 자체 폐기 (기준일 mismatch) |
 * | `SHADOW_ONLY`              | 보정 불가 — Shadow learning 만 (FAILED) |
 */
export type PriceCorrectionType =
  | 'NONE'
  | 'USE_KIS_CURRENT'
  | 'USE_KRX_PREV_CLOSE'
  | 'USE_RECENT_DAILY_CLOSE'
  | 'DROP_GAP_CALCULATION'
  | 'SHADOW_ONLY';

/**
 * confidence 산출 가중치 SSOT (사용자 명시 §3 — 절대 변경 금지).
 *
 * confidence = clamp(sourceWeight × dateAlignmentWeight × crossSourceAgreementWeight, 0, 1)
 */
export const PRICE_CORRECTION_SOURCE_WEIGHT = {
  KIS: 1.0,
  KRX: 0.9,
  YAHOO: 0.7,
  RECENT_DAILY: 0.6,
  CACHE: 0.4,
  UNKNOWN: 0.2,
} as const;

export const PRICE_CORRECTION_DATE_ALIGNMENT_WEIGHT = {
  MATCH: 1.0,
  T_MINUS_1: 0.8,
  T_MINUS_2: 0.5,
  STALE: 0.2,
  UNKNOWN: 0.2,
} as const;

export const PRICE_CORRECTION_CROSS_SOURCE_AGREEMENT_WEIGHT = {
  THREE_SOURCES: 1.0,
  TWO_SOURCES: 0.8,
  SINGLE_SOURCE: 0.5,
  CONFLICT: 0.2,
} as const;

/**
 * 임계 상수 SSOT — Stage 2/3 후속 PR 사용.
 *
 * **본 PR (Stage 1) 에서 LIVE threshold 실제 매수 판단 사용 금지** (절대 원칙 #3).
 */
export const PRICE_CORRECTION_LIVE_THRESHOLD = 0.8;
export const PRICE_CORRECTION_SHADOW_THRESHOLD = 0.5;

export type PriceCorrectionSourceLabel =
  | 'KIS'
  | 'KRX'
  | 'YAHOO'
  | 'RECENT_DAILY'
  | 'CACHE'
  | 'UNKNOWN';

export type PriceCorrectionDateAlignmentLabel =
  | 'MATCH'
  | 'T_MINUS_1'
  | 'T_MINUS_2'
  | 'STALE'
  | 'UNKNOWN';

export type PriceCorrectionCrossSourceAgreementLabel =
  | 'THREE_SOURCES'
  | 'TWO_SOURCES'
  | 'SINGLE_SOURCE'
  | 'CONFLICT';

export interface PriceCorrectionInput {
  /** PriceIntegrityChecker 결과 (의무) */
  integrity: PriceIntegrityResult;
  /** 다중 출처 스냅샷 (옵셔널) — Yahoo 가 fallback baseline. */
  yahoo?: PriceSourceSnapshot;
  kis?: PriceSourceSnapshot;
  krx?: PriceSourceSnapshot;
  recentDailyClose?: { close?: number | null; date?: string | null };
  /** lineage 영속 시각 주입 (테스트 deterministic) */
  now?: Date;
}

export interface PriceCorrectionResult {
  symbol: string;
  correctionType: PriceCorrectionType;
  /** 보정된 현재가 — null = 보정 미적용 또는 DROP */
  correctedPrice: number | null;
  /** 보정된 전일 종가 — null = 보정 미적용 또는 DROP */
  correctedPreviousClose: number | null;
  /** 보정된 gap% — DROP_GAP_CALCULATION 시 항상 null */
  correctedGapPct: number | null;
  /** gap 산출 기준일 — null = gap 미사용 (DROP) */
  gapBasisDate: string | null;
  /** 0~1 — Stage 2/3 임계 비교 입력 */
  confidence: number;
  reasons: string[];
  /** Stage 3 LIVE 사용 가능 여부 — Stage 1 본 PR 에서 항상 false 강제 (절대 원칙 #3) */
  usableForLiveEntry: boolean;
  /** Stage 2 Shadow 사용 가능 여부 */
  usableForShadow: boolean;
  /** 결정 추적성 — 사후 검증 입력 */
  lineage: PriceCorrectionLineage;
}

/**
 * ENV `PRICE_CORRECTION_DISABLED` 우회 SSOT — ADR-0157 정확 비교 의무.
 *
 * default OFF (=> default 정책 적용 = correction 실행).
 * `=true` 시 PriceCorrectionEngine 실행 *생략* + corrected overlay 미생성.
 * PriceIntegrityChecker 는 *계속 실행* (분리 정책).
 */
export function isPriceCorrectionDisabled(): boolean {
  return process.env.PRICE_CORRECTION_DISABLED === 'true';
}

/**
 * 출처 그룹별 score weight 집계 — 다중 출처 cross-source agreement 분류.
 *
 * 입력 출처 개수 (sourceCount) 와 가격 일치도 (priceAgreement) 기반.
 */
function classifyCrossSourceAgreement(
  sourceCount: number,
  priceAgreement: 'AGREE' | 'CONFLICT' | 'UNKNOWN',
): PriceCorrectionCrossSourceAgreementLabel {
  if (priceAgreement === 'CONFLICT') return 'CONFLICT';
  if (sourceCount >= 3) return 'THREE_SOURCES';
  if (sourceCount === 2) return 'TWO_SOURCES';
  return 'SINGLE_SOURCE';
}

/**
 * 두 출처의 currentPrice 비교 — 5% 이상 차이 시 CONFLICT.
 */
function detectPriceConflict(prices: ReadonlyArray<number | null | undefined>): boolean {
  const valid = prices.filter(
    (p): p is number => typeof p === 'number' && Number.isFinite(p) && p > 0,
  );
  if (valid.length < 2) return false;
  const max = Math.max(...valid);
  const min = Math.min(...valid);
  if (min <= 0) return false;
  return (max - min) / min > 0.05; // 5% 차이 → CONFLICT
}

/**
 * confidence 산출 SSOT — ADR-0414 §3 (사용자 명시 절대 변경 금지).
 *
 * confidence = clamp(sourceWeight × dateAlignmentWeight × crossSourceAgreementWeight, 0, 1)
 */
export function computeCorrectionConfidence(
  source: PriceCorrectionSourceLabel,
  dateAlignment: PriceCorrectionDateAlignmentLabel,
  crossSourceAgreement: PriceCorrectionCrossSourceAgreementLabel,
): number {
  const sw = PRICE_CORRECTION_SOURCE_WEIGHT[source] ?? PRICE_CORRECTION_SOURCE_WEIGHT.UNKNOWN;
  const dw =
    PRICE_CORRECTION_DATE_ALIGNMENT_WEIGHT[dateAlignment] ??
    PRICE_CORRECTION_DATE_ALIGNMENT_WEIGHT.UNKNOWN;
  const cw =
    PRICE_CORRECTION_CROSS_SOURCE_AGREEMENT_WEIGHT[crossSourceAgreement] ??
    PRICE_CORRECTION_CROSS_SOURCE_AGREEMENT_WEIGHT.SINGLE_SOURCE;
  const raw = sw * dw * cw;
  if (!Number.isFinite(raw)) return 0;
  return Math.max(0, Math.min(1, raw));
}

function isPositive(v: unknown): v is number {
  return typeof v === 'number' && Number.isFinite(v) && v > 0;
}

function gapPctFromPrices(current: number, previousClose: number): number {
  return ((current - previousClose) / previousClose) * 100;
}

/**
 * 결정 트리 헬퍼 — Yahoo stale + KIS 정상.
 *
 * 조건: integrity.status ∈ {STALE, FROZEN_QUOTE} AND yahoo currentPrice 있음 AND
 * kis.current 가용 (양수).
 */
function shouldUseKisCurrent(input: PriceCorrectionInput): boolean {
  const { integrity, kis } = input;
  if (!isPositive(kis?.current)) return false;
  return integrity.status === 'STALE' || integrity.status === 'FROZEN_QUOTE';
}

/**
 * 결정 트리 헬퍼 — previousCloseDate 기준일 mismatch + KRX prevClose 가용.
 *
 * 조건: integrity.status === 'PRICE_BASE_MISMATCH' AND krx.previousClose 가용.
 */
function shouldUseKrxPrevClose(input: PriceCorrectionInput): boolean {
  const { integrity, krx } = input;
  if (!isPositive(krx?.previousClose)) return false;
  return integrity.status === 'PRICE_BASE_MISMATCH';
}

/**
 * 결정 트리 헬퍼 — recentDailyClose 가용 + 다른 출처 부재.
 */
function shouldUseRecentDailyClose(input: PriceCorrectionInput): boolean {
  const { recentDailyClose, kis, krx } = input;
  if (!isPositive(recentDailyClose?.close)) return false;
  // KIS / KRX previousClose 가 가용하면 USE_KIS_CURRENT / USE_KRX_PREV_CLOSE 우선
  const hasKisPrev = isPositive(kis?.previousClose);
  const hasKrxPrev = isPositive(krx?.previousClose);
  return !hasKisPrev && !hasKrxPrev;
}

/**
 * 결정 트리 헬퍼 — DROP_GAP_CALCULATION.
 *
 * 조건:
 *   - reverse gap (REVERSE_GAP_SUSPECT) + cross-source CONFLICT
 *   - 또는 previousClose 보정 실패 (PRICE_BASE_MISMATCH 인데 KRX 도 부재)
 */
function shouldDropGapCalculation(
  input: PriceCorrectionInput,
  hasConflict: boolean,
): boolean {
  const { integrity, krx } = input;
  if (
    integrity.status === 'REVERSE_GAP_SUSPECT' &&
    hasConflict
  ) {
    return true;
  }
  // PRICE_BASE_MISMATCH + KRX prevClose 부재 → 보정 자체 실패
  if (integrity.status === 'PRICE_BASE_MISMATCH' && !isPositive(krx?.previousClose)) {
    return true;
  }
  return false;
}

/**
 * 출처 라벨 결정 — 우선순위 SSOT.
 */
function pickPrimarySource(
  correctionType: PriceCorrectionType,
): PriceCorrectionSourceLabel {
  switch (correctionType) {
    case 'USE_KIS_CURRENT':
      return 'KIS';
    case 'USE_KRX_PREV_CLOSE':
      return 'KRX';
    case 'USE_RECENT_DAILY_CLOSE':
      return 'RECENT_DAILY';
    case 'DROP_GAP_CALCULATION':
    case 'SHADOW_ONLY':
      return 'UNKNOWN';
    case 'NONE':
    default:
      return 'YAHOO';
  }
}

/**
 * Integrity dateAlignment → correction dateAlignmentWeight 라벨 매핑.
 */
function mapDateAlignment(
  align: PriceIntegrityResult['dateAlignment'],
): PriceCorrectionDateAlignmentLabel {
  return align;
}

/**
 * 다중 출처 개수 카운트 — confidence 산출 입력.
 */
function countSources(input: PriceCorrectionInput): number {
  let n = 0;
  if (input.yahoo && (isPositive(input.yahoo.current) || isPositive(input.yahoo.previousClose))) n++;
  if (input.kis && (isPositive(input.kis.current) || isPositive(input.kis.previousClose))) n++;
  if (input.krx && (isPositive(input.krx.previousClose))) n++;
  if (input.recentDailyClose && isPositive(input.recentDailyClose.close)) n++;
  return n;
}

/**
 * Price Correction 평가 SSOT — ADR-0414 §2 결정 트리 (사용자 명시 절대 변경 금지).
 *
 * 우선순위 분기:
 *   1. ENV `PRICE_CORRECTION_DISABLED=true` → NONE (engine 자체 skip 호출자 책임)
 *   2. integrity.status === 'OK' → NONE
 *   3. integrity.status === 'FAILED' → SHADOW_ONLY
 *   4. shouldDropGapCalculation → DROP_GAP_CALCULATION
 *   5. shouldUseKisCurrent → USE_KIS_CURRENT
 *   6. shouldUseKrxPrevClose → USE_KRX_PREV_CLOSE
 *   7. shouldUseRecentDailyClose → USE_RECENT_DAILY_CLOSE
 *   8. 그 외 → NONE
 *
 * **본 PR (Stage 1) 에서 LIVE entry 사용 금지 — `usableForLiveEntry=false` 항상 강제** (절대 원칙 #3).
 *
 * 외부 부작용 0 — 영속 무관 read-only. input 객체 mutate 0건 (절대 원칙 #1).
 */
export function evaluatePriceCorrection(input: PriceCorrectionInput): PriceCorrectionResult {
  const { integrity } = input;
  const decisionTrace: string[] = [];
  const reasons: string[] = [];

  const symbol = integrity.symbol;
  const now = input.now ?? new Date();

  // 다중 출처 일치도 평가 (NaN/Infinity 안전)
  const currentPrices = [input.yahoo?.current, input.kis?.current];
  const hasConflict = detectPriceConflict(currentPrices);
  const sourceCount = countSources(input);
  const priceAgreement: 'AGREE' | 'CONFLICT' | 'UNKNOWN' = hasConflict
    ? 'CONFLICT'
    : sourceCount >= 2
      ? 'AGREE'
      : 'UNKNOWN';
  const crossSourceAgreement = classifyCrossSourceAgreement(sourceCount, priceAgreement);

  decisionTrace.push(
    `integrity.status=${integrity.status} dateAlignment=${integrity.dateAlignment} sourceCount=${sourceCount} priceAgreement=${priceAgreement}`,
  );

  // 결정 트리
  let correctionType: PriceCorrectionType = 'NONE';
  let correctedPrice: number | null = null;
  let correctedPreviousClose: number | null = null;
  let correctedGapPct: number | null = null;
  let gapBasisDate: string | null = null;

  if (integrity.status === 'OK') {
    correctionType = 'NONE';
    decisionTrace.push('NONE — integrity OK, 보정 불필요');
    reasons.push('NONE — integrity OK');
  } else if (integrity.status === 'FAILED') {
    correctionType = 'SHADOW_ONLY';
    decisionTrace.push('SHADOW_ONLY — integrity FAILED, 보정 불가');
    reasons.push('SHADOW_ONLY — integrity FAILED');
  } else if (shouldDropGapCalculation(input, hasConflict)) {
    correctionType = 'DROP_GAP_CALCULATION';
    decisionTrace.push(
      `DROP_GAP_CALCULATION — ${integrity.status === 'REVERSE_GAP_SUSPECT' ? 'reverse gap + cross-source conflict' : 'previousClose 보정 실패'}`,
    );
    reasons.push(
      'DROP_GAP_CALCULATION — 사용자 명시 정책: 틀린 gap 계산보다 gap 미사용 우월',
    );
    // DROP 정책: correctedGapPct=null, gapBasisDate=null
  } else if (shouldUseKisCurrent(input)) {
    correctionType = 'USE_KIS_CURRENT';
    correctedPrice = input.kis!.current as number;
    // previousClose 는 KIS 가 있으면 KIS, 없으면 Yahoo previousClose 유지
    if (isPositive(input.kis?.previousClose)) {
      correctedPreviousClose = input.kis!.previousClose as number;
      gapBasisDate =
        input.kis!.previousCloseDate ?? integrity.daysFromLastTradingDay !== null
          ? input.kis!.previousCloseDate ?? null
          : null;
    } else if (isPositive(input.yahoo?.previousClose)) {
      correctedPreviousClose = input.yahoo!.previousClose as number;
      gapBasisDate = input.yahoo!.previousCloseDate ?? null;
    }
    if (correctedPrice !== null && correctedPreviousClose !== null) {
      correctedGapPct = gapPctFromPrices(correctedPrice, correctedPreviousClose);
    }
    decisionTrace.push(
      `USE_KIS_CURRENT — KIS current=${correctedPrice} prev=${correctedPreviousClose ?? 'n/a'}`,
    );
    reasons.push('USE_KIS_CURRENT — Yahoo stale + KIS 정상');
  } else if (shouldUseKrxPrevClose(input)) {
    correctionType = 'USE_KRX_PREV_CLOSE';
    correctedPreviousClose = input.krx!.previousClose as number;
    gapBasisDate = input.krx!.previousCloseDate ?? null;
    // currentPrice 는 Yahoo / KIS 우선 (KIS 가 있으면 KIS)
    if (isPositive(input.kis?.current)) {
      correctedPrice = input.kis!.current as number;
    } else if (isPositive(input.yahoo?.current)) {
      correctedPrice = input.yahoo!.current as number;
    }
    if (correctedPrice !== null && correctedPreviousClose !== null) {
      correctedGapPct = gapPctFromPrices(correctedPrice, correctedPreviousClose);
    }
    decisionTrace.push(
      `USE_KRX_PREV_CLOSE — KRX prev=${correctedPreviousClose} basisDate=${gapBasisDate ?? 'n/a'}`,
    );
    reasons.push('USE_KRX_PREV_CLOSE — previousClose 기준일 mismatch → KRX 공식 종가');
  } else if (shouldUseRecentDailyClose(input)) {
    correctionType = 'USE_RECENT_DAILY_CLOSE';
    correctedPreviousClose = input.recentDailyClose!.close as number;
    gapBasisDate = input.recentDailyClose!.date ?? null;
    if (isPositive(input.kis?.current)) {
      correctedPrice = input.kis!.current as number;
    } else if (isPositive(input.yahoo?.current)) {
      correctedPrice = input.yahoo!.current as number;
    }
    if (correctedPrice !== null && correctedPreviousClose !== null) {
      correctedGapPct = gapPctFromPrices(correctedPrice, correctedPreviousClose);
    }
    decisionTrace.push(
      `USE_RECENT_DAILY_CLOSE — 다른 출처 부재, 최근 일봉 close=${correctedPreviousClose}`,
    );
    reasons.push('USE_RECENT_DAILY_CLOSE — 3차 fallback');
  } else {
    correctionType = 'NONE';
    decisionTrace.push(`NONE — 결정 트리 매칭 없음 (status=${integrity.status})`);
    reasons.push(`NONE — 보정 분기 매칭 없음 (status=${integrity.status})`);
  }

  // confidence 산출
  const primarySource = pickPrimarySource(correctionType);
  const confidence = computeCorrectionConfidence(
    primarySource,
    mapDateAlignment(integrity.dateAlignment),
    crossSourceAgreement,
  );

  // Stage 1 — usableForLiveEntry 항상 false (절대 원칙 #3)
  const usableForLiveEntry = false;
  // usableForShadow — DROP_GAP_CALCULATION 은 명시적 true (gap 미사용 + 현재가 보정만)
  // SHADOW_ONLY 는 true / 그 외 confidence ≥ shadow threshold
  let usableForShadow = false;
  if (correctionType === 'SHADOW_ONLY' || correctionType === 'DROP_GAP_CALCULATION') {
    usableForShadow = true;
  } else if (correctionType === 'NONE') {
    usableForShadow = false;
  } else {
    usableForShadow = confidence >= PRICE_CORRECTION_SHADOW_THRESHOLD;
  }

  decisionTrace.push(
    `confidence=${confidence.toFixed(3)} primarySource=${primarySource} dateAlign=${integrity.dateAlignment} crossSrc=${crossSourceAgreement}`,
  );
  decisionTrace.push(
    `Stage 1 Read-Only — usableForLiveEntry=false (절대 원칙 #3) usableForShadow=${usableForShadow}`,
  );

  const lineageInput: PriceCorrectionLineageInput = {
    yahoo: input.yahoo ? { ...input.yahoo } : undefined,
    kis: input.kis ? { ...input.kis } : undefined,
    krx: input.krx ? { ...input.krx } : undefined,
    recentDailyClose: input.recentDailyClose ? { ...input.recentDailyClose } : undefined,
  };
  const lineage = buildPriceCorrectionLineage(
    lineageInput,
    decisionTrace,
    correctionType,
    confidence,
    now,
  );

  return {
    symbol,
    correctionType,
    correctedPrice,
    correctedPreviousClose,
    correctedGapPct,
    gapBasisDate,
    confidence,
    reasons,
    usableForLiveEntry,
    usableForShadow,
    lineage,
  };
}

/**
 * 미평가 (skip) 결과 — ENV `PRICE_CORRECTION_DISABLED=true` 시 호출자가 합성.
 */
export function buildSkippedCorrectionResult(
  symbol: string,
  now: Date = new Date(),
): PriceCorrectionResult {
  const lineage = buildPriceCorrectionLineage(
    {},
    ['SKIPPED — ENV PRICE_CORRECTION_DISABLED=true'],
    'NONE',
    0,
    now,
  );
  return {
    symbol,
    correctionType: 'NONE',
    correctedPrice: null,
    correctedPreviousClose: null,
    correctedGapPct: null,
    gapBasisDate: null,
    confidence: 0,
    reasons: ['SKIPPED — ENV PRICE_CORRECTION_DISABLED=true'],
    usableForLiveEntry: false,
    usableForShadow: false,
    lineage,
  };
}
