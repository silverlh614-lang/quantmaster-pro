// @responsibility CASCADE_WARN_BLOCK -7% 추가매수 차단 1회 경보 규칙
/**
 * exitEngine/rules/cascadeWarn.ts — -7% 추가매수 차단 + 경고 (cascadeStep 1, 1회만).
 */

import type { ExitContext, ExitRuleResult } from '../types.js';
import { NO_OP } from '../types.js';
import { sendTelegramAlert } from '../../../alerts/telegramClient.js';
import { appendShadowLog } from '../../../persistence/shadowTradeRepo.js';

/**
 * @rule CASCADE_WARN_BLOCK
 * @priority 11
 * @action NO_OP
 * @trigger returnPct <= -7 && (shadow.cascadeStep ?? 0) < 1
 * @rationale 캐스케이드 -7% 1회 경보 — 추가 매수 차단 + 모니터링 강화 (cascadeStep=1 + addBuyBlocked=true). 매도 행위 없음. 추가 하락 시 cascadeHalf(-15%) 가 본격 청산.
 */
export async function cascadeWarn(ctx: ExitContext): Promise<ExitRuleResult> {
  const { shadow, returnPct } = ctx;

  if (returnPct <= -7 && (shadow.cascadeStep ?? 0) < 1) {
    shadow.cascadeStep    = 1;
    shadow.addBuyBlocked  = true;
    shadow.exitRuleTag = 'CASCADE_WARN_BLOCK';
    appendShadowLog({ event: 'CASCADE_WARN', ...shadow, returnPct });
    console.warn(`[AutoTrade] ⚠️  ${shadow.stockName} Cascade -7% — 추가 매수 차단`);
    await sendTelegramAlert(
      `⚠️ <b>[Cascade -7%] ${shadow.stockName} (${shadow.stockCode})</b>\n` +
      `손실 ${returnPct.toFixed(1)}% — 추가 매수 차단 (모니터링 강화)`
    ).catch(console.error);
    return { skipRest: true };
  }
  return NO_OP;
}
