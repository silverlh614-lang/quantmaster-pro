// @responsibility 과열 신호 감지 시 ACTIVE 포지션 50% 부분 매도 1회 규칙
/**
 * exitEngine/rules/euphoriaPartialExit.ts — 과열 50% 익절 (ADR-0028).
 * ACTIVE/PARTIALLY_FILLED 상태에서만 첫 번째 부분 매도 발동.
 */

import type { ExitContext, ExitRuleResult } from '../types.js';
import { NO_OP } from '../types.js';
import { placeKisSellOrder } from '../../../clients/kisClient.js';
import { sendTelegramAlert } from '../../../alerts/telegramClient.js';
import { channelSellSignal } from '../../../alerts/channelPipeline.js';
import { appendShadowLog, syncPositionCache, buildExitAttribution } from '../../../persistence/shadowTradeRepo.js';
import { addSellOrder } from '../../fillMonitor.js';
import { reserveSell } from '../helpers/reserveSell.js';
import { checkEuphoria } from '../../riskManager.js';

/**
 * @rule EUPHORIA_PARTIAL
 * @priority 16
 * @action PARTIAL_SELL
 * @ratio 0.50
 * @trigger (status==='ACTIVE' || 'PARTIALLY_FILLED') && checkEuphoria(shadow, currentPrice).triggered
 * @rationale 과열 신호 (RSI 80+/볼린저 상단 이탈/거래량 급증 등) 다중 감지 시 50% 부분 익절. status='EUPHORIA_PARTIAL' 로 전이해 1회 한정 — 잔여 분은 hardStopLoss/trailingStop 가 보호.
 */
export async function euphoriaPartialExit(ctx: ExitContext): Promise<ExitRuleResult> {
  const { shadow, currentPrice, returnPct } = ctx;

  if (shadow.status !== 'ACTIVE' && shadow.status !== 'PARTIALLY_FILLED') return NO_OP;

  const euphoria = checkEuphoria(shadow, currentPrice);
  if (!euphoria.triggered) return NO_OP;

  const halfQty = Math.max(1, Math.floor(shadow.quantity / 2));
  console.log(
    `[AutoTrade] 🌡️ ${shadow.stockName} 과열 감지 (${euphoria.count}개 신호) — 절반 매도 ${halfQty}주\n  신호: ${euphoria.signals.join(', ')}`
  );
  const prevStatus = shadow.status;
  shadow.status = 'EUPHORIA_PARTIAL';
  shadow.exitRuleTag = 'EUPHORIA_PARTIAL';
  appendShadowLog({
    event: 'EUPHORIA_PARTIAL',
    ...shadow,
    exitPrice: currentPrice,
    euphoriaSoldQty: halfQty,
    originalQuantity: shadow.originalQuantity,
  });
  const euphoriaRes = await placeKisSellOrder(shadow.stockCode, shadow.stockName, halfQty, 'EUPHORIA');
  const euphoriaTs = new Date().toISOString();
  const euphoriaReserve = reserveSell(shadow, euphoriaRes, {
    type: 'SELL', subType: 'PARTIAL_TP',
    qty: halfQty, price: currentPrice,
    pnl: (currentPrice - shadow.shadowEntryPrice) * halfQty,
    pnlPct: returnPct, reason: '과열 감지 50% 익절',
    exitRuleTag: 'EUPHORIA_PARTIAL', timestamp: euphoriaTs,
    attribution: buildExitAttribution(
      'EUPHORIA_PARTIAL',
      ['euphoria_signals', `euphoria_count_${euphoria.count}`],
      ctx.currentRegime,
    ),
  }, 'LIMIT_TP1');

  if (euphoriaReserve.kind === 'FAILED') {
    // 실주문 접수 실패 — status 롤백 (다음 기회에 EUPHORIA 재평가 허용)
    shadow.status = prevStatus;
    await sendTelegramAlert(
      `🚨 <b>${euphoriaReserve.statusPrefix} [과열 부분매도 실패]</b> ${shadow.stockName} (${shadow.stockCode})\n` +
      `${halfQty}주 @${currentPrice.toLocaleString()}원` +
      euphoriaReserve.statusSuffix,
      { priority: 'CRITICAL' },
    ).catch(console.error);
  } else {
    syncPositionCache(shadow);
    if (euphoriaReserve.kind === 'PENDING') {
      addSellOrder({
        ordNo: euphoriaReserve.ordNo, stockCode: shadow.stockCode, stockName: shadow.stockName,
        quantity: halfQty, originalReason: 'EUPHORIA',
        placedAt: new Date().toISOString(), relatedTradeId: shadow.id,
      });
    }
    await sendTelegramAlert(
      `🌡️ <b>${euphoriaReserve.statusPrefix} [과열 부분매도]</b> ${shadow.stockName} (${shadow.stockCode})\n` +
      `신호 ${euphoria.count}개 — 50% 매도 ${halfQty}주 @${currentPrice.toLocaleString()}원\n` +
      `수익: ${returnPct > 0 ? '+' : ''}${returnPct.toFixed(2)}% | 잔여: ${euphoriaReserve.remainingQty}주` +
      euphoriaReserve.statusSuffix,
      { priority: 'HIGH', dedupeKey: `euphoria:${shadow.stockCode}` },
    ).catch(console.error);
    await channelSellSignal({
      stockName:   shadow.stockName,
      stockCode:   shadow.stockCode,
      exitPrice:   currentPrice,
      entryPrice:  shadow.shadowEntryPrice,
      pnlPct:      returnPct,
      reason:      'EUPHORIA',
      holdingDays: Math.floor((Date.now() - new Date(shadow.signalTime).getTime()) / 86_400_000),
      soldQty:     halfQty,
      originalQty: shadow.originalQuantity,
    }).catch(console.error);
  }
  return NO_OP;
}
