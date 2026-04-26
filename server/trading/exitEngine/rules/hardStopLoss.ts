// @responsibility 고정/레짐/Profit Protection 손절선 도달 전량 청산 규칙
/**
 * exitEngine/rules/hardStopLoss.ts — 하드 스톱 (고정 손절/레짐 손절) (ADR-0028).
 * ATR 트레일링이 손절을 초기/레짐 이상으로 끌어올린 경우 → PROFIT_PROTECTION.
 */

import type { ExitContext, ExitRuleResult } from '../types.js';
import { NO_OP } from '../types.js';
import { placeKisSellOrder } from '../../../clients/kisClient.js';
import { sendTelegramAlert } from '../../../alerts/telegramClient.js';
import { channelSellSignal } from '../../../alerts/channelPipeline.js';
import { sendStopLossTransparencyReport } from '../../../alerts/stopLossTransparencyReport.js';
import { appendShadowLog, updateShadow, buildExitAttribution } from '../../../persistence/shadowTradeRepo.js';
import { addSellOrder } from '../../fillMonitor.js';
import { reserveSell } from '../helpers/reserveSell.js';
import { captureFullCloseSnapshot, rollbackFullCloseOnFailure } from '../helpers/rollbackFullClose.js';
import { matchExitInvalidation, promoteInvalidationPatternIfRepeated } from '../../preMortemStructured.js';
import { promoteKellyDriftPattern } from '../../../learning/kellyDriftFailurePromotion.js';

/**
 * @rule HARD_STOP
 * @priority 4
 * @action FULL_SELL
 * @ratio 1.00
 * @trigger currentPrice <= hardStopLoss
 * @rationale 하드 스톱 — 고정 손절 / 레짐 손절 / Profit Protection 도달 시 전량 청산. ATR 트레일링이 손절을 초기/레짐 이상으로 끌어올린 경우 PROFIT_PROTECTION 으로 분류 (수익 보호 청산).
 */
export async function hardStopLoss(ctx: ExitContext): Promise<ExitRuleResult> {
  const { shadow, currentPrice, returnPct, currentRegime, initialStopLoss, regimeStopLoss, hardStopLoss } = ctx;

  if (currentPrice > hardStopLoss) return NO_OP;

  // ATR 트레일링이 손절을 초기/레짐 이상으로 끌어올린 경우 → PROFIT_PROTECTION
  let stopLossExitType: 'INITIAL' | 'REGIME' | 'INITIAL_AND_REGIME' | 'PROFIT_PROTECTION';
  if (hardStopLoss > initialStopLoss && hardStopLoss > regimeStopLoss) {
    stopLossExitType = 'PROFIT_PROTECTION';
  } else {
    const stopGap = Math.abs(initialStopLoss - regimeStopLoss);
    stopLossExitType = stopGap < 0.5
      ? 'INITIAL_AND_REGIME'
      : (initialStopLoss > regimeStopLoss ? 'INITIAL' : 'REGIME');
  }
  const soldQty = shadow.quantity;
  // BUG #7 fix — 전량 청산 전 스냅샷. 주문 실패 시 HIT_STOP → 이전 상태로 복귀.
  const hardStopSnapshot = captureFullCloseSnapshot(shadow);
  updateShadow(shadow, {
    status: 'HIT_STOP',
    exitPrice: currentPrice,
    exitTime: new Date().toISOString(),
    stopLossExitType,
    exitRuleTag: 'HARD_STOP',
    quantity: 0,
  });
  console.log(`[Shadow Close] HARD_STOP — ${shadow.stockCode} soldQty=${soldQty} quantity→0`);
  appendShadowLog({ event: 'HIT_STOP', ...shadow, stopLossExitType, soldQty });
  // Phase 3-⑫: 구조화 Pre-Mortem 매칭 + 반복 패턴 자동 승급
  {
    const match = matchExitInvalidation(shadow, {
      currentPrice,
      currentRegime,
      mtas: undefined,
      ma60: undefined,
      volume: undefined,
      vkospiDayChange: undefined,
    });
    if (match) {
      shadow.exitInvalidationMatch = {
        id: match.id, matchedAt: new Date().toISOString(), observedValue: match.observedValue,
      };
      promoteInvalidationPatternIfRepeated(shadow);
      // Idea 10 — Kelly decay × invalidation 의 2차원 패턴도 병렬 승급 평가.
      // I/O 실패가 exit 경로를 막지 않도록 try/catch.
      try {
        promoteKellyDriftPattern(shadow);
      } catch (e) {
        console.warn('[KellyDrift] 승급 평가 실패:', e instanceof Error ? e.message : e);
      }
    }
  }
  console.log(`[AutoTrade] ❌ ${shadow.stockName} 하드 스톱(${stopLossExitType}) ${returnPct.toFixed(2)}% @${currentPrice.toLocaleString()}`);
  const hardStopRes = await placeKisSellOrder(shadow.stockCode, shadow.stockName, soldQty, 'STOP_LOSS');
  const hardStopTs = new Date().toISOString();
  const hardStopReserve = reserveSell(shadow, hardStopRes, {
    type: 'SELL', subType: 'STOP_LOSS',
    qty: soldQty, price: currentPrice,
    pnl: (currentPrice - shadow.shadowEntryPrice) * soldQty,
    pnlPct: returnPct, reason: `하드스톱 손절 (${stopLossExitType})`,
    exitRuleTag: 'HARD_STOP', timestamp: hardStopTs,
    attribution: buildExitAttribution(
      'HARD_STOP',
      ['stop_breach', `stop_type_${stopLossExitType.toLowerCase()}`],
      currentRegime,
    ),
  }, 'HARD_STOP');
  if (hardStopReserve.kind === 'PENDING') {
    addSellOrder({
      ordNo: hardStopReserve.ordNo, stockCode: shadow.stockCode, stockName: shadow.stockName,
      quantity: soldQty, originalReason: 'STOP_LOSS',
      placedAt: new Date().toISOString(), relatedTradeId: shadow.id,
    });
  } else if (hardStopReserve.kind === 'FAILED') {
    // BUG #7 fix — 상태 롤백 + CRITICAL 알림. 다음 스캔에서 규칙 재평가.
    rollbackFullCloseOnFailure(shadow, hardStopSnapshot, 'HARD_STOP', hardStopReserve.reason);
    await sendTelegramAlert(
      `🚨 <b>${hardStopReserve.statusPrefix} [하드 스톱] (상태 롤백)</b> ${shadow.stockName} (${shadow.stockCode})\n` +
      `${stopLossExitType} 손절 ${soldQty}주 @${currentPrice.toLocaleString()}원` +
      hardStopReserve.statusSuffix +
      `\n⚙ shadow 는 ACTIVE 로 복귀 — 다음 스캔 사이클에서 자동 재시도.`,
      { priority: 'CRITICAL', dedupeKey: `hard_stop_fail:${shadow.stockCode}` },
    ).catch(console.error);
  }
  await channelSellSignal({
    stockName:   shadow.stockName,
    stockCode:   shadow.stockCode,
    exitPrice:   currentPrice,
    entryPrice:  shadow.shadowEntryPrice,
    pnlPct:      returnPct,
    reason:      'STOP',
    holdingDays: Math.floor((Date.now() - new Date(shadow.signalTime).getTime()) / 86_400_000),
  }).catch(console.error);
  // IDEA 11 — 손절 투명성 리포트
  await sendStopLossTransparencyReport(shadow, {
    exitPrice: currentPrice,
    returnPct,
    soldQty,
  }).catch(console.error);
  return { skipRest: true };
}
