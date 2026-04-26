// @responsibility CASCADE_HALF_SELL -15% 50% 반매도 1회 규칙 (cascadeStep 2)
/**
 * exitEngine/rules/cascadeHalf.ts — CASCADE_HALF_SELL -15% 반매도 (ADR-0028).
 */

import type { ExitContext, ExitRuleResult } from '../types.js';
import { NO_OP } from '../types.js';
import { placeKisSellOrder } from '../../../clients/kisClient.js';
import { sendTelegramAlert } from '../../../alerts/telegramClient.js';
import { appendShadowLog, syncPositionCache } from '../../../persistence/shadowTradeRepo.js';
import { addSellOrder } from '../../fillMonitor.js';
import { reserveSell } from '../helpers/reserveSell.js';

export async function cascadeHalf(ctx: ExitContext): Promise<ExitRuleResult> {
  const { shadow, currentPrice, returnPct } = ctx;

  if (returnPct > -15 || (shadow.cascadeStep ?? 0) >= 2) return NO_OP;

  const halfQty = Math.max(1, Math.floor(shadow.quantity / 2));
  const prevCascadeStep = shadow.cascadeStep ?? 0;
  const prevHalfSoldAt = shadow.halfSoldAt;
  shadow.cascadeStep = 2;
  shadow.halfSoldAt  = new Date().toISOString();
  shadow.exitRuleTag = 'CASCADE_HALF_SELL';
  appendShadowLog({ event: 'CASCADE_HALF_SELL', ...shadow, soldQty: halfQty, returnPct });
  console.log(`[AutoTrade] 🔶 ${shadow.stockName} Cascade -15% — 반매도 ${halfQty}주 (잔여 ${shadow.quantity - halfQty}주)`);
  const cascadeHalfRes = await placeKisSellOrder(shadow.stockCode, shadow.stockName, halfQty, 'STOP_LOSS');
  const cascadeHalfTs = new Date().toISOString();
  const cascadeHalfReserve = reserveSell(shadow, cascadeHalfRes, {
    type: 'SELL', subType: 'STOP_LOSS',
    qty: halfQty, price: currentPrice,
    pnl: (currentPrice - shadow.shadowEntryPrice) * halfQty,
    pnlPct: returnPct, reason: '캐스케이드 -15% 반매도',
    exitRuleTag: 'CASCADE_HALF_SELL', timestamp: cascadeHalfTs,
  }, 'CASCADE_HALF');

  if (cascadeHalfReserve.kind === 'FAILED') {
    // 실주문 접수 실패 — cascadeStep 을 이전 값으로 롤백 (다음 기회 재시도)
    shadow.cascadeStep = prevCascadeStep as 0 | 1 | 2;
    shadow.halfSoldAt = prevHalfSoldAt;
  } else {
    syncPositionCache(shadow);
    if (cascadeHalfReserve.kind === 'PENDING') {
      addSellOrder({
        ordNo: cascadeHalfReserve.ordNo, stockCode: shadow.stockCode, stockName: shadow.stockName,
        quantity: halfQty, originalReason: 'STOP_LOSS',
        placedAt: new Date().toISOString(), relatedTradeId: shadow.id,
      });
    }
  }
  await sendTelegramAlert(
    `🔶 <b>${cascadeHalfReserve.statusPrefix} [Cascade -15%] ${shadow.stockName} (${shadow.stockCode})</b>\n` +
    `손실 ${returnPct.toFixed(1)}% — 반매도 ${halfQty}주 (잔여 ${cascadeHalfReserve.remainingQty}주)` +
    cascadeHalfReserve.statusSuffix,
    cascadeHalfReserve.kind === 'FAILED' ? { priority: 'HIGH' } : undefined,
  ).catch(console.error);
  return { skipRest: true };
}
