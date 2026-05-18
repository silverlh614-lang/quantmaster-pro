// @responsibility L3-b LIMIT 트랜치 분할 익절 + 전량소진시 트레일링 활성화 규칙
/**
 * exitEngine/rules/trancheTakeProfitLimit.ts — L3-b LIMIT 트랜치 분할 익절 (ADR-0028).
 * 모든 LIMIT 트랜치 소화 → 트레일링 활성화. 전량 소진 시 HIT_TARGET.
 */

import type { ExitContext, ExitRuleResult } from '../types.js';
import { NO_OP } from '../types.js';
import { sendTelegramAlert } from '../../../alerts/telegramClient.js';
import { channelSellSignal } from '../../../alerts/channelPipeline.js';
import { appendShadowLog, syncPositionCache, updateShadow } from '../../../persistence/shadowTradeRepo.js';
import { addSellOrder } from '../../fillMonitor.js';
import { placeReservedSellOrder } from '../helpers/reserveSell.js';
import { emitFullCloseAttributionForExit } from '../helpers/attribution.js';

export async function trancheTakeProfitLimit(ctx: ExitContext): Promise<ExitRuleResult> {
  const { shadow, currentPrice, returnPct } = ctx;

  if (!shadow.profitTranches || shadow.profitTranches.length === 0 || shadow.trailingEnabled) {
    return NO_OP;
  }

  let trancheFired = false;
  for (const t of shadow.profitTranches) {
    if (!t.taken && currentPrice >= t.price) {
      const baseQty  = shadow.originalQuantity ?? shadow.quantity;
      const sellQty  = Math.min(Math.max(1, Math.round(baseQty * t.ratio)), shadow.quantity);
      t.taken = true;
      trancheFired = true;
      shadow.exitRuleTag = 'LIMIT_TRANCHE_TAKE_PROFIT';
      appendShadowLog({ event: 'PROFIT_TRANCHE', ...shadow, soldQty: sellQty, tranchePrice: t.price, returnPct });
      console.log(`[AutoTrade] 📈 ${shadow.stockName} L3 분할 익절 ${(t.ratio * 100).toFixed(0)}% (${sellQty}주) @${currentPrice.toLocaleString()}`);
      const trancheTs  = new Date().toISOString();
      const trancheIdx = shadow.profitTranches?.filter(x => x.taken && x !== t).length ?? 0;
      const trancheReserve = await placeReservedSellOrder(shadow, sellQty, 'TAKE_PROFIT', {
        type: 'SELL', subType: 'PARTIAL_TP',
        qty: sellQty, price: currentPrice,
        pnl: (currentPrice - shadow.shadowEntryPrice) * sellQty,
        pnlPct: returnPct, reason: `분할익절 트랜치 ${(t.ratio * 100).toFixed(0)}%`,
        exitRuleTag: 'LIMIT_TRANCHE_TAKE_PROFIT', timestamp: trancheTs,
      }, trancheIdx === 0 ? 'LIMIT_TP1' : 'LIMIT_TP2');

      if (trancheReserve.kind === 'FAILED') {
        // 트랜치 주문 실패 — taken 플래그 롤백 (다음 기회에 재시도 허용)
        t.taken = false;
        // trancheFired 는 유지: 다른 트랜치가 이미 fired 됐을 수 있음.
      } else {
        syncPositionCache(shadow);
        if (trancheReserve.kind === 'PENDING') {
          addSellOrder({
            ordNo: trancheReserve.ordNo, stockCode: shadow.stockCode, stockName: shadow.stockName,
            quantity: sellQty, originalReason: 'TAKE_PROFIT',
            placedAt: new Date().toISOString(), relatedTradeId: shadow.id,
          });
        }
      }
      await sendTelegramAlert(
        `📈 <b>${trancheReserve.statusPrefix} [L3 분할 익절]</b> ${shadow.stockName} (${shadow.stockCode})\n` +
        `트랜치: ${(t.ratio * 100).toFixed(0)}% × ${sellQty}주 @${currentPrice.toLocaleString()}원\n` +
        `수익률: +${returnPct.toFixed(2)}% | 잔여: ${trancheReserve.remainingQty}주` +
        trancheReserve.statusSuffix,
        trancheReserve.kind === 'FAILED' ? { priority: 'HIGH' } : undefined,
      ).catch(console.error);
      await channelSellSignal({
        stockName:   shadow.stockName,
        stockCode:   shadow.stockCode,
        exitPrice:   currentPrice,
        entryPrice:  shadow.shadowEntryPrice,
        pnlPct:      returnPct,
        reason:      'TRANCHE',
        holdingDays: Math.floor((Date.now() - new Date(shadow.signalTime).getTime()) / 86_400_000),
        soldQty:     sellQty,
        originalQty: baseQty,
        remainingQtyAfter: trancheReserve.remainingQty,
      }).catch(console.error);
    }
  }
  // 모든 LIMIT 트랜치 소화 → 트레일링 활성화
  if (trancheFired && shadow.profitTranches.every((t) => t.taken)) {
    shadow.trailingEnabled = true;
    shadow.trailingHighWaterMark = currentPrice;
    appendShadowLog({ event: 'TRAILING_ACTIVATED', ...shadow });
    console.log(`[AutoTrade] 🔁 ${shadow.stockName} 트레일링 스톱 활성화 @${currentPrice.toLocaleString()}`);
  }
  // 전량 소진 시 종료
  if (shadow.quantity <= 0) {
    updateShadow(shadow, { status: 'HIT_TARGET', exitPrice: currentPrice, exitTime: new Date().toISOString() });
    appendShadowLog({ event: 'FULLY_CLOSED_TRANCHES', ...shadow });
    // PR-Fix-Attribution-FullClose (ADR-0006) — FULL_CLOSE attribution 영속.
    // 마지막 트랜치 fill 은 emitPartialAttributionForSell 의 remainingQty>0 가드로
    // null 반환 → 본 분기에서 FULL_CLOSE baseline 보장. baseline (entryConditionScores)
    // 부재 시 null 반환 — 학습 오염 차단. try/catch 격리로 매매 흐름 무중단.
    try {
      emitFullCloseAttributionForExit({
        shadow,
        exitPrice: currentPrice,
        returnPct,
        closedAt: shadow.exitTime ?? new Date().toISOString(),
        exitRuleTag: 'LIMIT_TRANCHE_TAKE_PROFIT',
      });
    } catch (e) {
      console.warn(`[trancheTakeProfitLimit] attribution 영속 실패 ${shadow.stockCode}:`, e instanceof Error ? e.message : e);
    }
    return { skipRest: true };
  }
  return NO_OP;
}
