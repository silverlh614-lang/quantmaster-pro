// @responsibility 자본 가중 슬롯 점유 측정 SSOT — 단순 카운트가 아닌 잔존비율 합산으로 슬롯 회계 산출.
/**
 * slotAccounting.ts — Capital-Weighted Slot Accounting (ADR-0080)
 *
 * 종목별 슬롯 점유 = getRemainingQty(shadow) / shadow.originalQuantity (0~1 clamp)
 * 총 점유 = sum(slotConsumed). 단순 카운트가 아닌 자본 가중 측정.
 *
 * 70% 익절 후 30% 잔존 포지션 5개 → 1.5 슬롯 점유 (기존 5 카운트 대신).
 * INTRADAY / PRE_BREAKOUT watchlistSource 는 회계 제외 (기존 정책 보존).
 *
 * ENV 롤백: SLOT_CAPITAL_WEIGHTED_DISABLED=true → consumed = rawCount (단순 카운트 강제).
 */

import { getRemainingQty, type ServerShadowTrade } from '../persistence/shadowTradeRepo.js';
import { isOpenShadowStatus } from './entryEngine.js';

export interface SlotDetail {
  stockCode: string;
  stockName: string;
  remainingQty: number;
  originalQty: number;
  consumed: number; // 0~1 clamp
}

export interface SlotConsumptionResult {
  /** 자본 가중 점유 합계 (소수). isFull 비교 분자. */
  consumed: number;
  /** 기존 단순 카운트 (회귀 검증/로그 비교용). */
  rawCount: number;
  /** effectiveMaxPositions − consumed (음수 가능 → 0 floor). */
  available: number;
  /** consumed >= effectiveMaxPositions (POSITION_FULL 트리거 조건). */
  isFull: boolean;
  /** 종목별 분해 (디버깅/진단 로그용). */
  detail: SlotDetail[];
}

/**
 * Shadow trade 배열로부터 자본 가중 슬롯 점유 산출 (ADR-0080).
 *
 * @param shadows 전체 shadow trade 배열
 * @param effectiveMaxPositions 최대 동시 보유 종목 한도 (POSITION_FULL 분모)
 * @returns SlotConsumptionResult — consumed/rawCount/available/isFull/detail
 */
export function computeSlotConsumption(
  shadows: ServerShadowTrade[],
  effectiveMaxPositions: number,
): SlotConsumptionResult {
  // INTRADAY/PRE_BREAKOUT 제외 + open status 만 회계 대상 (기존 정책 보존)
  const eligible = shadows.filter(
    (s) => isOpenShadowStatus(s.status) &&
           s.watchlistSource !== 'INTRADAY' &&
           s.watchlistSource !== 'PRE_BREAKOUT',
  );

  const rawCount = eligible.length;
  const disabled = process.env.SLOT_CAPITAL_WEIGHTED_DISABLED === 'true';

  const detail: SlotDetail[] = eligible.map((s) => {
    const remainingQty = getRemainingQty(s);
    const originalQty = s.originalQuantity && s.originalQuantity > 0
      ? s.originalQuantity
      : s.quantity > 0 ? s.quantity : 0;

    let consumed: number;
    if (disabled) {
      consumed = 1.0; // 단순 카운트 강제
    } else if (originalQty <= 0) {
      consumed = 1.0; // 레거시 trade 보수적 (분모 부재 → 만재 가정)
    } else {
      const ratio = remainingQty / originalQty;
      // NaN/Infinity/음수 안전 fallback → 1.0 보수적
      consumed = Number.isFinite(ratio) && ratio > 0 ? Math.min(1, ratio) : 1.0;
    }

    return {
      stockCode: s.stockCode,
      stockName: s.stockName,
      remainingQty,
      originalQty,
      consumed,
    };
  });

  const consumed = detail.reduce((sum, d) => sum + d.consumed, 0);
  const available = Math.max(0, effectiveMaxPositions - consumed);
  const isFull = consumed >= effectiveMaxPositions;

  return { consumed, rawCount, available, isFull, detail };
}
