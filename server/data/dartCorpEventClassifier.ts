// @responsibility ADR-0128 DART 공시 corporate action 이벤트 분류 + lookback 차등 SSOT
/**
 * dartCorpEventClassifier.ts (ADR-0128 정책 #5).
 *
 * DART `report_nm` 텍스트 기반 corporate action event 분류 + 이벤트 타입별 lookback
 * window 차등. 사용자 명시: "분할/병합/유증 이벤트는 30~90일 lookback, 그 외 7일".
 *
 * **한국어 키워드 휴리스틱** — false positive 가능 (ENV 우회로 즉시 무력화).
 *
 * ENV `DART_CORP_EVENT_LOOKBACK_DISABLED=true` → 모든 이벤트 default 7일 (분류 결과
 * 무시, getCorpEventLookback 이 GENERAL=7 반환).
 */

/** corporate action 이벤트 5분류 (분할 / 병합 / 권리락 / 신주발행 / 일반). */
export type DartCorpEventType =
  | 'STOCK_SPLIT'
  | 'STOCK_MERGE'
  | 'RIGHTS_OFFERING'
  | 'NEW_SHARES'
  | 'GENERAL';

/**
 * 이벤트 타입별 lookback window (일). 사용자 정책 #5 직접 SSOT:
 *   - STOCK_SPLIT 90일 (분할은 가격 조정이 늦게 반영 가능)
 *   - STOCK_MERGE 60일
 *   - RIGHTS_OFFERING 30일 (권리락 후 가격 자동 조정)
 *   - NEW_SHARES 14일 (수량 변경 영향)
 *   - GENERAL 7일 (default)
 */
export const CORP_EVENT_LOOKBACK_DAYS: Record<DartCorpEventType, number> = {
  STOCK_SPLIT: 90,
  STOCK_MERGE: 60,
  RIGHTS_OFFERING: 30,
  NEW_SHARES: 14,
  GENERAL: 7,
};

export interface DartCorpEventLookback {
  eventType: DartCorpEventType;
  lookbackDays: number;
}

/** ENV 우회 — true 시 모든 이벤트 GENERAL=7 (분류 결과 무시). */
export function isDartCorpEventLookbackDisabled(): boolean {
  return process.env.DART_CORP_EVENT_LOOKBACK_DISABLED === 'true';
}

/**
 * DART report_nm → 이벤트 타입 분류 SSOT.
 *
 * 분류 규칙 (한국어 키워드, 우선순위 순):
 *   1. '액면분할' | '주식분할' | 'split' → STOCK_SPLIT
 *   2. '액면병합' | '주식병합' | 'merge' → STOCK_MERGE
 *   3. '유상증자' | '신주인수권' | '권리락' → RIGHTS_OFFERING
 *   4. '신주발행' | '주식배당' → NEW_SHARES
 *   5. 그 외 → GENERAL
 *
 * 빈 입력 / null / undefined → GENERAL (안전 default).
 * 대소문자 무관 (영문 키워드 'split'/'merge' 도 검출).
 */
export function classifyDartCorpEvent(reportNm: string | null | undefined): DartCorpEventType {
  if (!reportNm || typeof reportNm !== 'string') return 'GENERAL';
  const trimmed = reportNm.trim();
  if (trimmed.length === 0) return 'GENERAL';

  // 영문 키워드는 대소문자 무관 검출 — 한국어 키워드는 그대로 contains.
  const lower = trimmed.toLowerCase();

  // 우선순위 순 — 분할 → 병합 → 권리락 → 신주 → 일반
  if (
    trimmed.includes('액면분할')
    || trimmed.includes('주식분할')
    || lower.includes('split')
  ) {
    return 'STOCK_SPLIT';
  }
  if (
    trimmed.includes('액면병합')
    || trimmed.includes('주식병합')
    || lower.includes('merge')
  ) {
    return 'STOCK_MERGE';
  }
  if (
    trimmed.includes('유상증자')
    || trimmed.includes('신주인수권')
    || trimmed.includes('권리락')
  ) {
    return 'RIGHTS_OFFERING';
  }
  if (
    trimmed.includes('신주발행')
    || trimmed.includes('주식배당')
  ) {
    return 'NEW_SHARES';
  }
  return 'GENERAL';
}

/**
 * report_nm → {eventType, lookbackDays} 직접 산출.
 * ENV 우회 시 → GENERAL=7 통일.
 */
export function getCorpEventLookback(reportNm: string | null | undefined): DartCorpEventLookback {
  if (isDartCorpEventLookbackDisabled()) {
    return { eventType: 'GENERAL', lookbackDays: CORP_EVENT_LOOKBACK_DAYS.GENERAL };
  }
  const eventType = classifyDartCorpEvent(reportNm);
  return { eventType, lookbackDays: CORP_EVENT_LOOKBACK_DAYS[eventType] };
}
