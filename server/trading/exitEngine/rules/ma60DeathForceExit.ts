// @responsibility MA60 역배열 5영업일 유예 만료 후 전량 강제청산 규칙
/**
 * exitEngine/rules/ma60DeathForceExit.ts — MA60_DEATH_FORCE_EXIT (ADR-0028).
 * 60일선 역배열이 감지된 후 5영업일 유예. 유예 만료일 이후에도 여전히 역배열이면
 * "주도주 사이클 종료"로 판정하고 좀비 포지션을 강제로 청산한다.
 */

import type { ExitContext, ExitRuleResult } from '../types.js';
import { NO_OP } from '../types.js';
import { placeKisSellOrder } from '../../../clients/kisClient.js';
import { sendTelegramAlert } from '../../../alerts/telegramClient.js';
import { channelSellSignal } from '../../../alerts/channelPipeline.js';
import { sendStopLossTransparencyReport } from '../../../alerts/stopLossTransparencyReport.js';
import { appendShadowLog, updateShadow } from '../../../persistence/shadowTradeRepo.js';
import { addSellOrder } from '../../fillMonitor.js';
import { reserveSell } from '../helpers/reserveSell.js';
import { captureFullCloseSnapshot, rollbackFullCloseOnFailure } from '../helpers/rollbackFullClose.js';
import { fetchMaFromCloses, isMA60Death, kstBusinessDateStr } from '../helpers/ma60.js';

export async function ma60DeathForceExit(ctx: ExitContext): Promise<ExitRuleResult> {
  const { shadow, currentPrice, returnPct } = ctx;

  if (shadow.ma60DeathForced || !shadow.ma60ForceExitDate) return NO_OP;

  const todayKst = kstBusinessDateStr(0);
  if (todayKst < shadow.ma60ForceExitDate) return NO_OP;

  const mas = await fetchMaFromCloses(shadow.stockCode).catch(() => null);
  const stillDead = mas ? isMA60Death(mas.ma20, mas.ma60, currentPrice) : true;
  if (!stillDead) {
    // 역배열 해소 → 스케줄 초기화
    shadow.ma60DeathDetectedAt = undefined;
    shadow.ma60ForceExitDate = undefined;
    appendShadowLog({ event: 'MA60_DEATH_RECOVERED', ...shadow });
    return NO_OP;
  }

  const soldQty = shadow.quantity;
  // BUG #7 fix — 전량 청산 전 상태 스냅샷. 주문 실패 시 되돌린다.
  const ma60Snapshot = captureFullCloseSnapshot(shadow);
  updateShadow(shadow, {
    status: 'HIT_STOP',
    exitPrice: currentPrice,
    exitTime: new Date().toISOString(),
    exitRuleTag: 'MA60_DEATH_FORCE_EXIT',
    ma60DeathForced: true,
    quantity: 0,
  });
  console.log(`[Shadow Close] MA60_DEATH_FORCE_EXIT — ${shadow.stockCode} soldQty=${soldQty} quantity→0`);
  appendShadowLog({ event: 'MA60_DEATH_FORCE_EXIT', ...shadow, soldQty });
  console.log(`[AutoTrade] ⚰️ ${shadow.stockName} MA60 죽음 강제 청산 ${returnPct.toFixed(2)}% @${currentPrice.toLocaleString()}`);
  const ma60Res = await placeKisSellOrder(shadow.stockCode, shadow.stockName, soldQty, 'STOP_LOSS');
  const ma60Ts = new Date().toISOString();
  const ma60Reserve = reserveSell(shadow, ma60Res, {
    type: 'SELL', subType: 'EMERGENCY',
    qty: soldQty, price: currentPrice,
    pnl: (currentPrice - shadow.shadowEntryPrice) * soldQty,
    pnlPct: returnPct, reason: 'MA60 역배열 강제청산',
    exitRuleTag: 'MA60_DEATH_FORCE_EXIT', timestamp: ma60Ts,
  }, 'MA60_FORCE');
  if (ma60Reserve.kind === 'PENDING') {
    addSellOrder({
      ordNo: ma60Reserve.ordNo, stockCode: shadow.stockCode, stockName: shadow.stockName,
      quantity: soldQty, originalReason: 'STOP_LOSS',
      placedAt: new Date().toISOString(), relatedTradeId: shadow.id,
    });
  } else if (ma60Reserve.kind === 'FAILED') {
    // BUG #7 fix — 상태 롤백으로 DB/KIS 괴리 제거. 다음 스캔에서 자동 재시도.
    rollbackFullCloseOnFailure(shadow, ma60Snapshot, 'MA60_DEATH_FORCE_EXIT', ma60Reserve.reason);
  }
  await sendTelegramAlert(
    `⚰️ <b>${ma60Reserve.statusPrefix} [MA60 강제 청산]</b> ${shadow.stockName} (${shadow.stockCode})\n` +
    `60일선 역배열 5영업일 유예 만료 — 전량 강제 청산\n` +
    `${soldQty}주 @${currentPrice.toLocaleString()}원 | 수익률: ${returnPct > 0 ? '+' : ''}${returnPct.toFixed(2)}%` +
    ma60Reserve.statusSuffix,
    { priority: 'CRITICAL', dedupeKey: `ma60_force:${shadow.stockCode}` },
  ).catch(console.error);
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
