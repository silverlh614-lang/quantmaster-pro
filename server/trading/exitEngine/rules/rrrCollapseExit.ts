// @responsibility RRR 잔여기대 1.0 미만 좀비 포지션 50% 자동 익절 1회 규칙
/**
 * exitEngine/rules/rrrCollapseExit.ts — RRR 붕괴 50% 익절 (ADR-0028).
 * 진입 시 한 번만 계산된 RRR은 주가 상승 시 잔여 upside가 줄면서 실질 RRR이
 * 1.0 이하로 붕괴할 수 있다. 수익 중인 포지션이라도 잔여 기대값이 마이너스이면
 * 보유 정당성이 없으므로 50%를 자동 익절하여 "좀비 포지션"을 제거한다.
 */

import type { ExitContext, ExitRuleResult } from '../types.js';
import { NO_OP } from '../types.js';
import { placeKisSellOrder } from '../../../clients/kisClient.js';
import { sendTelegramAlert } from '../../../alerts/telegramClient.js';
import { channelSellSignal } from '../../../alerts/channelPipeline.js';
import { appendShadowLog, syncPositionCache } from '../../../persistence/shadowTradeRepo.js';
import { addSellOrder } from '../../fillMonitor.js';
import { reserveSell } from '../helpers/reserveSell.js';

export async function rrrCollapseExit(ctx: ExitContext): Promise<ExitRuleResult> {
  const { shadow, currentPrice, returnPct, hardStopLoss } = ctx;

  if (shadow.rrrCollapsePartialSold || shadow.quantity <= 0 || currentPrice <= shadow.shadowEntryPrice) {
    return NO_OP;
  }
  const remainingReward = shadow.targetPrice - currentPrice;
  const remainingRisk   = currentPrice - hardStopLoss;
  if (remainingRisk <= 0) return NO_OP;

  const liveRRR = remainingReward / remainingRisk;
  if (liveRRR >= 1.0) return NO_OP;

  const sellQty = Math.max(1, Math.floor(shadow.quantity * 0.5));
  shadow.rrrCollapsePartialSold = true;
  shadow.exitRuleTag = 'RRR_COLLAPSE_PARTIAL';
  appendShadowLog({ event: 'RRR_COLLAPSE_PARTIAL', ...shadow, soldQty: sellQty, liveRRR, returnPct, exitPrice: currentPrice });
  console.log(`[AutoTrade] 📊 ${shadow.stockName} RRR 붕괴 (${liveRRR.toFixed(2)}) — 50% 익절 ${sellQty}주 @${currentPrice.toLocaleString()}`);
  const rrrRes = await placeKisSellOrder(shadow.stockCode, shadow.stockName, sellQty, 'TAKE_PROFIT');
  const rrrTs = new Date().toISOString();
  const rrrReserve = reserveSell(shadow, rrrRes, {
    type: 'SELL', subType: 'PARTIAL_TP',
    qty: sellQty, price: currentPrice,
    pnl: (currentPrice - shadow.shadowEntryPrice) * sellQty,
    pnlPct: returnPct, reason: 'RRR 붕괴 50% 익절',
    exitRuleTag: 'RRR_COLLAPSE_PARTIAL', timestamp: rrrTs,
  }, 'LIMIT_TP1', 'rrrCollapsePartialSold');

  if (rrrReserve.kind === 'FAILED') {
    // 실주문 접수 실패 — 중복 방지 플래그 즉시 롤백
    shadow.rrrCollapsePartialSold = false;
  } else {
    syncPositionCache(shadow);
    if (rrrReserve.kind === 'PENDING') {
      addSellOrder({
        ordNo: rrrReserve.ordNo, stockCode: shadow.stockCode, stockName: shadow.stockName,
        quantity: sellQty, originalReason: 'TAKE_PROFIT',
        placedAt: new Date().toISOString(), relatedTradeId: shadow.id,
      });
    }
  }
  await sendTelegramAlert(
    `📊 <b>${rrrReserve.statusPrefix} [RRR 붕괴 경보]</b> ${shadow.stockName} (${shadow.stockCode})\n` +
    `잔여 RRR: ${liveRRR.toFixed(2)} (< 1.0) — 좀비 포지션 50% 익절\n` +
    `${sellQty}주 @${currentPrice.toLocaleString()}원 | 수익: +${returnPct.toFixed(2)}%\n` +
    `목표: ${shadow.targetPrice.toLocaleString()}원 | 손절: ${hardStopLoss.toLocaleString()}원 | 잔여: ${rrrReserve.remainingQty}주` +
    rrrReserve.statusSuffix,
    { priority: rrrReserve.kind === 'FAILED' ? 'CRITICAL' : 'HIGH', dedupeKey: `rrr_collapse:${shadow.stockCode}` },
  ).catch(console.error);
  if (rrrReserve.recorded) {
    await channelSellSignal({
      stockName:   shadow.stockName,
      stockCode:   shadow.stockCode,
      exitPrice:   currentPrice,
      entryPrice:  shadow.shadowEntryPrice,
      pnlPct:      returnPct,
      reason:      'RRR_COLLAPSE',
      holdingDays: Math.floor((Date.now() - new Date(shadow.signalTime).getTime()) / 86_400_000),
      soldQty:     sellQty,
      originalQty: shadow.originalQuantity,
    }).catch(console.error);
  }
  if (shadow.quantity <= 0) return { skipRest: true };
  return NO_OP;
}
