// @responsibility 하락 다이버전스 신고가+RSI 고점 약화 30% 부분익절 1회 규칙
/**
 * exitEngine/rules/bearishDivergenceExit.ts — 하락 다이버전스 30% 익절 (ADR-0028).
 * 주가 신고가 + RSI 고점 낮아짐 → 가짜 돌파·상투 조기 경보. 매매 중 포지션만 대상.
 */

import type { ExitContext, ExitRuleResult } from '../types.js';
import { NO_OP } from '../types.js';
import { placeKisSellOrder } from '../../../clients/kisClient.js';
import { sendTelegramAlert } from '../../../alerts/telegramClient.js';
import { channelSellSignal } from '../../../alerts/channelPipeline.js';
import { appendShadowLog, syncPositionCache, buildExitAttribution } from '../../../persistence/shadowTradeRepo.js';
import { addSellOrder } from '../../fillMonitor.js';
import { reserveSell } from '../helpers/reserveSell.js';
import { detectBearishDivergence } from '../helpers/rsiSeries.js';
import { fetchPriceAndRsiHistory } from '../helpers/priceHistory.js';

/**
 * @rule DIVERGENCE_PARTIAL
 * @priority 13
 * @action PARTIAL_SELL
 * @ratio 0.30
 * @trigger !shadow.divergencePartialSold && currentPrice > shadow.shadowEntryPrice && detectBearishDivergence(prices, rsi)
 * @rationale 주가 신고가 + RSI 고점 낮아짐 = 하락 다이버전스 → 가짜 돌파·상투 조기 경보. 수익 중인 포지션 30% 부분 익절로 상투 위험 회피. 1회 한정.
 */
export async function bearishDivergenceExit(ctx: ExitContext): Promise<ExitRuleResult> {
  const { shadow, currentPrice, returnPct } = ctx;

  if (
    shadow.divergencePartialSold ||
    shadow.quantity <= 0 ||
    currentPrice <= shadow.shadowEntryPrice
  ) {
    return NO_OP;
  }

  const hist = await fetchPriceAndRsiHistory(shadow.stockCode, 10).catch(() => null);
  if (!hist || !detectBearishDivergence(hist.prices, hist.rsi)) return NO_OP;

  const sellQty = Math.max(1, Math.floor(shadow.quantity * 0.30));
  shadow.divergencePartialSold = true;
  shadow.exitRuleTag = 'DIVERGENCE_PARTIAL';
  appendShadowLog({ event: 'DIVERGENCE_PARTIAL', ...shadow, soldQty: sellQty, returnPct, exitPrice: currentPrice });
  console.log(`[AutoTrade] 📉 ${shadow.stockName} 하락 다이버전스 — 30% 익절 ${sellQty}주 @${currentPrice.toLocaleString()}`);
  const divRes = await placeKisSellOrder(shadow.stockCode, shadow.stockName, sellQty, 'TAKE_PROFIT');
  const divTs = new Date().toISOString();
  const divReserve = reserveSell(shadow, divRes, {
    type: 'SELL', subType: 'PARTIAL_TP',
    qty: sellQty, price: currentPrice,
    pnl: (currentPrice - shadow.shadowEntryPrice) * sellQty,
    pnlPct: returnPct, reason: '하락 다이버전스 30% 익절',
    exitRuleTag: 'DIVERGENCE_PARTIAL', timestamp: divTs,
    attribution: buildExitAttribution('DIVERGENCE_PARTIAL', ['bearish_divergence', 'rsi_lower_high'], ctx.currentRegime),
  }, 'LIMIT_TP1', 'divergencePartialSold');

  if (divReserve.kind === 'FAILED') {
    // LIVE 주문 접수 실패 — 중복 방지 플래그 즉시 롤백
    shadow.divergencePartialSold = false;
  } else {
    syncPositionCache(shadow);
    if (divReserve.kind === 'PENDING') {
      addSellOrder({
        ordNo: divReserve.ordNo, stockCode: shadow.stockCode, stockName: shadow.stockName,
        quantity: sellQty, originalReason: 'TAKE_PROFIT',
        placedAt: new Date().toISOString(), relatedTradeId: shadow.id,
      });
    }
  }
  await sendTelegramAlert(
    `📉 <b>${divReserve.statusPrefix} [하락 다이버전스]</b> ${shadow.stockName} (${shadow.stockCode})\n` +
    `주가 신고가·RSI 고점 낮아짐 — 30% 부분 익절\n` +
    `${sellQty}주 @${currentPrice.toLocaleString()}원 | 수익: +${returnPct.toFixed(2)}% | 잔여: ${divReserve.remainingQty}주` +
    divReserve.statusSuffix,
    { priority: divReserve.kind === 'FAILED' ? 'CRITICAL' : 'HIGH', dedupeKey: `divergence:${shadow.stockCode}` },
  ).catch(console.error);
  if (divReserve.recorded) {
    await channelSellSignal({
      stockName:   shadow.stockName,
      stockCode:   shadow.stockCode,
      exitPrice:   currentPrice,
      entryPrice:  shadow.shadowEntryPrice,
      pnlPct:      returnPct,
      reason:      'DIVERGENCE',
      holdingDays: Math.floor((Date.now() - new Date(shadow.signalTime).getTime()) / 86_400_000),
      soldQty:     sellQty,
      originalQty: shadow.originalQuantity,
    }).catch(console.error);
  }
  if (shadow.quantity <= 0) return { skipRest: true };
  return NO_OP;
}
