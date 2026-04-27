// @responsibility L3-c 트레일링 스톱 이익보호 손절 전량 청산 규칙
/**
 * exitEngine/rules/trailingStop.ts — L3-c 트레일링 스톱 (이익보호 손절) (ADR-0028).
 */

import type { ExitContext, ExitRuleResult } from '../types.js';
import { NO_OP } from '../types.js';
import { placeKisSellOrder } from '../../../clients/kisClient.js';
import { sendTelegramAlert } from '../../../alerts/telegramClient.js';
import { channelSellSignal } from '../../../alerts/channelPipeline.js';
import { appendShadowLog, updateShadow } from '../../../persistence/shadowTradeRepo.js';
import { addSellOrder } from '../../fillMonitor.js';
import { reserveSell } from '../helpers/reserveSell.js';
import { captureFullCloseSnapshot, rollbackFullCloseOnFailure } from '../helpers/rollbackFullClose.js';

export async function trailingStop(ctx: ExitContext): Promise<ExitRuleResult> {
  const { shadow, currentPrice, returnPct } = ctx;

  if (!shadow.trailingEnabled || shadow.trailingHighWaterMark === undefined || shadow.quantity <= 0) {
    return NO_OP;
  }

  const trailFloor = shadow.trailingHighWaterMark * (1 - (shadow.trailPct ?? 0.10));
  if (currentPrice > trailFloor) return NO_OP;

  const soldQty = shadow.quantity;
  // BUG #7 fix — 전량 청산 전 스냅샷.
  const trailSnapshot = captureFullCloseSnapshot(shadow);
  updateShadow(shadow, {
    status: 'HIT_TARGET',
    exitPrice: currentPrice,
    exitTime: new Date().toISOString(),
    stopLossExitType: 'PROFIT_PROTECTION',
    exitRuleTag: 'TRAILING_PROTECTIVE_STOP',
    quantity: 0,
  });
  console.log(`[Shadow Close] TRAILING_PROTECTIVE_STOP — ${shadow.stockCode} soldQty=${soldQty} quantity→0`);
  appendShadowLog({ event: 'TRAILING_STOP', ...shadow, soldQty });
  console.log(`[AutoTrade] 📉 ${shadow.stockName} L3 트레일링 스톱 (HWM×${(1 - (shadow.trailPct ?? 0.10)).toFixed(2)}) @${currentPrice.toLocaleString()}`);
  const trailRes = await placeKisSellOrder(shadow.stockCode, shadow.stockName, soldQty, 'TAKE_PROFIT');
  const trailTs = new Date().toISOString();
  const trailReserve = reserveSell(shadow, trailRes, {
    type: 'SELL', subType: 'TRAILING_TP',
    qty: soldQty, price: currentPrice,
    pnl: (currentPrice - shadow.shadowEntryPrice) * soldQty,
    pnlPct: returnPct, reason: '트레일링 스톱 청산',
    exitRuleTag: 'TRAILING_PROTECTIVE_STOP', timestamp: trailTs,
  }, 'TRAILING_STOP');
  if (trailReserve.kind === 'PENDING') {
    addSellOrder({
      ordNo: trailReserve.ordNo, stockCode: shadow.stockCode, stockName: shadow.stockName,
      quantity: soldQty, originalReason: 'TAKE_PROFIT',
      placedAt: new Date().toISOString(), relatedTradeId: shadow.id,
    });
  } else if (trailReserve.kind === 'FAILED') {
    // BUG #7 fix — 상태 롤백. 다음 tick 에 트레일링 재평가.
    rollbackFullCloseOnFailure(shadow, trailSnapshot, 'TRAILING_PROTECTIVE_STOP', trailReserve.reason);
  }
  await sendTelegramAlert(
    `📉 <b>${trailReserve.statusPrefix} [L3 트레일링 스톱]</b> ${shadow.stockName} (${shadow.stockCode})\n` +
    `고점: ${shadow.trailingHighWaterMark.toLocaleString()}원 → 청산: ${currentPrice.toLocaleString()}원\n` +
    `최종 수익률: ${returnPct > 0 ? '+' : ''}${returnPct.toFixed(2)}%` +
    trailReserve.statusSuffix,
    trailReserve.kind === 'FAILED' ? { priority: 'CRITICAL' } : undefined,
  ).catch(console.error);
  await channelSellSignal({
    stockName:   shadow.stockName,
    stockCode:   shadow.stockCode,
    exitPrice:   currentPrice,
    entryPrice:  shadow.shadowEntryPrice,
    pnlPct:      returnPct,
    reason:      'TRAILING',
    holdingDays: Math.floor((Date.now() - new Date(shadow.signalTime).getTime()) / 86_400_000),
  }).catch(console.error);
  return { skipRest: true };
}
