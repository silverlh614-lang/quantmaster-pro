// @responsibility R6_DEFENSE 블랙스완 긴급 청산 30% 1회 규칙
/**
 * exitEngine/rules/r6EmergencyExit.ts — R6 긴급 청산 30% (ADR-0028).
 * 블랙스완 1회만 발동. r6EmergencySold 플래그가 dedupe.
 */

import type { ExitContext, ExitRuleResult } from '../types.js';
import { NO_OP } from '../types.js';
import { placeKisSellOrder } from '../../../clients/kisClient.js';
import { sendTelegramAlert } from '../../../alerts/telegramClient.js';
import { appendShadowLog, syncPositionCache } from '../../../persistence/shadowTradeRepo.js';
import { addSellOrder } from '../../fillMonitor.js';
import { reserveSell } from '../helpers/reserveSell.js';

export async function r6EmergencyExit(ctx: ExitContext): Promise<ExitRuleResult> {
  const { shadow, currentPrice, returnPct, currentRegime } = ctx;

  if (currentRegime !== 'R6_DEFENSE' || shadow.r6EmergencySold || shadow.quantity <= 0) {
    return NO_OP;
  }

  const emergencyQty = Math.max(1, Math.floor(shadow.quantity * 0.30));
  shadow.exitRuleTag = 'R6_EMERGENCY_EXIT';
  shadow.r6EmergencySold = true;
  appendShadowLog({ event: 'R6_EMERGENCY_EXIT', ...shadow, soldQty: emergencyQty, returnPct });
  console.log(`[AutoTrade] 🔴 ${shadow.stockName} R6 긴급 청산 30% (${emergencyQty}주) @${currentPrice.toLocaleString()}`);
  const r6Res = await placeKisSellOrder(shadow.stockCode, shadow.stockName, emergencyQty, 'STOP_LOSS');
  const r6Ts = new Date().toISOString();
  const r6Reserve = reserveSell(shadow, r6Res, {
    type: 'SELL', subType: 'EMERGENCY',
    qty: emergencyQty, price: currentPrice,
    pnl: (currentPrice - shadow.shadowEntryPrice) * emergencyQty,
    pnlPct: returnPct, reason: 'R6 긴급청산 30%',
    exitRuleTag: 'R6_EMERGENCY_EXIT', timestamp: r6Ts,
  }, 'R6_EMERGENCY', 'r6EmergencySold');

  if (r6Reserve.kind === 'FAILED') {
    // LIVE 주문 접수 실패 — 중복 방지 플래그 즉시 롤백 (다음 기회 재시도 허용)
    shadow.r6EmergencySold = false;
  } else {
    syncPositionCache(shadow);
    if (r6Reserve.kind === 'PENDING') {
      addSellOrder({
        ordNo: r6Reserve.ordNo, stockCode: shadow.stockCode, stockName: shadow.stockName,
        quantity: emergencyQty, originalReason: 'STOP_LOSS',
        placedAt: new Date().toISOString(), relatedTradeId: shadow.id,
      });
    }
  }
  await sendTelegramAlert(
    `🔴 <b>${r6Reserve.statusPrefix} [R6 긴급 청산]</b> ${shadow.stockName} (${shadow.stockCode})\n` +
    `블랙스완 감지 — 30% 즉시 청산 ${emergencyQty}주 @${currentPrice.toLocaleString()}원\n` +
    `수익률: ${returnPct > 0 ? '+' : ''}${returnPct.toFixed(2)}% | 잔여: ${r6Reserve.remainingQty}주` +
    r6Reserve.statusSuffix,
    { priority: r6Reserve.kind === 'FAILED' ? 'CRITICAL' : 'HIGH' },
  ).catch(console.error);
  if (shadow.quantity <= 0) return { skipRest: true }; // 잔여 없으면 종료 처리 생략
  return NO_OP;
}
