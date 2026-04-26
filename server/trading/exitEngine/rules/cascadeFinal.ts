// @responsibility -25%/-30% 캐스케이드 전량 청산 + 블랙리스트 등록 규칙
/**
 * exitEngine/rules/cascadeFinal.ts — -25% 전량 청산 / -30% 블랙리스트 (ADR-0028).
 */

import type { ExitContext, ExitRuleResult } from '../types.js';
import { NO_OP } from '../types.js';
import { placeKisSellOrder } from '../../../clients/kisClient.js';
import { sendTelegramAlert } from '../../../alerts/telegramClient.js';
import { channelSellSignal } from '../../../alerts/channelPipeline.js';
import { sendStopLossTransparencyReport } from '../../../alerts/stopLossTransparencyReport.js';
import { appendShadowLog, updateShadow, buildExitAttribution } from '../../../persistence/shadowTradeRepo.js';
import { addSellOrder } from '../../fillMonitor.js';
import { addToBlacklist } from '../../../persistence/blacklistRepo.js';
import { reserveSell } from '../helpers/reserveSell.js';
import { captureFullCloseSnapshot, rollbackFullCloseOnFailure } from '../helpers/rollbackFullClose.js';

/**
 * @rule CASCADE_FINAL
 * @priority 5
 * @action FULL_SELL
 * @ratio 1.00
 * @trigger returnPct <= -25
 * @rationale 캐스케이드 -25% 도달 시 전량 청산. -30% 이하면 180일 블랙리스트 추가 등록 — 손실 폭주 종목의 재진입 차단으로 추가 손실 봉쇄.
 */
export async function cascadeFinal(ctx: ExitContext): Promise<ExitRuleResult> {
  const { shadow, currentPrice, returnPct } = ctx;

  if (returnPct > -25) return NO_OP;

  const isBlacklistStep = returnPct <= -30;
  const soldQty = shadow.quantity;
  // BUG #7 fix — 전량 청산 전 스냅샷.
  const cascadeSnapshot = captureFullCloseSnapshot(shadow);
  updateShadow(shadow, {
    status: 'HIT_STOP',
    exitPrice: currentPrice,
    exitTime: new Date().toISOString(),
    exitRuleTag: 'CASCADE_FINAL',
    quantity: 0,
  });
  console.log(`[Shadow Close] CASCADE_FINAL — ${shadow.stockCode} soldQty=${soldQty} quantity→0`);
  appendShadowLog({ event: isBlacklistStep ? 'CASCADE_STOP_BLACKLIST' : 'CASCADE_STOP_FINAL', ...shadow, soldQty });
  console.log(`[AutoTrade] ❌ ${shadow.stockName} Cascade ${returnPct.toFixed(2)}% — 전량 청산${isBlacklistStep ? ' + 블랙리스트 180일' : ''}`);
  const cascadeFinalRes = await placeKisSellOrder(shadow.stockCode, shadow.stockName, soldQty, 'STOP_LOSS');
  const cascadeFinalTs = new Date().toISOString();
  const cascadeFinalReserve = reserveSell(shadow, cascadeFinalRes, {
    type: 'SELL', subType: 'STOP_LOSS',
    qty: soldQty, price: currentPrice,
    pnl: (currentPrice - shadow.shadowEntryPrice) * soldQty,
    pnlPct: returnPct, reason: '캐스케이드 전량청산',
    exitRuleTag: 'CASCADE_FINAL', timestamp: cascadeFinalTs,
    attribution: buildExitAttribution(
      'CASCADE_FINAL',
      [isBlacklistStep ? 'drawdown_30_pct' : 'drawdown_25_pct', 'cascade_final'],
      ctx.currentRegime,
    ),
  }, 'HARD_STOP');
  if (cascadeFinalReserve.kind === 'FAILED') {
    // BUG #7 fix — 상태 롤백 + CRITICAL 알림.
    rollbackFullCloseOnFailure(shadow, cascadeSnapshot, 'CASCADE_FINAL', cascadeFinalReserve.reason);
    await sendTelegramAlert(
      `🚨 <b>${cascadeFinalReserve.statusPrefix} [캐스케이드 전량청산] (상태 롤백)</b> ${shadow.stockName}` +
      cascadeFinalReserve.statusSuffix +
      `\n⚙ 다음 스캔에서 자동 재시도 — 블랙리스트 적용도 재평가.`,
      { priority: 'CRITICAL', dedupeKey: `cascade_final_fail:${shadow.stockCode}` },
    ).catch(console.error);
  }
  if (cascadeFinalRes.placed && cascadeFinalRes.ordNo) {
    addSellOrder({
      ordNo: cascadeFinalRes.ordNo, stockCode: shadow.stockCode, stockName: shadow.stockName,
      quantity: soldQty, originalReason: 'STOP_LOSS',
      placedAt: new Date().toISOString(), relatedTradeId: shadow.id,
    });
  }
  await channelSellSignal({
    stockName:   shadow.stockName,
    stockCode:   shadow.stockCode,
    exitPrice:   currentPrice,
    entryPrice:  shadow.shadowEntryPrice,
    pnlPct:      returnPct,
    reason:      'CASCADE',
    holdingDays: Math.floor((Date.now() - new Date(shadow.signalTime).getTime()) / 86_400_000),
  }).catch(console.error);
  // IDEA 11 — 손절 투명성 리포트
  await sendStopLossTransparencyReport(shadow, {
    exitPrice: currentPrice,
    returnPct,
    soldQty,
  }).catch(console.error);
  // BUG #7 fix — 주문이 실제로 접수된 경우만 블랙리스트 등록. 실패 + 롤백 시에는
  // 다음 스캔에서 재시도가 일어나므로 블랙리스트도 그 시점에 재평가된다.
  if (isBlacklistStep && cascadeFinalReserve.kind !== 'FAILED') {
    addToBlacklist(shadow.stockCode, shadow.stockName, `Cascade ${returnPct.toFixed(1)}%`);
    await sendTelegramAlert(
      `🚫 <b>[블랙리스트] ${shadow.stockName} (${shadow.stockCode})</b>\n` +
      `손실 ${returnPct.toFixed(1)}% → 180일 재진입 금지`
    ).catch(console.error);
  }
  return { skipRest: true };
}
