// @responsibility PR-42 M1 부분매도 SELL fill attribution 자동 emit 헬퍼
/**
 * exitEngine/helpers/attribution.ts — emitPartialAttributionForSell (ADR-0028, PR-42 M1).
 *
 * 부분매도 SELL fill 1건이 reserveSell 에서 CONFIRMED 로 기록될 때 PR-19
 * attribution(qtyRatio 가중) 을 자동 emit 한다. 학습 baseline 이 없으면
 * emitPartialAttribution 자체가 null 반환 → 학습 오염 차단.
 *
 * 호출 조건(reserveSell 가 enforce):
 *   - isShadow=true (SHADOW 즉시 CONFIRMED 만, LIVE PROVISIONAL 은 후속 PR)
 *   - remainingQty > 0 (전량 청산은 FULL_CLOSE 경로에서 별도 처리)
 *   - fill.qty > 0
 */

import type { ServerShadowTrade, PositionFill } from '../../../persistence/shadowTradeRepo.js';
import { emitPartialAttribution } from '../../../persistence/attributionRepo.js';

type SellFillBase = Omit<PositionFill, 'id' | 'ordNo' | 'status' | 'confirmedAt' | 'revertedAt' | 'revertReason' | 'flagToClearOnRevert'>;

export interface EmitPartialAttributionInputForSell {
  shadow: ServerShadowTrade;
  fill: SellFillBase;
  remainingQty: number;
  newFillId: string | undefined;
  now: string;
}

export function emitPartialAttributionForSell(
  input: EmitPartialAttributionInputForSell,
): ReturnType<typeof emitPartialAttribution> {
  const { shadow, fill, remainingQty, newFillId, now } = input;
  if (remainingQty <= 0 || fill.qty <= 0 || !newFillId) return null;

  const baseQty = shadow.originalQuantity && shadow.originalQuantity > 0
    ? shadow.originalQuantity
    : fill.qty + remainingQty;
  if (baseQty <= 0) return null;

  const closedAt = fill.timestamp ?? now;
  const signalMs = new Date(shadow.signalTime).getTime();
  const closedMs = new Date(closedAt).getTime();
  const holdingDays = Number.isFinite(signalMs) && Number.isFinite(closedMs)
    ? Math.max(0, Math.floor((closedMs - signalMs) / 86_400_000))
    : 0;

  return emitPartialAttribution({
    tradeId:     shadow.id ?? shadow.stockCode,
    fillId:      newFillId,
    stockCode:   shadow.stockCode,
    stockName:   shadow.stockName,
    closedAt,
    returnPct:   fill.pnlPct ?? 0,
    qtyRatio:    fill.qty / baseQty,
    holdingDays,
    entryRegime: shadow.entryRegime,
    sellReason:  fill.reason ?? undefined,
  });
}
