/**
 * @responsibility ADR-0167 currentEquityExposure 정확 산출 SSOT — 활성 trade 평가금액 합산 진입점
 *
 * ADR-0166 §2.5 명시 "단순 추정 (totalAssets - orderableCash). 정확한 계산은 후속 PR 분리".
 * 본 SSOT 가 그 후속 — 활성 trade (PENDING/ACTIVE) 만 합산하여 정확한 노출 산출.
 *
 * 정확도 단계:
 * 1. 본 PR (보유원가 기반): `shadowEntryPrice × getRemainingQty(trade)` 합산
 * 2. 후속 PR (시가 평가): `currentPriceMap[code] × qty` (KIS 호출 의존, 별도 ADR)
 *
 * 단순 추정 (`totalAssets - orderableCash`) 대비 개선:
 * - closed trade (HIT_STOP/HIT_TARGET 등) 자동 제외
 * - SHADOW 가상 자본 정확 반영
 * - 부재 종목 보수적 fallback (보유원가)
 */

import { isOpenShadowStatus } from '../entryEngine.js';
import { getRemainingQty, type ServerShadowTrade } from '../../persistence/shadowTradeRepo.js';

// ─── ENV 우회 SSOT ──────────────────────────────────────────────────────────

/**
 * ADR-0167 정확 산출 활성화 ENV.
 * default OFF — 운영자 명시 활성화 의무 (ADR-0166 ENV 와 별도, 단계별 검증 의도).
 *
 * 활성화 조건: ADR-0166 SHADOW EXPOSURE BUDGET 활성 + 1~2주 단순 추정 결과 분석 후
 * 정확 산출 차이 검증 시 운영자 결정.
 */
export function isAccurateExposureEnabled(): boolean {
  return process.env.POSITION_SIZING_ACCURATE_EXPOSURE_ENABLED === 'true';
}

// ─── 정확 산출 SSOT ─────────────────────────────────────────────────────────

export interface CurrentEquityExposureInput {
  shadows: ServerShadowTrade[];
  /** 옵셔널 시가 매핑 — 부재 시 trade.shadowEntryPrice fallback (보유원가 평가, 보수적) */
  currentPriceMap?: Map<string, number>;
}

export interface CurrentEquityExposureResult {
  /** 활성 trade 평가금액 합산 (KRW) */
  totalAmount: number;
  /** 합산에 포함된 활성 trade 수 */
  activeTradeCount: number;
  /** currentPriceMap 사용 여부 (true=시가 평가, false=보유원가 평가) */
  usedCurrentPrice: boolean;
}

/**
 * 활성 trade (PENDING/ACTIVE) 의 평가금액 합산.
 *
 * 가격 우선순위:
 * 1. `currentPriceMap[trade.stockCode]` (시가 평가, 가장 정확)
 * 2. `trade.shadowEntryPrice` (보유원가 평가, 보수적)
 *
 * NaN/0/음수 가격은 trade 자체 제외 (panic 차단).
 *
 * @returns 정확 산출 결과 + 진단 메타
 */
export function computeCurrentEquityExposure(input: CurrentEquityExposureInput): CurrentEquityExposureResult {
  const { shadows, currentPriceMap } = input;
  let totalAmount = 0;
  let activeTradeCount = 0;
  let usedCurrentPrice = false;

  for (const trade of shadows) {
    if (!isOpenShadowStatus(trade.status)) continue;

    const remainingQty = getRemainingQty(trade);
    if (!Number.isFinite(remainingQty) || remainingQty <= 0) continue;

    // 시가 평가 우선, fallback 보유원가
    const currentPrice = currentPriceMap?.get(trade.stockCode);
    const evalPrice = (currentPrice && Number.isFinite(currentPrice) && currentPrice > 0)
      ? currentPrice
      : trade.shadowEntryPrice;

    if (!Number.isFinite(evalPrice) || evalPrice <= 0) continue;

    if (currentPrice && currentPrice > 0) usedCurrentPrice = true;

    totalAmount += evalPrice * remainingQty;
    activeTradeCount++;
  }

  return {
    totalAmount,
    activeTradeCount,
    usedCurrentPrice,
  };
}

// ─── ADR-0166 wiring 통합 헬퍼 ──────────────────────────────────────────────

/**
 * `applyExposureBudgetCap` 호출자가 `currentEquityExposureAmount` 를 결정할 때 사용하는 단일 진입점.
 *
 * ENV `POSITION_SIZING_ACCURATE_EXPOSURE_ENABLED=true` 활성 시 정확 산출,
 * 그 외 ADR-0166 단순 추정 (`totalAssets - orderableCash`) 사용.
 *
 * @param totalAssets 계좌 총액
 * @param orderableCash 주문 가능 현금
 * @param shadows 활성 trade 영속 (ctx.shadows)
 * @returns currentEquityExposureAmount (정확 또는 추정)
 */
export function resolveCurrentEquityExposure(
  totalAssets: number,
  orderableCash: number,
  shadows: ServerShadowTrade[],
): number {
  if (!isAccurateExposureEnabled()) {
    // ADR-0166 §2.5 단순 추정 fallback
    return Math.max(0, totalAssets - orderableCash);
  }

  // ADR-0167 정확 산출
  const result = computeCurrentEquityExposure({ shadows });
  return result.totalAmount;
}
