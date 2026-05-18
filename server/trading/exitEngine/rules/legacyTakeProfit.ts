// @responsibility 트랜치 미설정 구형 포지션 목표가 도달 전량 익절 fallback 규칙
/**
 * exitEngine/rules/legacyTakeProfit.ts — 트랜치 미설정 구형 fallback TARGET_EXIT (ADR-0028).
 */

import type { ExitContext, ExitRuleResult } from '../types.js';
import { NO_OP } from '../types.js';
import { sendTelegramAlert } from '../../../alerts/telegramClient.js';
import { channelSellSignal } from '../../../alerts/channelPipeline.js';
import { appendShadowLog, updateShadow } from '../../../persistence/shadowTradeRepo.js';
import { addSellOrder } from '../../fillMonitor.js';
import { placeReservedSellOrder } from '../helpers/reserveSell.js';
import { captureFullCloseSnapshot, rollbackFullCloseOnFailure } from '../helpers/rollbackFullClose.js';
import { emitFullCloseAttributionForExit } from '../helpers/attribution.js';
import { classifyExitOutcome } from '../../exitOutcomeClassifier.js';

export async function legacyTakeProfit(ctx: ExitContext): Promise<ExitRuleResult> {
  const { shadow, currentPrice, returnPct } = ctx;

  if (currentPrice < shadow.targetPrice) return NO_OP;

  const soldQty = shadow.quantity;
  // BUG #7 fix — 전량 청산 전 스냅샷.
  const targetSnapshot = captureFullCloseSnapshot(shadow);
  // ADR-0112: TARGET_EXIT → 명시 WIN (classifyExitOutcome 우선순위 3).
  updateShadow(shadow, {
    status: 'HIT_TARGET',
    exitPrice: currentPrice,
    exitTime: new Date().toISOString(),
    exitRuleTag: 'TARGET_EXIT',
    exitOutcome: classifyExitOutcome(returnPct, 'TARGET_EXIT'),
    quantity: 0,
  });
  // PR-3 (ADR-0006) — FULL_CLOSE attribution 영속.
  try {
    emitFullCloseAttributionForExit({
      shadow,
      exitPrice: currentPrice,
      returnPct,
      closedAt: shadow.exitTime ?? new Date().toISOString(),
      exitRuleTag: 'TARGET_EXIT',
    });
  } catch (e) {
    console.warn(`[legacyTakeProfit] attribution 영속 실패 ${shadow.stockCode}:`, e instanceof Error ? e.message : e);
  }
  console.log(`[Shadow Close] TARGET_EXIT — ${shadow.stockCode} soldQty=${soldQty} quantity→0`);
  appendShadowLog({ event: 'HIT_TARGET', ...shadow, soldQty });
  console.log(`[AutoTrade] ✅ ${shadow.stockName} (${shadow.stockCode}) 목표가 달성 +${returnPct.toFixed(2)}% @${currentPrice.toLocaleString()}`);
  const targetTs = new Date().toISOString();
  const targetReserve = await placeReservedSellOrder(shadow, soldQty, 'TAKE_PROFIT', {
    type: 'SELL', subType: 'FULL_CLOSE',
    qty: soldQty, price: currentPrice,
    pnl: (currentPrice - shadow.shadowEntryPrice) * soldQty,
    pnlPct: returnPct, reason: '목표가 달성 전량청산',
    exitRuleTag: 'TARGET_EXIT', timestamp: targetTs,
  }, 'FULL_CLOSE');
  if (targetReserve.kind === 'PENDING') {
    addSellOrder({
      ordNo: targetReserve.ordNo, stockCode: shadow.stockCode, stockName: shadow.stockName,
      quantity: soldQty, originalReason: 'TAKE_PROFIT',
      placedAt: new Date().toISOString(), relatedTradeId: shadow.id,
    });
  } else if (targetReserve.kind === 'FAILED') {
    // BUG #7 fix — 상태 롤백. 다음 tick 에 목표가 조건 재평가.
    rollbackFullCloseOnFailure(shadow, targetSnapshot, 'TARGET_EXIT', targetReserve.reason);
  }
  await sendTelegramAlert(
    `✅ <b>${targetReserve.statusPrefix} [목표가 달성]</b> ${shadow.stockName} (${shadow.stockCode})\n` +
    `청산가: ${currentPrice.toLocaleString()}원\n` +
    `수익률: +${returnPct.toFixed(2)}%` +
    targetReserve.statusSuffix,
    targetReserve.kind === 'FAILED' ? { priority: 'CRITICAL' } : undefined,
  ).catch(console.error);
  await channelSellSignal({
    stockName:   shadow.stockName,
    stockCode:   shadow.stockCode,
    exitPrice:   currentPrice,
    entryPrice:  shadow.shadowEntryPrice,
    pnlPct:      returnPct,
    reason:      'TARGET',
    holdingDays: Math.floor((Date.now() - new Date(shadow.signalTime).getTime()) / 86_400_000),
    remainingQtyAfter: targetReserve.remainingQty,
  }).catch(console.error);
  return { skipRest: true };
}
