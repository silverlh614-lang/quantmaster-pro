// @responsibility ATR 동적 손절 BEP 보호 + 수익 Lock-in hardStopLoss 상향 규칙
/**
 * exitEngine/rules/atrDynamicStop.ts — ATR 동적 손절 갱신 (ADR-0028).
 * BEP 보호 / 수익 Lock-in. hardStopLoss 는 오직 상향만 허용 (래칫).
 * mutates shadow.hardStopLoss/dynamicStopPrice + ctx.hardStopLoss (return).
 */

import type { ExitContext, ExitRuleResult } from '../types.js';
import { NO_OP } from '../types.js';
import { emitTelegramEvent } from '../../../alerts/telegramEventRouter.js';
import { appendShadowLog } from '../../../persistence/shadowTradeRepo.js';
import { bepGlideStopPrice } from '../../../../src/services/quant/dynamicStopEngine.js';

export async function atrDynamicStop(ctx: ExitContext): Promise<ExitRuleResult> {
  const { shadow, currentPrice, returnPct, hardStopLoss } = ctx;

  if (!shadow.entryATR14 || shadow.entryATR14 <= 0) return NO_OP;

  // Keep the saved stop. Preserve existing price-based BEP and profit-lock protection without a regime multiplier.
  if (returnPct < 5) return NO_OP;
  const profitLockIn = returnPct >= 10;
  const effectiveDynamicStop = profitLockIn
    ? Math.round(shadow.shadowEntryPrice * 1.03)
    : bepGlideStopPrice(shadow.shadowEntryPrice, shadow.entryATR14);

  // hardStopLoss는 오직 상향만 허용 (래칫 — 한번 올라간 손절은 내려가지 않음)
  if (effectiveDynamicStop > hardStopLoss) {
    const prevHardStop = hardStopLoss;
    const newHardStop = effectiveDynamicStop;
    shadow.hardStopLoss = effectiveDynamicStop;
    shadow.dynamicStopPrice = effectiveDynamicStop;
    // ADR-0028 보강: stopApproachAlert 라벨 분기를 위해 source 메타 영속.
    // PROFIT_PROTECTION 단일 값으로 BEP 보호 + 수익 Lock-in 모두 표현 — 세부 분류는
    // stopApproachAlert 가 hardStopLoss vs shadowEntryPrice 런타임 비교로 결정.
    shadow.stopLossExitType = 'PROFIT_PROTECTION';

    if (profitLockIn) {
      appendShadowLog({ event: 'ATR_PROFIT_LOCKIN', ...shadow, prevHardStop, newHardStop });
      console.log(`[AutoTrade] 🔒 ${shadow.stockName} ATR 수익 Lock-in: 손절 ${prevHardStop.toLocaleString()} → ${newHardStop.toLocaleString()} (+3%)`);
      await emitTelegramEvent({
        type: 'STOP_LOSS_WATCH',
        message:
        `🔒 <b>[수익 Lock-in]</b> ${shadow.stockName} (${shadow.stockCode})\n` +
        `ATR 동적 손절 상향: ${prevHardStop.toLocaleString()}원 → ${newHardStop.toLocaleString()}원 (+3%)\n` +
        `현재가: ${currentPrice.toLocaleString()}원 | 수익: +${returnPct.toFixed(1)}%`,
        severity: 'NORMAL',
        metadata: { symbol: shadow.stockCode },
      }).catch(console.error);
    } else {
      appendShadowLog({ event: 'ATR_BEP_PROTECTION', ...shadow, prevHardStop, newHardStop });
      console.log(`[AutoTrade] 🛡️ ${shadow.stockName} ATR BEP 보호: 손절 ${prevHardStop.toLocaleString()} → ${newHardStop.toLocaleString()} (원금)`);
      await emitTelegramEvent({
        type: 'STOP_LOSS_WATCH',
        message:
        `🛡️ <b>[원금 보호]</b> ${shadow.stockName} (${shadow.stockCode})\n` +
        `ATR 동적 손절 상향: ${prevHardStop.toLocaleString()}원 → ${newHardStop.toLocaleString()}원 (BEP)\n` +
        `현재가: ${currentPrice.toLocaleString()}원 | 수익: +${returnPct.toFixed(1)}%`,
        severity: 'NORMAL',
        metadata: { symbol: shadow.stockCode },
      }).catch(console.error);
    }
    return { skipRest: false, hardStopLossUpdate: newHardStop };
  }
  return NO_OP;
}
