// @responsibility MA60_DEATH_WATCH 60일선 역배열 최초 감지 5영업일 청산 스케줄 규칙
/**
 * exitEngine/rules/ma60DeathWatch.ts — MA60 역배열 최초 감지 → 5영업일 강제 청산 스케줄 (ADR-0028).
 * 이미 스케줄된 포지션은 스킵. 역배열이 아니면 스킵. 신규 감지 시 ma60ForceExitDate 설정.
 */

import type { ExitContext, ExitRuleResult } from '../types.js';
import { NO_OP } from '../types.js';
import { sendTelegramAlert } from '../../../alerts/telegramClient.js';
import { appendShadowLog } from '../../../persistence/shadowTradeRepo.js';
import { fetchMaFromCloses, isMA60Death, kstBusinessDateStr } from '../helpers/ma60.js';

export async function ma60DeathWatch(ctx: ExitContext): Promise<ExitRuleResult> {
  const { shadow, currentPrice } = ctx;

  if (!shadow.ma60DeathDetectedAt && !shadow.ma60DeathForced) {
    const mas = await fetchMaFromCloses(shadow.stockCode).catch(() => null);
    if (mas && isMA60Death(mas.ma20, mas.ma60, currentPrice)) {
      const nowIso = new Date().toISOString();
      const forceDate = kstBusinessDateStr(5);
      shadow.ma60DeathDetectedAt = nowIso;
      shadow.ma60ForceExitDate = forceDate;
      shadow.exitRuleTag = 'MA60_DEATH_WATCH';
      appendShadowLog({ event: 'MA60_DEATH_WATCH', ...shadow, ma20: mas.ma20, ma60: mas.ma60 });
      console.log(`[AutoTrade] ⚠️ ${shadow.stockName} MA60 역배열 감지 — 강제 청산일 ${forceDate}`);
      await sendTelegramAlert(
        `⚠️ <b>[MA60 역배열 감지]</b> ${shadow.stockName} (${shadow.stockCode})\n` +
        `60일선 역배열 진입 — 주도주 사이클 종료 신호\n` +
        `MA20: ${Math.round(mas.ma20).toLocaleString()} · MA60: ${Math.round(mas.ma60).toLocaleString()} · 현재가: ${currentPrice.toLocaleString()}원\n` +
        `📅 ${forceDate}까지 회복하지 못하면 강제 청산됩니다.`,
        { priority: 'HIGH', dedupeKey: `ma60_watch:${shadow.stockCode}` },
      ).catch(console.error);
    }
  }
  return NO_OP;
}
