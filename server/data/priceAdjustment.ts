// @responsibility entryPrice RAW/ADJUSTED 변환 SSOT — 분할/병합 보정 단일 진실
/**
 * priceAdjustment.ts (ADR-0116) — RAW immutable + ADJUSTED 파생 SSOT.
 *
 * 사용자 18단계 설계안 §1 "RAW PRICE 절대 수정 금지" + §3 "Adjusted = raw / factor"
 * 직접 반영. Corporate Action Ledger (P3 후속 PR) 가 cumulativeFactor 를 채우기
 * 전까지 factor=1.0 default → adjusted == raw identity. 본 모듈은 헬퍼만 제공 —
 * factor 산출은 호출자 책임.
 *
 * 우선순위:
 *   - getEntryPriceRawForRecord: entryPriceRaw → shadowEntryPrice → signalPrice → 0
 *   - getEntryPriceAdjusted: rawPrice / factor (NaN/0/음수 → 1.0 fallback)
 *   - getEntryPriceForDisplay: UI/리포트용 — adjusted 우선
 *
 * 본 PR scope:
 *   - 헬퍼 + 테스트만. 호출자 wiring 은 후속 PR 점진.
 */

/**
 * RAW + factor 입력에서 ADJUSTED 가격 산출.
 *
 * - factor 부재 / NaN / Infinity / ≤0 → 1.0 fallback (RAW identity)
 * - rawPrice NaN / Infinity / ≤0 → 0 안전 fallback (호출자가 .valid 체크 권장)
 *
 * 분할 시나리오: 1주 → 2주 → factor=2 → adjusted = raw / 2 (가격 절반).
 * 병합 시나리오: 2주 → 1주 → factor=0.5 → adjusted = raw / 0.5 = raw × 2.
 */
export function getAdjustedPrice(rawPrice: number, factor?: number): number {
  if (!Number.isFinite(rawPrice) || rawPrice <= 0) return 0;
  if (factor === undefined || !Number.isFinite(factor) || factor <= 0) {
    return rawPrice;
  }
  const adjusted = rawPrice / factor;
  return Number.isFinite(adjusted) ? adjusted : 0;
}

/**
 * ServerShadowTrade-like 객체에서 RAW 가격을 추출.
 * 우선순위: entryPriceRaw → shadowEntryPrice → signalPrice → 0.
 *
 * 후방호환: 신규 trade 는 entryPriceRaw 영속 (buildBuyTrade), 레거시 trade 는
 * shadowEntryPrice / signalPrice 폴백.
 */
export function getEntryPriceRawForRecord(trade: {
  entryPriceRaw?: number;
  shadowEntryPrice?: number;
  signalPrice?: number;
}): number {
  const candidates = [
    trade.entryPriceRaw,
    trade.shadowEntryPrice,
    trade.signalPrice,
  ];
  for (const c of candidates) {
    if (typeof c === 'number' && Number.isFinite(c) && c > 0) return c;
  }
  return 0;
}

/**
 * ADJUSTED 가격 산출 — RAW 추출 후 factor 적용.
 * 본 PR 단계: factor 부재 (모든 trade) → adjusted == raw identity.
 * P3 후속 PR 에서 cumulativeAdjustmentFactor 영속 후 분할 보정 자동 적용.
 */
export function getEntryPriceAdjusted(trade: {
  entryPriceRaw?: number;
  shadowEntryPrice?: number;
  signalPrice?: number;
  cumulativeAdjustmentFactor?: number;
}): number {
  const rawPrice = getEntryPriceRawForRecord(trade);
  return getAdjustedPrice(rawPrice, trade.cumulativeAdjustmentFactor);
}

/**
 * UI/리포트용 표시 가격 — 분할 보정 후 가격 우선.
 * 사용자가 보는 "현재 의미 있는 entryPrice" 는 ADJUSTED.
 */
export function getEntryPriceForDisplay(trade: {
  entryPriceRaw?: number;
  shadowEntryPrice?: number;
  signalPrice?: number;
  cumulativeAdjustmentFactor?: number;
}): number {
  return getEntryPriceAdjusted(trade);
}

/** 임계값 SSOT export — 호출자 테스트용. */
export const PRICE_ADJUSTMENT_DEFAULT_FACTOR = 1.0;
