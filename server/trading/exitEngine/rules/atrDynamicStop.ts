// @responsibility ATR 동적 손절 BEP 보호 + 수익 Lock-in hardStopLoss 상향 규칙
/**
 * exitEngine/rules/atrDynamicStop.ts — ATR 동적 손절 갱신 (ADR-0028).
 * BEP 보호 / 수익 Lock-in. hardStopLoss 는 오직 상향만 허용 (래칫).
 * mutates shadow.hardStopLoss/dynamicStopPrice + ctx.hardStopLoss (return).
 */

import type { ExitContext, ExitRuleResult } from '../types.js';
import { NO_OP } from '../types.js';
import { sendTelegramAlert } from '../../../alerts/telegramClient.js';
import { appendShadowLog } from '../../../persistence/shadowTradeRepo.js';
import { regimeToStopRegime } from '../../entryEngine.js';
import { evaluateDynamicStop } from '../../../../src/services/quant/dynamicStopEngine.js';

export async function atrDynamicStop(ctx: ExitContext): Promise<ExitRuleResult> {
  const { shadow, currentPrice, returnPct, currentRegime, hardStopLoss } = ctx;

  if (!shadow.entryATR14 || shadow.entryATR14 <= 0) return NO_OP;

  const stopRegime = regimeToStopRegime(currentRegime);
  const dynResult = evaluateDynamicStop({
    entryPrice: shadow.shadowEntryPrice,
    atr14: shadow.entryATR14,
    regime: stopRegime,
    currentPrice,
  });

  // 트레일링 활성 시 trailingStopPrice, 아니면 기본 stopPrice
  const effectiveDynamicStop = dynResult.trailingActive
    ? dynResult.trailingStopPrice
    : dynResult.stopPrice;

  // hardStopLoss는 오직 상향만 허용 (래칫 — 한번 올라간 손절은 내려가지 않음)
  if (effectiveDynamicStop > hardStopLoss) {
    const prevHardStop = hardStopLoss;
    const newHardStop = effectiveDynamicStop;
    shadow.hardStopLoss = effectiveDynamicStop;
    shadow.dynamicStopPrice = effectiveDynamicStop;

    if (dynResult.profitLockIn) {
      appendShadowLog({ event: 'ATR_PROFIT_LOCKIN', ...shadow, prevHardStop, newHardStop });
      console.log(`[AutoTrade] 🔒 ${shadow.stockName} ATR 수익 Lock-in: 손절 ${prevHardStop.toLocaleString()} → ${newHardStop.toLocaleString()} (+3%)`);
      await sendTelegramAlert(
        `🔒 <b>[수익 Lock-in]</b> ${shadow.stockName} (${shadow.stockCode})\n` +
        `ATR 동적 손절 상향: ${prevHardStop.toLocaleString()}원 → ${newHardStop.toLocaleString()}원 (+3%)\n` +
        `현재가: ${currentPrice.toLocaleString()}원 | 수익: +${returnPct.toFixed(1)}%`
      ).catch(console.error);
    } else if (dynResult.bepProtection) {
      appendShadowLog({ event: 'ATR_BEP_PROTECTION', ...shadow, prevHardStop, newHardStop });
      console.log(`[AutoTrade] 🛡️ ${shadow.stockName} ATR BEP 보호: 손절 ${prevHardStop.toLocaleString()} → ${newHardStop.toLocaleString()} (원금)`);
      await sendTelegramAlert(
        `🛡️ <b>[원금 보호]</b> ${shadow.stockName} (${shadow.stockCode})\n` +
        `ATR 동적 손절 상향: ${prevHardStop.toLocaleString()}원 → ${newHardStop.toLocaleString()}원 (BEP)\n` +
        `현재가: ${currentPrice.toLocaleString()}원 | 수익: +${returnPct.toFixed(1)}%`
      ).catch(console.error);
    }
    return { skipRest: false, hardStopLossUpdate: newHardStop };
  }
  return NO_OP;
}
